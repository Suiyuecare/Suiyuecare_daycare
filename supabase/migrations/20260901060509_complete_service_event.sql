-- Page 53: atomically complete and sign one executed service event.
--
-- The caller supplies only the client, service facts, narrow evidence fields,
-- and an actor-scoped idempotency key. Tenant scope, actor, current signed
-- service plan, current signed authorization, signature time, purpose, and
-- content hash are all resolved in the database transaction.

alter table public.service_events
  add column signature_purpose text;

alter table public.service_events
  add column signature_reauth_challenge_id uuid;

alter table public.service_events
  add constraint service_events_signature_purpose_check check (
    signature_purpose is null
    or char_length(btrim(signature_purpose)) between 1 and 240
  );

alter table public.service_events
  add constraint service_events_signature_reauth_challenge_fkey
    foreign key (signature_reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  add constraint service_events_signature_reauth_evidence_check check (
    signature_reauth_challenge_id is null
    or (signed_at is not null and signed_by is not null)
  ),
  add constraint service_events_dedicated_signature_evidence_check check (
    signature_purpose is distinct from '完成服務與執行證據簽署'
    or signature_reauth_challenge_id is not null
  );

create index service_events_signature_reauth_challenge_idx
  on public.service_events (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;

comment on column public.service_events.signature_purpose is
  'Server-authored signing purpose. Legacy signed rows may be null; the dedicated completion RPC always supplies it.';

comment on column public.service_events.signature_reauth_challenge_id is
  'Immutable consumed reauthentication challenge supporting this signature. Legacy rows may be null; the dedicated completion RPC always supplies it.';

-- reauth_events is intentionally a mutable current-session pointer. Signed
-- business records instead reference the consumed challenge itself. Preserve
-- that historical evidence by allowing only the one pending-to-terminal state
-- transition used by challenge issuance/consumption; terminal rows cannot be
-- rewritten or deleted afterwards.
create or replace function private.protect_reauth_challenge_terminal_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.consumed_at is not null or old.invalidated_at is not null then
      raise exception using
        errcode = '55000',
        message = 'terminal reauthentication challenge evidence is immutable';
    end if;
    return old;
  end if;

  if old.consumed_at is not null or old.invalidated_at is not null then
    raise exception using
      errcode = '55000',
      message = 'terminal reauthentication challenge evidence is immutable';
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.session_id is distinct from old.session_id
     or new.nonce_sha256 is distinct from old.nonce_sha256
     or new.idempotency_key is distinct from old.idempotency_key
     or new.issued_jwt_iat is distinct from old.issued_jwt_iat
     or new.issued_jwt_jti is distinct from old.issued_jwt_jti
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception using
      errcode = '55000',
      message = 'reauthentication challenge issuance identity is immutable';
  end if;

  return new;
end;
$$;

create trigger reauth_challenges_protect_terminal_evidence
before update or delete on private.reauth_challenges
for each row execute function private.protect_reauth_challenge_terminal_evidence();

create table private.service_event_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  service_event_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint service_event_operations_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint service_event_operations_event_scope_fkey
    foreign key (service_event_id, organization_id, branch_id, client_id)
    references public.service_events(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint service_event_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint service_event_operations_event_key unique (service_event_id),
  constraint service_event_operations_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$')
);

comment on table private.service_event_operations is
  'Append-only exact-replay ledger for the dedicated completed-and-signed service workflow.';

create index service_event_operations_client_created_idx
  on private.service_event_operations (
    organization_id,
    branch_id,
    client_id,
    created_at desc
  );

alter table private.service_event_operations enable row level security;
alter table private.service_event_operations force row level security;

create or replace function private.prevent_service_event_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'service event operation history is immutable';
end;
$$;

create trigger service_event_operations_prevent_mutation
before update or delete on private.service_event_operations
for each row execute function private.prevent_service_event_operation_mutation();

create trigger service_event_operations_audit_insert
after insert on private.service_event_operations
for each row execute function private.audit_row_change();

create or replace function private.service_event_row_idempotency(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid
)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  with digest_value as (
    select encode(
      sha256(
        convert_to(
          p_organization_id::text || ':' ||
          p_actor_user_id::text || ':' ||
          p_idempotency_key::text,
          'UTF8'
        )
      ),
      'hex'
    ) as value
  )
  select (
    substr(value, 1, 8) || '-' ||
    substr(value, 9, 4) || '-5' ||
    substr(value, 14, 3) || '-8' ||
    substr(value, 18, 3) || '-' ||
    substr(value, 21, 12)
  )::uuid
  from digest_value;
$$;

create or replace function private.complete_service_event_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_service_code text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_result text,
  p_notes text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  service_event_id uuid,
  client_id uuid,
  authorized_care_plan_id uuid,
  client_service_plan_id uuid,
  service_code text,
  status public.service_event_status,
  started_at timestamptz,
  ended_at timestamptz,
  signed_at timestamptz,
  signed_by uuid,
  signature_purpose text,
  signature_reauth_challenge_id uuid,
  content_hash text,
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
  v_service_date date;
  v_service_code text := upper(btrim(p_service_code));
  v_result text := btrim(p_result);
  v_notes text := nullif(btrim(p_notes), '');
  v_evidence jsonb;
  v_signature_purpose constant text := '完成服務與執行證據簽署';
  v_request_hash text;
  v_content_hash text;
  v_row_idempotency uuid;
  v_client public.clients%rowtype;
  v_authorized public.authorized_care_plans%rowtype;
  v_service_plan public.client_service_plans%rowtype;
  v_signature_challenge private.reauth_challenges%rowtype;
  v_event public.service_events%rowtype;
  v_existing private.service_event_operations%rowtype;
  v_operation private.service_event_operations%rowtype;
  v_authorized_id uuid;
  v_service_plan_id uuid;
  v_authorized_count integer;
  v_service_plan_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null then
    raise exception using
      errcode = '42501',
      message = 'service completion requires an explicit authorized tenant context';
  end if;

  if p_client_id is null
     or p_service_code is null
     or p_started_at is null
     or p_ended_at is null
     or p_result is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'client, service code, time range, result, and idempotency key are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'recent AAL2 reauthentication is required to complete and sign a service';
  end if;

  if v_service_code !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then
    raise exception using
      errcode = '22023',
      message = 'service code must contain one to forty allowed characters';
  end if;

  if char_length(v_result) not between 1 and 240
     or (v_notes is not null and char_length(v_notes) > 2000) then
    raise exception using
      errcode = '22023',
      message = 'service result or notes exceed the allowed size';
  end if;

  if p_ended_at < p_started_at then
    raise exception using
      errcode = '22023',
      message = 'service end time cannot precede its start time';
  end if;

  v_service_date := (p_started_at at time zone 'Asia/Taipei')::date;
  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'result', v_result,
    'notes', v_notes
  ));

  if jsonb_typeof(v_evidence) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(v_evidence) as evidence_key
       where evidence_key not in ('result', 'notes')
     )
     or octet_length(v_evidence::text) > 4096 then
    raise exception using
      errcode = '22023',
      message = 'service evidence exceeds the allowed shape or size';
  end if;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'expected_organization_id', p_expected_organization_id,
          'expected_branch_id', p_expected_branch_id,
          'client_id', p_client_id,
          'service_code', v_service_code,
          'started_at', to_char(
            p_started_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'ended_at', to_char(
            p_ended_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'evidence', v_evidence
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  -- The actor/key lock and global unique key prevent two concurrent requests
  -- from using the same retry token in different tenants or clients.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'service-event-operation:' || v_actor::text || ':' ||
      p_idempotency_key::text,
      0
    )
  );

  select operation.*
    into v_existing
  from private.service_event_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id then
      raise exception using
        errcode = '42501',
        message = 'service completion does not belong to the selected tenant context';
    end if;

    if v_existing.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'service event idempotency conflict';
    end if;

    select client.*
      into v_client
    from public.clients client
    where client.id = v_existing.client_id
      and client.organization_id = v_existing.organization_id
      and client.branch_id = v_existing.branch_id
    for key share;

    if not found
       or not (select private.can_staff_access_client(v_existing.client_id, 'services.write'))
       or not (select private.has_permission(
         v_existing.organization_id,
         v_existing.branch_id,
         'services.sign'
       )) then
      raise exception using
        errcode = '42501',
        message = 'service completion is not permitted in the current client scope';
    end if;

    select event.*
      into strict v_event
    from public.service_events event
    where event.id = v_existing.service_event_id
      and event.organization_id = v_existing.organization_id
      and event.branch_id = v_existing.branch_id
      and event.client_id = v_existing.client_id;

    select plan.*
      into strict v_service_plan
    from public.client_service_plans plan
    where plan.id = v_event.client_service_plan_id;

    return query
    select
      v_existing.id,
      v_event.id,
      v_event.client_id,
      v_service_plan.authorized_care_plan_id,
      v_event.client_service_plan_id,
      v_event.service_code,
      v_event.status,
      v_event.started_at,
      v_event.ended_at,
      v_event.signed_at,
      v_event.signed_by,
      v_event.signature_purpose,
      v_event.signature_reauth_challenge_id,
      v_event.content_hash,
      true;
    return;
  end if;

  select client.*
    into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.can_staff_access_client(p_client_id, 'services.write'))
     or not (select private.has_permission(
       v_client.organization_id,
       v_client.branch_id,
       'services.sign'
     )) then
    raise exception using
      errcode = '42501',
      message = 'service completion is not permitted in the current client scope';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > v_service_date
     or v_client.ended_on is not null then
    raise exception using
      errcode = '23514',
      message = 'client must be active, admitted, and unended on the service date';
  end if;

  -- Preserve the core-care lock order: service-plan stream, then authorized
  -- plan stream. The base service-event trigger acquires the same locks.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'client-service-plan:' || v_client.organization_id::text || ':' ||
      v_client.branch_id::text || ':' || v_client.id::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'authorized-care-plan:' || v_client.organization_id::text || ':' ||
      v_client.branch_id::text || ':' || v_client.id::text,
      0
    )
  );

  with terminal as (
    select distinct on (plan.plan_key)
      plan.id,
      plan.status
    from public.authorized_care_plans plan
    where plan.organization_id = v_client.organization_id
      and plan.branch_id = v_client.branch_id
      and plan.client_id = v_client.id
      and plan.status in ('signed', 'voided')
      and v_service_date between plan.effective_from and plan.effective_to
    order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
  )
  select
    count(*) filter (where terminal.status = 'signed')::integer,
    min(terminal.id::text) filter (where terminal.status = 'signed')::uuid
  into v_authorized_count, v_authorized_id
  from terminal;

  if v_authorized_count <> 1 or v_authorized_id is null then
    raise exception using
      errcode = '23514',
      message = 'service date requires exactly one current signed authorization';
  end if;

  select plan.*
    into strict v_authorized
  from public.authorized_care_plans plan
  where plan.id = v_authorized_id
    and plan.organization_id = v_client.organization_id
    and plan.branch_id = v_client.branch_id
    and plan.client_id = v_client.id
  for share;

  with terminal as (
    select distinct on (plan.plan_key)
      plan.id,
      plan.authorized_care_plan_id,
      plan.status
    from public.client_service_plans plan
    where plan.organization_id = v_client.organization_id
      and plan.branch_id = v_client.branch_id
      and plan.client_id = v_client.id
      and plan.status in ('signed', 'voided')
      and v_service_date between plan.effective_from and plan.effective_to
    order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
  )
  select
    count(*) filter (where terminal.status = 'signed')::integer,
    min(terminal.id::text) filter (
      where terminal.status = 'signed'
        and terminal.authorized_care_plan_id = v_authorized.id
    )::uuid
  into v_service_plan_count, v_service_plan_id
  from terminal;

  if v_service_plan_count <> 1 or v_service_plan_id is null then
    raise exception using
      errcode = '23514',
      message = 'service date requires exactly one current signed service plan tied to the current authorization';
  end if;

  select plan.*
    into strict v_service_plan
  from public.client_service_plans plan
  where plan.id = v_service_plan_id
    and plan.organization_id = v_client.organization_id
    and plan.branch_id = v_client.branch_id
    and plan.client_id = v_client.id
    and plan.authorized_care_plan_id = v_authorized.id
  for share;

  -- Locks can wait long enough for a previously valid step-up or membership to
  -- expire. Re-evaluate both immediately before authoring the signature so the
  -- signed_at evidence never relies on a stale pre-lock authorization check.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'recent AAL2 reauthentication expired before service signing';
  end if;

  if not (select private.can_staff_access_client(v_client.id, 'services.write'))
     or not (select private.has_permission(
       v_client.organization_id,
       v_client.branch_id,
       'services.sign'
     )) then
    raise exception using
      errcode = '42501',
      message = 'service completion permission expired before service signing';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required before service signing';
  end;

  if v_session_id is null then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required before service signing';
  end if;

  -- Lock the mutable current-session pointer and capture its immutable
  -- consumed challenge. This keeps revocation or a later reauthentication
  -- from racing the signature while retaining a durable, exact audit link.
  select challenge.*
    into v_signature_challenge
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

  -- Capture both the policy and signing time only after every client/plan lock
  -- and final authorization check. Exact replay has already returned above,
  -- while a queued new mutation cannot inherit a stale function-entry clock.
  v_now := clock_timestamp();
  if v_signature_challenge.id is null
     or v_signature_challenge.factor_verified_at is null
     or v_signature_challenge.factor_verified_at < v_now - interval '15 minutes'
     or v_signature_challenge.factor_verified_at > v_now + interval '1 minute' then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required before service signing';
  end if;

  if p_started_at < v_now - interval '24 hours'
     or p_ended_at < v_now - interval '24 hours'
     or p_started_at > v_now + interval '5 minutes'
     or p_ended_at > v_now + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'service times are outside the allowed 24-hour window';
  end if;

  v_content_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', v_client.organization_id,
          'branch_id', v_client.branch_id,
          'client_id', v_client.id,
          'authorized_care_plan_id', v_authorized.id,
          'client_service_plan_id', v_service_plan.id,
          'service_code', v_service_code,
          'started_at', to_char(
            p_started_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'ended_at', to_char(
            p_ended_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'staff_user_id', v_actor,
          'evidence', v_evidence,
          'signed_at', to_char(
            v_now at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'signed_by', v_actor,
          'signature_purpose', v_signature_purpose,
          'signature_reauth_challenge_id', v_signature_challenge.id
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );
  v_row_idempotency := private.service_event_row_idempotency(
    v_client.organization_id,
    v_actor,
    p_idempotency_key
  );

  insert into public.service_events (
    organization_id,
    branch_id,
    client_id,
    client_service_plan_id,
    service_code,
    status,
    started_at,
    ended_at,
    staff_user_id,
    evidence,
    idempotency_key,
    signed_at,
    signed_by,
    signature_purpose,
    signature_reauth_challenge_id,
    content_hash
  ) values (
    v_client.organization_id,
    v_client.branch_id,
    v_client.id,
    v_service_plan.id,
    v_service_code,
    'completed',
    p_started_at,
    p_ended_at,
    v_actor,
    v_evidence,
    v_row_idempotency,
    v_now,
    v_actor,
    v_signature_purpose,
    v_signature_challenge.id,
    v_content_hash
  )
  returning * into v_event;

  insert into private.service_event_operations (
    organization_id,
    branch_id,
    client_id,
    service_event_id,
    actor_user_id,
    idempotency_key,
    request_hash
  ) values (
    v_client.organization_id,
    v_client.branch_id,
    v_client.id,
    v_event.id,
    v_actor,
    p_idempotency_key,
    v_request_hash
  )
  returning * into v_operation;

  return query
  select
    v_operation.id,
    v_event.id,
    v_event.client_id,
    v_authorized.id,
    v_event.client_service_plan_id,
    v_event.service_code,
    v_event.status,
    v_event.started_at,
    v_event.ended_at,
    v_event.signed_at,
    v_event.signed_by,
    v_event.signature_purpose,
    v_event.signature_reauth_challenge_id,
    v_event.content_hash,
    false;
end;
$$;

create or replace function public.complete_service_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_service_code text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_result text,
  p_notes text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  service_event_id uuid,
  client_id uuid,
  authorized_care_plan_id uuid,
  client_service_plan_id uuid,
  service_code text,
  status public.service_event_status,
  started_at timestamptz,
  ended_at timestamptz,
  signed_at timestamptz,
  signed_by uuid,
  signature_purpose text,
  signature_reauth_challenge_id uuid,
  content_hash text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.complete_service_event_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_service_code,
    p_started_at,
    p_ended_at,
    p_result,
    p_notes,
    p_idempotency_key
  );
$$;

comment on function public.complete_service_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) is
  'Atomically records one completed signed service using current server-derived tenant, actor, care plans, immutable reauthentication evidence, evidence hash, signature time, and purpose.';

revoke all on table private.service_event_operations
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_service_event_operation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_reauth_challenge_terminal_evidence()
  from public, anon, authenticated, service_role;
revoke all on function private.service_event_row_idempotency(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_service_event_atomic(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.complete_service_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

-- The private schema is not exposed by PostgREST. Authenticated callers can
-- reach the definer only through the public invoker wrapper, and the definer
-- independently verifies JWT AAL2, recent step-up, client assignment, branch
-- permission, lifecycle, current plans, and exact replay.
grant execute on function private.complete_service_event_atomic(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) to authenticated;
grant execute on function public.complete_service_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) to authenticated;

-- Completed and signed rows may only be created through the transaction above.
-- Existing SELECT continues to be governed by the services.read RLS policy.
revoke insert, update, delete on table public.service_events from authenticated;
