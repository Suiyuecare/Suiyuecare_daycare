-- Portal proves the existing Google principal to Daycare with a short-lived,
-- signed handoff. Only the server verifies the HMAC; this database records the
-- SHA-256 of its unpredictable JTI, independently resolves the already-approved
-- Daycare principal, and binds the claim to one real Daycare Auth session.
-- Neither a matching email nor an email/OTP Auth session is admission alone.
begin;
set local lock_timeout = '5s';

create table private.portal_sso_ticket_claims (
  id uuid primary key default gen_random_uuid(),
  jti_sha256 text not null unique check (jti_sha256 ~ '^[a-f0-9]{64}$'),
  allowed_user_id uuid not null references auth.users(id) on delete restrict,
  google_subject text not null check (
    google_subject=btrim(google_subject)
    and char_length(google_subject) between 1 and 255
    and google_subject !~ '[^ -~]'
  ),
  allowed_email text not null check (
    allowed_email=lower(btrim(allowed_email))
    and allowed_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  authority_kind text not null check (authority_kind in ('executive','staff')),
  claimed_at timestamptz not null default clock_timestamp(),
  ticket_expires_at timestamptz not null,
  bound_session_id uuid unique,
  bound_at timestamptz,
  check (ticket_expires_at>claimed_at),
  check ((bound_session_id is null)=(bound_at is null))
);
create index portal_sso_ticket_claims_user_idx
  on private.portal_sso_ticket_claims(allowed_user_id,claimed_at desc);
alter table private.portal_sso_ticket_claims enable row level security;
alter table private.portal_sso_ticket_claims force row level security;
revoke all on table private.portal_sso_ticket_claims from public,anon,authenticated,service_role;
create trigger portal_sso_ticket_claims_audit
after insert or update or delete on private.portal_sso_ticket_claims
for each row execute function private.audit_row_change();

-- No user_metadata or email-only mapping. The signed Google subject must
-- resolve to exactly one verified local Google identity and an independently
-- approved, active Daycare principal with a live role and branch.
create function private.portal_sso_identity_approved(
  p_user_id uuid,p_google_sub text,p_email text,p_authority text
) returns boolean language sql volatile security invoker set search_path='' as $$
  select coalesce(p_user_id is not null and p_authority in ('executive','staff')
    and exists (
      select 1 from auth.users u
      where u.id=p_user_id and not u.is_anonymous and u.deleted_at is null
        and u.email_confirmed_at is not null and lower(coalesce(u.email,''))=p_email
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
    )
    and (select count(*) from auth.identities i
      where i.user_id=p_user_id and i.provider='google')=1
    and not exists (select 1 from auth.identities i
      where i.user_id=p_user_id and i.provider not in ('google','email'))
    and exists (
      select 1 from auth.identities i
      where i.user_id=p_user_id and i.provider='google'
        and i.provider_id=p_google_sub
        and i.identity_data->>'sub'=p_google_sub
        and lower(coalesce(i.identity_data->>'email',''))=p_email
        and i.identity_data->'email_verified'='true'::jsonb
    )
    and exists (
      select 1 from public.profiles p
      join public.memberships m on m.profile_id=p.id
      join public.organizations o on o.id=m.organization_id and o.is_active
      join public.branches b on b.organization_id=m.organization_id and b.is_active
        and (m.branch_id is null or m.branch_id=b.id)
      join public.membership_roles mr on mr.membership_id=m.id
        and mr.assigned_at<=clock_timestamp()
      join public.roles r on r.id=mr.role_id and r.is_active
        and r.role_key not in ('family','platform_ops')
        and (r.organization_id is null or r.organization_id=m.organization_id)
      where p.id=p_user_id and p.is_active
        and p.kind in ('staff','professional','driver','finance')
        and m.status='active' and m.starts_at<=clock_timestamp()
        and (m.ends_at is null or m.ends_at>clock_timestamp())
        and (
          (p_authority='executive' and
            (select count(*) from private.executive_access_policy)=1
            and exists (select 1 from private.executive_access_policy e
              where e.id and e.enabled and e.allowed_user_id=p_user_id
                and e.allowed_email=p_email and e.google_subject=p_google_sub
                and e.approved_at<=clock_timestamp()))
          or (p_authority='staff' and exists (
            select 1 from private.staff_google_access_grants g
            join auth.identities gi on gi.user_id=g.allowed_user_id
              and gi.provider='google' and gi.provider_id=g.google_subject
            where g.allowed_user_id=p_user_id
              and g.organization_id=m.organization_id
              and g.allowed_email=p_email and g.google_subject=p_google_sub
              and g.enabled and g.approved_at<=clock_timestamp()
              and (g.expires_at is null or g.expires_at>clock_timestamp())
              and (not (gi.identity_data ? 'hd')
                or lower(coalesce(gi.identity_data->>'hd',''))=g.company_email_domain)
          ))
        )
    ),false);
$$;
alter function private.portal_sso_identity_approved(uuid,text,text,text) owner to postgres;
revoke all on function private.portal_sso_identity_approved(uuid,text,text,text)
  from public,anon,authenticated,service_role;

-- Called only after the Daycare server verifies HMAC, issuer, audience, iat,
-- expiry and redirect state. A service key cannot claim an unapproved user:
-- the DB independently pins Google subject, verified email and live authority.
create function public.claim_portal_sso_ticket(
  p_jti_sha256 text,p_google_sub text,p_email text,p_expires_at timestamptz
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare
  v_user_id uuid;
  v_claimed_user_id uuid;
  v_authority text;
  v_now timestamptz:=clock_timestamp();
begin
  if p_jti_sha256 is null or p_jti_sha256 !~ '^[a-f0-9]{64}$'
    or p_google_sub is null or p_google_sub<>btrim(p_google_sub)
    or char_length(p_google_sub) not between 1 and 255 or p_google_sub ~ '[^ -~]'
    or p_email is null or p_email<>lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_expires_at is null or p_expires_at<=v_now+interval '1 second'
    -- The HMAC verifier enforces exp-iat <= 600 seconds and permits an iat
    -- up to 30 seconds ahead for clock skew. The DB must accept that exact
    -- maximum without granting a longer signed ticket lifespan.
    or p_expires_at>v_now+interval '10 minutes 30 seconds' then return null; end if;

  -- Duplicate or conflicting local subjects fail closed, rather than choosing
  -- a principal by email or by an arbitrary matching row.
  if (select count(*) from auth.identities i
      where i.provider='google' and i.provider_id=p_google_sub
        and i.identity_data->>'sub'=p_google_sub)<>1 then return null; end if;
  select i.user_id into v_user_id from auth.identities i
   where i.provider='google' and i.provider_id=p_google_sub
     and i.identity_data->>'sub'=p_google_sub;

  if private.portal_sso_identity_approved(v_user_id,p_google_sub,p_email,'executive') then
    v_authority:='executive';
  elsif private.portal_sso_identity_approved(v_user_id,p_google_sub,p_email,'staff') then
    v_authority:='staff';
  else
    return null;
  end if;

  insert into private.portal_sso_ticket_claims(
    jti_sha256,allowed_user_id,google_subject,allowed_email,authority_kind,ticket_expires_at
  ) values (p_jti_sha256,v_user_id,p_google_sub,p_email,v_authority,p_expires_at)
  on conflict (jti_sha256) do nothing
  returning allowed_user_id into v_claimed_user_id;
  return v_claimed_user_id;
end;
$$;
alter function public.claim_portal_sso_ticket(text,text,text,timestamptz) owner to postgres;
revoke all on function public.claim_portal_sso_ticket(text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_portal_sso_ticket(text,text,text,timestamptz)
  to service_role;

-- A first-time director may have an immutable owner invitation but no local
-- Google identity yet. This read-only classifier gives the server a specific
-- first-use instruction; it never creates a user, consumes the invitation,
-- approves a role or relaxes admission. The real activation still requires
-- the existing Daycare Google OAuth flow and its actual Auth session.
create function public.is_portal_sso_first_activation_pending(
  p_email text,p_google_sub text
) returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(p_email is not null and p_email=lower(btrim(p_email))
    and p_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and p_google_sub is not null and p_google_sub=btrim(p_google_sub)
    and char_length(p_google_sub) between 1 and 255
    and p_google_sub !~ '[^ -~]'
    and exists (
      select 1 from private.pending_staff_google_activations a
      join auth.users u on u.id=a.user_id
      join public.organizations o on o.id=a.organization_id and o.is_active
      join public.branches b on b.id=a.branch_id
        and b.organization_id=a.organization_id and b.is_active
      join public.roles r on r.id=a.role_id and r.is_active and r.is_system
        and r.role_key in ('branch_supervisor','branch_director')
        and (r.organization_id is null or r.organization_id=a.organization_id)
      where a.allowed_email=p_email
        and a.replaced_at is null and a.revoked_at is null
        and a.activated_at is null and a.approved_at<=clock_timestamp()
        and a.expires_at>clock_timestamp()
        and not u.is_anonymous and u.deleted_at is null
        and lower(coalesce(u.email,''))=p_email
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and not exists (select 1 from public.profiles p where p.id=a.user_id)
        and not exists (select 1 from private.staff_google_access_grants g
          where g.allowed_user_id=a.user_id)
        and not exists (select 1 from auth.identities i
          where i.user_id=a.user_id and i.provider='google'
            and (i.provider_id<>p_google_sub
              or i.identity_data->>'sub'<>p_google_sub
              or lower(coalesce(i.identity_data->>'email',''))<>p_email))
    ),false);
$$;
alter function public.is_portal_sso_first_activation_pending(text,text) owner to postgres;
revoke all on function public.is_portal_sso_first_activation_pending(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.is_portal_sso_first_activation_pending(text,text)
  to service_role;

-- The handoff ticket does not grant access until this exact Auth session is
-- bound. It is intentionally not an auth.sessions foreign key: deleting a
-- signed-out session must not erase the consumed-ticket history or permit a
-- second binding while the original ticket's ten minutes remain.
create function public.bind_portal_sso_session(
  p_jti_sha256 text,p_session_id uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
  v_claim private.portal_sso_ticket_claims%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if p_jti_sha256 is null or p_jti_sha256 !~ '^[a-f0-9]{64}$'
    or p_session_id is null then return false; end if;
  select * into v_claim from private.portal_sso_ticket_claims
    where jti_sha256=p_jti_sha256 for update;
  if not found then return false; end if;
  if v_claim.bound_session_id is not null and v_claim.bound_session_id<>p_session_id
    then return false; end if;
  if v_claim.bound_session_id is null and v_claim.ticket_expires_at<=v_now
    then return false; end if;
  if private.portal_sso_identity_approved(
      v_claim.allowed_user_id,v_claim.google_subject,v_claim.allowed_email,v_claim.authority_kind
    ) is not true then return false; end if;
  if not exists (
    select 1 from auth.sessions s where s.id=p_session_id
      and s.user_id=v_claim.allowed_user_id and s.created_at is not null
      and s.created_at<=v_now
      and s.created_at>=v_claim.claimed_at-interval '1 minute'
      and s.aal::text='aal1' and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>v_now)
  ) then return false; end if;
  if v_claim.bound_session_id=p_session_id then return true; end if;

  update private.portal_sso_ticket_claims
    set bound_session_id=p_session_id,bound_at=clock_timestamp()
    where id=v_claim.id and bound_session_id is null;
  return found;
exception when unique_violation then
  return false;
end;
$$;
alter function public.bind_portal_sso_session(text,uuid) owner to postgres;
revoke all on function public.bind_portal_sso_session(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.bind_portal_sso_session(text,uuid) to service_role;

-- Only the currently bound, non-expired Auth session can consume ordinary
-- Daycare permissions. Once bound, the short ticket expiry is irrelevant:
-- sign-out/session revocation and live account/branch approval decide access.
-- A genuine later TOTP upgrade on this same session is accepted only with the
-- exact Supabase AMR row; high-risk actions still require their own recent AAL2.
create function private.is_portal_sso_session_allowed(p_authority text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_claims jsonb:=auth.jwt();
  v_user_id uuid;
  v_session_id uuid;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
  v_record private.portal_sso_ticket_claims%rowtype;
  v_entry jsonb;
  v_has_totp boolean:=false;
begin
  if p_authority not in ('executive','staff')
    or jsonb_typeof(v_claims) is distinct from 'object'
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
    or coalesce(v_claims->>'exp','') !~ '^[0-9]{1,11}$' then return false; end if;
  v_user_id:=auth.uid();
  v_session_id:=(v_claims->>'session_id')::uuid;
  v_issued_at:=to_timestamp((v_claims->>'iat')::double precision);
  v_expires_at:=to_timestamp((v_claims->>'exp')::double precision);
  if v_user_id is null or v_user_id::text<>lower(v_claims->>'sub')
    or v_issued_at<v_now-interval '1 hour'
    or v_issued_at>v_now+interval '1 minute'
    or v_expires_at<=v_now or v_expires_at<=v_issued_at then return false; end if;

  select * into v_record from private.portal_sso_ticket_claims g
    where g.bound_session_id=v_session_id and g.allowed_user_id=v_user_id
      and g.authority_kind=p_authority and g.bound_at is not null;
  if not found or lower(coalesce(v_claims->>'email',''))<>v_record.allowed_email
    or private.portal_sso_identity_approved(
      v_record.allowed_user_id,v_record.google_subject,
      v_record.allowed_email,v_record.authority_kind
    ) is not true then return false; end if;

  if not exists (
    select 1 from auth.sessions s where s.id=v_session_id
      and s.user_id=v_user_id and s.created_at is not null
      and s.created_at<=v_now and s.created_at>=v_record.claimed_at-interval '1 minute'
      and s.oauth_client_id is null and (s.not_after is null or s.not_after>v_now)
      and s.aal::text=v_claims->>'aal'
      and v_issued_at>=s.created_at-interval '1 minute'
  ) then return false; end if;

  if v_claims->>'aal'='aal2' then
    if jsonb_typeof(v_claims->'amr') is distinct from 'array'
      or jsonb_array_length(v_claims->'amr') not between 1 and 8 then return false; end if;
    for v_entry in select value from jsonb_array_elements(v_claims->'amr') loop
      if jsonb_typeof(v_entry)='object' and v_entry->>'method'='totp'
        and jsonb_typeof(v_entry->'timestamp')='number'
        and coalesce(v_entry->>'timestamp','') ~ '^[0-9]{1,11}$'
        and exists (
          select 1 from auth.mfa_amr_claims a
          where a.session_id=v_session_id and a.authentication_method='totp'
            and floor(extract(epoch from a.updated_at))=(v_entry->>'timestamp')::bigint
            and a.updated_at<=v_now+interval '1 minute'
        ) then v_has_totp:=true; end if;
    end loop;
    if not v_has_totp then return false; end if;
  end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow then return false;
end;
$$;
alter function private.is_portal_sso_session_allowed(text) owner to postgres;
revoke all on function private.is_portal_sso_session_allowed(text)
  from public,anon,authenticated,service_role;

-- Keep the original Google AMR checks and their dependent function OIDs.
-- A Portal session takes a distinct, exact-session path at the beginning;
-- all pre-existing Google OAuth logic remains byte-for-byte unchanged.
do $$
declare v_source text; v_changed text; v_signature text; v_authority text;
begin
  foreach v_signature in array array[
    'private.is_executive_login_allowed()',
    'private.is_staff_google_session_allowed()'
  ] loop
    v_authority:=case when v_signature='private.is_executive_login_allowed()'
      then 'executive' else 'staff' end;
    v_source:=pg_get_functiondef(v_signature::regprocedure);
    v_changed:=replace(v_source,E'begin\n  if jsonb_typeof(v_claims)',
      format(E'begin\n  if private.is_portal_sso_session_allowed(%L) then return true; end if;\n  if jsonb_typeof(v_claims)',v_authority));
    if v_changed=v_source then
      raise exception 'Portal SSO admission anchor missing for %',v_signature;
    end if;
    execute v_changed;
  end loop;
end;
$$;
comment on function public.claim_portal_sso_ticket(text,text,text,timestamptz) is
  'Server-only, HMAC-preverified, one-time Portal JTI claim. Returns only a preapproved Daycare Auth UUID; NULL denies.';
comment on function public.is_portal_sso_first_activation_pending(text,text) is
  'Server-only, read-only classifier for an existing valid unconsumed first-use staff invitation. Never admits or activates.';
comment on function public.bind_portal_sso_session(text,uuid) is
  'Server-only binding of one consumed Portal handoff to the exact existing Daycare Auth session.';
comment on function private.is_portal_sso_session_allowed(text) is
  'Self-only exact-session Portal handoff admission. AAL2 additionally requires true same-session TOTP AMR evidence.';
comment on function public.is_executive_login_allowed() is
  'Self-only owner-pinned executive Google OAuth or exact-session signed Portal handoff. Neither creates roles nor fabricates AAL2.';
comment on function public.is_staff_login_allowed() is
  'Self-only individually approved Google OAuth or exact-session signed Portal handoff. Live tenant, role, assignment and high-risk assurance remain independent.';

commit;
