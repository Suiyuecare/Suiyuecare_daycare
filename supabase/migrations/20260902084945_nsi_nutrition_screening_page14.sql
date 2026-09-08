-- Page 14: manual, unstandardized nsi-nutrition candidate drafts.
--
-- The bundled rule version is deliberately NOT activated. It can preserve an
-- assigned client's explicit answer states and reproduce a governed trial
-- preview, but it cannot be signed, represented as an official score, or used
-- to change a care decision. Formal activation remains owned by Page 82.

insert into public.permissions (permission_key, description, risk_level) values
  ('nsi_nutrition_screenings.read', 'Read assigned-client manual nutrition observation candidate drafts', 2),
  ('nsi_nutrition_screenings.manage', 'Create and revise assigned-client manual nutrition observation candidate drafts', 3),
  ('nsi_nutrition_screenings.sign', 'Request governed manual nutrition observation signing after formal rule activation', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor',
    'case_manager_social_worker', 'nurse', 'professional'
  )
  and permission.permission_key in (
    'nsi_nutrition_screenings.read', 'nsi_nutrition_screenings.manage', 'nsi_nutrition_screenings.sign'
  )
on conflict (role_id, permission_id) do nothing;

create or replace function private.nsi_nutrition_candidate_rule_snapshot()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version_id', 'nsi-manual-nutrition-observations-candidate-v1',
    'instrument', 'manual_unstandardized_nutrition_observations',
    'rule_revision', 1,
    'activation_status', 'candidate_unactivated',
    'activated_at', null,
    'governance_review_required', true,
    'formal_use_permitted', false,
    'field_ids', jsonb_build_array(
      'nutrition_observation_01', 'nutrition_observation_02', 'nutrition_observation_03',
      'nutrition_observation_04', 'nutrition_observation_05', 'nutrition_observation_06'
    ),
    'field_definitions', jsonb_build_array(
      jsonb_build_object('id', 'nutrition_observation_01', 'label', '人工觀察：近期餐食攝取情形需進一步確認', 'data_kind', 'manual_presence_observation'),
      jsonb_build_object('id', 'nutrition_observation_02', 'label', '人工觀察：近期體重或衣物鬆緊變化需進一步確認', 'data_kind', 'manual_presence_observation'),
      jsonb_build_object('id', 'nutrition_observation_03', 'label', '人工觀察：口腔、咀嚼或吞嚥相關情形需進一步確認', 'data_kind', 'manual_presence_observation'),
      jsonb_build_object('id', 'nutrition_observation_04', 'label', '人工觀察：自行進食或備餐協助需求需進一步確認', 'data_kind', 'manual_presence_observation'),
      jsonb_build_object('id', 'nutrition_observation_05', 'label', '人工觀察：飲食限制、過敏或特殊質地資訊需進一步確認', 'data_kind', 'manual_presence_observation'),
      jsonb_build_object('id', 'nutrition_observation_06', 'label', '人工觀察：營養相關健康或用藥資訊需專業覆核', 'data_kind', 'manual_presence_observation')
    ),
    'answer_values', jsonb_build_array('present', 'absent'),
    'completeness_policy', 'all_fields_answered_for_non_clinical_count',
    'present_count_policy', 'count_present_only_when_complete_non_clinical',
    'missing_policy', 'no_count_and_never_zero',
    'not_applicable_policy', 'no_count_and_never_zero',
    'formal_questionnaire_status', 'not_configured',
    'licensed_source_status', 'not_configured',
    'formal_weights_status', 'not_configured',
    'formal_scoring_status', 'not_configured',
    'formal_risk_classification_status', 'not_configured',
    'disclaimer', 'Manual unstandardized nutrition observations only. The present count is not a score; no formal NSI questionnaire, licensed source, weights, risk classification, diagnosis, signature, follow-up, referral, notification, or care decision is configured.'
  );
$$;

create or replace function private.nsi_nutrition_answers_are_valid(p_answers jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_answers) = 'object'
    and (select count(*) from jsonb_object_keys(p_answers)) = 6
    and not exists (
      select 1
      from jsonb_object_keys(p_answers) answer_key
      where answer_key not in (
        'nutrition_observation_01', 'nutrition_observation_02', 'nutrition_observation_03',
        'nutrition_observation_04', 'nutrition_observation_05', 'nutrition_observation_06'
      )
    )
    and not exists (
      select 1
      from jsonb_each(p_answers) entry
      where jsonb_typeof(entry.value) <> 'object'
        or jsonb_typeof(entry.value -> 'state') <> 'string'
        or entry.value ->> 'state' not in (
          'answered', 'missing', 'not_applicable'
        )
        or (
          entry.value ->> 'state' = 'answered'
          and (
            (select count(*) from jsonb_object_keys(entry.value)) <> 2
            or not entry.value ?& array['state', 'value']
            or jsonb_typeof(entry.value -> 'value') <> 'string'
            or entry.value ->> 'value' not in ('present', 'absent')
          )
        )
        or (
          entry.value ->> 'state' = 'missing'
          and (
            (select count(*) from jsonb_object_keys(entry.value)) <> 1
            or not entry.value ? 'state'
          )
        )
        or (
          entry.value ->> 'state' = 'not_applicable'
          and (
            (select count(*) from jsonb_object_keys(entry.value)) <> 2
            or not entry.value ?& array['state', 'reason']
            or jsonb_typeof(entry.value -> 'reason') <> 'string'
            or char_length(btrim(entry.value ->> 'reason')) not between 1 and 500
            or entry.value ->> 'reason' <> btrim(entry.value ->> 'reason')
            or translate(entry.value ->> 'reason', E'\n\r\t', '') ~ '[[:cntrl:]]'
          )
        )
    );
$$;

create or replace function private.nsi_nutrition_trial_preview(
  p_answers jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_raw integer;
begin
  if not private.nsi_nutrition_answers_are_valid(p_answers) then
    return jsonb_build_object(
      'status', 'invalid', 'observed_count', null
    );
  end if;

  if exists (
    select 1 from jsonb_each(p_answers) entry
    where entry.value ->> 'state' <> 'answered'
  ) then
    return jsonb_build_object(
      'status', 'incomplete', 'observed_count', null
    );
  end if;

  select count(*)::integer into v_raw
  from jsonb_each(p_answers) entry
  where entry.key in (
      'nutrition_observation_01', 'nutrition_observation_02', 'nutrition_observation_03',
      'nutrition_observation_04', 'nutrition_observation_05', 'nutrition_observation_06'
    ) and entry.value ->> 'value' = 'present';
  return jsonb_build_object(
    'status', 'candidate_complete', 'observed_count', v_raw
  );
end;
$$;

create table public.nsi_nutrition_screening_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_state text not null default 'draft_preview',
  assessed_on date not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  service_status_at_assessment text not null,
  answers jsonb not null,
  rule_version_id text not null,
  rule_snapshot jsonb not null,
  rule_snapshot_hash text not null,
  governance_status text not null,
  preview_status text not null,
  preview_observed_count integer,
  write_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint nsi_nutrition_screening_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint nsi_nutrition_screening_id_scope_key unique (
    id, organization_id, branch_id, client_id, assessment_key
  ),
  constraint nsi_nutrition_screening_chain_key unique (
    organization_id, branch_id, assessment_key, version
  ),
  constraint nsi_nutrition_screening_previous_key unique (previous_version_id),
  constraint nsi_nutrition_screening_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id,
      assessment_key
    ) references public.nsi_nutrition_screening_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint nsi_nutrition_screening_version_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null)
    )
  ),
  constraint nsi_nutrition_screening_state_check check (
    record_state = 'draft_preview'
  ),
  constraint nsi_nutrition_screening_date_check check (
    extract(year from assessed_on) between 2000 and 2200
  ),
  constraint nsi_nutrition_screening_author_check check (
    char_length(author_display_name) between 1 and 120
    and author_display_name = btrim(author_display_name)
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint nsi_nutrition_screening_service_status_check check (
    service_status_at_assessment in (
      'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  ),
  constraint nsi_nutrition_screening_answers_check check (
    private.nsi_nutrition_answers_are_valid(answers)
  ),
  constraint nsi_nutrition_screening_rule_check check (
    rule_version_id = 'nsi-manual-nutrition-observations-candidate-v1'
    and governance_status = 'candidate_unactivated'
    and rule_snapshot = private.nsi_nutrition_candidate_rule_snapshot()
    and rule_snapshot_hash = encode(
      sha256(convert_to(rule_snapshot::text, 'UTF8')), 'hex'
    )
  ),
  constraint nsi_nutrition_screening_preview_check check (
    preview_status = private.nsi_nutrition_trial_preview(answers) ->> 'status'
    and preview_observed_count is not distinct from (
      private.nsi_nutrition_trial_preview(answers)
        ->> 'observed_count'
    )::integer
    and preview_status in ('candidate_complete', 'incomplete')
  ),
  constraint nsi_nutrition_screening_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.nsi_nutrition_screening_versions is
  'Immutable Page 14 manual nutrition observation candidate drafts. Unactivated previews cannot be signed or used as formal NSI results.';
comment on column public.nsi_nutrition_screening_versions.answers is
  'Six neutral manual observation fields with explicit answered, missing, or not-applicable state; values are never written to audit metadata.';

create table private.nsi_nutrition_screening_operations (
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
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint nsi_nutrition_screening_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint nsi_nutrition_screening_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, client_id,
      result_assessment_key
    ) references public.nsi_nutrition_screening_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint nsi_nutrition_screening_operations_kind_check check (
    operation_kind in ('create_draft', 'revise_draft')
  ),
  constraint nsi_nutrition_screening_operations_request_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint nsi_nutrition_screening_operations_result_check check (
    result_version > 0 and result_state = 'draft_preview'
  )
);

create index nsi_nutrition_screenings_scope_latest_idx
  on public.nsi_nutrition_screening_versions (
    organization_id, branch_id, client_id, assessed_on desc,
    created_at desc, assessment_key, version desc
  );
create index nsi_nutrition_screenings_chain_idx
  on public.nsi_nutrition_screening_versions (
    organization_id, branch_id, assessment_key, version desc
  );
create index nsi_nutrition_screenings_previous_idx
  on public.nsi_nutrition_screening_versions (previous_version_id)
  where previous_version_id is not null;
create index nsi_nutrition_screenings_author_idx
  on public.nsi_nutrition_screening_versions (author_user_id);
create index nsi_nutrition_screenings_reauth_idx
  on public.nsi_nutrition_screening_versions (write_reauth_challenge_id);
create index nsi_nutrition_operations_result_idx
  on private.nsi_nutrition_screening_operations (
    organization_id, branch_id, client_id, result_assessment_key,
    result_version_id
  );
create index nsi_nutrition_operations_reauth_idx
  on private.nsi_nutrition_screening_operations (reauth_challenge_id);

alter table public.nsi_nutrition_screening_versions enable row level security;
alter table public.nsi_nutrition_screening_versions force row level security;
alter table private.nsi_nutrition_screening_operations enable row level security;
alter table private.nsi_nutrition_screening_operations force row level security;

revoke all on table public.nsi_nutrition_screening_versions
  from public, anon, authenticated, service_role;
revoke all on table private.nsi_nutrition_screening_operations
  from public, anon, authenticated, service_role;

create or replace function private.nsi_nutrition_history_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'manual nutrition observation candidate history is append-only';
end;
$$;

create or replace function private.nsi_nutrition_current_authority(
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
      'nsi_nutrition_screenings.read', 'nsi_nutrition_screenings.manage',
      'nsi_nutrition_screenings.sign'
    )
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

create or replace function private.nsi_nutrition_client_authority(
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
  select private.nsi_nutrition_current_authority(
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

create or replace function private.require_nsi_nutrition_reauth_evidence(
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
      message = 'current same-session recent AAL2 evidence is required for manual nutrition observation draft writes';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for manual nutrition observation draft writes';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor
    and event.session_id = v_session_id
    and event.aal = 'aal2'
    and event.revoked_at is null
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
      message = 'current same-session recent AAL2 evidence is required for manual nutrition observation draft writes';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_nsi_nutrition_screening_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_answers jsonb,
  p_rule_version_id text,
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
  author_user_id uuid,
  service_status_at_assessment text,
  rule_version_id text,
  governance_status text,
  preview_status text,
  preview_observed_count integer,
  content_hash text,
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
  v_now timestamptz := clock_timestamp();
  v_request_hash text;
  v_operation private.nsi_nutrition_screening_operations%rowtype;
  v_previous public.nsi_nutrition_screening_versions%rowtype;
  v_result public.nsi_nutrition_screening_versions%rowtype;
  v_assessment_key uuid;
  v_version integer;
  v_author_display_name text;
  v_service_status text;
  v_rule_snapshot jsonb := private.nsi_nutrition_candidate_rule_snapshot();
  v_rule_hash text;
  v_preview jsonb;
  v_challenge_id uuid;
  v_content_hash text;
begin
  if p_action not in ('create_draft', 'revise_draft')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_idempotency_key is null
     or not private.nsi_nutrition_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'nsi_nutrition_screenings.read'
     )
     or not private.nsi_nutrition_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'nsi_nutrition_screenings.manage'
    ) then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation candidate operation is not permitted';
  end if;

  v_challenge_id := private.require_nsi_nutrition_reauth_evidence(v_actor, v_now);

  if p_action = 'create_draft' then
    if p_assessment_key is not null or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = '22023',
        message = 'new manual nutrition observation chain input is invalid';
    end if;
  elsif p_assessment_key is null or p_previous_version_id is null
        or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023',
      message = 'manual nutrition observation chain input is invalid';
  end if;

  if p_assessed_on is null
     or extract(year from p_assessed_on) not between 2000 and 2200
     or p_assessed_on > (v_now at time zone 'Asia/Taipei')::date
     or p_rule_version_id <> 'nsi-manual-nutrition-observations-candidate-v1'
     or not private.nsi_nutrition_answers_are_valid(p_answers) then
    raise exception using errcode = '22023',
      message = 'manual nutrition observation candidate payload is invalid';
  end if;

  v_preview := private.nsi_nutrition_trial_preview(p_answers);
  if v_preview ->> 'status' not in ('candidate_complete', 'incomplete') then
    raise exception using errcode = '22023',
      message = 'manual nutrition observation candidate replay could not be reproduced';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', p_assessment_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version,
    'assessed_on', p_assessed_on, 'answers', p_answers,
    'rule_version_id', p_rule_version_id
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'nsi_nutrition-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.nsi_nutrition_screening_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'manual nutrition observation idempotency conflict';
    end if;
    if not private.nsi_nutrition_client_authority(
      p_expected_organization_id, p_expected_branch_id,
      v_operation.client_id, 'nsi_nutrition_screenings.manage'
    ) then
      raise exception using errcode = '42501',
        message = 'manual nutrition observation replay is not permitted';
    end if;
    select version_row.* into strict v_result
    from public.nsi_nutrition_screening_versions version_row
    where version_row.id = v_operation.result_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_operation.result_assessment_key;
    return query select v_operation.id, v_result.client_id,
      v_result.assessment_key, v_result.id, v_result.version,
      v_result.record_state, v_result.assessed_on,
      v_result.author_user_id, v_result.service_status_at_assessment,
      v_result.rule_version_id, v_result.governance_status,
      v_result.preview_status, v_result.preview_observed_count,
      v_result.content_hash,
      v_operation.result_committed_at, true;
    return;
  end if;

  v_assessment_key := coalesce(p_assessment_key, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'nsi_nutrition-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || v_assessment_key::text, 0
  ));
  if p_action = 'revise_draft' then
    select version_row.* into v_previous
    from public.nsi_nutrition_screening_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_assessment_key
      and not exists (
        select 1 from public.nsi_nutrition_screening_versions child
        where child.previous_version_id = version_row.id
      )
    order by version_row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> p_previous_version_id
       or v_previous.version <> p_expected_version
       or v_previous.record_state <> 'draft_preview' then
      raise exception using errcode = '40001',
        message = 'manual nutrition observation candidate version is stale';
    end if;
  end if;

  select profile.display_name into v_author_display_name
  from public.profiles profile
  where profile.id = v_actor and profile.is_active
    and profile.kind in ('staff', 'professional');
  select client.status::text into v_service_status
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id;
  if v_author_display_name is null or v_service_status is null then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation author identity or client status is invalid';
  end if;
  v_version := case when p_action = 'create_draft'
    then 1 else v_previous.version + 1 end;
  v_rule_hash := encode(
    sha256(convert_to(v_rule_snapshot::text, 'UTF8')), 'hex'
  );
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'assessment_key', v_assessment_key, 'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_state', 'draft_preview', 'assessed_on', p_assessed_on,
    'author_user_id', v_actor,
    'service_status_at_assessment', v_service_status,
    'answers', p_answers,
    'rule_version_id', p_rule_version_id,
    'rule_snapshot_hash', v_rule_hash,
    'governance_status', 'candidate_unactivated',
    'preview', v_preview
  )::text, 'UTF8')), 'hex');

  if not private.nsi_nutrition_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'nsi_nutrition_screenings.manage'
  ) then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation authority expired';
  end if;

  insert into public.nsi_nutrition_screening_versions (
    organization_id, branch_id, client_id, assessment_key, version,
    previous_version_id, record_state, assessed_on, author_user_id,
    author_display_name, service_status_at_assessment, answers,
    rule_version_id, rule_snapshot,
    rule_snapshot_hash, governance_status, preview_status,
    preview_observed_count,
    write_reauth_challenge_id, content_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_assessment_key, v_version, p_previous_version_id, 'draft_preview',
    p_assessed_on, v_actor, v_author_display_name, v_service_status,
    p_answers, p_rule_version_id,
    v_rule_snapshot, v_rule_hash, 'candidate_unactivated',
    v_preview ->> 'status', (v_preview ->> 'observed_count')::integer,
    v_challenge_id, v_content_hash, v_now
  ) returning * into v_result;

  insert into private.nsi_nutrition_screening_operations (
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
    p_expected_organization_id, p_expected_branch_id, v_actor, 'insert',
    'nsi_nutrition_screening_versions', v_result.id::text, p_idempotency_key,
    array[
      'record_state', 'version', 'assessed_on',
      'service_status_at_assessment', 'answers',
      'rule_version_id', 'rule_snapshot',
      'preview_status'
    ],
    jsonb_build_object(
      'workflow', 'page14_nsi_nutrition_candidate_v1',
      'version', v_result.version,
      'state', v_result.record_state,
      'candidate_unactivated', true,
      'formal_score_created', false,
      'formal_risk_classification_created', false,
      'diagnosis_created', false,
      'signature_created', false,
      'follow_up_created', false,
      'referral_created', false,
      'notification_created', false,
      'answers_logged', false,
      'personal_data_logged', false,
      'filter_values_logged', false
    )
  );

  if not private.nsi_nutrition_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'nsi_nutrition_screenings.manage'
  ) or not exists (
    select 1 from public.nsi_nutrition_screening_versions version_row
    where version_row.id = v_result.id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.assessment_key = v_assessment_key
      and version_row.version = v_version
      and not exists (
        select 1 from public.nsi_nutrition_screening_versions child
        where child.previous_version_id = version_row.id
      )
  ) then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation final verification failed';
  end if;

  return query select v_operation.id, v_result.client_id,
    v_result.assessment_key, v_result.id, v_result.version,
    v_result.record_state, v_result.assessed_on,
    v_result.author_user_id, v_result.service_status_at_assessment,
    v_result.rule_version_id, v_result.governance_status,
    v_result.preview_status, v_result.preview_observed_count,
    v_result.content_hash,
    v_result.created_at, false;
end;
$$;

create or replace function public.create_nsi_nutrition_screening_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessed_on date,
  p_answers jsonb,
  p_rule_version_id text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  author_user_id uuid, service_status_at_assessment text,
  rule_version_id text, governance_status text, preview_status text,
  preview_observed_count integer,
  content_hash text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_nsi_nutrition_screening_guarded(
    'create_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, null, null, 0, p_assessed_on, p_answers, p_rule_version_id,
    p_idempotency_key
  );
$$;

create or replace function public.revise_nsi_nutrition_screening_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_answers jsonb,
  p_rule_version_id text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, client_id uuid, assessment_key uuid, version_id uuid,
  assessment_version integer, record_state text, assessed_on date,
  author_user_id uuid, service_status_at_assessment text,
  rule_version_id text, governance_status text, preview_status text,
  preview_observed_count integer,
  content_hash text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_nsi_nutrition_screening_guarded(
    'revise_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_assessment_key, p_previous_version_id,
    p_expected_version, p_assessed_on, p_answers, p_rule_version_id,
    p_idempotency_key
  );
$$;

create or replace function private.block_nsi_nutrition_signing_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns table(blocked boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_assessment_key is null
     or p_previous_version_id is null or p_expected_version is null
     or p_expected_version < 1 or p_idempotency_key is null
     or not private.nsi_nutrition_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'nsi_nutrition_screenings.read'
     )
     or not private.nsi_nutrition_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'nsi_nutrition_screenings.sign'
    ) then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation formal signing request is not permitted';
  end if;
  perform private.require_nsi_nutrition_reauth_evidence(v_actor, clock_timestamp());
  raise exception using errcode = '55000',
    message = 'formal NSI questionnaire, licensed source, weights, and risk classification are not activated; formal signing is blocked';
end;
$$;

create or replace function public.sign_nsi_nutrition_screening(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns table(blocked boolean)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.block_nsi_nutrition_signing_guarded(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_previous_version_id, p_expected_version,
    p_idempotency_key
  );
$$;

create trigger nsi_nutrition_screening_versions_append_only
before update or delete on public.nsi_nutrition_screening_versions
for each row execute function private.nsi_nutrition_history_is_append_only();
create trigger nsi_nutrition_screening_operations_append_only
before update or delete on private.nsi_nutrition_screening_operations
for each row execute function private.nsi_nutrition_history_is_append_only();
create trigger nsi_nutrition_screening_versions_audit_row_change
after insert on public.nsi_nutrition_screening_versions
for each row execute function private.audit_row_change();
create trigger nsi_nutrition_screening_operations_audit_row_change
after insert on private.nsi_nutrition_screening_operations
for each row execute function private.audit_row_change();

create or replace function private.nsi_nutrition_screening_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_preview_filter text,
  p_answer_filter text,
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
    from public.nsi_nutrition_screening_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and private.can_staff_access_client(version_row.client_id, 'clients.read')
      and private.can_staff_access_client(version_row.client_id, 'nsi_nutrition_screenings.read')
      and not exists (
        select 1 from public.nsi_nutrition_screening_versions child
        where child.previous_version_id = version_row.id
      )
  ),
  assigned_clients as materialized (
    select client.id, client.display_name, client.status::text as service_status,
      client.admitted_on, client.ended_on
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'nsi_nutrition_screenings.read')
  ),
  latest_by_client as materialized (
    select client.id as assigned_client_id, client.display_name,
      client.service_status, client.admitted_on, client.ended_on,
      latest.*
    from assigned_clients client
    left join lateral (
      select terminal.*
      from terminal_visible terminal
      where terminal.client_id = client.id
      order by terminal.assessed_on desc, terminal.created_at desc,
        terminal.assessment_key, terminal.version desc
      limit 1
    ) latest on true
  ),
  matching as materialized (
    select row.*
    from latest_by_client row
    where (p_client_id is null or row.assigned_client_id = p_client_id)
      and (
        p_preview_filter = 'all'
        or (p_preview_filter = 'candidate_complete'
          and row.preview_status = 'candidate_complete')
        or (p_preview_filter = 'incomplete'
          and row.preview_status = 'incomplete')
        or (p_preview_filter = 'not_assessed' and row.id is null)
      )
      and (p_answer_filter = 'all'
        or (p_answer_filter = 'all_answered' and row.id is not null
          and not exists (
            select 1 from jsonb_each(row.answers) answer
            where answer.value ->> 'state' <> 'answered'
          ))
        or (p_answer_filter = 'has_missing' and row.id is not null
          and exists (
            select 1 from jsonb_each(row.answers) answer
            where answer.value ->> 'state' = 'missing'
          ))
        or (p_answer_filter = 'has_not_applicable' and row.id is not null
          and exists (
            select 1 from jsonb_each(row.answers) answer
            where answer.value ->> 'state' = 'not_applicable'
          )))
  ),
  stats as (
    select count(*)::bigint as matching_total,
      count(*) filter (where id is null)::bigint as not_assessed_total,
      count(*) filter (
        where preview_status = 'candidate_complete'
      )::bigint as candidate_complete_total,
      count(*) filter (where preview_status = 'incomplete')::bigint
        as incomplete_total,
      count(*) filter (where id is not null)::bigint as draft_total
    from matching
  ),
  bounded as materialized (
    select * from matching
    order by display_name collate "C", assigned_client_id
    limit 200
  ),
  items_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', row.assigned_client_id,
      'client_display_name', row.display_name,
      'service_status', row.service_status,
      'admitted_on', row.admitted_on,
      'ended_on', row.ended_on,
      'version_id', row.id,
      'assessment_key', row.assessment_key,
      'assessment_version', row.version,
      'record_state', row.record_state,
      'assessed_on', row.assessed_on,
      'author_user_id', row.author_user_id,
      'author_display_name', row.author_display_name,
      'service_status_at_assessment', row.service_status_at_assessment,
      'answers', row.answers,
      'rule_version_id', row.rule_version_id,
      'rule_snapshot', row.rule_snapshot,
      'rule_snapshot_hash', row.rule_snapshot_hash,
      'governance_status', row.governance_status,
      'preview_status', row.preview_status,
      'preview_observed_count', row.preview_observed_count,
      'content_hash', row.content_hash,
      'created_at', row.created_at,
      'version_history', case when row.assessment_key is null then '[]'::jsonb
        else coalesce((
          select jsonb_agg(jsonb_build_object(
            'version_id', history.id,
            'assessment_version', history.version,
            'record_state', history.record_state,
            'assessed_on', history.assessed_on,
            'author_user_id', history.author_user_id,
            'author_display_name', history.author_display_name,
            'service_status_at_assessment',
              history.service_status_at_assessment,
            'answers', history.answers,
            'rule_version_id', history.rule_version_id,
            'rule_snapshot', history.rule_snapshot,
            'rule_snapshot_hash', history.rule_snapshot_hash,
            'governance_status', history.governance_status,
            'preview_status', history.preview_status,
            'preview_observed_count', history.preview_observed_count,
            'content_hash', history.content_hash,
            'created_at', history.created_at
          ) order by history.version desc)
          from (
            select version_row.*
            from public.nsi_nutrition_screening_versions version_row
            where version_row.organization_id = p_expected_organization_id
              and version_row.branch_id = p_expected_branch_id
              and version_row.client_id = row.assigned_client_id
              and version_row.assessment_key = row.assessment_key
            order by version_row.version desc limit 50
          ) history
        ), '[]'::jsonb) end,
      'version_history_total', case when row.assessment_key is null then 0
        else (
          select count(*)::integer
          from public.nsi_nutrition_screening_versions history_count
          where history_count.organization_id = p_expected_organization_id
            and history_count.branch_id = p_expected_branch_id
            and history_count.client_id = row.assigned_client_id
            and history_count.assessment_key = row.assessment_key
        ) end
    ) order by row.display_name collate "C", row.assigned_client_id), '[]'::jsonb)
      as items
    from bounded row
  ),
  client_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option_row.id,
      'display_name', option_row.display_name,
      'service_status', option_row.service_status,
      'admitted_on', option_row.admitted_on,
      'ended_on', option_row.ended_on
    ) order by option_row.display_name collate "C", option_row.id), '[]'::jsonb)
      as client_options,
      (select count(*)::bigint from assigned_clients) as client_total
    from (
      select * from assigned_clients
      order by display_name collate "C", id limit 500
    ) option_row
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'items', items_result.items,
    'item_total', jsonb_array_length(items_result.items),
    'matching_total', stats.matching_total,
    'items_truncated', stats.matching_total >
      jsonb_array_length(items_result.items),
    'not_assessed_total', stats.not_assessed_total,
    'candidate_complete_total', stats.candidate_complete_total,
    'incomplete_total', stats.incomplete_total,
    'draft_total', stats.draft_total,
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated', client_result.client_total >
      jsonb_array_length(client_result.client_options),
    'rule_version_id', 'nsi-manual-nutrition-observations-candidate-v1',
    'rule_activation_status', 'candidate_unactivated',
    'formal_sign_status', 'blocked_rule_not_activated',
    'formal_score_status', 'not_available',
    'formal_risk_classification_status', 'not_available',
    'diagnosis_status', 'blocked',
    'care_decision_status', 'blocked',
    'nutrition_follow_up_status', 'not_configured',
    'nutrition_referral_status', 'not_configured',
    'attachment_status', 'not_configured',
    'export_status', 'not_configured',
    'offline_sync_status', 'not_configured',
    'notification_status', 'not_configured'
  )
  from items_result cross join stats cross join client_result;
$$;

create or replace function private.nsi_nutrition_screening_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_preview_filter text,
  p_answer_filter text
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total integer,
  matching_total bigint,
  items_truncated boolean,
  not_assessed_total bigint,
  candidate_complete_total bigint,
  incomplete_total bigint,
  draft_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  rule_version_id text,
  rule_activation_status text,
  formal_sign_status text,
  formal_score_status text,
  formal_risk_classification_status text,
  diagnosis_status text,
  care_decision_status text,
  nutrition_follow_up_status text,
  nutrition_referral_status text,
  attachment_status text,
  export_status text,
  offline_sync_status text,
  notification_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_preview_filter text := lower(
    coalesce(nullif(btrim(p_preview_filter), ''), 'all')
  );
  v_answer_filter text := lower(
    coalesce(nullif(btrim(p_answer_filter), ''), 'all')
  );
  v_bundle jsonb;
  v_after jsonb;
  v_fingerprint text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_preview_filter not in (
       'all', 'candidate_complete', 'incomplete', 'not_assessed'
     )
     or v_answer_filter not in (
       'all', 'all_answered', 'has_missing', 'has_not_applicable'
     )
     or not private.nsi_nutrition_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'nsi_nutrition_screenings.read'
    ) then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation snapshot is not permitted';
  end if;
  if p_client_id is not null and not private.nsi_nutrition_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'nsi_nutrition_screenings.read'
  ) then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation client filter is not permitted';
  end if;

  v_bundle := private.nsi_nutrition_screening_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_preview_filter, v_answer_filter, v_now
  );
  v_fingerprint := encode(
    sha256(convert_to(v_bundle::text, 'UTF8')), 'hex'
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'nsi_nutrition_screening_versions', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page14_nsi_nutrition_candidate_v1',
      'item_count', (v_bundle ->> 'item_total')::integer,
      'matching_total', (v_bundle ->> 'matching_total')::bigint,
      'items_truncated', (v_bundle ->> 'items_truncated')::boolean,
      'item_limit', 200,
      'snapshot_fingerprint', v_fingerprint,
      'answers_logged', false,
      'personal_data_logged', false,
      'filter_values_logged', false,
      'formal_score_returned', false,
      'formal_risk_classification_returned', false,
      'diagnosis_returned', false,
      'follow_up_returned', false,
      'referral_returned', false,
      'notification_returned', false
    )
  );

  v_after := private.nsi_nutrition_screening_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_preview_filter, v_answer_filter, v_now
  );
  if not private.nsi_nutrition_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'nsi_nutrition_screenings.read'
  ) or v_after is distinct from v_bundle then
    raise exception using errcode = '42501',
      message = 'manual nutrition observation snapshot final verification failed';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    v_bundle -> 'items',
    (v_bundle ->> 'item_total')::integer,
    (v_bundle ->> 'matching_total')::bigint,
    (v_bundle ->> 'items_truncated')::boolean,
    (v_bundle ->> 'not_assessed_total')::bigint,
    (v_bundle ->> 'candidate_complete_total')::bigint,
    (v_bundle ->> 'incomplete_total')::bigint,
    (v_bundle ->> 'draft_total')::bigint,
    v_bundle -> 'client_options',
    (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'client_options_truncated')::boolean,
    v_bundle ->> 'rule_version_id',
    v_bundle ->> 'rule_activation_status',
    v_bundle ->> 'formal_sign_status',
    v_bundle ->> 'formal_score_status',
    v_bundle ->> 'formal_risk_classification_status',
    v_bundle ->> 'diagnosis_status',
    v_bundle ->> 'care_decision_status',
    v_bundle ->> 'nutrition_follow_up_status',
    v_bundle ->> 'nutrition_referral_status',
    v_bundle ->> 'attachment_status',
    v_bundle ->> 'export_status',
    v_bundle ->> 'offline_sync_status',
    v_bundle ->> 'notification_status';
end;
$$;

create or replace function public.nsi_nutrition_screening_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_preview_filter text default 'all',
  p_answer_filter text default 'all'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  items jsonb, item_total integer, matching_total bigint,
  items_truncated boolean, not_assessed_total bigint,
  candidate_complete_total bigint, incomplete_total bigint,
  draft_total bigint, client_options jsonb, client_total bigint,
  client_options_truncated boolean, rule_version_id text,
  rule_activation_status text, formal_sign_status text,
  formal_score_status text, formal_risk_classification_status text,
  diagnosis_status text,
  care_decision_status text, nutrition_follow_up_status text,
  nutrition_referral_status text,
  attachment_status text,
  export_status text, offline_sync_status text, notification_status text
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.nsi_nutrition_screening_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_preview_filter, p_answer_filter
  );
$$;

create policy nsi_nutrition_screening_versions_staff_select
on public.nsi_nutrition_screening_versions for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'nsi_nutrition_screenings.read')
);

revoke all on function private.nsi_nutrition_candidate_rule_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_answers_are_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_trial_preview(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_history_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_nsi_nutrition_reauth_evidence(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.block_nsi_nutrition_signing_guarded(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_nsi_nutrition_screening_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_screening_snapshot_bundle(uuid,uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.nsi_nutrition_screening_snapshot_response(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_nsi_nutrition_screening_draft(uuid,uuid,uuid,date,jsonb,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_nsi_nutrition_screening_draft(uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sign_nsi_nutrition_screening(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.nsi_nutrition_screening_snapshot(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_nsi_nutrition_screening_draft(uuid,uuid,uuid,date,jsonb,text,uuid)
  to authenticated;
grant execute on function public.revise_nsi_nutrition_screening_draft(uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)
  to authenticated;
grant execute on function public.sign_nsi_nutrition_screening(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function public.nsi_nutrition_screening_snapshot(uuid,uuid,uuid,text,text)
  to authenticated;

-- SECURITY INVOKER wrappers require only their exact guarded entry point.
grant execute on function private.mutate_nsi_nutrition_screening_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)
  to authenticated;
grant execute on function private.block_nsi_nutrition_signing_guarded(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function private.nsi_nutrition_screening_snapshot_response(uuid,uuid,uuid,text,text)
  to authenticated;

comment on function public.create_nsi_nutrition_screening_draft(uuid,uuid,uuid,date,jsonb,text,uuid)
is 'Creates an assigned-client manual nutrition observation candidate draft after recent AAL2; never creates a formal NSI result.';
comment on function public.sign_nsi_nutrition_screening(uuid,uuid,uuid,uuid,uuid,integer,uuid)
is 'Fail-closed formal-signing boundary while the candidate rule remains unactivated.';
comment on function public.nsi_nutrition_screening_snapshot(uuid,uuid,uuid,text,text)
is 'Page 14 assigned-client list and immutable candidate preview history; audit excludes answers, filter values, and personal data.';
