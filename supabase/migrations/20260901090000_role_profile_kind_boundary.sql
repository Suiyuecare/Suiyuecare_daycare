-- Page 81 hardening: a tenant role assignment is not valid merely because
-- the role and membership share an organization. Reserved family and
-- platform identities must never be projected into the staff audience (or
-- vice versa), including through direct database maintenance.

create or replace function private.profile_kind_accepts_role(
  p_profile_kind public.profile_kind,
  p_role_key text,
  p_role_is_system boolean
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select case
    when p_profile_kind = 'family' then
      p_role_is_system and p_role_key = 'family'
    when p_profile_kind = 'platform' then
      p_role_is_system and p_role_key = 'platform_ops'
    else
      p_role_key not in ('family', 'platform_ops')
  end;
$$;

comment on function private.profile_kind_accepts_role(
  public.profile_kind, text, boolean
) is
  'Closed compatibility rule separating family, platform, and tenant-operational role audiences.';

create or replace function private.validate_membership_role_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_organization_id uuid;
  v_profile_kind public.profile_kind;
  v_role_organization_id uuid;
  v_role_key text;
  v_role_is_system boolean;
begin
  select membership.organization_id, profile.kind
    into v_membership_organization_id, v_profile_kind
  from public.memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.id = new.membership_id;

  if not found then
    raise exception using errcode = '23503', message = 'membership does not exist';
  end if;

  select role.organization_id, role.role_key, role.is_system
    into v_role_organization_id, v_role_key, v_role_is_system
  from public.roles role
  where role.id = new.role_id;

  if not found then
    raise exception using errcode = '23503', message = 'role does not exist';
  end if;

  if v_role_organization_id is not null
     and v_role_organization_id <> v_membership_organization_id then
    raise exception using
      errcode = '23514',
      message = 'tenant role and membership must belong to the same organization';
  end if;

  if not private.profile_kind_accepts_role(
    v_profile_kind,
    v_role_key,
    v_role_is_system
  ) then
    raise exception using
      errcode = '23514',
      message = 'profile kind and role audience are incompatible';
  end if;

  return new;
end;
$$;

create or replace function private.validate_role_request_profile_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_kind public.profile_kind;
  v_role_key text;
  v_role_is_system boolean;
begin
  -- Revocation must remain available to remove any legacy incompatible grant.
  if new.operation <> 'assign_role' then
    return new;
  end if;

  select profile.kind, role.role_key, role.is_system
    into v_profile_kind, v_role_key, v_role_is_system
  from public.memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  cross join public.roles role
  where membership.id = new.target_membership_id
    and role.id = new.target_role_id;

  if not found then
    -- The governed command performs the tenant-scoped not-found checks. This
    -- trigger still fails closed for maintenance or future callers.
    raise exception using errcode = '23503', message = 'role assignment target does not exist';
  end if;

  if not private.profile_kind_accepts_role(
    v_profile_kind,
    v_role_key,
    v_role_is_system
  ) then
    raise exception using
      errcode = '23514',
      message = 'profile kind and role audience are incompatible';
  end if;

  return new;
end;
$$;

drop trigger if exists role_governance_requests_validate_profile_kind
  on public.role_governance_requests;
create trigger role_governance_requests_validate_profile_kind
before insert on public.role_governance_requests
for each row execute function private.validate_role_request_profile_kind();

create or replace function private.prevent_profile_kind_role_mismatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind is not distinct from old.kind then
    return new;
  end if;

  if exists (
    select 1
    from public.memberships membership
    join public.membership_roles assignment
      on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = new.id
      and not private.profile_kind_accepts_role(
        new.kind,
        role.role_key,
        role.is_system
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'profile kind change conflicts with an assigned role audience';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_audience_mismatch on public.profiles;
create trigger profiles_prevent_role_audience_mismatch
before update of kind on public.profiles
for each row execute function private.prevent_profile_kind_role_mismatch();

create or replace function private.prevent_role_identity_mismatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_key is not distinct from old.role_key
     and new.is_system is not distinct from old.is_system then
    return new;
  end if;

  if exists (
    select 1
    from public.membership_roles assignment
    join public.memberships membership
      on membership.id = assignment.membership_id
    join public.profiles profile on profile.id = membership.profile_id
    where assignment.role_id = new.id
      and not private.profile_kind_accepts_role(
        profile.kind,
        new.role_key,
        new.is_system
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'role identity change conflicts with an assigned profile kind';
  end if;

  return new;
end;
$$;

drop trigger if exists roles_prevent_profile_kind_mismatch on public.roles;
create trigger roles_prevent_profile_kind_mismatch
before update of role_key, is_system on public.roles
for each row execute function private.prevent_role_identity_mismatch();

-- Refuse to enable the boundary over already-incompatible production data;
-- deployment must stop for an explicit, audited cleanup instead of silently
-- legitimizing or deleting an existing grant.
do $$
begin
  if exists (
    select 1
    from public.membership_roles assignment
    join public.memberships membership
      on membership.id = assignment.membership_id
    join public.profiles profile on profile.id = membership.profile_id
    join public.roles role on role.id = assignment.role_id
    where not private.profile_kind_accepts_role(
      profile.kind,
      role.role_key,
      role.is_system
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'existing profile and role audiences are incompatible';
  end if;
end;
$$;

revoke all on function private.profile_kind_accepts_role(
  public.profile_kind, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.validate_membership_role_scope()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_role_request_profile_kind()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_profile_kind_role_mismatch()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_role_identity_mismatch()
  from public, anon, authenticated, service_role;
