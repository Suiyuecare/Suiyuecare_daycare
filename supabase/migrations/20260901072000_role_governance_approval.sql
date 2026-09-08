-- Page 81: governed role changes. No application session can mutate role
-- grants directly; every expansion or revocation is requested by one recent
-- AAL2 actor and applied atomically by a different recent AAL2 approver.

create table public.role_governance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  operation text not null,
  target_role_id uuid not null,
  target_membership_id uuid,
  target_permission_id bigint,
  role_key text,
  role_name text,
  role_description text,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  requested_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  request_idempotency_key uuid not null,
  request_hash text not null,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approved_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  approval_idempotency_key uuid,
  approval_hash text,
  applied_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint role_governance_requests_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint role_governance_requests_operation_check check (
    operation in (
      'create_role',
      'grant_permission',
      'revoke_permission',
      'assign_role',
      'revoke_role',
      'deactivate_role'
    )
  ),
  constraint role_governance_requests_status_check
    check (status in ('pending', 'approved')),
  constraint role_governance_requests_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint role_governance_requests_create_fields_check check (
    (
      operation = 'create_role'
      and role_key is not null
      and role_name is not null
      and target_membership_id is null
      and target_permission_id is null
    )
    or (
      operation in ('grant_permission', 'revoke_permission')
      and target_membership_id is null
      and target_permission_id is not null
      and role_key is null
      and role_name is null
      and role_description is null
    )
    or (
      operation in ('assign_role', 'revoke_role')
      and target_membership_id is not null
      and target_permission_id is null
      and role_key is null
      and role_name is null
      and role_description is null
    )
    or (
      operation = 'deactivate_role'
      and target_membership_id is null
      and target_permission_id is null
      and role_key is null
      and role_name is null
      and role_description is null
    )
  ),
  constraint role_governance_requests_approval_check check (
    (
      status = 'pending'
      and approved_by is null
      and approved_at is null
      and approved_reauth_challenge_id is null
      and approval_idempotency_key is null
      and approval_hash is null
      and applied_at is null
    )
    or (
      status = 'approved'
      and approved_by is not null
      and approved_by <> requested_by
      and approved_at is not null
      and approved_reauth_challenge_id is not null
      and approved_reauth_challenge_id <> requested_reauth_challenge_id
      and approval_idempotency_key is not null
      and approval_hash ~ '^[a-f0-9]{64}$'
      and applied_at is not null
    )
  ),
  constraint role_governance_requests_requester_idempotency_key
    unique (organization_id, requested_by, request_idempotency_key)
);

comment on table public.role_governance_requests is
  'Immutable two-person approval evidence for tenant role, permission, and membership-role changes.';

create index role_governance_requests_queue_idx
  on public.role_governance_requests (
    organization_id,
    branch_id,
    status,
    requested_at desc
  );
create index role_governance_requests_target_role_idx
  on public.role_governance_requests (organization_id, target_role_id, requested_at desc);
create index role_governance_requests_requested_challenge_idx
  on public.role_governance_requests (requested_reauth_challenge_id);
create index role_governance_requests_approved_challenge_idx
  on public.role_governance_requests (approved_reauth_challenge_id)
  where approved_reauth_challenge_id is not null;
create unique index role_governance_requests_approval_idempotency_idx
  on public.role_governance_requests (
    organization_id,
    approved_by,
    approval_idempotency_key
  )
  where approved_by is not null and approval_idempotency_key is not null;

create or replace function private.protect_role_governance_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'role governance requests are immutable';
  end if;

  if old.status <> 'pending'
     or new.status <> 'approved'
     or new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.branch_id is distinct from old.branch_id
     or new.operation is distinct from old.operation
     or new.target_role_id is distinct from old.target_role_id
     or new.target_membership_id is distinct from old.target_membership_id
     or new.target_permission_id is distinct from old.target_permission_id
     or new.role_key is distinct from old.role_key
     or new.role_name is distinct from old.role_name
     or new.role_description is distinct from old.role_description
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at
     or new.requested_reauth_challenge_id is distinct from old.requested_reauth_challenge_id
     or new.request_idempotency_key is distinct from old.request_idempotency_key
     or new.request_hash is distinct from old.request_hash
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'role governance request identity and evidence are immutable';
  end if;

  return new;
end;
$$;

create trigger role_governance_requests_protect
before update or delete on public.role_governance_requests
for each row execute function private.protect_role_governance_request();

create trigger role_governance_requests_set_updated_at
before update on public.role_governance_requests
for each row execute function private.set_updated_at();

create trigger role_governance_requests_audit_row_change
after insert or update or delete on public.role_governance_requests
for each row execute function private.audit_row_change();

alter table public.role_governance_requests enable row level security;
alter table public.role_governance_requests force row level security;

create policy role_governance_requests_select
on public.role_governance_requests for select
to authenticated
using (
  (select private.is_active_member(organization_id, branch_id))
  and (
    requested_by = (select auth.uid())
    or (select private.has_permission(organization_id, null, 'roles.manage'))
  )
);

create or replace function private.request_role_governance_change_atomic(
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
  request_hash text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz;
  v_operation text := btrim(p_operation);
  v_permission_key text := nullif(btrim(p_permission_key), '');
  v_role_key text := nullif(btrim(p_role_key), '');
  v_role_name text := nullif(btrim(p_role_name), '');
  v_role_description text := nullif(btrim(p_role_description), '');
  v_permission_id bigint;
  v_role public.roles%rowtype;
  v_membership public.memberships%rowtype;
  v_challenge private.reauth_challenges%rowtype;
  v_existing public.role_governance_requests%rowtype;
  v_created public.role_governance_requests%rowtype;
  v_request_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_target_role_id is null
     or p_idempotency_key is null
     or p_operation is null
     or v_operation not in (
       'create_role', 'grant_permission', 'revoke_permission',
       'assign_role', 'revoke_role', 'deactivate_role'
     ) then
    raise exception using errcode = '22023', message = 'valid role change request fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       null,
       'roles.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'roles.manage'
     ))
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
     ) then
    raise exception using errcode = '42501', message = 'role change request is not permitted';
  end if;

  if v_operation = 'create_role' then
    if p_target_membership_id is not null
       or v_permission_key is not null
       or v_role_key is null
       or v_role_key !~ '^[a-z][a-z0-9_]{1,63}$'
       or v_role_name is null
       or char_length(v_role_name) > 120
       or (v_role_description is not null and char_length(v_role_description) > 1000)
       then
      raise exception using errcode = '22023', message = 'invalid tenant role creation request';
    end if;
  else
    if v_role_key is not null or v_role_name is not null or v_role_description is not null then
      raise exception using errcode = '22023', message = 'role metadata is allowed only for role creation';
    end if;

    select role.* into v_role
    from public.roles role
    where role.id = p_target_role_id
      and (
        (v_operation in ('assign_role', 'revoke_role') and (
          role.is_system
          or role.organization_id = p_expected_organization_id
        ))
        or (
          v_operation in ('grant_permission', 'revoke_permission', 'deactivate_role')
          and not role.is_system
          and role.organization_id = p_expected_organization_id
        )
      )
    for share;

    if not found then
      raise exception using errcode = '42501', message = 'target role is outside the governed tenant scope';
    end if;
  end if;

  if v_operation in ('grant_permission', 'revoke_permission') then
    if p_target_membership_id is not null or v_permission_key is null then
      raise exception using errcode = '22023', message = 'permission change target is invalid';
    end if;

    select permission.id into v_permission_id
    from public.permissions permission
    where permission.permission_key = v_permission_key;

    if not found then
      raise exception using errcode = '22023', message = 'unknown permission key';
    end if;

  elsif v_operation in ('assign_role', 'revoke_role') then
    if p_target_membership_id is null or v_permission_key is not null then
      raise exception using errcode = '22023', message = 'membership role target is invalid';
    end if;

    select membership.* into v_membership
    from public.memberships membership
    where membership.id = p_target_membership_id
      and membership.organization_id = p_expected_organization_id
      and (
        membership.branch_id is null
        or membership.branch_id = p_expected_branch_id
      )
    for share;

    if not found then
      raise exception using errcode = '42501', message = 'target membership is outside the selected tenant scope';
    end if;

  elsif v_operation = 'deactivate_role' then
    if p_target_membership_id is not null or v_permission_key is not null then
      raise exception using errcode = '22023', message = 'role deactivation target is invalid';
    end if;
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'operation', v_operation,
    'target_role_id', p_target_role_id,
    'target_membership_id', p_target_membership_id,
    'target_permission_id', v_permission_id,
    'role_key', v_role_key,
    'role_name', v_role_name,
    'role_description', v_role_description,
    'requested_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'role-request:' || p_expected_organization_id::text || ':' ||
    v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select request.* into v_existing
  from public.role_governance_requests request
  where request.organization_id = p_expected_organization_id
    and request.requested_by = v_actor
    and request.request_idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.branch_id <> p_expected_branch_id
       or v_existing.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505', message = 'role change request idempotency conflict';
    end if;

    return query select v_existing.id, v_existing.status, v_existing.request_hash, true;
    return;
  end if;

  -- Mutable target state is checked only after exact replay. A successfully
  -- applied request changes this state by definition and must remain safely
  -- replayable without being mistaken for a new conflicting request.
  if v_operation = 'create_role' then
    if exists (select 1 from public.roles role where role.id = p_target_role_id)
       or exists (
         select 1 from public.roles role
         where role.organization_id = p_expected_organization_id
           and role.role_key = v_role_key
       ) then
      raise exception using errcode = '23505', message = 'tenant role already exists';
    end if;
  elsif v_operation = 'grant_permission' then
    if not v_role.is_active then
      raise exception using errcode = '23514', message = 'inactive roles cannot receive new permissions';
    end if;
    if exists (
      select 1 from public.role_permissions grant_row
      where grant_row.role_id = p_target_role_id
        and grant_row.permission_id = v_permission_id
    ) then
      raise exception using errcode = '23505', message = 'permission is already granted to the role';
    end if;
  elsif v_operation = 'revoke_permission' then
    if not exists (
      select 1 from public.role_permissions grant_row
      where grant_row.role_id = p_target_role_id
        and grant_row.permission_id = v_permission_id
    ) then
      raise exception using errcode = '22023', message = 'permission is not granted to the role';
    end if;
  elsif v_operation = 'assign_role' then
    if not v_role.is_active
       or v_membership.status not in ('invited', 'active')
       or (v_membership.ends_at is not null and v_membership.ends_at <= clock_timestamp()) then
      raise exception using errcode = '23514', message = 'inactive roles or memberships cannot receive assignments';
    end if;
    if exists (
      select 1 from public.membership_roles assignment
      where assignment.membership_id = p_target_membership_id
        and assignment.role_id = p_target_role_id
    ) then
      raise exception using errcode = '23505', message = 'role is already assigned to the membership';
    end if;
  elsif v_operation = 'revoke_role' then
    if not exists (
      select 1 from public.membership_roles assignment
      where assignment.membership_id = p_target_membership_id
        and assignment.role_id = p_target_role_id
    ) then
      raise exception using errcode = '22023', message = 'role is not assigned to the membership';
    end if;
  elsif v_operation = 'deactivate_role' and not v_role.is_active then
    raise exception using errcode = '22023', message = 'role is already inactive';
  end if;

  -- Locks above may wait. Recheck current authority and immutable step-up
  -- evidence immediately before authoring the governance request.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(p_expected_organization_id, null, 'roles.manage'))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'roles.manage'
     )) then
    raise exception using errcode = '42501', message = 'role change request authority expired';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for role governance';
  end;

  select challenge.* into v_challenge
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = v_actor
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  v_now := clock_timestamp();
  if v_challenge.id is null
     or v_challenge.factor_verified_at is null
     or v_challenge.factor_verified_at < v_now - interval '15 minutes'
     or v_challenge.factor_verified_at > v_now + interval '1 minute' then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for role governance';
  end if;

  insert into public.role_governance_requests (
    organization_id,
    branch_id,
    operation,
    target_role_id,
    target_membership_id,
    target_permission_id,
    role_key,
    role_name,
    role_description,
    requested_by,
    requested_at,
    requested_reauth_challenge_id,
    request_idempotency_key,
    request_hash
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_operation,
    p_target_role_id,
    p_target_membership_id,
    v_permission_id,
    v_role_key,
    v_role_name,
    v_role_description,
    v_actor,
    v_now,
    v_challenge.id,
    p_idempotency_key,
    v_request_hash
  )
  returning * into v_created;

  return query select v_created.id, v_created.status, v_created.request_hash, false;
end;
$$;

create or replace function public.request_role_governance_change(
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
  request_hash text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.request_role_governance_change_atomic(
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

create or replace function private.approve_role_governance_change_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  status text,
  applied_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz;
  v_request public.role_governance_requests%rowtype;
  v_role public.roles%rowtype;
  v_membership public.memberships%rowtype;
  v_challenge private.reauth_challenges%rowtype;
  v_approval_hash text;
  v_affected integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_request_id is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'valid role approval fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(p_expected_organization_id, null, 'roles.manage'))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'roles.manage'
     )) then
    raise exception using errcode = '42501', message = 'role change approval is not permitted';
  end if;

  select request.* into v_request
  from public.role_governance_requests request
  where request.id = p_request_id
    and request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'role change request is outside the selected tenant context';
  end if;

  v_approval_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'request_id', v_request.id,
    'request_hash', v_request.request_hash,
    'approved_by', v_actor,
    'approval_idempotency_key', p_idempotency_key
  )::text, 'UTF8')), 'hex');

  if v_request.status = 'approved' then
    if v_request.approved_by = v_actor
       and v_request.approval_idempotency_key = p_idempotency_key
       and v_request.approval_hash = v_approval_hash then
      return query select v_request.id, v_request.status, v_request.applied_at, true;
      return;
    end if;
    raise exception using errcode = '23505', message = 'role change request was already decided';
  end if;

  if v_request.requested_by = v_actor then
    raise exception using errcode = '42501', message = 'role changes require an independent second approver';
  end if;

  -- Lock and revalidate every target in the same transaction that applies it.
  if v_request.operation = 'create_role' then
    if exists (
      select 1 from public.roles role
      where role.id = v_request.target_role_id
         or (
           role.organization_id = v_request.organization_id
           and role.role_key = v_request.role_key
         )
    ) then
      raise exception using errcode = '23505', message = 'requested tenant role now conflicts with an existing role';
    end if;
  else
    select role.* into v_role
    from public.roles role
    where role.id = v_request.target_role_id
      and (
        (
          v_request.operation in ('assign_role', 'revoke_role')
          and (role.is_system or role.organization_id = v_request.organization_id)
        )
        or (
          v_request.operation in ('grant_permission', 'revoke_permission', 'deactivate_role')
          and not role.is_system
          and role.organization_id = v_request.organization_id
        )
      )
    for update;

    if not found then
      raise exception using errcode = '42501', message = 'target role left the governed tenant scope';
    end if;

    if v_request.operation in ('grant_permission', 'assign_role')
       and not v_role.is_active then
      raise exception using errcode = '23514', message = 'inactive roles cannot receive new authority';
    end if;
  end if;

  if v_request.operation in ('assign_role', 'revoke_role') then
    select membership.* into v_membership
    from public.memberships membership
    where membership.id = v_request.target_membership_id
      and membership.organization_id = v_request.organization_id
      and (
        membership.branch_id is null
        or membership.branch_id = v_request.branch_id
      )
      and membership.status in ('invited', 'active')
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
    for update;

    if not found then
      raise exception using errcode = '42501', message = 'target membership left the selected tenant scope';
    end if;
  end if;

  -- Target locks can wait, so authorization and step-up freshness are checked
  -- again before the exact evidence row is captured and any grant changes.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(v_request.organization_id, null, 'roles.manage'))
     or not (select private.has_permission(
       v_request.organization_id,
       v_request.branch_id,
       'roles.manage'
     )) then
    raise exception using errcode = '42501', message = 'role change approval authority expired';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for role governance';
  end;

  select challenge.* into v_challenge
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = v_actor
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  v_now := clock_timestamp();
  if v_challenge.id is null
     or v_challenge.id = v_request.requested_reauth_challenge_id
     or v_challenge.factor_verified_at is null
     or v_challenge.factor_verified_at < v_now - interval '15 minutes'
     or v_challenge.factor_verified_at > v_now + interval '1 minute' then
    raise exception using errcode = '42501', message = 'independent immutable AAL2 evidence is required for role approval';
  end if;

  if v_request.operation = 'create_role' then
    insert into public.roles (
      id, organization_id, role_key, name, description, is_system, is_active
    ) values (
      v_request.target_role_id,
      v_request.organization_id,
      v_request.role_key,
      v_request.role_name,
      v_request.role_description,
      false,
      true
    );
  elsif v_request.operation = 'grant_permission' then
    insert into public.role_permissions (
      role_id, permission_id, granted_at, granted_by
    ) values (
      v_request.target_role_id,
      v_request.target_permission_id,
      v_now,
      v_actor
    );
  elsif v_request.operation = 'revoke_permission' then
    delete from public.role_permissions grant_row
    where grant_row.role_id = v_request.target_role_id
      and grant_row.permission_id = v_request.target_permission_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '40001', message = 'permission grant changed before approval';
    end if;
  elsif v_request.operation = 'assign_role' then
    insert into public.membership_roles (
      membership_id, role_id, assigned_at, assigned_by
    ) values (
      v_request.target_membership_id,
      v_request.target_role_id,
      v_now,
      v_actor
    );
  elsif v_request.operation = 'revoke_role' then
    delete from public.membership_roles assignment
    where assignment.membership_id = v_request.target_membership_id
      and assignment.role_id = v_request.target_role_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '40001', message = 'role assignment changed before approval';
    end if;
  elsif v_request.operation = 'deactivate_role' then
    update public.roles role
    set is_active = false,
        updated_at = v_now
    where role.id = v_request.target_role_id
      and role.organization_id = v_request.organization_id
      and not role.is_system
      and role.is_active;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '40001', message = 'role activation state changed before approval';
    end if;
  end if;

  update public.role_governance_requests request
  set status = 'approved',
      approved_by = v_actor,
      approved_at = v_now,
      approved_reauth_challenge_id = v_challenge.id,
      approval_idempotency_key = p_idempotency_key,
      approval_hash = v_approval_hash,
      applied_at = v_now,
      updated_at = v_now
  where request.id = v_request.id
  returning * into v_request;

  return query select v_request.id, v_request.status, v_request.applied_at, false;
end;
$$;

create or replace function public.approve_role_governance_change(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  status text,
  applied_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.approve_role_governance_change_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_request_id,
    p_idempotency_key
  );
$$;

comment on function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) is
  'Creates or exactly replays one tenant-scoped role change request with immutable requester AAL2 evidence.';
comment on function public.approve_role_governance_change(uuid, uuid, uuid, uuid) is
  'Applies one pending role change atomically after an independent current approver supplies immutable AAL2 evidence.';

revoke all on function private.protect_role_governance_request()
  from public, anon, authenticated, service_role;
revoke all on function private.request_role_governance_change_atomic(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.approve_role_governance_change_atomic(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.approve_role_governance_change(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.request_role_governance_change_atomic(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function private.approve_role_governance_change_atomic(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.request_role_governance_change(
  uuid, uuid, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function public.approve_role_governance_change(uuid, uuid, uuid, uuid)
  to authenticated;

grant select on table public.role_governance_requests to authenticated;
revoke insert, update, delete on table public.role_governance_requests
  from authenticated, service_role;

-- Close the original self-escalation path. Read access remains RLS-filtered;
-- every mutation now passes through the two-person request/approval workflow.
revoke insert, update, delete on table public.roles
  from authenticated, service_role;
revoke insert, update, delete on table public.role_permissions
  from authenticated, service_role;
revoke insert, update, delete on table public.membership_roles
  from authenticated, service_role;
