-- Page 41: immutable occupational-therapy service records.
--
-- This domain is intentionally separate from Page 33 assessments. A service
-- version may freeze the latest terminal Page 33 assessment as a read-only
-- reference selected by the database. The browser cannot nominate or mutate
-- that reference. No treatment formula, diagnosis, or automatic recommendation
-- is inferred.

insert into public.permissions (permission_key, description, risk_level) values
  ('occupational_therapy_services.read',
    'Read assigned-client occupational therapy service records', 2),
  ('occupational_therapy_services.manage',
    'Create and revise assigned-client occupational therapy service drafts', 2),
  ('occupational_therapy_services.sign',
    'Sign or correct assigned-client occupational therapy service records', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'professional'
  )
  and permission.permission_key = 'occupational_therapy_services.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key = 'professional'
  and permission.permission_key in (
    'occupational_therapy_services.manage', 'occupational_therapy_services.sign'
  )
on conflict (role_id, permission_id) do nothing;

create or replace function private.occupational_therapy_service_value_is_valid(
  p_value jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'object'
    and (select count(*) from jsonb_object_keys(p_value)) = 3
    and p_value ?& array['state', 'text', 'reason']
    and jsonb_typeof(p_value -> 'state') = 'string'
    and p_value ->> 'state' in ('recorded', 'missing', 'not_applicable')
    and (
      (
        p_value ->> 'state' = 'recorded'
        and jsonb_typeof(p_value -> 'text') = 'string'
        and char_length(btrim(p_value ->> 'text')) between 1 and 5000
        and p_value ->> 'text' = btrim(p_value ->> 'text')
        and translate(p_value ->> 'text', E'\n\r\t', '') !~ '[[:cntrl:]]'
        and p_value -> 'reason' = 'null'::jsonb
      ) or (
        p_value ->> 'state' in ('missing', 'not_applicable')
        and p_value -> 'text' = 'null'::jsonb
        and jsonb_typeof(p_value -> 'reason') = 'string'
        and char_length(btrim(p_value ->> 'reason')) between 1 and 1000
        and p_value ->> 'reason' = btrim(p_value ->> 'reason')
        and translate(p_value ->> 'reason', E'\n\r\t', '') !~ '[[:cntrl:]]'
      )
    );
$$;

create table public.occupational_therapy_service_record_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  record_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_state text not null,
  occurred_at timestamptz not null,
  service_content jsonb not null,
  client_reaction jsonb not null,
  recommendation jsonb not null,
  therapist_user_id uuid not null references auth.users(id) on delete restrict,
  therapist_display_name text not null,
  service_status_at_occurrence text not null,
  assessment_reference_version_id uuid,
  assessment_reference_key uuid,
  assessment_reference_version integer,
  assessment_reference_assessed_on date,
  assessment_reference_therapist_display_name text,
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
  constraint occupational_therapy_service_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint occupational_therapy_service_id_scope_key unique (
    id, organization_id, branch_id, client_id, record_key
  ),
  constraint occupational_therapy_service_chain_key unique (
    organization_id, branch_id, record_key, version
  ),
  constraint occupational_therapy_service_previous_key unique (previous_version_id),
  constraint occupational_therapy_service_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id, record_key
    ) references public.occupational_therapy_service_record_versions (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint occupational_therapy_service_assessment_scope_fkey
    foreign key (
      assessment_reference_version_id, organization_id, branch_id, client_id,
      assessment_reference_key
    ) references public.occupational_therapy_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint occupational_therapy_service_version_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null)
    )
  ),
  constraint occupational_therapy_service_state_check check (
    record_state in ('draft', 'signed', 'corrected')
  ),
  constraint occupational_therapy_service_time_check check (
    extract(year from occurred_at at time zone 'Asia/Taipei')
      between 2000 and 2200
    and occurred_at <= created_at + interval '5 minutes'
  ),
  constraint occupational_therapy_service_content_check check (
    private.occupational_therapy_service_value_is_valid(service_content)
  ),
  constraint occupational_therapy_service_reaction_check check (
    private.occupational_therapy_service_value_is_valid(client_reaction)
  ),
  constraint occupational_therapy_service_recommendation_check check (
    private.occupational_therapy_service_value_is_valid(recommendation)
  ),
  constraint occupational_therapy_service_therapist_check check (
    char_length(therapist_display_name) between 1 and 120
    and therapist_display_name = btrim(therapist_display_name)
    and therapist_display_name !~ '[[:cntrl:]]'
  ),
  constraint occupational_therapy_service_status_check check (
    service_status_at_occurrence in (
      'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  ),
  constraint occupational_therapy_service_assessment_alignment_check check (
    (
      assessment_reference_version_id is null
      and assessment_reference_key is null
      and assessment_reference_version is null
      and assessment_reference_assessed_on is null
      and assessment_reference_therapist_display_name is null
    ) or (
      assessment_reference_version_id is not null
      and assessment_reference_key is not null
      and assessment_reference_version > 0
      and assessment_reference_assessed_on is not null
      and assessment_reference_assessed_on <=
        (occurred_at at time zone 'Asia/Taipei')::date
      and assessment_reference_therapist_display_name is not null
      and char_length(assessment_reference_therapist_display_name)
        between 1 and 120
      and assessment_reference_therapist_display_name =
        btrim(assessment_reference_therapist_display_name)
      and assessment_reference_therapist_display_name !~ '[[:cntrl:]]'
    )
  ),
  constraint occupational_therapy_service_signature_alignment_check check (
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
        then '職能治療服務紀錄簽署'
        else '職能治療服務紀錄更正簽署' end
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
  constraint occupational_therapy_service_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.occupational_therapy_service_record_versions is
  'Immutable Page 41 service-record versions. Signed rows are superseded only by a reasoned, signed correction.';
comment on column public.occupational_therapy_service_record_versions.assessment_reference_version_id is
  'Database-selected read-only reference to the latest terminal Page 33 assessment effective at occurred_at; never browser-selected.';

create table private.occupational_therapy_service_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_state text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint occupational_therapy_service_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint occupational_therapy_service_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, client_id,
      result_record_key
    ) references public.occupational_therapy_service_record_versions (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint occupational_therapy_service_operations_kind_check check (
    operation_kind in ('create_draft', 'revise_draft', 'sign', 'correct')
  ),
  constraint occupational_therapy_service_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint occupational_therapy_service_operations_version_check
    check (result_version > 0),
  constraint occupational_therapy_service_operations_state_check
    check (result_state in ('draft', 'signed', 'corrected')),
  constraint occupational_therapy_service_operations_reauth_check check (
    (operation_kind in ('create_draft', 'revise_draft')
      and reauth_challenge_id is null)
    or (operation_kind in ('sign', 'correct')
      and reauth_challenge_id is not null)
  )
);

create index occupational_therapy_services_scope_occurred_idx
  on public.occupational_therapy_service_record_versions (
    organization_id, branch_id, occurred_at desc, record_key, version desc
  );
create index occupational_therapy_services_client_idx
  on public.occupational_therapy_service_record_versions (
    client_id, occurred_at desc, record_key, version desc
  );
create index occupational_therapy_services_previous_idx
  on public.occupational_therapy_service_record_versions (previous_version_id)
  where previous_version_id is not null;
create index occupational_therapy_services_therapist_idx
  on public.occupational_therapy_service_record_versions (therapist_user_id);
create index occupational_therapy_services_assessment_ref_idx
  on public.occupational_therapy_service_record_versions (
    assessment_reference_version_id
  ) where assessment_reference_version_id is not null;
create index occupational_therapy_services_assessment_key_idx
  on public.occupational_therapy_service_record_versions (
    assessment_reference_key
  ) where assessment_reference_key is not null;
create index occupational_therapy_services_signed_by_idx
  on public.occupational_therapy_service_record_versions (signed_by)
  where signed_by is not null;
create index occupational_therapy_services_reauth_idx
  on public.occupational_therapy_service_record_versions (
    signature_reauth_challenge_id
  ) where signature_reauth_challenge_id is not null;
create index occupational_therapy_service_operations_result_idx
  on private.occupational_therapy_service_operations (result_version_id);
create index occupational_therapy_service_operations_result_scope_idx
  on private.occupational_therapy_service_operations (
    organization_id, branch_id, client_id, result_record_key
  );
create index occupational_therapy_service_operations_reauth_idx
  on private.occupational_therapy_service_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.occupational_therapy_service_record_versions
  enable row level security;
alter table public.occupational_therapy_service_record_versions
  force row level security;
alter table private.occupational_therapy_service_operations enable row level security;
alter table private.occupational_therapy_service_operations force row level security;

revoke all on table public.occupational_therapy_service_record_versions
  from public, anon, authenticated, service_role;
revoke all on table private.occupational_therapy_service_operations
  from public, anon, authenticated, service_role;

create or replace function private.occupational_therapy_service_history_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'occupational therapy service history is append-only';
end;
$$;

create trigger occupational_therapy_service_record_versions_append_only
before update or delete on public.occupational_therapy_service_record_versions
for each row execute function private.occupational_therapy_service_history_is_append_only();
create trigger occupational_therapy_service_operations_append_only
before update or delete on private.occupational_therapy_service_operations
for each row execute function private.occupational_therapy_service_history_is_append_only();

create trigger occupational_therapy_service_record_versions_audit_row_change
after insert on public.occupational_therapy_service_record_versions
for each row execute function private.audit_row_change();
create trigger occupational_therapy_service_operations_audit_row_change
after insert on private.occupational_therapy_service_operations
for each row execute function private.audit_row_change();

create or replace function private.occupational_therapy_service_current_authority(
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
      'occupational_therapy_services.read',
      'occupational_therapy_services.manage',
      'occupational_therapy_services.sign'
    )
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.is_active
        and (
          (p_permission = 'occupational_therapy_services.read'
            and profile.kind in ('staff', 'professional'))
          or (p_permission in (
            'occupational_therapy_services.manage',
            'occupational_therapy_services.sign'
          ) and profile.kind = 'professional')
        )
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

create or replace function private.occupational_therapy_service_client_authority(
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
  select private.occupational_therapy_service_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission
    )
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
    )
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(
      p_client_id, 'occupational_therapy_services.read'
    )
    and (
      p_permission = 'occupational_therapy_services.read'
      or private.can_staff_access_client(p_client_id, p_permission)
    );
$$;

create or replace function private.require_occupational_therapy_service_reauth(
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
      message = 'recent same-session AAL2 is required for occupational therapy service signing';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'recent same-session AAL2 is required for occupational therapy service signing';
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
      message = 'recent same-session AAL2 is required for occupational therapy service signing';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_occupational_therapy_service_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_occurred_at timestamptz,
  p_service_content jsonb,
  p_client_reaction jsonb,
  p_recommendation jsonb,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  organization_id uuid,
  branch_id uuid,
  client_id uuid,
  record_key uuid,
  version_id uuid,
  record_version integer,
  record_state text,
  occurred_at timestamptz,
  therapist_user_id uuid,
  service_status_at_occurrence text,
  assessment_reference_version_id uuid,
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
  v_operation private.occupational_therapy_service_operations%rowtype;
  v_previous public.occupational_therapy_service_record_versions%rowtype;
  v_result public.occupational_therapy_service_record_versions%rowtype;
  v_record_key uuid;
  v_version integer;
  v_state text;
  v_therapist_display_name text;
  v_service_status text;
  v_signer_display_name text;
  v_signer_role_keys text[];
  v_challenge_id uuid;
  v_occurred_at timestamptz;
  v_service_content jsonb;
  v_client_reaction jsonb;
  v_recommendation jsonb;
  v_assessment_version_id uuid;
  v_assessment_key uuid;
  v_assessment_version integer;
  v_assessment_assessed_on date;
  v_assessment_therapist_display_name text;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_content_hash text;
begin
  if p_action not in ('create_draft', 'revise_draft', 'sign', 'correct')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_idempotency_key is null
     or not private.occupational_therapy_service_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'occupational_therapy_services.sign'
         else 'occupational_therapy_services.manage' end
     ) then
    raise exception using errcode = '42501',
      message = 'occupational therapy service operation is not permitted';
  end if;

  if p_action = 'create_draft' then
    if p_record_key is not null or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = '22023',
        message = 'new occupational therapy service chain input is invalid';
    end if;
  elsif p_record_key is null or p_previous_version_id is null
        or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023',
      message = 'occupational therapy service chain input is invalid';
  end if;

  if p_action in ('create_draft', 'revise_draft', 'correct') then
    if p_occurred_at is null
       or extract(year from p_occurred_at at time zone 'Asia/Taipei')
         not between 2000 and 2200
       or not private.occupational_therapy_service_value_is_valid(p_service_content)
       or not private.occupational_therapy_service_value_is_valid(p_client_reaction)
       or not private.occupational_therapy_service_value_is_valid(p_recommendation)
       or (p_action = 'correct' and (
         v_reason is null or char_length(v_reason) > 1000
         or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       ))
       or (p_action <> 'correct' and v_reason is not null) then
      raise exception using errcode = '22023',
        message = 'occupational therapy service content is invalid';
    end if;
  elsif p_occurred_at is not null or p_service_content is not null
        or p_client_reaction is not null or p_recommendation is not null
        or v_reason is not null then
    raise exception using errcode = '22023',
      message = 'occupational therapy service signing must use the exact draft';
  end if;

  if p_action in ('sign', 'correct') then
    v_challenge_id := private.require_occupational_therapy_service_reauth(
      v_actor, v_now
    );
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'record_key', p_record_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version,
    'occurred_at', p_occurred_at,
    'service_content', p_service_content,
    'client_reaction', p_client_reaction,
    'recommendation', p_recommendation,
    'correction_reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'occupational-therapy-service-operation:' || v_actor::text || ':' ||
    p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.occupational_therapy_service_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'occupational therapy service idempotency conflict';
    end if;
    if not private.occupational_therapy_service_client_authority(
      p_expected_organization_id, p_expected_branch_id,
      v_operation.client_id,
      case when p_action in ('sign', 'correct')
        then 'occupational_therapy_services.sign'
        else 'occupational_therapy_services.manage' end
    ) then
      raise exception using errcode = '42501',
        message = 'occupational therapy service replay is not permitted';
    end if;
    select version_row.* into strict v_result
    from public.occupational_therapy_service_record_versions version_row
    where version_row.id = v_operation.result_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.record_key = v_operation.result_record_key;
    return query select v_operation.id, v_result.organization_id,
      v_result.branch_id, v_result.client_id, v_result.record_key,
      v_result.id, v_result.version, v_result.record_state,
      v_result.occurred_at, v_result.therapist_user_id,
      v_result.service_status_at_occurrence,
      v_result.assessment_reference_version_id,
      v_operation.result_committed_at, true;
    return;
  end if;

  v_record_key := coalesce(p_record_key, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'occupational-therapy-service-chain:' ||
    p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || v_record_key::text, 0
  ));

  if p_action <> 'create_draft' then
    select version_row.* into v_previous
    from public.occupational_therapy_service_record_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.record_key = v_record_key
      and not exists (
        select 1 from public.occupational_therapy_service_record_versions child
        where child.previous_version_id = version_row.id
      )
    order by version_row.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> p_previous_version_id
       or v_previous.version <> p_expected_version then
      raise exception using errcode = '40001',
        message = 'occupational therapy service version is stale';
    end if;
  end if;

  if p_action = 'create_draft' then
    v_version := 1; v_state := 'draft';
    v_occurred_at := p_occurred_at;
    v_service_content := p_service_content;
    v_client_reaction := p_client_reaction;
    v_recommendation := p_recommendation;
  elsif p_action = 'revise_draft' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514',
        message = 'signed occupational therapy service content requires correction';
    end if;
    v_version := v_previous.version + 1; v_state := 'draft';
    v_occurred_at := p_occurred_at;
    v_service_content := p_service_content;
    v_client_reaction := p_client_reaction;
    v_recommendation := p_recommendation;
  elsif p_action = 'sign' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514',
        message = 'only the current occupational therapy service draft can be signed';
    end if;
    if v_previous.therapist_user_id <> v_actor then
      raise exception using errcode = '42501',
        message = 'only the current occupational therapist may sign this draft';
    end if;
    v_version := v_previous.version + 1; v_state := 'signed';
    v_occurred_at := v_previous.occurred_at;
    v_service_content := v_previous.service_content;
    v_client_reaction := v_previous.client_reaction;
    v_recommendation := v_previous.recommendation;
    v_assessment_version_id := v_previous.assessment_reference_version_id;
    v_assessment_key := v_previous.assessment_reference_key;
    v_assessment_version := v_previous.assessment_reference_version;
    v_assessment_assessed_on := v_previous.assessment_reference_assessed_on;
    v_assessment_therapist_display_name :=
      v_previous.assessment_reference_therapist_display_name;
  else
    if v_previous.record_state not in ('signed', 'corrected') then
      raise exception using errcode = '23514',
        message = 'only signed occupational therapy service content can be corrected';
    end if;
    v_version := v_previous.version + 1; v_state := 'corrected';
    v_occurred_at := p_occurred_at;
    v_service_content := p_service_content;
    v_client_reaction := p_client_reaction;
    v_recommendation := p_recommendation;
  end if;

  if v_occurred_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023',
      message = 'future occupational therapy service occurrence is invalid';
  end if;

  select profile.display_name into v_therapist_display_name
  from public.profiles profile
  where profile.id = v_actor and profile.is_active
    and profile.kind = 'professional';
  select client.status::text into v_service_status
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
    and client.admitted_on <=
      (v_occurred_at at time zone 'Asia/Taipei')::date
    and (client.ended_on is null or client.ended_on >=
      (v_occurred_at at time zone 'Asia/Taipei')::date);
  if v_therapist_display_name is null or v_service_status is null then
    raise exception using errcode = '42501',
      message = 'occupational therapist or service occurrence is not eligible';
  end if;

  if p_action <> 'sign' then
    select assessment.id, assessment.assessment_key, assessment.version,
      assessment.assessed_on, assessment.therapist_display_name
    into v_assessment_version_id, v_assessment_key, v_assessment_version,
      v_assessment_assessed_on, v_assessment_therapist_display_name
    from public.occupational_therapy_assessment_versions assessment
    where assessment.organization_id = p_expected_organization_id
      and assessment.branch_id = p_expected_branch_id
      and assessment.client_id = p_client_id
      and assessment.record_state in ('signed', 'corrected')
      and assessment.assessed_on <=
        (v_occurred_at at time zone 'Asia/Taipei')::date
      and not exists (
        select 1 from public.occupational_therapy_assessment_versions child
        where child.previous_version_id = assessment.id
      )
    order by assessment.assessed_on desc, assessment.created_at desc,
      assessment.assessment_key, assessment.version desc
    limit 1;
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
        message = 'occupational therapy service signer identity is invalid';
    end if;
  end if;

  if not private.occupational_therapy_service_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    case when p_action in ('sign', 'correct')
      then 'occupational_therapy_services.sign'
      else 'occupational_therapy_services.manage' end
  ) then
    raise exception using errcode = '42501',
      message = 'occupational therapy service authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'record_key', v_record_key, 'version', v_version,
    'previous_version_id', p_previous_version_id, 'record_state', v_state,
    'occurred_at', v_occurred_at,
    'service_content', v_service_content,
    'client_reaction', v_client_reaction,
    'recommendation', v_recommendation,
    'therapist_user_id', v_actor,
    'service_status_at_occurrence', v_service_status,
    'assessment_reference_version_id', v_assessment_version_id,
    'assessment_reference_key', v_assessment_key,
    'assessment_reference_version', v_assessment_version,
    'assessment_reference_assessed_on', v_assessment_assessed_on,
    'correction_reason', case when v_state = 'corrected' then v_reason else null end,
    'signed_by', case when v_state = 'draft' then null else v_actor end,
    'signed_at', case when v_state = 'draft' then null else v_now end
  )::text, 'UTF8')), 'hex');

  insert into public.occupational_therapy_service_record_versions (
    organization_id, branch_id, client_id, record_key, version,
    previous_version_id, record_state, occurred_at, service_content,
    client_reaction, recommendation, therapist_user_id,
    therapist_display_name, service_status_at_occurrence,
    assessment_reference_version_id, assessment_reference_key,
    assessment_reference_version, assessment_reference_assessed_on,
    assessment_reference_therapist_display_name, correction_reason,
    signed_at, signed_by, signer_display_name, signer_role_keys,
    signature_purpose, signature_reauth_challenge_id, content_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_record_key, v_version, p_previous_version_id, v_state,
    v_occurred_at, v_service_content, v_client_reaction, v_recommendation,
    v_actor, v_therapist_display_name, v_service_status,
    v_assessment_version_id, v_assessment_key, v_assessment_version,
    v_assessment_assessed_on, v_assessment_therapist_display_name,
    case when v_state = 'corrected' then v_reason else null end,
    case when v_state = 'draft' then null else v_now end,
    case when v_state = 'draft' then null else v_actor end,
    case when v_state = 'draft' then null else v_signer_display_name end,
    case when v_state = 'draft' then null else v_signer_role_keys end,
    case when v_state = 'signed' then '職能治療服務紀錄簽署'
      when v_state = 'corrected' then '職能治療服務紀錄更正簽署'
      else null end,
    v_challenge_id, v_content_hash, v_now
  ) returning * into v_result;

  insert into private.occupational_therapy_service_operations (
    organization_id, branch_id, client_id, actor_user_id, operation_kind,
    idempotency_key, request_hash, result_record_key, result_version_id,
    result_version, result_state, result_committed_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_action, p_idempotency_key, v_request_hash, v_result.record_key,
    v_result.id, v_result.version, v_result.record_state, v_result.created_at,
    v_challenge_id
  ) returning id into v_operation.id;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when p_action = 'sign' then 'sign'
      when p_action = 'correct' then 'correct' else 'insert' end,
    'occupational_therapy_service_record_versions', v_result.id::text,
    p_idempotency_key,
    array['record_state', 'version', 'occurred_at', 'service_content',
      'client_reaction', 'recommendation',
      'assessment_reference_version_id'],
    jsonb_build_object(
      'workflow', 'page41_occupational_therapy_service_v1',
      'version', v_result.version, 'state', v_result.record_state,
      'assessment_linked', v_result.assessment_reference_version_id is not null,
      'contains_narrative', true, 'narrative_logged', false
    )
  );

  if not private.occupational_therapy_service_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'occupational_therapy_services.sign'
         else 'occupational_therapy_services.manage' end
     )
     or not exists (
       select 1 from public.occupational_therapy_service_record_versions version_row
       where version_row.id = v_result.id
         and version_row.organization_id = p_expected_organization_id
         and version_row.branch_id = p_expected_branch_id
         and version_row.client_id = p_client_id
         and version_row.record_key = v_record_key
         and version_row.version = v_version
         and not exists (
           select 1 from public.occupational_therapy_service_record_versions child
           where child.previous_version_id = version_row.id
         )
     ) then
    raise exception using errcode = '42501',
      message = 'occupational therapy service final verification failed';
  end if;

  return query select v_operation.id, v_result.organization_id,
    v_result.branch_id, v_result.client_id, v_result.record_key,
    v_result.id, v_result.version, v_result.record_state,
    v_result.occurred_at, v_result.therapist_user_id,
    v_result.service_status_at_occurrence,
    v_result.assessment_reference_version_id, v_result.created_at, false;
end;
$$;

create or replace function public.create_occupational_therapy_service_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_service_content jsonb,
  p_client_reaction jsonb,
  p_recommendation jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, organization_id uuid, branch_id uuid, client_id uuid,
  record_key uuid, version_id uuid, record_version integer,
  record_state text, occurred_at timestamptz, therapist_user_id uuid,
  service_status_at_occurrence text, assessment_reference_version_id uuid,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_occupational_therapy_service_guarded(
    'create_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, null, null, 0, p_occurred_at, p_service_content,
    p_client_reaction, p_recommendation, null, p_idempotency_key
  );
$$;

create or replace function public.revise_occupational_therapy_service_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_occurred_at timestamptz,
  p_service_content jsonb,
  p_client_reaction jsonb,
  p_recommendation jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, organization_id uuid, branch_id uuid, client_id uuid,
  record_key uuid, version_id uuid, record_version integer,
  record_state text, occurred_at timestamptz, therapist_user_id uuid,
  service_status_at_occurrence text, assessment_reference_version_id uuid,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_occupational_therapy_service_guarded(
    'revise_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_record_key, p_previous_version_id, p_expected_version,
    p_occurred_at, p_service_content, p_client_reaction, p_recommendation,
    null, p_idempotency_key
  );
$$;

create or replace function public.sign_occupational_therapy_service_record(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, organization_id uuid, branch_id uuid, client_id uuid,
  record_key uuid, version_id uuid, record_version integer,
  record_state text, occurred_at timestamptz, therapist_user_id uuid,
  service_status_at_occurrence text, assessment_reference_version_id uuid,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_occupational_therapy_service_guarded(
    'sign', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_record_key, p_previous_version_id, p_expected_version,
    null, null, null, null, null, p_idempotency_key
  );
$$;

create or replace function public.correct_occupational_therapy_service_record(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_occurred_at timestamptz,
  p_service_content jsonb,
  p_client_reaction jsonb,
  p_recommendation jsonb,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, organization_id uuid, branch_id uuid, client_id uuid,
  record_key uuid, version_id uuid, record_version integer,
  record_state text, occurred_at timestamptz, therapist_user_id uuid,
  service_status_at_occurrence text, assessment_reference_version_id uuid,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_occupational_therapy_service_guarded(
    'correct', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_record_key, p_previous_version_id, p_expected_version,
    p_occurred_at, p_service_content, p_client_reaction, p_recommendation,
    p_correction_reason, p_idempotency_key
  );
$$;

create or replace function private.occupational_therapy_service_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_client_id uuid,
  p_therapist_user_id uuid,
  p_record_state text,
  p_keyword text,
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
    from public.occupational_therapy_service_record_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and private.can_staff_access_client(
        version_row.client_id, 'clients.read'
      )
      and private.can_staff_access_client(
        version_row.client_id, 'occupational_therapy_services.read'
      )
      and not exists (
        select 1
        from public.occupational_therapy_service_record_versions child
        where child.previous_version_id = version_row.id
      )
  ), matching as materialized (
    select version_row.*, client.display_name as client_display_name
    from terminal_visible version_row
    join public.clients client
      on client.id = version_row.client_id
     and client.organization_id = version_row.organization_id
     and client.branch_id = version_row.branch_id
    where (p_date_from is null or
        (version_row.occurred_at at time zone 'Asia/Taipei')::date >=
          p_date_from)
      and (p_date_to is null or
        (version_row.occurred_at at time zone 'Asia/Taipei')::date <=
          p_date_to)
      and (p_client_id is null or version_row.client_id = p_client_id)
      and (p_therapist_user_id is null
        or version_row.therapist_user_id = p_therapist_user_id)
      and (p_record_state is null
        or version_row.record_state = p_record_state)
      and (p_keyword is null or lower(concat_ws(E'\n',
        client.display_name,
        version_row.service_content ->> 'text',
        version_row.service_content ->> 'reason',
        version_row.client_reaction ->> 'text',
        version_row.client_reaction ->> 'reason',
        version_row.recommendation ->> 'text',
        version_row.recommendation ->> 'reason'
      )) like '%' || lower(p_keyword) || '%')
  ), limited as materialized (
    select * from matching
    order by occurred_at desc, record_key
    limit 200
  ), records_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'record_key', item.record_key,
      'version_id', item.id,
      'record_version', item.version,
      'record_state', item.record_state,
      'client_id', item.client_id,
      'client_display_name', item.client_display_name,
      'occurred_at', item.occurred_at,
      'service_content', item.service_content,
      'client_reaction', item.client_reaction,
      'recommendation', item.recommendation,
      'therapist_user_id', item.therapist_user_id,
      'therapist_display_name', item.therapist_display_name,
      'service_status_at_occurrence', item.service_status_at_occurrence,
      'assessment_reference', case
        when item.assessment_reference_version_id is null then
          jsonb_build_object(
            'status', 'none_available', 'version_id', null,
            'assessment_key', null, 'assessment_version', null,
            'assessed_on', null, 'therapist_display_name', null
          )
        else jsonb_build_object(
          'status', 'linked',
          'version_id', item.assessment_reference_version_id,
          'assessment_key', item.assessment_reference_key,
          'assessment_version', item.assessment_reference_version,
          'assessed_on', item.assessment_reference_assessed_on,
          'therapist_display_name',
            item.assessment_reference_therapist_display_name
        ) end,
      'correction_reason', item.correction_reason,
      'signed_at', item.signed_at,
      'signer_display_name', item.signer_display_name,
      'created_at', item.created_at,
      'version_history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version_id', history.id,
          'record_version', history.version,
          'record_state', history.record_state,
          'occurred_at', history.occurred_at,
          'service_content', history.service_content,
          'client_reaction', history.client_reaction,
          'recommendation', history.recommendation,
          'therapist_user_id', history.therapist_user_id,
          'therapist_display_name', history.therapist_display_name,
          'service_status_at_occurrence',
            history.service_status_at_occurrence,
          'assessment_reference', case
            when history.assessment_reference_version_id is null then
              jsonb_build_object(
                'status', 'none_available', 'version_id', null,
                'assessment_key', null, 'assessment_version', null,
                'assessed_on', null, 'therapist_display_name', null
              )
            else jsonb_build_object(
              'status', 'linked',
              'version_id', history.assessment_reference_version_id,
              'assessment_key', history.assessment_reference_key,
              'assessment_version', history.assessment_reference_version,
              'assessed_on', history.assessment_reference_assessed_on,
              'therapist_display_name',
                history.assessment_reference_therapist_display_name
            ) end,
          'correction_reason', history.correction_reason,
          'signed_at', history.signed_at,
          'signer_display_name', history.signer_display_name,
          'created_at', history.created_at
        ) order by history.version)
        from (
          select history.*
          from public.occupational_therapy_service_record_versions history
          where history.organization_id = p_expected_organization_id
            and history.branch_id = p_expected_branch_id
            and history.client_id = item.client_id
            and history.record_key = item.record_key
          order by history.version desc
          limit 50
        ) history
      ), '[]'::jsonb),
      'version_history_total', (
        select count(*)
        from public.occupational_therapy_service_record_versions history
        where history.organization_id = p_expected_organization_id
          and history.branch_id = p_expected_branch_id
          and history.client_id = item.client_id
          and history.record_key = item.record_key
      )
    ) order by item.occurred_at desc, item.record_key), '[]'::jsonb)
      as records
    from limited item
  ), stats as (
    select count(*)::bigint as matching_total,
      count(*) filter (
        where (occurred_at at time zone 'Asia/Taipei')::date =
          (p_reference_time at time zone 'Asia/Taipei')::date
      )::bigint as today_total,
      count(*) filter (where record_state = 'draft')::bigint
        as draft_total,
      count(*) filter (where record_state = 'signed')::bigint
        as signed_total,
      count(*) filter (where record_state = 'corrected')::bigint
        as corrected_total,
      count(*) filter (
        where assessment_reference_version_id is not null
      )::bigint as linked_assessment_total
    from matching
  ), client_candidates as materialized (
    select client.id as client_id, client.display_name,
      client.status::text as service_status, client.admitted_on,
      client.ended_on
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(
        client.id, 'occupational_therapy_services.read'
      )
  ), client_ranked as (
    select candidate.*, row_number() over (
      order by candidate.display_name collate "C", candidate.client_id
    ) as ordinal
    from client_candidates candidate
  ), client_result as (
    select count(*)::bigint as client_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'client_id', ranked.client_id,
        'display_name', ranked.display_name,
        'service_status', ranked.service_status,
        'admitted_on', ranked.admitted_on,
        'ended_on', ranked.ended_on
      ) order by ranked.display_name collate "C", ranked.client_id)
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
    'records', records_result.records,
    'record_total', jsonb_array_length(records_result.records),
    'matching_total', stats.matching_total,
    'records_truncated', stats.matching_total >
      jsonb_array_length(records_result.records),
    'today_total', stats.today_total,
    'draft_total', stats.draft_total,
    'signed_total', stats.signed_total,
    'corrected_total', stats.corrected_total,
    'linked_assessment_total', stats.linked_assessment_total,
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated', client_result.client_total >
      jsonb_array_length(client_result.client_options),
    'therapist_options', therapist_result.therapist_options,
    'therapist_total', therapist_result.therapist_total,
    'therapist_options_truncated', therapist_result.therapist_total >
      jsonb_array_length(therapist_result.therapist_options),
    'assessment_link_status', 'readonly_latest_terminal',
    'formula_status', 'not_configured',
    'diagnosis_status', 'not_configured',
    'automatic_recommendation_status', 'not_configured',
    'attachment_status', 'not_configured',
    'export_status', 'not_configured',
    'offline_sync_status', 'not_configured'
  )
  from records_result cross join stats cross join client_result
  cross join therapist_result;
$$;

create or replace function private.occupational_therapy_service_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_client_id uuid,
  p_therapist_user_id uuid,
  p_record_state text,
  p_keyword text
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  records jsonb,
  record_total integer,
  matching_total bigint,
  records_truncated boolean,
  today_total bigint,
  draft_total bigint,
  signed_total bigint,
  corrected_total bigint,
  linked_assessment_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  therapist_options jsonb,
  therapist_total bigint,
  therapist_options_truncated boolean,
  assessment_link_status text,
  formula_status text,
  diagnosis_status text,
  automatic_recommendation_status text,
  attachment_status text,
  export_status text,
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
  v_state text := nullif(lower(btrim(p_record_state)), '');
  v_keyword text := nullif(btrim(p_keyword), '');
  v_bundle jsonb;
  v_after jsonb;
  v_fingerprint text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or (p_date_from is not null and p_date_to is not null
       and p_date_from > p_date_to)
     or (v_state is not null
       and v_state not in ('draft', 'signed', 'corrected'))
     or (v_keyword is not null and (
       char_length(v_keyword) > 80
       or translate(v_keyword, E'\n\r\t', '') ~ '[[:cntrl:]]'
     ))
     or not private.occupational_therapy_service_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'occupational_therapy_services.read'
     ) then
    raise exception using errcode = '42501',
      message = 'occupational therapy service snapshot is not permitted';
  end if;

  if p_client_id is not null and
     not private.occupational_therapy_service_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'occupational_therapy_services.read'
     ) then
    raise exception using errcode = '42501',
      message = 'occupational therapy service client filter is not permitted';
  end if;

  if p_therapist_user_id is not null and not exists (
    select 1
    from public.occupational_therapy_service_record_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.therapist_user_id = p_therapist_user_id
      and private.can_staff_access_client(
        version_row.client_id, 'clients.read'
      )
      and private.can_staff_access_client(
        version_row.client_id, 'occupational_therapy_services.read'
      )
  ) then
    raise exception using errcode = '42501',
      message = 'occupational therapy service therapist filter is not permitted';
  end if;

  v_bundle := private.occupational_therapy_service_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_date_from,
    p_date_to, p_client_id, p_therapist_user_id, v_state, v_keyword, v_now
  );
  v_fingerprint := encode(
    sha256(convert_to(v_bundle::text, 'UTF8')), 'hex'
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'occupational_therapy_service_record_versions', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page41_occupational_therapy_service_v1',
      'record_count', (v_bundle ->> 'record_total')::integer,
      'matching_total', (v_bundle ->> 'matching_total')::bigint,
      'records_truncated', (v_bundle ->> 'records_truncated')::boolean,
      'record_limit', 200,
      'snapshot_fingerprint', v_fingerprint,
      'filter_values_logged', false,
      'narrative_logged', false,
      'formula_computed', false,
      'diagnosis_computed', false,
      'automatic_recommendation_computed', false
    )
  );

  v_after := private.occupational_therapy_service_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_date_from,
    p_date_to, p_client_id, p_therapist_user_id, v_state, v_keyword, v_now
  );
  if not private.occupational_therapy_service_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'occupational_therapy_services.read'
     ) or v_after is distinct from v_bundle then
    raise exception using errcode = '42501',
      message = 'occupational therapy service snapshot final verification failed';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::integer,
    (v_bundle ->> 'matching_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    (v_bundle ->> 'today_total')::bigint,
    (v_bundle ->> 'draft_total')::bigint,
    (v_bundle ->> 'signed_total')::bigint,
    (v_bundle ->> 'corrected_total')::bigint,
    (v_bundle ->> 'linked_assessment_total')::bigint,
    v_bundle -> 'client_options',
    (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'client_options_truncated')::boolean,
    v_bundle -> 'therapist_options',
    (v_bundle ->> 'therapist_total')::bigint,
    (v_bundle ->> 'therapist_options_truncated')::boolean,
    v_bundle ->> 'assessment_link_status',
    v_bundle ->> 'formula_status',
    v_bundle ->> 'diagnosis_status',
    v_bundle ->> 'automatic_recommendation_status',
    v_bundle ->> 'attachment_status',
    v_bundle ->> 'export_status',
    v_bundle ->> 'offline_sync_status';
end;
$$;

create or replace function public.occupational_therapy_service_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_client_id uuid default null,
  p_therapist_user_id uuid default null,
  p_record_state text default null,
  p_keyword text default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  records jsonb,
  record_total integer,
  matching_total bigint,
  records_truncated boolean,
  today_total bigint,
  draft_total bigint,
  signed_total bigint,
  corrected_total bigint,
  linked_assessment_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  therapist_options jsonb,
  therapist_total bigint,
  therapist_options_truncated boolean,
  assessment_link_status text,
  formula_status text,
  diagnosis_status text,
  automatic_recommendation_status text,
  attachment_status text,
  export_status text,
  offline_sync_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.occupational_therapy_service_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from,
    p_date_to, p_client_id, p_therapist_user_id, p_record_state, p_keyword
  );
$$;

create policy occupational_therapy_service_record_versions_staff_select
on public.occupational_therapy_service_record_versions for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(
    client_id, 'occupational_therapy_services.read'
  )
);

revoke all on function private.occupational_therapy_service_value_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.occupational_therapy_service_history_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.occupational_therapy_service_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.occupational_therapy_service_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_occupational_therapy_service_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_occupational_therapy_service_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.occupational_therapy_service_snapshot_bundle(uuid,uuid,date,date,uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.occupational_therapy_service_snapshot_response(uuid,uuid,date,date,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_occupational_therapy_service_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_occupational_therapy_service_draft(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sign_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.occupational_therapy_service_snapshot(uuid,uuid,date,date,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_occupational_therapy_service_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,uuid)
  to authenticated;
grant execute on function public.revise_occupational_therapy_service_draft(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,uuid)
  to authenticated;
grant execute on function public.sign_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function public.correct_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)
  to authenticated;
grant execute on function public.occupational_therapy_service_snapshot(uuid,uuid,date,date,uuid,uuid,text,text)
  to authenticated;

-- SECURITY INVOKER wrappers receive only their exact private entry points.
grant execute on function private.mutate_occupational_therapy_service_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)
  to authenticated;
grant execute on function private.occupational_therapy_service_snapshot_response(uuid,uuid,date,date,uuid,uuid,text,text)
  to authenticated;

comment on function public.occupational_therapy_service_snapshot(uuid,uuid,date,date,uuid,uuid,text,text)
is 'Page 41 assigned-client occupational therapy service records. Page 33 is a database-selected read-only reference; no formula, diagnosis, or automatic recommendation is inferred.';
