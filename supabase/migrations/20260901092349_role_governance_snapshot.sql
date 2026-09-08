-- Page 81 formal read boundary. Governance reads are served through one
-- tenant/branch-scoped, audited projection. The exposed wrapper remains
-- SECURITY INVOKER; only the private implementation may bypass table RLS,
-- and it revalidates the caller before reading any row.

create or replace function private.role_governance_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  roles jsonb,
  permissions jsonb,
  memberships jsonb,
  requests jsonb,
  request_total bigint,
  pending_total bigint,
  requests_truncated boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_roles jsonb;
  v_permissions jsonb;
  v_memberships jsonb;
  v_requests jsonb;
  v_request_total bigint;
  v_pending_total bigint;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       null,
       'roles.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'roles.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'role governance snapshot is not permitted in the selected tenant context';
  end if;

  select
    count(*)::bigint,
    count(*) filter (where request.status = 'pending')::bigint
    into v_request_total, v_pending_total
  from public.role_governance_requests request
  where request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', role_row.id,
    'organization_id', role_row.organization_id,
    'role_key', role_row.role_key,
    'name', role_row.name,
    'description', role_row.description,
    'is_system', role_row.is_system,
    'is_active', role_row.is_active,
    'permission_keys', role_row.permission_keys
  ) order by role_row.is_system desc, role_row.name collate "C", role_row.id), '[]'::jsonb)
    into v_roles
  from (
    select
      role.id,
      role.organization_id,
      role.role_key,
      role.name,
      role.description,
      role.is_system,
      role.is_active,
      coalesce(
        array_agg(distinct permission.permission_key order by permission.permission_key)
          filter (where permission.permission_key is not null),
        '{}'::text[]
      ) as permission_keys
    from public.roles role
    left join public.role_permissions role_permission
      on role_permission.role_id = role.id
    left join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.is_system
       or role.organization_id = p_expected_organization_id
    group by role.id
  ) role_row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'permission_key', permission.permission_key,
    'description', permission.description,
    'risk_level', permission.risk_level
  ) order by permission.permission_key), '[]'::jsonb)
    into v_permissions
  from public.permissions permission;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', membership_row.id,
    'organization_id', membership_row.organization_id,
    'branch_id', membership_row.branch_id,
    'display_name', membership_row.display_name,
    'profile_kind', membership_row.profile_kind,
    'status', membership_row.status,
    'starts_at', membership_row.starts_at,
    'ends_at', membership_row.ends_at,
    'current_actor', membership_row.current_actor,
    'role_ids', membership_row.role_ids
  ) order by membership_row.display_name collate "C", membership_row.id), '[]'::jsonb)
    into v_memberships
  from (
    select
      membership.id,
      membership.organization_id,
      membership.branch_id,
      profile.display_name,
      profile.kind as profile_kind,
      membership.status,
      membership.starts_at,
      membership.ends_at,
      profile.id = v_actor as current_actor,
      coalesce(
        array_agg(distinct role.id order by role.id)
          filter (where role.id is not null),
        '{}'::uuid[]
      ) as role_ids
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    left join public.membership_roles assignment
      on assignment.membership_id = membership.id
    left join public.roles role on role.id = assignment.role_id
    where membership.organization_id = p_expected_organization_id
      and (
        membership.branch_id is null
        or membership.branch_id = p_expected_branch_id
      )
    group by membership.id, profile.id
  ) membership_row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request_row.id,
    'organization_id', request_row.organization_id,
    'branch_id', request_row.branch_id,
    'operation', request_row.operation,
    'target_role_id', request_row.target_role_id,
    'target_membership_id', request_row.target_membership_id,
    'target_permission_key', request_row.target_permission_key,
    'role_key', request_row.role_key,
    'role_name', request_row.role_name,
    'role_description', request_row.role_description,
    'status', request_row.status,
    'requested_at', request_row.requested_at,
    'requested_by_current_actor', request_row.requested_by_current_actor,
    'requester_label', request_row.requester_label,
    'approved_at', request_row.approved_at,
    'approved_by_current_actor', request_row.approved_by_current_actor,
    'approver_label', request_row.approver_label,
    'applied_at', request_row.applied_at
  ) order by
      case when request_row.status = 'pending' then 0 else 1 end,
      request_row.requested_at desc,
      request_row.id), '[]'::jsonb)
    into v_requests
  from (
    select
      request.id,
      request.organization_id,
      request.branch_id,
      request.operation,
      request.target_role_id,
      request.target_membership_id,
      permission.permission_key as target_permission_key,
      request.role_key,
      request.role_name,
      request.role_description,
      request.status,
      request.requested_at,
      request.requested_by = v_actor as requested_by_current_actor,
      case
        when request.requested_by = v_actor then '本人申請'
        else requester.display_name
      end as requester_label,
      request.approved_at,
      coalesce(request.approved_by = v_actor, false) as approved_by_current_actor,
      case
        when request.approved_by is null then null
        when request.approved_by = v_actor then '本人核准'
        else approver.display_name
      end as approver_label,
      request.applied_at
    from public.role_governance_requests request
    join public.profiles requester on requester.id = request.requested_by
    left join public.profiles approver on approver.id = request.approved_by
    left join public.permissions permission
      on permission.id = request.target_permission_id
    where request.organization_id = p_expected_organization_id
      and request.branch_id = p_expected_branch_id
    order by
      case when request.status = 'pending' then 0 else 1 end,
      request.requested_at desc,
      request.id
    limit 200
  ) request_row;

  -- Recheck authorization immediately before returning the snapshot and
  -- recording the access. This avoids returning rows after a waited query if
  -- the caller's authority was removed meanwhile.
  if not (select private.has_permission(
       p_expected_organization_id,
       null,
       'roles.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'roles.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'role governance snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    changed_fields,
    metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'role_governance_snapshot',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page81_minimal',
      'role_count', jsonb_array_length(v_roles),
      'permission_count', jsonb_array_length(v_permissions),
      'membership_count', jsonb_array_length(v_memberships),
      'request_count', jsonb_array_length(v_requests),
      'request_total', v_request_total,
      'pending_total', v_pending_total,
      'requests_truncated', v_request_total > jsonb_array_length(v_requests),
      'request_limit', 200
    )
  );

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_roles,
    v_permissions,
    v_memberships,
    v_requests,
    v_request_total,
    v_pending_total,
    v_request_total > jsonb_array_length(v_requests);
end;
$$;

create or replace function public.role_governance_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  roles jsonb,
  permissions jsonb,
  memberships jsonb,
  requests jsonb,
  request_total bigint,
  pending_total bigint,
  requests_truncated boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.role_governance_snapshot_response(
    p_expected_organization_id,
    p_expected_branch_id
  );
$$;

comment on function public.role_governance_snapshot(uuid, uuid) is
  'Returns the minimal audited page-81 role governance projection for one selected tenant and branch; excludes AAL2 and hash evidence.';

revoke all on function private.role_governance_snapshot_response(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.role_governance_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.role_governance_snapshot_response(uuid, uuid)
  to authenticated;
grant execute on function public.role_governance_snapshot(uuid, uuid)
  to authenticated;

-- Request evidence is no longer a general Data API read surface. The audited
-- snapshot returns only the minimum fields and intentionally omits challenge
-- ids, request/approval hashes, and persisted idempotency keys.
revoke select on table public.role_governance_requests
  from authenticated, service_role;

-- The original request RPC returned the internal request hash. Keep the full
-- transaction core private, but expose only the receipt fields required by
-- the application. The private minimal shim is a definer solely so the
-- invoker wrapper does not require direct EXECUTE on the full core.
drop function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
);

create or replace function private.request_role_governance_change_minimal(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_operation text,
  p_target_role_id uuid,
  p_target_membership_id uuid,
  p_permission_key text,
  p_role_key text,
  p_role_name text,
  p_role_description text,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  status text,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select result.request_id, result.status, result.replayed
  from private.request_role_governance_change_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_operation,
    p_target_role_id,
    p_target_membership_id,
    p_permission_key,
    p_role_key,
    p_role_name,
    p_role_description,
    p_idempotency_key
  ) result;
$$;

create function public.request_role_governance_change(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_operation text,
  p_target_role_id uuid,
  p_target_membership_id uuid,
  p_permission_key text,
  p_role_key text,
  p_role_name text,
  p_role_description text,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  status text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.request_role_governance_change_minimal(
    p_expected_organization_id,
    p_expected_branch_id,
    p_operation,
    p_target_role_id,
    p_target_membership_id,
    p_permission_key,
    p_role_key,
    p_role_name,
    p_role_description,
    p_idempotency_key
  );
$$;

comment on function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) is
  'Creates or exactly replays one tenant-scoped role change request and returns a minimal receipt without internal hashes or AAL2 evidence.';

revoke all on function private.request_role_governance_change_atomic(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.request_role_governance_change_minimal(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.request_role_governance_change_minimal(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
