-- Page 81/89 governance boundary: family access grants are append-only,
-- evidence-bound versions. A trusted server registers a short-lived proof;
-- a recent-AAL2 staff member consumes that proof to create one consent; and a
-- separate narrow operation can only revoke, never restore or edit, a grant.

create or replace function private.canonical_family_consent_scopes(
  p_scopes text[]
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    array_agg(distinct lower(btrim(scope)) order by lower(btrim(scope))),
    '{}'::text[]
  )
  from unnest(coalesce(p_scopes, '{}'::text[])) scope
  where nullif(btrim(scope), '') is not null;
$$;

create table private.family_consent_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  relationship text not null,
  scopes text[] not null,
  document_version text not null,
  consent_expires_at timestamptz,
  evidence_hash text not null,
  verification_method text not null default 'phone_otp',
  verified_at timestamptz not null,
  otp_verified_at timestamptz not null,
  relationship_verified_at timestamptz not null,
  explicit_consent_verified_at timestamptz not null,
  expires_at timestamptz not null,
  registration_idempotency_key uuid not null,
  request_hash text not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete restrict,
  consumed_consent_id uuid references public.consents(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint family_consent_verification_evidence_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint family_consent_verification_evidence_relationship_check check (
    relationship = btrim(relationship)
    and char_length(relationship) between 1 and 80
  ),
  constraint family_consent_verification_evidence_scopes_check check (
    cardinality(scopes) between 1 and 7
    and scopes = private.canonical_family_consent_scopes(scopes)
    and scopes <@ array[
      'client.read',
      'care.read',
      'health.summary',
      'schedule.read',
      'billing.read',
      'documents.read',
      'messages.read'
    ]::text[]
    and not ('*' = any(scopes))
  ),
  constraint family_consent_verification_evidence_document_check check (
    document_version = btrim(document_version)
    and char_length(document_version) between 1 and 120
  ),
  constraint family_consent_verification_evidence_hash_check check (
    evidence_hash ~ '^[a-f0-9]{64}$'
    and request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint family_consent_verification_evidence_method_check check (
    verification_method = 'phone_otp'
  ),
  constraint family_consent_verification_evidence_server_times_check check (
    otp_verified_at = verified_at
    and relationship_verified_at = verified_at
    and explicit_consent_verified_at = verified_at
    and created_at = verified_at
    and expires_at > verified_at
    and expires_at <= verified_at + interval '10 minutes'
    and (consent_expires_at is null or consent_expires_at > verified_at)
  ),
  constraint family_consent_verification_evidence_consumption_check check (
    (
      consumed_at is null
      and consumed_by is null
      and consumed_consent_id is null
    )
    or (
      consumed_at is not null
      and consumed_by is not null
      and consumed_consent_id is not null
      and consumed_at >= verified_at
      and consumed_at <= expires_at
    )
  ),
  constraint family_consent_verification_evidence_registration_key
    unique (registration_idempotency_key),
  constraint family_consent_verification_evidence_hash_key
    unique (evidence_hash),
  constraint family_consent_verification_evidence_consumed_consent_key
    unique (consumed_consent_id)
);

comment on table private.family_consent_verification_evidence is
  'Short-lived one-time trusted proof that phone OTP, relationship, and explicit document consent were verified; no OTP value is stored.';

create index family_consent_verification_evidence_scope_idx
  on private.family_consent_verification_evidence (
    organization_id,
    branch_id,
    client_id,
    recipient_user_id,
    expires_at
  );
create index family_consent_verification_evidence_client_idx
  on private.family_consent_verification_evidence (client_id, created_at desc);
create index family_consent_verification_evidence_recipient_idx
  on private.family_consent_verification_evidence (recipient_user_id, created_at desc);
create index family_consent_verification_evidence_consumed_by_idx
  on private.family_consent_verification_evidence (consumed_by)
  where consumed_by is not null;
create index family_consent_verification_evidence_consent_idx
  on private.family_consent_verification_evidence (consumed_consent_id)
  where consumed_consent_id is not null;

alter table private.family_consent_verification_evidence enable row level security;
alter table private.family_consent_verification_evidence force row level security;

create or replace function private.protect_family_consent_verification_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'family consent verification evidence is immutable';
  end if;

  if old.consumed_at is not null
     or new.consumed_at is null
     or new.consumed_by is null
     or new.consumed_consent_id is null
     or (
       to_jsonb(new)
         - 'consumed_at'
         - 'consumed_by'
         - 'consumed_consent_id'
     ) is distinct from (
       to_jsonb(old)
         - 'consumed_at'
         - 'consumed_by'
         - 'consumed_consent_id'
     ) then
    raise exception using
      errcode = '55000',
      message = 'family consent verification evidence identity is immutable';
  end if;

  return new;
end;
$$;

create trigger family_consent_verification_evidence_protect
before update or delete on private.family_consent_verification_evidence
for each row execute function private.protect_family_consent_verification_evidence();

create trigger family_consent_verification_evidence_audit_row_change
after insert or update or delete on private.family_consent_verification_evidence
for each row execute function private.audit_row_change();

alter table public.consents
  add column workflow_version smallint,
  add column verification_evidence_id uuid,
  add column grant_reauth_challenge_id uuid,
  add column grant_idempotency_key uuid,
  add column grant_request_hash text,
  add column supersedes_consent_id uuid;

alter table public.consents
  add constraint consents_verification_evidence_fkey
    foreign key (verification_evidence_id)
    references private.family_consent_verification_evidence(id) on delete restrict,
  add constraint consents_grant_reauth_challenge_fkey
    foreign key (grant_reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  add constraint consents_supersedes_fkey
    foreign key (supersedes_consent_id)
    references public.consents(id) on delete restrict,
  add constraint consents_workflow_completeness_check check (
    (
      workflow_version is null
      and verification_evidence_id is null
      and grant_reauth_challenge_id is null
      and grant_idempotency_key is null
      and grant_request_hash is null
      and supersedes_consent_id is null
    )
    or (
      workflow_version = 1
      and verification_evidence_id is not null
      and grant_reauth_challenge_id is not null
      and grant_idempotency_key is not null
      and grant_request_hash ~ '^[a-f0-9]{64}$'
      and created_by is not null
    )
  ),
  add constraint consents_governed_content_check check (
    workflow_version is null
    or (
      relationship = btrim(relationship)
      and char_length(relationship) between 1 and 80
      and scopes = private.canonical_family_consent_scopes(scopes)
      and cardinality(scopes) between 1 and 7
      and scopes <@ array[
        'client.read',
        'care.read',
        'health.summary',
        'schedule.read',
        'billing.read',
        'documents.read',
        'messages.read'
      ]::text[]
      and not ('*' = any(scopes))
      and document_version = btrim(document_version)
      and char_length(document_version) between 1 and 120
      and evidence_hash ~ '^[a-f0-9]{64}$'
    )
  ),
  add constraint consents_id_scope_recipient_key
    unique (id, organization_id, branch_id, client_id, recipient_user_id);

comment on column public.consents.workflow_version is
  'NULL identifies legacy rows; version 1 rows are complete immutable evidence-bound grants.';
comment on column public.consents.supersedes_consent_id is
  'Optional previous revoked grant in the append-only version chain.';

create unique index consents_workflow_evidence_key
  on public.consents (verification_evidence_id)
  where verification_evidence_id is not null;
create unique index consents_workflow_actor_idempotency_key
  on public.consents (created_by, grant_idempotency_key)
  where workflow_version = 1;
create unique index consents_workflow_document_version_key
  on public.consents (client_id, recipient_user_id, document_version)
  where workflow_version = 1;
create unique index consents_workflow_active_subject_key
  on public.consents (client_id, recipient_user_id)
  where workflow_version = 1 and revoked_at is null;
create index consents_verification_evidence_idx
  on public.consents (verification_evidence_id)
  where verification_evidence_id is not null;
create index consents_grant_reauth_challenge_idx
  on public.consents (grant_reauth_challenge_id)
  where grant_reauth_challenge_id is not null;
create index consents_supersedes_idx
  on public.consents (supersedes_consent_id)
  where supersedes_consent_id is not null;

create table private.consent_revocation_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  consent_id uuid not null,
  recipient_user_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  revoked_at timestamptz not null,
  created_at timestamptz not null,
  constraint consent_revocation_operations_consent_scope_fkey
    foreign key (
      consent_id,
      organization_id,
      branch_id,
      client_id,
      recipient_user_id
    ) references public.consents (
      id,
      organization_id,
      branch_id,
      client_id,
      recipient_user_id
    ) on delete restrict,
  constraint consent_revocation_operations_reason_check check (
    reason = btrim(reason)
    and char_length(reason) between 1 and 1000
  ),
  constraint consent_revocation_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint consent_revocation_operations_time_check check (
    created_at = revoked_at
  ),
  constraint consent_revocation_operations_actor_key
    unique (actor_user_id, idempotency_key),
  constraint consent_revocation_operations_consent_key
    unique (consent_id)
);

comment on table private.consent_revocation_operations is
  'Immutable exact-replay ledger for the single irreversible revocation of a family consent.';

create index consent_revocation_operations_scope_idx
  on private.consent_revocation_operations (
    organization_id,
    branch_id,
    client_id,
    revoked_at desc
  );
create index consent_revocation_operations_client_idx
  on private.consent_revocation_operations (client_id, revoked_at desc);
create index consent_revocation_operations_consent_idx
  on private.consent_revocation_operations (consent_id);
create index consent_revocation_operations_recipient_idx
  on private.consent_revocation_operations (recipient_user_id, revoked_at desc);
create index consent_revocation_operations_actor_idx
  on private.consent_revocation_operations (actor_user_id, revoked_at desc);
create index consent_revocation_operations_challenge_idx
  on private.consent_revocation_operations (reauth_challenge_id);

alter table private.consent_revocation_operations enable row level security;
alter table private.consent_revocation_operations force row level security;

create or replace function private.prevent_consent_revocation_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'consent revocation history is immutable';
end;
$$;

create trigger consent_revocation_operations_prevent_mutation
before update or delete on private.consent_revocation_operations
for each row execute function private.prevent_consent_revocation_operation_mutation();

create trigger consent_revocation_operations_audit_insert
after insert on private.consent_revocation_operations
for each row execute function private.audit_row_change();

create or replace function private.protect_consent_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'family consent history cannot be deleted';
  end if;

  if old.revoked_at is null
     and new.revoked_at is not null
     and (
       to_jsonb(new) - 'revoked_at' - 'updated_at'
     ) is not distinct from (
       to_jsonb(old) - 'revoked_at' - 'updated_at'
     ) then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'family consent versions are immutable and revocation is irreversible';
end;
$$;

create trigger consents_protect_history
before update or delete on public.consents
for each row execute function private.protect_consent_history();

create or replace function private.register_family_consent_verification_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_recipient_user_id uuid,
  p_relationship text,
  p_scopes text[],
  p_document_version text,
  p_consent_expires_at timestamptz,
  p_evidence_hash text,
  p_idempotency_key uuid
)
returns table(
  verification_evidence_id uuid,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_relationship text := btrim(p_relationship);
  v_scopes text[] := private.canonical_family_consent_scopes(p_scopes);
  v_document_version text := btrim(p_document_version);
  v_evidence_hash text := lower(btrim(p_evidence_hash));
  v_request_hash text;
  v_now timestamptz;
  v_existing private.family_consent_verification_evidence%rowtype;
  v_created private.family_consent_verification_evidence%rowtype;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_recipient_user_id is null
     or p_relationship is null
     or p_scopes is null
     or p_document_version is null
     or p_evidence_hash is null
     or p_idempotency_key is null
     or char_length(v_relationship) not between 1 and 80
     or cardinality(v_scopes) not between 1 and 7
     or not (v_scopes <@ array[
       'client.read',
       'care.read',
       'health.summary',
       'schedule.read',
       'billing.read',
       'documents.read',
       'messages.read'
     ]::text[])
     or '*' = any(v_scopes)
     or char_length(v_document_version) not between 1 and 120
     or v_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'valid canonical family consent verification fields are required';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'recipient_user_id', p_recipient_user_id,
    'relationship', v_relationship,
    'scopes', to_jsonb(v_scopes),
    'document_version', v_document_version,
    'consent_expires_at', case
      when p_consent_expires_at is null then null
      else extract(epoch from p_consent_expires_at)::text
    end,
    'evidence_hash', v_evidence_hash
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'family-consent-verification:' || p_idempotency_key::text,
    0
  ));

  select evidence.* into v_existing
  from private.family_consent_verification_evidence evidence
  where evidence.registration_idempotency_key = p_idempotency_key;

  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.recipient_user_id <> p_recipient_user_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'family consent verification idempotency conflict';
    end if;

    return query select
      v_existing.id,
      v_existing.verified_at,
      v_existing.expires_at,
      true;
    return;
  end if;

  v_now := clock_timestamp();

  if p_consent_expires_at is not null
     and p_consent_expires_at <= v_now then
    raise exception using
      errcode = '22023',
      message = 'family consent expiry must be in the future';
  end if;

  if not exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
  )
  or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_recipient_user_id
      and profile.kind = 'family'
      and profile.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'family consent verification target is outside trusted scope';
  end if;

  if exists (
    select 1
    from private.family_consent_verification_evidence evidence
    where evidence.evidence_hash = v_evidence_hash
  )
  or exists (
    select 1
    from public.consents consent
    where consent.evidence_hash = v_evidence_hash
  ) then
    raise exception using
      errcode = '23505',
      message = 'family consent evidence hash was already registered';
  end if;

  insert into private.family_consent_verification_evidence (
    organization_id,
    branch_id,
    client_id,
    recipient_user_id,
    relationship,
    scopes,
    document_version,
    consent_expires_at,
    evidence_hash,
    verification_method,
    verified_at,
    otp_verified_at,
    relationship_verified_at,
    explicit_consent_verified_at,
    expires_at,
    registration_idempotency_key,
    request_hash,
    created_at
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_recipient_user_id,
    v_relationship,
    v_scopes,
    v_document_version,
    p_consent_expires_at,
    v_evidence_hash,
    'phone_otp',
    v_now,
    v_now,
    v_now,
    v_now,
    v_now + interval '10 minutes',
    p_idempotency_key,
    v_request_hash,
    v_now
  )
  returning * into v_created;

  return query select
    v_created.id,
    v_created.verified_at,
    v_created.expires_at,
    false;
end;
$$;

create or replace function public.register_family_consent_verification(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_recipient_user_id uuid,
  p_relationship text,
  p_scopes text[],
  p_document_version text,
  p_consent_expires_at timestamptz,
  p_evidence_hash text,
  p_idempotency_key uuid
)
returns table(
  verification_evidence_id uuid,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.register_family_consent_verification_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_recipient_user_id,
    p_relationship,
    p_scopes,
    p_document_version,
    p_consent_expires_at,
    p_evidence_hash,
    p_idempotency_key
  );
$$;

comment on function public.register_family_consent_verification(
  uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) is
  'Trusted-server-only registration of a canonical ten-minute one-time proof; accepts no OTP value.';

create or replace function private.grant_family_consent_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_verification_evidence_id uuid,
  p_client_id uuid,
  p_recipient_user_id uuid,
  p_relationship text,
  p_scopes text[],
  p_document_version text,
  p_consent_expires_at timestamptz,
  p_evidence_hash text,
  p_idempotency_key uuid
)
returns table(
  consent_id uuid,
  document_version text,
  scopes text[],
  consented_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
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
  v_relationship text := btrim(p_relationship);
  v_scopes text[] := private.canonical_family_consent_scopes(p_scopes);
  v_document_version text := btrim(p_document_version);
  v_evidence_hash text := lower(btrim(p_evidence_hash));
  v_request_hash text;
  v_now timestamptz;
  v_client public.clients%rowtype;
  v_recipient public.profiles%rowtype;
  v_evidence private.family_consent_verification_evidence%rowtype;
  v_challenge private.reauth_challenges%rowtype;
  v_existing public.consents%rowtype;
  v_previous public.consents%rowtype;
  v_created public.consents%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_verification_evidence_id is null
     or p_client_id is null
     or p_recipient_user_id is null
     or p_relationship is null
     or p_scopes is null
     or p_document_version is null
     or p_evidence_hash is null
     or p_idempotency_key is null
     or char_length(v_relationship) not between 1 and 80
     or cardinality(v_scopes) not between 1 and 7
     or not (v_scopes <@ array[
       'client.read',
       'care.read',
       'health.summary',
       'schedule.read',
       'billing.read',
       'documents.read',
       'messages.read'
     ]::text[])
     or '*' = any(v_scopes)
     or char_length(v_document_version) not between 1 and 120
     or v_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'valid canonical family consent grant fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'family consent grant requires AAL2';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'verification_evidence_id', p_verification_evidence_id,
    'client_id', p_client_id,
    'recipient_user_id', p_recipient_user_id,
    'relationship', v_relationship,
    'scopes', to_jsonb(v_scopes),
    'document_version', v_document_version,
    'consent_expires_at', case
      when p_consent_expires_at is null then null
      else extract(epoch from p_consent_expires_at)::text
    end,
    'evidence_hash', v_evidence_hash,
    'created_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'family-consent-grant:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select consent.* into v_existing
  from public.consents consent
  where consent.created_by = v_actor
    and consent.grant_idempotency_key = p_idempotency_key
    and consent.workflow_version = 1;

  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.recipient_user_id <> p_recipient_user_id
       or v_existing.verification_evidence_id <> p_verification_evidence_id
       or v_existing.grant_request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'family consent grant idempotency conflict';
    end if;

    return query select
      v_existing.id,
      v_existing.document_version,
      v_existing.scopes,
      v_existing.consented_at,
      v_existing.expires_at,
      v_existing.revoked_at,
      true;
    return;
  end if;

  if not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'consents.manage'
     ))
     or not (select private.can_staff_access_client(
       p_client_id,
       'consents.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'family consent grant is not permitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'family-consent-subject:' || p_client_id::text || ':' || p_recipient_user_id::text,
    0
  ));

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for share;

  if not found
     or v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > (clock_timestamp() at time zone 'Asia/Taipei')::date
     or v_client.ended_on is not null then
    raise exception using
      errcode = '23514',
      message = 'family consent requires an active admitted and unended client';
  end if;

  select evidence.* into v_evidence
  from private.family_consent_verification_evidence evidence
  where evidence.id = p_verification_evidence_id
    and evidence.organization_id = p_expected_organization_id
    and evidence.branch_id = p_expected_branch_id
    and evidence.client_id = p_client_id
    and evidence.recipient_user_id = p_recipient_user_id
  for update;

  if not found
     or v_evidence.relationship <> v_relationship
     or v_evidence.scopes <> v_scopes
     or v_evidence.document_version <> v_document_version
     or v_evidence.consent_expires_at is distinct from p_consent_expires_at
     or v_evidence.evidence_hash <> v_evidence_hash then
    raise exception using
      errcode = '42501',
      message = 'family consent verification evidence does not match the grant';
  end if;

  v_now := clock_timestamp();
  if v_evidence.consumed_at is not null then
    raise exception using
      errcode = '23514',
      message = 'family consent verification evidence was already consumed';
  end if;
  if v_evidence.expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'family consent verification evidence expired';
  end if;
  if p_consent_expires_at is not null and p_consent_expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'family consent expiry must remain in the future';
  end if;

  select profile.* into v_recipient
  from public.profiles profile
  where profile.id = p_recipient_user_id
    and profile.kind = 'family'
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'family consent recipient is not active family';
  end if;

  if exists (
    select 1
    from public.consents consent
    where consent.client_id = p_client_id
      and consent.recipient_user_id = p_recipient_user_id
      and consent.revoked_at is null
  ) then
    raise exception using
      errcode = '23505',
      message = 'existing family consent must be revoked before a new version';
  end if;

  if exists (
    select 1
    from public.consents consent
    where consent.client_id = p_client_id
      and consent.recipient_user_id = p_recipient_user_id
      and consent.document_version = v_document_version
  ) then
    raise exception using
      errcode = '23505',
      message = 'family consent document version was already used';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'immutable AAL2 evidence is required for family consent grant';
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
    raise exception using
      errcode = '42501',
      message = 'immutable AAL2 evidence is required for family consent grant';
  end if;

  if v_evidence.expires_at <= v_now
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'consents.manage'
     ))
     or not (select private.can_staff_access_client(
       p_client_id,
       'consents.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'family consent grant authority or evidence expired';
  end if;

  select consent.* into v_previous
  from public.consents consent
  where consent.client_id = p_client_id
    and consent.recipient_user_id = p_recipient_user_id
  order by consent.consented_at desc, consent.created_at desc, consent.id desc
  limit 1;

  insert into public.consents (
    organization_id,
    branch_id,
    client_id,
    recipient_user_id,
    relationship,
    scopes,
    document_version,
    consented_at,
    expires_at,
    revoked_at,
    evidence_hash,
    created_by,
    workflow_version,
    verification_evidence_id,
    grant_reauth_challenge_id,
    grant_idempotency_key,
    grant_request_hash,
    supersedes_consent_id
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_recipient_user_id,
    v_relationship,
    v_scopes,
    v_document_version,
    v_evidence.verified_at,
    p_consent_expires_at,
    null,
    v_evidence_hash,
    v_actor,
    1,
    v_evidence.id,
    v_challenge.id,
    p_idempotency_key,
    v_request_hash,
    v_previous.id
  )
  returning * into v_created;

  update private.family_consent_verification_evidence evidence
  set
    consumed_at = v_now,
    consumed_by = v_actor,
    consumed_consent_id = v_created.id
  where evidence.id = v_evidence.id
    and evidence.consumed_at is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'family consent evidence consume compare-and-swap failed';
  end if;

  return query select
    v_created.id,
    v_created.document_version,
    v_created.scopes,
    v_created.consented_at,
    v_created.expires_at,
    v_created.revoked_at,
    false;
end;
$$;

create or replace function public.grant_family_consent(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_verification_evidence_id uuid,
  p_client_id uuid,
  p_recipient_user_id uuid,
  p_relationship text,
  p_scopes text[],
  p_document_version text,
  p_consent_expires_at timestamptz,
  p_evidence_hash text,
  p_idempotency_key uuid
)
returns table(
  consent_id uuid,
  document_version text,
  scopes text[],
  consented_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.grant_family_consent_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_verification_evidence_id,
    p_client_id,
    p_recipient_user_id,
    p_relationship,
    p_scopes,
    p_document_version,
    p_consent_expires_at,
    p_evidence_hash,
    p_idempotency_key
  );
$$;

comment on function public.grant_family_consent(
  uuid, uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) is
  'Atomically consumes matching trusted verification and recent AAL2 evidence to append one immutable family consent version.';

create or replace function private.revoke_family_consent_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_consent_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  revocation_operation_id uuid,
  consent_id uuid,
  revoked_at timestamptz,
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
  v_reason text := nullif(btrim(p_reason), '');
  v_request_hash text;
  v_now timestamptz;
  v_existing private.consent_revocation_operations%rowtype;
  v_consent public.consents%rowtype;
  v_challenge private.reauth_challenges%rowtype;
  v_created private.consent_revocation_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_consent_id is null
     or v_reason is null
     or p_idempotency_key is null
     or char_length(v_reason) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'valid family consent revocation fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'family consent revocation requires AAL2';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'consent_id', p_consent_id,
    'reason', v_reason,
    'actor_user_id', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'family-consent-revoke:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_existing
  from private.consent_revocation_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.consent_id <> p_consent_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'family consent revocation idempotency conflict';
    end if;

    return query select
      v_existing.id,
      v_existing.consent_id,
      v_existing.revoked_at,
      true;
    return;
  end if;

  select consent.* into v_consent
  from public.consents consent
  where consent.id = p_consent_id
    and consent.organization_id = p_expected_organization_id
    and consent.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'consents.manage'
     ))
     or not (select private.can_staff_access_client(
       v_consent.client_id,
       'consents.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'family consent revocation is not permitted';
  end if;

  if v_consent.revoked_at is not null then
    raise exception using
      errcode = '23514',
      message = 'family consent is already revoked';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'immutable AAL2 evidence is required for family consent revocation';
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
     or v_challenge.factor_verified_at > v_now + interval '1 minute'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'consents.manage'
     ))
     or not (select private.can_staff_access_client(
       v_consent.client_id,
       'consents.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'family consent revocation authority expired';
  end if;

  update public.consents consent
  set revoked_at = v_now
  where consent.id = v_consent.id
    and consent.revoked_at is null
  returning consent.* into v_consent;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'family consent revocation compare-and-swap failed';
  end if;

  insert into private.consent_revocation_operations (
    organization_id,
    branch_id,
    client_id,
    consent_id,
    recipient_user_id,
    actor_user_id,
    reason,
    idempotency_key,
    request_hash,
    reauth_challenge_id,
    revoked_at,
    created_at
  ) values (
    v_consent.organization_id,
    v_consent.branch_id,
    v_consent.client_id,
    v_consent.id,
    v_consent.recipient_user_id,
    v_actor,
    v_reason,
    p_idempotency_key,
    v_request_hash,
    v_challenge.id,
    v_now,
    v_now
  )
  returning * into v_created;

  return query select
    v_created.id,
    v_created.consent_id,
    v_created.revoked_at,
    false;
end;
$$;

create or replace function public.revoke_family_consent(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_consent_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  revocation_operation_id uuid,
  consent_id uuid,
  revoked_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.revoke_family_consent_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_consent_id,
    p_reason,
    p_idempotency_key
  );
$$;

comment on function public.revoke_family_consent(
  uuid, uuid, uuid, text, uuid
) is
  'Irreversibly revokes one exact tenant-scoped family consent with reason, recent AAL2 evidence, server time, and exact replay.';

drop policy if exists consents_insert on public.consents;
drop policy if exists consents_update on public.consents;

-- The base table is append-only through the governed grant function and can
-- only receive revoked_at through the governed revocation function. Even the
-- service role cannot bypass verification evidence or mutate history.
revoke insert, update, delete, truncate
  on table public.consents from public, anon, authenticated, service_role;

revoke all on table private.family_consent_verification_evidence
  from public, anon, authenticated, service_role;
revoke all on table private.consent_revocation_operations
  from public, anon, authenticated, service_role;

revoke all on function private.canonical_family_consent_scopes(text[])
  from public, anon, authenticated, service_role;
revoke all on function private.protect_family_consent_verification_evidence()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_consent_revocation_operation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_consent_history()
  from public, anon, authenticated, service_role;

revoke all on function private.register_family_consent_verification_atomic(
  uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.register_family_consent_verification(
  uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.register_family_consent_verification_atomic(
  uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) to service_role;
grant execute on function public.register_family_consent_verification(
  uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) to service_role;

revoke all on function private.grant_family_consent_atomic(
  uuid, uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.grant_family_consent(
  uuid, uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.grant_family_consent_atomic(
  uuid, uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) to authenticated;
grant execute on function public.grant_family_consent(
  uuid, uuid, uuid, uuid, uuid, text, text[], text, timestamptz, text, uuid
) to authenticated;

revoke all on function private.revoke_family_consent_atomic(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.revoke_family_consent(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.revoke_family_consent_atomic(
  uuid, uuid, uuid, text, uuid
) to authenticated;
grant execute on function public.revoke_family_consent(
  uuid, uuid, uuid, text, uuid
) to authenticated;
