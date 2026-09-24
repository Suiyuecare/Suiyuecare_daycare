-- AAL1 employees cannot read tenant context, including active_memberships.
-- This self-only boolean is narrowly available before MFA and does not expose
-- profile, membership, user, or session rows or grant business-data access.
create function private.can_begin_staff_mfa()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claims jsonb := auth.jwt();
  v_user_id uuid;
  v_session_id uuid;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
begin
  if v_claims is null
     or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or coalesce(v_claims ->> 'aal', '') not in ('aal1', 'aal2')
     or coalesce(v_claims ->> 'is_anonymous', 'false') <> 'false'
     or coalesce(v_claims ->> 'session_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_claims ->> 'iat', '') !~ '^[0-9]{1,11}$'
     or coalesce(v_claims ->> 'exp', '') !~ '^[0-9]{1,11}$' then
    return false;
  end if;

  begin
    v_user_id := auth.uid();
    v_session_id := (v_claims ->> 'session_id')::uuid;
    v_issued_at := to_timestamp((v_claims ->> 'iat')::double precision);
    v_expires_at := to_timestamp((v_claims ->> 'exp')::double precision);
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    return false;
  end;

  if v_user_id is null or v_session_id is null
     or v_issued_at is null or v_expires_at is null
     or v_issued_at < v_now - interval '1 hour'
     or v_issued_at > v_now + interval '1 minute'
     or v_expires_at <= v_now or v_expires_at <= v_issued_at then
    return false;
  end if;

  return exists (
    select 1
    from auth.users account
    join auth.sessions session on session.user_id = account.id
    join public.profiles profile on profile.id = account.id
    join public.memberships membership on membership.profile_id = profile.id
    join public.organizations organization on organization.id = membership.organization_id
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where account.id = v_user_id
      and account.is_anonymous = false
      and account.deleted_at is null
      and account.email_confirmed_at is not null
      and (account.banned_until is null or account.banned_until <= v_now)
      -- Supabase revocation removes auth.sessions rows; there is no revoked_at.
      and session.id = v_session_id
      and (session.not_after is null or session.not_after > v_now)
      and session.created_at is not null
      and session.created_at <= v_now
      and v_issued_at >= session.created_at - interval '1 minute'
      and profile.is_active
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and organization.is_active
      and assignment.assigned_at <= v_now
      and role.is_active
      and role.role_key not in ('family', 'platform_ops')
      and (role.organization_id is null or role.organization_id = membership.organization_id)
      and exists (
        select 1 from public.branches branch
        where branch.organization_id = membership.organization_id
          and branch.is_active
          and (membership.branch_id is null or branch.id = membership.branch_id)
      )
  );
end;
$$;

alter function private.can_begin_staff_mfa() owner to postgres;
revoke all on function private.can_begin_staff_mfa() from public, anon, authenticated, service_role;
grant execute on function private.can_begin_staff_mfa() to authenticated;

create function public.can_begin_staff_mfa()
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.can_begin_staff_mfa();
$$;

revoke all on function public.can_begin_staff_mfa() from public, anon, authenticated, service_role;
grant execute on function public.can_begin_staff_mfa() to authenticated;

comment on function public.can_begin_staff_mfa() is
  'Self-only pre-MFA eligibility boolean. Does not return tenant context, confer AAL2, or authorize business operations.';
