-- Restricted executive rollout: authentication admission is an additional
-- boundary, never a replacement for tenant, role, assignment, AAL2 or signature
-- rules. No real email, subject, Auth UUID, or enabled allowlist is seeded.
-- The database owner provisions one verified account through an audited,
-- separate operation. API roles cannot provision or change this allowlist.
create table private.executive_access_policy (
  id boolean primary key default true check (id),
  allowed_user_id uuid not null references auth.users(id) on delete restrict,
  allowed_email text not null check (
    allowed_email = lower(btrim(allowed_email))
    and char_length(allowed_email) between 3 and 254
    and allowed_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  google_subject text not null check (
    google_subject = btrim(google_subject)
    and char_length(google_subject) between 1 and 255
    and google_subject !~ '[^ -~]'
  ),
  enabled boolean not null default false,
  approved_at timestamptz not null default clock_timestamp(),
  approval_reference text not null check (
    char_length(btrim(approval_reference)) between 1 and 240
    and approval_reference !~ '[[:cntrl:]]'
  )
);
alter table private.executive_access_policy enable row level security;
alter table private.executive_access_policy force row level security;
revoke all on table private.executive_access_policy from public, anon, authenticated, service_role;
create trigger executive_access_policy_audit
after insert or update or delete on private.executive_access_policy
for each row execute function private.audit_row_change();

create function private.is_executive_login_allowed()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claims jsonb := auth.jwt();
  v_user_id uuid;
  v_session_id uuid;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
  v_entry jsonb;
  v_method text;
  v_amr_time bigint;
  v_has_oauth boolean := false;
  v_has_totp boolean := false;
  v_policy private.executive_access_policy%rowtype;
begin
  if jsonb_typeof(v_claims) is distinct from 'object'
    or v_claims->>'role' is distinct from 'authenticated'
    or v_claims->>'aud' is distinct from 'authenticated'
    or v_claims->'is_anonymous' is distinct from 'false'::jsonb
    or coalesce(v_claims->>'aal','') not in ('aal1','aal2')
    or v_claims ? 'client_id'
    or coalesce(v_claims->>'sub','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_claims->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(v_claims->'iat') is distinct from 'number'
    or jsonb_typeof(v_claims->'exp') is distinct from 'number'
    or coalesce(v_claims->>'iat','') !~ '^[0-9]{1,11}$'
    or coalesce(v_claims->>'exp','') !~ '^[0-9]{1,11}$'
    or jsonb_typeof(v_claims->'amr') is distinct from 'array' then
    return false;
  end if;
  v_user_id := auth.uid();
  v_session_id := (v_claims->>'session_id')::uuid;
  v_issued_at := to_timestamp((v_claims->>'iat')::double precision);
  v_expires_at := to_timestamp((v_claims->>'exp')::double precision);
  if v_user_id is null or v_issued_at < v_now - interval '1 hour'
    or v_issued_at > v_now + interval '1 minute'
    or v_expires_at <= v_now or v_expires_at <= v_issued_at
    or jsonb_array_length(v_claims->'amr') not between 1 and 8 then return false; end if;

  -- A missing, disabled, malformed or unexpectedly duplicated policy denies.
  -- There is deliberately no production enforcement/test-mode switch.
  if (select count(*) from private.executive_access_policy) <> 1 then return false; end if;
  select * into v_policy from private.executive_access_policy where id and enabled;
  if not found or v_policy.allowed_user_id <> v_user_id
    or v_policy.approved_at > v_now
    or lower(coalesce(v_claims->>'email','')) <> v_policy.allowed_email then return false; end if;

  if not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=v_user_id and not u.is_anonymous and u.deleted_at is null
      and u.email_confirmed_at is not null
      and lower(coalesce(u.email,''))=v_policy.allowed_email
      and (u.banned_until is null or u.banned_until<=v_now)
      and s.id=v_session_id and s.created_at is not null and s.created_at<=v_now
      and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>v_now)
      and v_issued_at>=s.created_at-interval '1 minute'
      and (v_claims->>'aal'<>'aal2' or s.aal::text='aal2')
  ) then return false; end if;

  -- Supabase-owned identities, not editable raw_user_meta_data. A residual
  -- email identity from supported admin pre-provisioning is not a login grant.
  -- Other OAuth providers and manual identity linking must remain disabled.
  if (select count(*) from auth.identities i where i.user_id=v_user_id and i.provider='google') <> 1
    or exists (select 1 from auth.identities i where i.user_id=v_user_id and i.provider not in ('google','email'))
    or not exists (
      select 1 from auth.identities i where i.user_id=v_user_id and i.provider='google'
        and i.provider_id=v_policy.google_subject
        and i.identity_data->>'sub'=v_policy.google_subject
        and lower(coalesce(i.identity_data->>'email',''))=v_policy.allowed_email
        and i.identity_data->'email_verified'='true'::jsonb
    ) then return false; end if;

  -- AMR is attached to this actual Auth session. A linked Google identity or
  -- app_metadata.provider alone cannot turn a password/OTP session into OAuth.
  -- Auth currently derives JWT AMR timestamps from mfa_amr_claims.updated_at.
  for v_entry in select value from jsonb_array_elements(v_claims->'amr') loop
    v_method := v_entry->>'method';
    if jsonb_typeof(v_entry) is distinct from 'object'
      or coalesce(v_method,'') not in ('oauth','totp','token_refresh')
      or jsonb_typeof(v_entry->'timestamp') is distinct from 'number'
      or coalesce(v_entry->>'timestamp','') !~ '^[0-9]{1,11}$' then return false; end if;
    v_amr_time := (v_entry->>'timestamp')::bigint;
    if to_timestamp(v_amr_time)>v_now+interval '1 minute' or not exists (
      select 1 from auth.mfa_amr_claims a
      where a.session_id=v_session_id and a.authentication_method=v_method
        and floor(extract(epoch from a.updated_at))=v_amr_time
    ) then return false; end if;
    v_has_oauth := v_has_oauth or v_method='oauth';
    v_has_totp := v_has_totp or v_method='totp';
  end loop;
  if not v_has_oauth or (v_claims->>'aal'='aal2' and not v_has_totp)
    or exists (select 1 from auth.mfa_amr_claims a where a.session_id=v_session_id
      and a.authentication_method not in ('oauth','totp','token_refresh')) then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  return false;
end;
$$;
alter function private.is_executive_login_allowed() owner to postgres;
revoke all on function private.is_executive_login_allowed() from public, anon, authenticated, service_role;
grant execute on function private.is_executive_login_allowed() to authenticated;

create function public.is_executive_login_allowed()
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.is_executive_login_allowed();
$$;
revoke all on function public.is_executive_login_allowed() from public, anon, authenticated, service_role;
grant execute on function public.is_executive_login_allowed() to authenticated;
comment on function public.is_executive_login_allowed() is
  'Self-only executive Google session admission. Does not grant a role, AAL2, clinical qualification, or tenant scope.';

-- Existing authority function OIDs, signatures and ACLs are preserved below.
-- Do not rename them: views and policies may hold their OIDs as dependencies.

-- Add admission before the unchanged is_active_user business predicate.
create or replace function private.is_active_user()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select case when private.is_executive_login_allowed() then (
select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active
        and (
          p.kind = 'family'
          or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
        )
    )
  ) else false end;
$$;

-- Add admission before the unchanged staff_management_current_authority business predicate.
create or replace function private.staff_management_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean language sql volatile security definer set search_path = '' as $$
  select case when private.is_executive_login_allowed() then (
select p_expected_organization_id is not null
    and p_expected_branch_id is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.profiles profile
      join public.memberships membership on membership.profile_id = profile.id
      join public.membership_roles membership_role
        on membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id and role.is_active
      join public.role_permissions role_permission
        on role_permission.role_id = role.id
      join public.permissions permission on permission.id = role_permission.permission_id
      where profile.id = auth.uid() and profile.is_active
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
        and membership.organization_id = p_expected_organization_id
        and membership.status = 'active'
        and membership.starts_at <= clock_timestamp()
        and (membership.ends_at is null or membership.ends_at > clock_timestamp())
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and (role.organization_id is null or role.organization_id = p_expected_organization_id)
        and permission.permission_key = p_permission
    )
  ) else false end;
$$;

-- Add admission before the unchanged nursing_authority business predicate.
create or replace function private.nursing_authority(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
  select case when private.is_executive_login_allowed() then (
select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
    and p_permission in ('nursing_assessments.read','nursing_assessments.manage','nursing_assessments.sign')
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind='staff')
    and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
      where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
    and private.nursing_permission(p_org,p_branch,'clients.read')
    and private.nursing_permission(p_org,p_branch,'nursing_assessments.read')
    and private.nursing_permission(p_org,p_branch,p_permission)
    and (p_client is null or exists(select 1 from public.clients c where c.id=p_client
      and c.organization_id=p_org and c.branch_id=p_branch
      and (private.nursing_permission(p_org,p_branch,'clients.view_all') or exists (
        select 1 from public.client_assignments a where a.client_id=c.id
          and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
          and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())
      ))))
    and (p_permission='nursing_assessments.read' or (
      exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
        join public.roles r on r.id=mr.role_id where m.profile_id=auth.uid()
        and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
        and m.status='active' and m.starts_at<=clock_timestamp()
        and (m.ends_at is null or m.ends_at>clock_timestamp())
        and r.is_system and r.is_active and r.role_key='nurse')
      and exists(select 1 from public.client_assignments a where a.client_id=p_client
        and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
        and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))
    )),false)
  ) else false end;
$$;

-- Add admission before the unchanged body_assessment_authority business predicate.
create or replace function private.body_assessment_authority(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
  select case when private.is_executive_login_allowed() then (
select auth.uid() is not null and coalesce(auth.jwt()->>'aal','')='aal2'
  and p_permission in ('body_assessments.read','body_assessments.manage','body_assessments.sign')
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind in ('staff','professional'))
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and private.body_assessment_permission(p_org,p_branch,'clients.read') and private.body_assessment_permission(p_org,p_branch,'body_assessments.read')
  and private.body_assessment_permission(p_org,p_branch,p_permission)
  and (p_client is null or (exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
    and (private.body_assessment_permission(p_org,p_branch,'clients.view_all') or exists(select 1 from public.client_assignments a
      where a.client_id=p_client and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
      and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())))))
  ) else false end;
$$;

-- Add admission before the unchanged data_inventory_authorized business predicate.
create or replace function private.data_inventory_authorized(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select case when private.is_executive_login_allowed() then (
select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind='staff')
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id and r.is_active and r.is_system
    join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
    where m.profile_id=auth.uid() and m.organization_id=p_org and (m.branch_id=p_branch or (m.branch_id is null and r.role_key='organization_manager'))
    and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
    and r.role_key in ('organization_manager','branch_supervisor') and p.permission_key='audit.view'),false)
  ) else false end;
$$;

-- Add admission before the unchanged can_begin_staff_mfa business predicate.
create or replace function private.can_begin_staff_mfa()
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
  if not private.is_executive_login_allowed() then return false; end if;
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
