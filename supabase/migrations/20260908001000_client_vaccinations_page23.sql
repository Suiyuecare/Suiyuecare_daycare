-- Page 23: immutable client vaccination records.
-- Values are staff-transcribed source facts. No diagnosis, recommendation,
-- attachment upload, reminder, export, or offline workflow is implemented here.

insert into public.permissions (permission_key, description, risk_level) values
  ('client_vaccinations.read', 'Read assigned-client vaccination records', 2),
  ('client_vaccinations.manage', 'Create, correct and void assigned-client vaccination records', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and ((permission.permission_key = 'client_vaccinations.read' and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'professional'
  )) or (permission.permission_key = 'client_vaccinations.manage' and role.role_key in (
    'organization_manager', 'branch_supervisor', 'nurse'
  )))
on conflict (role_id, permission_id) do nothing;

create table private.client_vaccination_evidence_registry (
  id uuid primary key,
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  sha256 text not null,
  source_filename text not null,
  storage_status text not null,
  scan_status text not null,
  source_system text not null,
  source_record_id text,
  registered_by uuid not null references auth.users(id) on delete restrict,
  registered_at timestamptz not null default clock_timestamp(),
  constraint client_vaccination_evidence_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_vaccination_evidence_scope_key unique (
    id, organization_id, branch_id, client_id, sha256, source_filename
  ),
  constraint client_vaccination_evidence_hash_check check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint client_vaccination_evidence_filename_check check (
    char_length(source_filename) between 1 and 255
    and source_filename = btrim(source_filename)
    and source_filename !~ '[[:cntrl:]]'
  ),
  constraint client_vaccination_evidence_state_check check (
    storage_status = 'stored' and scan_status = 'clean'
  ),
  constraint client_vaccination_evidence_source_check check (
    source_system in ('central_html_import', 'legacy_migration')
    and (source_record_id is null or (
      char_length(source_record_id) between 1 and 240
      and source_record_id = btrim(source_record_id)
      and source_record_id !~ '[[:cntrl:]]'))
  )
);

comment on table private.client_vaccination_evidence_registry is
  'Trusted evidence registry populated only by a future isolated import/upload pipeline; browser manual RPCs cannot register or attach arbitrary evidence.';

create table public.client_vaccination_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  vaccination_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  vaccine_name text not null,
  normalized_vaccine_name text not null,
  dose_number text not null,
  normalized_dose_number text not null,
  vaccinated_on date not null,
  lot_number text,
  provider_name text not null,
  evidence_status text not null,
  evidence_reference_id uuid,
  evidence_sha256 text,
  evidence_file_name text,
  source_system text not null,
  source_record_id text,
  source_provenance jsonb not null,
  payload_hash text not null,
  content_hash text not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_by_display_name text not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint client_vaccination_versions_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_vaccination_versions_scope_key unique (
    id, organization_id, branch_id, client_id, vaccination_key
  ),
  constraint client_vaccination_versions_chain_key unique (
    organization_id, branch_id, vaccination_key, version
  ),
  constraint client_vaccination_versions_previous_key unique (previous_version_id),
  constraint client_vaccination_versions_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, client_id, vaccination_key
  ) references public.client_vaccination_versions (
    id, organization_id, branch_id, client_id, vaccination_key
  ) on delete restrict,
  constraint client_vaccination_versions_evidence_scope_fkey foreign key (
    evidence_reference_id, organization_id, branch_id, client_id,
    evidence_sha256, evidence_file_name
  ) references private.client_vaccination_evidence_registry (
    id, organization_id, branch_id, client_id, sha256, source_filename
  ) on delete restrict,
  constraint client_vaccination_versions_version_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null and correction_reason is null
        and reauth_challenge_id is null)
      or (version > 1 and previous_version_id is not null
        and correction_reason is not null and reauth_challenge_id is not null)
    )
  ),
  constraint client_vaccination_versions_status_check check (
    record_status in ('active', 'voided')
    and (record_status = 'active' or version > 1)
  ),
  constraint client_vaccination_versions_name_check check (
    char_length(vaccine_name) between 1 and 160
    and vaccine_name = btrim(vaccine_name) and vaccine_name !~ '[[:cntrl:]]'
    and char_length(normalized_vaccine_name) between 1 and 160
  ),
  constraint client_vaccination_versions_dose_check check (
    char_length(dose_number) between 1 and 80
    and dose_number = btrim(dose_number) and dose_number !~ '[[:cntrl:]]'
    and char_length(normalized_dose_number) between 1 and 80
  ),
  constraint client_vaccination_versions_date_check check (
    extract(year from vaccinated_on) between 1900 and 2200
  ),
  constraint client_vaccination_versions_lot_check check (
    lot_number is null or (char_length(lot_number) between 1 and 160
      and lot_number = btrim(lot_number) and lot_number !~ '[[:cntrl:]]')
  ),
  constraint client_vaccination_versions_provider_check check (
    char_length(provider_name) between 1 and 200
    and provider_name = btrim(provider_name) and provider_name !~ '[[:cntrl:]]'
  ),
  constraint client_vaccination_versions_evidence_check check (
    (evidence_status = 'provided' and evidence_reference_id is not null
      and evidence_sha256 ~ '^[a-f0-9]{64}$' and evidence_file_name is not null
      and char_length(evidence_file_name) between 1 and 255
      and evidence_file_name = btrim(evidence_file_name)
      and evidence_file_name !~ '[[:cntrl:]]')
    or (evidence_status in ('missing', 'not_applicable')
      and evidence_reference_id is null and evidence_sha256 is null
      and evidence_file_name is null)
  ),
  constraint client_vaccination_versions_source_check check (
    source_system in ('manual_entry', 'central_html_import', 'legacy_migration')
    and ((source_system = 'manual_entry' and source_record_id is null)
      or (source_system <> 'manual_entry' and source_record_id is not null
        and char_length(source_record_id) between 1 and 240
        and source_record_id = btrim(source_record_id)
        and source_record_id !~ '[[:cntrl:]]'))
    and jsonb_typeof(source_provenance) = 'object'
  ),
  constraint client_vaccination_versions_hash_check check (
    payload_hash ~ '^[a-f0-9]{64}$' and content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint client_vaccination_versions_actor_check check (
    char_length(recorded_by_display_name) between 1 and 160
    and recorded_by_display_name = btrim(recorded_by_display_name)
    and recorded_by_display_name !~ '[[:cntrl:]]'
  ),
  constraint client_vaccination_versions_reason_check check (
    correction_reason is null or (char_length(correction_reason) between 8 and 1000
      and correction_reason = btrim(correction_reason)
      and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
  )
);

comment on table public.client_vaccination_versions is
  'Immutable Page-23 client vaccination facts. Duplicate results are warnings only and never merge records.';
comment on column public.client_vaccination_versions.source_provenance is
  'Frozen source metadata; manual browser records are facility-authored transcription facts.';

create table private.client_vaccination_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  result_vaccination_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_previous_version_id uuid,
  result_record_status text not null,
  result_content_hash text not null,
  result_duplicate_count integer not null,
  result_recorded_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_vaccination_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint client_vaccination_operations_result_scope_fkey foreign key (
    result_version_id, organization_id, branch_id, client_id, result_vaccination_key
  ) references public.client_vaccination_versions (
    id, organization_id, branch_id, client_id, vaccination_key
  ) on delete restrict,
  constraint client_vaccination_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and result_content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint client_vaccination_operations_result_check check (
    action in ('create','correct','void') and result_version > 0
    and result_record_status in ('active','voided') and result_duplicate_count >= 0
    and ((action = 'create' and result_version = 1
      and result_previous_version_id is null and result_record_status = 'active'
      and reauth_challenge_id is null)
    or (action = 'correct' and result_version > 1
      and result_previous_version_id is not null and result_record_status = 'active'
      and reauth_challenge_id is not null)
    or (action = 'void' and result_version > 1
      and result_previous_version_id is not null and result_record_status = 'voided'
      and result_duplicate_count = 0 and reauth_challenge_id is not null))
  )
);

create table private.client_vaccination_batch_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  batch_idempotency_key uuid not null,
  request_hash text not null,
  item_total integer not null,
  succeeded_total integer not null,
  rejected_total integer not null,
  results jsonb not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_vaccination_batch_actor_key unique (
    actor_user_id, batch_idempotency_key
  ),
  constraint client_vaccination_batch_scope_fkey foreign key (
    branch_id, organization_id
  ) references public.branches(id, organization_id) on delete restrict,
  constraint client_vaccination_batch_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint client_vaccination_batch_count_check check (
    item_total between 1 and 20 and succeeded_total >= 0 and rejected_total >= 0
    and succeeded_total + rejected_total = item_total
    and jsonb_typeof(results) = 'array' and jsonb_array_length(results) = item_total
  )
);

create index client_vaccination_evidence_client_idx
  on private.client_vaccination_evidence_registry (client_id, registered_at desc);
create index client_vaccination_evidence_actor_idx
  on private.client_vaccination_evidence_registry (registered_by);
create index client_vaccination_versions_scope_date_idx
  on public.client_vaccination_versions (
    organization_id, branch_id, vaccinated_on desc, vaccination_key, version desc
  );
create index client_vaccination_versions_client_date_idx
  on public.client_vaccination_versions (
    client_id, vaccinated_on desc, vaccination_key, version desc
  );
create index client_vaccination_versions_duplicate_idx
  on public.client_vaccination_versions (
    organization_id, branch_id, client_id,
    normalized_vaccine_name, normalized_dose_number
  ) where record_status = 'active';
create index client_vaccination_versions_previous_idx
  on public.client_vaccination_versions (previous_version_id)
  where previous_version_id is not null;
create index client_vaccination_versions_actor_idx
  on public.client_vaccination_versions (recorded_by);
create index client_vaccination_versions_reauth_idx
  on public.client_vaccination_versions (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index client_vaccination_versions_evidence_idx
  on public.client_vaccination_versions (
    evidence_reference_id, evidence_sha256, evidence_file_name
  )
  where evidence_reference_id is not null;
create index client_vaccination_operations_result_idx
  on private.client_vaccination_operations (result_version_id);
create index client_vaccination_operations_client_idx
  on private.client_vaccination_operations (
    organization_id, branch_id, client_id, result_vaccination_key, result_version
  );
create index client_vaccination_operations_reauth_idx
  on private.client_vaccination_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index client_vaccination_batch_branch_idx
  on private.client_vaccination_batch_operations (
    organization_id, branch_id, created_at desc
  );
create index client_vaccination_batch_reauth_idx
  on private.client_vaccination_batch_operations (reauth_challenge_id);

alter table private.client_vaccination_evidence_registry enable row level security;
alter table private.client_vaccination_evidence_registry force row level security;
alter table public.client_vaccination_versions enable row level security;
alter table public.client_vaccination_versions force row level security;
alter table private.client_vaccination_operations enable row level security;
alter table private.client_vaccination_operations force row level security;
alter table private.client_vaccination_batch_operations enable row level security;
alter table private.client_vaccination_batch_operations force row level security;

revoke all on table private.client_vaccination_evidence_registry
  from public, anon, authenticated, service_role;
revoke all on table public.client_vaccination_versions
  from public, anon, authenticated, service_role;
revoke all on table private.client_vaccination_operations
  from public, anon, authenticated, service_role;
revoke all on table private.client_vaccination_batch_operations
  from public, anon, authenticated, service_role;

create or replace function private.client_vaccination_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'client vaccination evidence is append-only';
end;
$$;

create trigger client_vaccination_evidence_append_only before update or delete
  on private.client_vaccination_evidence_registry for each row
  execute function private.client_vaccination_append_only();
create trigger client_vaccination_versions_append_only before update or delete
  on public.client_vaccination_versions for each row
  execute function private.client_vaccination_append_only();
create trigger client_vaccination_operations_append_only before update or delete
  on private.client_vaccination_operations for each row
  execute function private.client_vaccination_append_only();
create trigger client_vaccination_batch_operations_append_only before update or delete
  on private.client_vaccination_batch_operations for each row
  execute function private.client_vaccination_append_only();

create trigger client_vaccination_evidence_audit_row_change after insert
  on private.client_vaccination_evidence_registry for each row
  execute function private.audit_row_change();
create trigger client_vaccination_versions_audit_row_change after insert
  on public.client_vaccination_versions for each row
  execute function private.audit_row_change();
create trigger client_vaccination_operations_audit_row_change after insert
  on private.client_vaccination_operations for each row
  execute function private.audit_row_change();
create trigger client_vaccination_batch_operations_audit_row_change after insert
  on private.client_vaccination_batch_operations for each row
  execute function private.audit_row_change();

create or replace function private.normalize_client_vaccination_text(p_value text)
returns text language sql immutable security invoker set search_path = '' as $$
  select lower(regexp_replace(btrim(p_value), '[[:space:]]+', ' ', 'g'));
$$;

alter table public.client_vaccination_versions
  add constraint client_vaccination_versions_normalization_check check (
    normalized_vaccine_name = private.normalize_client_vaccination_text(vaccine_name)
    and normalized_dose_number = private.normalize_client_vaccination_text(dose_number)
  );

create or replace function private.client_vaccination_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.profiles profile where profile.id = auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id and branch.is_active)
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, 'clients.read')
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, 'client_vaccinations.read')
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission);
$$;

create or replace function private.client_vaccination_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.client_vaccination_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission)
    and exists (select 1 from public.clients client where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id)
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, 'client_vaccinations.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.client_vaccination_client_is_active(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid,
  p_reference_time timestamptz
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active' and client.admitted_on is not null
      and client.admitted_on <= (p_reference_time at time zone 'Asia/Taipei')::date
      and client.ended_on is null);
$$;

create or replace function private.require_client_vaccination_reauth(
  p_actor uuid, p_reference_time timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid()
    or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
    or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.user_id = event.user_id and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp','webauthn','phone')
    and event.verified_at >= p_reference_time - interval '15 minutes'
    and event.verified_at <= p_reference_time + interval '1 minute'
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.consumed_at >= p_reference_time - interval '15 minutes'
    and challenge.consumed_at <= p_reference_time + interval '1 minute'
  order by event.verified_at desc, challenge.consumed_at desc, challenge.id
  limit 1;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.client_vaccination_attachment_pipeline_enabled(
  p_expected_organization_id uuid, p_expected_branch_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select false;
$$;

create or replace function private.client_vaccination_record_payload(
  p_record_version_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'client_id',record.client_id,
    'vaccine_name',record.vaccine_name,
    'dose_number',record.dose_number,
    'vaccinated_on',record.vaccinated_on,
    'lot_number',record.lot_number,
    'provider_name',record.provider_name,
    'evidence_status',record.evidence_status,
    'evidence_reference_id',record.evidence_reference_id,
    'evidence_sha256',record.evidence_sha256,
    'evidence_file_name',record.evidence_file_name,
    'source_system',record.source_system,
    'source_record_id',record.source_record_id
  )
  from public.client_vaccination_versions record
  where record.id=p_record_version_id;
$$;

create or replace function private.append_client_vaccination_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_vaccination_key uuid, p_previous_version_id uuid,
  p_expected_base_version integer, p_client_id uuid, p_vaccine_name text,
  p_dose_number text, p_vaccinated_on date, p_lot_number text,
  p_provider_name text, p_evidence_status text, p_evidence_reference_id uuid,
  p_evidence_sha256 text, p_evidence_file_name text, p_source_system text,
  p_source_record_id text, p_correction_reason text, p_idempotency_key uuid
) returns table(
  organization_id uuid, branch_id uuid, vaccination_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, client_id uuid, content_hash text,
  record_payload jsonb,
  duplicate_warning boolean, duplicate_count integer, duplicate_basis text,
  recorded_at timestamptz, replayed boolean
) language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_actor_name text; v_now timestamptz := clock_timestamp();
  v_action text := btrim(p_action); v_vaccine_name text; v_dose_number text;
  v_normalized_vaccine text; v_normalized_dose text; v_lot_number text;
  v_provider_name text; v_reason text := nullif(btrim(p_correction_reason), '');
  v_source_system text; v_source_record_id text; v_source_provenance jsonb;
  v_record_status text; v_version integer; v_reauth_challenge_id uuid;
  v_payload_hash text; v_content_hash text; v_request_hash text;
  v_duplicate_count integer := 0; v_lock_one text; v_lock_two text;
  v_previous public.client_vaccination_versions%rowtype;
  v_result public.client_vaccination_versions%rowtype;
  v_operation private.client_vaccination_operations%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
    or p_vaccination_key is null or p_client_id is null
    or p_idempotency_key is null or v_action not in ('create','correct','void')
    or p_expected_base_version is null or p_expected_base_version < 0
    or (v_action = 'create' and (p_previous_version_id is not null
      or p_expected_base_version <> 0 or p_correction_reason is not null))
    or (v_action in ('correct','void') and (p_previous_version_id is null
      or p_expected_base_version < 1 or v_reason is null
      or char_length(v_reason) not between 8 and 1000
      or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'))
    or (v_action = 'void' and (p_vaccine_name is not null or p_dose_number is not null
      or p_vaccinated_on is not null or p_lot_number is not null
      or p_provider_name is not null or p_evidence_status is not null
      or p_evidence_reference_id is not null or p_evidence_sha256 is not null
      or p_evidence_file_name is not null or p_source_system is not null
      or p_source_record_id is not null)) then
    raise exception using errcode = '22023', message = 'invalid client vaccination request';
  end if;
  if not private.client_vaccination_client_authority(
      p_expected_organization_id, p_expected_branch_id, p_client_id,
      'client_vaccinations.manage')
    or not private.client_vaccination_client_is_active(
      p_expected_organization_id, p_expected_branch_id, p_client_id, v_now) then
    raise exception using errcode = '42501', message = 'client vaccination client is not permitted';
  end if;
  if v_action in ('correct','void') then
    v_reauth_challenge_id := private.require_client_vaccination_reauth(v_actor, v_now);
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'action',v_action,
    'vaccination_key',p_vaccination_key,'previous_version_id',p_previous_version_id,
    'expected_base_version',p_expected_base_version,'client_id',p_client_id,
    'vaccine_name',p_vaccine_name,'dose_number',p_dose_number,
    'vaccinated_on',p_vaccinated_on,'lot_number',p_lot_number,
    'provider_name',p_provider_name,'evidence_status',p_evidence_status,
    'evidence_reference_id',p_evidence_reference_id,
    'evidence_sha256',p_evidence_sha256,'evidence_file_name',p_evidence_file_name,
    'source_system',p_source_system,'source_record_id',p_source_record_id,
    'correction_reason',p_correction_reason
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'page23:operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));

  select operation.* into v_operation
  from private.client_vaccination_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key for share;
  if found then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'client vaccination idempotency conflict';
    end if;
    if v_operation.organization_id <> p_expected_organization_id
      or v_operation.branch_id <> p_expected_branch_id
      or v_operation.client_id <> p_client_id
      or not private.client_vaccination_client_authority(
        p_expected_organization_id, p_expected_branch_id, p_client_id,
        'client_vaccinations.manage')
      or not private.client_vaccination_client_is_active(
        p_expected_organization_id, p_expected_branch_id, p_client_id, v_now)
      or (v_action in ('correct','void')
        and private.require_client_vaccination_reauth(v_actor, v_now) is null)
      or not exists (select 1 from public.client_vaccination_versions record
        where record.id = v_operation.result_version_id
          and record.organization_id = v_operation.organization_id
          and record.branch_id = v_operation.branch_id
          and record.client_id = v_operation.client_id
          and record.vaccination_key = v_operation.result_vaccination_key) then
      raise exception using errcode = '42501',
        message = 'client vaccination replay authority expired';
    end if;
    return query select v_operation.organization_id, v_operation.branch_id,
      v_operation.result_vaccination_key, v_operation.result_version_id,
      v_operation.result_version, v_operation.result_previous_version_id,
      v_operation.result_record_status, v_operation.client_id,
      v_operation.result_content_hash,
      private.client_vaccination_record_payload(v_operation.result_version_id),
      v_operation.result_duplicate_count > 0,
      v_operation.result_duplicate_count,
      'same_client_normalized_vaccine_and_dose'::text,
      v_operation.result_recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'page23:chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_vaccination_key::text, 0));
  if not private.client_vaccination_client_authority(
      p_expected_organization_id, p_expected_branch_id, p_client_id,
      'client_vaccinations.manage')
    or not private.client_vaccination_client_is_active(
      p_expected_organization_id, p_expected_branch_id, p_client_id, v_now) then
    raise exception using errcode = '42501', message = 'client vaccination authority expired';
  end if;
  select profile.display_name into v_actor_name from public.profiles profile
    where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501', message = 'client vaccination actor is invalid';
  end if;

  if v_action = 'create' then
    if exists (select 1 from public.client_vaccination_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.vaccination_key = p_vaccination_key) then
      raise exception using errcode = '23505', message = 'client vaccination key already exists';
    end if;
    v_version := 1;
  else
    select record.* into v_previous
    from public.client_vaccination_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.vaccination_key = p_vaccination_key
      and not exists (select 1 from public.client_vaccination_versions child
        where child.previous_version_id = record.id)
    order by record.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> p_previous_version_id
      or v_previous.version <> p_expected_base_version
      or v_previous.client_id <> p_client_id then
      raise exception using errcode = '40001', message = 'client vaccination version is stale';
    end if;
    if v_previous.record_status <> 'active' then
      raise exception using errcode = '23514', message = 'voided client vaccination is terminal';
    end if;
    if v_action = 'correct' and (v_previous.evidence_status = 'provided'
      or v_previous.source_system <> 'manual_entry') then
      raise exception using errcode = '55000',
        message = 'trusted-origin client vaccination correction is not configured';
    end if;
    v_version := v_previous.version + 1;
  end if;

  if v_action = 'void' then
    v_vaccine_name := v_previous.vaccine_name;
    v_normalized_vaccine := v_previous.normalized_vaccine_name;
    v_dose_number := v_previous.dose_number;
    v_normalized_dose := v_previous.normalized_dose_number;
    p_vaccinated_on := v_previous.vaccinated_on;
    v_lot_number := v_previous.lot_number;
    v_provider_name := v_previous.provider_name;
    p_evidence_status := v_previous.evidence_status;
    p_evidence_reference_id := v_previous.evidence_reference_id;
    p_evidence_sha256 := v_previous.evidence_sha256;
    p_evidence_file_name := v_previous.evidence_file_name;
    v_source_system := v_previous.source_system;
    v_source_record_id := v_previous.source_record_id;
    v_source_provenance := v_previous.source_provenance;
    v_payload_hash := v_previous.payload_hash;
    v_record_status := 'voided';
  else
    v_vaccine_name := btrim(p_vaccine_name);
    v_dose_number := btrim(p_dose_number);
    v_normalized_vaccine := private.normalize_client_vaccination_text(v_vaccine_name);
    v_normalized_dose := private.normalize_client_vaccination_text(v_dose_number);
    v_lot_number := nullif(btrim(p_lot_number), '');
    v_provider_name := btrim(p_provider_name);
    v_source_system := btrim(p_source_system);
    v_source_record_id := nullif(btrim(p_source_record_id), '');
    if v_vaccine_name is null or char_length(v_vaccine_name) not between 1 and 160
      or v_vaccine_name ~ '[[:cntrl:]]'
      or v_dose_number is null or char_length(v_dose_number) not between 1 and 80
      or v_dose_number ~ '[[:cntrl:]]'
      or p_vaccinated_on is null or extract(year from p_vaccinated_on) not between 1900 and 2200
      or p_vaccinated_on > (v_now at time zone 'Asia/Taipei')::date
      or (v_lot_number is not null and (char_length(v_lot_number) > 160
        or v_lot_number ~ '[[:cntrl:]]'))
      or v_provider_name is null or char_length(v_provider_name) not between 1 and 200
      or v_provider_name ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'client vaccination content is invalid';
    end if;
    if p_evidence_status not in ('missing','not_applicable')
      or p_evidence_reference_id is not null or p_evidence_sha256 is not null
      or p_evidence_file_name is not null then
      raise exception using errcode = '42501',
        message = 'client vaccination attachment pipeline is not configured';
    end if;
    if v_source_system <> 'manual_entry' or v_source_record_id is not null then
      raise exception using errcode = '42501',
        message = 'client vaccination source is not permitted for browser entry';
    end if;
    v_source_provenance := jsonb_build_object(
      'schema_version',1,'source_system','manual_entry',
      'capture_method','staff_transcription','authority','facility');
    v_record_status := 'active';
    v_payload_hash := encode(sha256(convert_to(jsonb_build_object(
      'schema_version',1,'organization_id',p_expected_organization_id,
      'branch_id',p_expected_branch_id,'client_id',p_client_id,
      'vaccine_name',v_vaccine_name,'normalized_vaccine_name',v_normalized_vaccine,
      'dose_number',v_dose_number,'normalized_dose_number',v_normalized_dose,
      'vaccinated_on',p_vaccinated_on,'lot_number',v_lot_number,
      'provider_name',v_provider_name,'evidence_status',p_evidence_status,
      'evidence_reference_id',p_evidence_reference_id,
      'evidence_sha256',p_evidence_sha256,'evidence_file_name',p_evidence_file_name,
      'source_system',v_source_system,'source_record_id',v_source_record_id,
      'source_provenance',v_source_provenance
    )::text,'UTF8')),'hex');
  end if;

  v_lock_one := p_expected_organization_id::text || ':' || p_expected_branch_id::text || ':' ||
    p_client_id::text || ':' || v_normalized_vaccine || ':' || v_normalized_dose;
  if v_action = 'correct' then
    v_lock_two := p_expected_organization_id::text || ':' || p_expected_branch_id::text || ':' ||
      p_client_id::text || ':' || v_previous.normalized_vaccine_name || ':' ||
      v_previous.normalized_dose_number;
  else
    v_lock_two := v_lock_one;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('page23:duplicate:' || least(v_lock_one,v_lock_two),0));
  if v_lock_one <> v_lock_two then
    perform pg_advisory_xact_lock(hashtextextended('page23:duplicate:' || greatest(v_lock_one,v_lock_two),0));
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'client_id',p_client_id,
    'vaccination_key',p_vaccination_key,'version',v_version,
    'previous_version_id',p_previous_version_id,'record_status',v_record_status,
    'payload_hash',v_payload_hash,'correction_reason',v_reason,
    'recorded_by',v_actor,'recorded_at',v_now
  )::text,'UTF8')),'hex');

  insert into public.client_vaccination_versions (
    organization_id,branch_id,client_id,vaccination_key,version,
    previous_version_id,record_status,correction_reason,vaccine_name,
    normalized_vaccine_name,dose_number,normalized_dose_number,vaccinated_on,
    lot_number,provider_name,evidence_status,evidence_reference_id,
    evidence_sha256,evidence_file_name,source_system,source_record_id,
    source_provenance,payload_hash,content_hash,recorded_by,
    recorded_by_display_name,reauth_challenge_id,recorded_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,p_client_id,p_vaccination_key,
    v_version,p_previous_version_id,v_record_status,v_reason,v_vaccine_name,
    v_normalized_vaccine,v_dose_number,v_normalized_dose,p_vaccinated_on,
    v_lot_number,v_provider_name,p_evidence_status,p_evidence_reference_id,
    p_evidence_sha256,p_evidence_file_name,v_source_system,v_source_record_id,
    v_source_provenance,v_payload_hash,v_content_hash,v_actor,v_actor_name,
    v_reauth_challenge_id,v_now
  ) returning * into v_result;

  if v_record_status = 'active' then
    select count(*)::integer into v_duplicate_count
    from public.client_vaccination_versions other
    where other.organization_id = p_expected_organization_id
      and other.branch_id = p_expected_branch_id and other.client_id = p_client_id
      and other.vaccination_key <> p_vaccination_key
      and other.record_status = 'active'
      and other.normalized_vaccine_name = v_normalized_vaccine
      and other.normalized_dose_number = v_normalized_dose
      and not exists (select 1 from public.client_vaccination_versions child
        where child.previous_version_id = other.id);
  end if;

  insert into private.client_vaccination_operations (
    organization_id,branch_id,client_id,actor_user_id,idempotency_key,
    request_hash,action,result_vaccination_key,result_version_id,result_version,
    result_previous_version_id,result_record_status,result_content_hash,
    result_duplicate_count,result_recorded_at,reauth_challenge_id
  ) values (
    p_expected_organization_id,p_expected_branch_id,p_client_id,v_actor,
    p_idempotency_key,v_request_hash,v_action,p_vaccination_key,v_result.id,
    v_result.version,v_result.previous_version_id,v_result.record_status,
    v_result.content_hash,v_duplicate_count,v_result.recorded_at,v_reauth_challenge_id
  ) returning * into v_operation;

  insert into public.audit_events (
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    idempotency_key,changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,
    case when v_action='create' then 'insert' else 'correct' end,
    'client_vaccination_versions',v_result.id::text,p_idempotency_key,
    array['record_status','version','client_id','vaccinated_on','evidence_status',
      'source_system','payload_hash','content_hash'],
    jsonb_build_object('workflow','page23_client_vaccination_v1',
      'vaccination_key',p_vaccination_key,'version',v_version,
      'state',v_record_status,'client_id',p_client_id,
      'duplicate_warning',v_duplicate_count>0,'duplicate_count',v_duplicate_count,
      'duplicate_basis','same_client_normalized_vaccine_and_dose',
      'medical_interpretation_logged',false,'attachment_pipeline_configured',false)
  );

  if not private.client_vaccination_client_authority(
      p_expected_organization_id,p_expected_branch_id,p_client_id,
      'client_vaccinations.manage')
    or not private.client_vaccination_client_is_active(
      p_expected_organization_id,p_expected_branch_id,p_client_id,v_now)
    or not exists (select 1 from public.client_vaccination_versions record
      where record.id=v_result.id and not exists (
        select 1 from public.client_vaccination_versions child
        where child.previous_version_id=record.id)) then
    raise exception using errcode='42501',message='client vaccination final verification failed';
  end if;

  return query select p_expected_organization_id,p_expected_branch_id,
    p_vaccination_key,v_result.id,v_result.version,v_result.previous_version_id,
    v_result.record_status,p_client_id,v_result.content_hash,
    private.client_vaccination_record_payload(v_result.id),
    v_duplicate_count>0,v_duplicate_count,
    'same_client_normalized_vaccine_and_dose'::text,v_result.recorded_at,false;
end;
$$;

create or replace function public.append_client_vaccination(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_vaccination_key uuid, p_previous_version_id uuid,
  p_expected_base_version integer, p_client_id uuid, p_vaccine_name text,
  p_dose_number text, p_vaccinated_on date, p_lot_number text,
  p_provider_name text, p_evidence_status text, p_evidence_reference_id uuid,
  p_evidence_sha256 text, p_evidence_file_name text, p_source_system text,
  p_source_record_id text, p_correction_reason text, p_idempotency_key uuid
) returns table(
  organization_id uuid, branch_id uuid, vaccination_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, client_id uuid, content_hash text,
  record_payload jsonb,
  duplicate_warning boolean, duplicate_count integer, duplicate_basis text,
  recorded_at timestamptz, replayed boolean
) language sql volatile security invoker set search_path = '' as $$
  select * from private.append_client_vaccination_guarded(
    p_expected_organization_id,p_expected_branch_id,p_action,p_vaccination_key,
    p_previous_version_id,p_expected_base_version,p_client_id,p_vaccine_name,
    p_dose_number,p_vaccinated_on,p_lot_number,p_provider_name,p_evidence_status,
    p_evidence_reference_id,p_evidence_sha256,p_evidence_file_name,
    p_source_system,p_source_record_id,p_correction_reason,p_idempotency_key);
$$;

create or replace function private.client_vaccination_hydrate_batch_results(
  p_results jsonb
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(
    case when element->>'status' in ('created','replayed') then
      jsonb_set(element,'{receipt,record_payload}',
        private.client_vaccination_record_payload(
          (element->'receipt'->>'record_version_id')::uuid),true)
    else element end order by ordinal
  ),'[]'::jsonb)
  from jsonb_array_elements(p_results) with ordinality result(element,ordinal);
$$;

create or replace function private.append_client_vaccination_batch_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_items jsonb, p_batch_idempotency_key uuid
) returns table(
  batch_id uuid, batch_idempotency_key uuid, request_hash text,
  item_total integer, succeeded_total integer, rejected_total integer,
  results jsonb, replayed boolean
) language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_hash text; v_count integer; v_success integer := 0;
  v_rejected integer := 0; v_results jsonb := '[]'::jsonb; v_item jsonb;
  v_record jsonb; v_index integer; v_item_key uuid; v_client_id uuid;
  v_vaccination_key uuid; v_previous_id uuid; v_existing jsonb;
  v_receipt record; v_batch private.client_vaccination_batch_operations%rowtype;
  v_code text; v_message text; v_reauth_challenge_id uuid;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
    or p_batch_idempotency_key is null
    or not private.client_vaccination_current_authority(
      p_expected_organization_id,p_expected_branch_id,'client_vaccinations.manage') then
    raise exception using errcode='42501',message='client vaccination batch is not permitted';
  end if;
  v_reauth_challenge_id:=private.require_client_vaccination_reauth(
    v_actor,clock_timestamp());
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'items',p_items
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'page23:batch:' || v_actor::text || ':' || p_batch_idempotency_key::text,0));
  select operation.* into v_batch
  from private.client_vaccination_batch_operations operation
  where operation.actor_user_id=v_actor
    and operation.batch_idempotency_key=p_batch_idempotency_key for share;
  if found then
    if v_batch.request_hash<>v_hash then
      raise exception using errcode='23505',
        message='client vaccination batch idempotency conflict';
    end if;
    -- Rejected items reveal no record receipt and therefore replay exactly even if
    -- the actor still cannot access their requested client. Every successful item
    -- is re-authorized from its immutable receipt so permission/assignment/client
    -- revocation always fails closed before any receipt is returned.
    for v_item in
      select element from jsonb_array_elements(v_batch.results) result(element)
      where element->>'status' in ('created','replayed')
    loop
      begin
        v_client_id := nullif(v_item->'receipt'->>'client_id','')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode='42501',
          message='client vaccination batch replay authority expired';
      end;
      if v_client_id is null or not private.client_vaccination_client_authority(
          p_expected_organization_id,p_expected_branch_id,v_client_id,
          'client_vaccinations.manage')
        or not private.client_vaccination_client_is_active(
          p_expected_organization_id,p_expected_branch_id,v_client_id,clock_timestamp()) then
        raise exception using errcode='42501',
          message='client vaccination batch replay authority expired';
      end if;
    end loop;
    select coalesce(jsonb_agg(case
      when element->>'status' in ('created','replayed') then
        jsonb_set(jsonb_set(element,'{status}','"replayed"'::jsonb),
          '{receipt,replayed}','true'::jsonb,false)
      else element end order by ordinal), '[]'::jsonb)
    into v_existing
    from jsonb_array_elements(v_batch.results) with ordinality result(element,ordinal);
    v_existing:=private.client_vaccination_hydrate_batch_results(v_existing);
    return query select v_batch.id,v_batch.batch_idempotency_key,v_batch.request_hash,
      v_batch.item_total,v_batch.succeeded_total,v_batch.rejected_total,v_existing,true;
    return;
  end if;

  if jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='22023',message='client vaccination batch items must be an array';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count not between 1 and 20 then
    raise exception using errcode='22023',message='client vaccination batch must contain 1 to 20 items';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where jsonb_typeof(item)<>'object'
      or not (item ?& array['idempotency_key','record'])
      or item-array['idempotency_key','record']<>'{}'::jsonb
      or jsonb_typeof(item->'record')<>'object'
      or not ((item->'record') ?& array[
        'action','vaccination_key','previous_version_id','expected_base_version',
        'client_id','vaccine_name','dose_number','vaccinated_on','lot_number',
        'provider_name','evidence_status','evidence_reference_id','evidence_sha256',
        'evidence_file_name','source_system','source_record_id','correction_reason'])
      or (item->'record')-array[
        'action','vaccination_key','previous_version_id','expected_base_version',
        'client_id','vaccine_name','dose_number','vaccinated_on','lot_number',
        'provider_name','evidence_status','evidence_reference_id','evidence_sha256',
        'evidence_file_name','source_system','source_record_id','correction_reason']<>'{}'::jsonb
      or item->'record'->>'action'<>'create'
  ) then
    raise exception using errcode='22023',message='client vaccination batch item shape is invalid';
  end if;
  begin
    if exists (select 1 from (
      select (item->>'idempotency_key')::uuid key,count(*)
      from jsonb_array_elements(p_items) item group by 1 having count(*)>1) duplicate)
      or exists (select 1 from (
        select (item->'record'->>'vaccination_key')::uuid key,count(*)
        from jsonb_array_elements(p_items) item group by 1 having count(*)>1) duplicate) then
      raise exception using errcode='22023',
        message='client vaccination batch keys must be unique';
    end if;
  exception when invalid_text_representation then
    raise exception using errcode='22023',message='client vaccination batch identifiers are invalid';
  end;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_record := v_item->'record';
    begin
      v_item_key := nullif(v_item->>'idempotency_key','')::uuid;
      v_vaccination_key := nullif(v_record->>'vaccination_key','')::uuid;
      v_previous_id := nullif(v_record->>'previous_version_id','')::uuid;
      v_client_id := nullif(v_record->>'client_id','')::uuid;
      select * into v_receipt from private.append_client_vaccination_guarded(
        p_expected_organization_id,p_expected_branch_id,v_record->>'action',
        v_vaccination_key,v_previous_id,(v_record->>'expected_base_version')::integer,
        v_client_id,v_record->>'vaccine_name',v_record->>'dose_number',
        (v_record->>'vaccinated_on')::date,v_record->>'lot_number',
        v_record->>'provider_name',v_record->>'evidence_status',
        nullif(v_record->>'evidence_reference_id','')::uuid,
        v_record->>'evidence_sha256',v_record->>'evidence_file_name',
        v_record->>'source_system',v_record->>'source_record_id',
        v_record->>'correction_reason',v_item_key);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index',v_index,'idempotency_key',v_item_key,
        'status',case when v_receipt.replayed then 'replayed' else 'created' end,
        'receipt',to_jsonb(v_receipt)-'record_payload','error',null));
      v_success := v_success+1;
    exception
      when insufficient_privilege then
        v_code:='NOT_AUTHORIZED'; v_message:='此筆個案疫苗紀錄未獲授權。';
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'index',v_index,'idempotency_key',v_item->>'idempotency_key',
          'status','rejected','receipt',null,
          'error',jsonb_build_object('code',v_code,'message',v_message)));
        v_rejected:=v_rejected+1;
      when unique_violation then
        v_code:='IDEMPOTENCY_CONFLICT'; v_message:='此筆操作鍵已用於不同內容。';
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'index',v_index,'idempotency_key',v_item->>'idempotency_key',
          'status','rejected','receipt',null,
          'error',jsonb_build_object('code',v_code,'message',v_message)));
        v_rejected:=v_rejected+1;
      when invalid_parameter_value or invalid_text_representation
        or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or check_violation then
        v_code:='INVALID_CLIENT_VACCINATION_RECORD';
        v_message:='此筆個案疫苗資料格式或狀態不正確。';
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'index',v_index,'idempotency_key',v_item->>'idempotency_key',
          'status','rejected','receipt',null,
          'error',jsonb_build_object('code',v_code,'message',v_message)));
        v_rejected:=v_rejected+1;
      when serialization_failure or object_not_in_prerequisite_state then
        v_code:='CLIENT_VACCINATION_VERSION_CONFLICT';
        v_message:='此筆個案疫苗版本已改變，請重新整理。';
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'index',v_index,'idempotency_key',v_item->>'idempotency_key',
          'status','rejected','receipt',null,
          'error',jsonb_build_object('code',v_code,'message',v_message)));
        v_rejected:=v_rejected+1;
    end;
    v_index:=v_index+1;
  end loop;

  insert into private.client_vaccination_batch_operations (
    organization_id,branch_id,actor_user_id,batch_idempotency_key,request_hash,
    item_total,succeeded_total,rejected_total,results,reauth_challenge_id
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,
    p_batch_idempotency_key,v_hash,v_count,v_success,v_rejected,v_results,
    v_reauth_challenge_id
  ) returning * into v_batch;
  insert into public.audit_events (
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    idempotency_key,changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'insert',
    'client_vaccination_batch_operations',v_batch.id::text,
    p_batch_idempotency_key,array['request_hash','item_total','results'],
    jsonb_build_object('workflow','page23_client_vaccination_batch_v1',
      'item_total',v_count,'succeeded_total',v_success,'rejected_total',v_rejected,
      'partial_semantics',true,'receipt_atomic',true,'content_logged',false,
      'recent_same_session_aal2_evidence_recorded',true)
  );
  if not private.client_vaccination_current_authority(
      p_expected_organization_id,p_expected_branch_id,'client_vaccinations.manage') then
    raise exception using errcode='42501',message='client vaccination batch authority expired';
  end if;
  v_existing:=private.client_vaccination_hydrate_batch_results(v_batch.results);
  return query select v_batch.id,v_batch.batch_idempotency_key,v_batch.request_hash,
    v_batch.item_total,v_batch.succeeded_total,v_batch.rejected_total,
    v_existing,false;
end;
$$;

create or replace function public.append_client_vaccination_batch(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_items jsonb, p_batch_idempotency_key uuid
) returns table(
  batch_id uuid, batch_idempotency_key uuid, request_hash text,
  item_total integer, succeeded_total integer, rejected_total integer,
  results jsonb, replayed boolean
) language sql volatile security invoker set search_path = '' as $$
  select * from private.append_client_vaccination_batch_guarded(
    p_expected_organization_id,p_expected_branch_id,p_items,p_batch_idempotency_key);
$$;

create or replace function private.client_vaccination_duplicate_summary(
  p_record_version_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with target as (
    select record.* from public.client_vaccination_versions record
    where record.id=p_record_version_id
  ), matches as (
    select other.vaccination_key,other.id record_version_id,other.vaccinated_on
    from target row join public.client_vaccination_versions other
      on other.organization_id=row.organization_id
      and other.branch_id=row.branch_id and other.client_id=row.client_id
      and other.vaccination_key<>row.vaccination_key
      and other.record_status='active' and row.record_status='active'
      and other.normalized_vaccine_name=row.normalized_vaccine_name
      and other.normalized_dose_number=row.normalized_dose_number
      and not exists (select 1 from public.client_vaccination_versions child
        where child.previous_version_id=other.id)
  ), counts as (select count(*)::integer duplicate_count from matches)
  select jsonb_build_object(
    'duplicate_warning',counts.duplicate_count>0,
    'duplicate_count',counts.duplicate_count,
    'duplicate_basis','same_client_normalized_vaccine_and_dose',
    'duplicate_matches',coalesce((select jsonb_agg(jsonb_build_object(
      'vaccination_key',match.vaccination_key,
      'record_version_id',match.record_version_id,'vaccinated_on',match.vaccinated_on)
      order by match.vaccinated_on desc,match.vaccination_key)
      from (select * from matches order by vaccinated_on desc,vaccination_key limit 200) match),
      '[]'::jsonb),
    'duplicate_matches_truncated',counts.duplicate_count>200
  ) from counts;
$$;

create or replace function private.client_vaccination_snapshot_response(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_vaccine_name text default null,
  p_dose_number text default null, p_date_from date default null,
  p_date_to date default null, p_status text default 'all',
  p_query text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, stale_after timestamptz, filters jsonb, records jsonb,
  record_total bigint, records_truncated boolean, missing_evidence_total bigint,
  duplicate_warning_total bigint, current_month_total bigint, history jsonb,
  history_total bigint, history_truncated boolean, client_options jsonb,
  client_total bigint, clients_truncated boolean, vaccine_options jsonb,
  vaccine_total bigint, vaccines_truncated boolean, dose_options jsonb,
  dose_total bigint, doses_truncated boolean, duplicate_rule_status text,
  duplicate_basis text, duplicate_resolution text,
  medical_interpretation_status text, reminder_schedule_status text,
  reminder_days integer, reminder_total bigint, attachment_pipeline_status text,
  attachment_scan_status text, batch_maximum_items integer, offline_status text
) language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_today date;
  v_vaccine text:=nullif(btrim(p_vaccine_name),'');
  v_dose text:=nullif(btrim(p_dose_number),''); v_search text:=nullif(btrim(p_query),'');
begin
  v_today:=(v_now at time zone 'Asia/Taipei')::date;
  if not private.client_vaccination_current_authority(
      p_expected_organization_id,p_expected_branch_id,'client_vaccinations.read')
    or (p_client_id is not null and not private.client_vaccination_client_authority(
      p_expected_organization_id,p_expected_branch_id,p_client_id,'client_vaccinations.read'))
    or (p_vaccine_name is not null and (v_vaccine is null or char_length(v_vaccine)>160
      or v_vaccine ~ '[[:cntrl:]]'))
    or (p_dose_number is not null and (v_dose is null or char_length(v_dose)>80
      or v_dose ~ '[[:cntrl:]]'))
    or (p_date_from is not null and extract(year from p_date_from) not between 1900 and 2200)
    or (p_date_to is not null and extract(year from p_date_to) not between 1900 and 2200)
    or (p_date_from is not null and p_date_to is not null and p_date_from>p_date_to)
    or coalesce(p_status,'all') not in (
      'all','active','voided','missing_evidence','duplicate_warning')
    or (p_query is not null and (v_search is null or char_length(v_search)>120
      or v_search ~ '[[:cntrl:]]')) then
    raise exception using errcode='42501',message='client vaccination snapshot is not permitted';
  end if;

  return query with current_records as materialized (
    select record.*,client.client_code,client.display_name client_display_name,
      private.client_vaccination_duplicate_summary(record.id) duplicate
    from public.client_vaccination_versions record
    join public.clients client on client.id=record.client_id
      and client.organization_id=record.organization_id
      and client.branch_id=record.branch_id
    where record.organization_id=p_expected_organization_id
      and record.branch_id=p_expected_branch_id
      and private.can_staff_access_client(record.client_id,'clients.read')
      and private.can_staff_access_client(record.client_id,'client_vaccinations.read')
      and not exists (select 1 from public.client_vaccination_versions child
        where child.previous_version_id=record.id)
  ), matching as materialized (
    select record.* from current_records record
    where (p_client_id is null or record.client_id=p_client_id)
      and (v_vaccine is null or record.vaccine_name=v_vaccine)
      and (v_dose is null or record.dose_number=v_dose)
      and (p_date_from is null or record.vaccinated_on>=p_date_from)
      and (p_date_to is null or record.vaccinated_on<=p_date_to)
      and (coalesce(p_status,'all')='all' or record.record_status=p_status
        or (p_status='missing_evidence' and record.evidence_status='missing')
        or (p_status='duplicate_warning'
          and (record.duplicate->>'duplicate_warning')::boolean))
      and (v_search is null or strpos(lower(concat_ws(' ',record.client_code,
        record.client_display_name,record.vaccine_name,record.dose_number,
        coalesce(record.lot_number,''),record.provider_name)),lower(v_search))>0)
  ), page as materialized (
    select record.* from matching record
    order by record.vaccinated_on desc,record.vaccination_key
    limit 200
  ), history_scope as materialized (
    select history.*,matching.vaccinated_on terminal_date
    from public.client_vaccination_versions history join matching
      on matching.organization_id=history.organization_id
      and matching.branch_id=history.branch_id
      and matching.client_id=history.client_id
      and matching.vaccination_key=history.vaccination_key
  ), history_page as materialized (
    select history.* from history_scope history
    order by terminal_date desc,vaccination_key,version desc limit 500
  ), client_scope as materialized (
    select client.id,client.client_code,client.display_name,client.status::text service_status,
      client.admitted_on,client.ended_on
    from public.clients client
    where client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id
      and private.can_staff_access_client(client.id,'clients.read')
      and private.can_staff_access_client(client.id,'client_vaccinations.read')
  ), client_page as materialized (
    select client.* from client_scope client order by display_name,id limit 200
  ), vaccine_scope as materialized (
    select vaccine_name value,count(*)::bigint record_count
    from current_records group by vaccine_name
  ), vaccine_page as materialized (
    select option.* from vaccine_scope option order by value limit 200
  ), dose_scope as materialized (
    select dose_number value,count(*)::bigint record_count
    from current_records group by dose_number
  ), dose_page as materialized (
    select option.* from dose_scope option order by value limit 200
  )
  select p_expected_organization_id,p_expected_branch_id,v_now,v_today,
    v_now+interval '60 seconds',jsonb_build_object(
      'client_id',p_client_id,'vaccine_name',v_vaccine,'dose_number',v_dose,
      'date_from',p_date_from,'date_to',p_date_to,'status',coalesce(p_status,'all'),
      'query',coalesce(v_search,'')),
    coalesce((select jsonb_agg(jsonb_build_object(
      'record_version_id',record.id,'vaccination_key',record.vaccination_key,
      'version',record.version,'previous_version_id',record.previous_version_id,
      'record_status',record.record_status,'correction_reason',record.correction_reason,
      'client_id',record.client_id,'client_display_name',record.client_display_name,
      'client_code',record.client_code,'vaccine_name',record.vaccine_name,
      'dose_number',record.dose_number,'vaccinated_on',record.vaccinated_on,
      'lot_number',record.lot_number,'provider_name',record.provider_name,
      'evidence_status',record.evidence_status,
      'evidence_reference_id',record.evidence_reference_id,
      'evidence_sha256',record.evidence_sha256,'evidence_file_name',record.evidence_file_name,
      'source_system',record.source_system,'source_record_id',record.source_record_id,
      'duplicate_warning',(record.duplicate->>'duplicate_warning')::boolean,
      'duplicate_count',(record.duplicate->>'duplicate_count')::integer,
      'duplicate_basis','same_client_normalized_vaccine_and_dose',
      'duplicate_matches',record.duplicate->'duplicate_matches',
      'duplicate_matches_truncated',
        (record.duplicate->>'duplicate_matches_truncated')::boolean,
      'medical_interpretation_status','not_evaluated','recorded_by',record.recorded_by,
      'recorded_by_display_name',record.recorded_by_display_name,
      'recorded_at',record.recorded_at,'content_hash',record.content_hash)
      order by record.vaccinated_on desc,record.vaccination_key)
      from page record),'[]'::jsonb),
    (select count(*) from matching),(select count(*) from matching)>200,
    (select count(*) from matching where evidence_status='missing'),
    (select count(*) from matching
      where (duplicate->>'duplicate_warning')::boolean),
    (select count(*) from matching where vaccinated_on>=date_trunc('month',v_today)::date
      and vaccinated_on<(date_trunc('month',v_today)+interval '1 month')::date),
    coalesce((select jsonb_agg(jsonb_build_object(
      'record_version_id',history.id,'vaccination_key',history.vaccination_key,
      'version',history.version,'previous_version_id',history.previous_version_id,
      'record_status',history.record_status,'correction_reason',history.correction_reason,
      'vaccine_name',history.vaccine_name,'dose_number',history.dose_number,
      'vaccinated_on',history.vaccinated_on,'lot_number',history.lot_number,
      'provider_name',history.provider_name,'evidence_status',history.evidence_status,
      'evidence_reference_id',history.evidence_reference_id,
      'evidence_sha256',history.evidence_sha256,
      'evidence_file_name',history.evidence_file_name,
      'source_system',history.source_system,'source_record_id',history.source_record_id,
      'recorded_by_display_name',history.recorded_by_display_name,
      'recorded_at',history.recorded_at,'content_hash',history.content_hash)
      order by history.terminal_date desc,history.vaccination_key,history.version desc)
      from history_page history),'[]'::jsonb),
    (select count(*) from history_scope),(select count(*) from history_scope)>500,
    coalesce((select jsonb_agg(jsonb_build_object(
      'client_id',client.id,'display_name',client.display_name,
      'client_code',client.client_code,'service_status',client.service_status,
      'can_record',client.service_status='active' and client.admitted_on is not null
        and client.admitted_on<=v_today and client.ended_on is null
        and private.can_staff_access_client(client.id,'client_vaccinations.manage'))
      order by client.display_name,client.id) from client_page client),'[]'::jsonb),
    (select count(*) from client_scope),(select count(*) from client_scope)>200,
    coalesce((select jsonb_agg(jsonb_build_object('vaccine_name',option.value,
      'record_count',option.record_count) order by option.value)
      from vaccine_page option),'[]'::jsonb),
    (select count(*) from vaccine_scope),(select count(*) from vaccine_scope)>200,
    coalesce((select jsonb_agg(jsonb_build_object('dose_number',option.value,
      'record_count',option.record_count) order by option.value)
      from dose_page option),'[]'::jsonb),
    (select count(*) from dose_scope),(select count(*) from dose_scope)>200,
    'configured'::text,'same_client_normalized_vaccine_and_dose'::text,
    'warning_only_no_auto_merge'::text,'not_evaluated'::text,
    'not_configured'::text,null::integer,null::bigint,'not_configured'::text,
    'not_configured'::text,20,'not_configured'::text;

  insert into public.audit_events (
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'client_vaccination_versions','snapshot',array[]::text[],
    jsonb_build_object('workflow','page23_client_vaccination_snapshot_v1',
      'client_filter_applied',p_client_id is not null,
      'vaccine_filter_applied',v_vaccine is not null,
      'dose_filter_applied',v_dose is not null,
      'date_filter_applied',p_date_from is not null or p_date_to is not null,
      'status_filter',coalesce(p_status,'all'),'search_applied',v_search is not null,
      'search_keyword_logged',false,'medical_data_logged',false)
  );
  if not private.client_vaccination_current_authority(
      p_expected_organization_id,p_expected_branch_id,'client_vaccinations.read') then
    raise exception using errcode='42501',message='client vaccination snapshot authority expired';
  end if;
end;
$$;

create or replace function public.client_vaccination_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_vaccine_name text default null,
  p_dose_number text default null, p_date_from date default null,
  p_date_to date default null, p_status text default 'all',
  p_query text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, stale_after timestamptz, filters jsonb, records jsonb,
  record_total bigint, records_truncated boolean, missing_evidence_total bigint,
  duplicate_warning_total bigint, current_month_total bigint, history jsonb,
  history_total bigint, history_truncated boolean, client_options jsonb,
  client_total bigint, clients_truncated boolean, vaccine_options jsonb,
  vaccine_total bigint, vaccines_truncated boolean, dose_options jsonb,
  dose_total bigint, doses_truncated boolean, duplicate_rule_status text,
  duplicate_basis text, duplicate_resolution text,
  medical_interpretation_status text, reminder_schedule_status text,
  reminder_days integer, reminder_total bigint, attachment_pipeline_status text,
  attachment_scan_status text, batch_maximum_items integer, offline_status text
) language sql volatile security invoker set search_path = '' as $$
  select * from private.client_vaccination_snapshot_response(
    p_expected_organization_id,p_expected_branch_id,p_client_id,p_vaccine_name,
    p_dose_number,p_date_from,p_date_to,p_status,p_query);
$$;

revoke all on function private.client_vaccination_append_only()
  from public,anon,authenticated,service_role;
revoke all on function private.normalize_client_vaccination_text(text)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_current_authority(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_client_authority(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_client_is_active(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.require_client_vaccination_reauth(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_attachment_pipeline_enabled(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_record_payload(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.append_client_vaccination_guarded(
  uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,text,text,text,uuid,text,text,text,text,text,uuid
) from public,anon,service_role;
revoke all on function private.append_client_vaccination_batch_guarded(uuid,uuid,jsonb,uuid)
  from public,anon,service_role;
revoke all on function private.client_vaccination_hydrate_batch_results(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_duplicate_summary(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.client_vaccination_snapshot_response(
  uuid,uuid,uuid,text,text,date,date,text,text
) from public,anon,service_role;
revoke all on function public.append_client_vaccination(
  uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,text,text,text,uuid,text,text,text,text,text,uuid
) from public,anon,service_role;
revoke all on function public.append_client_vaccination_batch(uuid,uuid,jsonb,uuid)
  from public,anon,service_role;
revoke all on function public.client_vaccination_snapshot(
  uuid,uuid,uuid,text,text,date,date,text,text
) from public,anon,service_role;

grant execute on function private.append_client_vaccination_guarded(
  uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,text,text,text,uuid,text,text,text,text,text,uuid
) to authenticated;
grant execute on function private.append_client_vaccination_batch_guarded(uuid,uuid,jsonb,uuid)
  to authenticated;
grant execute on function private.client_vaccination_snapshot_response(
  uuid,uuid,uuid,text,text,date,date,text,text
) to authenticated;
grant execute on function public.append_client_vaccination(
  uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,text,text,text,uuid,text,text,text,text,text,uuid
) to authenticated;
grant execute on function public.append_client_vaccination_batch(uuid,uuid,jsonb,uuid)
  to authenticated;
grant execute on function public.client_vaccination_snapshot(
  uuid,uuid,uuid,text,text,date,date,text,text
) to authenticated;
