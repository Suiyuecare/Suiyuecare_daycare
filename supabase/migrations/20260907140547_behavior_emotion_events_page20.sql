-- Page 20: immutable, assigned-client behavior and emotion event records.
-- All narrative columns are entered explicitly by staff. No database routine
-- derives a diagnosis, field state, intervention, or outcome from free text.

insert into public.permissions (permission_key, description, risk_level) values
  ('behavior_events.read', 'Read assigned-client behavior and emotion events', 2),
  ('behavior_events.manage', 'Create and revise assigned-client behavior event drafts', 2),
  ('behavior_events.sign', 'Sign, correct or void assigned-client behavior events', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key in (
  'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
  'nurse', 'care_worker', 'professional'
) and permission.permission_key in (
  'behavior_events.read', 'behavior_events.manage', 'behavior_events.sign'
) on conflict (role_id, permission_id) do nothing;

create table public.behavior_event_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  event_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  content_hash text not null,
  event_state text not null,
  occurred_at timestamptz not null,
  event_type text not null,
  antecedent_state text not null,
  antecedent_text text,
  behavior_state text not null,
  behavior_text text,
  intervention_state text not null,
  intervention_text text,
  outcome_state text not null,
  outcome_text text,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  revision_reason text,
  correction_reason text,
  void_reason text,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  signer_display_name text,
  signer_role_keys text[],
  signature_purpose text,
  signature_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint behavior_event_versions_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint behavior_event_versions_id_scope_key unique (
    id, organization_id, branch_id, client_id, event_key
  ),
  constraint behavior_event_versions_chain_key unique (
    organization_id, branch_id, event_key, version
  ),
  constraint behavior_event_versions_previous_key unique (previous_version_id),
  constraint behavior_event_versions_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, client_id, event_key
  ) references public.behavior_event_versions (
    id, organization_id, branch_id, client_id, event_key
  ) on delete restrict,
  constraint behavior_event_versions_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null) or
      (version > 1 and previous_version_id is not null))
  ),
  constraint behavior_event_versions_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint behavior_event_versions_state_check check (
    event_state in ('draft', 'signed', 'corrected', 'voided')
  ),
  constraint behavior_event_versions_time_check check (
    extract(year from occurred_at at time zone 'Asia/Taipei') between 2000 and 2200
    and occurred_at <= created_at + interval '5 minutes'
  ),
  constraint behavior_event_versions_type_check check (
    char_length(event_type) between 1 and 120 and event_type = btrim(event_type)
    and event_type !~ '[[:cntrl:]]'
  ),
  constraint behavior_event_versions_author_check check (
    char_length(author_display_name) between 1 and 160
    and author_display_name = btrim(author_display_name)
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint behavior_event_versions_antecedent_check check (
    antecedent_state in ('recorded', 'missing', 'not_applicable') and
    ((antecedent_state = 'recorded' and antecedent_text is not null and
      char_length(antecedent_text) between 1 and 4000 and antecedent_text = btrim(antecedent_text) and
      translate(antecedent_text, E'\n\r\t', '') !~ '[[:cntrl:]]') or
     (antecedent_state <> 'recorded' and antecedent_text is null))
  ),
  constraint behavior_event_versions_behavior_check check (
    behavior_state in ('recorded', 'missing', 'not_applicable') and
    ((behavior_state = 'recorded' and behavior_text is not null and
      char_length(behavior_text) between 1 and 4000 and behavior_text = btrim(behavior_text) and
      translate(behavior_text, E'\n\r\t', '') !~ '[[:cntrl:]]') or
     (behavior_state <> 'recorded' and behavior_text is null))
  ),
  constraint behavior_event_versions_intervention_check check (
    intervention_state in ('recorded', 'missing', 'not_applicable') and
    ((intervention_state = 'recorded' and intervention_text is not null and
      char_length(intervention_text) between 1 and 4000 and intervention_text = btrim(intervention_text) and
      translate(intervention_text, E'\n\r\t', '') !~ '[[:cntrl:]]') or
     (intervention_state <> 'recorded' and intervention_text is null))
  ),
  constraint behavior_event_versions_outcome_check check (
    outcome_state in ('recorded', 'missing', 'not_applicable') and
    ((outcome_state = 'recorded' and outcome_text is not null and
      char_length(outcome_text) between 1 and 4000 and outcome_text = btrim(outcome_text) and
      translate(outcome_text, E'\n\r\t', '') !~ '[[:cntrl:]]') or
     (outcome_state <> 'recorded' and outcome_text is null))
  ),
  constraint behavior_event_versions_signature_check check (
    (event_state = 'draft' and revision_reason is not null and correction_reason is null
      and void_reason is null and signed_at is null and signed_by is null
      and signer_display_name is null and signer_role_keys is null
      and signature_purpose is null and signature_reauth_challenge_id is null) or
    (event_state = 'signed' and revision_reason is null and correction_reason is null
      and void_reason is null and signed_at is not null and signed_by is not null
      and signer_display_name is not null and signer_role_keys is not null
      and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = '行為與情緒事件簽署'
      and signature_reauth_challenge_id is not null) or
    (event_state = 'corrected' and revision_reason is null and correction_reason is not null
      and void_reason is null and signed_at is not null and signed_by is not null
      and signer_display_name is not null and signer_role_keys is not null
      and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = '行為與情緒事件更正簽署'
      and signature_reauth_challenge_id is not null) or
    (event_state = 'voided' and revision_reason is null and correction_reason is null
      and void_reason is not null and signed_at is not null and signed_by is not null
      and signer_display_name is not null and signer_role_keys is not null
      and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = '行為與情緒事件作廢簽署'
      and signature_reauth_challenge_id is not null)
  ),
  constraint behavior_event_versions_reason_check check (
    (revision_reason is null or (char_length(revision_reason) between 1 and 1000 and
      revision_reason = btrim(revision_reason) and translate(revision_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')) and
    (correction_reason is null or (char_length(correction_reason) between 8 and 1000 and
      correction_reason = btrim(correction_reason) and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')) and
    (void_reason is null or (char_length(void_reason) between 8 and 1000 and
      void_reason = btrim(void_reason) and translate(void_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  )
);

comment on table public.behavior_event_versions is
  'Immutable Page-20 event versions. Four narrative fields are explicit staff input and must never be inferred.';
comment on column public.behavior_event_versions.occurred_at is
  'Actual event occurrence time used for all timeline ordering, never created_at.';

create table private.behavior_event_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  decision text,
  result_event_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_state text not null,
  result_content_hash text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint behavior_event_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint behavior_event_operations_result_scope_fkey foreign key (
    result_version_id, organization_id, branch_id, client_id, result_event_key
  ) references public.behavior_event_versions (
    id, organization_id, branch_id, client_id, event_key
  ) on delete restrict,
  constraint behavior_event_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and result_content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint behavior_event_operations_action_check check (
    action in ('save_event', 'finalize_event', 'correct_event')
  ),
  constraint behavior_event_operations_decision_check check (
    (action = 'finalize_event' and decision in ('sign', 'void')) or
    (action <> 'finalize_event' and decision is null)
  ),
  constraint behavior_event_operations_state_check check (
    result_version > 0 and result_state in ('draft', 'signed', 'corrected', 'voided') and
    ((action = 'save_event' and result_state = 'draft' and reauth_challenge_id is null) or
     (action = 'finalize_event' and result_state = case when decision = 'sign' then 'signed' else 'voided' end
       and reauth_challenge_id is not null) or
     (action = 'correct_event' and result_state = 'corrected' and reauth_challenge_id is not null))
  )
);

create index behavior_event_scope_occurred_idx on public.behavior_event_versions (
  organization_id, branch_id, occurred_at desc, event_key, version desc
);
create index behavior_event_client_occurred_idx on public.behavior_event_versions (
  client_id, occurred_at desc, event_key, version desc
);
create index behavior_event_previous_idx on public.behavior_event_versions (previous_version_id)
  where previous_version_id is not null;
create index behavior_event_author_idx on public.behavior_event_versions (author_user_id);
create index behavior_event_signed_by_idx on public.behavior_event_versions (signed_by)
  where signed_by is not null;
create index behavior_event_reauth_idx on public.behavior_event_versions (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index behavior_event_operations_result_idx on private.behavior_event_operations (
  organization_id, branch_id, client_id, result_event_key, result_version
);
create index behavior_event_operations_result_version_idx
  on private.behavior_event_operations (result_version_id);
create index behavior_event_operations_reauth_idx on private.behavior_event_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.behavior_event_versions enable row level security;
alter table public.behavior_event_versions force row level security;
alter table private.behavior_event_operations enable row level security;
alter table private.behavior_event_operations force row level security;
revoke all on table public.behavior_event_versions from public, anon, authenticated, service_role;
revoke all on table private.behavior_event_operations from public, anon, authenticated, service_role;

create or replace function private.behavior_event_history_is_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'behavior-event history is append-only';
end;
$$;
create trigger behavior_event_versions_append_only before update or delete
  on public.behavior_event_versions for each row
  execute function private.behavior_event_history_is_append_only();
create trigger behavior_event_operations_append_only before update or delete
  on private.behavior_event_operations for each row
  execute function private.behavior_event_history_is_append_only();
create trigger behavior_event_versions_audit_row_change after insert
  on public.behavior_event_versions for each row execute function private.audit_row_change();
create trigger behavior_event_operations_audit_row_change after insert
  on private.behavior_event_operations for each row execute function private.audit_row_change();

create or replace function private.behavior_event_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.profiles profile where profile.id = auth.uid()
      and profile.kind in ('staff', 'professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id and branch.is_active)
    and private.has_permission(p_expected_organization_id, p_expected_branch_id, p_permission);
$$;

create or replace function private.behavior_event_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.behavior_event_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission)
    and exists (select 1 from public.clients client where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id)
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.require_behavior_event_reauth(
  p_actor uuid, p_reference_time timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end if;
  begin v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event join private.reauth_challenges challenge
    on challenge.id = event.challenge_id and challenge.user_id = event.user_id
    and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id and event.aal = 'aal2'
    and event.revoked_at is null and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.behavior_event_field_valid(p_field jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_field) = 'object'
    and p_field ?& array['state', 'text']
    and p_field - array['state', 'text'] = '{}'::jsonb
    and p_field ->> 'state' in ('recorded', 'missing', 'not_applicable')
    and ((p_field ->> 'state' = 'recorded' and jsonb_typeof(p_field -> 'text') = 'string'
      and char_length(btrim(p_field ->> 'text')) between 1 and 4000
      and translate(btrim(p_field ->> 'text'), E'\n\r\t', '') !~ '[[:cntrl:]]')
      or (p_field ->> 'state' <> 'recorded' and p_field -> 'text' = 'null'::jsonb));
$$;

create or replace function private.mutate_behavior_event_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_payload jsonb, p_idempotency_key uuid
) returns table(operation_id uuid, action text, decision text, event_key uuid,
  version_id uuid, version integer, event_state text, content_hash text,
  committed_at timestamptz, replayed boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_permission text; v_client_id uuid; v_event_key uuid; v_previous_id uuid;
  v_expected_version integer; v_expected_hash text; v_mode text; v_decision text;
  v_reason text; v_occurred_at timestamptz; v_event_type text;
  v_request_hash text; v_challenge_id uuid; v_author_id uuid; v_author_name text;
  v_signer_name text; v_signer_roles text[]; v_state text; v_version integer;
  v_antecedent_state text; v_antecedent_text text; v_behavior_state text; v_behavior_text text;
  v_intervention_state text; v_intervention_text text; v_outcome_state text; v_outcome_text text;
  v_content_hash text; v_operation private.behavior_event_operations%rowtype;
  v_previous public.behavior_event_versions%rowtype; v_result public.behavior_event_versions%rowtype;
begin
  if p_action not in ('save_event', 'finalize_event', 'correct_event')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_idempotency_key is null then
    raise exception using errcode = '42501', message = 'behavior-event operation is not permitted';
  end if;
  v_permission := case when p_action = 'save_event' then 'behavior_events.manage' else 'behavior_events.sign' end;
  if not private.behavior_event_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'behavior_events.read')
     or not private.behavior_event_current_authority(
       p_expected_organization_id, p_expected_branch_id, v_permission) then
    raise exception using errcode = '42501', message = 'behavior-event operation is not permitted';
  end if;

  begin
    v_client_id := nullif(p_payload ->> 'client_id', '')::uuid;
    v_event_key := nullif(p_payload ->> 'event_key', '')::uuid;
    v_previous_id := nullif(p_payload ->> 'previous_version_id', '')::uuid;
    v_expected_version := (p_payload ->> 'expected_version')::integer;
    v_expected_hash := nullif(p_payload ->> 'expected_content_hash', '');
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'behavior-event identifiers are invalid';
  end;
  if v_client_id is null or not private.behavior_event_client_authority(
       p_expected_organization_id, p_expected_branch_id, v_client_id, 'behavior_events.read')
     or not private.behavior_event_client_authority(
       p_expected_organization_id, p_expected_branch_id, v_client_id, v_permission) then
    raise exception using errcode = '42501', message = 'behavior-event client is not permitted';
  end if;

  if p_action = 'save_event' then
    if not p_payload ?& array['mode','event_key','previous_version_id','expected_version',
      'expected_content_hash','client_id','occurred_at','event_type','antecedent','behavior',
      'intervention','outcome','reason'] or p_payload - array['mode','event_key','previous_version_id',
      'expected_version','expected_content_hash','client_id','occurred_at','event_type','antecedent',
      'behavior','intervention','outcome','reason'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'behavior-event payload shape is invalid';
    end if;
    v_mode := p_payload ->> 'mode'; v_reason := nullif(btrim(p_payload ->> 'reason'), '');
    if v_mode not in ('create','revise') or v_reason is null or char_length(v_reason) > 1000 then
      raise exception using errcode = '22023', message = 'behavior-event draft mode or reason is invalid';
    end if;
  elsif p_action = 'finalize_event' then
    if not p_payload ?& array['decision','client_id','event_key','previous_version_id',
      'expected_version','expected_content_hash','reason'] or p_payload - array['decision','client_id',
      'event_key','previous_version_id','expected_version','expected_content_hash','reason'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'behavior-event finalize payload shape is invalid';
    end if;
    v_decision := p_payload ->> 'decision'; v_reason := nullif(btrim(p_payload ->> 'reason'), '');
    if v_decision not in ('sign','void') or (v_decision = 'sign' and v_reason is not null) or
      (v_decision = 'void' and (v_reason is null or char_length(v_reason) not between 8 and 1000)) then
      raise exception using errcode = '22023', message = 'behavior-event decision or reason is invalid';
    end if;
  else
    if not p_payload ?& array['client_id','event_key','previous_version_id','expected_version',
      'expected_content_hash','occurred_at','event_type','antecedent','behavior','intervention','outcome','reason']
      or p_payload - array['client_id','event_key','previous_version_id','expected_version',
      'expected_content_hash','occurred_at','event_type','antecedent','behavior','intervention','outcome','reason'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'behavior-event correction payload shape is invalid';
    end if;
    v_reason := nullif(btrim(p_payload ->> 'reason'), '');
    if v_reason is null or char_length(v_reason) not between 8 and 1000 then
      raise exception using errcode = '22023', message = 'behavior-event correction reason is invalid';
    end if;
  end if;
  if v_reason is not null and translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'behavior-event reason is invalid';
  end if;

  if p_action in ('save_event','correct_event') then
    begin v_occurred_at := (p_payload ->> 'occurred_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'behavior-event occurrence time is invalid';
    end;
    v_event_type := btrim(p_payload ->> 'event_type');
    if v_occurred_at is null or extract(year from v_occurred_at at time zone 'Asia/Taipei') not between 2000 and 2200
      or v_occurred_at > v_now + interval '5 minutes' or v_event_type is null
      or char_length(v_event_type) not between 1 and 120 or v_event_type ~ '[[:cntrl:]]'
      or not private.behavior_event_field_valid(p_payload -> 'antecedent')
      or not private.behavior_event_field_valid(p_payload -> 'behavior')
      or not private.behavior_event_field_valid(p_payload -> 'intervention')
      or not private.behavior_event_field_valid(p_payload -> 'outcome') then
      raise exception using errcode = '22023', message = 'behavior-event manual fields are invalid';
    end if;
    v_antecedent_state := p_payload -> 'antecedent' ->> 'state';
    v_antecedent_text := case when v_antecedent_state = 'recorded' then btrim(p_payload -> 'antecedent' ->> 'text') end;
    v_behavior_state := p_payload -> 'behavior' ->> 'state';
    v_behavior_text := case when v_behavior_state = 'recorded' then btrim(p_payload -> 'behavior' ->> 'text') end;
    v_intervention_state := p_payload -> 'intervention' ->> 'state';
    v_intervention_text := case when v_intervention_state = 'recorded' then btrim(p_payload -> 'intervention' ->> 'text') end;
    v_outcome_state := p_payload -> 'outcome' ->> 'state';
    v_outcome_text := case when v_outcome_state = 'recorded' then btrim(p_payload -> 'outcome' ->> 'text') end;
  end if;

  if p_action = 'save_event' and v_mode = 'create' then
    if v_event_key is not null or v_previous_id is not null or coalesce(v_expected_version, -1) <> 0
      or v_expected_hash is not null then
      raise exception using errcode = '22023', message = 'new behavior-event chain baseline is invalid';
    end if;
  elsif v_event_key is null or v_previous_id is null or coalesce(v_expected_version, 0) < 1
    or v_expected_hash is null or v_expected_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'behavior-event version baseline is invalid';
  end if;

  if p_action in ('finalize_event','correct_event') then
    v_challenge_id := private.require_behavior_event_reauth(v_actor, v_now);
  end if;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'action',p_action,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'payload',p_payload
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'behavior-event-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select operation.* into v_operation from private.behavior_event_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'behavior-event idempotency conflict';
    end if;
    if not private.behavior_event_client_authority(p_expected_organization_id,
      p_expected_branch_id, v_operation.client_id, v_permission) then
      raise exception using errcode = '42501', message = 'behavior-event replay is not permitted';
    end if;
    return query select v_operation.id, v_operation.action, v_operation.decision,
      v_operation.result_event_key, v_operation.result_version_id,
      v_operation.result_version, v_operation.result_state,
      v_operation.result_content_hash, v_operation.result_committed_at, true;
    return;
  end if;

  v_event_key := coalesce(v_event_key, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'behavior-event-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || v_event_key::text, 0));
  if not (p_action = 'save_event' and v_mode = 'create') then
    select row.* into v_previous from public.behavior_event_versions row
    where row.organization_id = p_expected_organization_id and row.branch_id = p_expected_branch_id
      and row.client_id = v_client_id and row.event_key = v_event_key
      and not exists (select 1 from public.behavior_event_versions child where child.previous_version_id = row.id)
    order by row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> v_previous_id
      or v_previous.version <> v_expected_version or v_previous.content_hash <> v_expected_hash then
      raise exception using errcode = '40001', message = 'behavior-event version is stale';
    end if;
  end if;

  if p_action = 'save_event' then
    if v_mode = 'revise' and v_previous.event_state <> 'draft' then
      raise exception using errcode = '23514', message = 'only a draft behavior event can be revised';
    end if;
    v_state := 'draft'; v_version := coalesce(v_previous.version, 0) + 1;
    if v_mode = 'create' then
      v_author_id := v_actor;
      select profile.display_name into v_author_name from public.profiles profile
      where profile.id = v_actor and profile.is_active;
    else v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name; end if;
  elsif p_action = 'correct_event' then
    if v_previous.event_state not in ('signed','corrected') then
      raise exception using errcode = '23514', message = 'only signed behavior event content can be corrected';
    end if;
    v_state := 'corrected'; v_version := v_previous.version + 1;
    v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name;
  else
    if (v_decision = 'sign' and v_previous.event_state <> 'draft') or
      (v_decision = 'void' and v_previous.event_state not in ('signed','corrected')) then
      raise exception using errcode = '23514', message = 'behavior-event decision is invalid for current state';
    end if;
    v_state := case when v_decision = 'sign' then 'signed' else 'voided' end;
    v_version := v_previous.version + 1; v_author_id := v_previous.author_user_id;
    v_author_name := v_previous.author_display_name; v_occurred_at := v_previous.occurred_at;
    v_event_type := v_previous.event_type; v_antecedent_state := v_previous.antecedent_state;
    v_antecedent_text := v_previous.antecedent_text; v_behavior_state := v_previous.behavior_state;
    v_behavior_text := v_previous.behavior_text; v_intervention_state := v_previous.intervention_state;
    v_intervention_text := v_previous.intervention_text; v_outcome_state := v_previous.outcome_state;
    v_outcome_text := v_previous.outcome_text;
  end if;
  if v_author_name is null then raise exception using errcode = '42501', message = 'behavior-event author identity is invalid'; end if;
  if v_state <> 'draft' then
    select profile.display_name into v_signer_name from public.profiles profile
      where profile.id = v_actor and profile.is_active;
    select coalesce(array_agg(distinct role.role_key order by role.role_key),'{}'::text[])
      into v_signer_roles from public.memberships membership
      join public.membership_roles membership_role on membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id and role.is_active
      where membership.profile_id = v_actor and membership.organization_id = p_expected_organization_id
        and membership.status = 'active' and membership.starts_at <= v_now
        and (membership.ends_at is null or membership.ends_at > v_now)
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and (role.organization_id is null or role.organization_id = p_expected_organization_id);
    if v_signer_name is null or cardinality(v_signer_roles) = 0 then
      raise exception using errcode = '42501', message = 'behavior-event signer identity is invalid';
    end if;
  end if;
  if not private.behavior_event_client_authority(p_expected_organization_id,
    p_expected_branch_id, v_client_id, v_permission) then
    raise exception using errcode = '42501', message = 'behavior-event authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'client_id',v_client_id,'event_key',v_event_key,'version',v_version,
    'previous_version_id',v_previous_id,'event_state',v_state,'occurred_at',v_occurred_at,
    'event_type',v_event_type,'antecedent',jsonb_build_object('state',v_antecedent_state,'text',v_antecedent_text),
    'behavior',jsonb_build_object('state',v_behavior_state,'text',v_behavior_text),
    'intervention',jsonb_build_object('state',v_intervention_state,'text',v_intervention_text),
    'outcome',jsonb_build_object('state',v_outcome_state,'text',v_outcome_text),
    'author_user_id',v_author_id,'reason',v_reason,'signed_by',case when v_state='draft' then null else v_actor end,
    'signed_at',case when v_state='draft' then null else v_now end
  )::text,'UTF8')),'hex');
  insert into public.behavior_event_versions (
    organization_id,branch_id,client_id,event_key,version,previous_version_id,content_hash,event_state,
    occurred_at,event_type,antecedent_state,antecedent_text,behavior_state,behavior_text,
    intervention_state,intervention_text,outcome_state,outcome_text,author_user_id,author_display_name,
    revision_reason,correction_reason,void_reason,signed_at,signed_by,signer_display_name,signer_role_keys,
    signature_purpose,signature_reauth_challenge_id,created_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_event_key,v_version,v_previous_id,
    v_content_hash,v_state,v_occurred_at,v_event_type,v_antecedent_state,v_antecedent_text,
    v_behavior_state,v_behavior_text,v_intervention_state,v_intervention_text,v_outcome_state,v_outcome_text,
    v_author_id,v_author_name,case when v_state='draft' then v_reason end,
    case when v_state='corrected' then v_reason end,case when v_state='voided' then v_reason end,
    case when v_state='draft' then null else v_now end,case when v_state='draft' then null else v_actor end,
    case when v_state='draft' then null else v_signer_name end,case when v_state='draft' then null else v_signer_roles end,
    case when v_state='signed' then '行為與情緒事件簽署' when v_state='corrected' then '行為與情緒事件更正簽署'
      when v_state='voided' then '行為與情緒事件作廢簽署' end,v_challenge_id,v_now
  ) returning * into v_result;
  insert into private.behavior_event_operations (
    organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_hash,action,decision,
    result_event_key,result_version_id,result_version,result_state,result_content_hash,result_committed_at,
    reauth_challenge_id
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_actor,p_idempotency_key,v_request_hash,
    p_action,v_decision,v_result.event_key,v_result.id,v_result.version,v_result.event_state,
    v_result.content_hash,v_result.created_at,v_challenge_id
  ) returning * into v_operation;
  insert into public.audit_events (organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    idempotency_key,changed_fields,metadata) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,
    case when v_state='draft' then 'insert' when v_state in ('corrected','voided') then 'correct'
      else 'sign' end,
    'behavior_event_versions',v_result.id::text,p_idempotency_key,
    array['event_state','version','occurred_at','event_type','antecedent_state','behavior_state',
      'intervention_state','outcome_state'],
    jsonb_build_object('workflow','page20_behavior_event_v1','event_key',v_result.event_key,
      'version',v_result.version,'state',v_result.event_state,'client_id',v_client_id,
      'contains_narrative',true,'narrative_logged',false)
  );
  if not private.behavior_event_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_client_id,v_permission)
    or not exists (select 1 from public.behavior_event_versions row where row.id=v_result.id
      and not exists (select 1 from public.behavior_event_versions child where child.previous_version_id=row.id)) then
    raise exception using errcode = '42501', message = 'behavior-event final verification failed';
  end if;
  return query select v_operation.id,v_operation.action,v_operation.decision,
    v_result.event_key,v_result.id,v_result.version,v_result.event_state,
    v_result.content_hash,v_result.created_at,false;
end;
$$;

create or replace function public.mutate_behavior_event(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_payload jsonb, p_idempotency_key uuid
) returns table(operation_id uuid, action text, decision text, event_key uuid,
  version_id uuid, version integer, event_state text, content_hash text,
  committed_at timestamptz, replayed boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_behavior_event_guarded(p_expected_organization_id,
    p_expected_branch_id,p_action,p_payload,p_idempotency_key);
$$;

create or replace function private.behavior_event_snapshot_response(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_date_from date default null, p_date_to date default null,
  p_client_id uuid default null, p_event_type text default null,
  p_event_state text default null
) returns table(organization_id uuid, branch_id uuid, generated_at timestamptz,
  events jsonb, matching_total bigint, events_truncated boolean,
  event_total bigint, missing_field_total bigint, draft_total bigint,
  signed_total bigint, voided_total bigint, clients jsonb, client_total bigint,
  clients_truncated boolean, event_types jsonb, event_type_total bigint,
  event_types_truncated boolean, attachment_status text, notification_status text,
  export_status text, offline_status text)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_total bigint; v_clients_total bigint; v_types_total bigint;
begin
  if not private.behavior_event_current_authority(p_expected_organization_id,
      p_expected_branch_id,'behavior_events.read')
    or (p_client_id is not null and not private.behavior_event_client_authority(
      p_expected_organization_id,p_expected_branch_id,p_client_id,'behavior_events.read'))
    or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
    or (p_event_type is not null and (char_length(btrim(p_event_type)) not between 1 and 120
      or btrim(p_event_type) ~ '[[:cntrl:]]'))
    or (p_event_state is not null and p_event_state not in ('draft','signed','corrected','voided')) then
    raise exception using errcode = '42501', message = 'behavior-event snapshot is not permitted';
  end if;
  return query
  with recursive current_events as (
    select row.* from public.behavior_event_versions row
    where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
      and private.can_staff_access_client(row.client_id,'clients.read')
      and private.can_staff_access_client(row.client_id,'behavior_events.read')
      and not exists (select 1 from public.behavior_event_versions child where child.previous_version_id=row.id)
  ), matching as (
    select row.* from current_events row where
      (p_date_from is null or (row.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or (row.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (p_client_id is null or row.client_id=p_client_id)
      and (p_event_type is null or row.event_type=btrim(p_event_type))
      and (p_event_state is null or row.event_state=p_event_state)
  ), page as (
    select row.* from matching row order by row.occurred_at desc,row.event_key limit 200
  ), client_options as (
    select client.id,client.display_name from public.clients client
    where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
      and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'behavior_events.read')
    order by client.display_name,client.id limit 200
  ), type_options as (
    select distinct row.event_type from current_events row order by row.event_type limit 200
  )
  select p_expected_organization_id,p_expected_branch_id,v_now,
    coalesce((select jsonb_agg(jsonb_build_object(
      'version_id',row.id,'event_key',row.event_key,'version',row.version,
      'previous_version_id',row.previous_version_id,'content_hash',row.content_hash,
      'event_state',row.event_state,'client_id',row.client_id,'client_display_name',client.display_name,
      'occurred_at',row.occurred_at,'event_type',row.event_type,
      'antecedent_state',row.antecedent_state,'antecedent_text',row.antecedent_text,
      'behavior_state',row.behavior_state,'behavior_text',row.behavior_text,
      'intervention_state',row.intervention_state,'intervention_text',row.intervention_text,
      'outcome_state',row.outcome_state,'outcome_text',row.outcome_text,
      'author_user_id',row.author_user_id,'author_display_name',row.author_display_name,
      'correction_reason',row.correction_reason,'void_reason',row.void_reason,
      'signed_at',row.signed_at,'signed_by_user_id',row.signed_by,
      'signer_display_name',row.signer_display_name,'signer_role_keys',row.signer_role_keys,
      'signature_purpose',row.signature_purpose,
      'signature_reauth_challenge_id',row.signature_reauth_challenge_id,'created_at',row.created_at,
      'history',coalesce((select jsonb_agg(jsonb_build_object(
        'version_id',history.id,'event_key',history.event_key,'version',history.version,
        'previous_version_id',history.previous_version_id,'content_hash',history.content_hash,
        'event_state',history.event_state,'client_id',history.client_id,'client_display_name',client.display_name,
        'occurred_at',history.occurred_at,'event_type',history.event_type,
        'antecedent_state',history.antecedent_state,'antecedent_text',history.antecedent_text,
        'behavior_state',history.behavior_state,'behavior_text',history.behavior_text,
        'intervention_state',history.intervention_state,'intervention_text',history.intervention_text,
        'outcome_state',history.outcome_state,'outcome_text',history.outcome_text,
        'author_user_id',history.author_user_id,'author_display_name',history.author_display_name,
        'correction_reason',history.correction_reason,'void_reason',history.void_reason,
        'signed_at',history.signed_at,'signed_by_user_id',history.signed_by,
        'signer_display_name',history.signer_display_name,'signer_role_keys',history.signer_role_keys,
        'signature_purpose',history.signature_purpose,
        'signature_reauth_challenge_id',history.signature_reauth_challenge_id,
        'created_at',history.created_at) order by history.version)
        from (select item.* from public.behavior_event_versions item
          where item.organization_id=row.organization_id and item.branch_id=row.branch_id
            and item.client_id=row.client_id and item.event_key=row.event_key
          order by item.version limit 50) history),'[]'::jsonb),
      'history_total',(select count(*) from public.behavior_event_versions history
        where history.organization_id=row.organization_id and history.branch_id=row.branch_id
          and history.client_id=row.client_id and history.event_key=row.event_key)
    ) order by row.occurred_at desc,row.event_key) from page row join public.clients client on client.id=row.client_id),'[]'::jsonb),
    (select count(*) from matching),(select count(*) from matching)>200,
    (select count(*) from matching),
    (select count(*) from matching row where 'missing' in
      (row.antecedent_state,row.behavior_state,row.intervention_state,row.outcome_state)),
    (select count(*) from matching row where row.event_state='draft'),
    (select count(*) from matching row where row.event_state in ('signed','corrected')),
    (select count(*) from matching row where row.event_state='voided'),
    coalesce((select jsonb_agg(jsonb_build_object('client_id',option.id,'display_name',option.display_name)
      order by option.display_name,option.id) from client_options option),'[]'::jsonb),
    (select count(*) from public.clients client where client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'behavior_events.read')),
    (select count(*) from public.clients client where client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'behavior_events.read'))>200,
    coalesce((select jsonb_agg(option.event_type order by option.event_type) from type_options option),'[]'::jsonb),
    (select count(distinct row.event_type) from current_events row),
    (select count(distinct row.event_type) from current_events row)>200,
    'not_configured','not_configured','not_configured','not_configured';
  get diagnostics v_total = row_count;
  insert into public.audit_events (organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    changed_fields,metadata) values (p_expected_organization_id,p_expected_branch_id,v_actor,'select',
      'behavior_event_versions','snapshot',array[]::text[],jsonb_build_object(
      'workflow','page20_behavior_event_snapshot_v1','narrative_logged',false,'filters_logged',false));
  if not private.behavior_event_current_authority(p_expected_organization_id,
      p_expected_branch_id,'behavior_events.read') then
    raise exception using errcode='42501',message='behavior-event snapshot authority expired';
  end if;
end;
$$;

create or replace function public.behavior_event_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_date_from date default null, p_date_to date default null,
  p_client_id uuid default null, p_event_type text default null,
  p_event_state text default null
) returns table(organization_id uuid, branch_id uuid, generated_at timestamptz,
  events jsonb, matching_total bigint, events_truncated boolean,
  event_total bigint, missing_field_total bigint, draft_total bigint,
  signed_total bigint, voided_total bigint, clients jsonb, client_total bigint,
  clients_truncated boolean, event_types jsonb, event_type_total bigint,
  event_types_truncated boolean, attachment_status text, notification_status text,
  export_status text, offline_status text)
language sql volatile security invoker set search_path = '' as $$
  select * from private.behavior_event_snapshot_response(p_expected_organization_id,
    p_expected_branch_id,p_date_from,p_date_to,p_client_id,p_event_type,p_event_state);
$$;

revoke all on function private.behavior_event_history_is_append_only() from public,anon,authenticated,service_role;
revoke all on function private.behavior_event_current_authority(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.behavior_event_client_authority(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.require_behavior_event_reauth(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.behavior_event_field_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.mutate_behavior_event_guarded(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
revoke all on function private.behavior_event_snapshot_response(uuid,uuid,date,date,uuid,text,text) from public,anon,service_role;
revoke all on function public.mutate_behavior_event(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
revoke all on function public.behavior_event_snapshot(uuid,uuid,date,date,uuid,text,text) from public,anon,service_role;
grant execute on function private.mutate_behavior_event_guarded(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function private.behavior_event_snapshot_response(uuid,uuid,date,date,uuid,text,text) to authenticated;
grant execute on function public.mutate_behavior_event(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.behavior_event_snapshot(uuid,uuid,date,date,uuid,text,text) to authenticated;
