-- Page 21: immutable manual, unstandardized ABCD assessment candidates.
-- No official questionnaire, scoring formula, diagnosis, automatic reassessment,
-- or care decision is represented by this migration.

insert into public.permissions (permission_key, description, risk_level) values
  ('abcd_assessments.read', 'Read assigned-client manual ABCD assessment candidates', 2),
  ('abcd_assessments.manage', 'Create, revise, sign and correct manual ABCD assessment candidates', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key in (
  'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
  'nurse', 'care_worker', 'professional'
) and permission.permission_key in ('abcd_assessments.read', 'abcd_assessments.manage')
on conflict (role_id, permission_id) do nothing;

create table public.abcd_assessment_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  content_hash text not null,
  assessment_state text not null,
  assessment_type text not null,
  assessment_year integer not null,
  assessment_date date not null,
  manual_summary text not null,
  result_state text not null,
  result_text text,
  result_reason text,
  reassessment_state text not null,
  reassessment_date date,
  reassessment_basis text not null,
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
  form_kind text not null default 'manual_unstandardized',
  formal_rule_status text not null default 'not_configured',
  created_at timestamptz not null default clock_timestamp(),
  constraint abcd_assessment_versions_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint abcd_assessment_versions_id_scope_key unique (
    id, organization_id, branch_id, client_id, assessment_key
  ),
  constraint abcd_assessment_versions_chain_key unique (
    organization_id, branch_id, assessment_key, version
  ),
  constraint abcd_assessment_versions_business_version_key unique (
    organization_id, branch_id, client_id, assessment_year, assessment_type, version
  ),
  constraint abcd_assessment_versions_previous_key unique (previous_version_id),
  constraint abcd_assessment_versions_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, client_id, assessment_key
  ) references public.abcd_assessment_versions (
    id, organization_id, branch_id, client_id, assessment_key
  ) on delete restrict,
  constraint abcd_assessment_versions_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null) or
      (version > 1 and previous_version_id is not null))
  ),
  constraint abcd_assessment_versions_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint abcd_assessment_versions_state_check check (
    assessment_state in ('draft', 'signed', 'corrected')
  ),
  constraint abcd_assessment_versions_identity_check check (
    assessment_type in ('A','B','C','D') and assessment_year between 2000 and 2200
    and extract(year from assessment_date)::integer = assessment_year
  ),
  constraint abcd_assessment_versions_summary_check check (
    char_length(manual_summary) between 1 and 8000 and manual_summary = btrim(manual_summary)
    and translate(manual_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint abcd_assessment_versions_result_check check (
    result_state in ('recorded','missing','not_applicable') and
    ((result_state = 'recorded' and result_text is not null and
      char_length(result_text) between 1 and 4000 and result_text = btrim(result_text)
      and translate(result_text, E'\n\r\t', '') !~ '[[:cntrl:]]' and result_reason is null) or
     (result_state <> 'recorded' and result_text is null and result_reason is not null and
      char_length(result_reason) between 1 and 1000 and result_reason = btrim(result_reason)
      and translate(result_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  ),
  constraint abcd_assessment_versions_reassessment_check check (
    reassessment_state in ('recorded','missing','not_applicable') and
    ((reassessment_state = 'recorded' and reassessment_date is not null
      and reassessment_date >= assessment_date) or
     (reassessment_state <> 'recorded' and reassessment_date is null)) and
    char_length(reassessment_basis) between 1 and 1000 and reassessment_basis = btrim(reassessment_basis)
    and translate(reassessment_basis, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint abcd_assessment_versions_author_check check (
    char_length(author_display_name) between 1 and 160 and author_display_name = btrim(author_display_name)
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint abcd_assessment_versions_signature_check check (
    (assessment_state = 'draft' and revision_reason is not null and correction_reason is null
      and signed_at is null and signed_by is null and signer_display_name is null
      and signer_role_keys is null and signature_purpose is null
      and signature_reauth_challenge_id is null) or
    (assessment_state = 'signed' and revision_reason is null and correction_reason is null
      and signed_at is not null and signed_by is not null and signer_display_name is not null
      and signer_role_keys is not null and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = 'ABCD 人工候選評估簽署'
      and signature_reauth_challenge_id is not null) or
    (assessment_state = 'corrected' and revision_reason is null and correction_reason is not null
      and signed_at is not null and signed_by is not null and signer_display_name is not null
      and signer_role_keys is not null and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = 'ABCD 人工候選評估更正簽署'
      and signature_reauth_challenge_id is not null)
  ),
  constraint abcd_assessment_versions_reason_check check (
    (revision_reason is null or (char_length(revision_reason) between 1 and 1000
      and revision_reason = btrim(revision_reason)
      and translate(revision_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')) and
    (correction_reason is null or (char_length(correction_reason) between 8 and 1000
      and correction_reason = btrim(correction_reason)
      and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  ),
  constraint abcd_assessment_versions_governance_check check (
    form_kind = 'manual_unstandardized' and formal_rule_status = 'not_configured'
  )
);

comment on table public.abcd_assessment_versions is
  'Immutable Page-21 manual, unstandardized candidate records. Not an official ABCD instrument or scored result.';

create table private.abcd_assessment_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  result_assessment_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_state text not null,
  result_assessment_type text not null,
  result_assessment_year integer not null,
  result_content_hash text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint abcd_assessment_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint abcd_assessment_operations_result_scope_fkey foreign key (
    result_version_id, organization_id, branch_id, client_id, result_assessment_key
  ) references public.abcd_assessment_versions (
    id, organization_id, branch_id, client_id, assessment_key
  ) on delete restrict,
  constraint abcd_assessment_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and result_content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint abcd_assessment_operations_action_check check (
    action in ('save_assessment','sign_assessment','correct_assessment')
  ),
  constraint abcd_assessment_operations_state_check check (
    result_version > 0 and result_state in ('draft','signed','corrected')
    and result_assessment_type in ('A','B','C','D')
    and result_assessment_year between 2000 and 2200
    and ((action='save_assessment' and result_state='draft' and reauth_challenge_id is null)
      or (action='sign_assessment' and result_state='signed' and reauth_challenge_id is not null)
      or (action='correct_assessment' and result_state='corrected' and reauth_challenge_id is not null))
  )
);

create index abcd_assessment_scope_date_idx on public.abcd_assessment_versions (
  organization_id, branch_id, assessment_date desc, assessment_key, version desc
);
create index abcd_assessment_client_identity_idx on public.abcd_assessment_versions (
  client_id, assessment_year desc, assessment_type, version desc
);
create index abcd_assessment_previous_idx on public.abcd_assessment_versions (previous_version_id)
  where previous_version_id is not null;
create index abcd_assessment_author_idx on public.abcd_assessment_versions (author_user_id);
create index abcd_assessment_signed_by_idx on public.abcd_assessment_versions (signed_by)
  where signed_by is not null;
create index abcd_assessment_reauth_idx on public.abcd_assessment_versions (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index abcd_assessment_operations_result_idx on private.abcd_assessment_operations (
  organization_id, branch_id, client_id, result_assessment_key, result_version
);
create index abcd_assessment_operations_result_version_idx on private.abcd_assessment_operations (result_version_id);
create index abcd_assessment_operations_reauth_idx on private.abcd_assessment_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.abcd_assessment_versions enable row level security;
alter table public.abcd_assessment_versions force row level security;
alter table private.abcd_assessment_operations enable row level security;
alter table private.abcd_assessment_operations force row level security;
revoke all on table public.abcd_assessment_versions from public, anon, authenticated, service_role;
revoke all on table private.abcd_assessment_operations from public, anon, authenticated, service_role;

create or replace function private.abcd_assessment_history_is_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'ABCD assessment history is append-only';
end;
$$;
create trigger abcd_assessment_versions_append_only before update or delete
  on public.abcd_assessment_versions for each row
  execute function private.abcd_assessment_history_is_append_only();
create trigger abcd_assessment_operations_append_only before update or delete
  on private.abcd_assessment_operations for each row
  execute function private.abcd_assessment_history_is_append_only();
create trigger abcd_assessment_versions_audit_row_change after insert
  on public.abcd_assessment_versions for each row execute function private.audit_row_change();
create trigger abcd_assessment_operations_audit_row_change after insert
  on private.abcd_assessment_operations for each row execute function private.audit_row_change();

create or replace function private.abcd_assessment_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt() ->> 'aal','') = 'aal2'
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission);
$$;

create or replace function private.abcd_assessment_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.abcd_assessment_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id)
    and private.can_staff_access_client(p_client_id,'clients.read')
    and private.can_staff_access_client(p_client_id,p_permission);
$$;

create or replace function private.require_abcd_assessment_reauth(
  p_actor uuid, p_reference_time timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or p_actor<>auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode='42501',message='current same-session recent AAL2 evidence is required';
  end if;
  begin v_session_id := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='current same-session recent AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event join private.reauth_challenges challenge
    on challenge.id=event.challenge_id and challenge.user_id=event.user_id
    and challenge.session_id=event.session_id
  where event.user_id=p_actor and event.session_id=v_session_id and event.aal='aal2'
    and event.revoked_at is null and event.verification_method in ('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and challenge.factor_verified_at=event.verified_at
    and challenge.factor_verified_at>=p_reference_time-interval '15 minutes'
    and challenge.factor_verified_at<=p_reference_time+interval '1 minute'
  order by challenge.factor_verified_at desc,challenge.id desc limit 1
  for share of event,challenge;
  if v_challenge_id is null then
    raise exception using errcode='42501',message='current same-session recent AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.abcd_result_valid(p_result jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_result)='object'
    and p_result ?& array['state','text','reason']
    and p_result-array['state','text','reason']='{}'::jsonb
    and p_result->>'state' in ('recorded','missing','not_applicable')
    and ((p_result->>'state'='recorded' and jsonb_typeof(p_result->'text')='string'
      and char_length(btrim(p_result->>'text')) between 1 and 4000
      and translate(btrim(p_result->>'text'),E'\n\r\t','') !~ '[[:cntrl:]]'
      and p_result->'reason'='null'::jsonb)
    or (p_result->>'state'<>'recorded' and p_result->'text'='null'::jsonb
      and jsonb_typeof(p_result->'reason')='string'
      and char_length(btrim(p_result->>'reason')) between 1 and 1000
      and translate(btrim(p_result->>'reason'),E'\n\r\t','') !~ '[[:cntrl:]]'));
$$;

create or replace function private.abcd_reassessment_valid(p_reassessment jsonb,p_assessment_date date)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_reassessment)='object'
    and p_reassessment ?& array['state','date','basis']
    and p_reassessment-array['state','date','basis']='{}'::jsonb
    and p_reassessment->>'state' in ('recorded','missing','not_applicable')
    and jsonb_typeof(p_reassessment->'basis')='string'
    and char_length(btrim(p_reassessment->>'basis')) between 1 and 1000
    and translate(btrim(p_reassessment->>'basis'),E'\n\r\t','') !~ '[[:cntrl:]]'
    and ((p_reassessment->>'state'='recorded'
      and (p_reassessment->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
      and (p_reassessment->>'date')::date>=p_assessment_date)
    or (p_reassessment->>'state'<>'recorded' and p_reassessment->'date'='null'::jsonb));
$$;

create or replace function private.abcd_assessment_record_payload(
  p_row public.abcd_assessment_versions
) returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'client_id',p_row.client_id,'assessment_type',p_row.assessment_type,
    'assessment_year',p_row.assessment_year,'assessment_date',p_row.assessment_date,
    'manual_summary',p_row.manual_summary,
    'result',jsonb_build_object('state',p_row.result_state,
      'text',p_row.result_text,'reason',p_row.result_reason),
    'reassessment',jsonb_build_object('state',p_row.reassessment_state,
      'date',p_row.reassessment_date,'basis',p_row.reassessment_basis),
    'form_kind',p_row.form_kind,'formal_rule_status',p_row.formal_rule_status
  );
$$;

create or replace function private.mutate_abcd_assessment_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_payload jsonb, p_idempotency_key uuid
) returns table(organization_id uuid, branch_id uuid, client_id uuid,
  operation_id uuid, idempotency_key uuid, action text, assessment_key uuid,
  version_id uuid, version integer, assessment_state text, assessment_type text,
  assessment_year integer, previous_version_id uuid, source_content_hash text,
  content_hash text, record_payload jsonb, committed_at timestamptz, replayed boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_client_id uuid; v_assessment_key uuid; v_previous_id uuid;
  v_expected_version integer; v_expected_hash text; v_mode text; v_reason text;
  v_assessment_type text; v_assessment_year integer; v_assessment_date date;
  v_manual_summary text; v_result_state text; v_result_text text; v_result_reason text;
  v_reassessment_state text; v_reassessment_date date; v_reassessment_basis text;
  v_request_hash text; v_challenge_id uuid; v_author_id uuid; v_author_name text;
  v_signer_name text; v_signer_roles text[]; v_state text; v_version integer;
  v_content_hash text; v_operation private.abcd_assessment_operations%rowtype;
  v_previous public.abcd_assessment_versions%rowtype;
  v_result public.abcd_assessment_versions%rowtype;
begin
  if p_action not in ('save_assessment','sign_assessment','correct_assessment')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_idempotency_key is null then
    raise exception using errcode='42501',message='ABCD assessment operation is not permitted';
  end if;
  if not private.abcd_assessment_current_authority(
       p_expected_organization_id,p_expected_branch_id,'abcd_assessments.read')
     or not private.abcd_assessment_current_authority(
       p_expected_organization_id,p_expected_branch_id,'abcd_assessments.manage') then
    raise exception using errcode='42501',message='ABCD assessment operation is not permitted';
  end if;

  begin
    v_client_id := nullif(p_payload->>'client_id','')::uuid;
    v_assessment_key := nullif(p_payload->>'assessment_key','')::uuid;
    v_previous_id := nullif(p_payload->>'previous_version_id','')::uuid;
    v_expected_version := (p_payload->>'expected_version')::integer;
    v_expected_hash := nullif(p_payload->>'expected_content_hash','');
    v_assessment_year := (p_payload->>'assessment_year')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='ABCD assessment identifiers are invalid';
  end;
  v_assessment_type := p_payload->>'assessment_type';
  if v_client_id is null or v_assessment_type not in ('A','B','C','D')
     or v_assessment_year not between 2000 and 2200
     or not private.abcd_assessment_client_authority(
       p_expected_organization_id,p_expected_branch_id,v_client_id,'abcd_assessments.read')
     or not private.abcd_assessment_client_authority(
       p_expected_organization_id,p_expected_branch_id,v_client_id,'abcd_assessments.manage') then
    raise exception using errcode='42501',message='ABCD assessment client or identity is not permitted';
  end if;

  if p_action='save_assessment' then
    if not p_payload ?& array['mode','client_id','assessment_key','previous_version_id',
      'expected_version','expected_content_hash','assessment_type','assessment_year',
      'assessment_date','manual_summary','result','reassessment','reason']
      or p_payload-array['mode','client_id','assessment_key','previous_version_id',
      'expected_version','expected_content_hash','assessment_type','assessment_year',
      'assessment_date','manual_summary','result','reassessment','reason']<>'{}'::jsonb then
      raise exception using errcode='22023',message='ABCD draft payload shape is invalid';
    end if;
    v_mode := p_payload->>'mode'; v_reason := nullif(btrim(p_payload->>'reason'),'');
    if v_mode not in ('create','revise') or v_reason is null or char_length(v_reason)>1000 then
      raise exception using errcode='22023',message='ABCD draft mode or reason is invalid';
    end if;
  elsif p_action='sign_assessment' then
    if not p_payload ?& array['client_id','assessment_key','previous_version_id','expected_version',
      'expected_content_hash','assessment_type','assessment_year']
      or p_payload-array['client_id','assessment_key','previous_version_id','expected_version',
      'expected_content_hash','assessment_type','assessment_year']<>'{}'::jsonb then
      raise exception using errcode='22023',message='ABCD sign payload shape is invalid';
    end if;
  else
    if not p_payload ?& array['client_id','assessment_key','previous_version_id','expected_version',
      'expected_content_hash','assessment_type','assessment_year','assessment_date','manual_summary',
      'result','reassessment','reason']
      or p_payload-array['client_id','assessment_key','previous_version_id','expected_version',
      'expected_content_hash','assessment_type','assessment_year','assessment_date','manual_summary',
      'result','reassessment','reason']<>'{}'::jsonb then
      raise exception using errcode='22023',message='ABCD correction payload shape is invalid';
    end if;
    v_reason := nullif(btrim(p_payload->>'reason'),'');
    if v_reason is null or char_length(v_reason) not between 8 and 1000 then
      raise exception using errcode='22023',message='ABCD correction reason is invalid';
    end if;
  end if;
  if v_reason is not null and translate(v_reason,E'\n\r\t','') ~ '[[:cntrl:]]' then
    raise exception using errcode='22023',message='ABCD assessment reason is invalid';
  end if;

  if p_action in ('save_assessment','correct_assessment') then
    begin v_assessment_date := (p_payload->>'assessment_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='ABCD assessment date is invalid';
    end;
    v_manual_summary := btrim(p_payload->>'manual_summary');
    if v_assessment_date is null or extract(year from v_assessment_date)::integer<>v_assessment_year
       or v_manual_summary is null or char_length(v_manual_summary) not between 1 and 8000
       or translate(v_manual_summary,E'\n\r\t','') ~ '[[:cntrl:]]'
       or not private.abcd_result_valid(p_payload->'result')
       or not private.abcd_reassessment_valid(p_payload->'reassessment',v_assessment_date) then
      raise exception using errcode='22023',message='ABCD manual candidate fields are invalid';
    end if;
    v_result_state := p_payload->'result'->>'state';
    v_result_text := case when v_result_state='recorded' then btrim(p_payload->'result'->>'text') end;
    v_result_reason := case when v_result_state<>'recorded' then btrim(p_payload->'result'->>'reason') end;
    v_reassessment_state := p_payload->'reassessment'->>'state';
    if v_reassessment_state='recorded' then
      begin v_reassessment_date := (p_payload->'reassessment'->>'date')::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='ABCD reassessment date is invalid';
      end;
    end if;
    v_reassessment_basis := btrim(p_payload->'reassessment'->>'basis');
  end if;

  if p_action='save_assessment' and v_mode='create' then
    if v_assessment_key is not null or v_previous_id is not null
       or coalesce(v_expected_version,-1)<>0 or v_expected_hash is not null then
      raise exception using errcode='22023',message='new ABCD assessment chain baseline is invalid';
    end if;
  elsif v_assessment_key is null or v_previous_id is null or coalesce(v_expected_version,0)<1
    or v_expected_hash is null or v_expected_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='ABCD assessment version baseline is invalid';
  end if;

  if p_action in ('sign_assessment','correct_assessment') then
    v_challenge_id := private.require_abcd_assessment_reauth(v_actor,v_now);
  end if;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'action',p_action,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'payload',p_payload
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'abcd-assessment-operation:'||v_actor::text||':'||p_idempotency_key::text,0));
  select operation.* into v_operation from private.abcd_assessment_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='ABCD assessment idempotency conflict';
    end if;
    if not private.abcd_assessment_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_operation.client_id,'abcd_assessments.manage') then
      raise exception using errcode='42501',message='ABCD assessment replay is not permitted';
    end if;
    select row.* into v_result from public.abcd_assessment_versions row
    where row.id=v_operation.result_version_id
      and row.organization_id=v_operation.organization_id
      and row.branch_id=v_operation.branch_id and row.client_id=v_operation.client_id;
    if v_result.id is null then
      raise exception using errcode='55000',message='ABCD assessment replay result is unavailable';
    end if;
    if v_result.previous_version_id is not null then
      select row.* into v_previous from public.abcd_assessment_versions row
      where row.id=v_result.previous_version_id
        and row.organization_id=v_result.organization_id
        and row.branch_id=v_result.branch_id and row.client_id=v_result.client_id;
      if v_previous.id is null then
        raise exception using errcode='55000',message='ABCD assessment replay source is unavailable';
      end if;
    end if;
    return query select v_operation.organization_id,v_operation.branch_id,v_operation.client_id,
      v_operation.id,v_operation.idempotency_key,v_operation.action,v_result.assessment_key,v_result.id,v_result.version,
      v_result.assessment_state,v_result.assessment_type,v_result.assessment_year,
      v_result.previous_version_id,v_previous.content_hash,v_result.content_hash,
      private.abcd_assessment_record_payload(v_result),v_operation.result_committed_at,true;
    return;
  end if;

  if p_action='save_assessment' and v_mode='create' then
    perform pg_advisory_xact_lock(hashtextextended(
      'abcd-assessment-identity:'||p_expected_organization_id::text||':'||
      p_expected_branch_id::text||':'||v_client_id::text||':'||
      v_assessment_year::text||':'||v_assessment_type,0));
    if exists (select 1 from public.abcd_assessment_versions row
      where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
        and row.client_id=v_client_id and row.assessment_year=v_assessment_year
        and row.assessment_type=v_assessment_type) then
      raise exception using errcode='23505',message='ABCD assessment identity already has a chain';
    end if;
    v_assessment_key := gen_random_uuid();
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'abcd-assessment-chain:'||p_expected_organization_id::text||':'||
      p_expected_branch_id::text||':'||v_assessment_key::text,0));
    select row.* into v_previous from public.abcd_assessment_versions row
    where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
      and row.client_id=v_client_id and row.assessment_key=v_assessment_key
      and not exists (select 1 from public.abcd_assessment_versions child
        where child.previous_version_id=row.id)
    order by row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id<>v_previous_id
       or v_previous.version<>v_expected_version or v_previous.content_hash<>v_expected_hash then
      raise exception using errcode='40001',message='ABCD assessment version is stale';
    end if;
    if v_previous.assessment_type<>v_assessment_type
       or v_previous.assessment_year<>v_assessment_year then
      raise exception using errcode='40001',message='ABCD assessment type or year cannot change';
    end if;
  end if;

  if p_action='save_assessment' then
    if v_mode='revise' and v_previous.assessment_state<>'draft' then
      raise exception using errcode='23514',message='only a draft ABCD assessment can be revised';
    end if;
    v_state := 'draft'; v_version := coalesce(v_previous.version,0)+1;
    if v_mode='create' then
      v_author_id := v_actor;
      select profile.display_name into v_author_name from public.profiles profile
      where profile.id=v_actor and profile.is_active;
    else
      v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name;
    end if;
  elsif p_action='correct_assessment' then
    if v_previous.assessment_state not in ('signed','corrected') then
      raise exception using errcode='23514',message='only signed ABCD assessment content can be corrected';
    end if;
    v_state := 'corrected'; v_version := v_previous.version+1;
    v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name;
  else
    if v_previous.assessment_state<>'draft' then
      raise exception using errcode='23514',message='only a draft ABCD assessment can be signed';
    end if;
    v_state := 'signed'; v_version := v_previous.version+1;
    v_author_id := v_previous.author_user_id; v_author_name := v_previous.author_display_name;
    v_assessment_date := v_previous.assessment_date; v_manual_summary := v_previous.manual_summary;
    v_result_state := v_previous.result_state; v_result_text := v_previous.result_text;
    v_result_reason := v_previous.result_reason; v_reassessment_state := v_previous.reassessment_state;
    v_reassessment_date := v_previous.reassessment_date;
    v_reassessment_basis := v_previous.reassessment_basis;
  end if;
  if v_author_name is null then
    raise exception using errcode='42501',message='ABCD assessment author identity is invalid';
  end if;
  if v_state<>'draft' then
    select profile.display_name into v_signer_name from public.profiles profile
    where profile.id=v_actor and profile.is_active;
    select coalesce(array_agg(distinct role.role_key order by role.role_key),'{}'::text[])
      into v_signer_roles from public.memberships membership
      join public.membership_roles membership_role on membership_role.membership_id=membership.id
      join public.roles role on role.id=membership_role.role_id and role.is_active
    where membership.profile_id=v_actor and membership.organization_id=p_expected_organization_id
      and membership.status='active' and membership.starts_at<=v_now
      and (membership.ends_at is null or membership.ends_at>v_now)
      and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
      and (role.organization_id is null or role.organization_id=p_expected_organization_id);
    if v_signer_name is null or cardinality(v_signer_roles)=0 then
      raise exception using errcode='42501',message='ABCD assessment signer identity is invalid';
    end if;
  end if;
  if not private.abcd_assessment_client_authority(p_expected_organization_id,
    p_expected_branch_id,v_client_id,'abcd_assessments.manage') then
    raise exception using errcode='42501',message='ABCD assessment authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'client_id',v_client_id,
    'assessment_key',v_assessment_key,'version',v_version,'previous_version_id',v_previous_id,
    'assessment_state',v_state,'assessment_type',v_assessment_type,
    'assessment_year',v_assessment_year,'assessment_date',v_assessment_date,
    'manual_summary',v_manual_summary,'result',jsonb_build_object('state',v_result_state,
      'text',v_result_text,'reason',v_result_reason),
    'reassessment',jsonb_build_object('state',v_reassessment_state,'date',v_reassessment_date,
      'basis',v_reassessment_basis),'author_user_id',v_author_id,'reason',v_reason,
    'signed_by',case when v_state='draft' then null else v_actor end,
    'signed_at',case when v_state='draft' then null else v_now end,
    'form_kind','manual_unstandardized','formal_rule_status','not_configured'
  )::text,'UTF8')),'hex');
  insert into public.abcd_assessment_versions (
    organization_id,branch_id,client_id,assessment_key,version,previous_version_id,
    content_hash,assessment_state,assessment_type,assessment_year,assessment_date,
    manual_summary,result_state,result_text,result_reason,reassessment_state,
    reassessment_date,reassessment_basis,author_user_id,author_display_name,
    revision_reason,correction_reason,signed_at,signed_by,signer_display_name,
    signer_role_keys,signature_purpose,signature_reauth_challenge_id,form_kind,
    formal_rule_status,created_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_assessment_key,
    v_version,v_previous_id,v_content_hash,v_state,v_assessment_type,v_assessment_year,
    v_assessment_date,v_manual_summary,v_result_state,v_result_text,v_result_reason,
    v_reassessment_state,v_reassessment_date,v_reassessment_basis,v_author_id,v_author_name,
    case when v_state='draft' then v_reason end,
    case when v_state='corrected' then v_reason end,
    case when v_state='draft' then null else v_now end,
    case when v_state='draft' then null else v_actor end,
    case when v_state='draft' then null else v_signer_name end,
    case when v_state='draft' then null else v_signer_roles end,
    case when v_state='signed' then 'ABCD 人工候選評估簽署'
      when v_state='corrected' then 'ABCD 人工候選評估更正簽署' end,
    v_challenge_id,'manual_unstandardized','not_configured',v_now
  ) returning * into v_result;
  insert into private.abcd_assessment_operations (
    organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_hash,
    action,result_assessment_key,result_version_id,result_version,result_state,
    result_assessment_type,result_assessment_year,result_content_hash,
    result_committed_at,reauth_challenge_id
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client_id,v_actor,
    p_idempotency_key,v_request_hash,p_action,v_result.assessment_key,v_result.id,
    v_result.version,v_result.assessment_state,v_result.assessment_type,
    v_result.assessment_year,v_result.content_hash,v_result.created_at,v_challenge_id
  ) returning * into v_operation;
  insert into public.audit_events (organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,idempotency_key,changed_fields,metadata) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,
    case when v_state='draft' then 'insert' when v_state='corrected' then 'correct' else 'sign' end,
    'abcd_assessment_versions',v_result.id::text,p_idempotency_key,
    array['assessment_state','version','assessment_type','assessment_year','assessment_date',
      'result_state','reassessment_state'],
    jsonb_build_object('workflow','page21_abcd_manual_candidate_v1',
      'assessment_key',v_result.assessment_key,'version',v_result.version,
      'state',v_result.assessment_state,'assessment_type',v_result.assessment_type,
      'assessment_year',v_result.assessment_year,'client_id',v_client_id,
      'formal_rule_status','not_configured','narrative_logged',false)
  );
  if not private.abcd_assessment_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_client_id,'abcd_assessments.manage')
    or not exists (select 1 from public.abcd_assessment_versions row where row.id=v_result.id
      and not exists (select 1 from public.abcd_assessment_versions child
        where child.previous_version_id=row.id)) then
    raise exception using errcode='42501',message='ABCD assessment final verification failed';
  end if;
  return query select p_expected_organization_id,p_expected_branch_id,v_client_id,
    v_operation.id,v_operation.idempotency_key,v_operation.action,v_result.assessment_key,v_result.id,v_result.version,
    v_result.assessment_state,v_result.assessment_type,v_result.assessment_year,
    v_result.previous_version_id,v_previous.content_hash,v_result.content_hash,
    private.abcd_assessment_record_payload(v_result),v_result.created_at,false;
end;
$$;

create or replace function public.mutate_abcd_assessment(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_payload jsonb, p_idempotency_key uuid
) returns table(organization_id uuid, branch_id uuid, client_id uuid,
  operation_id uuid, idempotency_key uuid, action text, assessment_key uuid,
  version_id uuid, version integer, assessment_state text, assessment_type text,
  assessment_year integer, previous_version_id uuid, source_content_hash text,
  content_hash text, record_payload jsonb, committed_at timestamptz, replayed boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_abcd_assessment_guarded(p_expected_organization_id,
    p_expected_branch_id,p_action,p_payload,p_idempotency_key);
$$;

create or replace function private.abcd_assessment_version_json(
  p_row public.abcd_assessment_versions, p_client_display_name text
) returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'version_id',p_row.id,'assessment_key',p_row.assessment_key,'version',p_row.version,
    'previous_version_id',p_row.previous_version_id,'content_hash',p_row.content_hash,
    'assessment_state',p_row.assessment_state,'client_id',p_row.client_id,
    'client_display_name',p_client_display_name,'assessment_type',p_row.assessment_type,
    'assessment_year',p_row.assessment_year,'assessment_date',p_row.assessment_date,
    'manual_summary',p_row.manual_summary,'result_state',p_row.result_state,
    'result_text',p_row.result_text,'result_reason',p_row.result_reason,
    'reassessment_state',p_row.reassessment_state,'reassessment_date',p_row.reassessment_date,
    'reassessment_basis',p_row.reassessment_basis,'author_user_id',p_row.author_user_id,
    'author_display_name',p_row.author_display_name,'revision_reason',p_row.revision_reason,
    'correction_reason',p_row.correction_reason,'signed_at',p_row.signed_at,
    'signed_by_user_id',p_row.signed_by,'signer_display_name',p_row.signer_display_name,
    'signer_role_keys',p_row.signer_role_keys,'signature_purpose',p_row.signature_purpose,
    'signature_reauth_challenge_id',p_row.signature_reauth_challenge_id,
    'form_kind',p_row.form_kind,'formal_rule_status',p_row.formal_rule_status,
    'created_at',p_row.created_at
  );
$$;

create or replace function private.abcd_assessment_snapshot_response(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_assessment_year integer default null,
  p_assessment_type text default null, p_reassessment_state text default null,
  p_assessment_state text default null, p_query text default null
) returns table(organization_id uuid, branch_id uuid, generated_at timestamptz,
  assessments jsonb, matching_total bigint, assessments_truncated boolean,
  assessment_total bigint, a_total bigint, b_total bigint, c_total bigint,
  d_total bigint, reassessment_missing_total bigint, draft_total bigint,
  signed_total bigint, clients jsonb, client_total bigint, clients_truncated boolean,
  years jsonb, year_total bigint, years_truncated boolean, form_kind text,
  formal_rule_status text, attachment_status text, notification_status text,
  export_status text, offline_status text)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
begin
  if not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.read')
    or (p_client_id is not null and not private.abcd_assessment_client_authority(
      p_expected_organization_id,p_expected_branch_id,p_client_id,'abcd_assessments.read'))
    or (p_assessment_year is not null and p_assessment_year not between 2000 and 2200)
    or (p_assessment_type is not null and p_assessment_type not in ('A','B','C','D'))
    or (p_reassessment_state is not null and p_reassessment_state not in ('recorded','missing','not_applicable'))
    or (p_assessment_state is not null and p_assessment_state not in ('draft','signed','corrected'))
    or (p_query is not null and (char_length(btrim(p_query)) not between 1 and 120
      or btrim(p_query) ~ '[[:cntrl:]]')) then
    raise exception using errcode='42501',message='ABCD assessment snapshot is not permitted';
  end if;
  return query
  with current_assessments as (
    select row.* from public.abcd_assessment_versions row
    where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
      and private.can_staff_access_client(row.client_id,'clients.read')
      and private.can_staff_access_client(row.client_id,'abcd_assessments.read')
      and not exists (select 1 from public.abcd_assessment_versions child
        where child.previous_version_id=row.id)
  ), matching as (
    select row.* from current_assessments row join public.clients client on client.id=row.client_id
    where (p_client_id is null or row.client_id=p_client_id)
      and (p_assessment_year is null or row.assessment_year=p_assessment_year)
      and (p_assessment_type is null or row.assessment_type=p_assessment_type)
      and (p_reassessment_state is null or row.reassessment_state=p_reassessment_state)
      and (p_assessment_state is null or row.assessment_state=p_assessment_state)
      and (p_query is null or client.display_name ilike '%'||btrim(p_query)||'%'
        or row.assessment_key::text ilike '%'||btrim(p_query)||'%')
  ), page as (
    select row.* from matching row
    order by row.assessment_date desc,row.client_id,row.assessment_type,row.assessment_key limit 200
  ), client_options as (
    select client.id,client.display_name from public.clients client
    where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
      and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'abcd_assessments.read')
    order by client.display_name,client.id limit 200
  ), year_options as (
    select distinct row.assessment_year from current_assessments row
    order by row.assessment_year desc limit 200
  )
  select p_expected_organization_id,p_expected_branch_id,v_now,
    coalesce((select jsonb_agg(
      private.abcd_assessment_version_json(row,client.display_name)||jsonb_build_object(
        'history',coalesce((select jsonb_agg(
          private.abcd_assessment_version_json(history,client.display_name)
          order by history.version)
          from (select item.* from public.abcd_assessment_versions item
            where item.organization_id=row.organization_id and item.branch_id=row.branch_id
              and item.client_id=row.client_id and item.assessment_key=row.assessment_key
            order by item.version limit 50) history),'[]'::jsonb),
        'history_total',(select count(*) from public.abcd_assessment_versions history
          where history.organization_id=row.organization_id and history.branch_id=row.branch_id
            and history.client_id=row.client_id and history.assessment_key=row.assessment_key)
      ) order by row.assessment_date desc,row.client_id,row.assessment_type,row.assessment_key)
      from page row join public.clients client on client.id=row.client_id),'[]'::jsonb),
    (select count(*) from matching),(select count(*) from matching)>200,
    (select count(*) from matching),(select count(*) from matching row where row.assessment_type='A'),
    (select count(*) from matching row where row.assessment_type='B'),
    (select count(*) from matching row where row.assessment_type='C'),
    (select count(*) from matching row where row.assessment_type='D'),
    (select count(*) from matching row where row.reassessment_state='missing'),
    (select count(*) from matching row where row.assessment_state='draft'),
    (select count(*) from matching row where row.assessment_state in ('signed','corrected')),
    coalesce((select jsonb_agg(jsonb_build_object('client_id',option.id,
      'display_name',option.display_name) order by option.display_name,option.id)
      from client_options option),'[]'::jsonb),
    (select count(*) from public.clients client
      where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
        and private.can_staff_access_client(client.id,'clients.read')
        and private.can_staff_access_client(client.id,'abcd_assessments.read')),
    (select count(*) from public.clients client
      where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
        and private.can_staff_access_client(client.id,'clients.read')
        and private.can_staff_access_client(client.id,'abcd_assessments.read'))>200,
    coalesce((select jsonb_agg(option.assessment_year order by option.assessment_year desc)
      from year_options option),'[]'::jsonb),
    (select count(distinct row.assessment_year) from current_assessments row),
    (select count(distinct row.assessment_year) from current_assessments row)>200,
    'manual_unstandardized','not_configured','not_configured','not_configured',
    'not_configured','not_configured';
  insert into public.audit_events (organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'abcd_assessment_versions','snapshot',array[]::text[],jsonb_build_object(
      'workflow','page21_abcd_manual_candidate_snapshot_v1','filters_logged',false,
      'narrative_logged',false,'formal_rule_status','not_configured'));
  if not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.read') then
    raise exception using errcode='42501',message='ABCD assessment snapshot authority expired';
  end if;
end;
$$;

create or replace function public.abcd_assessment_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_assessment_year integer default null,
  p_assessment_type text default null, p_reassessment_state text default null,
  p_assessment_state text default null, p_query text default null
) returns table(organization_id uuid, branch_id uuid, generated_at timestamptz,
  assessments jsonb, matching_total bigint, assessments_truncated boolean,
  assessment_total bigint, a_total bigint, b_total bigint, c_total bigint,
  d_total bigint, reassessment_missing_total bigint, draft_total bigint,
  signed_total bigint, clients jsonb, client_total bigint, clients_truncated boolean,
  years jsonb, year_total bigint, years_truncated boolean, form_kind text,
  formal_rule_status text, attachment_status text, notification_status text,
  export_status text, offline_status text)
language sql volatile security invoker set search_path = '' as $$
  select * from private.abcd_assessment_snapshot_response(p_expected_organization_id,
    p_expected_branch_id,p_client_id,p_assessment_year,p_assessment_type,
    p_reassessment_state,p_assessment_state,p_query);
$$;

revoke all on function private.abcd_assessment_history_is_append_only() from public,anon,authenticated,service_role;
revoke all on function private.abcd_assessment_current_authority(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.abcd_assessment_client_authority(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.require_abcd_assessment_reauth(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.abcd_result_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.abcd_reassessment_valid(jsonb,date) from public,anon,authenticated,service_role;
revoke all on function private.abcd_assessment_version_json(public.abcd_assessment_versions,text) from public,anon,authenticated,service_role;
revoke all on function private.abcd_assessment_record_payload(public.abcd_assessment_versions) from public,anon,authenticated,service_role;
revoke all on function private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
revoke all on function private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text) from public,anon,service_role;
revoke all on function public.mutate_abcd_assessment(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
revoke all on function public.abcd_assessment_snapshot(uuid,uuid,uuid,integer,text,text,text,text) from public,anon,service_role;
grant execute on function private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text) to authenticated;
grant execute on function public.mutate_abcd_assessment(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.abcd_assessment_snapshot(uuid,uuid,uuid,integer,text,text,text,text) to authenticated;
