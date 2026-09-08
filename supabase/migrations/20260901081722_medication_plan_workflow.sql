-- Page 8: governed medication-plan authoring and immutable version history.
--
-- A medication plan is an immutable document version once submitted.  Its
-- active lifecycle is represented by append-only stop/replacement events, so
-- stopping or changing medication never rewrites the signed plan document.

alter table public.medication_plans
  add column workflow_version smallint,
  add column workflow_state text,
  add column medication_key text,
  add column schedule_key text,
  add column row_version bigint not null default 1,
  add column submitted_at timestamptz,
  add column submitted_by uuid references auth.users(id) on delete restrict,
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users(id) on delete restrict,
  add column approval_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  add column approval_signature_purpose text;

alter table public.medication_plans
  add constraint medication_plans_workflow_version_check
    check (workflow_version is null or workflow_version = 2),
  add constraint medication_plans_workflow_state_check
    check (
      workflow_state is null
      or workflow_state in ('draft', 'submitted', 'approved')
    ),
  add constraint medication_plans_row_version_check check (row_version > 0),
  add constraint medication_plans_medication_key_check check (
    medication_key is null
    or char_length(medication_key) between 1 and 240
  ),
  add constraint medication_plans_schedule_key_check check (
    schedule_key is null
    or schedule_key ~ '^[a-f0-9]{64}$'
  ),
  add constraint medication_plans_v2_state_check check (
    workflow_version is null
    or (
      medication_key is not null
      and schedule_key ~ '^[a-f0-9]{64}$'
      and source_system = 'local'
      and (
        (
          workflow_state = 'draft'
          and status = 'draft'
          and submitted_at is null
          and submitted_by is null
          and approved_at is null
          and approved_by is null
          and approval_reauth_challenge_id is null
          and approval_signature_purpose is null
          and signed_at is null
          and signed_by is null
          and content_hash is null
        )
        or (
          workflow_state = 'submitted'
          and status = 'draft'
          and submitted_at is not null
          and submitted_by is not null
          and approved_at is null
          and approved_by is null
          and approval_reauth_challenge_id is null
          and approval_signature_purpose is null
          and signed_at is null
          and signed_by is null
          and content_hash is null
        )
        or (
          workflow_state = 'approved'
          and status = 'active'
          and submitted_at is not null
          and submitted_by is not null
          and approved_at is not null
          and approved_by is not null
          and approved_by <> submitted_by
          and approval_reauth_challenge_id is not null
          and approval_signature_purpose = '用藥計畫獨立核准簽署'
          and signed_at = approved_at
          and signed_by = approved_by
          and content_hash ~ '^[a-f0-9]{64}$'
        )
      )
    )
  );

comment on column public.medication_plans.workflow_version is
  'Version 2 identifies plans authored by the governed page-8 workflow.';
comment on column public.medication_plans.medication_key is
  'Server-normalized medication identity used with schedule_key for overlap serialization.';
comment on column public.medication_plans.schedule_key is
  'Server-derived SHA-256 of the canonical JSON schedule; callers cannot supply it.';
comment on column public.medication_plans.approval_reauth_challenge_id is
  'Exact immutable consumed AAL2 challenge supporting independent plan approval.';

create index medication_plans_v2_client_state_idx
  on public.medication_plans (
    organization_id,
    branch_id,
    client_id,
    workflow_state,
    effective_from desc
  )
  where workflow_version = 2;
create index medication_plans_v2_natural_window_idx
  on public.medication_plans (
    organization_id,
    branch_id,
    client_id,
    medication_key,
    schedule_key,
    effective_from,
    effective_to
  )
  where workflow_version = 2 and workflow_state = 'approved';
create index medication_plans_v2_submission_evidence_idx
  on public.medication_plans (submitted_by, submitted_at)
  where workflow_version = 2 and submitted_by is not null;
create index medication_plans_v2_approval_evidence_idx
  on public.medication_plans (approval_reauth_challenge_id)
  where approval_reauth_challenge_id is not null;
create index medication_plans_v2_approved_by_idx
  on public.medication_plans (approved_by, approved_at desc)
  where approved_by is not null;
create unique index medication_plans_v2_one_submitted_stream_idx
  on public.medication_plans (organization_id, record_key)
  where workflow_version = 2 and workflow_state = 'submitted';

create table private.medication_plan_terminations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  medication_plan_id uuid not null,
  termination_kind text not null,
  replacement_plan_id uuid,
  effective_at timestamptz not null,
  reason text not null,
  stopped_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint medication_plan_terminations_plan_fkey
    foreign key (medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint medication_plan_terminations_replacement_fkey
    foreign key (replacement_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint medication_plan_terminations_one_per_plan_key
    unique (medication_plan_id),
  constraint medication_plan_terminations_kind_check
    check (termination_kind in ('stopped', 'replaced')),
  constraint medication_plan_terminations_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint medication_plan_terminations_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint medication_plan_terminations_replacement_check check (
    (termination_kind = 'stopped' and replacement_plan_id is null)
    or (
      termination_kind = 'replaced'
      and replacement_plan_id is not null
      and replacement_plan_id <> medication_plan_id
    )
  )
);

comment on table private.medication_plan_terminations is
  'Append-only server-timed stop/replacement events; signed plan rows are never rewritten.';

create index medication_plan_terminations_scope_time_idx
  on private.medication_plan_terminations (
    organization_id,
    branch_id,
    client_id,
    effective_at desc
  );
create index medication_plan_terminations_replacement_idx
  on private.medication_plan_terminations (replacement_plan_id)
  where replacement_plan_id is not null;
create index medication_plan_terminations_actor_idx
  on private.medication_plan_terminations (stopped_by, effective_at desc);
create index medication_plan_terminations_evidence_idx
  on private.medication_plan_terminations (reauth_challenge_id);

create table private.medication_plan_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  medication_plan_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_key uuid not null,
  result_version integer not null,
  result_workflow_state text not null,
  result_row_version bigint not null,
  result_effective_from timestamptz not null,
  result_action_at timestamptz,
  result_termination_id uuid references private.medication_plan_terminations(id) on delete restrict,
  result_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  result_content_hash text,
  created_at timestamptz not null default clock_timestamp(),
  constraint medication_plan_operations_plan_fkey
    foreign key (medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint medication_plan_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint medication_plan_operations_kind_check
    check (operation_kind in ('create_draft', 'submit', 'approve', 'stop')),
  constraint medication_plan_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint medication_plan_operations_result_state_check
    check (result_workflow_state in ('draft', 'submitted', 'approved', 'stopped', 'replaced')),
  constraint medication_plan_operations_result_version_check
    check (result_version > 0 and result_row_version > 0),
  constraint medication_plan_operations_evidence_check check (
    (
      operation_kind = 'create_draft'
      and result_reauth_challenge_id is null
      and result_content_hash is null
      and result_termination_id is null
      and result_action_at is null
    )
    or (
      operation_kind = 'submit'
      and result_reauth_challenge_id is null
      and result_content_hash is null
      and result_termination_id is null
      and result_action_at is not null
    )
    or (
      operation_kind = 'approve'
      and result_reauth_challenge_id is not null
      and result_content_hash ~ '^[a-f0-9]{64}$'
      and result_action_at is not null
    )
    or (
      operation_kind = 'stop'
      and result_reauth_challenge_id is not null
      and result_content_hash ~ '^[a-f0-9]{64}$'
      and result_termination_id is not null
      and result_action_at is not null
    )
  )
);

comment on table private.medication_plan_operations is
  'Append-only actor-scoped exact-replay receipts for governed page-8 RPC writes.';

create index medication_plan_operations_scope_plan_idx
  on private.medication_plan_operations (
    organization_id,
    branch_id,
    client_id,
    medication_plan_id,
    created_at desc
  );
create index medication_plan_operations_plan_fkey_idx
  on private.medication_plan_operations (
    medication_plan_id,
    organization_id,
    branch_id,
    client_id
  );
create index medication_plan_operations_evidence_idx
  on private.medication_plan_operations (result_reauth_challenge_id)
  where result_reauth_challenge_id is not null;
create index medication_plan_operations_termination_idx
  on private.medication_plan_operations (result_termination_id)
  where result_termination_id is not null;

alter table private.medication_plan_terminations enable row level security;
alter table private.medication_plan_terminations force row level security;
alter table private.medication_plan_operations enable row level security;
alter table private.medication_plan_operations force row level security;

create or replace function private.prevent_medication_plan_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'medication plan lifecycle and operation history is immutable';
end;
$$;

create trigger medication_plan_terminations_prevent_mutation
before update or delete on private.medication_plan_terminations
for each row execute function private.prevent_medication_plan_history_mutation();

create trigger medication_plan_operations_prevent_mutation
before update or delete on private.medication_plan_operations
for each row execute function private.prevent_medication_plan_history_mutation();

create trigger medication_plan_terminations_audit_insert
after insert on private.medication_plan_terminations
for each row execute function private.audit_row_change();

create trigger medication_plan_operations_audit_insert
after insert on private.medication_plan_operations
for each row execute function private.audit_row_change();

create or replace function private.protect_medication_plan_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.workflow_version is distinct from 2 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'governed medication plan versions are immutable';
  end if;

  if old.workflow_state = 'draft'
     and new.workflow_state = 'submitted'
     and (
       to_jsonb(new) - array[
         'workflow_state', 'submitted_at', 'submitted_by', 'row_version', 'updated_at'
       ]
     ) is not distinct from (
       to_jsonb(old) - array[
         'workflow_state', 'submitted_at', 'submitted_by', 'row_version', 'updated_at'
       ]
     ) then
    return new;
  end if;

  if old.workflow_state = 'submitted'
     and new.workflow_state = 'approved'
     and (
       to_jsonb(new) - array[
         'workflow_state', 'status', 'effective_from', 'approved_at', 'approved_by',
         'approval_reauth_challenge_id', 'approval_signature_purpose', 'signed_at',
         'signed_by', 'content_hash', 'row_version', 'updated_at'
       ]
     ) is not distinct from (
       to_jsonb(old) - array[
         'workflow_state', 'status', 'effective_from', 'approved_at', 'approved_by',
         'approval_reauth_challenge_id', 'approval_signature_purpose', 'signed_at',
         'signed_by', 'content_hash', 'row_version', 'updated_at'
       ]
     ) then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'medication plan versions may only be submitted once and independently approved once';
end;
$$;

create trigger medication_plans_protect_v2
before update or delete on public.medication_plans
for each row execute function private.protect_medication_plan_v2();

create or replace function private.require_medication_plan_reauth_evidence(
  p_actor_user_id uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor_user_id is null
     or p_at is null
     or p_actor_user_id <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication plan approval';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication plan approval';
  end;

  if v_session_id is null then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication plan approval';
  end if;

  select challenge.id
    into v_challenge_id
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = p_actor_user_id
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
    and challenge.factor_verified_at >= p_at - interval '15 minutes'
    and challenge.factor_verified_at <= p_at + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  if v_challenge_id is null then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication plan approval';
  end if;

  return v_challenge_id;
end;
$$;

create or replace function private.require_medication_plan_replay_evidence(
  p_actor_user_id uuid,
  p_receipt_challenge_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current_challenge_id uuid;
begin
  if p_actor_user_id is null
     or p_receipt_challenge_id is null
     or p_actor_user_id <> auth.uid()
     or not exists (
       select 1
       from private.reauth_challenges receipt
       where receipt.id = p_receipt_challenge_id
         and receipt.user_id = p_actor_user_id
         and receipt.consumed_at is not null
         and receipt.invalidated_at is null
         and receipt.factor_method in ('totp', 'webauthn', 'phone')
         and receipt.factor_verified_at is not null
     ) then
    raise exception using
      errcode = '42501',
      message = 'current AAL2 and immutable evidence are required to replay medication plan signing';
  end if;

  v_current_challenge_id := private.require_medication_plan_reauth_evidence(
    p_actor_user_id,
    clock_timestamp()
  );

  return v_current_challenge_id is not null;
end;
$$;

create or replace function private.medication_schedule_is_valid(p_schedule jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select
    p_schedule is not null
    and jsonb_typeof(p_schedule) = 'object'
    and jsonb_typeof(p_schedule -> 'times') = 'array'
    and p_schedule = jsonb_build_object('times', p_schedule -> 'times')
    and octet_length(p_schedule::text) <= 512
    and jsonb_array_length(p_schedule -> 'times') between 1 and 24
    and not exists (
      select 1
      from jsonb_array_elements_text(p_schedule -> 'times') value
      where value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    )
    and (
      select count(*) = count(distinct value)
      from jsonb_array_elements_text(p_schedule -> 'times') value
    );
$$;

create or replace function private.medication_plan_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
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
    auth.uid() is not null
    and p_expected_organization_id is not null
    and p_expected_branch_id is not null
    and p_client_id is not null
    and exists (
      select 1
      from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and exists (
      select 1
      from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
    )
    and private.can_staff_access_client(p_client_id, p_permission_key)
    and private.can_staff_access_client(p_client_id, 'clients.read');
$$;

create or replace function private.create_medication_plan_draft_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_previous_plan_id uuid,
  p_medication_name text,
  p_dose numeric,
  p_dose_unit text,
  p_route text,
  p_schedule jsonb,
  p_high_risk boolean,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  effective_from timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_medication_name text := nullif(regexp_replace(btrim(p_medication_name), '\s+', ' ', 'g'), '');
  v_dose_unit text := nullif(regexp_replace(btrim(p_dose_unit), '\s+', ' ', 'g'), '');
  v_route text := nullif(regexp_replace(btrim(p_route), '\s+', ' ', 'g'), '');
  v_medication_key text;
  v_schedule_key text;
  v_request_hash text;
  v_record_key uuid;
  v_version integer;
  v_previous public.medication_plans%rowtype;
  v_created public.medication_plans%rowtype;
  v_operation private.medication_plan_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_idempotency_key is null
     or v_medication_name is null
     or char_length(v_medication_name) > 200
     or p_dose is null
     or p_dose <= 0
     or p_dose > 100000
     or v_dose_unit is null
     or char_length(v_dose_unit) > 32
     or v_route is null
     or char_length(v_route) > 80
     or p_high_risk is null
     or p_effective_from is null
     or (p_effective_to is not null and p_effective_to <= p_effective_from)
     or not private.medication_schedule_is_valid(p_schedule) then
    raise exception using
      errcode = '22023',
      message = 'valid medication plan draft fields and at least one unique HH:MM schedule time are required';
  end if;

  if not private.medication_plan_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    'medications.manage'
  ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan drafting is not permitted in the selected client scope';
  end if;

  v_medication_key := lower(v_medication_name);
  select encode(
    sha256(convert_to(jsonb_agg(slot_time order by slot_time)::text, 'UTF8')),
    'hex'
  ) into v_schedule_key
  from jsonb_array_elements_text(p_schedule -> 'times') slot(slot_time);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 2,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'previous_plan_id', p_previous_plan_id,
    'medication_name', v_medication_name,
    'dose', p_dose,
    'dose_unit', v_dose_unit,
    'route', v_route,
    'schedule', p_schedule,
    'high_risk', p_high_risk,
    'effective_from', p_effective_from,
    'effective_to', p_effective_to,
    'created_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.medication_plan_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_operation.operation_kind <> 'create_draft'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'medication plan operation idempotency conflict';
    end if;

    return query select
      v_operation.medication_plan_id,
      v_operation.client_id,
      v_operation.result_record_key,
      v_operation.result_version,
      v_operation.result_workflow_state,
      v_operation.result_row_version,
      v_operation.result_effective_from,
      true;
    return;
  end if;

  perform 1
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
    and client.status = 'active'
    and client.admitted_on is not null
    and client.ended_on is null
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'medication plans require an active, admitted, and unended client';
  end if;

  if p_previous_plan_id is null then
    v_record_key := gen_random_uuid();
    v_version := 1;
    perform pg_advisory_xact_lock(hashtextextended(
      'medication-plan-stream:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_client_id::text || ':' || v_record_key::text,
      0
    ));
  else
    select candidate.* into v_previous
    from public.medication_plans candidate
    where candidate.id = p_previous_plan_id
      and candidate.organization_id = p_expected_organization_id
      and candidate.branch_id = p_expected_branch_id
      and candidate.client_id = p_client_id
      and candidate.workflow_version = 2
    for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'previous medication plan is outside the selected client scope';
    end if;

    v_record_key := v_previous.record_key;
    perform pg_advisory_xact_lock(hashtextextended(
      'medication-plan-stream:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_client_id::text || ':' || v_record_key::text,
      0
    ));

    if exists (
      select 1
      from public.medication_plans newer
      where newer.organization_id = p_expected_organization_id
        and newer.branch_id = p_expected_branch_id
        and newer.client_id = p_client_id
        and newer.record_key = v_record_key
        and newer.version > v_previous.version
    ) then
      raise exception using
        errcode = '40001',
        message = 'a medication plan revision must branch from the latest version';
    end if;

    if exists (
      select 1
      from private.medication_plan_terminations incoming
      where incoming.replacement_plan_id = v_previous.id
        and incoming.termination_kind = 'replaced'
        and incoming.effective_at > clock_timestamp()
    ) then
      raise exception using
        errcode = '23514',
        message = 'a future replacement target is locked against revision until its immutable scheduled cutover';
    end if;

    v_version := v_previous.version + 1;
  end if;

  if not private.medication_plan_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    'medications.manage'
  ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan drafting authority expired';
  end if;

  insert into public.medication_plans (
    organization_id,
    branch_id,
    client_id,
    record_key,
    version,
    previous_version_id,
    medication_name,
    dose,
    dose_unit,
    route,
    schedule,
    high_risk,
    effective_from,
    effective_to,
    status,
    source_system,
    created_by,
    workflow_version,
    workflow_state,
    medication_key,
    schedule_key,
    row_version
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    v_record_key,
    v_version,
    p_previous_plan_id,
    v_medication_name,
    p_dose,
    v_dose_unit,
    v_route,
    p_schedule,
    p_high_risk,
    p_effective_from,
    p_effective_to,
    'draft',
    'local',
    v_actor,
    2,
    'draft',
    v_medication_key,
    v_schedule_key,
    1
  ) returning * into v_created;

  insert into private.medication_plan_operations (
    organization_id,
    branch_id,
    client_id,
    medication_plan_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_record_key,
    result_version,
    result_workflow_state,
    result_row_version,
    result_effective_from
  ) values (
    v_created.organization_id,
    v_created.branch_id,
    v_created.client_id,
    v_created.id,
    v_actor,
    'create_draft',
    p_idempotency_key,
    v_request_hash,
    v_created.record_key,
    v_created.version,
    v_created.workflow_state,
    v_created.row_version,
    v_created.effective_from
  );

  return query select
    v_created.id,
    v_created.client_id,
    v_created.record_key,
    v_created.version,
    v_created.workflow_state,
    v_created.row_version,
    v_created.effective_from,
    false;
end;
$$;

create or replace function private.create_medication_plan_draft_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_previous_plan_id uuid,
  p_medication_name text,
  p_dose numeric,
  p_dose_unit text,
  p_route text,
  p_schedule jsonb,
  p_high_risk boolean,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  effective_from timestamptz,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.create_medication_plan_draft_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_previous_plan_id,
    p_medication_name,
    p_dose,
    p_dose_unit,
    p_route,
    p_schedule,
    p_high_risk,
    p_effective_from,
    p_effective_to,
    p_idempotency_key
  );
$$;

create or replace function public.create_medication_plan_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_previous_plan_id uuid,
  p_medication_name text,
  p_dose numeric,
  p_dose_unit text,
  p_route text,
  p_schedule jsonb,
  p_high_risk boolean,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  effective_from timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.create_medication_plan_draft_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_previous_plan_id,
    p_medication_name,
    p_dose,
    p_dose_unit,
    p_route,
    p_schedule,
    p_high_risk,
    p_effective_from,
    p_effective_to,
    p_idempotency_key
  );
$$;

create or replace function private.submit_medication_plan_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  submitted_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_plan public.medication_plans%rowtype;
  v_operation private.medication_plan_operations%rowtype;
  v_request_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_medication_plan_id is null
     or p_expected_row_version is null
     or p_expected_row_version < 1
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'valid medication plan submission fields are required';
  end if;

  select plan.* into v_plan
  from public.medication_plans plan
  where plan.id = p_medication_plan_id
    and plan.organization_id = p_expected_organization_id
    and plan.branch_id = p_expected_branch_id
    and plan.workflow_version = 2
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'medication plan is outside the selected tenant context';
  end if;

  if not private.medication_plan_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    v_plan.client_id,
    'medications.manage'
  ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan submission is not permitted in the selected client scope';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 2,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'medication_plan_id', p_medication_plan_id,
    'expected_row_version', p_expected_row_version,
    'submitted_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.medication_plan_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_operation.operation_kind <> 'submit'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.medication_plan_id <> p_medication_plan_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'medication plan operation idempotency conflict';
    end if;

    return query select
      v_operation.medication_plan_id,
      v_operation.client_id,
      v_operation.result_record_key,
      v_operation.result_version,
      v_operation.result_workflow_state,
      v_operation.result_row_version,
      v_operation.result_action_at,
      true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-stream:' || v_plan.organization_id::text || ':' ||
    v_plan.branch_id::text || ':' || v_plan.client_id::text || ':' ||
    v_plan.record_key::text,
    0
  ));

  if v_plan.workflow_state <> 'draft'
     or v_plan.status <> 'draft'
     or v_plan.signed_at is not null then
    raise exception using
      errcode = '23514',
      message = 'only an unsigned medication plan draft may be submitted';
  end if;

  if v_plan.row_version <> p_expected_row_version then
    raise exception using
      errcode = '40001',
      message = 'medication plan row version changed before submission';
  end if;

  if exists (
    select 1
    from public.medication_plans newer
    where newer.organization_id = v_plan.organization_id
      and newer.branch_id = v_plan.branch_id
      and newer.client_id = v_plan.client_id
      and newer.record_key = v_plan.record_key
      and newer.version > v_plan.version
  ) then
    raise exception using
      errcode = '40001',
      message = 'only the latest medication plan version may be submitted';
  end if;

  if not private.medication_plan_authority(
    v_plan.organization_id,
    v_plan.branch_id,
    v_plan.client_id,
    'medications.manage'
  ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan submission authority expired';
  end if;

  v_now := clock_timestamp();
  update public.medication_plans plan
  set workflow_state = 'submitted',
      submitted_at = v_now,
      submitted_by = v_actor,
      row_version = plan.row_version + 1,
      updated_at = v_now
  where plan.id = v_plan.id
  returning * into v_plan;

  insert into private.medication_plan_operations (
    organization_id,
    branch_id,
    client_id,
    medication_plan_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_record_key,
    result_version,
    result_workflow_state,
    result_row_version,
    result_effective_from,
    result_action_at
  ) values (
    v_plan.organization_id,
    v_plan.branch_id,
    v_plan.client_id,
    v_plan.id,
    v_actor,
    'submit',
    p_idempotency_key,
    v_request_hash,
    v_plan.record_key,
    v_plan.version,
    v_plan.workflow_state,
    v_plan.row_version,
    v_plan.effective_from,
    v_plan.submitted_at
  );

  return query select
    v_plan.id,
    v_plan.client_id,
    v_plan.record_key,
    v_plan.version,
    v_plan.workflow_state,
    v_plan.row_version,
    v_plan.submitted_at,
    false;
end;
$$;

create or replace function private.submit_medication_plan_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  submitted_at timestamptz,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.submit_medication_plan_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_plan_id,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

create or replace function public.submit_medication_plan(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  submitted_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.submit_medication_plan_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_plan_id,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

create or replace function private.approve_medication_plan_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  effective_from timestamptz,
  approved_at timestamptz,
  replacement_effective_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_effective_from timestamptz;
  v_challenge_id uuid;
  v_content_hash text;
  v_replacement_hash text;
  v_request_hash text;
  v_plan public.medication_plans%rowtype;
  v_previous public.medication_plans%rowtype;
  v_operation private.medication_plan_operations%rowtype;
  v_termination private.medication_plan_terminations%rowtype;
  v_replacement_reason text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_medication_plan_id is null
     or p_expected_row_version is null
     or p_expected_row_version < 1
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'valid medication plan approval fields are required';
  end if;

  select plan.* into v_plan
  from public.medication_plans plan
  where plan.id = p_medication_plan_id
    and plan.organization_id = p_expected_organization_id
    and plan.branch_id = p_expected_branch_id
    and plan.workflow_version = 2
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'medication plan is outside the selected tenant context';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15)
     or not private.medication_plan_authority(
       p_expected_organization_id,
       p_expected_branch_id,
       v_plan.client_id,
       'medications.manage'
     ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan approval is not permitted in the selected client scope';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 2,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'medication_plan_id', p_medication_plan_id,
    'expected_row_version', p_expected_row_version,
    'approved_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.medication_plan_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_operation.operation_kind <> 'approve'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.medication_plan_id <> p_medication_plan_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'medication plan operation idempotency conflict';
    end if;

    perform private.require_medication_plan_replay_evidence(
      v_actor,
      v_operation.result_reauth_challenge_id
    );

    return query select
      v_operation.medication_plan_id,
      v_operation.client_id,
      v_operation.result_record_key,
      v_operation.result_version,
      v_operation.result_workflow_state,
      v_operation.result_row_version,
      v_operation.result_effective_from,
      v_operation.result_action_at,
      termination.effective_at,
      true
    from (select 1) singleton
    left join private.medication_plan_terminations termination
      on termination.id = v_operation.result_termination_id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-stream:' || v_plan.organization_id::text || ':' ||
    v_plan.branch_id::text || ':' || v_plan.client_id::text || ':' ||
    v_plan.record_key::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-natural-window:' || v_plan.organization_id::text || ':' ||
    v_plan.branch_id::text || ':' || v_plan.client_id::text || ':' ||
    v_plan.medication_key || ':' || v_plan.schedule_key,
    0
  ));

  if v_plan.workflow_state <> 'submitted'
     or v_plan.status <> 'draft'
     or v_plan.signed_at is not null
     or v_plan.submitted_by is null then
    raise exception using
      errcode = '23514',
      message = 'only one submitted unsigned medication plan may be approved';
  end if;

  if v_plan.submitted_by = v_actor then
    raise exception using
      errcode = '42501',
      message = 'medication plan approval requires an independent second person';
  end if;

  if v_plan.row_version <> p_expected_row_version then
    raise exception using
      errcode = '40001',
      message = 'medication plan row version changed before approval';
  end if;

  if exists (
    select 1
    from public.medication_plans newer
    where newer.organization_id = v_plan.organization_id
      and newer.branch_id = v_plan.branch_id
      and newer.client_id = v_plan.client_id
      and newer.record_key = v_plan.record_key
      and newer.version > v_plan.version
  ) then
    raise exception using
      errcode = '40001',
      message = 'only the latest medication plan version may be approved';
  end if;

  perform 1
  from public.clients client
  where client.id = v_plan.client_id
    and client.organization_id = v_plan.organization_id
    and client.branch_id = v_plan.branch_id
    and client.status = 'active'
    and client.admitted_on is not null
    and client.ended_on is null
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'medication plan approval requires an active, admitted, and unended client';
  end if;

  if not private.medication_plan_authority(
       v_plan.organization_id,
       v_plan.branch_id,
       v_plan.client_id,
       'medications.manage'
     )
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using
      errcode = '42501',
      message = 'medication plan approval authority expired';
  end if;

  v_now := clock_timestamp();
  v_challenge_id := private.require_medication_plan_reauth_evidence(v_actor, v_now);
  -- A future-dated replacement must stay future-dated.  Past dates are
  -- clamped to the approval server time so an approval cannot back-date a
  -- clinical cutover.
  v_effective_from := greatest(v_plan.effective_from, v_now);

  if v_plan.effective_to is not null
     and v_plan.effective_to <= v_effective_from then
    raise exception using
      errcode = '22023',
      message = 'replacement medication plan must remain effective after its server-governed cutover';
  end if;

  if v_plan.previous_version_id is not null then
    select previous.* into v_previous
    from public.medication_plans previous
    where previous.id = v_plan.previous_version_id
      and previous.organization_id = v_plan.organization_id
      and previous.branch_id = v_plan.branch_id
      and previous.client_id = v_plan.client_id
      and previous.record_key = v_plan.record_key
      and previous.version = v_plan.version - 1
      and previous.workflow_version = 2
    for update;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'medication plan revision history is invalid';
    end if;

    if v_previous.workflow_state = 'approved'
       and (v_previous.effective_to is null or v_previous.effective_to > v_effective_from)
       and not exists (
         select 1
         from private.medication_plan_terminations termination
         where termination.medication_plan_id = v_previous.id
       ) then
      v_replacement_reason := format(
        '核准第 %s 版計畫後於伺服器治理生效時間取代第 %s 版',
        v_plan.version,
        v_previous.version
      );
      v_replacement_hash := encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 2,
        'organization_id', v_plan.organization_id,
        'branch_id', v_plan.branch_id,
        'client_id', v_plan.client_id,
        'medication_plan_id', v_previous.id,
        'termination_kind', 'replaced',
        'replacement_plan_id', v_plan.id,
        'effective_at', v_effective_from,
        'reason', v_replacement_reason,
        'stopped_by', v_actor,
        'reauth_challenge_id', v_challenge_id
      )::text, 'UTF8')), 'hex');

      insert into private.medication_plan_terminations (
        organization_id,
        branch_id,
        client_id,
        medication_plan_id,
        termination_kind,
        replacement_plan_id,
        effective_at,
        reason,
        stopped_by,
        reauth_challenge_id,
        content_hash
      ) values (
        v_plan.organization_id,
        v_plan.branch_id,
        v_plan.client_id,
        v_previous.id,
        'replaced',
        v_plan.id,
        v_effective_from,
        v_replacement_reason,
        v_actor,
        v_challenge_id,
        v_replacement_hash
      ) returning * into v_termination;

      update public.medication_administrations administration
      set status = 'voided',
          reason = '用藥計畫已於新版核准時取代',
          updated_at = v_now
      where administration.medication_plan_id = v_previous.id
        and administration.organization_id = v_previous.organization_id
        and administration.branch_id = v_previous.branch_id
        and administration.client_id = v_previous.client_id
        and administration.status = 'scheduled'
        and administration.scheduled_for >= v_effective_from;
    end if;
  end if;

  if exists (
    select 1
    from public.medication_plans candidate
    left join private.medication_plan_terminations termination
      on termination.medication_plan_id = candidate.id
    where candidate.id <> v_plan.id
      and candidate.organization_id = v_plan.organization_id
      and candidate.branch_id = v_plan.branch_id
      and candidate.client_id = v_plan.client_id
      and candidate.workflow_version = 2
      and candidate.workflow_state = 'approved'
      and candidate.medication_key = v_plan.medication_key
      and candidate.schedule_key = v_plan.schedule_key
      and candidate.effective_from < coalesce(v_plan.effective_to, 'infinity'::timestamptz)
      and v_effective_from < least(
        coalesce(candidate.effective_to, 'infinity'::timestamptz),
        coalesce(termination.effective_at, 'infinity'::timestamptz)
      )
  ) then
    raise exception using
      errcode = '23P01',
      message = 'an approved medication plan already covers this client, medication, schedule, and effective period';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 2,
    'organization_id', v_plan.organization_id,
    'branch_id', v_plan.branch_id,
    'client_id', v_plan.client_id,
    'plan_id', v_plan.id,
    'record_key', v_plan.record_key,
    'version', v_plan.version,
    'previous_version_id', v_plan.previous_version_id,
    'medication_name', v_plan.medication_name,
    'dose', v_plan.dose,
    'dose_unit', v_plan.dose_unit,
    'route', v_plan.route,
    'schedule', v_plan.schedule,
    'high_risk', v_plan.high_risk,
    'effective_from', v_effective_from,
    'effective_to', v_plan.effective_to,
    'submitted_at', v_plan.submitted_at,
    'submitted_by', v_plan.submitted_by,
    'approved_at', v_now,
    'approved_by', v_actor,
    'approval_reauth_challenge_id', v_challenge_id,
    'signature_purpose', '用藥計畫獨立核准簽署'
  )::text, 'UTF8')), 'hex');

  update public.medication_plans plan
  set workflow_state = 'approved',
      status = 'active',
      effective_from = v_effective_from,
      approved_at = v_now,
      approved_by = v_actor,
      approval_reauth_challenge_id = v_challenge_id,
      approval_signature_purpose = '用藥計畫獨立核准簽署',
      signed_at = v_now,
      signed_by = v_actor,
      content_hash = v_content_hash,
      row_version = plan.row_version + 1,
      updated_at = v_now
  where plan.id = v_plan.id
  returning * into v_plan;

  insert into private.medication_plan_operations (
    organization_id,
    branch_id,
    client_id,
    medication_plan_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_record_key,
    result_version,
    result_workflow_state,
    result_row_version,
    result_effective_from,
    result_action_at,
    result_termination_id,
    result_reauth_challenge_id,
    result_content_hash
  ) values (
    v_plan.organization_id,
    v_plan.branch_id,
    v_plan.client_id,
    v_plan.id,
    v_actor,
    'approve',
    p_idempotency_key,
    v_request_hash,
    v_plan.record_key,
    v_plan.version,
    v_plan.workflow_state,
    v_plan.row_version,
    v_plan.effective_from,
    v_plan.approved_at,
    v_termination.id,
    v_challenge_id,
    v_content_hash
  );

  return query select
    v_plan.id,
    v_plan.client_id,
    v_plan.record_key,
    v_plan.version,
    v_plan.workflow_state,
    v_plan.row_version,
    v_plan.effective_from,
    v_plan.approved_at,
    v_termination.effective_at,
    false;
end;
$$;

create or replace function private.approve_medication_plan_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  effective_from timestamptz,
  approved_at timestamptz,
  replacement_effective_at timestamptz,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.approve_medication_plan_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_plan_id,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

create or replace function public.approve_medication_plan(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  workflow_state text,
  row_version bigint,
  effective_from timestamptz,
  approved_at timestamptz,
  replacement_effective_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.approve_medication_plan_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_plan_id,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

create or replace function private.stop_medication_plan_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  row_version bigint,
  lifecycle_state text,
  stopped_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(regexp_replace(btrim(p_reason), '\s+', ' ', 'g'), '');
  v_now timestamptz;
  v_challenge_id uuid;
  v_content_hash text;
  v_request_hash text;
  v_plan public.medication_plans%rowtype;
  v_operation private.medication_plan_operations%rowtype;
  v_termination private.medication_plan_terminations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_medication_plan_id is null
     or p_expected_row_version is null
     or p_expected_row_version < 1
     or v_reason is null
     or char_length(v_reason) > 1000
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'valid medication plan stop fields and reason are required';
  end if;

  select plan.* into v_plan
  from public.medication_plans plan
  where plan.id = p_medication_plan_id
    and plan.organization_id = p_expected_organization_id
    and plan.branch_id = p_expected_branch_id
    and plan.workflow_version = 2
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'medication plan is outside the selected tenant context';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15)
     or not private.medication_plan_authority(
       p_expected_organization_id,
       p_expected_branch_id,
       v_plan.client_id,
       'medications.manage'
     ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan stop is not permitted in the selected client scope';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 2,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'medication_plan_id', p_medication_plan_id,
    'expected_row_version', p_expected_row_version,
    'reason', v_reason,
    'stopped_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.medication_plan_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_operation.operation_kind <> 'stop'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.medication_plan_id <> p_medication_plan_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'medication plan operation idempotency conflict';
    end if;

    perform private.require_medication_plan_replay_evidence(
      v_actor,
      v_operation.result_reauth_challenge_id
    );

    return query select
      v_operation.medication_plan_id,
      v_operation.client_id,
      v_operation.result_record_key,
      v_operation.result_version,
      v_operation.result_row_version,
      v_operation.result_workflow_state,
      v_operation.result_action_at,
      true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-stream:' || v_plan.organization_id::text || ':' ||
    v_plan.branch_id::text || ':' || v_plan.client_id::text || ':' ||
    v_plan.record_key::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'medication-plan-natural-window:' || v_plan.organization_id::text || ':' ||
    v_plan.branch_id::text || ':' || v_plan.client_id::text || ':' ||
    v_plan.medication_key || ':' || v_plan.schedule_key,
    0
  ));

  if v_plan.workflow_state <> 'approved'
     or v_plan.signed_at is null
     or (v_plan.effective_to is not null and v_plan.effective_to <= clock_timestamp()) then
    raise exception using
      errcode = '23514',
      message = 'only an approved non-expired medication plan may be stopped';
  end if;

  if v_plan.row_version <> p_expected_row_version then
    raise exception using
      errcode = '40001',
      message = 'medication plan row version changed before stop';
  end if;

  if exists (
    select 1
    from private.medication_plan_terminations incoming
    where incoming.replacement_plan_id = v_plan.id
      and incoming.termination_kind = 'replaced'
      and incoming.effective_at > clock_timestamp()
  ) then
    raise exception using
      errcode = '23514',
      message = 'a future replacement target is locked by its immutable scheduled cutover';
  end if;

  if exists (
    select 1
    from private.medication_plan_terminations termination
    where termination.medication_plan_id = v_plan.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'medication plan already has a terminal lifecycle event';
  end if;

  if not private.medication_plan_authority(
       v_plan.organization_id,
       v_plan.branch_id,
       v_plan.client_id,
       'medications.manage'
     )
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using
      errcode = '42501',
      message = 'medication plan stop authority expired';
  end if;

  v_now := clock_timestamp();
  v_challenge_id := private.require_medication_plan_reauth_evidence(v_actor, v_now);
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 2,
    'organization_id', v_plan.organization_id,
    'branch_id', v_plan.branch_id,
    'client_id', v_plan.client_id,
    'medication_plan_id', v_plan.id,
    'termination_kind', 'stopped',
    'replacement_plan_id', null,
    'effective_at', v_now,
    'reason', v_reason,
    'stopped_by', v_actor,
    'reauth_challenge_id', v_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into private.medication_plan_terminations (
    organization_id,
    branch_id,
    client_id,
    medication_plan_id,
    termination_kind,
    replacement_plan_id,
    effective_at,
    reason,
    stopped_by,
    reauth_challenge_id,
    content_hash
  ) values (
    v_plan.organization_id,
    v_plan.branch_id,
    v_plan.client_id,
    v_plan.id,
    'stopped',
    null,
    v_now,
    v_reason,
    v_actor,
    v_challenge_id,
    v_content_hash
  ) returning * into v_termination;

  update public.medication_administrations administration
  set status = 'voided',
      reason = '用藥計畫已停止',
      updated_at = v_now
  where administration.medication_plan_id = v_plan.id
    and administration.organization_id = v_plan.organization_id
    and administration.branch_id = v_plan.branch_id
    and administration.client_id = v_plan.client_id
    and administration.status = 'scheduled'
    and administration.scheduled_for >= v_now;

  insert into private.medication_plan_operations (
    organization_id,
    branch_id,
    client_id,
    medication_plan_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_record_key,
    result_version,
    result_workflow_state,
    result_row_version,
    result_effective_from,
    result_action_at,
    result_termination_id,
    result_reauth_challenge_id,
    result_content_hash
  ) values (
    v_plan.organization_id,
    v_plan.branch_id,
    v_plan.client_id,
    v_plan.id,
    v_actor,
    'stop',
    p_idempotency_key,
    v_request_hash,
    v_plan.record_key,
    v_plan.version,
    'stopped',
    v_plan.row_version,
    v_plan.effective_from,
    v_termination.effective_at,
    v_termination.id,
    v_challenge_id,
    v_content_hash
  );

  return query select
    v_plan.id,
    v_plan.client_id,
    v_plan.record_key,
    v_plan.version,
    v_plan.row_version,
    'stopped'::text,
    v_termination.effective_at,
    false;
end;
$$;

create or replace function private.stop_medication_plan_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  row_version bigint,
  lifecycle_state text,
  stopped_at timestamptz,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.stop_medication_plan_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_plan_id,
    p_expected_row_version,
    p_reason,
    p_idempotency_key
  );
$$;

create or replace function public.stop_medication_plan(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_plan_id uuid,
  p_expected_row_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  record_key uuid,
  version integer,
  row_version bigint,
  lifecycle_state text,
  stopped_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.stop_medication_plan_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_plan_id,
    p_expected_row_version,
    p_reason,
    p_idempotency_key
  );
$$;

create or replace function private.medication_plan_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid
)
returns table(
  plan_id uuid,
  record_key uuid,
  version integer,
  previous_version_id uuid,
  client_id uuid,
  medication_name text,
  dose numeric,
  dose_unit text,
  medication_route text,
  schedule jsonb,
  high_risk boolean,
  effective_from timestamptz,
  effective_to timestamptz,
  workflow_state text,
  submitted_by_current_actor boolean,
  lifecycle_state text,
  submitted_at timestamptz,
  approved_at timestamptz,
  terminated_at timestamptz,
  termination_kind text,
  termination_reason text,
  replacement_plan_id uuid,
  row_version bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or not private.medication_plan_authority(
       p_expected_organization_id,
       p_expected_branch_id,
       p_client_id,
       'medications.read'
     ) then
    raise exception using
      errcode = '42501',
      message = 'medication plan snapshot is not permitted in the selected client scope';
  end if;

  return query
    select
      plan.id,
      plan.record_key,
      plan.version,
      plan.previous_version_id,
      plan.client_id,
      plan.medication_name,
      plan.dose,
      plan.dose_unit,
      plan.route,
      plan.schedule,
      plan.high_risk,
      plan.effective_from,
      plan.effective_to,
      plan.workflow_state,
      coalesce(plan.submitted_by = v_actor, false),
      case
        when termination.effective_at <= clock_timestamp()
          and termination.termination_kind = 'stopped' then 'stopped'
        when termination.effective_at <= clock_timestamp()
          and termination.termination_kind = 'replaced' then 'replaced'
        when plan.workflow_state <> 'approved' then plan.workflow_state
        when plan.effective_from > clock_timestamp() then 'scheduled'
        when plan.effective_to is not null and plan.effective_to <= clock_timestamp() then 'expired'
        else 'active'
      end,
      plan.submitted_at,
      plan.approved_at,
      termination.effective_at,
      termination.termination_kind,
      termination.reason,
      termination.replacement_plan_id,
      plan.row_version
    from public.medication_plans plan
    left join private.medication_plan_terminations termination
      on termination.medication_plan_id = plan.id
    where plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id
      and plan.client_id = p_client_id
      and plan.workflow_version = 2
    order by plan.record_key, plan.version desc;

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
    'medication_plans',
    p_client_id::text,
    '{}'::text[],
    jsonb_build_object('result_count', v_result_count, 'projection', 'page8_minimal')
  );
end;
$$;

create or replace function private.medication_plan_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid
)
returns table(
  plan_id uuid,
  record_key uuid,
  version integer,
  previous_version_id uuid,
  client_id uuid,
  medication_name text,
  dose numeric,
  dose_unit text,
  medication_route text,
  schedule jsonb,
  high_risk boolean,
  effective_from timestamptz,
  effective_to timestamptz,
  workflow_state text,
  submitted_by_current_actor boolean,
  lifecycle_state text,
  submitted_at timestamptz,
  approved_at timestamptz,
  terminated_at timestamptz,
  termination_kind text,
  termination_reason text,
  replacement_plan_id uuid,
  row_version bigint
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.medication_plan_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id
  );
$$;

create or replace function public.medication_plan_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid
)
returns table(
  plan_id uuid,
  record_key uuid,
  version integer,
  previous_version_id uuid,
  client_id uuid,
  medication_name text,
  dose numeric,
  dose_unit text,
  medication_route text,
  schedule jsonb,
  high_risk boolean,
  effective_from timestamptz,
  effective_to timestamptz,
  workflow_state text,
  submitted_by_current_actor boolean,
  lifecycle_state text,
  submitted_at timestamptz,
  approved_at timestamptz,
  terminated_at timestamptz,
  termination_kind text,
  termination_reason text,
  replacement_plan_id uuid,
  row_version bigint
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.medication_plan_snapshot_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id
  );
$$;

comment on function public.create_medication_plan_draft(
  uuid, uuid, uuid, uuid, text, numeric, text, text, jsonb, boolean,
  timestamptz, timestamptz, uuid
) is
  'Creates a new immutable page-8 medication plan document version; identity, version, keys, source, and actor are server-derived.';
comment on function public.submit_medication_plan(uuid, uuid, uuid, bigint, uuid) is
  'Freezes the latest draft version for independent approval with optimistic concurrency and actor-scoped exact replay.';
comment on function public.approve_medication_plan(uuid, uuid, uuid, bigint, uuid) is
  'Independently approves one submitted version using recent immutable AAL2 evidence and serialized no-overlap checks.';
comment on function public.stop_medication_plan(uuid, uuid, uuid, bigint, text, uuid) is
  'Appends a server-timed signed stop event without mutating the approved plan document and voids future clean scheduled slots.';
comment on function public.medication_plan_snapshot(uuid, uuid, uuid) is
  'Returns a minimal page-8 projection without signer IDs, challenge IDs, source metadata, or content hashes.';

revoke all on table private.medication_plan_terminations
  from public, anon, authenticated, service_role;
revoke all on table private.medication_plan_operations
  from public, anon, authenticated, service_role;

revoke all on function private.prevent_medication_plan_history_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_medication_plan_v2()
  from public, anon, authenticated, service_role;
revoke all on function private.require_medication_plan_reauth_evidence(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_medication_plan_replay_evidence(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.medication_schedule_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.medication_plan_authority(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.create_medication_plan_draft_atomic(
  uuid, uuid, uuid, uuid, text, numeric, text, text, jsonb, boolean,
  timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.submit_medication_plan_atomic(
  uuid, uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.approve_medication_plan_atomic(
  uuid, uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.stop_medication_plan_atomic(
  uuid, uuid, uuid, bigint, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.medication_plan_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.create_medication_plan_draft_response(
  uuid, uuid, uuid, uuid, text, numeric, text, text, jsonb, boolean,
  timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.submit_medication_plan_response(
  uuid, uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.approve_medication_plan_response(
  uuid, uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.stop_medication_plan_response(
  uuid, uuid, uuid, bigint, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.medication_plan_snapshot_response(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_medication_plan_draft(
  uuid, uuid, uuid, uuid, text, numeric, text, text, jsonb, boolean,
  timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.submit_medication_plan(uuid, uuid, uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_medication_plan(uuid, uuid, uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.stop_medication_plan(uuid, uuid, uuid, bigint, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.medication_plan_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Only minimal private response shims are executable by authenticated.  Broad
-- atomic cores, evidence helpers, and the snapshot core remain unreachable.
grant execute on function private.create_medication_plan_draft_response(
  uuid, uuid, uuid, uuid, text, numeric, text, text, jsonb, boolean,
  timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function private.submit_medication_plan_response(
  uuid, uuid, uuid, bigint, uuid
) to authenticated;
grant execute on function private.approve_medication_plan_response(
  uuid, uuid, uuid, bigint, uuid
) to authenticated;
grant execute on function private.stop_medication_plan_response(
  uuid, uuid, uuid, bigint, text, uuid
) to authenticated;
grant execute on function private.medication_plan_snapshot_response(uuid, uuid, uuid)
  to authenticated;

grant execute on function public.create_medication_plan_draft(
  uuid, uuid, uuid, uuid, text, numeric, text, text, jsonb, boolean,
  timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.submit_medication_plan(uuid, uuid, uuid, bigint, uuid)
  to authenticated;
grant execute on function public.approve_medication_plan(uuid, uuid, uuid, bigint, uuid)
  to authenticated;
grant execute on function public.stop_medication_plan(uuid, uuid, uuid, bigint, text, uuid)
  to authenticated;
grant execute on function public.medication_plan_snapshot(uuid, uuid, uuid)
  to authenticated;

-- The page-8 workflow remains the only mutation surface, even for leaked
-- service-role credentials.  Truncate is included explicitly as defense in
-- depth; signed history is also trigger-protected.
revoke insert, update, delete, truncate on table public.medication_plans
  from authenticated, service_role;
revoke insert, update, delete, truncate on table public.medication_administrations
  from authenticated, service_role;
