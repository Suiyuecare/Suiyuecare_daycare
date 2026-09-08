-- Page 9: governed client TOCC assessments.
--
-- One assessment is an immutable, signed business record. A later assessment
-- appends a client-scoped version and links its predecessor. The validity rule
-- is deliberately explicit: the Taiwan business assessment date advances by
-- one calendar month, clamped to the last day of the destination month, and
-- that destination date remains valid through the end of that day.

create or replace function private.calculate_tocc_valid_through(
  p_assessment_date date,
  p_rule_version text default 'calendar-month-asia-taipei-v1'
)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_next_month_start date;
  v_next_month_end date;
begin
  if p_assessment_date is null
     or p_rule_version is distinct from 'calendar-month-asia-taipei-v1' then
    raise exception using
      errcode = '22023',
      message = 'supported TOCC assessment date and validity rule are required';
  end if;

  v_next_month_start := (
    date_trunc('month', p_assessment_date::timestamp) + interval '1 month'
  )::date;
  v_next_month_end := (
    date_trunc('month', p_assessment_date::timestamp)
      + interval '2 months' - interval '1 day'
  )::date;

  return least(
    v_next_month_start + (extract(day from p_assessment_date)::integer - 1),
    v_next_month_end
  );
end;
$$;

comment on function private.calculate_tocc_valid_through(date, text) is
  'Versioned Asia/Taipei business-date rule: same ordinal next month, clamped to destination month end; returned date is inclusive.';

create table public.client_tocc_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_version integer not null,
  previous_assessment_id uuid,
  assessment_date date not null,
  valid_through date not null,
  validity_rule_version text not null,
  result_status text not null,
  symptom_summary text,
  risk_summary text,
  evidence_status text not null,
  action_status text not null,
  source text not null,
  signed_at timestamptz not null,
  signed_by uuid not null references auth.users(id) on delete restrict,
  signature_purpose text not null,
  signature_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_tocc_assessments_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_tocc_assessments_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint client_tocc_assessments_client_version_key
    unique (organization_id, branch_id, client_id, assessment_version),
  constraint client_tocc_assessments_previous_scope_fkey
    foreign key (
      previous_assessment_id,
      organization_id,
      branch_id,
      client_id
    ) references public.client_tocc_assessments (
      id,
      organization_id,
      branch_id,
      client_id
    ) on delete restrict,
  constraint client_tocc_assessments_version_lineage_check check (
    (
      assessment_version = 1
      and previous_assessment_id is null
    )
    or (
      assessment_version > 1
      and previous_assessment_id is not null
    )
  ),
  constraint client_tocc_assessments_validity_check check (
    validity_rule_version = 'calendar-month-asia-taipei-v1'
    and valid_through >= assessment_date
  ),
  constraint client_tocc_assessments_result_check check (
    result_status in ('clear', 'monitor', 'action_required')
  ),
  constraint client_tocc_assessments_symptom_summary_check check (
    symptom_summary is null
    or (
      char_length(symptom_summary) between 1 and 1000
      and symptom_summary !~ '[[:cntrl:]]'
    )
  ),
  constraint client_tocc_assessments_risk_summary_check check (
    risk_summary is null
    or (
      char_length(risk_summary) between 1 and 1000
      and risk_summary !~ '[[:cntrl:]]'
    )
  ),
  constraint client_tocc_assessments_nonclear_summary_check check (
    result_status = 'clear'
    or symptom_summary is not null
    or risk_summary is not null
  ),
  constraint client_tocc_assessments_evidence_status_check check (
    evidence_status in ('not_required', 'pending', 'verified', 'rejected')
  ),
  constraint client_tocc_assessments_action_status_check check (
    action_status in (
      'none_required', 'pending', 'in_progress', 'completed', 'referred'
    )
  ),
  constraint client_tocc_assessments_action_alignment_check check (
    result_status <> 'action_required'
    or action_status <> 'none_required'
  ),
  constraint client_tocc_assessments_source_check check (source = 'staff'),
  constraint client_tocc_assessments_signature_purpose_check check (
    signature_purpose = '個案 TOCC 評估確認'
  ),
  constraint client_tocc_assessments_content_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.client_tocc_assessments is
  'Immutable, versioned, signed client TOCC assessments. Later observations append a new version rather than editing history.';
comment on column public.client_tocc_assessments.valid_through is
  'Inclusive validity end date calculated from the Taiwan business assessment date.';
comment on column public.client_tocc_assessments.validity_rule_version is
  'Frozen formula version used to reproduce the original one-calendar-month validity result.';

create index client_tocc_assessments_branch_date_idx
  on public.client_tocc_assessments (
    organization_id,
    branch_id,
    assessment_date desc,
    client_id
  );
create index client_tocc_assessments_client_latest_idx
  on public.client_tocc_assessments (
    organization_id,
    branch_id,
    client_id,
    assessment_version desc
  );
create index client_tocc_assessments_valid_through_idx
  on public.client_tocc_assessments (
    organization_id,
    branch_id,
    valid_through
  );
create index client_tocc_assessments_reauth_idx
  on public.client_tocc_assessments (signature_reauth_challenge_id);
create index client_tocc_assessments_previous_idx
  on public.client_tocc_assessments (previous_assessment_id)
  where previous_assessment_id is not null;
create index client_tocc_assessments_signed_by_idx
  on public.client_tocc_assessments (signed_by);

create table private.client_tocc_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_tocc_operations_assessment_scope_fkey
    foreign key (assessment_id, organization_id, branch_id, client_id)
    references public.client_tocc_assessments (
      id,
      organization_id,
      branch_id,
      client_id
    ) on delete restrict,
  constraint client_tocc_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint client_tocc_operations_assessment_key unique (assessment_id),
  constraint client_tocc_operations_request_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table private.client_tocc_operations is
  'Append-only actor-scoped exact-replay receipts for single TOCC assessment records, including items submitted through batch.';

create index client_tocc_operations_scope_client_idx
  on private.client_tocc_operations (
    organization_id,
    branch_id,
    client_id,
    created_at desc
  );
create index client_tocc_operations_reauth_idx
  on private.client_tocc_operations (reauth_challenge_id);

create table private.client_tocc_batch_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_payload jsonb not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_tocc_batch_operations_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint client_tocc_batch_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint client_tocc_batch_operations_request_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint client_tocc_batch_operations_result_check check (
    jsonb_typeof(result_payload) = 'array'
    and jsonb_array_length(result_payload) between 1 and 100
  )
);

comment on table private.client_tocc_batch_operations is
  'Immutable exact-replay receipt for one 1-100 item TOCC batch; payload contains only result identifiers and structured error codes.';

create index client_tocc_batch_operations_scope_created_idx
  on private.client_tocc_batch_operations (
    organization_id,
    branch_id,
    created_at desc
  );
create index client_tocc_batch_operations_reauth_idx
  on private.client_tocc_batch_operations (reauth_challenge_id);

alter table public.client_tocc_assessments enable row level security;
alter table public.client_tocc_assessments force row level security;
alter table private.client_tocc_operations enable row level security;
alter table private.client_tocc_operations force row level security;
alter table private.client_tocc_batch_operations enable row level security;
alter table private.client_tocc_batch_operations force row level security;

create or replace function private.prevent_client_tocc_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'formal TOCC records and operation receipts are immutable';
end;
$$;

create trigger client_tocc_assessments_prevent_mutation
before update or delete on public.client_tocc_assessments
for each row execute function private.prevent_client_tocc_mutation();

create trigger client_tocc_operations_prevent_mutation
before update or delete on private.client_tocc_operations
for each row execute function private.prevent_client_tocc_mutation();

create trigger client_tocc_batch_operations_prevent_mutation
before update or delete on private.client_tocc_batch_operations
for each row execute function private.prevent_client_tocc_mutation();

create trigger client_tocc_assessments_audit_row_change
after insert on public.client_tocc_assessments
for each row execute function private.audit_row_change();

create trigger client_tocc_operations_audit_insert
after insert on private.client_tocc_operations
for each row execute function private.audit_row_change();

create trigger client_tocc_batch_operations_audit_insert
after insert on private.client_tocc_batch_operations
for each row execute function private.audit_row_change();

create or replace function private.current_client_tocc_reauth_challenge()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := clock_timestamp();
  v_challenge_id uuid;
  v_verified_at timestamptz;
begin
  if v_actor is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for TOCC assessment';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for TOCC assessment';
  end;

  select challenge.id, challenge.factor_verified_at
    into v_challenge_id, v_verified_at
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
    and challenge.factor_verified_at >= v_now - interval '15 minutes'
    and challenge.factor_verified_at <= v_now + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  if v_challenge_id is null
     or v_verified_at is null
     or v_verified_at < v_now - interval '15 minutes'
     or v_verified_at > v_now + interval '1 minute' then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for TOCC assessment';
  end if;

  return v_challenge_id;
end;
$$;

create or replace function private.record_client_tocc_assessment_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_date date,
  p_result_status text,
  p_symptom_summary text,
  p_risk_summary text,
  p_evidence_status text,
  p_action_status text,
  p_idempotency_key uuid
)
returns table(
  assessment_id uuid,
  client_id uuid,
  assessment_version integer,
  assessment_date date,
  valid_through date,
  result_status text,
  evidence_status text,
  action_status text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_result_status text := lower(btrim(p_result_status));
  v_symptom_summary text := nullif(btrim(p_symptom_summary), '');
  v_risk_summary text := nullif(btrim(p_risk_summary), '');
  v_evidence_status text := lower(btrim(p_evidence_status));
  v_action_status text := lower(btrim(p_action_status));
  v_rule_version constant text := 'calendar-month-asia-taipei-v1';
  v_valid_through date;
  v_request_hash text;
  v_content_hash text;
  v_reauth_challenge_id uuid;
  v_client public.clients%rowtype;
  v_previous public.client_tocc_assessments%rowtype;
  v_assessment public.client_tocc_assessments%rowtype;
  v_operation private.client_tocc_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_assessment_date is null
     or p_idempotency_key is null
     or p_assessment_date > v_today
     or v_result_status not in ('clear', 'monitor', 'action_required')
     or v_evidence_status not in ('not_required', 'pending', 'verified', 'rejected')
     or v_action_status not in (
       'none_required', 'pending', 'in_progress', 'completed', 'referred'
     )
     or (
       v_symptom_summary is not null
       and (
         char_length(v_symptom_summary) > 1000
         or v_symptom_summary ~ '[[:cntrl:]]'
       )
     )
     or (
       v_risk_summary is not null
       and (
         char_length(v_risk_summary) > 1000
         or v_risk_summary ~ '[[:cntrl:]]'
       )
     )
     or (
       v_result_status <> 'clear'
       and v_symptom_summary is null
       and v_risk_summary is null
     )
     or (
       v_result_status = 'action_required'
       and v_action_status = 'none_required'
     ) then
    raise exception using
      errcode = '22023',
      message = 'valid TOCC assessment fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'health.write'
     )) then
    raise exception using
      errcode = '42501',
      message = 'TOCC assessment is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'actor_user_id', v_actor,
    'assessment_date', p_assessment_date,
    'result_status', v_result_status,
    'symptom_summary', v_symptom_summary,
    'risk_summary', v_risk_summary,
    'evidence_status', v_evidence_status,
    'action_status', v_action_status
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'client-tocc-item:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.client_tocc_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'TOCC assessment idempotency conflict';
    end if;

    if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, 'health.write')) then
      raise exception using
        errcode = '42501',
        message = 'TOCC client access is not permitted';
    end if;

    select assessment.* into strict v_assessment
    from public.client_tocc_assessments assessment
    where assessment.id = v_operation.assessment_id
      and assessment.organization_id = v_operation.organization_id
      and assessment.branch_id = v_operation.branch_id
      and assessment.client_id = v_operation.client_id;

    return query select
      v_assessment.id,
      v_assessment.client_id,
      v_assessment.assessment_version,
      v_assessment.assessment_date,
      v_assessment.valid_through,
      v_assessment.result_status,
      v_assessment.evidence_status,
      v_assessment.action_status,
      true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > p_assessment_date
     or (v_client.ended_on is not null and v_client.ended_on < p_assessment_date)
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'health.write')) then
    raise exception using
      errcode = '42501',
      message = 'TOCC client is outside the active assigned scope';
  end if;

  -- Recheck branch and authority after the client lock, immediately before the
  -- signed insert. This narrows revocation races without trusting caller state.
  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'health.write')) then
    raise exception using
      errcode = '42501',
      message = 'TOCC assessment authority expired';
  end if;

  select assessment.* into v_previous
  from public.client_tocc_assessments assessment
  where assessment.organization_id = p_expected_organization_id
    and assessment.branch_id = p_expected_branch_id
    and assessment.client_id = p_client_id
  order by assessment.assessment_version desc
  limit 1;

  v_valid_through := private.calculate_tocc_valid_through(
    p_assessment_date,
    v_rule_version
  );
  -- Do not let advisory or row-lock waits backdate the signed record. Refresh
  -- the authoritative server timestamp only after every scope and authority
  -- recheck has passed and immediately before freezing signature evidence.
  v_now := clock_timestamp();
  v_reauth_challenge_id := private.current_client_tocc_reauth_challenge();

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'assessment_version', coalesce(v_previous.assessment_version, 0) + 1,
    'previous_assessment_id', v_previous.id,
    'assessment_date', p_assessment_date,
    'valid_through', v_valid_through,
    'validity_rule_version', v_rule_version,
    'result_status', v_result_status,
    'symptom_summary', v_symptom_summary,
    'risk_summary', v_risk_summary,
    'evidence_status', v_evidence_status,
    'action_status', v_action_status,
    'source', 'staff',
    'signed_at_epoch', extract(epoch from v_now)::text,
    'signed_by', v_actor,
    'signature_purpose', '個案 TOCC 評估確認',
    'signature_reauth_challenge_id', v_reauth_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into public.client_tocc_assessments (
    organization_id,
    branch_id,
    client_id,
    assessment_version,
    previous_assessment_id,
    assessment_date,
    valid_through,
    validity_rule_version,
    result_status,
    symptom_summary,
    risk_summary,
    evidence_status,
    action_status,
    source,
    signed_at,
    signed_by,
    signature_purpose,
    signature_reauth_challenge_id,
    content_hash
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    coalesce(v_previous.assessment_version, 0) + 1,
    v_previous.id,
    p_assessment_date,
    v_valid_through,
    v_rule_version,
    v_result_status,
    v_symptom_summary,
    v_risk_summary,
    v_evidence_status,
    v_action_status,
    'staff',
    v_now,
    v_actor,
    '個案 TOCC 評估確認',
    v_reauth_challenge_id,
    v_content_hash
  )
  returning * into v_assessment;

  insert into private.client_tocc_operations (
    organization_id,
    branch_id,
    client_id,
    assessment_id,
    actor_user_id,
    idempotency_key,
    request_hash,
    reauth_challenge_id
  ) values (
    v_assessment.organization_id,
    v_assessment.branch_id,
    v_assessment.client_id,
    v_assessment.id,
    v_actor,
    p_idempotency_key,
    v_request_hash,
    v_reauth_challenge_id
  );

  return query select
    v_assessment.id,
    v_assessment.client_id,
    v_assessment.assessment_version,
    v_assessment.assessment_date,
    v_assessment.valid_through,
    v_assessment.result_status,
    v_assessment.evidence_status,
    v_assessment.action_status,
    false;
end;
$$;

create or replace function private.record_client_tocc_batch_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_items jsonb,
  p_idempotency_key uuid
)
returns table(
  item_index integer,
  item_idempotency_key uuid,
  status text,
  assessment_id uuid,
  assessment_version integer,
  valid_through date,
  item_replayed boolean,
  batch_replayed boolean,
  error jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request_hash text;
  v_reauth_challenge_id uuid;
  v_batch_operation private.client_tocc_batch_operations%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_item jsonb;
  v_ordinal bigint;
  v_item_key uuid;
  v_item_key_text text;
  v_item_date date;
  v_result record;
  v_error_state text;
  v_error_code text;
  v_error_retryable boolean;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_idempotency_key is null
     or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'TOCC batch must contain between 1 and 100 items';
  end if;

  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'TOCC batch must contain between 1 and 100 items';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'health.write'
     )) then
    raise exception using
      errcode = '42501',
      message = 'TOCC batch is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'actor_user_id', v_actor,
    'items', p_items
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'client-tocc-batch:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_batch_operation
  from private.client_tocc_batch_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_batch_operation.organization_id <> p_expected_organization_id
       or v_batch_operation.branch_id <> p_expected_branch_id
       or v_batch_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'TOCC batch idempotency conflict';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_batch_operation.result_payload) result
      left join public.client_tocc_assessments assessment
        on assessment.id = nullif(result ->> 'assessment_id', '')::uuid
       and assessment.organization_id = v_batch_operation.organization_id
       and assessment.branch_id = v_batch_operation.branch_id
      where result ->> 'status' = 'success'
        and (
          assessment.id is null
          or not (select private.can_staff_access_client(
            assessment.client_id,
            'clients.read'
          ))
          or not (select private.can_staff_access_client(
            assessment.client_id,
            'health.write'
          ))
        )
    ) then
      raise exception using
        errcode = '42501',
        message = 'TOCC batch replay client access is not permitted';
    end if;

    return query
    select
      (result ->> 'item_index')::integer,
      nullif(result ->> 'item_idempotency_key', '')::uuid,
      result ->> 'status',
      nullif(result ->> 'assessment_id', '')::uuid,
      nullif(result ->> 'assessment_version', '')::integer,
      nullif(result ->> 'valid_through', '')::date,
      coalesce((result ->> 'item_replayed')::boolean, false),
      true,
      result -> 'error'
    from jsonb_array_elements(v_batch_operation.result_payload) result
    order by (result ->> 'item_index')::integer;
    return;
  end if;

  for v_item, v_ordinal in
    select item.value, item.ordinality
    from jsonb_array_elements(p_items) with ordinality item(value, ordinality)
    order by item.ordinality
  loop
    v_item_key := null;
    v_item_date := null;
    v_item_key_text := case
      when jsonb_typeof(v_item) = 'object' then v_item ->> 'idempotency_key'
      else null
    end;

    if coalesce(v_item_key_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_item_key := v_item_key_text::uuid;
    end if;

    begin
      if jsonb_typeof(v_item) is distinct from 'object'
         or exists (
           select 1
           from jsonb_object_keys(v_item) supplied_key
           where supplied_key not in (
             'client_id',
             'assessment_date',
             'result_status',
             'symptom_summary',
             'risk_summary',
             'evidence_status',
             'action_status',
             'idempotency_key'
           )
         ) then
        raise exception using
          errcode = '22023',
          message = 'TOCC batch item contains unsupported fields';
      end if;

      v_item_date := nullif(v_item ->> 'assessment_date', '')::date;

      select * into strict v_result
      from private.record_client_tocc_assessment_atomic(
        p_expected_organization_id,
        p_expected_branch_id,
        nullif(v_item ->> 'client_id', '')::uuid,
        v_item_date,
        v_item ->> 'result_status',
        v_item ->> 'symptom_summary',
        v_item ->> 'risk_summary',
        v_item ->> 'evidence_status',
        v_item ->> 'action_status',
        v_item_key
      );

      v_entry := jsonb_build_object(
        'item_index', v_ordinal::integer,
        'item_idempotency_key', v_item_key,
        'status', 'success',
        'assessment_id', v_result.assessment_id,
        'assessment_version', v_result.assessment_version,
        'valid_through', v_result.valid_through,
        'item_replayed', v_result.replayed,
        'error', null
      );
    exception when others then
      get stacked diagnostics v_error_state = returned_sqlstate;
      v_error_code := case
        when v_error_state in ('22023', '22007', '22P02', '23514')
          then 'validation_failed'
        when v_error_state = '42501' then 'forbidden'
        when v_error_state = '23505' then 'idempotency_conflict'
        when v_error_state in ('40001', '40P01', '55P03') then 'retryable_conflict'
        else 'internal_error'
      end;
      v_error_retryable := v_error_state in ('40001', '40P01', '55P03');

      v_entry := jsonb_build_object(
        'item_index', v_ordinal::integer,
        'item_idempotency_key', v_item_key,
        'status', 'failed',
        'assessment_id', null,
        'assessment_version', null,
        'valid_through', null,
        'item_replayed', false,
        'error', jsonb_build_object(
          'code', v_error_code,
          'sqlstate', v_error_state,
          'retryable', v_error_retryable
        )
      );
    end;

    v_results := v_results || jsonb_build_array(v_entry);
  end loop;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'health.write'
     )) then
    raise exception using
      errcode = '42501',
      message = 'TOCC batch authority expired';
  end if;

  v_reauth_challenge_id := private.current_client_tocc_reauth_challenge();

  insert into private.client_tocc_batch_operations (
    organization_id,
    branch_id,
    actor_user_id,
    idempotency_key,
    request_hash,
    result_payload,
    reauth_challenge_id
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    p_idempotency_key,
    v_request_hash,
    v_results,
    v_reauth_challenge_id
  );

  return query
  select
    (result ->> 'item_index')::integer,
    nullif(result ->> 'item_idempotency_key', '')::uuid,
    result ->> 'status',
    nullif(result ->> 'assessment_id', '')::uuid,
    nullif(result ->> 'assessment_version', '')::integer,
    nullif(result ->> 'valid_through', '')::date,
    coalesce((result ->> 'item_replayed')::boolean, false),
    false,
    result -> 'error'
  from jsonb_array_elements(v_results) result
  order by (result ->> 'item_index')::integer;
end;
$$;

create or replace function private.client_tocc_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null
)
returns table(
  assessment_id uuid,
  client_id uuid,
  assessment_version integer,
  assessment_date date,
  valid_through date,
  validity_rule_version text,
  validity_status text,
  result_status text,
  symptom_summary text,
  risk_summary text,
  evidence_status text,
  action_status text,
  signed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_result_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'health.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'TOCC snapshot is not permitted';
  end if;

  return query
  select distinct on (assessment.client_id)
    assessment.id,
    assessment.client_id,
    assessment.assessment_version,
    assessment.assessment_date,
    assessment.valid_through,
    assessment.validity_rule_version,
    case when v_today <= assessment.valid_through then 'current' else 'expired' end,
    assessment.result_status,
    assessment.symptom_summary,
    assessment.risk_summary,
    assessment.evidence_status,
    assessment.action_status,
    assessment.signed_at
  from public.client_tocc_assessments assessment
  where assessment.organization_id = p_expected_organization_id
    and assessment.branch_id = p_expected_branch_id
    and (p_client_id is null or assessment.client_id = p_client_id)
    and (select private.can_staff_access_client(assessment.client_id, 'clients.read'))
    and (select private.can_staff_access_client(assessment.client_id, 'health.read'))
  order by
    assessment.client_id,
    assessment.assessment_version desc,
    assessment.id;

  get diagnostics v_result_count = row_count;

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
    'client_tocc_assessments',
    p_client_id::text,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page9_latest',
      'result_count', v_result_count,
      'client_filtered', p_client_id is not null
    )
  );
end;
$$;

create or replace function public.record_client_tocc_assessment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_date date,
  p_result_status text,
  p_symptom_summary text,
  p_risk_summary text,
  p_evidence_status text,
  p_action_status text,
  p_idempotency_key uuid
)
returns table(
  assessment_id uuid,
  client_id uuid,
  assessment_version integer,
  assessment_date date,
  valid_through date,
  result_status text,
  evidence_status text,
  action_status text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.record_client_tocc_assessment_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_assessment_date,
    p_result_status,
    p_symptom_summary,
    p_risk_summary,
    p_evidence_status,
    p_action_status,
    p_idempotency_key
  );
$$;

create or replace function public.record_client_tocc_batch(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_items jsonb,
  p_idempotency_key uuid
)
returns table(
  item_index integer,
  item_idempotency_key uuid,
  status text,
  assessment_id uuid,
  assessment_version integer,
  valid_through date,
  item_replayed boolean,
  batch_replayed boolean,
  error jsonb
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.record_client_tocc_batch_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_items,
    p_idempotency_key
  );
$$;

create or replace function public.client_tocc_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null
)
returns table(
  assessment_id uuid,
  client_id uuid,
  assessment_version integer,
  assessment_date date,
  valid_through date,
  validity_rule_version text,
  validity_status text,
  result_status text,
  symptom_summary text,
  risk_summary text,
  evidence_status text,
  action_status text,
  signed_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.client_tocc_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id
  );
$$;

comment on function public.record_client_tocc_assessment(
  uuid, uuid, uuid, date, text, text, text, text, text, uuid
) is
  'Records one immutable TOCC version with server-derived scope, actor, source, validity, signing evidence, and content hash.';
comment on function public.record_client_tocc_batch(uuid, uuid, jsonb, uuid) is
  'Processes 1-100 TOCC items through the same private single-item core and returns per-item success or structured failure without duplicating prior successes.';
comment on function public.client_tocc_snapshot(uuid, uuid, uuid) is
  'Returns only each authorized client latest TOCC business projection; no actor, challenge, hash, or idempotency evidence is exposed.';

revoke all on table public.client_tocc_assessments
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on table public.client_tocc_assessments
  from public, anon, authenticated, service_role;
revoke all on table private.client_tocc_operations
  from public, anon, authenticated, service_role;
revoke all on table private.client_tocc_batch_operations
  from public, anon, authenticated, service_role;

revoke all on function private.calculate_tocc_valid_through(date, text)
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_client_tocc_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.current_client_tocc_reauth_challenge()
  from public, anon, authenticated, service_role;
revoke all on function private.record_client_tocc_assessment_atomic(
  uuid, uuid, uuid, date, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.record_client_tocc_batch_atomic(
  uuid, uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.client_tocc_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_client_tocc_assessment(
  uuid, uuid, uuid, date, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_client_tocc_batch(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.client_tocc_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.record_client_tocc_assessment_atomic(
  uuid, uuid, uuid, date, text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.record_client_tocc_batch_atomic(
  uuid, uuid, jsonb, uuid
) to authenticated;
grant execute on function private.client_tocc_snapshot(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.record_client_tocc_assessment(
  uuid, uuid, uuid, date, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.record_client_tocc_batch(uuid, uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.client_tocc_snapshot(uuid, uuid, uuid)
  to authenticated;
