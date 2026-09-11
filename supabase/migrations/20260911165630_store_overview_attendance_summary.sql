-- A narrow owner-only aggregate. This does not open raw client records,
-- introduce an investor role, or change any existing AAL/write boundary.
create function private.can_read_store_overview(
  p_organization_id uuid,
  p_branch_id uuid
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Check the real pinned Google principal/session before casting auth.uid().
  if private.is_executive_login_allowed() is not true then return false; end if;
  if auth.uid() is null or p_organization_id is null or p_branch_id is null then
    return false;
  end if;

  return exists (
    select 1
    from private.executive_reader_scope() scope
    join public.roles role on role.id = scope.role_id
      and role.is_active and role.is_system and role.role_key = 'organization_manager'
    join public.branches branch on branch.organization_id = scope.organization_id
      and branch.id = p_branch_id and branch.is_active
    join public.role_permissions role_permission on role_permission.role_id = scope.role_id
      and role_permission.granted_at <= clock_timestamp()
    join public.permissions permission on permission.id = role_permission.permission_id
      and permission.permission_key in ('attendance.read', 'clients.view_all')
    where scope.organization_id = p_organization_id
      and (scope.branch_id is null or scope.branch_id = p_branch_id)
    group by scope.membership_id, scope.role_id
    having count(distinct permission.permission_key) = 2
  );
end;
$$;

create function public.can_read_store_overview(
  p_organization_id uuid,
  p_branch_id uuid
)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.can_read_store_overview(p_organization_id, p_branch_id);
$$;

create function private.read_store_attendance_summary(
  p_organization_id uuid,
  p_branch_id uuid,
  p_service_date date
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_generated_at timestamptz;
begin
  if private.can_read_store_overview(p_organization_id, p_branch_id) is not true then
    raise exception using errcode = '42501', message = 'store overview access is not permitted';
  end if;
  if p_service_date is null or not isfinite(p_service_date)
    or p_service_date < date '1900-01-01' or p_service_date > date '9999-12-31' then
    raise exception using errcode = '22023', message = 'store overview service date is invalid';
  end if;

  v_generated_at := clock_timestamp();
  -- service_date is the authoritative Asia/Taipei business date. Do not infer
  -- it from server-local created_at or from the current client's active state.
  -- Match attendance_records_current_day_idx and record_attendance_event:
  -- only uncancelled root rows are current. correction_of_id rows are history,
  -- not a separately publishable latest-writer override. A cancelled root and
  -- its replacement root therefore contribute at most one current status.
  -- Missing attendance does NOT mean absent; there is no expected-roster metric.
  select jsonb_build_object(
    'organization_id', p_organization_id,
    'branch_id', p_branch_id,
    'service_date', p_service_date,
    'present', count(distinct attendance.client_id) filter (where attendance.status = 'present'),
    'leave', count(distinct attendance.client_id) filter (where attendance.status = 'leave'),
    'absent', count(distinct attendance.client_id) filter (where attendance.status = 'absent'),
    'generated_at', v_generated_at
  ) into v_result
  from public.attendance_records attendance
  where attendance.organization_id = p_organization_id
    and attendance.branch_id = p_branch_id
    and attendance.service_date = p_service_date
    and attendance.correction_of_id is null
    and attendance.status <> 'cancelled';

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_organization_id, p_branch_id, auth.uid(), 'select', 'attendance_records',
    null, '{}'::text[], jsonb_build_object(
      'projection', 'store_attendance_summary', 'service_date', p_service_date
    )
  );
  return v_result;
end;
$$;

create function public.read_store_attendance_summary(
  p_organization_id uuid,
  p_branch_id uuid,
  p_service_date date
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.read_store_attendance_summary(p_organization_id, p_branch_id, p_service_date);
$$;

-- Server rendering calls this after validating a Finance response and before
-- showing its values. This records an authorized view declaration, not a
-- financial snapshot, receipt attestation, or financial-data write.
create function private.record_store_finance_summary_read(
  p_organization_id uuid,
  p_branch_id uuid,
  p_month text
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if private.can_read_store_overview(p_organization_id, p_branch_id) is not true then
    raise exception using errcode = '42501', message = 'store overview access is not permitted';
  end if;
  if p_month is null or char_length(p_month) <> 7
    or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'store overview finance month is invalid';
  end if;
  if substring(p_month from 1 for 4)::integer < 1900 then
    raise exception using errcode = '22023', message = 'store overview finance month is invalid';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_organization_id, p_branch_id, auth.uid(), 'select', 'finance_store_summary',
    null, '{}'::text[], jsonb_build_object(
      'projection', 'store_finance_summary', 'month', p_month
    )
  );
  return true;
end;
$$;

create function public.record_store_finance_summary_read(
  p_organization_id uuid,
  p_branch_id uuid,
  p_month text
)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.record_store_finance_summary_read(p_organization_id, p_branch_id, p_month);
$$;

alter function private.can_read_store_overview(uuid,uuid) owner to postgres;
alter function private.read_store_attendance_summary(uuid,uuid,date) owner to postgres;
alter function private.record_store_finance_summary_read(uuid,uuid,text) owner to postgres;
revoke all on function private.can_read_store_overview(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.can_read_store_overview(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.read_store_attendance_summary(uuid,uuid,date) from public,anon,authenticated,service_role;
revoke all on function public.read_store_attendance_summary(uuid,uuid,date) from public,anon,authenticated,service_role;
revoke all on function private.record_store_finance_summary_read(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.record_store_finance_summary_read(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.can_read_store_overview(uuid,uuid) to authenticated;
grant execute on function public.can_read_store_overview(uuid,uuid) to authenticated;
grant execute on function private.read_store_attendance_summary(uuid,uuid,date) to authenticated;
grant execute on function public.read_store_attendance_summary(uuid,uuid,date) to authenticated;
grant execute on function private.record_store_finance_summary_read(uuid,uuid,text) to authenticated;
grant execute on function public.record_store_finance_summary_read(uuid,uuid,text) to authenticated;

comment on function public.can_read_store_overview(uuid,uuid) is
  'Self-only pinned Google executive with an effective organization-manager scope and full-branch attendance permission. Read admission only; never write/export authority.';
comment on function public.read_store_attendance_summary(uuid,uuid,date) is
  'Owner-only single-statement counts of explicit current present/leave/absent statuses by Taipei service_date. No client identity, expected-roster denominator, or inferred absence. Successful read is audited.';
comment on function public.record_store_finance_summary_read(uuid,uuid,text) is
  'Revalidates pinned executive/branch authority and records an authorized Finance summary view month. No amounts, balances, personal data, tokens or business writes; caller must not render Finance values unless this audit succeeds.';
