begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Recorded attendance only: no inferred absence, care-plan denominator or client identities.
create function private.read_store_attendance_month(p_organization_id uuid,p_branch_id uuid,p_month text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_from date; v_until date; v_result jsonb; v_generated timestamptz;
begin
  if private.can_read_store_overview(p_organization_id,p_branch_id) is not true then
    raise exception using errcode='42501',message='store overview access is not permitted';
  end if;
  if p_month is null or p_month !~ '^(20[0-9]{2}|21[0-9]{2}|2200)-(0[1-9]|1[0-2])$' then
    raise exception using errcode='22023',message='store attendance month is invalid';
  end if;
  v_from:=(p_month||'-01')::date;
  v_until:=(v_from+interval '1 month')::date;
  v_generated:=clock_timestamp();
  with current_records as materialized (
    select client_id,service_date,status from public.attendance_records
    where organization_id=p_organization_id and branch_id=p_branch_id
      and service_date>=v_from and service_date<v_until
      and correction_of_id is null and status<>'cancelled'
  ), daily as (
    select service_date,count(distinct client_id) filter(where status='present') as present,
      count(distinct client_id) filter(where status='leave') as leave,
      count(distinct client_id) filter(where status='absent') as absent
    from current_records group by service_date
  ), days as (
    select v_from+n as service_date,coalesce(d.present,0) as present,
      coalesce(d.leave,0) as leave,coalesce(d.absent,0) as absent
    from generate_series(0,v_until-v_from-1) n left join daily d on d.service_date=v_from+n
  )
  select jsonb_build_object('organization_id',p_organization_id,'branch_id',p_branch_id,
    'month',p_month,'generated_at',v_generated,
    'days',jsonb_agg(jsonb_build_object('date',service_date,'present',present,'leave',leave,'absent',absent) order by service_date),
    'totals',jsonb_build_object('present',sum(present),'leave',sum(leave),'absent',sum(absent)),
    'distinct_present_clients',(select count(distinct client_id) from current_records where status='present')
  ) into v_result from days;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_organization_id,p_branch_id,auth.uid(),'select','attendance_records',null,'{}'::text[],
    jsonb_build_object('projection','store_attendance_month','month',p_month));
  return v_result;
end; $$;
create function public.read_store_attendance_month(p_organization_id uuid,p_branch_id uuid,p_month text)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.read_store_attendance_month(p_organization_id,p_branch_id,p_month);
$$;
alter function private.read_store_attendance_month(uuid,uuid,text) owner to postgres;
revoke all on function private.read_store_attendance_month(uuid,uuid,text),public.read_store_attendance_month(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.read_store_attendance_month(uuid,uuid,text),public.read_store_attendance_month(uuid,uuid,text) to authenticated;
comment on function public.read_store_attendance_month(uuid,uuid,text) is
 'Pinned executive same-branch Google aggregate. One query snapshot for calendar days and totals; explicit current attendance only, no inferred absence, client identifiers or Finance data. Month/read audit only.';
commit;
