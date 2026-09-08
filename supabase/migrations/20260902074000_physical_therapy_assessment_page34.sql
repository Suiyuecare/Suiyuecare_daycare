-- Page 34: manual, explicitly unstandardized physical therapy assessments.
--
-- This release does not publish or imitate an official scale. It records an
-- assigned physical therapist's dated observations, manually named
-- measurements with explicit missing/not-applicable reasons, goals,
-- recommendations, follow-up plan, and a manually entered reassessment date
-- with its source or rationale. No score, formula, diagnosis, or automatic
-- due-date rule exists.

insert into public.permissions (permission_key, description, risk_level) values
  ('physical_therapy_assessments.read',
    'Read assigned-client physical therapy assessments', 2),
  ('physical_therapy_assessments.manage',
    'Create and revise assigned-client physical therapy assessment drafts', 2),
  ('physical_therapy_assessments.sign',
    'Sign or correct assigned-client physical therapy assessments', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'professional'
  )
  and permission.permission_key = 'physical_therapy_assessments.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key = 'professional'
  and permission.permission_key in (
    'physical_therapy_assessments.manage',
    'physical_therapy_assessments.sign'
  )
on conflict (role_id, permission_id) do nothing;

create or replace function private.physical_therapy_measurements_are_valid(
  p_measurements jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_measurements) = 'array'
    and jsonb_array_length(p_measurements) between 1 and 50
    and (
      select count(*) = count(distinct lower(item ->> 'name'))
      from jsonb_array_elements(p_measurements) item
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_measurements) item
      where jsonb_typeof(item) <> 'object'
        or (select count(*) from jsonb_object_keys(item)) <> 5
        or not item ?& array['name', 'state', 'value', 'unit', 'reason']
        or jsonb_typeof(item -> 'name') <> 'string'
        or char_length(btrim(item ->> 'name')) not between 1 and 120
        or item ->> 'name' <> btrim(item ->> 'name')
        or item ->> 'name' ~ '[[:cntrl:]]'
        or jsonb_typeof(item -> 'state') <> 'string'
        or item ->> 'state' not in (
          'numeric', 'text', 'missing', 'not_applicable'
        )
        or (
          item ->> 'state' = 'numeric'
          and (
            jsonb_typeof(item -> 'value') <> 'string'
            or item ->> 'value' !~ '^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
            or jsonb_typeof(item -> 'unit') <> 'string'
            or char_length(btrim(item ->> 'unit')) not between 1 and 40
            or item ->> 'unit' <> btrim(item ->> 'unit')
            or item ->> 'unit' ~ '[[:cntrl:]]'
            or item -> 'reason' <> 'null'::jsonb
          )
        )
        or (
          item ->> 'state' = 'text'
          and (
            jsonb_typeof(item -> 'value') <> 'string'
            or char_length(btrim(item ->> 'value')) not between 1 and 2000
            or item ->> 'value' <> btrim(item ->> 'value')
            or translate(item ->> 'value', E'\n\r\t', '') ~ '[[:cntrl:]]'
            or item -> 'unit' <> 'null'::jsonb
            or item -> 'reason' <> 'null'::jsonb
          )
        )
        or (
          item ->> 'state' in ('missing', 'not_applicable')
          and (
            item -> 'value' <> 'null'::jsonb
            or item -> 'unit' <> 'null'::jsonb
            or jsonb_typeof(item -> 'reason') <> 'string'
            or char_length(btrim(item ->> 'reason')) not between 1 and 500
            or item ->> 'reason' <> btrim(item ->> 'reason')
            or translate(item ->> 'reason', E'\n\r\t', '') ~ '[[:cntrl:]]'
          )
        )
    );
$$;

create table public.physical_therapy_assessment_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_state text not null,
  assessed_on date not null,
  therapist_user_id uuid not null references auth.users(id) on delete restrict,
  therapist_display_name text not null,
  service_status_at_assessment text not null,
  reassessment_due_on date not null,
  due_basis text not null,
  measurements jsonb not null,
  functional_observation text not null,
  goals text not null,
  recommendations text not null,
  follow_up_plan text not null,
  form_basis text not null,
  form_version_reference text not null,
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
  constraint physical_therapy_assessment_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint physical_therapy_assessment_id_scope_key unique (
    id, organization_id, branch_id, client_id, assessment_key
  ),
  constraint physical_therapy_assessment_chain_key unique (
    organization_id, branch_id, assessment_key, version
  ),
  constraint physical_therapy_assessment_previous_key unique (previous_version_id),
  constraint physical_therapy_assessment_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id,
      assessment_key
    ) references public.physical_therapy_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint physical_therapy_assessment_version_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null)
    )
  ),
  constraint physical_therapy_assessment_state_check check (
    record_state in ('draft', 'signed', 'corrected')
  ),
  constraint physical_therapy_assessment_dates_check check (
    extract(year from assessed_on) between 2000 and 2200
    and reassessment_due_on >= assessed_on
    and extract(year from reassessment_due_on) between 2000 and 2200
  ),
  constraint physical_therapy_assessment_service_status_check check (
    service_status_at_assessment in (
      'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  ),
  constraint physical_therapy_assessment_therapist_check check (
    char_length(therapist_display_name) between 1 and 120
    and therapist_display_name = btrim(therapist_display_name)
    and therapist_display_name !~ '[[:cntrl:]]'
  ),
  constraint physical_therapy_assessment_due_basis_check check (
    char_length(due_basis) between 1 and 1000
    and due_basis = btrim(due_basis)
    and translate(due_basis, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint physical_therapy_assessment_measurements_check check (
    private.physical_therapy_measurements_are_valid(measurements)
  ),
  constraint physical_therapy_functional_observation_check check (
    char_length(functional_observation) between 1 and 5000
    and functional_observation = btrim(functional_observation)
    and translate(functional_observation, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint physical_therapy_assessment_goals_check check (
    char_length(goals) between 1 and 5000
    and goals = btrim(goals)
    and translate(goals, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint physical_therapy_assessment_recommendations_check check (
    char_length(recommendations) between 1 and 5000
    and recommendations = btrim(recommendations)
    and translate(recommendations, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint physical_therapy_assessment_follow_up_check check (
    char_length(follow_up_plan) between 1 and 5000
    and follow_up_plan = btrim(follow_up_plan)
    and translate(follow_up_plan, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint physical_therapy_assessment_form_reference_check check (
    form_basis = 'manual_unstandardized'
    and form_version_reference = 'manual-physical-therapy-v1'
  ),
  constraint physical_therapy_assessment_signature_alignment_check check (
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
        then '人工物理治療評估簽署' else '人工物理治療評估更正簽署' end
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
  constraint physical_therapy_assessment_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.physical_therapy_assessment_versions is
  'Immutable manual, unstandardized page-33 assessment versions. No score, diagnosis, or automatic reassessment rule is computed.';
comment on column public.physical_therapy_assessment_versions.due_basis is
  'Staff-entered source or rationale for the manually entered due date.';
comment on column public.physical_therapy_assessment_versions.form_version_reference is
  'Technical reference manual-physical-therapy-v1; not an official or standardized scale.';
comment on column public.physical_therapy_assessment_versions.measurements is
  'Manual named measurement items. Numeric values remain exact strings and are never summed into a score.';

create table private.physical_therapy_assessment_operations (
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
  constraint physical_therapy_assessment_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint physical_therapy_assessment_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, client_id,
      result_assessment_key
    ) references public.physical_therapy_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint physical_therapy_assessment_operations_kind_check check (
    operation_kind in ('create_draft', 'revise_draft', 'sign', 'correct')
  ),
  constraint physical_therapy_assessment_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint physical_therapy_assessment_operations_version_check
    check (result_version > 0),
  constraint physical_therapy_assessment_operations_state_check
    check (result_state in ('draft', 'signed', 'corrected')),
  constraint physical_therapy_assessment_operations_reauth_check check (
    reauth_challenge_id is not null
  )
);

comment on table private.physical_therapy_assessment_operations is
  'Append-only actor-scoped exact-replay receipts for page 34 writes.';

create index physical_therapy_assessments_scope_latest_idx
  on public.physical_therapy_assessment_versions (
    organization_id, branch_id, client_id, assessed_on desc,
    created_at desc, assessment_key, version desc
  );
create index physical_therapy_assessments_chain_idx
  on public.physical_therapy_assessment_versions (
    organization_id, branch_id, assessment_key, version desc
  );
create index physical_therapy_assessments_previous_idx
  on public.physical_therapy_assessment_versions (previous_version_id)
  where previous_version_id is not null;
create index physical_therapy_assessments_therapist_idx
  on public.physical_therapy_assessment_versions (therapist_user_id);
create index physical_therapy_assessments_signed_by_idx
  on public.physical_therapy_assessment_versions (signed_by)
  where signed_by is not null;
create index physical_therapy_assessments_reauth_idx
  on public.physical_therapy_assessment_versions (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index physical_therapy_assessment_operations_result_idx
  on private.physical_therapy_assessment_operations (
    organization_id, branch_id, client_id, result_assessment_key,
    result_version_id
  );
create index physical_therapy_assessment_operations_reauth_idx
  on private.physical_therapy_assessment_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.physical_therapy_assessment_versions enable row level security;
alter table public.physical_therapy_assessment_versions force row level security;
alter table private.physical_therapy_assessment_operations enable row level security;
alter table private.physical_therapy_assessment_operations force row level security;

revoke all on table public.physical_therapy_assessment_versions
  from public, anon, authenticated, service_role;
revoke all on table private.physical_therapy_assessment_operations
  from public, anon, authenticated, service_role;

create or replace function private.physical_therapy_history_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'physical therapy assessment history is append-only';
end;
$$;

create or replace function private.physical_therapy_current_authority(
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
    and p_permission in (
      'physical_therapy_assessments.read',
      'physical_therapy_assessments.manage',
      'physical_therapy_assessments.sign'
    )
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and (
          (p_permission = 'physical_therapy_assessments.read'
            and profile.kind in ('staff', 'professional'))
          or (p_permission in (
            'physical_therapy_assessments.manage',
            'physical_therapy_assessments.sign'
          ) and profile.kind = 'professional')
        )
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

create or replace function private.physical_therapy_client_authority(
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
  select private.physical_therapy_current_authority(
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

create or replace function private.require_physical_therapy_reauth_evidence(
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
      message = 'current same-session recent AAL2 evidence is required for physical_therapy writing';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for physical_therapy writing';
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
      message = 'current same-session recent AAL2 evidence is required for physical_therapy writing';
  end if;
  return v_challenge_id;
end;
$$;
create or replace function private.mutate_physical_therapy_assessment_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_reassessment_due_on date,
  p_due_basis text,
  p_measurements jsonb,
  p_functional_observation text,
  p_goals text,
  p_recommendations text,
  p_follow_up_plan text,
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
  therapist_user_id uuid,
  service_status_at_assessment text,
  reassessment_due_on date,
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
  v_operation private.physical_therapy_assessment_operations%rowtype;
  v_previous public.physical_therapy_assessment_versions%rowtype;
  v_result public.physical_therapy_assessment_versions%rowtype;
  v_assessment_key uuid;
  v_version integer;
  v_state text;
  v_therapist_user_id uuid;
  v_therapist_display_name text;
  v_service_status text;
  v_signer_display_name text;
  v_signer_role_keys text[];
  v_challenge_id uuid;
  v_assessed_on date;
  v_reassessment_due_on date;
  v_due_basis text;
  v_measurements jsonb;
  v_functional_observation text;
  v_goals text;
  v_recommendations text;
  v_follow_up_plan text;
  v_form_reference text;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_content_hash text;
begin
  if p_action not in ('create_draft', 'revise_draft', 'sign', 'correct')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_idempotency_key is null
     or not private.physical_therapy_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'physical_therapy_assessments.sign' else 'physical_therapy_assessments.manage' end
     )
     or not private.physical_therapy_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'physical_therapy_assessments.read'
     ) then
    raise exception using errcode = '42501',
      message = 'physical_therapy assessment operation is not permitted';
  end if;

  if p_action = 'create_draft' then
    if p_assessment_key is not null or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = '22023',
        message = 'new physical_therapy assessment chain input is invalid';
    end if;
  elsif p_assessment_key is null or p_previous_version_id is null
        or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023',
      message = 'physical_therapy assessment chain input is invalid';
  end if;

  if p_action in ('create_draft', 'revise_draft', 'correct') then
    if p_assessed_on is null
       or extract(year from p_assessed_on) not between 2000 and 2200
       or p_reassessment_due_on is null
       or extract(year from p_reassessment_due_on) not between 2000 and 2200
       or p_reassessment_due_on < p_assessed_on
       or p_due_basis is null
       or char_length(btrim(p_due_basis)) not between 1 and 1000
       or translate(btrim(p_due_basis), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or not private.physical_therapy_measurements_are_valid(p_measurements)
       or p_functional_observation is null
       or char_length(btrim(p_functional_observation)) not between 1 and 5000
       or translate(btrim(p_functional_observation), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_goals is null
       or char_length(btrim(p_goals)) not between 1 and 5000
       or translate(btrim(p_goals), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_recommendations is null
       or char_length(btrim(p_recommendations)) not between 1 and 5000
       or translate(btrim(p_recommendations), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_follow_up_plan is null
       or char_length(btrim(p_follow_up_plan)) not between 1 and 5000
       or translate(btrim(p_follow_up_plan), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_form_version_reference <> 'manual-physical-therapy-v1'
       or (p_action = 'correct' and (
         v_reason is null or char_length(v_reason) > 1000
         or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       ))
       or (p_action <> 'correct' and v_reason is not null) then
      raise exception using errcode = '22023',
        message = 'manual physical_therapy assessment content is invalid';
    end if;
  elsif p_assessed_on is not null or p_reassessment_due_on is not null
        or p_due_basis is not null or p_measurements is not null
        or p_functional_observation is not null
        or p_goals is not null or p_recommendations is not null
        or p_follow_up_plan is not null
        or p_form_version_reference is not null or v_reason is not null then
    raise exception using errcode = '22023',
      message = 'physical_therapy signing must use the exact current draft';
  end if;

  -- Page 34 requires recent, same-session AAL2 for every write, including
  -- create/revise and exact replay. The immutable operation ledger freezes
  -- the challenge even when the assessment version remains an unsigned draft.
  v_now := clock_timestamp();
  v_challenge_id := private.require_physical_therapy_reauth_evidence(
    v_actor, v_now
  );

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', p_assessment_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version, 'assessed_on', p_assessed_on,
    'reassessment_due_on', p_reassessment_due_on,
    'due_basis', case when p_due_basis is null then null
      else btrim(p_due_basis) end,
    'measurements', p_measurements,
    'functional_observation', case when p_functional_observation is null
      then null else btrim(p_functional_observation) end,
    'goals', case when p_goals is null then null else btrim(p_goals) end,
    'recommendations', case when p_recommendations is null
      then null else btrim(p_recommendations) end,
    'follow_up_plan', case when p_follow_up_plan is null
      then null else btrim(p_follow_up_plan) end,
    'form_version_reference', p_form_version_reference,
    'correction_reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'physical_therapy-operation:' || v_actor::text || ':' ||
      p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.physical_therapy_assessment_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'physical_therapy assessment idempotency conflict';
    end if;
    if not private.physical_therapy_client_authority(
      p_expected_organization_id, p_expected_branch_id,
      v_operation.client_id,
      case when p_action in ('sign', 'correct')
        then 'physical_therapy_assessments.sign' else 'physical_therapy_assessments.manage' end
    ) then
      raise exception using errcode = '42501',
        message = 'physical_therapy assessment replay is not permitted';
    end if;
    select version_row.* into strict v_result
    from public.physical_therapy_assessment_versions version_row
    where version_row.id = v_operation.result_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_operation.result_assessment_key;
    return query select v_operation.id, v_result.client_id,
      v_result.assessment_key, v_result.id, v_result.version,
      v_result.record_state, v_result.assessed_on,
      v_result.therapist_user_id,
      v_result.service_status_at_assessment,
      v_result.reassessment_due_on, v_result.form_version_reference,
      v_operation.result_committed_at, true;
    return;
  end if;

  v_assessment_key := coalesce(p_assessment_key, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'physical_therapy-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || v_assessment_key::text, 0
  ));
  if p_action <> 'create_draft' then
    select version_row.* into v_previous
    from public.physical_therapy_assessment_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_assessment_key
      and not exists (
        select 1 from public.physical_therapy_assessment_versions child
        where child.previous_version_id = version_row.id
      )
    order by version_row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> p_previous_version_id
       or v_previous.version <> p_expected_version then
      raise exception using errcode = '40001',
        message = 'physical_therapy assessment version is stale';
    end if;
  end if;

  if p_action = 'create_draft' then
    v_version := 1; v_state := 'draft';
    v_therapist_user_id := v_actor;
    select profile.display_name into v_therapist_display_name
    from public.profiles profile
    where profile.id = v_actor and profile.is_active
      and profile.kind = 'professional';
    select client.status::text into v_service_status
    from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id;
    v_assessed_on := p_assessed_on;
    v_reassessment_due_on := p_reassessment_due_on;
    v_due_basis := btrim(p_due_basis);
    v_measurements := p_measurements;
    v_functional_observation := btrim(p_functional_observation);
    v_goals := btrim(p_goals);
    v_recommendations := btrim(p_recommendations);
    v_follow_up_plan := btrim(p_follow_up_plan);
    v_form_reference := p_form_version_reference;
  elsif p_action = 'revise_draft' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514',
        message = 'signed physical_therapy assessment requires a correction';
    end if;
    v_version := v_previous.version + 1; v_state := 'draft';
    v_therapist_user_id := v_actor;
    select profile.display_name into v_therapist_display_name
    from public.profiles profile
    where profile.id = v_actor and profile.is_active
      and profile.kind = 'professional';
    v_service_status := v_previous.service_status_at_assessment;
    v_assessed_on := p_assessed_on;
    v_reassessment_due_on := p_reassessment_due_on;
    v_due_basis := btrim(p_due_basis);
    v_measurements := p_measurements;
    v_functional_observation := btrim(p_functional_observation);
    v_goals := btrim(p_goals);
    v_recommendations := btrim(p_recommendations);
    v_follow_up_plan := btrim(p_follow_up_plan);
    v_form_reference := p_form_version_reference;
  elsif p_action = 'sign' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514',
        message = 'only the current physical_therapy draft can be signed';
    end if;
    if v_previous.therapist_user_id <> v_actor then
      raise exception using errcode = '42501',
        message = 'only the current qualified physical therapist may sign this draft';
    end if;
    v_version := v_previous.version + 1; v_state := 'signed';
    v_therapist_user_id := v_previous.therapist_user_id;
    v_therapist_display_name := v_previous.therapist_display_name;
    v_service_status := v_previous.service_status_at_assessment;
    v_assessed_on := v_previous.assessed_on;
    v_reassessment_due_on := v_previous.reassessment_due_on;
    v_due_basis := v_previous.due_basis;
    v_measurements := v_previous.measurements;
    v_functional_observation := v_previous.functional_observation;
    v_goals := v_previous.goals;
    v_recommendations := v_previous.recommendations;
    v_follow_up_plan := v_previous.follow_up_plan;
    v_form_reference := v_previous.form_version_reference;
  else
    if v_previous.record_state not in ('signed', 'corrected') then
      raise exception using errcode = '23514',
        message = 'only signed physical_therapy content can be corrected';
    end if;
    v_version := v_previous.version + 1; v_state := 'corrected';
    v_therapist_user_id := v_actor;
    select profile.display_name into v_therapist_display_name
    from public.profiles profile
    where profile.id = v_actor and profile.is_active
      and profile.kind = 'professional';
    v_service_status := v_previous.service_status_at_assessment;
    v_assessed_on := p_assessed_on;
    v_reassessment_due_on := p_reassessment_due_on;
    v_due_basis := btrim(p_due_basis);
    v_measurements := p_measurements;
    v_functional_observation := btrim(p_functional_observation);
    v_goals := btrim(p_goals);
    v_recommendations := btrim(p_recommendations);
    v_follow_up_plan := btrim(p_follow_up_plan);
    v_form_reference := p_form_version_reference;
  end if;

  if v_assessed_on > (v_now at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023',
      message = 'future physical_therapy assessment date is invalid';
  end if;
  if v_therapist_display_name is null or v_service_status is null then
    raise exception using errcode = '42501',
      message = 'physical_therapy therapist identity or service status is invalid';
  end if;
  if p_action in ('sign', 'correct') then
    select profile.display_name into v_signer_display_name
    from public.profiles profile
    where profile.id = v_actor and profile.is_active
      and profile.kind = 'professional';
    select coalesce(
      array_agg(distinct role.role_key order by role.role_key), '{}'::text[]
    ) into v_signer_role_keys
    from public.memberships membership
    join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    join public.roles role
      on role.id = membership_role.role_id and role.is_active
    where membership.profile_id = v_actor
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and (membership.branch_id is null
        or membership.branch_id = p_expected_branch_id)
      and (role.organization_id is null
        or role.organization_id = p_expected_organization_id);
    if v_signer_display_name is null
       or cardinality(v_signer_role_keys) = 0 then
      raise exception using errcode = '42501',
        message = 'physical_therapy signer identity could not be verified';
    end if;
  end if;

  if not private.physical_therapy_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    case when p_action in ('sign', 'correct')
      then 'physical_therapy_assessments.sign' else 'physical_therapy_assessments.manage' end
  ) then
    raise exception using errcode = '42501',
      message = 'physical_therapy assessment authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', v_assessment_key, 'version', v_version,
    'previous_version_id', p_previous_version_id, 'record_state', v_state,
    'assessed_on', v_assessed_on,
    'therapist_user_id', v_therapist_user_id,
    'service_status_at_assessment', v_service_status,
    'reassessment_due_on', v_reassessment_due_on,
    'due_basis', v_due_basis, 'measurements', v_measurements,
    'functional_observation', v_functional_observation,
    'goals', v_goals, 'recommendations', v_recommendations,
    'follow_up_plan', v_follow_up_plan,
    'form_basis', 'manual_unstandardized',
    'form_version_reference', v_form_reference,
    'correction_reason', v_reason,
    'signed_by', case when v_state = 'draft' then null else v_actor end,
    'signed_at', case when v_state = 'draft' then null else v_now end
  )::text, 'UTF8')), 'hex');

  insert into public.physical_therapy_assessment_versions (
    organization_id, branch_id, client_id, assessment_key, version,
    previous_version_id, record_state, assessed_on, therapist_user_id,
    therapist_display_name, service_status_at_assessment,
    reassessment_due_on, due_basis, measurements, functional_observation,
    goals, recommendations, follow_up_plan,
    form_basis, form_version_reference, correction_reason, signed_at,
    signed_by, signer_display_name, signer_role_keys, signature_purpose,
    signature_reauth_challenge_id, content_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_assessment_key, v_version, p_previous_version_id, v_state,
    v_assessed_on, v_therapist_user_id, v_therapist_display_name,
    v_service_status, v_reassessment_due_on, v_due_basis, v_measurements,
    v_functional_observation, v_goals, v_recommendations, v_follow_up_plan,
    'manual_unstandardized', v_form_reference,
    case when v_state = 'corrected' then v_reason else null end,
    case when v_state = 'draft' then null else v_now end,
    case when v_state = 'draft' then null else v_actor end,
    case when v_state = 'draft' then null else v_signer_display_name end,
    case when v_state = 'draft' then null else v_signer_role_keys end,
    case when v_state = 'signed' then '人工物理治療評估簽署'
      when v_state = 'corrected' then '人工物理治療評估更正簽署'
      else null end,
    case when v_state = 'draft' then null else v_challenge_id end,
    v_content_hash, v_now
  ) returning * into v_result;

  insert into private.physical_therapy_assessment_operations (
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
    'physical_therapy_assessment_versions', v_result.id::text,
    p_idempotency_key,
    array[
      'record_state', 'version', 'assessed_on',
      'service_status_at_assessment', 'reassessment_due_on', 'due_basis',
      'measurements', 'functional_observation', 'goals', 'recommendations',
      'follow_up_plan', 'form_version_reference'
    ],
    jsonb_build_object(
      'workflow', 'page34_manual_physical_therapy_v1',
      'assessment_key', v_result.assessment_key,
      'version', v_result.version, 'state', v_result.record_state,
      'manual_unstandardized', true,
      'contains_narrative', true, 'narrative_logged', false,
      'filter_values_logged', false,
      'score_computed', false, 'diagnosis_computed', false
    )
  );

  if not private.physical_therapy_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    case when p_action in ('sign', 'correct')
      then 'physical_therapy_assessments.sign' else 'physical_therapy_assessments.manage' end
  ) or not exists (
    select 1 from public.physical_therapy_assessment_versions version_row
    where version_row.id = v_result.id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_assessment_key
      and version_row.version = v_version
      and not exists (
        select 1 from public.physical_therapy_assessment_versions child
        where child.previous_version_id = version_row.id
      )
  ) then
    raise exception using errcode = '42501',
      message = 'physical_therapy assessment final verification failed';
  end if;

  return query select v_operation.id, v_result.client_id,
    v_result.assessment_key, v_result.id, v_result.version,
    v_result.record_state, v_result.assessed_on,
    v_result.therapist_user_id, v_result.service_status_at_assessment,
    v_result.reassessment_due_on, v_result.form_version_reference,
    v_result.created_at, false;
end;
$$;
create or replace function public.create_physical_therapy_assessment_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessed_on date,
  p_reassessment_due_on date,
  p_due_basis text,
  p_measurements jsonb,
  p_functional_observation text,
  p_goals text,
  p_recommendations text,
  p_follow_up_plan text,
  p_form_version_reference text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  therapist_user_id uuid, service_status_at_assessment text,
  reassessment_due_on date, form_version_reference text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_physical_therapy_assessment_guarded(
    'create_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, null, null, 0, p_assessed_on, p_reassessment_due_on,
    p_due_basis, p_measurements, p_functional_observation,
    p_goals, p_recommendations, p_follow_up_plan,
    p_form_version_reference, null, p_idempotency_key
  );
$$;

create or replace function public.revise_physical_therapy_assessment_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_reassessment_due_on date,
  p_due_basis text,
  p_measurements jsonb,
  p_functional_observation text,
  p_goals text,
  p_recommendations text,
  p_follow_up_plan text,
  p_form_version_reference text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  therapist_user_id uuid, service_status_at_assessment text,
  reassessment_due_on date, form_version_reference text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_physical_therapy_assessment_guarded(
    'revise_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_assessment_key, p_previous_version_id,
    p_expected_version, p_assessed_on, p_reassessment_due_on,
    p_due_basis, p_measurements, p_functional_observation,
    p_goals, p_recommendations, p_follow_up_plan,
    p_form_version_reference, null, p_idempotency_key
  );
$$;

create or replace function public.sign_physical_therapy_assessment(
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
  therapist_user_id uuid, service_status_at_assessment text,
  reassessment_due_on date, form_version_reference text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_physical_therapy_assessment_guarded(
    'sign', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_previous_version_id, p_expected_version,
    null, null, null, null, null, null, null, null, null, null,
    p_idempotency_key
  );
$$;

create or replace function public.correct_physical_therapy_assessment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_reassessment_due_on date,
  p_due_basis text,
  p_measurements jsonb,
  p_functional_observation text,
  p_goals text,
  p_recommendations text,
  p_follow_up_plan text,
  p_form_version_reference text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  therapist_user_id uuid, service_status_at_assessment text,
  reassessment_due_on date, form_version_reference text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_physical_therapy_assessment_guarded(
    'correct', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_assessment_key, p_previous_version_id,
    p_expected_version, p_assessed_on, p_reassessment_due_on,
    p_due_basis, p_measurements, p_functional_observation,
    p_goals, p_recommendations, p_follow_up_plan,
    p_form_version_reference, p_correction_reason, p_idempotency_key
  );
$$;

create trigger physical_therapy_assessment_versions_append_only
before update or delete on public.physical_therapy_assessment_versions
for each row execute function private.physical_therapy_history_is_append_only();
create trigger physical_therapy_assessment_operations_append_only
before update or delete on private.physical_therapy_assessment_operations
for each row execute function private.physical_therapy_history_is_append_only();

create trigger physical_therapy_assessment_versions_audit_row_change
after insert on public.physical_therapy_assessment_versions
for each row execute function private.audit_row_change();
create trigger physical_therapy_assessment_operations_audit_row_change
after insert on private.physical_therapy_assessment_operations
for each row execute function private.audit_row_change();

create or replace function private.physical_therapy_assessment_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_therapist_user_id uuid,
  p_service_status text,
  p_due_status text,
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
    from public.physical_therapy_assessment_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and private.can_staff_access_client(
        version_row.client_id, 'clients.read'
      )
      and private.can_staff_access_client(
        version_row.client_id, 'physical_therapy_assessments.read'
      )
      and not exists (
        select 1 from public.physical_therapy_assessment_versions child
        where child.previous_version_id = version_row.id
      )
  ), latest_assessment as materialized (
    select distinct on (version_row.client_id) version_row.*
    from terminal_visible version_row
    order by version_row.client_id, version_row.assessed_on desc,
      version_row.created_at desc, version_row.assessment_key,
      version_row.version desc
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
      assessment.therapist_user_id,
      assessment.therapist_display_name,
      assessment.service_status_at_assessment,
      assessment.reassessment_due_on,
      assessment.due_basis,
      assessment.measurements,
      assessment.functional_observation,
      assessment.goals,
      assessment.recommendations,
      assessment.follow_up_plan,
      assessment.form_basis,
      assessment.form_version_reference,
      assessment.correction_reason,
      assessment.signed_at,
      assessment.signer_display_name,
      assessment.created_at,
      coalesce(
        assessment.reassessment_due_on <=
          (p_reference_time at time zone 'Asia/Taipei')::date,
        false
      ) as reassessment_due
    from public.clients client
    left join latest_assessment assessment
      on assessment.client_id = client.id
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(
        client.id, 'physical_therapy_assessments.read'
      )
  ), matching as materialized (
    select client_row.*
    from client_rows client_row
    where (p_client_id is null or client_row.client_id = p_client_id)
      and (p_therapist_user_id is null
        or client_row.therapist_user_id = p_therapist_user_id)
      and (p_service_status is null
        or client_row.service_status = p_service_status)
      and (
        p_due_status = 'all'
        or (p_due_status = 'due' and client_row.reassessment_due)
        or (p_due_status = 'upcoming'
          and client_row.version_id is not null
          and not client_row.reassessment_due)
        or (p_due_status = 'not_assessed'
          and client_row.version_id is null)
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
      'therapist_user_id', item.therapist_user_id,
      'therapist_display_name', item.therapist_display_name,
      'service_status_at_assessment', item.service_status_at_assessment,
      'reassessment_due_on', item.reassessment_due_on,
      'reassessment_due', item.reassessment_due,
      'due_basis', item.due_basis,
      'measurements', item.measurements,
      'functional_observation', item.functional_observation,
      'goals', item.goals,
      'recommendations', item.recommendations,
      'follow_up_plan', item.follow_up_plan,
      'form_basis', item.form_basis,
      'form_version_reference', item.form_version_reference,
      'correction_reason', item.correction_reason,
      'signed_at', item.signed_at,
      'signer_display_name', item.signer_display_name,
      'created_at', item.created_at,
      'version_history', case when item.assessment_key is null
        then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'version_id', history.id,
            'assessment_version', history.version,
            'record_state', history.record_state,
            'assessed_on', history.assessed_on,
            'therapist_user_id', history.therapist_user_id,
            'therapist_display_name', history.therapist_display_name,
            'service_status_at_assessment',
              history.service_status_at_assessment,
            'reassessment_due_on', history.reassessment_due_on,
            'due_basis', history.due_basis,
            'measurements', history.measurements,
            'functional_observation', history.functional_observation,
            'goals', history.goals,
            'recommendations', history.recommendations,
            'follow_up_plan', history.follow_up_plan,
            'form_basis', history.form_basis,
            'form_version_reference', history.form_version_reference,
            'correction_reason', history.correction_reason,
            'signed_at', history.signed_at,
            'signer_display_name', history.signer_display_name,
            'created_at', history.created_at
          ) order by history.version)
          from (
            select history.*
            from public.physical_therapy_assessment_versions history
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
          from public.physical_therapy_assessment_versions history
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
      count(*) filter (where version_id is not null)::bigint
        as assessed_total,
      count(*) filter (where version_id is null)::bigint
        as not_assessed_total,
      count(*) filter (where reassessment_due)::bigint as due_total,
      count(*) filter (
        where version_id is not null and not reassessment_due
      )::bigint as upcoming_total,
      count(*) filter (where record_state = 'draft')::bigint as draft_total,
      count(*) filter (
        where record_state in ('signed', 'corrected')
      )::bigint as completed_total
    from matching
  ), client_ranked as (
    select client_row.*, row_number() over (
      order by client_row.client_display_name collate "C",
        client_row.client_id
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
      filter (where ranked.ordinal <= 200), '[]'::jsonb)
        as client_options
    from client_ranked ranked
  ), therapist_candidates as materialized (
    select distinct therapist_user_id, therapist_display_name
    from terminal_visible
  ), therapist_ranked as (
    select candidate.*, row_number() over (
      order by candidate.therapist_display_name collate "C",
        candidate.therapist_user_id
    ) as ordinal
    from therapist_candidates candidate
  ), therapist_result as (
    select count(*)::bigint as therapist_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'user_id', ranked.therapist_user_id,
        'display_name', ranked.therapist_display_name
      ) order by ranked.therapist_display_name collate "C",
        ranked.therapist_user_id) filter (where ranked.ordinal <= 200),
        '[]'::jsonb) as therapist_options
    from therapist_ranked ranked
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
    'due_total', stats.due_total,
    'upcoming_total', stats.upcoming_total,
    'draft_total', stats.draft_total,
    'completed_total', stats.completed_total,
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated', client_result.client_total >
      jsonb_array_length(client_result.client_options),
    'therapist_options', therapist_result.therapist_options,
    'therapist_total', therapist_result.therapist_total,
    'therapist_options_truncated', therapist_result.therapist_total >
      jsonb_array_length(therapist_result.therapist_options),
    'assessment_method_status', 'manual_unstandardized_only',
    'form_publication_status', 'not_published_not_claimed',
    'due_rule_status', 'not_configured_manual_date_and_basis_only',
    'formula_status', 'not_configured',
    'score_status', 'not_configured',
    'diagnosis_status', 'not_configured',
    'attachment_status', 'not_configured',
    'export_status', 'not_configured',
    'reminder_status', 'not_configured',
    'offline_sync_status', 'not_configured'
  )
  from items_result cross join stats cross join client_result
  cross join therapist_result;
$$;

create or replace function private.physical_therapy_assessment_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_therapist_user_id uuid,
  p_service_status text,
  p_due_status text
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
  due_total bigint,
  upcoming_total bigint,
  draft_total bigint,
  completed_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  therapist_options jsonb,
  therapist_total bigint,
  therapist_options_truncated boolean,
  assessment_method_status text,
  form_publication_status text,
  due_rule_status text,
  formula_status text,
  score_status text,
  diagnosis_status text,
  attachment_status text,
  export_status text,
  reminder_status text,
  offline_sync_status text
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
  v_due_status text := lower(
    coalesce(nullif(btrim(p_due_status), ''), 'all')
  );
  v_bundle jsonb;
  v_after jsonb;
  v_fingerprint text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or (v_service_status is not null and v_service_status not in (
       'active', 'suspended', 'transferred', 'closed', 'deceased'
     ))
     or v_due_status not in ('all', 'due', 'upcoming', 'not_assessed')
     or not private.physical_therapy_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'physical_therapy_assessments.read'
     ) then
    raise exception using errcode = '42501',
      message = 'physical_therapy assessment snapshot is not permitted';
  end if;

  if p_client_id is not null and not private.physical_therapy_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'physical_therapy_assessments.read'
     ) then
    raise exception using errcode = '42501',
      message = 'physical_therapy client filter is not permitted';
  end if;

  if p_therapist_user_id is not null and not exists (
    select 1
    from public.physical_therapy_assessment_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.therapist_user_id = p_therapist_user_id
      and private.can_staff_access_client(version_row.client_id, 'clients.read')
      and private.can_staff_access_client(
        version_row.client_id, 'physical_therapy_assessments.read'
      )
  ) then
    raise exception using errcode = '42501',
      message = 'physical_therapy therapist filter is not permitted';
  end if;

  v_bundle := private.physical_therapy_assessment_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_therapist_user_id, v_service_status, v_due_status, v_now
  );
  v_fingerprint := encode(
    sha256(convert_to(v_bundle::text, 'UTF8')), 'hex'
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'physical_therapy_assessment_versions', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page34_manual_physical_therapy_v1',
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

  v_after := private.physical_therapy_assessment_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_therapist_user_id, v_service_status, v_due_status, v_now
  );
  if not private.physical_therapy_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'physical_therapy_assessments.read'
     ) or v_after is distinct from v_bundle then
    raise exception using errcode = '42501',
      message = 'physical_therapy assessment snapshot final verification failed';
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
    (v_bundle ->> 'due_total')::bigint,
    (v_bundle ->> 'upcoming_total')::bigint,
    (v_bundle ->> 'draft_total')::bigint,
    (v_bundle ->> 'completed_total')::bigint,
    v_bundle -> 'client_options',
    (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'client_options_truncated')::boolean,
    v_bundle -> 'therapist_options',
    (v_bundle ->> 'therapist_total')::bigint,
    (v_bundle ->> 'therapist_options_truncated')::boolean,
    v_bundle ->> 'assessment_method_status',
    v_bundle ->> 'form_publication_status',
    v_bundle ->> 'due_rule_status',
    v_bundle ->> 'formula_status',
    v_bundle ->> 'score_status',
    v_bundle ->> 'diagnosis_status',
    v_bundle ->> 'attachment_status',
    v_bundle ->> 'export_status',
    v_bundle ->> 'reminder_status',
    v_bundle ->> 'offline_sync_status';
end;
$$;

create or replace function public.physical_therapy_assessment_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_therapist_user_id uuid default null,
  p_service_status text default null,
  p_due_status text default 'all'
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
  due_total bigint,
  upcoming_total bigint,
  draft_total bigint,
  completed_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  therapist_options jsonb,
  therapist_total bigint,
  therapist_options_truncated boolean,
  assessment_method_status text,
  form_publication_status text,
  due_rule_status text,
  formula_status text,
  score_status text,
  diagnosis_status text,
  attachment_status text,
  export_status text,
  reminder_status text,
  offline_sync_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.physical_therapy_assessment_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_therapist_user_id, p_service_status, p_due_status
  );
$$;

create policy physical_therapy_assessment_versions_staff_select
on public.physical_therapy_assessment_versions for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'physical_therapy_assessments.read')
);

revoke all on function private.physical_therapy_measurements_are_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.physical_therapy_history_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.physical_therapy_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.physical_therapy_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_physical_therapy_reauth_evidence(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_physical_therapy_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.physical_therapy_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.physical_therapy_assessment_snapshot_response(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_physical_therapy_assessment_draft(uuid,uuid,uuid,date,date,text,jsonb,text,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_physical_therapy_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sign_physical_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_physical_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.physical_therapy_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_physical_therapy_assessment_draft(uuid,uuid,uuid,date,date,text,jsonb,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.revise_physical_therapy_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.sign_physical_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function public.correct_physical_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.physical_therapy_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)
  to authenticated;

-- SECURITY INVOKER wrappers need only the exact private entry point called.
grant execute on function private.mutate_physical_therapy_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function private.physical_therapy_assessment_snapshot_response(uuid,uuid,uuid,uuid,text,text)
  to authenticated;

comment on function public.physical_therapy_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)
is 'Page 34 assigned-client list with latest manual, non-standardized assessment, physical therapist, current service status, and staff-entered due date. No score or diagnosis.';
