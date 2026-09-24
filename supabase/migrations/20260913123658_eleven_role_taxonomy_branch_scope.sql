-- Eleven default role categories. Existing role IDs/keys, memberships, clinical
-- records and historical audit events are not reassigned or rewritten.
-- Run this migration before deploying an app that selects branch_director.

begin;

-- Serialize the preflight and guard installation with role/membership writes.
-- Fail promptly on a busy database instead of admitting a grant between them.
-- Own the transaction explicitly: do not assume the CLI wraps statements.
set local lock_timeout = '5s';
lock table public.roles, public.memberships, public.membership_roles,
  public.role_governance_requests in share row exclusive mode;

-- Abort before changing templates when old single-site grants are unscoped.
-- An operator must explicitly revoke/reapprove those grants; never infer a site.
do $$
begin
  if exists (
    select 1 from public.membership_roles assignment
    join public.memberships membership on membership.id = assignment.membership_id
    join public.roles role on role.id = assignment.role_id
    where role.is_system
      and role.role_key in ('branch_supervisor', 'branch_director')
      and membership.branch_id is null
  ) then
    raise exception using errcode = '23514',
      message = 'existing single-branch role assignment requires explicit branch review';
  end if;
end;
$$;

update public.roles role
set name = template.name
from (values
  ('organization_manager', '全機構管理員（多點管理）'),
  ('branch_supervisor', '機構管理員（單點管理）'),
  ('nurse', '護理人員'),
  ('case_manager_social_worker', '社工人員'),
  ('care_worker', '照顧服務員'),
  ('transport_driver', '駕駛人員'),
  ('professional', '專業人員'),
  ('finance_claims', '財務人員'),
  ('platform_ops', '系統維護人員'),
  ('family', '家屬／關係人')
) as template(role_key, name)
where role.is_system and role.organization_id is null
  and role.role_key = template.role_key and role.name is distinct from template.name;

insert into public.roles (id, role_key, name, description, is_system)
values (
  '10000000-0000-4000-8000-000000000011', 'branch_director', '機構主任',
  'Single-branch read-only operational oversight. Nursing or social-work duties require separate approved role assignments and qualification checks.',
  true
);

-- Explicit read-only allowlist, not a clone of a managerial/clinical template.
-- No users receive this role; additional nursing/social-work roles are NEVER
-- assigned automatically, nor is a professional qualification inferred.
insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000011'::uuid, permission.id
from public.permissions permission
where permission.permission_key in (
  'clients.read', 'clients.view_all', 'attendance.read',
  'care_records.read', 'services.read', 'notifications.read'
);

create or replace function private.validate_membership_role_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_organization_id uuid;
  v_membership_branch_id uuid;
  v_profile_kind public.profile_kind;
  v_role_organization_id uuid;
  v_role_key text;
  v_role_is_system boolean;
begin
  -- Serialize role assignment with membership/role identity changes. The final
  -- assignment trigger also runs after a pending request has been approved.
  select membership.organization_id, membership.branch_id, profile.kind
    into v_membership_organization_id, v_membership_branch_id, v_profile_kind
  from public.memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.id = new.membership_id
  for share of membership, profile;

  if not found then
    raise exception using errcode = '23503', message = 'membership does not exist';
  end if;

  select role.organization_id, role.role_key, role.is_system
    into v_role_organization_id, v_role_key, v_role_is_system
  from public.roles role
  where role.id = new.role_id
  for share;

  if not found then
    raise exception using errcode = '23503', message = 'role does not exist';
  end if;
  if v_role_organization_id is not null
     and v_role_organization_id <> v_membership_organization_id then
    raise exception using errcode = '23514',
      message = 'tenant role and membership must belong to the same organization';
  end if;
  if not private.profile_kind_accepts_role(v_profile_kind, v_role_key, v_role_is_system) then
    raise exception using errcode = '23514',
      message = 'profile kind and role audience are incompatible';
  end if;
  if v_role_is_system and v_role_key in ('branch_supervisor', 'branch_director')
     and v_membership_branch_id is null then
    raise exception using errcode = '23514',
      message = 'single-branch role requires a branch-scoped membership';
  end if;
  return new;
end;
$$;

create function private.validate_single_branch_role_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Revocation must remain possible for any legacy nonconforming grant.
  if new.operation <> 'assign_role' then return new; end if;
  if exists (
    select 1 from public.memberships membership
    cross join public.roles role
    where membership.id = new.target_membership_id
      and role.id = new.target_role_id and role.is_system
      and role.role_key in ('branch_supervisor', 'branch_director')
      and membership.branch_id is null
  ) then
    raise exception using errcode = '23514',
      message = 'single-branch role requires a branch-scoped membership';
  end if;
  return new;
end;
$$;

create trigger role_governance_requests_validate_single_branch
before insert or update of operation, target_role_id, target_membership_id
on public.role_governance_requests
for each row execute function private.validate_single_branch_role_request();

create function private.prevent_single_branch_role_identity_mismatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_system and new.role_key in ('branch_supervisor', 'branch_director')
     and exists (
       select 1 from public.membership_roles assignment
       join public.memberships membership on membership.id = assignment.membership_id
       where assignment.role_id = new.id and membership.branch_id is null
     ) then
    raise exception using errcode = '23514',
      message = 'role identity change conflicts with single-branch membership scope';
  end if;
  return new;
end;
$$;

create trigger roles_prevent_single_branch_identity_mismatch
before update of role_key, is_system on public.roles
for each row execute function private.prevent_single_branch_role_identity_mismatch();

-- memberships_prevent_key_change already makes organization_id, branch_id and
-- profile_id immutable. Moving a person therefore requires a distinct scoped
-- membership and an explicit role approval; do not weaken that existing guard.
-- These table-reading invariant triggers must see all rows, including owner
-- maintenance; they are private and cannot be invoked as application RPCs.
revoke all on function private.validate_membership_role_scope(),
  private.validate_single_branch_role_request(),
  private.prevent_single_branch_role_identity_mismatch()
from public, anon, authenticated, service_role;

commit;
