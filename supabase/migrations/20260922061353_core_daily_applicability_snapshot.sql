begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- One statement snapshot; current assignments and source permissions still apply.
create function private.core_daily_snapshot_data(p_organization_id uuid,p_branch_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb; v_count integer;
begin
 if auth.uid() is null or p_date is null or not isfinite(p_date) or p_date<'2000-01-01' or p_date>'2100-01-01'
 or not exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id and o.is_active
   where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 or not (private.has_permission(p_organization_id,p_branch_id,'clients.read')
   or private.has_executive_read_permission(p_organization_id,p_branch_id,'clients.read')
   or private.has_routine_staff_permission(p_organization_id,p_branch_id,'clients.read')) then
  raise exception using errcode='42501',message='daily care snapshot denied';end if;
 with bounds as materialized (
  select p_date::timestamp at time zone 'Asia/Taipei' as starts_at,
   (p_date+1)::timestamp at time zone 'Asia/Taipei' as ends_at
 ), visible as materialized (
  select c.id,c.client_code,c.display_name,private.client_service_state_on(c.id,p_date) as eligibility,
   private.care_roster_can_read(c.id,'attendance.read') as attendance_access,
   private.care_roster_can_read(c.id,'health.read') as health_access,
   private.care_roster_can_read(c.id,'care_records.read') as diary_access,
   private.care_roster_can_read(c.id,'services.read') as service_access
  from public.clients c where c.organization_id=p_organization_id and c.branch_id=p_branch_id
   and private.care_roster_can_read(c.id,'clients.read')
 ), attendance as materialized (
  select distinct on(a.client_id) a.id,a.client_id,a.status,a.checked_in_at,a.checked_out_at,a.source
  from public.attendance_records a join visible c on c.id=a.client_id and c.attendance_access
  where a.organization_id=p_organization_id and a.branch_id=p_branch_id and a.service_date=p_date
   and a.correction_of_id is null and a.status<>'cancelled'
  order by a.client_id,a.updated_at desc,a.id
 ), measurements as materialized (
  select distinct on(m.client_id,m.measurement_kind) m.client_id,m.measurement_kind,m.measured_at,m.numeric_value
  from public.measurements m join visible c on c.id=m.client_id and c.health_access cross join bounds b
  where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.measured_at>=b.starts_at and m.measured_at<b.ends_at
   and m.measurement_kind in('blood_pressure_systolic','blood_pressure_diastolic','pulse','temperature','oxygen_saturation')
  order by m.client_id,m.measurement_kind,m.measured_at desc,m.id
 ), diary_versions as materialized (
  select distinct on(r.record_key) r.id,r.record_key,r.version,r.client_id,r.status,r.occurred_at,
   jsonb_build_object('abnormal',coalesce(r.data->'abnormal'='true'::jsonb,false),
     'has_abnormal_flag',coalesce(r.data->'has_abnormal_flag'='true'::jsonb,false)) as data
  from public.care_records r join visible c on c.id=r.client_id and c.diary_access cross join bounds b
  where r.organization_id=p_organization_id and r.branch_id=p_branch_id and r.category='staff/daily-care/care-diary'
   and r.occurred_at>=b.starts_at and r.occurred_at<b.ends_at
  order by r.record_key,r.version desc
 ), diaries as materialized (
  select distinct on(client_id) * from diary_versions where status<>'voided' order by client_id,occurred_at desc,id
 ), services as materialized (
  select s.client_id,'completed'::text as status,count(*)::integer as count from public.service_events s
  join visible c on c.id=s.client_id and c.service_access cross join bounds b
  where s.organization_id=p_organization_id and s.branch_id=p_branch_id and s.status='completed'
   and s.started_at>=b.starts_at and s.started_at<b.ends_at group by s.client_id
 ), retained as materialized (
  select c.*,private.client_weekly_days(c.id,p_date,1)->0 as weekly from visible c
  where c.eligibility='eligible' or exists(select 1 from attendance a where a.client_id=c.id)
   or exists(select 1 from measurements m where m.client_id=c.id)
   or exists(select 1 from diaries d where d.client_id=c.id)
   or exists(select 1 from services s where s.client_id=c.id)
  order by c.id limit 501
 ) select (select count(*)::integer from retained),jsonb_build_object(
  'organizationId',p_organization_id,'branchId',p_branch_id,'serviceDate',p_date,'generatedAt',statement_timestamp(),
  'clients',coalesce((select jsonb_agg(jsonb_build_object('id',id,'client_code',client_code,'display_name',display_name,
   'eligibility',eligibility,'scheduleStatus',case
    when eligibility<>'eligible' then 'ineligible'
    when weekly->>'status'='plan_expired' or (coalesce((weekly->>'planVersion')::integer,0)=0 and coalesce((weekly->>'exceptionVersion')::integer,0)=0) then 'unknown'
    when weekly->>'status'='scheduled' then 'scheduled' else 'not_scheduled' end,
   'sourceAccess',jsonb_build_object('attendance',attendance_access,'measurements',health_access,'careDiaries',diary_access,'serviceEvents',service_access)) order by id)
   from retained),'[]'::jsonb),
  'attendance',coalesce((select jsonb_agg(to_jsonb(a) order by a.client_id) from attendance a join retained c on c.id=a.client_id),'[]'::jsonb),
  'measurements',coalesce((select jsonb_agg(to_jsonb(m) order by m.client_id,m.measurement_kind) from measurements m join retained c on c.id=m.client_id),'[]'::jsonb),
  'careDiaries',coalesce((select jsonb_agg(to_jsonb(d) order by d.client_id) from diaries d join retained c on c.id=d.client_id),'[]'::jsonb),
  'serviceEvents',coalesce((select jsonb_agg(to_jsonb(s) order by s.client_id) from services s join retained c on c.id=s.client_id),'[]'::jsonb)
 ) into v_count,v_payload;
 if v_count>500 then raise exception using errcode='54000',message='daily care snapshot exceeds limit';end if;
 return v_payload;
end;$$;
create function private.core_daily_snapshot_guarded(p_organization_id uuid,p_branch_id uuid,p_date date)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_payload jsonb;
begin
 v_payload:=private.core_daily_snapshot_data(p_organization_id,p_branch_id,p_date);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,auth.uid(),'select','core_daily_snapshot',p_branch_id::text,
  array['bounded_snapshot'],jsonb_build_object('client_count',jsonb_array_length(v_payload->'clients')));
 return query select v_payload;
end;$$;
create function public.core_daily_snapshot(p_organization_id uuid,p_branch_id uuid,p_date date)
returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$
 select * from private.core_daily_snapshot_guarded(p_organization_id,p_branch_id,p_date);
$$;
revoke all on function private.core_daily_snapshot_data(uuid,uuid,date) from public,anon,authenticated,service_role;
revoke all on function private.core_daily_snapshot_guarded(uuid,uuid,date) from public,anon,authenticated,service_role;
revoke all on function public.core_daily_snapshot(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.core_daily_snapshot_guarded(uuid,uuid,date) to authenticated;
grant execute on function public.core_daily_snapshot(uuid,uuid,date) to authenticated;
commit;
