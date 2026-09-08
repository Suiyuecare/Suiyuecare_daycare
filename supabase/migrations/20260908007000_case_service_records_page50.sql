-- Page 50: immutable, assigned-client local manual service narratives.
-- This workflow does not create service_events, change claim eligibility, or
-- claim that the local narrative is an approved statutory form.

insert into public.permissions (permission_key, description, risk_level) values
  ('case_service_records.read', 'Read assigned-client local manual service narratives', 2),
  ('case_service_records.manage', 'Create and revise assigned-client local manual service narrative drafts', 2),
  ('case_service_records.sign', 'Sign or correct assigned-client local manual service narratives', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'professional'
  )
  and permission.permission_key in (
    'case_service_records.read', 'case_service_records.manage', 'case_service_records.sign'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system and role.role_key = 'care_worker'
  and permission.permission_key in ('case_service_records.read', 'case_service_records.manage')
on conflict (role_id, permission_id) do nothing;

create table public.case_service_record_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  record_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  content_hash text not null,
  record_state text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  service_type text not null,
  service_content text not null,
  service_result text not null,
  execution_reference_id uuid,
  execution_reference_status text not null,
  execution_reference_content_hash text,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  revision_reason text,
  correction_reason text,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  signer_display_name text,
  signer_role_keys text[],
  signature_purpose text,
  signature_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  source_kind text not null default 'manual_local',
  schema_kind text not null default 'manual_service_narrative_v1',
  statutory_rule_status text not null default 'not_configured',
  claim_eligibility_status text not null default 'not_configured',
  created_at timestamptz not null default clock_timestamp(),
  constraint case_service_record_versions_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint case_service_record_versions_execution_scope_fkey foreign key (
    execution_reference_id, organization_id, branch_id, client_id
  ) references public.service_events(id, organization_id, branch_id, client_id) on delete restrict,
  constraint case_service_record_versions_id_scope_key unique (
    id, organization_id, branch_id, client_id, record_key
  ),
  constraint case_service_record_versions_chain_key unique (
    organization_id, branch_id, record_key, version
  ),
  constraint case_service_record_versions_previous_key unique (previous_version_id),
  constraint case_service_record_versions_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, client_id, record_key
  ) references public.case_service_record_versions (
    id, organization_id, branch_id, client_id, record_key
  ) on delete restrict,
  constraint case_service_record_versions_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null) or
      (version > 1 and previous_version_id is not null))
  ),
  constraint case_service_record_versions_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint case_service_record_versions_state_check check (
    record_state in ('draft', 'signed', 'corrected')
  ),
  constraint case_service_record_versions_period_check check (
    ended_at >= started_at
    and extract(year from started_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from ended_at at time zone 'Asia/Taipei') between 2000 and 2200
    and started_at <= created_at + interval '5 minutes'
    and ended_at <= created_at + interval '5 minutes'
  ),
  constraint case_service_record_versions_type_check check (
    char_length(service_type) between 1 and 120 and service_type = btrim(service_type)
    and service_type !~ '[[:cntrl:]]'
  ),
  constraint case_service_record_versions_content_check check (
    char_length(service_content) between 1 and 8000 and service_content = btrim(service_content)
    and translate(service_content, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint case_service_record_versions_result_check check (
    char_length(service_result) between 1 and 4000 and service_result = btrim(service_result)
    and translate(service_result, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint case_service_record_versions_author_check check (
    char_length(author_display_name) between 1 and 160
    and author_display_name = btrim(author_display_name)
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint case_service_record_versions_execution_check check (
    (execution_reference_id is null and execution_reference_status = 'not_linked'
      and execution_reference_content_hash is null)
    or (execution_reference_id is not null and execution_reference_status = 'linked_completed_event'
      and execution_reference_content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint case_service_record_versions_signature_check check (
    (record_state = 'draft' and revision_reason is not null and correction_reason is null
      and signed_at is null and signed_by is null and signer_display_name is null
      and signer_role_keys is null and signature_purpose is null
      and signature_reauth_challenge_id is null)
    or (record_state = 'signed' and revision_reason is null and correction_reason is null
      and signed_at is not null and signed_by is not null and signer_display_name is not null
      and signer_role_keys is not null and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = '個案服務紀錄簽署'
      and signature_reauth_challenge_id is not null)
    or (record_state = 'corrected' and revision_reason is null and correction_reason is not null
      and signed_at is not null and signed_by is not null and signer_display_name is not null
      and signer_role_keys is not null and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = '個案服務紀錄更正簽署'
      and signature_reauth_challenge_id is not null)
  ),
  constraint case_service_record_versions_reason_check check (
    (revision_reason is null or (char_length(revision_reason) between 1 and 1000
      and revision_reason = btrim(revision_reason)
      and translate(revision_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
    and (correction_reason is null or (char_length(correction_reason) between 8 and 1000
      and correction_reason = btrim(correction_reason)
      and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  ),
  constraint case_service_record_versions_boundary_check check (
    source_kind = 'manual_local'
    and schema_kind = 'manual_service_narrative_v1'
    and statutory_rule_status = 'not_configured'
    and claim_eligibility_status = 'not_configured'
  )
);

comment on table public.case_service_record_versions is
  'Immutable Page-50 local manual narrative versions. These rows never establish claim eligibility.';
comment on column public.case_service_record_versions.execution_reference_id is
  'Optional frozen reference to an already-completed service event; the narrative never creates or changes that event.';

create table private.case_service_record_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  result_record_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_state text not null,
  result_previous_version_id uuid,
  result_source_content_hash text,
  result_content_hash text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint case_service_record_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint case_service_record_operations_result_scope_fkey foreign key (
    result_version_id, organization_id, branch_id, client_id, result_record_key
  ) references public.case_service_record_versions (
    id, organization_id, branch_id, client_id, record_key
  ) on delete restrict,
  constraint case_service_record_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and result_content_hash ~ '^[a-f0-9]{64}$'
    and (result_source_content_hash is null or result_source_content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint case_service_record_operations_action_check check (
    action in ('save_record', 'sign_record', 'correct_record')
  ),
  constraint case_service_record_operations_result_check check (
    result_version > 0
    and result_state = case action when 'save_record' then 'draft'
      when 'sign_record' then 'signed' else 'corrected' end
    and ((action = 'save_record' and reauth_challenge_id is null)
      or (action in ('sign_record', 'correct_record') and reauth_challenge_id is not null))
  )
);

create index case_service_records_scope_started_idx on public.case_service_record_versions (
  organization_id, branch_id, started_at desc, client_id, record_key, version desc
);
create index case_service_records_client_started_idx on public.case_service_record_versions (
  client_id, started_at desc, record_key, version desc
);
create index case_service_records_previous_idx on public.case_service_record_versions (previous_version_id)
  where previous_version_id is not null;
create index case_service_records_execution_idx on public.case_service_record_versions (execution_reference_id)
  where execution_reference_id is not null;
create index case_service_records_author_idx on public.case_service_record_versions (author_user_id);
create index case_service_records_signed_by_idx on public.case_service_record_versions (signed_by)
  where signed_by is not null;
create index case_service_records_reauth_idx on public.case_service_record_versions (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index case_service_record_operations_scope_idx on private.case_service_record_operations (
  organization_id, branch_id, client_id, result_record_key, result_version
);
create index case_service_record_operations_result_version_idx
  on private.case_service_record_operations (result_version_id);
create index case_service_record_operations_reauth_idx
  on private.case_service_record_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.case_service_record_versions enable row level security;
alter table public.case_service_record_versions force row level security;
alter table private.case_service_record_operations enable row level security;
alter table private.case_service_record_operations force row level security;
revoke all on table public.case_service_record_versions from public, anon, authenticated, service_role;
revoke all on table private.case_service_record_operations from public, anon, authenticated, service_role;

create or replace function private.case_service_record_history_is_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'case-service-record history is append-only';
end;
$$;

create trigger case_service_record_versions_append_only before update or delete
  on public.case_service_record_versions for each row
  execute function private.case_service_record_history_is_append_only();
create trigger case_service_record_operations_append_only before update or delete
  on private.case_service_record_operations for each row
  execute function private.case_service_record_history_is_append_only();
create trigger case_service_record_versions_audit_row_change after insert
  on public.case_service_record_versions for each row execute function private.audit_row_change();
create trigger case_service_record_operations_audit_row_change after insert
  on private.case_service_record_operations for each row execute function private.audit_row_change();

create or replace function private.case_service_record_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.profiles profile where profile.id = auth.uid()
      and profile.kind in ('staff', 'professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id and branch.is_active)
    and private.has_permission(p_expected_organization_id, p_expected_branch_id, p_permission);
$$;

create or replace function private.case_service_record_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.case_service_record_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission)
    and exists (select 1 from public.clients client where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id)
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.require_case_service_record_reauth(
  p_actor uuid, p_reference_time timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge on challenge.id = event.challenge_id
    and challenge.user_id = event.user_id and challenge.session_id = event.session_id
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

create or replace function private.case_service_record_text_valid(
  p_value text, p_minimum integer, p_maximum integer
) returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_value is not null and char_length(btrim(p_value)) between p_minimum and p_maximum
    and translate(btrim(p_value), E'\n\r\t', '') !~ '[[:cntrl:]]';
$$;

create or replace function private.case_service_record_timestamp_shape_valid(p_value text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_value is not null and octet_length(p_value) <= 64 and
    p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,9})?)?(Z|[+-][0-9]{2}:[0-9]{2})$';
$$;

create or replace function private.case_service_record_payload(
  p_row public.case_service_record_versions
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'client_id', p_row.client_id,
    'started_at', p_row.started_at,
    'ended_at', p_row.ended_at,
    'service_type', p_row.service_type,
    'service_content', p_row.service_content,
    'service_result', p_row.service_result,
    'execution_reference_id', p_row.execution_reference_id,
    'execution_reference_status', p_row.execution_reference_status,
    'execution_reference_content_hash', p_row.execution_reference_content_hash,
    'author_user_id', p_row.author_user_id,
    'source_kind', p_row.source_kind,
    'schema_kind', p_row.schema_kind,
    'statutory_rule_status', p_row.statutory_rule_status,
    'claim_eligibility_status', p_row.claim_eligibility_status
  );
$$;

create or replace function private.mutate_case_service_record_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_payload jsonb, p_idempotency_key uuid
) returns table(
  organization_id uuid, branch_id uuid, client_id uuid, actor_user_id uuid,
  operation_id uuid, idempotency_key uuid, action text, record_key uuid,
  version_id uuid, version integer, record_state text, previous_version_id uuid,
  source_content_hash text, content_hash text, record_payload jsonb,
  committed_at timestamptz, replayed boolean
) language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_permission text; v_client_id uuid; v_record_key uuid; v_previous_id uuid;
  v_expected_version integer; v_expected_hash text; v_mode text; v_reason text;
  v_expected_author_id uuid;
  v_started_at timestamptz; v_ended_at timestamptz; v_service_type text;
  v_service_content text; v_service_result text; v_execution_id uuid;
  v_execution_status text; v_execution_hash text; v_author_id uuid; v_author_name text;
  v_signer_name text; v_signer_roles text[]; v_challenge_id uuid;
  v_state text; v_version integer; v_content_hash text; v_request_hash text;
  v_expected_payload jsonb; v_client public.clients%rowtype;
  v_execution public.service_events%rowtype;
  v_previous public.case_service_record_versions%rowtype;
  v_result public.case_service_record_versions%rowtype;
  v_operation private.case_service_record_operations%rowtype;
begin
  if p_action not in ('save_record', 'sign_record', 'correct_record')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_idempotency_key is null then
    raise exception using errcode = '42501', message = 'case-service-record operation is not permitted';
  end if;
  v_permission := case when p_action = 'save_record' then 'case_service_records.manage'
    else 'case_service_records.sign' end;
  if not private.case_service_record_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'case_service_records.read')
     or not private.case_service_record_current_authority(
       p_expected_organization_id, p_expected_branch_id, v_permission) then
    raise exception using errcode = '42501', message = 'case-service-record operation is not permitted';
  end if;

  if p_action = 'save_record' then
    if not p_payload ?& array['client_id','record_key','previous_version_id','expected_version',
      'expected_content_hash','started_at','ended_at','service_type','service_content',
      'service_result','execution_reference_id','reason','mode']
      or p_payload - array['client_id','record_key','previous_version_id','expected_version',
      'expected_content_hash','started_at','ended_at','service_type','service_content',
      'service_result','execution_reference_id','reason','mode'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'case-service-record payload shape is invalid';
    end if;
    v_mode := p_payload ->> 'mode';
    if v_mode not in ('create','revise') then
      raise exception using errcode = '22023', message = 'case-service-record draft mode is invalid';
    end if;
  elsif p_action = 'sign_record' then
    if not p_payload ?& array['client_id','record_key','previous_version_id','expected_version',
      'expected_content_hash','expected_record_payload']
      or p_payload - array['client_id','record_key','previous_version_id','expected_version',
      'expected_content_hash','expected_record_payload'] <> '{}'::jsonb
      or jsonb_typeof(p_payload -> 'expected_record_payload') <> 'object' then
      raise exception using errcode = '22023', message = 'case-service-record sign payload shape is invalid';
    end if;
    v_expected_payload := p_payload -> 'expected_record_payload';
    if not v_expected_payload ?& array['client_id','started_at','ended_at','service_type',
      'service_content','service_result','execution_reference_id','execution_reference_status',
      'execution_reference_content_hash','author_user_id','source_kind','schema_kind',
      'statutory_rule_status','claim_eligibility_status']
      or v_expected_payload - array['client_id','started_at','ended_at','service_type',
      'service_content','service_result','execution_reference_id','execution_reference_status',
      'execution_reference_content_hash','author_user_id','source_kind','schema_kind',
      'statutory_rule_status','claim_eligibility_status'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'case-service-record expected content shape is invalid';
    end if;
  else
    if not p_payload ?& array['client_id','record_key','previous_version_id','expected_version',
      'expected_content_hash','started_at','ended_at','service_type','service_content',
      'service_result','execution_reference_id','expected_author_user_id','reason']
      or p_payload - array['client_id','record_key','previous_version_id','expected_version',
      'expected_content_hash','started_at','ended_at','service_type','service_content',
      'service_result','execution_reference_id','expected_author_user_id','reason'] <> '{}'::jsonb
      or jsonb_typeof(p_payload -> 'expected_author_user_id') <> 'string' then
      raise exception using errcode = '22023', message = 'case-service-record correction payload shape is invalid';
    end if;
  end if;

  if jsonb_typeof(p_payload -> 'client_id') <> 'string'
     or jsonb_typeof(p_payload -> 'expected_version') <> 'number'
     or (p_payload ->> 'expected_version') !~ '^(0|[1-9][0-9]{0,6})$'
     or (jsonb_typeof(p_payload -> 'record_key') not in ('string','null'))
     or (jsonb_typeof(p_payload -> 'previous_version_id') not in ('string','null'))
     or (jsonb_typeof(p_payload -> 'expected_content_hash') not in ('string','null')) then
    raise exception using errcode = '22023', message = 'case-service-record version identifiers are invalid';
  end if;
  begin
    v_client_id := (p_payload ->> 'client_id')::uuid;
    v_record_key := nullif(p_payload ->> 'record_key','')::uuid;
    v_previous_id := nullif(p_payload ->> 'previous_version_id','')::uuid;
    v_expected_version := (p_payload ->> 'expected_version')::integer;
    v_expected_hash := nullif(p_payload ->> 'expected_content_hash','');
    if p_action = 'correct_record' then
      v_expected_author_id := (p_payload ->> 'expected_author_user_id')::uuid;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'case-service-record version identifiers are invalid';
  end;
  if v_client_id is null
     or not private.case_service_record_client_authority(
       p_expected_organization_id,p_expected_branch_id,v_client_id,'case_service_records.read')
     or not private.case_service_record_client_authority(
       p_expected_organization_id,p_expected_branch_id,v_client_id,v_permission) then
    raise exception using errcode = '42501', message = 'case-service-record client is not permitted';
  end if;

  if p_action = 'save_record' and v_mode = 'create' then
    if v_record_key is not null or v_previous_id is not null or coalesce(v_expected_version,-1) <> 0
       or v_expected_hash is not null then
      raise exception using errcode = '22023', message = 'new case-service-record baseline is invalid';
    end if;
  elsif v_record_key is null or v_previous_id is null or coalesce(v_expected_version,0) < 1
    or v_expected_hash is null or v_expected_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'case-service-record version baseline is invalid';
  end if;

  if p_action in ('save_record','correct_record') then
    if jsonb_typeof(p_payload -> 'started_at') <> 'string'
       or jsonb_typeof(p_payload -> 'ended_at') <> 'string'
       or jsonb_typeof(p_payload -> 'service_type') <> 'string'
       or jsonb_typeof(p_payload -> 'service_content') <> 'string'
       or jsonb_typeof(p_payload -> 'service_result') <> 'string'
       or jsonb_typeof(p_payload -> 'reason') <> 'string'
       or jsonb_typeof(p_payload -> 'execution_reference_id') not in ('string','null')
       or not private.case_service_record_timestamp_shape_valid(p_payload ->> 'started_at')
       or not private.case_service_record_timestamp_shape_valid(p_payload ->> 'ended_at') then
      raise exception using errcode = '22023', message = 'case-service-record manual field shape is invalid';
    end if;
    begin
      v_started_at := (p_payload ->> 'started_at')::timestamptz;
      v_ended_at := (p_payload ->> 'ended_at')::timestamptz;
      v_execution_id := nullif(p_payload ->> 'execution_reference_id','')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'case-service-record date or execution reference is invalid';
    end;
    v_service_type := btrim(p_payload ->> 'service_type');
    v_service_content := btrim(p_payload ->> 'service_content');
    v_service_result := btrim(p_payload ->> 'service_result');
    v_reason := btrim(p_payload ->> 'reason');
    if not private.case_service_record_text_valid(v_service_type,1,120)
       or not private.case_service_record_text_valid(v_service_content,1,8000)
       or not private.case_service_record_text_valid(v_service_result,1,4000)
       or not private.case_service_record_text_valid(v_reason,
         case when p_action='correct_record' then 8 else 1 end,1000)
       or v_ended_at < v_started_at
       or extract(year from v_started_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or extract(year from v_ended_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or v_started_at > v_now + interval '5 minutes'
       or v_ended_at > v_now + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'case-service-record manual fields are invalid';
    end if;
  end if;

  if p_action in ('sign_record','correct_record') then
    v_challenge_id := private.require_case_service_record_reauth(v_actor,v_now);
  end if;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'action',p_action,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'payload',p_payload
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'case-service-record-operation:'||v_actor::text||':'||p_idempotency_key::text,0));
  select operation.* into v_operation from private.case_service_record_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> v_client_id then
      raise exception using errcode='42501',message='case-service-record replay scope is invalid';
    end if;
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode='23505',message='case-service-record idempotency conflict';
    end if;
    if not private.case_service_record_client_authority(
      p_expected_organization_id,p_expected_branch_id,v_operation.client_id,v_permission) then
      raise exception using errcode='42501',message='case-service-record replay is not permitted';
    end if;
    select row.* into strict v_result from public.case_service_record_versions row
      where row.id=v_operation.result_version_id
        and row.organization_id=v_operation.organization_id
        and row.branch_id=v_operation.branch_id and row.client_id=v_operation.client_id
        and row.record_key=v_operation.result_record_key;
    return query select v_operation.organization_id,v_operation.branch_id,v_operation.client_id,
      v_operation.actor_user_id,v_operation.id,v_operation.idempotency_key,v_operation.action,
      v_operation.result_record_key,v_operation.result_version_id,v_operation.result_version,
      v_operation.result_state,v_operation.result_previous_version_id,
      v_operation.result_source_content_hash,v_operation.result_content_hash,
      private.case_service_record_payload(v_result),v_operation.result_committed_at,true;
    return;
  end if;

  v_record_key := coalesce(v_record_key,gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'case-service-record-chain:'||p_expected_organization_id::text||':'||
    p_expected_branch_id::text||':'||v_record_key::text,0));
  if not (p_action='save_record' and v_mode='create') then
    select row.* into v_previous from public.case_service_record_versions row
    where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
      and row.client_id=v_client_id and row.record_key=v_record_key
      and not exists (select 1 from public.case_service_record_versions child
        where child.previous_version_id=row.id)
    order by row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> v_previous_id
       or v_previous.version <> v_expected_version or v_previous.content_hash <> v_expected_hash then
      raise exception using errcode='40001',message='case-service-record version is stale';
    end if;
  end if;

  if p_action='save_record' then
    if v_mode='revise' and (v_previous.record_state <> 'draft'
      or v_previous.author_user_id <> v_actor) then
      raise exception using errcode='42501',message='only the original author can revise the current draft';
    end if;
    v_state := 'draft'; v_version := coalesce(v_previous.version,0)+1;
    if v_mode='create' then
      v_author_id := v_actor;
      select profile.display_name into v_author_name from public.profiles profile
        where profile.id=v_actor and profile.is_active;
    else
      v_author_id := v_previous.author_user_id;
      v_author_name := v_previous.author_display_name;
    end if;
  elsif p_action='correct_record' then
    if v_previous.record_state not in ('signed','corrected') then
      raise exception using errcode='23514',message='only signed service narrative content can be corrected';
    end if;
    if v_expected_author_id is null or v_expected_author_id <> v_previous.author_user_id then
      raise exception using errcode='40001',message='case-service-record correction author has changed';
    end if;
    v_state := 'corrected'; v_version := v_previous.version+1;
    v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name;
  else
    if v_previous.record_state <> 'draft' then
      raise exception using errcode='23514',message='only a current draft service narrative can be signed';
    end if;
    if jsonb_typeof(v_expected_payload -> 'client_id') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'author_user_id') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'started_at') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'ended_at') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'service_type') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'service_content') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'service_result') <> 'string'
       or jsonb_typeof(v_expected_payload -> 'execution_reference_id') not in ('string','null')
       or jsonb_typeof(v_expected_payload -> 'execution_reference_content_hash') not in ('string','null')
       or not private.case_service_record_timestamp_shape_valid(v_expected_payload ->> 'started_at')
       or not private.case_service_record_timestamp_shape_valid(v_expected_payload ->> 'ended_at') then
      raise exception using errcode='22023',message='case-service-record expected content is invalid';
    end if;
    begin
      if (v_expected_payload ->> 'client_id')::uuid <> v_previous.client_id
         or (v_expected_payload ->> 'started_at')::timestamptz <> v_previous.started_at
         or (v_expected_payload ->> 'ended_at')::timestamptz <> v_previous.ended_at
         or v_expected_payload ->> 'service_type' <> v_previous.service_type
         or v_expected_payload ->> 'service_content' <> v_previous.service_content
         or v_expected_payload ->> 'service_result' <> v_previous.service_result
         or nullif(v_expected_payload ->> 'execution_reference_id','')::uuid
              is distinct from v_previous.execution_reference_id
         or v_expected_payload ->> 'execution_reference_status' <> v_previous.execution_reference_status
         or nullif(v_expected_payload ->> 'execution_reference_content_hash','')
              is distinct from v_previous.execution_reference_content_hash
         or (v_expected_payload ->> 'author_user_id')::uuid <> v_previous.author_user_id
         or v_expected_payload ->> 'source_kind' <> v_previous.source_kind
         or v_expected_payload ->> 'schema_kind' <> v_previous.schema_kind
         or v_expected_payload ->> 'statutory_rule_status' <> v_previous.statutory_rule_status
         or v_expected_payload ->> 'claim_eligibility_status' <> v_previous.claim_eligibility_status then
        raise exception using errcode='40001',message='case-service-record signed content has changed';
      end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='case-service-record expected content is invalid';
    end;
    v_state := 'signed'; v_version := v_previous.version+1;
    v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name;
    v_started_at := v_previous.started_at; v_ended_at := v_previous.ended_at;
    v_service_type := v_previous.service_type; v_service_content := v_previous.service_content;
    v_service_result := v_previous.service_result; v_execution_id := v_previous.execution_reference_id;
  end if;

  if v_author_name is null then
    raise exception using errcode='42501',message='case-service-record author identity is invalid';
  end if;
  select client.* into v_client from public.clients client where client.id=v_client_id
    and client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
    for key share;
  if v_client.id is null or v_client.admitted_on is null
     or (v_started_at at time zone 'Asia/Taipei')::date < v_client.admitted_on
     or (v_ended_at at time zone 'Asia/Taipei')::date < v_client.admitted_on
     or (v_client.ended_on is not null and ((v_started_at at time zone 'Asia/Taipei')::date > v_client.ended_on
       or (v_ended_at at time zone 'Asia/Taipei')::date > v_client.ended_on)) then
    raise exception using errcode='23514',message='case-service-record service period is outside client lifecycle';
  end if;

  if v_execution_id is null then
    v_execution_status := 'not_linked'; v_execution_hash := null;
  else
    select event.* into v_execution from public.service_events event
    where event.id=v_execution_id and event.organization_id=p_expected_organization_id
      and event.branch_id=p_expected_branch_id and event.client_id=v_client_id
    for key share;
    if v_execution.id is null or v_execution.status <> 'completed'
       or v_execution.content_hash is null or v_execution.content_hash !~ '^[a-f0-9]{64}$'
       or v_execution.staff_user_id is distinct from v_author_id then
      raise exception using errcode='23514',message='linked execution evidence is not a completed exact-scope author event';
    end if;
    if p_action='sign_record' and (v_execution.content_hash <> v_previous.execution_reference_content_hash
       or v_previous.execution_reference_status <> 'linked_completed_event') then
      raise exception using errcode='40001',message='linked execution evidence changed before signing';
    end if;
    v_execution_status := 'linked_completed_event'; v_execution_hash := v_execution.content_hash;
  end if;

  if p_action in ('sign_record','correct_record') then
    select profile.display_name into v_signer_name from public.profiles profile
      where profile.id=v_actor and profile.is_active;
    select coalesce(array_agg(distinct role.role_key order by role.role_key),'{}'::text[])
      into v_signer_roles from public.memberships membership
      join public.membership_roles membership_role on membership_role.membership_id=membership.id
      join public.roles role on role.id=membership_role.role_id and role.is_active
      where membership.profile_id=v_actor and membership.organization_id=p_expected_organization_id
        and membership.status='active' and membership.starts_at <= v_now
        and (membership.ends_at is null or membership.ends_at > v_now)
        and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
        and (role.organization_id is null or role.organization_id=p_expected_organization_id);
    if v_signer_name is null or cardinality(v_signer_roles)=0 then
      raise exception using errcode='42501',message='case-service-record signer identity is invalid';
    end if;
  end if;
  if not private.case_service_record_client_authority(
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_permission) then
    raise exception using errcode='42501',message='case-service-record authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'client_id',v_client_id,'record_key',v_record_key,'version',v_version,
    'previous_version_id',v_previous_id,'record_state',v_state,'started_at',v_started_at,
    'ended_at',v_ended_at,'service_type',v_service_type,'service_content',v_service_content,
    'service_result',v_service_result,'execution_reference_id',v_execution_id,
    'execution_reference_status',v_execution_status,
    'execution_reference_content_hash',v_execution_hash,'author_user_id',v_author_id,
    'reason',v_reason,'signed_by',case when v_state='draft' then null else v_actor end,
    'signed_at',case when v_state='draft' then null else v_now end,
    'source_kind','manual_local','schema_kind','manual_service_narrative_v1',
    'statutory_rule_status','not_configured','claim_eligibility_status','not_configured'
  )::text,'UTF8')),'hex');

  insert into public.case_service_record_versions (
    organization_id,branch_id,client_id,record_key,version,previous_version_id,content_hash,
    record_state,started_at,ended_at,service_type,service_content,service_result,
    execution_reference_id,execution_reference_status,execution_reference_content_hash,
    author_user_id,author_display_name,revision_reason,correction_reason,signed_at,signed_by,
    signer_display_name,signer_role_keys,signature_purpose,signature_reauth_challenge_id,
    source_kind,schema_kind,statutory_rule_status,claim_eligibility_status,created_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_record_key,v_version,v_previous_id,
    v_content_hash,v_state,v_started_at,v_ended_at,v_service_type,v_service_content,v_service_result,
    v_execution_id,v_execution_status,v_execution_hash,v_author_id,v_author_name,
    case when v_state='draft' then v_reason end,case when v_state='corrected' then v_reason end,
    case when v_state='draft' then null else v_now end,case when v_state='draft' then null else v_actor end,
    case when v_state='draft' then null else v_signer_name end,
    case when v_state='draft' then null else v_signer_roles end,
    case when v_state='signed' then '個案服務紀錄簽署'
      when v_state='corrected' then '個案服務紀錄更正簽署' end,
    v_challenge_id,'manual_local','manual_service_narrative_v1','not_configured','not_configured',v_now
  ) returning * into v_result;

  insert into private.case_service_record_operations (
    organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_hash,action,
    result_record_key,result_version_id,result_version,result_state,result_previous_version_id,
    result_source_content_hash,result_content_hash,result_committed_at,reauth_challenge_id
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_actor,p_idempotency_key,
    v_request_hash,p_action,v_result.record_key,v_result.id,v_result.version,v_result.record_state,
    v_result.previous_version_id,v_expected_hash,v_result.content_hash,v_result.created_at,v_challenge_id
  ) returning * into v_operation;

  insert into public.audit_events (
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,idempotency_key,
    changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,
    case when v_state='draft' then 'insert' when v_state='signed' then 'sign' else 'correct' end,
    'case_service_record_versions',v_result.id::text,p_idempotency_key,
    array['record_state','version','started_at','ended_at','service_type',
      'execution_reference_status','source_kind','schema_kind'],
    jsonb_build_object('workflow','page50_case_service_record_v1','version',v_result.version,
      'state',v_result.record_state,'contains_narrative',true,'narrative_logged',false,
      'claim_eligibility_changed',false)
  );
  if not private.case_service_record_client_authority(
      p_expected_organization_id,p_expected_branch_id,v_client_id,v_permission)
    or not exists (select 1 from public.case_service_record_versions row where row.id=v_result.id
      and not exists (select 1 from public.case_service_record_versions child
        where child.previous_version_id=row.id)) then
    raise exception using errcode='42501',message='case-service-record final verification failed';
  end if;
  return query select v_operation.organization_id,v_operation.branch_id,v_operation.client_id,
    v_operation.actor_user_id,v_operation.id,v_operation.idempotency_key,v_operation.action,
    v_result.record_key,v_result.id,v_result.version,v_result.record_state,v_result.previous_version_id,
    v_expected_hash,v_result.content_hash,private.case_service_record_payload(v_result),
    v_result.created_at,false;
end;
$$;

create or replace function public.mutate_case_service_record(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_payload jsonb, p_idempotency_key uuid
) returns table(
  organization_id uuid, branch_id uuid, client_id uuid, actor_user_id uuid,
  operation_id uuid, idempotency_key uuid, action text, record_key uuid,
  version_id uuid, version integer, record_state text, previous_version_id uuid,
  source_content_hash text, content_hash text, record_payload jsonb,
  committed_at timestamptz, replayed boolean
) language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_case_service_record_guarded(
    p_expected_organization_id,p_expected_branch_id,p_action,p_payload,p_idempotency_key);
$$;

create or replace function private.case_service_record_snapshot_response(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_date_from date default null, p_date_to date default null,
  p_client_id uuid default null, p_service_type text default null,
  p_author_user_id uuid default null, p_record_state text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  records jsonb, matching_total bigint, records_truncated boolean,
  service_total bigint, draft_total bigint, signed_total bigint, corrected_total bigint,
  linked_execution_total bigint, changed_execution_total bigint,
  clients jsonb, client_total bigint, clients_truncated boolean,
  service_types jsonb, service_type_total bigint, service_types_truncated boolean,
  authors jsonb, author_total bigint, authors_truncated boolean,
  schema_kind text, statutory_rule_status text, attachment_status text,
  export_status text, notification_status text, offline_status text,
  claim_eligibility_status text
) language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
begin
  if not private.case_service_record_current_authority(
      p_expected_organization_id,p_expected_branch_id,'case_service_records.read')
    or (p_client_id is not null and not private.case_service_record_client_authority(
      p_expected_organization_id,p_expected_branch_id,p_client_id,'case_service_records.read'))
    or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
    or (p_service_type is not null and not private.case_service_record_text_valid(p_service_type,1,120))
    or (p_record_state is not null and p_record_state not in ('draft','signed','corrected')) then
    raise exception using errcode='42501',message='case-service-record snapshot is not permitted';
  end if;
  return query
  with current_records as (
    select row.*,
      case when row.execution_reference_id is null then 'not_linked'
        when exists (select 1 from public.service_events event
          where event.id=row.execution_reference_id and event.organization_id=row.organization_id
            and event.branch_id=row.branch_id and event.client_id=row.client_id
            and event.status='completed' and event.content_hash=row.execution_reference_content_hash)
          then 'verified_completed' else 'changed_or_unavailable' end execution_verification
    from public.case_service_record_versions row
    where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
      and private.can_staff_access_client(row.client_id,'clients.read')
      and private.can_staff_access_client(row.client_id,'case_service_records.read')
      and not exists (select 1 from public.case_service_record_versions child
        where child.previous_version_id=row.id)
  ), matching as (
    select row.* from current_records row where
      (p_date_from is null or (row.started_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or (row.started_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (p_client_id is null or row.client_id=p_client_id)
      and (p_service_type is null or row.service_type=btrim(p_service_type))
      and (p_author_user_id is null or row.author_user_id=p_author_user_id)
      and (p_record_state is null or row.record_state=p_record_state)
  ), page as (
    select row.* from matching row order by row.started_at desc,row.client_id,row.record_key limit 200
  ), client_options as (
    select client.id,client.display_name from public.clients client
    where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
      and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'case_service_records.read')
    order by client.display_name,client.id limit 200
  ), type_options as (
    select distinct row.service_type from current_records row order by row.service_type limit 200
  ), author_latest as (
    select distinct on (row.author_user_id)
      row.author_user_id,row.author_display_name,row.created_at,row.id
    from current_records row
    order by row.author_user_id,row.created_at desc,row.id desc
  ), author_options as (
    select row.author_user_id,row.author_display_name from author_latest row
    order by row.author_display_name,row.author_user_id limit 200
  )
  select p_expected_organization_id,p_expected_branch_id,v_now,
    coalesce((select jsonb_agg(jsonb_build_object(
      'version_id',row.id,'record_key',row.record_key,'version',row.version,
      'previous_version_id',row.previous_version_id,'content_hash',row.content_hash,
      'record_state',row.record_state,'client_id',row.client_id,
      'client_display_name',client.display_name,'started_at',row.started_at,'ended_at',row.ended_at,
      'service_type',row.service_type,'service_content',row.service_content,
      'service_result',row.service_result,'execution_reference_id',row.execution_reference_id,
      'execution_reference_status',row.execution_reference_status,
      'execution_reference_content_hash',row.execution_reference_content_hash,
      'execution_reference_verification',row.execution_verification,
      'author_user_id',row.author_user_id,'author_display_name',row.author_display_name,
      'revision_reason',row.revision_reason,'correction_reason',row.correction_reason,
      'signed_at',row.signed_at,'signed_by_user_id',row.signed_by,
      'signer_display_name',row.signer_display_name,'signer_role_keys',row.signer_role_keys,
      'signature_purpose',row.signature_purpose,
      'signature_reauth_challenge_id',row.signature_reauth_challenge_id,
      'source_kind',row.source_kind,'schema_kind',row.schema_kind,
      'statutory_rule_status',row.statutory_rule_status,
      'claim_eligibility_status',row.claim_eligibility_status,'created_at',row.created_at,
      'history',coalesce((select jsonb_agg(jsonb_build_object(
        'version_id',history.id,'record_key',history.record_key,'version',history.version,
        'previous_version_id',history.previous_version_id,'content_hash',history.content_hash,
        'record_state',history.record_state,'client_id',history.client_id,
        'client_display_name',client.display_name,'started_at',history.started_at,
        'ended_at',history.ended_at,'service_type',history.service_type,
        'service_content',history.service_content,'service_result',history.service_result,
        'execution_reference_id',history.execution_reference_id,
        'execution_reference_status',history.execution_reference_status,
        'execution_reference_content_hash',history.execution_reference_content_hash,
        'execution_reference_verification',case when history.execution_reference_id is null then 'not_linked'
          when exists (select 1 from public.service_events event
            where event.id=history.execution_reference_id and event.organization_id=history.organization_id
              and event.branch_id=history.branch_id and event.client_id=history.client_id
              and event.status='completed' and event.content_hash=history.execution_reference_content_hash)
            then 'verified_completed' else 'changed_or_unavailable' end,
        'author_user_id',history.author_user_id,'author_display_name',history.author_display_name,
        'revision_reason',history.revision_reason,'correction_reason',history.correction_reason,
        'signed_at',history.signed_at,'signed_by_user_id',history.signed_by,
        'signer_display_name',history.signer_display_name,'signer_role_keys',history.signer_role_keys,
        'signature_purpose',history.signature_purpose,
        'signature_reauth_challenge_id',history.signature_reauth_challenge_id,
        'source_kind',history.source_kind,'schema_kind',history.schema_kind,
        'statutory_rule_status',history.statutory_rule_status,
        'claim_eligibility_status',history.claim_eligibility_status,'created_at',history.created_at
      ) order by history.version) from (select item.* from public.case_service_record_versions item
        where item.organization_id=row.organization_id and item.branch_id=row.branch_id
          and item.client_id=row.client_id and item.record_key=row.record_key
        order by item.version limit 50) history),'[]'::jsonb),
      'history_total',(select count(*) from public.case_service_record_versions history
        where history.organization_id=row.organization_id and history.branch_id=row.branch_id
          and history.client_id=row.client_id and history.record_key=row.record_key)
    ) order by row.started_at desc,row.client_id,row.record_key)
      from page row join public.clients client on client.id=row.client_id),'[]'::jsonb),
    (select count(*) from matching),(select count(*) from matching)>200,
    (select count(*) from matching),(select count(*) from matching where record_state='draft'),
    (select count(*) from matching where record_state='signed'),
    (select count(*) from matching where record_state='corrected'),
    (select count(*) from matching where execution_reference_id is not null),
    (select count(*) from matching where execution_verification='changed_or_unavailable'),
    coalesce((select jsonb_agg(jsonb_build_object('client_id',option.id,'display_name',option.display_name)
      order by option.display_name,option.id) from client_options option),'[]'::jsonb),
    (select count(*) from public.clients client where client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'case_service_records.read')),
    (select count(*) from public.clients client where client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'case_service_records.read'))>200,
    coalesce((select jsonb_agg(option.service_type order by option.service_type)
      from type_options option),'[]'::jsonb),
    (select count(distinct row.service_type) from current_records row),
    (select count(distinct row.service_type) from current_records row)>200,
    coalesce((select jsonb_agg(jsonb_build_object('user_id',option.author_user_id,
      'display_name',option.author_display_name) order by option.author_display_name,option.author_user_id)
      from author_options option),'[]'::jsonb),
    (select count(distinct row.author_user_id) from current_records row),
    (select count(distinct row.author_user_id) from current_records row)>200,
    'manual_service_narrative_v1','not_configured','not_configured','not_configured',
    'not_configured','not_configured','not_configured';

  insert into public.audit_events (
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'case_service_record_versions','snapshot',array[]::text[],
    jsonb_build_object('workflow','page50_case_service_record_snapshot_v1',
      'narrative_logged',false,'filters_logged',false)
  );
  if not private.case_service_record_current_authority(
    p_expected_organization_id,p_expected_branch_id,'case_service_records.read') then
    raise exception using errcode='42501',message='case-service-record snapshot authority expired';
  end if;
end;
$$;

create or replace function public.case_service_record_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_date_from date default null, p_date_to date default null,
  p_client_id uuid default null, p_service_type text default null,
  p_author_user_id uuid default null, p_record_state text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  records jsonb, matching_total bigint, records_truncated boolean,
  service_total bigint, draft_total bigint, signed_total bigint, corrected_total bigint,
  linked_execution_total bigint, changed_execution_total bigint,
  clients jsonb, client_total bigint, clients_truncated boolean,
  service_types jsonb, service_type_total bigint, service_types_truncated boolean,
  authors jsonb, author_total bigint, authors_truncated boolean,
  schema_kind text, statutory_rule_status text, attachment_status text,
  export_status text, notification_status text, offline_status text,
  claim_eligibility_status text
) language sql volatile security invoker set search_path = '' as $$
  select * from private.case_service_record_snapshot_response(
    p_expected_organization_id,p_expected_branch_id,p_date_from,p_date_to,p_client_id,
    p_service_type,p_author_user_id,p_record_state);
$$;

revoke all on function private.case_service_record_history_is_append_only() from public,anon,authenticated,service_role;
revoke all on function private.case_service_record_current_authority(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.case_service_record_client_authority(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.require_case_service_record_reauth(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.case_service_record_text_valid(text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function private.case_service_record_timestamp_shape_valid(text) from public,anon,authenticated,service_role;
revoke all on function private.case_service_record_payload(public.case_service_record_versions) from public,anon,authenticated,service_role;
revoke all on function private.mutate_case_service_record_guarded(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
revoke all on function private.case_service_record_snapshot_response(uuid,uuid,date,date,uuid,text,uuid,text) from public,anon,service_role;
revoke all on function public.mutate_case_service_record(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
revoke all on function public.case_service_record_snapshot(uuid,uuid,date,date,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function private.mutate_case_service_record_guarded(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function private.case_service_record_snapshot_response(uuid,uuid,date,date,uuid,text,uuid,text) to authenticated;
grant execute on function public.mutate_case_service_record(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.case_service_record_snapshot(uuid,uuid,date,date,uuid,text,uuid,text) to authenticated;
