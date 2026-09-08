-- Day-care management system: explicit grants, RLS, privileged helpers,
-- immutable-record controls, and mutation audit trails.

revoke create on schema public from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
    );
$$;

create or replace function private.is_active_member(
  p_organization_id uuid,
  p_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.memberships m
      where m.profile_id = (select auth.uid())
        and m.organization_id = p_organization_id
        and m.status = 'active'
        and m.starts_at <= now()
        and (m.ends_at is null or m.ends_at > now())
        and (
          (p_branch_id is null and m.branch_id is null)
          or (
            p_branch_id is not null
            and (m.branch_id is null or m.branch_id = p_branch_id)
          )
        )
    );
$$;

create or replace function private.is_family_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.kind = 'family'
        and p.is_active
    );
$$;

create or replace function private.has_permission(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.profiles actor_profile
      where actor_profile.id = (select auth.uid())
        and actor_profile.kind <> 'family'
    )
    and exists (
      select 1
      from public.memberships m
      join public.membership_roles mr on mr.membership_id = m.id
      join public.roles r on r.id = mr.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions p on p.id = rp.permission_id
      where m.profile_id = (select auth.uid())
        and m.organization_id = p_organization_id
        and m.status = 'active'
        and m.starts_at <= now()
        and (m.ends_at is null or m.ends_at > now())
        and (
          (p_branch_id is null and m.branch_id is null)
          or (
            p_branch_id is not null
            and (m.branch_id is null or m.branch_id = p_branch_id)
          )
        )
        and (r.organization_id is null or r.organization_id = p_organization_id)
        and p.permission_key = p_permission_key
    );
$$;

create or replace function private.can_staff_access_client(
  p_client_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.clients c
      where c.id = p_client_id
        and (select private.has_permission(c.organization_id, c.branch_id, p_permission_key))
        and (
          (select private.has_permission(c.organization_id, c.branch_id, 'clients.view_all'))
          or exists (
            select 1
            from public.client_assignments a
            where a.client_id = c.id
              and a.organization_id = c.organization_id
              and a.branch_id = c.branch_id
              and a.assignee_user_id = (select auth.uid())
              and a.starts_at <= now()
              and (a.ends_at is null or a.ends_at > now())
          )
        )
    );
$$;

create or replace function private.can_read_client(
  p_client_id uuid,
  p_staff_permission_key text,
  p_consent_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      (select private.can_staff_access_client(p_client_id, p_staff_permission_key))
      or (
        (select private.is_active_user())
        and exists (
          select 1
          from public.consents c
          where c.client_id = p_client_id
            and c.recipient_user_id = (select auth.uid())
            and c.consented_at <= now()
            and (c.expires_at is null or c.expires_at > now())
            and c.revoked_at is null
            and ('*' = any(c.scopes) or p_consent_scope = any(c.scopes))
        )
      )
    );
$$;

create or replace function private.family_client_summaries()
returns table(
  client_id uuid,
  branch_id uuid,
  display_name text,
  client_status public.client_status,
  admitted_on date,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.branch_id,
    c.display_name,
    c.status,
    c.admitted_on,
    c.updated_at
  from public.clients c
  where (select private.is_family_user())
    and exists (
      select 1
      from public.consents consent
      where consent.client_id = c.id
        and consent.organization_id = c.organization_id
        and consent.branch_id = c.branch_id
        and consent.recipient_user_id = (select auth.uid())
        and consent.consented_at <= now()
        and (consent.expires_at is null or consent.expires_at > now())
        and consent.revoked_at is null
        and ('*' = any(consent.scopes) or 'client.read' = any(consent.scopes))
    );
$$;

create or replace function private.family_care_summaries(p_client_id uuid)
returns table(
  record_id uuid,
  category text,
  occurred_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  signed_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    record.id,
    record.category,
    record.occurred_at,
    record.effective_from,
    record.effective_to,
    record.signed_at,
    record.updated_at
  from public.care_records record
  where record.client_id = p_client_id
    and record.status = 'signed'
    and (select private.is_family_user())
    and exists (
      select 1
      from public.consents consent
      where consent.client_id = record.client_id
        and consent.organization_id = record.organization_id
        and consent.branch_id = record.branch_id
        and consent.recipient_user_id = (select auth.uid())
        and consent.consented_at <= now()
        and (consent.expires_at is null or consent.expires_at > now())
        and consent.revoked_at is null
        and ('*' = any(consent.scopes) or 'care.read' = any(consent.scopes))
    )
  order by record.occurred_at desc;
$$;

create or replace function public.family_client_summaries()
returns table(
  client_id uuid,
  branch_id uuid,
  display_name text,
  client_status public.client_status,
  admitted_on date,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.family_client_summaries();
$$;

create or replace function public.family_care_summaries(p_client_id uuid)
returns table(
  record_id uuid,
  category text,
  occurred_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  signed_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.family_care_summaries(p_client_id);
$$;

create or replace function private.can_access_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and (
      p_profile_id = (select auth.uid())
      or exists (
        select 1
        from public.memberships target_m
        where target_m.profile_id = p_profile_id
          and target_m.status <> 'ended'
          and (select private.has_permission(
            target_m.organization_id,
            target_m.branch_id,
            'profiles.manage'
          ))
      )
    );
$$;

create or replace function private.can_read_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.roles r
      where r.id = p_role_id
        and (
          r.organization_id is null
          or (select private.is_active_member(r.organization_id, null))
        )
    );
$$;

create or replace function private.can_manage_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.roles r
      where r.id = p_role_id
        and not r.is_system
        and r.organization_id is not null
        and (select private.has_permission(r.organization_id, null, 'roles.manage'))
    );
$$;

create or replace function private.can_manage_membership_role(
  p_membership_id uuid,
  p_role_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.memberships m
      join public.roles r on r.id = p_role_id
      where m.id = p_membership_id
        and (select private.has_permission(
          m.organization_id,
          m.branch_id,
          'memberships.manage'
        ))
        and (
          not r.is_system
          or (select private.has_permission(
            m.organization_id,
            null,
            'roles.manage'
          ))
        )
    );
$$;

create or replace function private.can_read_form_definition(p_form_definition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.form_definitions f
      where f.id = p_form_definition_id
        and (
          f.organization_id is null
          or (select private.is_active_member(f.organization_id, null))
        )
    );
$$;

create or replace function private.can_manage_form_definition(p_form_definition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.form_definitions f
      where f.id = p_form_definition_id
        and not f.is_official
        and f.organization_id is not null
        and (select private.has_permission(f.organization_id, null, 'forms.manage'))
    );
$$;

create or replace function private.can_read_notification(p_notification_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_active_user())
    and exists (
      select 1
      from public.notifications n
      where n.id = p_notification_id
        and (
          (select private.has_permission(n.organization_id, n.branch_id, 'notifications.read'))
          or exists (
            select 1
            from public.notification_deliveries d
            where d.notification_id = n.id
              and d.recipient_user_id = (select auth.uid())
          )
        )
    );
$$;

create or replace function private.claim_batch_is_editable(
  p_claim_batch_id uuid,
  p_organization_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.has_permission(p_organization_id, p_branch_id, 'claims.manage'))
    and exists (
      select 1
      from public.claim_batches b
      where b.id = p_claim_batch_id
        and b.organization_id = p_organization_id
        and b.branch_id = p_branch_id
        and b.status in ('draft', 'validated')
    );
$$;

create or replace function private.import_batch_is_editable(
  p_import_batch_id uuid,
  p_organization_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.has_permission(p_organization_id, p_branch_id, 'imports.manage'))
    and exists (
      select 1
      from public.import_batches b
      where b.id = p_import_batch_id
        and b.organization_id = p_organization_id
        and b.branch_id = p_branch_id
        and b.approved_at is null
        and b.status not in ('imported', 'duplicate', 'superseded')
    );
$$;

create or replace function private.has_recent_aal2(max_age_minutes integer default 15)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null
     or not (select private.is_active_user())
     or max_age_minutes < 1
     or max_age_minutes > 15 then
    return false;
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if v_session_id is null then
    return false;
  end if;

  return exists (
    select 1
    from private.reauth_events e
    where e.user_id = v_user_id
      and e.session_id = v_session_id
      and e.aal = 'aal2'
      and e.revoked_at is null
      and e.verified_at >= clock_timestamp() - make_interval(mins => max_age_minutes)
  );
end;
$$;

create or replace function public.issue_aal2_reauth_challenge(
  p_challenge_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_nonce_sha256 text,
  p_idempotency_key uuid,
  p_issued_jwt_iat timestamptz,
  p_issued_jwt_jti text default null,
  p_ttl_seconds integer default 300
)
returns table(challenge_id uuid, expires_at timestamptz, replayed boolean)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_challenge private.reauth_challenges%rowtype;
begin
  if p_challenge_id is null
     or p_user_id is null
     or p_session_id is null
     or p_idempotency_key is null
     or p_nonce_sha256 !~ '^[a-f0-9]{64}$'
     or p_ttl_seconds < 60
     or p_ttl_seconds > 600
     or p_issued_jwt_iat < v_now - interval '1 hour'
     or p_issued_jwt_iat > v_now + interval '1 minute' then
    raise exception using errcode = '22023', message = 'invalid reauthentication challenge input';
  end if;

  -- Serialize challenge issuance for one user/session and keep at most one
  -- usable challenge. This bounds storage and closes concurrent supersession
  -- races without weakening the fresh-factor check during consumption.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_session_id::text, 0)
  );

  select c.* into v_challenge
  from private.reauth_challenges c
  where c.user_id = p_user_id
    and c.session_id = p_session_id
    and c.idempotency_key = p_idempotency_key;

  if found then
    if v_challenge.id <> p_challenge_id
       or v_challenge.nonce_sha256 <> p_nonce_sha256
       or v_challenge.issued_jwt_iat <> p_issued_jwt_iat
       or v_challenge.issued_jwt_jti is distinct from nullif(p_issued_jwt_jti, '') then
      raise exception using errcode = '23505', message = 'reauthentication idempotency conflict';
    end if;

    return query select v_challenge.id, v_challenge.expires_at, true;
    return;
  end if;

  update private.reauth_challenges
  set invalidated_at = v_now,
      invalidation_reason = 'superseded_by_new_challenge'
  where user_id = p_user_id
    and session_id = p_session_id
    and consumed_at is null
    and invalidated_at is null;

  insert into private.reauth_challenges (
    id,
    user_id,
    session_id,
    nonce_sha256,
    idempotency_key,
    issued_jwt_iat,
    issued_jwt_jti,
    created_at,
    expires_at
  ) values (
    p_challenge_id,
    p_user_id,
    p_session_id,
    p_nonce_sha256,
    p_idempotency_key,
    p_issued_jwt_iat,
    nullif(p_issued_jwt_jti, ''),
    v_now,
    v_now + make_interval(secs => p_ttl_seconds)
  )
  returning * into v_challenge;

  return query select v_challenge.id, v_challenge.expires_at, false;
end;
$$;

create or replace function private.record_aal2_reauth(
  p_challenge_id uuid,
  p_nonce_sha256 text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_claim_iat timestamptz;
  v_claim_jti text;
  v_amr jsonb;
  v_candidate_at timestamptz;
  v_factor_at timestamptz;
  v_factor_method text;
  v_challenge private.reauth_challenges%rowtype;
  v_request_id text;
  v_headers jsonb;
begin
  if v_user_id is null
     or not (select private.is_active_user())
     or coalesce(v_claims ->> 'aal', '') <> 'aal2'
     or p_challenge_id is null
     or p_nonce_sha256 !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  begin
    v_session_id := nullif(v_claims ->> 'session_id', '')::uuid;
    v_claim_iat := to_timestamp((v_claims ->> 'iat')::double precision);
    v_claim_jti := nullif(v_claims ->> 'jti', '');
  exception when invalid_text_representation or numeric_value_out_of_range then
    return false;
  end;

  if v_session_id is null or v_claim_iat is null then
    return false;
  end if;

  if jsonb_typeof(v_claims -> 'amr') <> 'array' then
    return false;
  end if;

  for v_amr in
    select value from jsonb_array_elements(v_claims -> 'amr')
  loop
    if lower(coalesce(v_amr ->> 'method', '')) in ('totp', 'webauthn', 'phone') then
      begin
        v_candidate_at := to_timestamp((v_amr ->> 'timestamp')::double precision);
      exception when invalid_text_representation or numeric_value_out_of_range then
        v_candidate_at := null;
      end;

      if v_candidate_at is not null
         and (v_factor_at is null or v_candidate_at > v_factor_at) then
        v_factor_at := v_candidate_at;
        v_factor_method := lower(v_amr ->> 'method');
      end if;
    end if;
  end loop;

  if v_factor_at is null then
    return false;
  end if;

  select c.* into v_challenge
  from private.reauth_challenges c
  where c.id = p_challenge_id
    and c.user_id = v_user_id
    and c.session_id = v_session_id
    and c.nonce_sha256 = p_nonce_sha256
    and c.consumed_at is null
    and c.invalidated_at is null
    and c.expires_at > clock_timestamp()
  for update;

  if not found
     or v_factor_at < v_challenge.created_at - interval '2 seconds'
     or v_claim_iat < v_challenge.created_at - interval '2 seconds'
     or v_claim_iat < v_factor_at - interval '5 seconds'
     or v_factor_at > clock_timestamp() + interval '1 minute'
     or v_claim_iat > clock_timestamp() + interval '1 minute'
     or not (
       v_claim_iat > v_challenge.issued_jwt_iat
       or (
         v_challenge.issued_jwt_jti is not null
         and v_claim_jti is not null
         and v_claim_jti <> v_challenge.issued_jwt_jti
       )
     ) then
    return false;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_request_id := nullif(v_headers ->> 'x-request-id', '');
  exception when others then
    v_request_id := null;
  end;

  update private.reauth_challenges
  set consumed_at = clock_timestamp(),
      consumed_jwt_iat = v_claim_iat,
      consumed_jwt_jti = v_claim_jti,
      factor_method = v_factor_method,
      factor_verified_at = v_factor_at
  where id = v_challenge.id
    and consumed_at is null;

  if not found then
    return false;
  end if;

  insert into private.reauth_events (
    user_id,
    session_id,
    challenge_id,
    aal,
    verification_method,
    verified_at,
    revoked_at,
    request_id,
    updated_at
  ) values (
    v_user_id,
    v_session_id,
    v_challenge.id,
    'aal2',
    v_factor_method,
    v_factor_at,
    null,
    v_request_id,
    clock_timestamp()
  )
  on conflict (user_id, session_id) do update
    set challenge_id = excluded.challenge_id,
        aal = excluded.aal,
        verification_method = excluded.verification_method,
        verified_at = excluded.verified_at,
        revoked_at = null,
        request_id = excluded.request_id,
        updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.record_aal2_reauth(
  p_challenge_id uuid,
  p_nonce_sha256 text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_aal2_reauth(p_challenge_id, p_nonce_sha256);
$$;

create or replace function public.has_recent_aal2(max_age_minutes integer default 15)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_recent_aal2(max_age_minutes);
$$;

create or replace function private.approve_import_staging(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_import_batch_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch public.import_batches%rowtype;
  v_operation public.import_operations%rowtype;
  v_scoped_request_hash text;
begin
  if v_user_id is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_import_batch_id is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_idempotency_key is null
     or p_request_hash is null
     or p_request_hash !~ '^[a-f0-9]{64}$'
     or not (select private.is_active_user()) then
    raise exception using errcode = '42501', message = 'import staging approval denied';
  end if;

  v_scoped_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'operation', 'approve_import_staging',
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'import_batch_id', p_import_batch_id,
          'expected_version', p_expected_version,
          'request_hash', p_request_hash
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select batch.* into v_batch
  from public.import_batches batch
  where batch.id = p_import_batch_id
    and batch.organization_id = p_expected_organization_id
    and batch.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.has_permission(
       v_batch.organization_id,
       v_batch.branch_id,
       'imports.manage'
     ))
     or not (select private.has_permission(
       v_batch.organization_id,
       v_batch.branch_id,
       'imports.approve'
     ))
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501', message = 'import staging approval denied';
  end if;

  select operation.* into v_operation
  from public.import_operations operation
  where operation.organization_id = p_expected_organization_id
    and operation.branch_id = p_expected_branch_id
    and operation.actor_user_id = v_user_id
    and operation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_operation.import_batch_id <> p_import_batch_id
       or v_operation.operation_kind <> 'approve'
       or v_operation.request_hash <> v_scoped_request_hash
       or v_operation.expected_version <> p_expected_version then
      raise exception using errcode = '23505', message = 'import approval idempotency conflict';
    end if;

    if v_operation.status <> 'pending' then
      return jsonb_build_object(
        'request_id', v_operation.id,
        'status', v_operation.status,
        'import_batch_id', v_operation.import_batch_id,
        'batch_version', v_operation.result_version,
        'batch_status', v_batch.status,
        'staging_only', true,
        'replayed', true,
        'error_code', v_operation.error_code
      );
    end if;
  else
    insert into public.import_operations (
      organization_id,
      branch_id,
      import_batch_id,
      actor_user_id,
      operation_kind,
      idempotency_key,
      request_hash,
      expected_version
    ) values (
      v_batch.organization_id,
      v_batch.branch_id,
      v_batch.id,
      v_user_id,
      'approve',
      p_idempotency_key,
      v_scoped_request_hash,
      p_expected_version
    )
    returning * into v_operation;
  end if;

  if v_batch.status <> 'ready_for_approval' then
    update public.import_operations
    set status = 'failed',
        completed_at = clock_timestamp(),
        error_code = 'BATCH_NOT_READY'
    where id = v_operation.id;

    return jsonb_build_object(
      'request_id', v_operation.id,
      'status', 'failed',
      'import_batch_id', v_batch.id,
      'batch_version', v_batch.version,
      'batch_status', v_batch.status,
      'staging_only', true,
      'replayed', false,
      'error_code', 'BATCH_NOT_READY'
    );
  end if;

  if v_batch.version <> p_expected_version then
    update public.import_operations
    set status = 'failed',
        completed_at = clock_timestamp(),
        error_code = 'VERSION_CONFLICT'
    where id = v_operation.id;

    return jsonb_build_object(
      'request_id', v_operation.id,
      'status', 'failed',
      'import_batch_id', v_batch.id,
      'batch_version', v_batch.version,
      'batch_status', v_batch.status,
      'staging_only', true,
      'replayed', false,
      'error_code', 'VERSION_CONFLICT'
    );
  end if;

  update public.import_batches
  set approved_by = v_user_id,
      approved_at = clock_timestamp(),
      version = version + 1
  where id = v_batch.id
    and status = 'ready_for_approval'
    and approved_at is null
    and version = p_expected_version
  returning * into v_batch;

  if not found then
    raise exception using errcode = '40001', message = 'import approval compare-and-swap failed';
  end if;

  update public.import_operations
  set status = 'applied',
      completed_at = clock_timestamp(),
      result_version = v_batch.version
  where id = v_operation.id
    and status = 'pending';

  if not found then
    raise exception using errcode = '40001', message = 'import approval operation transition failed';
  end if;

  return jsonb_build_object(
    'request_id', v_operation.id,
    'status', 'applied',
    'import_batch_id', v_batch.id,
    'batch_version', v_batch.version,
    'batch_status', v_batch.status,
    'staging_only', true,
    'replayed', false,
    'error_code', null
  );
end;
$$;

create or replace function public.approve_import_staging(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_import_batch_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_request_hash text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.approve_import_staging(
    p_expected_organization_id,
    p_expected_branch_id,
    p_import_batch_id,
    p_expected_version,
    p_idempotency_key,
    p_request_hash
  );
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function private.prevent_key_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
  v_keys constant text[] := array[
    'id', 'organization_id', 'branch_id', 'profile_id', 'client_id',
    'role_id', 'permission_id', 'membership_id', 'user_id',
    'recipient_user_id', 'actor_user_id', 'created_by', 'recorded_by',
    'uploaded_by', 'idempotency_key', 'upload_idempotency_key',
    'operation_kind', 'request_hash', 'expected_version',
    'form_definition_id', 'record_key', 'version',
    'previous_version_id', 'correction_of_id', 'medication_plan_id',
    'care_plan_record_id', 'claim_batch_id', 'service_event_id',
    'import_batch_id', 'notification_id'
  ];
begin
  foreach v_key in array v_keys loop
    if not (tg_table_name = 'import_batches' and v_key = 'version')
       and v_old ? v_key
       and v_old -> v_key is distinct from v_new -> v_key then
      raise exception using
        errcode = '23514',
        message = format('immutable key %s cannot be changed on %I.%I', v_key, tg_table_schema, tg_table_name);
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.protect_profile_self_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() = old.id and (
    new.kind is distinct from old.kind
    or new.employee_code is distinct from old.employee_code
    or new.is_active is distinct from old.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'users cannot change their own role kind, employee code, or active state';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_signed_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if to_jsonb(old) ->> 'signed_at' is not null then
    raise exception using
      errcode = '55000',
      message = format('signed rows in %I.%I are immutable; create a correction version', tg_table_schema, tg_table_name);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.prevent_published_form_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = 'published form versions are immutable; create a new version';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.prevent_final_import_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.approved_at is not null then
    raise exception using
      errcode = '55000',
      message = 'staging-approved import batches are frozen until atomic domain promotion is implemented';
  end if;

  if tg_op = 'UPDATE' and (
    new.upload_idempotency_key is distinct from old.upload_idempotency_key
    or new.original_file_name is distinct from old.original_file_name
    or new.mime_type is distinct from old.mime_type
    or new.encoding is distinct from old.encoding
    or new.file_size_bytes is distinct from old.file_size_bytes
    or new.sha256 is distinct from old.sha256
    or new.raw_object_key is distinct from old.raw_object_key
  ) then
    raise exception using
      errcode = '55000',
      message = 'import source identity is immutable';
  end if;

  if tg_op = 'UPDATE'
     and new.version is distinct from old.version
     and new.version <> old.version + 1 then
    raise exception using
      errcode = '40001',
      message = 'import batch version must advance by exactly one';
  end if;

  if old.status in ('imported', 'duplicate', 'superseded') then
    raise exception using
      errcode = '55000',
      message = 'finalized import batches are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.protect_final_import_field()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid := case when tg_op = 'DELETE' then old.import_batch_id else new.import_batch_id end;
  v_batch_status public.import_batch_status;
begin
  select b.status into strict v_batch_status
  from public.import_batches b
  where b.id = v_batch_id;

  if exists (
    select 1
    from public.import_batches approved_batch
    where approved_batch.id = v_batch_id
      and approved_batch.approved_at is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'fields in a staging-approved import batch are immutable';
  end if;

  if v_batch_status in ('imported', 'duplicate', 'superseded') then
    raise exception using
      errcode = '55000',
      message = 'fields in a finalized import batch are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.protect_final_import_operation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = 'completed import operations are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.protect_claim_batch_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status not in ('draft', 'validated') then
    if tg_op = 'DELETE' then
      raise exception using
        errcode = '55000',
        message = 'exported claim snapshots cannot be deleted';
    end if;

    if new.claim_period_start is distinct from old.claim_period_start
       or new.claim_period_end is distinct from old.claim_period_end
       or new.format_version is distinct from old.format_version
       or new.snapshot_hash is distinct from old.snapshot_hash
       or new.exported_at is distinct from old.exported_at
       or new.created_by is distinct from old.created_by then
      raise exception using
        errcode = '55000',
        message = 'exported claim snapshot content is immutable';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.protect_claim_item_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid := case when tg_op = 'DELETE' then old.claim_batch_id else new.claim_batch_id end;
  v_batch_status public.claim_status;
begin
  select b.status into strict v_batch_status
  from public.claim_batches b
  where b.id = v_batch_id;

  if v_batch_status not in ('draft', 'validated') then
    if tg_op = 'DELETE' then
      raise exception using
        errcode = '55000',
        message = 'items in an exported claim snapshot cannot be deleted';
    end if;

    if (to_jsonb(new) - array['response_code', 'response_message', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['response_code', 'response_message', 'updated_at']) then
      raise exception using
        errcode = '55000',
        message = 'exported claim item content is immutable; only reconciliation response fields may change';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.validate_membership_role_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_membership_organization_id uuid;
  v_role_organization_id uuid;
begin
  select m.organization_id into strict v_membership_organization_id
  from public.memberships m
  where m.id = new.membership_id;

  select r.organization_id into v_role_organization_id
  from public.roles r
  where r.id = new.role_id;

  if not found then
    raise exception using errcode = '23503', message = 'role does not exist';
  end if;

  if v_role_organization_id is not null
     and v_role_organization_id <> v_membership_organization_id then
    raise exception using
      errcode = '23514',
      message = 'tenant role and membership must belong to the same organization';
  end if;

  return new;
end;
$$;

create or replace function private.validate_care_record_form_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_form_organization_id uuid;
begin
  if new.form_version_id is null then
    return new;
  end if;

  select d.organization_id into v_form_organization_id
  from public.form_versions v
  join public.form_definitions d on d.id = v.form_definition_id
  where v.id = new.form_version_id;

  if not found then
    raise exception using errcode = '23503', message = 'form version does not exist';
  end if;

  if v_form_organization_id is not null
     and v_form_organization_id <> new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'tenant form version cannot be used by another organization';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_medication_verification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_high_risk boolean;
begin
  select p.high_risk into strict v_high_risk
  from public.medication_plans p
  where p.id = new.medication_plan_id;

  new.requires_second_verification :=
    coalesce(new.requires_second_verification, false)
    or v_high_risk
    or new.late_entry;

  if new.signed_at is not null
     and new.requires_second_verification
     and (
       new.second_verified_by is null
       or new.second_verified_at is null
       or new.recorded_by is null
       or new.second_verified_by = new.recorded_by
     ) then
    raise exception using
      errcode = '23514',
      message = 'high-risk or late medication administration requires an independent second verifier';
  end if;

  return new;
end;
$$;

create or replace function private.validate_notification_delivery_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notification_branch_id uuid;
begin
  select n.branch_id into v_notification_branch_id
  from public.notifications n
  where n.id = new.notification_id
    and n.organization_id = new.organization_id;

  if not found then
    raise exception using errcode = '23503', message = 'notification does not exist in organization';
  end if;

  if v_notification_branch_id is not null
     and new.branch_id is distinct from v_notification_branch_id then
    raise exception using
      errcode = '23514',
      message = 'delivery branch must match branch-scoped notification';
  end if;

  return new;
end;
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_row jsonb;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_organization_id uuid;
  v_branch_id uuid;
  v_changed_fields text[] := '{}'::text[];
  v_headers jsonb;
  v_request_id text;
begin
  v_row := case when tg_op = 'DELETE' then v_old else v_new end;

  if nullif(v_row ->> 'organization_id', '') is not null then
    v_organization_id := (v_row ->> 'organization_id')::uuid;
  end if;
  if nullif(v_row ->> 'branch_id', '') is not null then
    v_branch_id := (v_row ->> 'branch_id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed_fields
    from (
      select key as k
      from jsonb_object_keys(v_old || v_new) as key
      where v_old -> key is distinct from v_new -> key
    ) changed;
  else
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed_fields
    from jsonb_object_keys(v_row) as key;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_request_id := nullif(v_headers ->> 'x-request-id', '');
  exception when others then
    v_request_id := null;
  end;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    request_id,
    changed_fields,
    metadata
  ) values (
    v_organization_id,
    v_branch_id,
    v_actor_user_id,
    lower(tg_op),
    tg_table_schema || '.' || tg_table_name,
    coalesce(
      v_row ->> 'id',
      case
        when v_row ? 'membership_id' and v_row ? 'role_id'
          then (v_row ->> 'membership_id') || ':' || (v_row ->> 'role_id')
        when v_row ? 'role_id' and v_row ? 'permission_id'
          then (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_id')
        else null
      end
    ),
    v_request_id,
    v_changed_fields,
    jsonb_build_object(
      'schema', tg_table_schema,
      'trigger', tg_name,
      'system_actor', v_actor_user_id is null
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Every SECURITY DEFINER function is non-exposed, has a fixed empty
-- search_path, checks auth.uid(), and is opt-in executable below.
revoke all on function private.is_active_user() from public, anon, authenticated, service_role;
revoke all on function private.is_active_member(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_family_user() from public, anon, authenticated, service_role;
revoke all on function private.has_permission(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.can_staff_access_client(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.can_read_client(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.family_client_summaries() from public, anon, authenticated, service_role;
revoke all on function private.family_care_summaries(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_read_role(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_manage_role(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_manage_membership_role(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_read_form_definition(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_manage_form_definition(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_read_notification(uuid) from public, anon, authenticated, service_role;
revoke all on function private.claim_batch_is_editable(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.import_batch_is_editable(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.approve_import_staging(uuid, uuid, uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.has_recent_aal2(integer) from public, anon, authenticated, service_role;
revoke all on function private.record_aal2_reauth(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.audit_row_change() from public, anon, authenticated, service_role;

grant execute on function private.is_active_user() to authenticated;
grant execute on function private.is_active_member(uuid, uuid) to authenticated;
grant execute on function private.is_family_user() to authenticated;
grant execute on function private.has_permission(uuid, uuid, text) to authenticated;
grant execute on function private.can_staff_access_client(uuid, text) to authenticated;
grant execute on function private.can_read_client(uuid, text, text) to authenticated;
grant execute on function private.family_client_summaries() to authenticated;
grant execute on function private.family_care_summaries(uuid) to authenticated;
grant execute on function private.can_access_profile(uuid) to authenticated;
grant execute on function private.can_read_role(uuid) to authenticated;
grant execute on function private.can_manage_role(uuid) to authenticated;
grant execute on function private.can_manage_membership_role(uuid, uuid) to authenticated;
grant execute on function private.can_read_form_definition(uuid) to authenticated;
grant execute on function private.can_manage_form_definition(uuid) to authenticated;
grant execute on function private.can_read_notification(uuid) to authenticated;
grant execute on function private.claim_batch_is_editable(uuid, uuid, uuid) to authenticated;
grant execute on function private.import_batch_is_editable(uuid, uuid, uuid) to authenticated;
grant execute on function private.approve_import_staging(uuid, uuid, uuid, bigint, uuid, text) to authenticated;
grant execute on function private.has_recent_aal2(integer) to authenticated;
grant execute on function private.record_aal2_reauth(uuid, text) to authenticated;

revoke all on function public.issue_aal2_reauth_challenge(uuid, uuid, uuid, text, uuid, timestamptz, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.record_aal2_reauth(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.has_recent_aal2(integer) from public, anon, authenticated, service_role;
revoke all on function public.family_client_summaries() from public, anon, authenticated, service_role;
revoke all on function public.family_care_summaries(uuid) from public, anon, authenticated, service_role;
revoke all on function public.approve_import_staging(uuid, uuid, uuid, bigint, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_aal2_reauth_challenge(uuid, uuid, uuid, text, uuid, timestamptz, text, integer)
  to service_role;
grant execute on function public.record_aal2_reauth(uuid, text) to authenticated;
grant execute on function public.has_recent_aal2(integer) to authenticated;
grant execute on function public.family_client_summaries() to authenticated;
grant execute on function public.family_care_summaries(uuid) to authenticated;
grant execute on function public.approve_import_staging(uuid, uuid, uuid, bigint, uuid, text) to authenticated;

revoke all on table private.reauth_events from public, anon, authenticated;
grant select, insert, update on table private.reauth_events to service_role;
grant usage, select on sequence private.reauth_events_id_seq to service_role;

revoke all on table private.reauth_challenges from public, anon, authenticated;
grant select, insert, update on table private.reauth_challenges to service_role;

alter table private.reauth_events enable row level security;
alter table private.reauth_events force row level security;
alter table private.reauth_challenges enable row level security;
alter table private.reauth_challenges force row level security;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'organizations', 'branches', 'profiles', 'permissions', 'roles',
    'memberships', 'clients', 'client_assignments', 'consents',
    'form_definitions', 'form_versions', 'care_records',
    'attendance_records', 'measurements', 'medication_plans',
    'medication_administrations', 'service_events', 'claim_batches',
    'claim_items', 'import_batches', 'import_operations', 'import_fields', 'notifications',
    'notification_deliveries', 'sync_operations'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      v_table || '_set_updated_at',
      v_table
    );
  end loop;

  foreach v_table in array array[
    'organizations', 'branches', 'profiles', 'roles', 'role_permissions',
    'memberships', 'membership_roles', 'clients', 'client_assignments',
    'consents', 'form_definitions', 'form_versions', 'care_records',
    'attendance_records', 'measurements', 'medication_plans',
    'medication_administrations', 'service_events', 'claim_batches',
    'claim_items', 'import_batches', 'import_operations', 'import_fields', 'notifications',
    'notification_deliveries', 'sync_operations'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.prevent_key_change()',
      v_table || '_prevent_key_change',
      v_table
    );
  end loop;

  foreach v_table in array array[
    'organizations', 'branches', 'profiles', 'permissions', 'roles',
    'role_permissions', 'memberships', 'membership_roles', 'clients',
    'client_assignments', 'consents', 'form_definitions', 'form_versions',
    'care_records', 'attendance_records', 'measurements',
    'medication_plans', 'medication_administrations', 'service_events',
    'claim_batches', 'claim_items', 'import_batches', 'import_operations', 'import_fields',
    'notifications', 'notification_deliveries', 'sync_operations'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change()',
      v_table || '_audit_row_change',
      v_table
    );
  end loop;
end;
$triggers$;

create trigger reauth_events_set_updated_at
before update on private.reauth_events
for each row execute function private.set_updated_at();

create trigger profiles_protect_self_update
before update on public.profiles
for each row execute function private.protect_profile_self_update();

create trigger membership_roles_validate_scope
before insert or update on public.membership_roles
for each row execute function private.validate_membership_role_scope();

create trigger care_records_validate_form_scope
before insert or update on public.care_records
for each row execute function private.validate_care_record_form_scope();

create trigger medication_administrations_enforce_verification
before insert or update on public.medication_administrations
for each row execute function private.enforce_medication_verification();

create trigger notification_deliveries_validate_scope
before insert or update on public.notification_deliveries
for each row execute function private.validate_notification_delivery_scope();

create trigger form_versions_prevent_published_mutation
before update or delete on public.form_versions
for each row execute function private.prevent_published_form_mutation();

create trigger import_batches_prevent_final_mutation
before update or delete on public.import_batches
for each row execute function private.prevent_final_import_mutation();

create trigger import_fields_protect_final_batch
before update or delete on public.import_fields
for each row execute function private.protect_final_import_field();

create trigger import_operations_prevent_final_mutation
before update or delete on public.import_operations
for each row execute function private.protect_final_import_operation();

create trigger claim_batches_protect_snapshot
before update or delete on public.claim_batches
for each row execute function private.protect_claim_batch_snapshot();

create trigger claim_items_protect_snapshot
before update or delete on public.claim_items
for each row execute function private.protect_claim_item_snapshot();

create trigger care_records_prevent_signed_mutation
before update or delete on public.care_records
for each row execute function private.prevent_signed_mutation();

create trigger attendance_records_prevent_signed_mutation
before update or delete on public.attendance_records
for each row execute function private.prevent_signed_mutation();

create trigger medication_plans_prevent_signed_mutation
before update or delete on public.medication_plans
for each row execute function private.prevent_signed_mutation();

create trigger medication_administrations_prevent_signed_mutation
before update or delete on public.medication_administrations
for each row execute function private.prevent_signed_mutation();

create trigger service_events_prevent_signed_mutation
before update or delete on public.service_events
for each row execute function private.prevent_signed_mutation();

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'organizations', 'branches', 'profiles', 'permissions', 'roles',
    'role_permissions', 'memberships', 'membership_roles', 'clients',
    'client_assignments', 'consents', 'form_definitions', 'form_versions',
    'care_records', 'attendance_records', 'measurements',
    'medication_plans', 'medication_administrations', 'service_events',
    'claim_batches', 'claim_items', 'import_batches', 'import_operations', 'import_fields',
    'notifications', 'notification_deliveries', 'sync_operations',
    'audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
  end loop;
end;
$rls$;

create policy organizations_select
on public.organizations for select
to authenticated
using ((select private.is_active_member(id, null)));

create policy branches_select
on public.branches for select
to authenticated
using ((select private.is_active_member(organization_id, id)));

create policy branches_insert
on public.branches for insert
to authenticated
with check (
  (select private.has_permission(organization_id, null, 'branches.manage'))
  and (select private.has_recent_aal2(15))
);

create policy branches_update
on public.branches for update
to authenticated
using (
  (select private.has_permission(organization_id, id, 'branches.manage'))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.has_permission(organization_id, id, 'branches.manage'))
  and (select private.has_recent_aal2(15))
);

create policy profiles_select
on public.profiles for select
to authenticated
using ((select private.can_access_profile(id)));

create policy profiles_update
on public.profiles for update
to authenticated
using (
  (
    id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (
    (select private.can_access_profile(id))
    and (select private.has_recent_aal2(15))
  )
)
with check (
  (
    id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (
    (select private.can_access_profile(id))
    and (select private.has_recent_aal2(15))
  )
);

create policy permissions_select
on public.permissions for select
to authenticated
using ((select private.is_active_user()));

create policy roles_select
on public.roles for select
to authenticated
using (
  ((select private.is_active_user()) and is_system)
  or (organization_id is not null and (select private.is_active_member(organization_id, null)))
);

create policy roles_insert
on public.roles for insert
to authenticated
with check (
  not is_system
  and organization_id is not null
  and (select private.has_permission(organization_id, null, 'roles.manage'))
  and (select private.has_recent_aal2(15))
);

create policy roles_update
on public.roles for update
to authenticated
using (
  (select private.can_manage_role(id))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.can_manage_role(id))
  and (select private.has_recent_aal2(15))
);

create policy roles_delete
on public.roles for delete
to authenticated
using (
  (select private.can_manage_role(id))
  and (select private.has_recent_aal2(15))
);

create policy role_permissions_select
on public.role_permissions for select
to authenticated
using ((select private.can_read_role(role_id)));

create policy role_permissions_insert
on public.role_permissions for insert
to authenticated
with check (
  (select private.can_manage_role(role_id))
  and (select private.has_recent_aal2(15))
);

create policy role_permissions_update
on public.role_permissions for update
to authenticated
using (
  (select private.can_manage_role(role_id))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.can_manage_role(role_id))
  and (select private.has_recent_aal2(15))
);

create policy role_permissions_delete
on public.role_permissions for delete
to authenticated
using (
  (select private.can_manage_role(role_id))
  and (select private.has_recent_aal2(15))
);

create policy memberships_select
on public.memberships for select
to authenticated
using (
  (
    profile_id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (select private.has_permission(organization_id, branch_id, 'memberships.manage'))
);

create policy memberships_insert
on public.memberships for insert
to authenticated
with check (
  (select private.has_permission(organization_id, branch_id, 'memberships.manage'))
  and (select private.has_recent_aal2(15))
);

create policy memberships_update
on public.memberships for update
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'memberships.manage'))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.has_permission(organization_id, branch_id, 'memberships.manage'))
  and (select private.has_recent_aal2(15))
);

create policy membership_roles_select
on public.membership_roles for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.id = membership_id
      and (
        (
          m.profile_id = (select auth.uid())
          and (select private.is_active_user())
        )
        or (select private.has_permission(m.organization_id, m.branch_id, 'memberships.manage'))
      )
  )
);

create policy membership_roles_insert
on public.membership_roles for insert
to authenticated
with check (
  (select private.can_manage_membership_role(membership_id, role_id))
  and assigned_by = (select auth.uid())
  and (select private.has_recent_aal2(15))
);

create policy membership_roles_update
on public.membership_roles for update
to authenticated
using (
  (select private.can_manage_membership_role(membership_id, role_id))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.can_manage_membership_role(membership_id, role_id))
  and assigned_by = (select auth.uid())
  and (select private.has_recent_aal2(15))
);

create policy membership_roles_delete
on public.membership_roles for delete
to authenticated
using (
  (select private.can_manage_membership_role(membership_id, role_id))
  and (select private.has_recent_aal2(15))
);

create policy clients_select
on public.clients for select
to authenticated
using ((select private.can_staff_access_client(id, 'clients.read')));

create policy clients_insert
on public.clients for insert
to authenticated
with check ((select private.has_permission(organization_id, branch_id, 'clients.manage')));

create policy clients_update
on public.clients for update
to authenticated
using ((select private.can_staff_access_client(id, 'clients.manage')))
with check ((select private.can_staff_access_client(id, 'clients.manage')));

create policy client_assignments_select
on public.client_assignments for select
to authenticated
using (
  (
    assignee_user_id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (select private.can_staff_access_client(client_id, 'clients.assign'))
);

create policy client_assignments_insert
on public.client_assignments for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'clients.assign'))
  and (select private.has_recent_aal2(15))
);

create policy client_assignments_update
on public.client_assignments for update
to authenticated
using (
  (select private.can_staff_access_client(client_id, 'clients.assign'))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.can_staff_access_client(client_id, 'clients.assign'))
  and (select private.has_recent_aal2(15))
);

create policy consents_select
on public.consents for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'consents.manage')));

create policy consents_insert
on public.consents for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'consents.manage'))
  and (select private.has_recent_aal2(15))
);

create policy consents_update
on public.consents for update
to authenticated
using (
  (select private.can_staff_access_client(client_id, 'consents.manage'))
  and (select private.has_recent_aal2(15))
)
with check (
  (select private.can_staff_access_client(client_id, 'consents.manage'))
  and (select private.has_recent_aal2(15))
);

create policy form_definitions_select
on public.form_definitions for select
to authenticated
using (
  organization_id is null
  or (select private.is_active_member(organization_id, null))
);

create policy form_definitions_insert
on public.form_definitions for insert
to authenticated
with check (
  not is_official
  and organization_id is not null
  and (select private.has_permission(organization_id, null, 'forms.manage'))
  and (select private.has_recent_aal2(15))
);

create policy form_definitions_update
on public.form_definitions for update
to authenticated
using (
  not is_official
  and organization_id is not null
  and (select private.has_permission(organization_id, null, 'forms.manage'))
  and (select private.has_recent_aal2(15))
)
with check (
  not is_official
  and organization_id is not null
  and (select private.has_permission(organization_id, null, 'forms.manage'))
  and (select private.has_recent_aal2(15))
);

create policy form_versions_select
on public.form_versions for select
to authenticated
using ((select private.can_read_form_definition(form_definition_id)));

create policy form_versions_insert
on public.form_versions for insert
to authenticated
with check (
  (select private.can_manage_form_definition(form_definition_id))
  and (status = 'draft' or (select private.has_recent_aal2(15)))
);

create policy form_versions_update
on public.form_versions for update
to authenticated
using (
  (select private.can_manage_form_definition(form_definition_id))
  and (status = 'draft' or (select private.has_recent_aal2(15)))
)
with check (
  (select private.can_manage_form_definition(form_definition_id))
  and (status = 'draft' or (select private.has_recent_aal2(15)))
);

create policy care_records_select
on public.care_records for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'care_records.read')));

create policy care_records_insert
on public.care_records for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'care_records.write'))
  and (
    status = 'draft'
    or (
      (select private.has_permission(organization_id, branch_id, 'care_records.sign'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy care_records_update
on public.care_records for update
to authenticated
using (
  status = 'draft'
  and (select private.can_staff_access_client(client_id, 'care_records.write'))
)
with check (
  (select private.can_staff_access_client(client_id, 'care_records.write'))
  and (
    status = 'draft'
    or (
      (select private.has_permission(organization_id, branch_id, 'care_records.sign'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy attendance_records_select
on public.attendance_records for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'attendance.read')));

create policy attendance_records_insert
on public.attendance_records for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'attendance.write'))
  and recorded_by = (select auth.uid())
  and (
    correction_of_id is null
    or (
      (select private.has_permission(organization_id, branch_id, 'attendance.correct'))
      and (select private.has_recent_aal2(15))
    )
  )
  and (
    signed_at is null
    or (select private.has_recent_aal2(15))
  )
);

create policy attendance_records_update
on public.attendance_records for update
to authenticated
using (
  signed_at is null
  and (select private.can_staff_access_client(client_id, 'attendance.write'))
)
with check (
  (select private.can_staff_access_client(client_id, 'attendance.write'))
  and (signed_at is null or (select private.has_recent_aal2(15)))
);

create policy measurements_select
on public.measurements for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'health.read')));

create policy measurements_insert
on public.measurements for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'health.write'))
  and (recorded_by is null or recorded_by = (select auth.uid()))
);

create policy measurements_update
on public.measurements for update
to authenticated
using (
  recorded_by = (select auth.uid())
  and (select private.can_staff_access_client(client_id, 'health.write'))
)
with check (
  recorded_by = (select auth.uid())
  and (select private.can_staff_access_client(client_id, 'health.write'))
);

create policy medication_plans_select
on public.medication_plans for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'medications.read')));

create policy medication_plans_insert
on public.medication_plans for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'medications.manage'))
  and created_by = (select auth.uid())
  and (signed_at is null or (select private.has_recent_aal2(15)))
);

create policy medication_plans_update
on public.medication_plans for update
to authenticated
using (
  signed_at is null
  and (select private.can_staff_access_client(client_id, 'medications.manage'))
)
with check (
  (select private.can_staff_access_client(client_id, 'medications.manage'))
  and (signed_at is null or (select private.has_recent_aal2(15)))
);

create policy medication_administrations_select
on public.medication_administrations for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'medications.read')));

create policy medication_administrations_insert
on public.medication_administrations for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'medications.administer'))
  and (recorded_by is null or recorded_by = (select auth.uid()))
  and (signed_at is null or (select private.has_recent_aal2(15)))
  and (
    second_verified_by is null
    or (
      second_verified_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'medications.verify'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy medication_administrations_update
on public.medication_administrations for update
to authenticated
using (
  signed_at is null
  and (
    (select private.can_staff_access_client(client_id, 'medications.administer'))
    or (select private.can_staff_access_client(client_id, 'medications.verify'))
  )
)
with check (
  (
    (select private.can_staff_access_client(client_id, 'medications.administer'))
    or (select private.can_staff_access_client(client_id, 'medications.verify'))
  )
  and (signed_at is null or (select private.has_recent_aal2(15)))
  and (
    second_verified_by is null
    or (
      second_verified_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'medications.verify'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy service_events_select
on public.service_events for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'services.read')));

create policy service_events_insert
on public.service_events for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'services.write'))
  and (staff_user_id is null or staff_user_id = (select auth.uid()))
  and (
    signed_at is null
    or (
      (select private.has_permission(organization_id, branch_id, 'services.sign'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy service_events_update
on public.service_events for update
to authenticated
using (
  signed_at is null
  and (select private.can_staff_access_client(client_id, 'services.write'))
)
with check (
  (select private.can_staff_access_client(client_id, 'services.write'))
  and (
    signed_at is null
    or (
      (select private.has_permission(organization_id, branch_id, 'services.sign'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy claim_batches_select
on public.claim_batches for select
to authenticated
using ((select private.has_permission(organization_id, branch_id, 'claims.read')));

create policy claim_batches_insert
on public.claim_batches for insert
to authenticated
with check (
  status = 'draft'
  and (select private.has_permission(organization_id, branch_id, 'claims.manage'))
  and created_by = (select auth.uid())
);

create policy claim_batches_update
on public.claim_batches for update
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'claims.manage'))
  and (status in ('draft', 'validated') or (select private.has_recent_aal2(15)))
)
with check (
  (select private.has_permission(organization_id, branch_id, 'claims.manage'))
  and (
    status in ('draft', 'validated')
    or (
      (select private.has_permission(organization_id, branch_id, 'claims.export'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy claim_items_select
on public.claim_items for select
to authenticated
using ((select private.has_permission(organization_id, branch_id, 'claims.read')));

create policy claim_items_insert
on public.claim_items for insert
to authenticated
with check ((select private.claim_batch_is_editable(claim_batch_id, organization_id, branch_id)));

create policy claim_items_update
on public.claim_items for update
to authenticated
using ((select private.claim_batch_is_editable(claim_batch_id, organization_id, branch_id)))
with check ((select private.claim_batch_is_editable(claim_batch_id, organization_id, branch_id)));

create policy import_batches_select
on public.import_batches for select
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  or (select private.has_permission(organization_id, branch_id, 'imports.approve'))
);

create policy import_batches_insert
on public.import_batches for insert
to authenticated
with check (
  (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  and (select private.has_recent_aal2(15))
  and uploaded_by = (select auth.uid())
  and status = 'queued'
);

create policy import_batches_update
on public.import_batches for update
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  and (status <> 'imported' or (select private.has_recent_aal2(15)))
)
with check (
  (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  and (
    status <> 'imported'
    or (
      (select private.has_permission(organization_id, branch_id, 'imports.approve'))
      and approved_by = (select auth.uid())
      and approved_at is not null
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy import_operations_select
on public.import_operations for select
to authenticated
using (
  (
    actor_user_id = (select auth.uid())
    or (select private.has_permission(organization_id, branch_id, 'imports.approve'))
  )
  and (
    (select private.has_permission(organization_id, branch_id, 'imports.manage'))
    or (select private.has_permission(organization_id, branch_id, 'imports.approve'))
  )
);

create policy import_operations_insert
on public.import_operations for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and status = 'pending'
  and (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  and (operation_kind <> 'approve'
       or (select private.has_permission(organization_id, branch_id, 'imports.approve')))
  and (select private.has_recent_aal2(15))
);

create policy import_operations_update
on public.import_operations for update
to authenticated
using (
  status = 'pending'
  and actor_user_id = (select auth.uid())
  and (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  and (operation_kind <> 'approve'
       or (select private.has_permission(organization_id, branch_id, 'imports.approve')))
  and (select private.has_recent_aal2(15))
)
with check (
  actor_user_id = (select auth.uid())
  and (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  and (operation_kind <> 'approve'
       or (select private.has_permission(organization_id, branch_id, 'imports.approve')))
  and (select private.has_recent_aal2(15))
);

create policy import_fields_select
on public.import_fields for select
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'imports.manage'))
  or (select private.has_permission(organization_id, branch_id, 'imports.approve'))
);

create policy import_fields_insert
on public.import_fields for insert
to authenticated
with check ((select private.import_batch_is_editable(import_batch_id, organization_id, branch_id)));

create policy import_fields_update
on public.import_fields for update
to authenticated
using ((select private.import_batch_is_editable(import_batch_id, organization_id, branch_id)))
with check ((select private.import_batch_is_editable(import_batch_id, organization_id, branch_id)));

create policy notifications_select
on public.notifications for select
to authenticated
using ((select private.has_permission(organization_id, branch_id, 'notifications.read')));

create policy notifications_insert
on public.notifications for insert
to authenticated
with check (
  (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
  and created_by = (select auth.uid())
  and (status = 'draft' or (select private.has_recent_aal2(15)))
);

create policy notifications_update
on public.notifications for update
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
  and (status = 'draft' or (select private.has_recent_aal2(15)))
)
with check (
  (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
  and (status = 'draft' or (select private.has_recent_aal2(15)))
);

create policy notification_deliveries_select
on public.notification_deliveries for select
to authenticated
using (
  (
    recipient_user_id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
);

create policy notification_deliveries_insert
on public.notification_deliveries for insert
to authenticated
with check (
  (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
  and (select private.has_recent_aal2(15))
);

create policy notification_deliveries_update
on public.notification_deliveries for update
to authenticated
using (
  (
    recipient_user_id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
)
with check (
  (
    recipient_user_id = (select auth.uid())
    and (select private.is_active_user())
  )
  or (select private.has_permission(organization_id, branch_id, 'notifications.manage'))
);

create policy sync_operations_select
on public.sync_operations for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.has_permission(organization_id, branch_id, 'sync.use'))
);

create policy sync_operations_insert
on public.sync_operations for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and (select private.has_permission(organization_id, branch_id, 'sync.use'))
  and occurred_at >= clock_timestamp() - interval '24 hours'
  and occurred_at <= clock_timestamp() + interval '5 minutes'
);

create policy audit_events_select
on public.audit_events for select
to authenticated
using (
  organization_id is not null
  and (select private.has_permission(organization_id, branch_id, 'audit.view'))
  and (select private.has_recent_aal2(15))
);

-- Start from no client privileges, then opt each operation back in. This is
-- separate from RLS: grants decide whether PostgREST exposes an operation;
-- policies decide which tenant rows that operation may touch.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

grant select on table
  public.organizations,
  public.permissions,
  public.audit_events
to authenticated;

grant select, insert, update on table
  public.branches,
  public.profiles,
  public.memberships,
  public.clients,
  public.client_assignments,
  public.consents,
  public.form_definitions,
  public.form_versions,
  public.care_records,
  public.attendance_records,
  public.measurements,
  public.medication_plans,
  public.medication_administrations,
  public.service_events,
  public.claim_batches,
  public.claim_items,
  public.import_fields,
  public.notifications,
  public.notification_deliveries
to authenticated;

grant select, insert on table public.import_batches to authenticated;
grant select on table public.import_operations to authenticated;

grant select, insert, update, delete on table
  public.roles,
  public.role_permissions,
  public.membership_roles
to authenticated;

grant select, insert on table public.sync_operations to authenticated;
grant usage, select on sequence public.import_fields_id_seq to authenticated;

revoke update on table public.notification_deliveries from authenticated;
grant update (status, read_at, confirmed_at, updated_at)
on table public.notification_deliveries to authenticated;

-- No application role may modify or delete the append-only audit ledger.
revoke insert, update, delete, truncate on table public.audit_events from authenticated;

-- Frontends read one RLS-preserving interface instead of joining membership,
-- role, and permission tables in the browser. security_invoker keeps every
-- underlying table policy active and the explicit auth.uid predicate limits
-- the interface to the current user.
create view public.active_memberships
with (security_invoker = true, security_barrier = true)
as
select
  m.organization_id,
  m.branch_id,
  p.display_name,
  coalesce(
    array_agg(distinct r.role_key order by r.role_key)
      filter (where r.role_key is not null),
    '{}'::text[]
  ) as role_keys,
  coalesce(
    array_agg(distinct permission.permission_key order by permission.permission_key)
      filter (where permission.permission_key is not null),
    '{}'::text[]
  ) as scopes,
  m.profile_id as user_id
from public.memberships m
join public.profiles p on p.id = m.profile_id
left join public.membership_roles mr on mr.membership_id = m.id
left join public.roles r on r.id = mr.role_id and r.is_active
left join public.role_permissions rp on rp.role_id = r.id
left join public.permissions permission on permission.id = rp.permission_id
where m.profile_id = (select auth.uid())
  and (select private.is_active_user())
  and p.is_active
  and m.status = 'active'
  and m.starts_at <= now()
  and (m.ends_at is null or m.ends_at > now())
group by
  m.id,
  m.organization_id,
  m.branch_id,
  p.display_name,
  m.profile_id;

comment on view public.active_memberships is
  'RLS-preserving current-user tenant context for server and browser clients.';

revoke all on table public.active_memberships from public, anon, authenticated, service_role;
grant select on table public.active_memberships to authenticated;
