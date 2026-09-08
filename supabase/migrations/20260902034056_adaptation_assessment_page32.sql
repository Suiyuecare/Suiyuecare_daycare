-- Page 32: manual, explicitly unstandardized adaptation assessments.
--
-- No official scale, score, formula, diagnosis, or unpublished institutional
-- form is represented here.  The first release stores staff-authored facts
-- under the explicit technical reference `manual-adaptation-v1`.  Assessment
-- versions and follow-up transitions are immutable append-only ledgers.

create table public.adaptation_assessment_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_state text not null,
  assessed_on date not null,
  adaptation_status text not null,
  assessment_summary text not null,
  reassessment_due_on date not null,
  needs_follow_up boolean not null,
  form_basis text not null,
  form_version_reference text not null,
  assessor_user_id uuid not null references auth.users(id) on delete restrict,
  assessor_display_name text not null,
  correction_reason text,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  signer_display_name text,
  signer_role_keys text[],
  signature_purpose text,
  signature_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint adaptation_assessment_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint adaptation_assessment_id_scope_key unique (
    id, organization_id, branch_id, client_id, assessment_key
  ),
  constraint adaptation_assessment_chain_key unique (
    organization_id, branch_id, assessment_key, version
  ),
  constraint adaptation_assessment_previous_key unique (previous_version_id),
  constraint adaptation_assessment_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id,
      assessment_key
    ) references public.adaptation_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint adaptation_assessment_version_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null)
    )
  ),
  constraint adaptation_assessment_state_check check (
    record_state in ('draft', 'signed', 'corrected')
  ),
  constraint adaptation_assessment_date_check check (
    extract(year from assessed_on) between 2000 and 2200
    and reassessment_due_on >= assessed_on
    and extract(year from reassessment_due_on) between 2000 and 2200
  ),
  constraint adaptation_assessment_manual_status_check check (
    adaptation_status in ('settled', 'adjusting', 'support_requested')
  ),
  constraint adaptation_assessment_summary_check check (
    char_length(assessment_summary) between 1 and 5000
    and assessment_summary = btrim(assessment_summary)
    and translate(assessment_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint adaptation_assessment_form_reference_check check (
    form_basis = 'manual_unstandardized'
    and form_version_reference = 'manual-adaptation-v1'
  ),
  constraint adaptation_assessment_assessor_check check (
    char_length(assessor_display_name) between 1 and 120
    and assessor_display_name = btrim(assessor_display_name)
    and assessor_display_name !~ '[[:cntrl:]]'
  ),
  constraint adaptation_assessment_signature_alignment_check check (
    (
      record_state = 'draft'
      and correction_reason is null
      and signed_at is null and signed_by is null
      and signer_display_name is null and signer_role_keys is null
      and signature_purpose is null
      and signature_reauth_challenge_id is null
    ) or (
      record_state in ('signed', 'corrected')
      and signed_at is not null and signed_by is not null
      and signer_display_name is not null
      and char_length(signer_display_name) between 1 and 120
      and signer_display_name = btrim(signer_display_name)
      and signer_display_name !~ '[[:cntrl:]]'
      and signer_role_keys is not null
      and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = case when record_state = 'signed'
        then '人工適應評估簽署' else '人工適應評估更正簽署' end
      and signature_reauth_challenge_id is not null
      and (
        (record_state = 'signed' and correction_reason is null)
        or (
          record_state = 'corrected'
          and correction_reason is not null
          and char_length(correction_reason) between 1 and 1000
          and correction_reason = btrim(correction_reason)
          and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
        )
      )
    )
  ),
  constraint adaptation_assessment_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.adaptation_assessment_versions is
  'Immutable manual, unstandardized page-32 assessment versions. No clinical score or diagnosis is computed.';
comment on column public.adaptation_assessment_versions.form_version_reference is
  'Explicit technical form reference; manual-adaptation-v1 is not an official or standardized scale.';

create table public.adaptation_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_key uuid not null,
  assessment_version_id uuid not null,
  sequence integer not null,
  previous_event_id uuid,
  follow_up_status text not null,
  due_on date,
  follow_up_plan text,
  follow_up_outcome text,
  transition_reason text,
  committed_by uuid not null references auth.users(id) on delete restrict,
  committer_display_name text not null,
  committed_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint adaptation_follow_up_assessment_scope_fkey
    foreign key (
      assessment_version_id, organization_id, branch_id, client_id,
      assessment_key
    ) references public.adaptation_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint adaptation_follow_up_id_scope_key unique (
    id, organization_id, branch_id, client_id, assessment_key
  ),
  constraint adaptation_follow_up_previous_key unique (previous_event_id),
  constraint adaptation_follow_up_previous_scope_fkey
    foreign key (
      previous_event_id, organization_id, branch_id, client_id, assessment_key
    ) references public.adaptation_follow_up_events (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint adaptation_follow_up_stream_key unique (
    organization_id, branch_id, assessment_key, sequence
  ),
  constraint adaptation_follow_up_sequence_check check (
    sequence > 0 and (
      (sequence = 1 and previous_event_id is null)
      or (sequence > 1 and previous_event_id is not null)
    )
  ),
  constraint adaptation_follow_up_status_check check (
    follow_up_status in ('pending', 'completed', 'cancelled')
  ),
  constraint adaptation_follow_up_alignment_check check (
    (
      follow_up_status = 'pending'
      and due_on is not null
      and extract(year from due_on) between 2000 and 2200
      and follow_up_plan is not null
      and char_length(follow_up_plan) between 1 and 2000
      and follow_up_plan = btrim(follow_up_plan)
      and translate(follow_up_plan, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and follow_up_outcome is null and transition_reason is null
    ) or (
      follow_up_status = 'completed'
      and due_on is null and follow_up_plan is null
      and follow_up_outcome is not null
      and char_length(follow_up_outcome) between 1 and 2000
      and follow_up_outcome = btrim(follow_up_outcome)
      and translate(follow_up_outcome, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and transition_reason is null
    ) or (
      follow_up_status = 'cancelled'
      and due_on is null and follow_up_plan is null
      and follow_up_outcome is null
      and transition_reason is not null
      and char_length(transition_reason) between 1 and 1000
      and transition_reason = btrim(transition_reason)
      and translate(transition_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    )
  ),
  constraint adaptation_follow_up_committer_check check (
    char_length(committer_display_name) between 1 and 120
    and committer_display_name = btrim(committer_display_name)
    and committer_display_name !~ '[[:cntrl:]]'
  ),
  constraint adaptation_follow_up_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.adaptation_assessment_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_assessment_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_state text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint adaptation_assessment_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint adaptation_assessment_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, client_id,
      result_assessment_key
    ) references public.adaptation_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint adaptation_assessment_operations_kind_check check (
    operation_kind in ('create_draft', 'revise_draft', 'sign', 'correct')
  ),
  constraint adaptation_assessment_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint adaptation_assessment_operations_version_check
    check (result_version > 0),
  constraint adaptation_assessment_operations_state_check
    check (result_state in ('draft', 'signed', 'corrected')),
  constraint adaptation_assessment_operations_reauth_check check (
    (operation_kind in ('create_draft', 'revise_draft') and reauth_challenge_id is null)
    or (operation_kind in ('sign', 'correct') and reauth_challenge_id is not null)
  )
);

create table private.adaptation_follow_up_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_assessment_key uuid not null,
  result_event_id uuid not null,
  result_sequence integer not null,
  result_status text not null,
  result_committed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint adaptation_follow_up_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint adaptation_follow_up_operations_result_scope_fkey
    foreign key (
      result_event_id, organization_id, branch_id, client_id,
      result_assessment_key
    ) references public.adaptation_follow_up_events (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint adaptation_follow_up_operations_kind_check check (
    operation_kind in ('track', 'complete_follow_up', 'cancel_follow_up')
  ),
  constraint adaptation_follow_up_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint adaptation_follow_up_operations_sequence_check
    check (result_sequence > 0),
  constraint adaptation_follow_up_operations_status_check
    check (result_status in ('pending', 'completed', 'cancelled'))
);

create index adaptation_assessments_scope_latest_idx
  on public.adaptation_assessment_versions (
    organization_id, branch_id, client_id, assessed_on desc,
    created_at desc, assessment_key, version desc
  );
create index adaptation_assessments_chain_idx
  on public.adaptation_assessment_versions (
    organization_id, branch_id, assessment_key, version desc
  );
create index adaptation_assessments_previous_idx
  on public.adaptation_assessment_versions (previous_version_id)
  where previous_version_id is not null;
create index adaptation_assessments_assessor_idx
  on public.adaptation_assessment_versions (assessor_user_id);
create index adaptation_assessments_signed_by_idx
  on public.adaptation_assessment_versions (signed_by)
  where signed_by is not null;
create index adaptation_assessments_reauth_idx
  on public.adaptation_assessment_versions (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index adaptation_follow_up_stream_idx
  on public.adaptation_follow_up_events (
    organization_id, branch_id, client_id, assessment_key, sequence desc
  );
create index adaptation_follow_up_assessment_version_idx
  on public.adaptation_follow_up_events (assessment_version_id);
create index adaptation_follow_up_previous_idx
  on public.adaptation_follow_up_events (previous_event_id)
  where previous_event_id is not null;
create index adaptation_follow_up_committed_by_idx
  on public.adaptation_follow_up_events (committed_by);
create index adaptation_assessment_operations_result_idx
  on private.adaptation_assessment_operations (
    organization_id, branch_id, client_id, result_assessment_key,
    result_version_id
  );
create index adaptation_assessment_operations_reauth_idx
  on private.adaptation_assessment_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index adaptation_follow_up_operations_result_idx
  on private.adaptation_follow_up_operations (
    organization_id, branch_id, client_id, result_assessment_key,
    result_event_id
  );

alter table public.adaptation_assessment_versions enable row level security;
alter table public.adaptation_assessment_versions force row level security;
alter table public.adaptation_follow_up_events enable row level security;
alter table public.adaptation_follow_up_events force row level security;
alter table private.adaptation_assessment_operations enable row level security;
alter table private.adaptation_assessment_operations force row level security;
alter table private.adaptation_follow_up_operations enable row level security;
alter table private.adaptation_follow_up_operations force row level security;

revoke all on table public.adaptation_assessment_versions
  from public, anon, authenticated, service_role;
revoke all on table public.adaptation_follow_up_events
  from public, anon, authenticated, service_role;
revoke all on table private.adaptation_assessment_operations
  from public, anon, authenticated, service_role;
revoke all on table private.adaptation_follow_up_operations
  from public, anon, authenticated, service_role;

create or replace function private.adaptation_history_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'adaptation assessment history is append-only';
end;
$$;

create trigger adaptation_assessment_versions_append_only
before update or delete on public.adaptation_assessment_versions
for each row execute function private.adaptation_history_is_append_only();
create trigger adaptation_follow_up_events_append_only
before update or delete on public.adaptation_follow_up_events
for each row execute function private.adaptation_history_is_append_only();
create trigger adaptation_assessment_operations_append_only
before update or delete on private.adaptation_assessment_operations
for each row execute function private.adaptation_history_is_append_only();
create trigger adaptation_follow_up_operations_append_only
before update or delete on private.adaptation_follow_up_operations
for each row execute function private.adaptation_history_is_append_only();

create trigger adaptation_assessment_versions_audit_row_change
after insert on public.adaptation_assessment_versions
for each row execute function private.audit_row_change();
create trigger adaptation_follow_up_events_audit_row_change
after insert on public.adaptation_follow_up_events
for each row execute function private.audit_row_change();
create trigger adaptation_assessment_operations_audit_row_change
after insert on private.adaptation_assessment_operations
for each row execute function private.audit_row_change();
create trigger adaptation_follow_up_operations_audit_row_change
after insert on private.adaptation_follow_up_operations
for each row execute function private.audit_row_change();

create or replace function private.adaptation_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.adaptation_client_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.adaptation_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission
    )
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
    )
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.require_adaptation_reauth_evidence(
  p_actor uuid,
  p_reference_time timestamptz
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
  if p_actor is null or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for adaptation signing';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for adaptation signing';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor
    and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1 for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for adaptation signing';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_adaptation_assessment_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_adaptation_status text,
  p_assessment_summary text,
  p_reassessment_due_on date,
  p_needs_follow_up boolean,
  p_form_version_reference text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  assessment_key uuid,
  version_id uuid,
  assessment_version integer,
  record_state text,
  assessed_on date,
  adaptation_status text,
  reassessment_due_on date,
  needs_follow_up boolean,
  form_version_reference text,
  committed_at timestamptz,
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
  v_request_hash text;
  v_operation private.adaptation_assessment_operations%rowtype;
  v_previous public.adaptation_assessment_versions%rowtype;
  v_result public.adaptation_assessment_versions%rowtype;
  v_assessment_key uuid;
  v_version integer;
  v_state text;
  v_assessor_user_id uuid;
  v_assessor_display_name text;
  v_signer_display_name text;
  v_signer_role_keys text[];
  v_challenge_id uuid;
  v_assessed_on date;
  v_adaptation_status text;
  v_assessment_summary text;
  v_reassessment_due_on date;
  v_needs_follow_up boolean;
  v_form_reference text;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_content_hash text;
begin
  if p_action not in ('create_draft', 'revise_draft', 'sign', 'correct')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_idempotency_key is null
     or not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'social_work_records.sign' else 'social_work_records.manage' end
     )
     or not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501',
      message = 'adaptation assessment operation is not permitted';
  end if;

  if p_action = 'create_draft' then
    if p_assessment_key is not null or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = '22023',
        message = 'new adaptation assessment chain input is invalid';
    end if;
  elsif p_assessment_key is null or p_previous_version_id is null
        or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023',
      message = 'adaptation assessment chain input is invalid';
  end if;

  if p_action in ('create_draft', 'revise_draft', 'correct') then
    if p_assessed_on is null
       or extract(year from p_assessed_on) not between 2000 and 2200
       or p_adaptation_status not in ('settled', 'adjusting', 'support_requested')
       or p_assessment_summary is null
       or char_length(btrim(p_assessment_summary)) not between 1 and 5000
       or translate(btrim(p_assessment_summary), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_reassessment_due_on is null
       or extract(year from p_reassessment_due_on) not between 2000 and 2200
       or p_reassessment_due_on < p_assessed_on
       or p_needs_follow_up is null
       or p_form_version_reference <> 'manual-adaptation-v1'
       or (p_action = 'correct' and (
         v_reason is null or char_length(v_reason) > 1000
         or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       ))
       or (p_action <> 'correct' and v_reason is not null) then
      raise exception using errcode = '22023',
        message = 'manual adaptation assessment content is invalid';
    end if;
  elsif p_assessed_on is not null or p_adaptation_status is not null
        or p_assessment_summary is not null or p_reassessment_due_on is not null
        or p_needs_follow_up is not null or p_form_version_reference is not null
        or v_reason is not null then
    raise exception using errcode = '22023',
      message = 'adaptation signing must use the exact current draft';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', p_assessment_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version, 'assessed_on', p_assessed_on,
    'adaptation_status', p_adaptation_status,
    'assessment_summary', case when p_assessment_summary is null
      then null else btrim(p_assessment_summary) end,
    'reassessment_due_on', p_reassessment_due_on,
    'needs_follow_up', p_needs_follow_up,
    'form_version_reference', p_form_version_reference,
    'correction_reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'adaptation-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.adaptation_assessment_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'adaptation assessment idempotency conflict';
    end if;
    if not private.adaptation_client_authority(
      p_expected_organization_id, p_expected_branch_id,
      v_operation.client_id,
      case when p_action in ('sign', 'correct')
        then 'social_work_records.sign' else 'social_work_records.manage' end
    ) then
      raise exception using errcode = '42501',
        message = 'adaptation assessment replay is not permitted';
    end if;
    select version_row.* into strict v_result
    from public.adaptation_assessment_versions version_row
    where version_row.id = v_operation.result_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_operation.result_assessment_key;
    return query select v_operation.id, v_result.client_id,
      v_result.assessment_key, v_result.id, v_result.version,
      v_result.record_state, v_result.assessed_on,
      v_result.adaptation_status, v_result.reassessment_due_on,
      v_result.needs_follow_up, v_result.form_version_reference,
      v_operation.result_committed_at, true;
    return;
  end if;

  v_assessment_key := coalesce(p_assessment_key, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'adaptation-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || v_assessment_key::text, 0
  ));
  if p_action <> 'create_draft' then
    select version_row.* into v_previous
    from public.adaptation_assessment_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_assessment_key
      and not exists (
        select 1 from public.adaptation_assessment_versions child
        where child.previous_version_id = version_row.id
      )
    order by version_row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> p_previous_version_id
       or v_previous.version <> p_expected_version then
      raise exception using errcode = '40001',
        message = 'adaptation assessment version is stale';
    end if;
  end if;

  if p_action = 'create_draft' then
    v_version := 1; v_state := 'draft';
    v_assessor_user_id := v_actor;
    select profile.display_name into v_assessor_display_name
    from public.profiles profile where profile.id = v_actor and profile.is_active;
    v_assessed_on := p_assessed_on;
    v_adaptation_status := p_adaptation_status;
    v_assessment_summary := btrim(p_assessment_summary);
    v_reassessment_due_on := p_reassessment_due_on;
    v_needs_follow_up := p_needs_follow_up;
    v_form_reference := p_form_version_reference;
  elsif p_action = 'revise_draft' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514',
        message = 'signed adaptation assessment requires a correction';
    end if;
    v_version := v_previous.version + 1; v_state := 'draft';
    v_assessor_user_id := v_previous.assessor_user_id;
    v_assessor_display_name := v_previous.assessor_display_name;
    v_assessed_on := p_assessed_on;
    v_adaptation_status := p_adaptation_status;
    v_assessment_summary := btrim(p_assessment_summary);
    v_reassessment_due_on := p_reassessment_due_on;
    v_needs_follow_up := p_needs_follow_up;
    v_form_reference := p_form_version_reference;
  elsif p_action = 'sign' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514',
        message = 'only the current adaptation draft can be signed';
    end if;
    v_version := v_previous.version + 1; v_state := 'signed';
    v_assessor_user_id := v_previous.assessor_user_id;
    v_assessor_display_name := v_previous.assessor_display_name;
    v_assessed_on := v_previous.assessed_on;
    v_adaptation_status := v_previous.adaptation_status;
    v_assessment_summary := v_previous.assessment_summary;
    v_reassessment_due_on := v_previous.reassessment_due_on;
    v_needs_follow_up := v_previous.needs_follow_up;
    v_form_reference := v_previous.form_version_reference;
  else
    if v_previous.record_state not in ('signed', 'corrected') then
      raise exception using errcode = '23514',
        message = 'only signed adaptation content can be corrected';
    end if;
    v_version := v_previous.version + 1; v_state := 'corrected';
    v_assessor_user_id := v_previous.assessor_user_id;
    v_assessor_display_name := v_previous.assessor_display_name;
    v_assessed_on := p_assessed_on;
    v_adaptation_status := p_adaptation_status;
    v_assessment_summary := btrim(p_assessment_summary);
    v_reassessment_due_on := p_reassessment_due_on;
    v_needs_follow_up := p_needs_follow_up;
    v_form_reference := p_form_version_reference;
  end if;

  v_now := clock_timestamp();
  if v_assessed_on > (v_now at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023',
      message = 'future adaptation assessment date is invalid';
  end if;
  if v_assessor_display_name is null then
    raise exception using errcode = '42501',
      message = 'adaptation assessor identity is invalid';
  end if;
  if p_action in ('sign', 'correct') then
    v_challenge_id := private.require_adaptation_reauth_evidence(v_actor, v_now);
    select profile.display_name into v_signer_display_name
    from public.profiles profile where profile.id = v_actor and profile.is_active;
    select coalesce(array_agg(distinct role.role_key order by role.role_key), '{}'::text[])
      into v_signer_role_keys
    from public.memberships membership
    join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    where membership.profile_id = v_actor
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and (role.organization_id is null or role.organization_id = p_expected_organization_id);
    if v_signer_display_name is null or cardinality(v_signer_role_keys) = 0 then
      raise exception using errcode = '42501',
        message = 'adaptation signer identity could not be verified';
    end if;
  end if;

  if not private.adaptation_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    case when p_action in ('sign', 'correct')
      then 'social_work_records.sign' else 'social_work_records.manage' end
  ) then
    raise exception using errcode = '42501',
      message = 'adaptation assessment authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', v_assessment_key, 'version', v_version,
    'previous_version_id', p_previous_version_id, 'record_state', v_state,
    'assessed_on', v_assessed_on, 'adaptation_status', v_adaptation_status,
    'assessment_summary', v_assessment_summary,
    'reassessment_due_on', v_reassessment_due_on,
    'needs_follow_up', v_needs_follow_up,
    'form_basis', 'manual_unstandardized',
    'form_version_reference', v_form_reference,
    'assessor_user_id', v_assessor_user_id, 'correction_reason', v_reason,
    'signed_by', case when v_state = 'draft' then null else v_actor end,
    'signed_at', case when v_state = 'draft' then null else v_now end
  )::text, 'UTF8')), 'hex');

  insert into public.adaptation_assessment_versions (
    organization_id, branch_id, client_id, assessment_key, version,
    previous_version_id, record_state, assessed_on, adaptation_status,
    assessment_summary, reassessment_due_on, needs_follow_up, form_basis,
    form_version_reference, assessor_user_id, assessor_display_name,
    correction_reason, signed_at, signed_by, signer_display_name,
    signer_role_keys, signature_purpose, signature_reauth_challenge_id,
    content_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_assessment_key, v_version, p_previous_version_id, v_state,
    v_assessed_on, v_adaptation_status, v_assessment_summary,
    v_reassessment_due_on, v_needs_follow_up, 'manual_unstandardized',
    v_form_reference, v_assessor_user_id, v_assessor_display_name,
    case when v_state = 'corrected' then v_reason else null end,
    case when v_state = 'draft' then null else v_now end,
    case when v_state = 'draft' then null else v_actor end,
    case when v_state = 'draft' then null else v_signer_display_name end,
    case when v_state = 'draft' then null else v_signer_role_keys end,
    case when v_state = 'signed' then '人工適應評估簽署'
      when v_state = 'corrected' then '人工適應評估更正簽署' else null end,
    v_challenge_id, v_content_hash, v_now
  ) returning * into v_result;

  insert into private.adaptation_assessment_operations (
    organization_id, branch_id, client_id, actor_user_id, operation_kind,
    idempotency_key, request_hash, result_assessment_key, result_version_id,
    result_version, result_state, result_committed_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_action, p_idempotency_key, v_request_hash, v_result.assessment_key,
    v_result.id, v_result.version, v_result.record_state,
    v_result.created_at, v_challenge_id
  ) returning id into v_operation.id;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when p_action = 'sign' then 'sign'
      when p_action = 'correct' then 'correct' else 'insert' end,
    'adaptation_assessment_versions', v_result.id::text, p_idempotency_key,
    array['record_state', 'version', 'assessed_on', 'adaptation_status',
      'assessment_summary', 'reassessment_due_on', 'needs_follow_up',
      'form_version_reference'],
    jsonb_build_object(
      'workflow', 'page32_manual_adaptation_v1',
      'assessment_key', v_result.assessment_key,
      'version', v_result.version, 'state', v_result.record_state,
      'client_id', p_client_id, 'manual_unstandardized', true,
      'contains_narrative', true, 'narrative_logged', false,
      'score_computed', false, 'diagnosis_computed', false
    )
  );

  if not private.adaptation_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    case when p_action in ('sign', 'correct')
      then 'social_work_records.sign' else 'social_work_records.manage' end
  ) or not exists (
    select 1 from public.adaptation_assessment_versions version_row
    where version_row.id = v_result.id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_assessment_key
      and version_row.version = v_version
      and not exists (
        select 1 from public.adaptation_assessment_versions child
        where child.previous_version_id = version_row.id
      )
  ) then
    raise exception using errcode = '42501',
      message = 'adaptation assessment final verification failed';
  end if;

  return query select v_operation.id, v_result.client_id,
    v_result.assessment_key, v_result.id, v_result.version,
    v_result.record_state, v_result.assessed_on,
    v_result.adaptation_status, v_result.reassessment_due_on,
    v_result.needs_follow_up, v_result.form_version_reference,
    v_result.created_at, false;
end;
$$;

create or replace function public.create_adaptation_assessment_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessed_on date,
  p_adaptation_status text,
  p_assessment_summary text,
  p_reassessment_due_on date,
  p_needs_follow_up boolean,
  p_form_version_reference text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  adaptation_status text, reassessment_due_on date, needs_follow_up boolean,
  form_version_reference text, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_adaptation_assessment_guarded(
    'create_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, null, null, 0, p_assessed_on, p_adaptation_status,
    p_assessment_summary, p_reassessment_due_on, p_needs_follow_up,
    p_form_version_reference, null, p_idempotency_key
  );
$$;

create or replace function public.revise_adaptation_assessment_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_adaptation_status text,
  p_assessment_summary text,
  p_reassessment_due_on date,
  p_needs_follow_up boolean,
  p_form_version_reference text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  adaptation_status text, reassessment_due_on date, needs_follow_up boolean,
  form_version_reference text, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_adaptation_assessment_guarded(
    'revise_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_assessment_key, p_previous_version_id, p_expected_version,
    p_assessed_on, p_adaptation_status, p_assessment_summary,
    p_reassessment_due_on, p_needs_follow_up, p_form_version_reference,
    null, p_idempotency_key
  );
$$;

create or replace function public.sign_adaptation_assessment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  adaptation_status text, reassessment_due_on date, needs_follow_up boolean,
  form_version_reference text, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_adaptation_assessment_guarded(
    'sign', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_previous_version_id, p_expected_version,
    null, null, null, null, null, null, null, p_idempotency_key
  );
$$;

create or replace function public.correct_adaptation_assessment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_adaptation_status text,
  p_assessment_summary text,
  p_reassessment_due_on date,
  p_needs_follow_up boolean,
  p_form_version_reference text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  adaptation_status text, reassessment_due_on date, needs_follow_up boolean,
  form_version_reference text, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_adaptation_assessment_guarded(
    'correct', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_previous_version_id, p_expected_version,
    p_assessed_on, p_adaptation_status, p_assessment_summary,
    p_reassessment_due_on, p_needs_follow_up, p_form_version_reference,
    p_correction_reason, p_idempotency_key
  );
$$;

create or replace function private.mutate_adaptation_follow_up_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_assessment_version_id uuid,
  p_expected_sequence integer,
  p_due_on date,
  p_follow_up_plan text,
  p_follow_up_outcome text,
  p_transition_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  assessment_key uuid,
  follow_up_event_id uuid,
  follow_up_sequence integer,
  follow_up_status text,
  due_on date,
  committed_at timestamptz,
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
  v_request_hash text;
  v_operation private.adaptation_follow_up_operations%rowtype;
  v_assessment public.adaptation_assessment_versions%rowtype;
  v_previous public.adaptation_follow_up_events%rowtype;
  v_result public.adaptation_follow_up_events%rowtype;
  v_status text;
  v_committer_display_name text;
  v_plan text := nullif(btrim(p_follow_up_plan), '');
  v_outcome text := nullif(btrim(p_follow_up_outcome), '');
  v_reason text := nullif(btrim(p_transition_reason), '');
  v_content_hash text;
begin
  if p_action not in ('track', 'complete_follow_up', 'cancel_follow_up')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_assessment_key is null
     or p_assessment_version_id is null or p_idempotency_key is null
     or p_expected_sequence is null or p_expected_sequence < 0
     or not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.manage'
     )
     or not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501',
      message = 'adaptation follow-up operation is not permitted';
  end if;

  if (
      p_action = 'track' and (
        p_due_on is null or extract(year from p_due_on) not between 2000 and 2200
        or v_plan is null or char_length(v_plan) > 2000
        or translate(v_plan, E'\n\r\t', '') ~ '[[:cntrl:]]'
        or v_outcome is not null or v_reason is not null
      )
    ) or (
      p_action = 'complete_follow_up' and (
        p_due_on is not null or v_plan is not null or v_outcome is null
        or char_length(v_outcome) > 2000
        or translate(v_outcome, E'\n\r\t', '') ~ '[[:cntrl:]]'
        or v_reason is not null
      )
    ) or (
      p_action = 'cancel_follow_up' and (
        p_due_on is not null or v_plan is not null or v_outcome is not null
        or v_reason is null or char_length(v_reason) > 1000
        or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
      )
    ) then
    raise exception using errcode = '22023',
      message = 'adaptation follow-up content is invalid';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', p_assessment_key,
    'assessment_version_id', p_assessment_version_id,
    'expected_sequence', p_expected_sequence, 'due_on', p_due_on,
    'follow_up_plan', v_plan, 'follow_up_outcome', v_outcome,
    'transition_reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'adaptation-follow-up-operation:' || v_actor::text || ':' ||
    p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.adaptation_follow_up_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'adaptation follow-up idempotency conflict';
    end if;
    if not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id,
       v_operation.client_id, 'social_work_records.manage'
     ) then
      raise exception using errcode = '42501',
        message = 'adaptation follow-up replay is not permitted';
    end if;
    select event.* into strict v_result
    from public.adaptation_follow_up_events event
    where event.id = v_operation.result_event_id
      and event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.client_id = p_client_id
      and event.assessment_key = p_assessment_key;
    return query select v_operation.id, v_result.client_id,
      v_result.assessment_key, v_result.id, v_result.sequence,
      v_result.follow_up_status, v_result.due_on,
      v_operation.result_committed_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'adaptation-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_assessment_key::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'adaptation-follow-up-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_assessment_key::text, 0
  ));

  select version_row.* into v_assessment
  from public.adaptation_assessment_versions version_row
  where version_row.id = p_assessment_version_id
    and version_row.organization_id = p_expected_organization_id
    and version_row.branch_id = p_expected_branch_id
    and version_row.client_id = p_client_id
    and version_row.assessment_key = p_assessment_key
    and version_row.record_state in ('signed', 'corrected')
    and not exists (
      select 1 from public.adaptation_assessment_versions child
      where child.previous_version_id = version_row.id
    )
  for share;
  if v_assessment.id is null then
    raise exception using errcode = '40001',
      message = 'signed adaptation assessment version is stale';
  end if;
  if p_action = 'track' and not v_assessment.needs_follow_up then
    raise exception using errcode = '23514',
      message = 'assessment is not marked for follow-up';
  end if;

  select event.* into v_previous
  from public.adaptation_follow_up_events event
  where event.organization_id = p_expected_organization_id
    and event.branch_id = p_expected_branch_id
    and event.client_id = p_client_id
    and event.assessment_key = p_assessment_key
  order by event.sequence desc
  limit 1
  for share;
  if coalesce(v_previous.sequence, 0) <> p_expected_sequence then
    raise exception using errcode = '40001',
      message = 'adaptation follow-up version is stale';
  end if;
  if p_action = 'track' and v_previous.follow_up_status = 'pending' then
    raise exception using errcode = '23514',
      message = 'an open adaptation follow-up already exists';
  end if;
  if p_action in ('complete_follow_up', 'cancel_follow_up')
     and coalesce(v_previous.follow_up_status, '') <> 'pending' then
    raise exception using errcode = '23514',
      message = 'no open adaptation follow-up exists';
  end if;

  select profile.display_name into v_committer_display_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_committer_display_name is null then
    raise exception using errcode = '42501',
      message = 'adaptation follow-up committer identity is invalid';
  end if;
  if not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.manage'
     ) then
    raise exception using errcode = '42501',
      message = 'adaptation follow-up authority expired';
  end if;

  v_now := clock_timestamp();
  v_status := case p_action when 'track' then 'pending'
    when 'complete_follow_up' then 'completed' else 'cancelled' end;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', p_assessment_key,
    'assessment_version_id', p_assessment_version_id,
    'sequence', p_expected_sequence + 1,
    'previous_event_id', v_previous.id,
    'follow_up_status', v_status, 'due_on', p_due_on,
    'follow_up_plan', v_plan, 'follow_up_outcome', v_outcome,
    'transition_reason', v_reason, 'committed_by', v_actor,
    'committed_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.adaptation_follow_up_events (
    organization_id, branch_id, client_id, assessment_key,
    assessment_version_id, sequence, previous_event_id, follow_up_status,
    due_on, follow_up_plan, follow_up_outcome, transition_reason,
    committed_by, committer_display_name, committed_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_assessment_version_id, p_expected_sequence + 1,
    v_previous.id, v_status,
    case when v_status = 'pending' then p_due_on else null end,
    case when v_status = 'pending' then v_plan else null end,
    case when v_status = 'completed' then v_outcome else null end,
    case when v_status = 'cancelled' then v_reason else null end,
    v_actor, v_committer_display_name, v_now, v_content_hash
  ) returning * into v_result;

  insert into private.adaptation_follow_up_operations (
    organization_id, branch_id, client_id, actor_user_id, operation_kind,
    idempotency_key, request_hash, result_assessment_key, result_event_id,
    result_sequence, result_status, result_committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_action, p_idempotency_key, v_request_hash, p_assessment_key,
    v_result.id, v_result.sequence, v_result.follow_up_status,
    v_result.committed_at
  ) returning id into v_operation.id;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'insert',
    'adaptation_follow_up_events', v_result.id::text, p_idempotency_key,
    array['follow_up_status', 'due_on', 'follow_up_plan',
      'follow_up_outcome', 'transition_reason'],
    jsonb_build_object(
      'workflow', 'page32_manual_adaptation_follow_up_v1',
      'assessment_key', p_assessment_key, 'sequence', v_result.sequence,
      'status', v_result.follow_up_status, 'client_id', p_client_id,
      'contains_narrative', true, 'narrative_logged', false,
      'notification_sent', false
    )
  );

  if not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.manage'
     ) or not exists (
       select 1 from public.adaptation_follow_up_events event
       where event.id = v_result.id
         and event.organization_id = p_expected_organization_id
         and event.branch_id = p_expected_branch_id
         and event.client_id = p_client_id
         and event.assessment_key = p_assessment_key
         and event.sequence = v_result.sequence
         and not exists (
           select 1 from public.adaptation_follow_up_events child
           where child.previous_event_id = event.id
         )
     ) then
    raise exception using errcode = '42501',
      message = 'adaptation follow-up final verification failed';
  end if;

  return query select v_operation.id, v_result.client_id,
    v_result.assessment_key, v_result.id, v_result.sequence,
    v_result.follow_up_status, v_result.due_on,
    v_result.committed_at, false;
end;
$$;

create or replace function public.mutate_adaptation_follow_up(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_assessment_version_id uuid,
  p_expected_sequence integer,
  p_due_on date,
  p_follow_up_plan text,
  p_follow_up_outcome text,
  p_transition_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid,
  follow_up_event_id uuid, follow_up_sequence integer,
  follow_up_status text, due_on date, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_adaptation_follow_up_guarded(
    p_action, p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_assessment_version_id, p_expected_sequence, p_due_on,
    p_follow_up_plan, p_follow_up_outcome, p_transition_reason,
    p_idempotency_key
  );
$$;

create or replace function private.adaptation_assessment_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_service_status text,
  p_assessment_presence text,
  p_reassessment_status text,
  p_adaptation_status text,
  p_follow_up_filter text,
  p_reference_time timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with terminal_visible as materialized (
    select version_row.*
    from public.adaptation_assessment_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and private.can_staff_access_client(version_row.client_id, 'clients.read')
      and private.can_staff_access_client(
        version_row.client_id, 'social_work_records.read'
      )
      and not exists (
        select 1 from public.adaptation_assessment_versions child
        where child.previous_version_id = version_row.id
      )
  ), latest_assessment as materialized (
    select distinct on (version_row.client_id) version_row.*
    from terminal_visible version_row
    order by version_row.client_id, version_row.assessed_on desc,
      version_row.created_at desc, version_row.assessment_key,
      version_row.version desc
  ), latest_follow_up as materialized (
    select distinct on (event.assessment_key) event.*
    from public.adaptation_follow_up_events event
    join latest_assessment assessment
      on assessment.assessment_key = event.assessment_key
     and assessment.client_id = event.client_id
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    order by event.assessment_key, event.sequence desc
  ), client_rows as materialized (
    select client.id as client_id,
      client.display_name as client_display_name,
      client.status::text as service_status,
      client.admitted_on,
      client.ended_on,
      assessment.id as version_id,
      assessment.assessment_key,
      assessment.version as assessment_version,
      assessment.record_state,
      assessment.assessed_on,
      assessment.adaptation_status,
      assessment.assessment_summary,
      assessment.reassessment_due_on,
      assessment.needs_follow_up,
      assessment.form_basis,
      assessment.form_version_reference,
      assessment.assessor_user_id,
      assessment.assessor_display_name,
      assessment.correction_reason,
      assessment.signed_at,
      assessment.signer_display_name,
      assessment.created_at,
      follow_up.id as follow_up_event_id,
      coalesce(follow_up.sequence, 0) as follow_up_sequence,
      follow_up.follow_up_status,
      follow_up.due_on as follow_up_due_on,
      follow_up.follow_up_plan,
      follow_up.follow_up_outcome,
      follow_up.transition_reason as follow_up_transition_reason,
      follow_up.committer_display_name as follow_up_committer_display_name,
      follow_up.committed_at as follow_up_committed_at,
      coalesce(
        assessment.reassessment_due_on <=
          (p_reference_time at time zone 'Asia/Taipei')::date,
        false
      ) as reassessment_due,
      coalesce(
        follow_up.follow_up_status = 'pending'
          and follow_up.due_on <
            (p_reference_time at time zone 'Asia/Taipei')::date,
        false
      ) as follow_up_overdue,
      case
        when assessment.id is null then 'not_assessed'
        when not assessment.needs_follow_up then 'not_required'
        when follow_up.follow_up_status is null then 'not_started'
        else follow_up.follow_up_status
      end as current_follow_up_status
    from public.clients client
    left join latest_assessment assessment on assessment.client_id = client.id
    left join latest_follow_up follow_up
      on follow_up.assessment_key = assessment.assessment_key
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'social_work_records.read')
  ), matching as materialized (
    select client_row.*
    from client_rows client_row
    where (p_client_id is null or client_row.client_id = p_client_id)
      and (p_service_status is null
        or client_row.service_status = p_service_status)
      and (
        p_assessment_presence = 'all'
        or (p_assessment_presence = 'assessed'
          and client_row.version_id is not null)
        or (p_assessment_presence = 'not_assessed'
          and client_row.version_id is null)
      )
      and (
        p_reassessment_status = 'all'
        or (p_reassessment_status = 'due' and client_row.reassessment_due)
        or (p_reassessment_status = 'upcoming'
          and client_row.version_id is not null
          and not client_row.reassessment_due)
      )
      and (p_adaptation_status is null
        or client_row.adaptation_status = p_adaptation_status)
      and (
        p_follow_up_filter = 'all'
        or (p_follow_up_filter = 'needs_follow_up'
          and coalesce(client_row.needs_follow_up, false))
        or (p_follow_up_filter = 'no_follow_up'
          and client_row.version_id is not null
          and not coalesce(client_row.needs_follow_up, false))
        or (p_follow_up_filter = 'open'
          and client_row.follow_up_status = 'pending')
        or (p_follow_up_filter = 'overdue'
          and client_row.follow_up_overdue)
      )
  ), limited as materialized (
    select * from matching
    order by client_display_name collate "C", client_id
    limit 200
  ), items_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', item.client_id,
      'client_display_name', item.client_display_name,
      'service_status', item.service_status,
      'admitted_on', item.admitted_on,
      'ended_on', item.ended_on,
      'version_id', item.version_id,
      'assessment_key', item.assessment_key,
      'assessment_version', item.assessment_version,
      'record_state', item.record_state,
      'assessed_on', item.assessed_on,
      'adaptation_status', item.adaptation_status,
      'assessment_summary', item.assessment_summary,
      'reassessment_due_on', item.reassessment_due_on,
      'reassessment_due', item.reassessment_due,
      'needs_follow_up', coalesce(item.needs_follow_up, false),
      'current_follow_up_status', item.current_follow_up_status,
      'form_basis', item.form_basis,
      'form_version_reference', item.form_version_reference,
      'assessor_user_id', item.assessor_user_id,
      'assessor_display_name', item.assessor_display_name,
      'correction_reason', item.correction_reason,
      'signed_at', item.signed_at,
      'signer_display_name', item.signer_display_name,
      'created_at', item.created_at,
      'follow_up_event_id', item.follow_up_event_id,
      'follow_up_sequence', item.follow_up_sequence,
      'follow_up_status', item.follow_up_status,
      'follow_up_due_on', item.follow_up_due_on,
      'follow_up_plan', item.follow_up_plan,
      'follow_up_outcome', item.follow_up_outcome,
      'follow_up_transition_reason', item.follow_up_transition_reason,
      'follow_up_committer_display_name',
        item.follow_up_committer_display_name,
      'follow_up_committed_at', item.follow_up_committed_at,
      'follow_up_overdue', item.follow_up_overdue,
      'version_history', case when item.assessment_key is null
        then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'version_id', history.id,
            'assessment_version', history.version,
            'record_state', history.record_state,
            'assessed_on', history.assessed_on,
            'adaptation_status', history.adaptation_status,
            'assessment_summary', history.assessment_summary,
            'reassessment_due_on', history.reassessment_due_on,
            'needs_follow_up', history.needs_follow_up,
            'form_basis', history.form_basis,
            'form_version_reference', history.form_version_reference,
            'correction_reason', history.correction_reason,
            'assessor_display_name', history.assessor_display_name,
            'signed_at', history.signed_at,
            'signer_display_name', history.signer_display_name,
            'created_at', history.created_at
          ) order by history.version)
          from (
            select history.*
            from public.adaptation_assessment_versions history
            where history.organization_id = p_expected_organization_id
              and history.branch_id = p_expected_branch_id
              and history.client_id = item.client_id
              and history.assessment_key = item.assessment_key
            order by history.version
            limit 50
          ) history
        ), '[]'::jsonb) end,
      'version_history_total', case when item.assessment_key is null then 0
        else (
          select count(*)
          from public.adaptation_assessment_versions history
          where history.organization_id = p_expected_organization_id
            and history.branch_id = p_expected_branch_id
            and history.client_id = item.client_id
            and history.assessment_key = item.assessment_key
        ) end,
      'follow_up_history', case when item.assessment_key is null
        then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'event_id', history.id,
            'sequence', history.sequence,
            'follow_up_status', history.follow_up_status,
            'due_on', history.due_on,
            'follow_up_plan', history.follow_up_plan,
            'follow_up_outcome', history.follow_up_outcome,
            'transition_reason', history.transition_reason,
            'committer_display_name', history.committer_display_name,
            'committed_at', history.committed_at
          ) order by history.sequence)
          from (
            select history.*
            from public.adaptation_follow_up_events history
            where history.organization_id = p_expected_organization_id
              and history.branch_id = p_expected_branch_id
              and history.client_id = item.client_id
              and history.assessment_key = item.assessment_key
            order by history.sequence
            limit 50
          ) history
        ), '[]'::jsonb) end,
      'follow_up_history_total', case when item.assessment_key is null then 0
        else (
          select count(*)
          from public.adaptation_follow_up_events history
          where history.organization_id = p_expected_organization_id
            and history.branch_id = p_expected_branch_id
            and history.client_id = item.client_id
            and history.assessment_key = item.assessment_key
        ) end
    ) order by item.client_display_name collate "C", item.client_id),
      '[]'::jsonb) as items
    from limited item
  ), stats as (
    select count(*)::bigint as matching_total,
      count(*) filter (where version_id is not null)::bigint as assessed_total,
      count(*) filter (where version_id is null)::bigint as not_assessed_total,
      count(*) filter (where reassessment_due)::bigint as reassessment_due_total,
      count(*) filter (
        where coalesce(needs_follow_up, false)
      )::bigint as needs_follow_up_total,
      count(*) filter (where follow_up_status = 'pending')::bigint
        as open_follow_up_total,
      count(*) filter (where follow_up_overdue)::bigint
        as overdue_follow_up_total,
      count(*) filter (where record_state = 'draft')::bigint as draft_total,
      count(*) filter (
        where record_state in ('signed', 'corrected')
      )::bigint as completed_total
    from matching
  ), client_ranked as (
    select client_row.*, row_number() over (
      order by client_row.client_display_name collate "C", client_row.client_id
    ) as ordinal
    from client_rows client_row
  ), client_result as (
    select count(*)::bigint as client_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'client_id', ranked.client_id,
        'display_name', ranked.client_display_name,
        'service_status', ranked.service_status,
        'admitted_on', ranked.admitted_on,
        'ended_on', ranked.ended_on
      ) order by ranked.client_display_name collate "C", ranked.client_id)
      filter (where ranked.ordinal <= 200), '[]'::jsonb) as client_options
    from client_ranked ranked
  ), assessor_candidates as materialized (
    select distinct assessor_user_id, assessor_display_name
    from terminal_visible
  ), assessor_ranked as (
    select candidate.*, row_number() over (
      order by candidate.assessor_display_name collate "C",
        candidate.assessor_user_id
    ) as ordinal
    from assessor_candidates candidate
  ), assessor_result as (
    select count(*)::bigint as assessor_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'user_id', ranked.assessor_user_id,
        'display_name', ranked.assessor_display_name
      ) order by ranked.assessor_display_name collate "C",
        ranked.assessor_user_id) filter (where ranked.ordinal <= 200),
        '[]'::jsonb) as assessor_options
    from assessor_ranked ranked
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'items', items_result.items,
    'item_total', jsonb_array_length(items_result.items),
    'matching_total', stats.matching_total,
    'items_truncated',
      stats.matching_total > jsonb_array_length(items_result.items),
    'assessed_total', stats.assessed_total,
    'not_assessed_total', stats.not_assessed_total,
    'reassessment_due_total', stats.reassessment_due_total,
    'needs_follow_up_total', stats.needs_follow_up_total,
    'open_follow_up_total', stats.open_follow_up_total,
    'overdue_follow_up_total', stats.overdue_follow_up_total,
    'draft_total', stats.draft_total,
    'completed_total', stats.completed_total,
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated', client_result.client_total >
      jsonb_array_length(client_result.client_options),
    'assessor_options', assessor_result.assessor_options,
    'assessor_total', assessor_result.assessor_total,
    'assessor_options_truncated', assessor_result.assessor_total >
      jsonb_array_length(assessor_result.assessor_options),
    'assessment_method_status', 'manual_unstandardized_only',
    'form_publication_status', 'not_published_not_claimed',
    'offline_sync_status', 'not_configured',
    'follow_up_notification_status', 'none_not_sent'
  )
  from items_result cross join stats cross join client_result
  cross join assessor_result;
$$;

create or replace function private.adaptation_assessment_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_service_status text,
  p_assessment_presence text,
  p_reassessment_status text,
  p_adaptation_status text,
  p_follow_up_filter text
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total integer,
  matching_total bigint,
  items_truncated boolean,
  assessed_total bigint,
  not_assessed_total bigint,
  reassessment_due_total bigint,
  needs_follow_up_total bigint,
  open_follow_up_total bigint,
  overdue_follow_up_total bigint,
  draft_total bigint,
  completed_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  assessor_options jsonb,
  assessor_total bigint,
  assessor_options_truncated boolean,
  assessment_method_status text,
  form_publication_status text,
  offline_sync_status text,
  follow_up_notification_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_service_status text := nullif(btrim(p_service_status), '');
  v_presence text := lower(coalesce(nullif(btrim(p_assessment_presence), ''), 'all'));
  v_reassessment text := lower(coalesce(nullif(btrim(p_reassessment_status), ''), 'all'));
  v_adaptation text := nullif(btrim(p_adaptation_status), '');
  v_follow_up text := lower(coalesce(nullif(btrim(p_follow_up_filter), ''), 'all'));
  v_bundle jsonb;
  v_after jsonb;
  v_fingerprint text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or (v_service_status is not null and v_service_status not in (
       'active', 'suspended', 'transferred', 'closed', 'deceased'
     ))
     or v_presence not in ('all', 'assessed', 'not_assessed')
     or v_reassessment not in ('all', 'due', 'upcoming')
     or (v_adaptation is not null and v_adaptation not in (
       'settled', 'adjusting', 'support_requested'
     ))
     or v_follow_up not in (
       'all', 'needs_follow_up', 'no_follow_up', 'open', 'overdue'
     )
     or not private.adaptation_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501',
      message = 'adaptation assessment snapshot is not permitted';
  end if;

  if p_client_id is not null and not private.adaptation_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501',
      message = 'adaptation client filter is not permitted';
  end if;

  v_bundle := private.adaptation_assessment_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_service_status, v_presence, v_reassessment, v_adaptation,
    v_follow_up, v_now
  );
  v_fingerprint := encode(sha256(convert_to(v_bundle::text, 'UTF8')), 'hex');

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'adaptation_assessment_versions', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page32_manual_adaptation_v1',
      'item_count', (v_bundle ->> 'item_total')::integer,
      'matching_total', (v_bundle ->> 'matching_total')::bigint,
      'items_truncated', (v_bundle ->> 'items_truncated')::boolean,
      'item_limit', 200,
      'snapshot_fingerprint', v_fingerprint,
      'filter_values_logged', false,
      'narrative_logged', false,
      'score_computed', false,
      'diagnosis_computed', false
    )
  );

  v_after := private.adaptation_assessment_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_service_status, v_presence, v_reassessment, v_adaptation,
    v_follow_up, v_now
  );
  if not private.adaptation_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'social_work_records.read'
     ) or v_after is distinct from v_bundle then
    raise exception using errcode = '42501',
      message = 'adaptation assessment snapshot final verification failed';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    v_bundle -> 'items',
    (v_bundle ->> 'item_total')::integer,
    (v_bundle ->> 'matching_total')::bigint,
    (v_bundle ->> 'items_truncated')::boolean,
    (v_bundle ->> 'assessed_total')::bigint,
    (v_bundle ->> 'not_assessed_total')::bigint,
    (v_bundle ->> 'reassessment_due_total')::bigint,
    (v_bundle ->> 'needs_follow_up_total')::bigint,
    (v_bundle ->> 'open_follow_up_total')::bigint,
    (v_bundle ->> 'overdue_follow_up_total')::bigint,
    (v_bundle ->> 'draft_total')::bigint,
    (v_bundle ->> 'completed_total')::bigint,
    v_bundle -> 'client_options',
    (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'client_options_truncated')::boolean,
    v_bundle -> 'assessor_options',
    (v_bundle ->> 'assessor_total')::bigint,
    (v_bundle ->> 'assessor_options_truncated')::boolean,
    v_bundle ->> 'assessment_method_status',
    v_bundle ->> 'form_publication_status',
    v_bundle ->> 'offline_sync_status',
    v_bundle ->> 'follow_up_notification_status';
end;
$$;

create or replace function public.adaptation_assessment_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_service_status text default null,
  p_assessment_presence text default 'all',
  p_reassessment_status text default 'all',
  p_adaptation_status text default null,
  p_follow_up_filter text default 'all'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total integer,
  matching_total bigint,
  items_truncated boolean,
  assessed_total bigint,
  not_assessed_total bigint,
  reassessment_due_total bigint,
  needs_follow_up_total bigint,
  open_follow_up_total bigint,
  overdue_follow_up_total bigint,
  draft_total bigint,
  completed_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  assessor_options jsonb,
  assessor_total bigint,
  assessor_options_truncated boolean,
  assessment_method_status text,
  form_publication_status text,
  offline_sync_status text,
  follow_up_notification_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.adaptation_assessment_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_service_status, p_assessment_presence, p_reassessment_status,
    p_adaptation_status, p_follow_up_filter
  );
$$;

create policy adaptation_assessment_versions_staff_select
on public.adaptation_assessment_versions for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'social_work_records.read')
);

create policy adaptation_follow_up_events_staff_select
on public.adaptation_follow_up_events for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'social_work_records.read')
);

revoke all on function private.adaptation_history_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.adaptation_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.adaptation_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_adaptation_reauth_evidence(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_adaptation_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.adaptation_assessment_snapshot_bundle(uuid,uuid,uuid,text,text,text,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.adaptation_assessment_snapshot_response(uuid,uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_adaptation_assessment_draft(uuid,uuid,uuid,date,text,text,date,boolean,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_adaptation_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sign_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mutate_adaptation_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.adaptation_assessment_snapshot(uuid,uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_adaptation_assessment_draft(uuid,uuid,uuid,date,text,text,date,boolean,text,uuid)
  to authenticated;
grant execute on function public.revise_adaptation_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,uuid)
  to authenticated;
grant execute on function public.sign_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function public.correct_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)
  to authenticated;
grant execute on function public.mutate_adaptation_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  to authenticated;
grant execute on function public.adaptation_assessment_snapshot(uuid,uuid,uuid,text,text,text,text,text)
  to authenticated;

-- SECURITY INVOKER wrappers need only the exact private entry point they call.
grant execute on function private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)
  to authenticated;
grant execute on function private.mutate_adaptation_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  to authenticated;
grant execute on function private.adaptation_assessment_snapshot_response(uuid,uuid,uuid,text,text,text,text,text)
  to authenticated;

comment on function public.adaptation_assessment_snapshot(uuid,uuid,uuid,text,text,text,text,text)
is 'Page 32 client list: latest manual assessment, current service status, manually entered reassessment due date, and follow-up state. Not a standardized scale.';
