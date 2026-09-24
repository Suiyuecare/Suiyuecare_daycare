-- Daily care allocation is separate from Page 63 qualification/work-hour approval.
-- Allocation never creates client_assignments or grants access. No CMS suggestion
-- becomes a task without a supervisor explicitly confirming the source plan.
create table private.care_roster_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 branch_id uuid not null, client_id uuid not null, service_date date not null,
 shift text not null check(shift in ('morning','afternoon')),
 staff_user_id uuid references auth.users(id), version integer not null check(version>0),
 state text not null check(state in ('scheduled','cancelled')), source_note text not null,
 tasks jsonb not null check(jsonb_typeof(tasks)='array'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id),
 unique(client_id,service_date,shift,version)
);
create index care_roster_branch_date_idx on private.care_roster_versions(organization_id,branch_id,service_date,client_id,shift,version desc);
create index care_roster_staff_date_idx on private.care_roster_versions(staff_user_id,service_date);
create index care_roster_created_by_idx on private.care_roster_versions(created_by,created_at desc);
create table private.care_roster_operations (
 organization_id uuid not null references public.organizations(id), actor_id uuid not null references auth.users(id),
 idempotency_key uuid not null, input_hash text not null, receipt jsonb not null,
 primary key(organization_id,actor_id,idempotency_key)
);
create index care_roster_operations_actor_idx on private.care_roster_operations(actor_id,organization_id);
alter table private.care_roster_versions enable row level security;
alter table private.care_roster_versions force row level security;
alter table private.care_roster_operations enable row level security;
alter table private.care_roster_operations force row level security;
revoke all on private.care_roster_versions,private.care_roster_operations from public,anon,authenticated,service_role;

create function private.care_roster_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='daily allocation evidence is immutable'; end; $$;
create trigger care_roster_versions_append_only before update or delete on private.care_roster_versions for each row execute function private.care_roster_append_only();
create trigger care_roster_operations_append_only before update or delete on private.care_roster_operations for each row execute function private.care_roster_append_only();

create function private.care_roster_can_read(p_client uuid,p_permission text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (private.can_staff_access_client(p_client,p_permission)
   or private.can_executive_read_client(p_client,p_permission));
$$;
create function private.care_roster_manager(p_org uuid,p_branch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
   (private.has_permission(p_org,p_branch,'staff_scheduling.manage') and private.has_permission(p_org,p_branch,'clients.view_all'))
   or (private.has_executive_read_permission(p_org,p_branch,'clients.view_all') and private.has_executive_read_permission(p_org,p_branch,'staff_scheduling.read'))
 );
$$;

create function private.save_care_roster_guarded(p_organization_id uuid,p_branch_id uuid,p_input jsonb)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_client uuid; v_staff uuid; v_date date; v_shift text;
 v_expected integer; v_version integer; v_hash text; v_key uuid; v_previous private.care_roster_operations;
 v_id uuid; v_receipt jsonb; v_from timestamptz; v_to timestamptz;
begin
 if v_actor is null or not private.has_permission(p_organization_id,p_branch_id,'staff_scheduling.manage')
   or not private.has_permission(p_organization_id,p_branch_id,'clients.view_all')
   or not private.has_permission(p_organization_id,p_branch_id,'clients.read')
   or not private.has_recent_aal2(15)
   or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active) then
  raise exception using errcode='42501',message='daily allocation is not permitted'; end if;
 if jsonb_typeof(p_input) is distinct from 'object'
   or not (p_input ?& array['clientId','staffUserId','serviceDate','shift','expectedVersion','state','sourceNote','tasks','approved','idempotency_key'])
   or p_input-array['clientId','staffUserId','serviceDate','shift','expectedVersion','state','sourceNote','tasks','approved','idempotency_key']<>'{}'::jsonb
   or p_input->'approved' is distinct from 'true'::jsonb
   or jsonb_typeof(p_input->'clientId') is distinct from 'string'
   or jsonb_typeof(p_input->'serviceDate') is distinct from 'string'
   or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string'
   or jsonb_typeof(p_input->'staffUserId') not in ('null','string')
   or jsonb_typeof(p_input->'expectedVersion') is distinct from 'number'
   or coalesce(p_input->>'expectedVersion','')!~'^[0-9]+$'
   or coalesce(p_input->>'serviceDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_input->'shift') is distinct from 'string'
   or jsonb_typeof(p_input->'state') is distinct from 'string'
   or jsonb_typeof(p_input->'sourceNote') is distinct from 'string'
   or p_input->>'shift' not in ('morning','afternoon')
   or p_input->>'state' not in ('scheduled','cancelled')
   or char_length(btrim(p_input->>'sourceNote')) not between 3 and 300
   or (p_input->>'sourceNote') ~ '[[:cntrl:]]'
   or jsonb_typeof(p_input->'tasks') is distinct from 'array'
   or jsonb_array_length(p_input->'tasks')>5 then
  raise exception using errcode='22023',message='invalid daily allocation'; end if;
 if exists(select 1 from jsonb_array_elements(p_input->'tasks') t where jsonb_typeof(t)<>'string' or t#>>'{}' not in ('temperature','pulse','blood_pressure','oxygen_saturation','care_diary'))
   or (select count(*)<>count(distinct t) from jsonb_array_elements(p_input->'tasks') t) then
  raise exception using errcode='22023',message='invalid daily task'; end if;
 v_client:=(p_input->>'clientId')::uuid; v_staff:=(p_input->>'staffUserId')::uuid;
 v_date:=(p_input->>'serviceDate')::date; v_shift:=p_input->>'shift';
 v_expected:=(p_input->>'expectedVersion')::integer; v_key:=(p_input->>'idempotency_key')::uuid;
 if v_client is null or v_date is null or v_expected is null or v_expected<0 or v_key is null
   or to_char(v_date,'YYYY-MM-DD')<>p_input->>'serviceDate' then raise exception using errcode='22023',message='invalid allocation key'; end if;
 v_from:=(v_date::text||case when v_shift='morning' then ' 00:00:00' else ' 12:00:00' end)::timestamp at time zone 'Asia/Taipei';
 v_to:=v_from+interval '12 hours';
 if not exists(select 1 from public.clients c where c.id=v_client and c.organization_id=p_organization_id and c.branch_id=p_branch_id
   and c.status='active' and (c.admitted_on is null or c.admitted_on<=v_date) and (c.ended_on is null or c.ended_on>=v_date))
   or not private.can_staff_access_client(v_client,'clients.read') then raise exception using errcode='42501',message='client is outside allocation scope'; end if;
 -- Target must already have both a valid role and client authorization for the slot.
 if v_staff is not null and not exists(
   select 1 from public.memberships m join public.profiles p on p.id=m.profile_id and p.is_active and p.kind='staff'
   join public.membership_roles mr on mr.membership_id=m.id
   join public.roles r on r.id=mr.role_id and r.is_active
   join public.role_permissions rp on rp.role_id=r.id join public.permissions permission on permission.id=rp.permission_id
   where m.profile_id=v_staff and m.organization_id=p_organization_id and (m.branch_id is null or m.branch_id=p_branch_id)
    and m.status='active' and m.starts_at<=v_from and (m.ends_at is null or m.ends_at>=v_to)
    and (r.organization_id is null or r.organization_id=p_organization_id) and permission.permission_key='clients.read'
    and (exists(select 1 from public.role_permissions rp2 join public.permissions p2 on p2.id=rp2.permission_id where rp2.role_id=r.id and p2.permission_key='clients.view_all')
      or exists(select 1 from public.client_assignments a where a.client_id=v_client and a.organization_id=p_organization_id and a.branch_id=p_branch_id
        and a.assignee_user_id=v_staff and a.starts_at<=v_from and (a.ends_at is null or a.ends_at>=v_to)))
 ) then raise exception using errcode='42501',message='staff does not already have client authorization'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch_id,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||v_actor::text||v_key::text,0));
 select * into v_previous from private.care_roster_operations where organization_id=p_organization_id and actor_id=v_actor and idempotency_key=v_key;
 if found then
  if v_previous.input_hash<>v_hash then raise exception using errcode='23505',message='operation key conflict'; end if;
  return query select v_previous.receipt||jsonb_build_object('replayed',true); return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(v_client::text||v_date::text||v_shift,0));
 select coalesce(max(version),0) into v_version from private.care_roster_versions where client_id=v_client and service_date=v_date and shift=v_shift;
 if v_version<>v_expected then raise exception using errcode='40001',message='allocation version changed'; end if;
 insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
 values(p_organization_id,p_branch_id,v_client,v_date,v_shift,v_staff,v_version+1,p_input->>'state',btrim(p_input->>'sourceNote'),p_input->'tasks',v_actor) returning id into v_id;
 v_receipt:=jsonb_build_object('id',v_id,'clientId',v_client,'serviceDate',v_date,'shift',v_shift,'version',v_version+1,'replayed',false);
 insert into private.care_roster_operations values(p_organization_id,v_actor,v_key,v_hash,v_receipt);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,v_actor,'insert','care_roster_versions',v_id::text,array['allocation'],jsonb_build_object('version',v_version+1,'task_count',jsonb_array_length(p_input->'tasks')));
 return query select v_receipt;
end;
$$;

create function private.care_roster_snapshot_guarded(p_organization_id uuid,p_branch_id uuid,p_service_date date)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_manager boolean; v_rows jsonb:='[]'; v_staff jsonb:='[]'; v_r record; v_tasks jsonb;
 v_kind text; v_at timestamptz; v_from timestamptz; v_to timestamptz; v_access boolean;
begin
 if auth.uid() is null or p_service_date is null
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 or not (
   private.has_permission(p_organization_id,p_branch_id,'clients.read')
   or private.has_executive_read_permission(p_organization_id,p_branch_id,'clients.read')
 ) then raise exception using errcode='42501',message='daily allocation snapshot not permitted'; end if;
 v_manager:=private.care_roster_manager(p_organization_id,p_branch_id);
 for v_r in select r.*,p.display_name as staff_name from (
   select distinct on(client_id,shift) * from private.care_roster_versions
   where organization_id=p_organization_id and branch_id=p_branch_id and service_date=p_service_date
   order by client_id,shift,version desc
 ) r left join public.profiles p on p.id=r.staff_user_id
 where (v_manager or r.staff_user_id=auth.uid()) and private.care_roster_can_read(r.client_id,'clients.read')
 loop
  v_from:=(p_service_date::text||case when v_r.shift='morning' then ' 00:00:00' else ' 12:00:00' end)::timestamp at time zone 'Asia/Taipei';
  v_to:=v_from+interval '12 hours'; v_tasks:='[]';
  for v_kind in select jsonb_array_elements_text(v_r.tasks) loop
   v_at:=null;
   v_access:=private.care_roster_can_read(v_r.client_id,case when v_kind='care_diary' then 'care_records.read' else 'health.read' end);
   if v_access and v_kind='care_diary' then
    select max(c.occurred_at) into v_at from public.care_records c where c.organization_id=p_organization_id and c.branch_id=p_branch_id and c.client_id=v_r.client_id
     and c.category='staff/daily-care/care-diary' and c.status in ('signed','corrected') and c.signed_at is not null
     and c.occurred_at>=v_from and c.occurred_at<v_to
     and not exists(select 1 from public.care_records newer where newer.organization_id=c.organization_id and newer.record_key=c.record_key and newer.version>c.version);
   elsif v_access and v_kind='blood_pressure' then
    select max(m.measured_at) into v_at from public.measurements m where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.client_id=v_r.client_id
     and m.measurement_kind='blood_pressure_systolic' and m.measured_at>=v_from and m.measured_at<v_to and m.numeric_value is not null
     and exists(select 1 from public.measurements d where d.organization_id=m.organization_id and d.branch_id=m.branch_id and d.client_id=m.client_id
       and d.measured_at=m.measured_at and d.measurement_kind='blood_pressure_diastolic' and d.numeric_value is not null);
   elsif v_access then
    select max(m.measured_at) into v_at from public.measurements m where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.client_id=v_r.client_id
      and m.measurement_kind=v_kind and m.numeric_value is not null and m.measured_at>=v_from and m.measured_at<v_to;
   end if;
   v_tasks:=v_tasks||jsonb_build_array(jsonb_build_object('kind',v_kind,'status',case when not v_access then 'restricted' when v_at is null then 'pending' else 'recorded' end,'evidenceAt',v_at));
  end loop;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_r.id,'clientId',v_r.client_id,'staffUserId',v_r.staff_user_id,'staffName',v_r.staff_name,
   'serviceDate',v_r.service_date,'shift',v_r.shift,'version',v_r.version,'state',v_r.state,'sourceNote',v_r.source_note,'tasks',v_tasks));
 end loop;
 if v_manager then
  select coalesce(jsonb_agg(jsonb_build_object('userId',p.id,'name',p.display_name) order by p.display_name),'[]') into v_staff
  from public.profiles p where p.is_active and p.kind='staff' and exists(select 1 from public.memberships m
    where m.profile_id=p.id and m.organization_id=p_organization_id and (m.branch_id is null or m.branch_id=p_branch_id)
      and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,auth.uid(),'select','care_roster_snapshot',p_branch_id::text,array['bounded_snapshot'],jsonb_build_object('service_date',p_service_date,'row_count',jsonb_array_length(v_rows)));
 return query select jsonb_build_object('manager',v_manager,'assignments',v_rows,'staffOptions',v_staff);
end;
$$;
create function public.save_care_roster(p_organization_id uuid,p_branch_id uuid,p_input jsonb) returns table(receipt jsonb)
language sql volatile security invoker set search_path='' as $$ select * from private.save_care_roster_guarded(p_organization_id,p_branch_id,p_input); $$;
create function public.care_roster_snapshot(p_organization_id uuid,p_branch_id uuid,p_service_date date) returns table(payload jsonb)
language sql volatile security invoker set search_path='' as $$ select * from private.care_roster_snapshot_guarded(p_organization_id,p_branch_id,p_service_date); $$;
revoke all on function private.care_roster_append_only(),private.care_roster_can_read(uuid,text),private.care_roster_manager(uuid,uuid),
 private.save_care_roster_guarded(uuid,uuid,jsonb),private.care_roster_snapshot_guarded(uuid,uuid,date),
 public.save_care_roster(uuid,uuid,jsonb),public.care_roster_snapshot(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.save_care_roster_guarded(uuid,uuid,jsonb),private.care_roster_snapshot_guarded(uuid,uuid,date),
 public.save_care_roster(uuid,uuid,jsonb),public.care_roster_snapshot(uuid,uuid,date) to authenticated;
