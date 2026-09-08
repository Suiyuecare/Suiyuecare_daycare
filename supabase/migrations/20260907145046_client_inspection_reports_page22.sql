-- Page 22: immutable client inspection report versions.
-- Narrative values are copied as staff-provided source text. No diagnosis,
-- medical interpretation, OCR, attachment upload/download, or export runs here.

insert into public.permissions (permission_key, description, risk_level) values
  ('client_reports.read', 'Read assigned-client inspection reports', 2),
  ('client_reports.manage', 'Create, correct and void assigned-client inspection reports', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and ((permission.permission_key = 'client_reports.read' and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'professional'
  )) or (permission.permission_key = 'client_reports.manage' and role.role_key in (
    'organization_manager', 'branch_supervisor', 'nurse'
  )))
on conflict (role_id, permission_id) do nothing;

create table private.client_report_attachments (
  id uuid primary key,
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  sha256 text not null,
  source_filename text not null,
  storage_status text not null,
  scan_status text not null,
  registered_by uuid not null references auth.users(id) on delete restrict,
  registered_at timestamptz not null default clock_timestamp(),
  constraint client_report_attachments_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_report_attachments_scope_key unique (
    id, organization_id, branch_id, client_id, sha256, source_filename
  ),
  constraint client_report_attachments_sha_check check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint client_report_attachments_filename_check check (
    char_length(source_filename) between 1 and 255
    and source_filename = btrim(source_filename)
    and source_filename !~ '[[:cntrl:]]'
  ),
  constraint client_report_attachments_state_check check (
    storage_status = 'stored' and scan_status = 'clean'
  )
);

comment on table private.client_report_attachments is
  'Trusted attachment registry reserved for a future private upload and malware-scanning provider. Page 22 cannot populate it while the pipeline is not configured.';

create table public.client_inspection_report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  report_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  report_type text not null,
  examined_on date not null,
  result_status text not null,
  result_text text,
  result_reason text,
  source_status text not null,
  source_text text,
  source_reason text,
  attachment_status text not null,
  attachment_id uuid,
  attachment_sha256 text,
  attachment_source_filename text,
  payload_hash text not null,
  content_hash text not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_by_display_name text not null,
  correction_reason text,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint client_inspection_reports_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_inspection_reports_id_scope_key unique (
    id, organization_id, branch_id, client_id, report_key
  ),
  constraint client_inspection_reports_chain_key unique (
    organization_id, branch_id, report_key, version
  ),
  constraint client_inspection_reports_previous_key unique (previous_version_id),
  constraint client_inspection_reports_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, client_id, report_key
  ) references public.client_inspection_report_versions (
    id, organization_id, branch_id, client_id, report_key
  ) on delete restrict,
  constraint client_inspection_reports_attachment_scope_fkey foreign key (
    attachment_id, organization_id, branch_id, client_id,
    attachment_sha256, attachment_source_filename
  ) references private.client_report_attachments (
    id, organization_id, branch_id, client_id, sha256, source_filename
  ) on delete restrict,
  constraint client_inspection_reports_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null
      and reauth_challenge_id is null)
      or (version > 1 and previous_version_id is not null and correction_reason is not null
        and reauth_challenge_id is not null))
  ),
  constraint client_inspection_reports_status_check check (
    record_status in ('active', 'voided')
  ),
  constraint client_inspection_reports_terminal_check check (
    record_status = 'active' or version > 1
  ),
  constraint client_inspection_reports_type_check check (
    char_length(report_type) between 1 and 160
    and report_type = btrim(report_type) and report_type !~ '[[:cntrl:]]'
  ),
  constraint client_inspection_reports_date_check check (
    extract(year from examined_on) between 1900 and 2200
  ),
  constraint client_inspection_reports_result_check check (
    result_status in ('present', 'missing', 'not_applicable')
    and ((result_status = 'present' and result_text is not null
      and char_length(result_text) between 1 and 4000 and result_text = btrim(result_text)
      and translate(result_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and result_reason is null)
    or (result_status in ('missing', 'not_applicable') and result_text is null
      and result_reason is not null and char_length(result_reason) between 8 and 1000
      and result_reason = btrim(result_reason)
      and translate(result_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  ),
  constraint client_inspection_reports_source_check check (
    source_status in ('present', 'missing', 'not_applicable')
    and ((source_status = 'present' and source_text is not null
      and char_length(source_text) between 1 and 1000 and source_text = btrim(source_text)
      and translate(source_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and source_reason is null)
    or (source_status in ('missing', 'not_applicable') and source_text is null
      and source_reason is not null and char_length(source_reason) between 8 and 1000
      and source_reason = btrim(source_reason)
      and translate(source_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  ),
  constraint client_inspection_reports_attachment_check check (
    (attachment_status = 'provided' and attachment_id is not null
      and attachment_sha256 ~ '^[a-f0-9]{64}$'
      and attachment_source_filename is not null
      and char_length(attachment_source_filename) between 1 and 255
      and attachment_source_filename = btrim(attachment_source_filename)
      and attachment_source_filename !~ '[[:cntrl:]]')
    or (attachment_status in ('missing', 'not_applicable')
      and attachment_id is null and attachment_sha256 is null
      and attachment_source_filename is null)
  ),
  constraint client_inspection_reports_hash_check check (
    payload_hash ~ '^[a-f0-9]{64}$' and content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint client_inspection_reports_actor_check check (
    char_length(recorded_by_display_name) between 1 and 160
    and recorded_by_display_name = btrim(recorded_by_display_name)
    and recorded_by_display_name !~ '[[:cntrl:]]'
  ),
  constraint client_inspection_reports_reason_check check (
    correction_reason is null or (char_length(correction_reason) between 8 and 1000
      and correction_reason = btrim(correction_reason)
      and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
  )
);

comment on table public.client_inspection_report_versions is
  'Immutable Page-22 client inspection report versions, distinct from employee health reports.';
comment on column public.client_inspection_report_versions.result_text is
  'Staff-transcribed source result only; never a diagnosis or automated medical interpretation.';

create table private.client_inspection_report_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  result_report_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_record_status text not null,
  result_payload_hash text not null,
  result_content_hash text not null,
  result_exact_duplicate_count integer not null,
  result_key_field_duplicate_count integer not null,
  result_attachment_duplicate_count integer not null,
  result_recorded_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_inspection_report_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint client_inspection_report_operations_result_scope_fkey foreign key (
    result_version_id, organization_id, branch_id, client_id, result_report_key
  ) references public.client_inspection_report_versions (
    id, organization_id, branch_id, client_id, report_key
  ) on delete restrict,
  constraint client_inspection_report_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and result_payload_hash ~ '^[a-f0-9]{64}$'
    and result_content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint client_inspection_report_operations_action_check check (
    action in ('create', 'correct', 'void')
  ),
  constraint client_inspection_report_operations_result_check check (
    result_version > 0 and result_record_status in ('active', 'voided')
    and result_exact_duplicate_count >= 0 and result_key_field_duplicate_count >= 0
    and result_attachment_duplicate_count >= 0
    and result_key_field_duplicate_count >= result_exact_duplicate_count
    and ((action = 'create' and result_version = 1 and result_record_status = 'active'
      and reauth_challenge_id is null)
      or (action = 'correct' and result_version > 1 and result_record_status = 'active'
        and reauth_challenge_id is not null)
      or (action = 'void' and result_version > 1 and result_record_status = 'voided'
        and reauth_challenge_id is not null and result_exact_duplicate_count = 0
        and result_key_field_duplicate_count = 0
        and result_attachment_duplicate_count = 0))
  )
);

create index client_report_attachments_client_idx
  on private.client_report_attachments (client_id, registered_at desc);
create index client_report_attachments_actor_idx
  on private.client_report_attachments (registered_by);
create index client_inspection_reports_scope_date_idx
  on public.client_inspection_report_versions (
    organization_id, branch_id, examined_on desc, report_key, version desc
  );
create index client_inspection_reports_client_date_idx
  on public.client_inspection_report_versions (
    client_id, examined_on desc, report_key, version desc
  );
create index client_inspection_reports_previous_idx
  on public.client_inspection_report_versions (previous_version_id)
  where previous_version_id is not null;
create index client_inspection_reports_actor_idx
  on public.client_inspection_report_versions (recorded_by);
create index client_inspection_reports_reauth_idx
  on public.client_inspection_report_versions (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index client_inspection_reports_payload_idx
  on public.client_inspection_report_versions (organization_id, branch_id, payload_hash)
  where record_status = 'active';
create index client_inspection_reports_duplicate_key_idx
  on public.client_inspection_report_versions (
    organization_id, branch_id, client_id, lower(report_type), examined_on,
    source_status, lower(coalesce(source_text, source_reason))
  ) where record_status = 'active';
create index client_inspection_reports_attachment_hash_idx
  on public.client_inspection_report_versions (
    organization_id, branch_id, attachment_sha256
  ) where record_status = 'active' and attachment_sha256 is not null;
create index client_inspection_reports_attachment_scope_idx
  on public.client_inspection_report_versions (
    attachment_id, attachment_sha256, attachment_source_filename
  ) where attachment_id is not null;
create index client_inspection_report_operations_result_idx
  on private.client_inspection_report_operations (
    organization_id, branch_id, client_id, result_report_key, result_version
  );
create index client_inspection_report_operations_version_id_idx
  on private.client_inspection_report_operations (result_version_id);
create index client_inspection_report_operations_reauth_idx
  on private.client_inspection_report_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table private.client_report_attachments enable row level security;
alter table private.client_report_attachments force row level security;
alter table public.client_inspection_report_versions enable row level security;
alter table public.client_inspection_report_versions force row level security;
alter table private.client_inspection_report_operations enable row level security;
alter table private.client_inspection_report_operations force row level security;
revoke all on table private.client_report_attachments from public, anon, authenticated, service_role;
revoke all on table public.client_inspection_report_versions from public, anon, authenticated, service_role;
revoke all on table private.client_inspection_report_operations from public, anon, authenticated, service_role;

create or replace function private.client_inspection_report_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'client inspection report history is append-only';
end;
$$;

create trigger client_report_attachments_append_only before update or delete
  on private.client_report_attachments for each row
  execute function private.client_inspection_report_append_only();
create trigger client_inspection_report_versions_append_only before update or delete
  on public.client_inspection_report_versions for each row
  execute function private.client_inspection_report_append_only();
create trigger client_inspection_report_operations_append_only before update or delete
  on private.client_inspection_report_operations for each row
  execute function private.client_inspection_report_append_only();
create trigger client_report_attachments_audit_row_change after insert
  on private.client_report_attachments for each row execute function private.audit_row_change();
create trigger client_inspection_report_versions_audit_row_change after insert
  on public.client_inspection_report_versions for each row execute function private.audit_row_change();
create trigger client_inspection_report_operations_audit_row_change after insert
  on private.client_inspection_report_operations for each row execute function private.audit_row_change();

create or replace function private.client_report_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.profiles profile where profile.id = auth.uid()
      and profile.kind in ('staff', 'professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id and branch.is_active)
    and private.has_permission(p_expected_organization_id, p_expected_branch_id, 'clients.read')
    and private.has_permission(p_expected_organization_id, p_expected_branch_id, 'health.read')
    and private.has_permission(p_expected_organization_id, p_expected_branch_id, p_permission);
$$;

create or replace function private.client_report_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.client_report_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission)
    and exists (select 1 from public.clients client where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id)
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, 'health.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.client_report_attachment_pipeline_enabled(
  p_expected_organization_id uuid, p_expected_branch_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select false;
$$;

create or replace function private.require_client_report_reauth(
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
  begin v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id and challenge.user_id = event.user_id
    and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.client_report_state_valid(
  p_status text, p_value text, p_reason text, p_value_max integer
) returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_status in ('present', 'missing', 'not_applicable')
    and ((p_status = 'present' and p_value is not null
      and char_length(p_value) between 1 and p_value_max and p_value = btrim(p_value)
      and translate(p_value, E'\n\r\t', '') !~ '[[:cntrl:]]' and p_reason is null)
    or (p_status in ('missing', 'not_applicable') and p_value is null
      and p_reason is not null and char_length(p_reason) between 8 and 1000
      and p_reason = btrim(p_reason)
      and translate(p_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'));
$$;

create or replace function private.append_client_inspection_report_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_payload jsonb, p_idempotency_key uuid
) returns table(
  organization_id uuid, branch_id uuid, report_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, client_id uuid, content_hash text, payload_hash text,
  exact_duplicate_count integer, key_field_duplicate_count integer,
  attachment_duplicate_count integer, duplicate_warning boolean,
  duplicate_resolution text, recorded_at timestamptz, replayed boolean
) language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_action text;
  v_client_id uuid;
  v_report_key uuid;
  v_previous_id uuid;
  v_expected_version integer;
  v_report_type text;
  v_examined_on date;
  v_result_status text;
  v_result_text text;
  v_result_reason text;
  v_source_status text;
  v_source_text text;
  v_source_reason text;
  v_attachment_status text;
  v_attachment_id uuid;
  v_attachment_sha256 text;
  v_attachment_filename text;
  v_reason text;
  v_actor_name text;
  v_request_hash text;
  v_payload_hash text;
  v_content_hash text;
  v_version integer;
  v_record_status text;
  v_reauth_challenge_id uuid;
  v_exact integer := 0;
  v_key integer := 0;
  v_attachment integer := 0;
  v_previous public.client_inspection_report_versions%rowtype;
  v_result public.client_inspection_report_versions%rowtype;
  v_operation private.client_inspection_report_operations%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
    or p_idempotency_key is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid client inspection report request';
  end if;
  v_action := p_payload ->> 'action';
  if v_action not in ('create', 'correct', 'void') then
    raise exception using errcode = '22023', message = 'invalid client inspection report action';
  end if;
  if (v_action in ('create', 'correct') and not (
      p_payload ?& array['action','report_key','previous_version_id','expected_base_version',
        'client_id','report_type','examined_on','result_status','result_text','result_reason',
        'source_status','source_text','source_reason','attachment_status','attachment_id',
        'attachment_sha256','attachment_source_filename','correction_reason']
      and p_payload - array['action','report_key','previous_version_id','expected_base_version',
        'client_id','report_type','examined_on','result_status','result_text','result_reason',
        'source_status','source_text','source_reason','attachment_status','attachment_id',
        'attachment_sha256','attachment_source_filename','correction_reason'] = '{}'::jsonb))
    or (v_action = 'void' and not (
      p_payload ?& array['action','report_key','previous_version_id','expected_base_version',
        'client_id','correction_reason']
      and p_payload - array['action','report_key','previous_version_id','expected_base_version',
        'client_id','correction_reason'] = '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'unexpected client inspection report fields';
  end if;
  begin
    v_client_id := nullif(p_payload ->> 'client_id', '')::uuid;
    v_report_key := nullif(p_payload ->> 'report_key', '')::uuid;
    v_previous_id := nullif(p_payload ->> 'previous_version_id', '')::uuid;
    v_expected_version := (p_payload ->> 'expected_base_version')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid client inspection report identifiers';
  end;
  if v_client_id is null or v_report_key is null or v_expected_version < 0
    or (v_action = 'create' and (v_previous_id is not null or v_expected_version <> 0
      or p_payload -> 'correction_reason' <> 'null'::jsonb))
    or (v_action in ('correct','void') and (v_previous_id is null or v_expected_version < 1)) then
    raise exception using errcode = '22023', message = 'invalid client inspection report version request';
  end if;
  v_reason := nullif(btrim(p_payload ->> 'correction_reason'), '');
  if v_action in ('correct','void') and (v_reason is null
      or char_length(v_reason) not between 8 and 1000
      or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'client inspection report reason is invalid';
  end if;

  if not private.client_report_client_authority(p_expected_organization_id,
      p_expected_branch_id, v_client_id, 'client_reports.manage') then
    raise exception using errcode = '42501', message = 'client inspection report client is not permitted';
  end if;
  if v_action in ('correct','void') then
    v_reauth_challenge_id := private.require_client_report_reauth(v_actor, v_now);
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'payload', p_payload
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'page22:operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));

  select operation.* into v_operation
  from private.client_inspection_report_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'client inspection report idempotency conflict';
    end if;
    if v_operation.organization_id <> p_expected_organization_id
      or v_operation.branch_id <> p_expected_branch_id
      or v_operation.client_id <> v_client_id
      or not private.client_report_client_authority(p_expected_organization_id,
        p_expected_branch_id, v_client_id, 'client_reports.manage')
      or not exists (select 1 from public.client_inspection_report_versions record
        where record.id = v_operation.result_version_id
          and record.organization_id = v_operation.organization_id
          and record.branch_id = v_operation.branch_id
          and record.client_id = v_operation.client_id
          and record.report_key = v_operation.result_report_key) then
      raise exception using errcode = '42501', message = 'client inspection report replay authority expired';
    end if;
    return query select v_operation.organization_id, v_operation.branch_id,
      v_operation.result_report_key, v_operation.result_version_id,
      v_operation.result_version,
      (select record.previous_version_id from public.client_inspection_report_versions record
        where record.id = v_operation.result_version_id),
      v_operation.result_record_status, v_operation.client_id,
      v_operation.result_content_hash, v_operation.result_payload_hash,
      v_operation.result_exact_duplicate_count,
      v_operation.result_key_field_duplicate_count,
      v_operation.result_attachment_duplicate_count,
      v_operation.result_exact_duplicate_count > 0
        or v_operation.result_key_field_duplicate_count > 0
        or v_operation.result_attachment_duplicate_count > 0,
      'warning_only_no_auto_merge'::text,
      v_operation.result_recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'page22:report:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || v_report_key::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'page22:client:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || v_client_id::text, 0));

  if not private.client_report_client_authority(p_expected_organization_id,
      p_expected_branch_id, v_client_id, 'client_reports.manage') then
    raise exception using errcode = '42501', message = 'client inspection report authority expired';
  end if;
  select profile.display_name into v_actor_name
  from public.profiles profile
  where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501', message = 'client inspection report actor is invalid';
  end if;

  if v_action = 'create' then
    if exists (select 1 from public.client_inspection_report_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id and record.report_key = v_report_key) then
      raise exception using errcode = '23505', message = 'client inspection report key already exists';
    end if;
    v_version := 1;
  else
    select record.* into v_previous
    from public.client_inspection_report_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id and record.report_key = v_report_key
      and not exists (select 1 from public.client_inspection_report_versions child
        where child.previous_version_id = record.id)
    order by record.version desc limit 1 for share;
    if v_previous.id is null or v_previous.id <> v_previous_id
      or v_previous.version <> v_expected_version
      or v_previous.client_id <> v_client_id then
      raise exception using errcode = '40001', message = 'client inspection report version is stale';
    end if;
    if v_previous.record_status <> 'active' then
      raise exception using errcode = '23514', message = 'voided client inspection report is terminal';
    end if;
    v_version := v_previous.version + 1;
  end if;

  if v_action = 'void' then
    v_report_type := v_previous.report_type;
    v_examined_on := v_previous.examined_on;
    v_result_status := v_previous.result_status;
    v_result_text := v_previous.result_text;
    v_result_reason := v_previous.result_reason;
    v_source_status := v_previous.source_status;
    v_source_text := v_previous.source_text;
    v_source_reason := v_previous.source_reason;
    v_attachment_status := v_previous.attachment_status;
    v_attachment_id := v_previous.attachment_id;
    v_attachment_sha256 := v_previous.attachment_sha256;
    v_attachment_filename := v_previous.attachment_source_filename;
    v_payload_hash := v_previous.payload_hash;
    v_record_status := 'voided';
  else
    v_report_type := btrim(p_payload ->> 'report_type');
    begin v_examined_on := (p_payload ->> 'examined_on')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'client inspection report date is invalid';
    end;
    v_result_status := p_payload ->> 'result_status';
    v_result_text := nullif(btrim(p_payload ->> 'result_text'), '');
    v_result_reason := nullif(btrim(p_payload ->> 'result_reason'), '');
    v_source_status := p_payload ->> 'source_status';
    v_source_text := nullif(btrim(p_payload ->> 'source_text'), '');
    v_source_reason := nullif(btrim(p_payload ->> 'source_reason'), '');
    v_attachment_status := p_payload ->> 'attachment_status';
    v_attachment_sha256 := nullif(p_payload ->> 'attachment_sha256', '');
    v_attachment_filename := nullif(btrim(p_payload ->> 'attachment_source_filename'), '');
    begin v_attachment_id := nullif(p_payload ->> 'attachment_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'client inspection report attachment is invalid';
    end;
    if v_report_type is null or char_length(v_report_type) not between 1 and 160
      or v_report_type ~ '[[:cntrl:]]' or extract(year from v_examined_on) not between 1900 and 2200
      or not private.client_report_state_valid(
        v_result_status, v_result_text, v_result_reason, 4000)
      or not private.client_report_state_valid(
        v_source_status, v_source_text, v_source_reason, 1000) then
      raise exception using errcode = '22023', message = 'client inspection report content is invalid';
    end if;
    if v_attachment_status in ('missing','not_applicable') then
      if v_attachment_id is not null or v_attachment_sha256 is not null
        or v_attachment_filename is not null then
        raise exception using errcode = '22023', message = 'client inspection report attachment state is invalid';
      end if;
    elsif v_attachment_status = 'provided' then
      if v_attachment_id is null or v_attachment_sha256 !~ '^[a-f0-9]{64}$'
        or v_attachment_filename is null or char_length(v_attachment_filename) not between 1 and 255
        or v_attachment_filename ~ '[[:cntrl:]]'
        or not exists (select 1 from private.client_report_attachments attachment
          where attachment.id = v_attachment_id
            and attachment.organization_id = p_expected_organization_id
            and attachment.branch_id = p_expected_branch_id
            and attachment.client_id = v_client_id
            and attachment.sha256 = v_attachment_sha256
            and attachment.source_filename = v_attachment_filename
            and attachment.storage_status = 'stored' and attachment.scan_status = 'clean')
        or not ((v_action = 'correct' and v_previous.attachment_status = 'provided'
          and v_previous.attachment_id = v_attachment_id
          and v_previous.attachment_sha256 = v_attachment_sha256
          and v_previous.attachment_source_filename = v_attachment_filename)
          or private.client_report_attachment_pipeline_enabled(
            p_expected_organization_id, p_expected_branch_id)) then
        raise exception using errcode = '42501', message = 'client inspection report attachment pipeline is not configured';
      end if;
    else
      raise exception using errcode = '22023', message = 'client inspection report attachment state is invalid';
    end if;
    v_record_status := 'active';
    v_payload_hash := encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1, 'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id, 'client_id', v_client_id,
      'report_type', v_report_type, 'examined_on', v_examined_on,
      'result_status', v_result_status, 'result_text', v_result_text,
      'result_reason', v_result_reason, 'source_status', v_source_status,
      'source_text', v_source_text, 'source_reason', v_source_reason,
      'attachment_status', v_attachment_status, 'attachment_id', v_attachment_id,
      'attachment_sha256', v_attachment_sha256,
      'attachment_source_filename', v_attachment_filename
    )::text, 'UTF8')), 'hex');
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', v_client_id,
    'report_key', v_report_key, 'version', v_version,
    'previous_version_id', v_previous_id, 'record_status', v_record_status,
    'payload_hash', v_payload_hash, 'correction_reason', v_reason,
    'recorded_by', v_actor, 'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.client_inspection_report_versions (
    organization_id, branch_id, client_id, report_key, version,
    previous_version_id, record_status, report_type, examined_on,
    result_status, result_text, result_reason, source_status, source_text,
    source_reason, attachment_status, attachment_id, attachment_sha256,
    attachment_source_filename, payload_hash, content_hash, recorded_by,
    recorded_by_display_name, correction_reason, reauth_challenge_id, recorded_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_client_id, v_report_key,
    v_version, v_previous_id, v_record_status, v_report_type, v_examined_on,
    v_result_status, v_result_text, v_result_reason, v_source_status, v_source_text,
    v_source_reason, v_attachment_status, v_attachment_id, v_attachment_sha256,
    v_attachment_filename, v_payload_hash, v_content_hash, v_actor, v_actor_name,
    v_reason, v_reauth_challenge_id, v_now
  ) returning * into v_result;

  if v_record_status = 'active' then
    select count(*)::integer into v_exact
    from public.client_inspection_report_versions other
    where other.organization_id = p_expected_organization_id
      and other.branch_id = p_expected_branch_id and other.record_status = 'active'
      and other.report_key <> v_report_key and other.payload_hash = v_payload_hash
      and not exists (select 1 from public.client_inspection_report_versions child
        where child.previous_version_id = other.id);
    select count(*)::integer into v_key
    from public.client_inspection_report_versions other
    where other.organization_id = p_expected_organization_id
      and other.branch_id = p_expected_branch_id and other.record_status = 'active'
      and other.report_key <> v_report_key and other.client_id = v_client_id
      and lower(other.report_type) = lower(v_report_type)
      and other.examined_on = v_examined_on and other.source_status = v_source_status
      and lower(coalesce(other.source_text, other.source_reason)) =
        lower(coalesce(v_source_text, v_source_reason))
      and not exists (select 1 from public.client_inspection_report_versions child
        where child.previous_version_id = other.id);
    if v_attachment_sha256 is not null then
      select count(*)::integer into v_attachment
      from public.client_inspection_report_versions other
      where other.organization_id = p_expected_organization_id
        and other.branch_id = p_expected_branch_id and other.record_status = 'active'
        and other.report_key <> v_report_key
        and other.attachment_sha256 = v_attachment_sha256
        and not exists (select 1 from public.client_inspection_report_versions child
          where child.previous_version_id = other.id);
    end if;
  end if;

  insert into private.client_inspection_report_operations (
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    request_hash, action, result_report_key, result_version_id, result_version,
    result_record_status, result_payload_hash, result_content_hash,
    result_exact_duplicate_count, result_key_field_duplicate_count,
    result_attachment_duplicate_count, result_recorded_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_client_id, v_actor,
    p_idempotency_key, v_request_hash, v_action, v_report_key, v_result.id,
    v_result.version, v_result.record_status, v_result.payload_hash,
    v_result.content_hash, v_exact, v_key, v_attachment, v_result.recorded_at,
    v_reauth_challenge_id
  ) returning * into v_operation;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when v_action = 'create' then 'insert' else 'correct' end,
    'client_inspection_report_versions', v_result.id::text, p_idempotency_key,
    array['record_status','version','client_id','report_type','examined_on',
      'result_status','source_status','attachment_status','payload_hash','content_hash'],
    jsonb_build_object('workflow', 'page22_client_inspection_report_v1',
      'report_key', v_report_key, 'version', v_version, 'state', v_record_status,
      'client_id', v_client_id, 'contains_result', true, 'result_logged', false,
      'attachment_pipeline_configured', false)
  );

  if not private.client_report_client_authority(p_expected_organization_id,
      p_expected_branch_id, v_client_id, 'client_reports.manage')
    or not exists (select 1 from public.client_inspection_report_versions record
      where record.id = v_result.id
        and not exists (select 1 from public.client_inspection_report_versions child
          where child.previous_version_id = record.id)) then
    raise exception using errcode = '42501', message = 'client inspection report final verification failed';
  end if;

  return query select p_expected_organization_id, p_expected_branch_id,
    v_report_key, v_result.id, v_result.version, v_result.previous_version_id,
    v_result.record_status, v_client_id, v_result.content_hash,
    v_result.payload_hash, v_exact, v_key, v_attachment,
    (v_exact > 0 or v_key > 0 or v_attachment > 0),
    'warning_only_no_auto_merge'::text, v_result.recorded_at, false;
end;
$$;

create or replace function public.append_client_inspection_report(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_payload jsonb, p_idempotency_key uuid
) returns table(
  organization_id uuid, branch_id uuid, report_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, client_id uuid, content_hash text, payload_hash text,
  exact_duplicate_count integer, key_field_duplicate_count integer,
  attachment_duplicate_count integer, duplicate_warning boolean,
  duplicate_resolution text, recorded_at timestamptz, replayed boolean
) language sql volatile security invoker set search_path = '' as $$
  select * from private.append_client_inspection_report_guarded(
    p_expected_organization_id, p_expected_branch_id, p_payload, p_idempotency_key);
$$;

create or replace function private.client_inspection_report_duplicate_summary(
  p_record_version_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with target as (
    select record.* from public.client_inspection_report_versions record
    where record.id = p_record_version_id
  ), matches as (
    select other.report_key, other.id as record_version_id, other.examined_on,
      match.match_kind
    from target row
    join public.client_inspection_report_versions other
      on other.organization_id = row.organization_id
      and other.branch_id = row.branch_id and other.record_status = 'active'
      and other.report_key <> row.report_key
      and not exists (select 1 from public.client_inspection_report_versions child
        where child.previous_version_id = other.id)
    cross join lateral (
      select 'exact_content'::text as match_kind
        where row.record_status = 'active' and other.payload_hash = row.payload_hash
      union all
      select 'same_client_type_date_source'::text
        where row.record_status = 'active' and other.client_id = row.client_id
          and lower(other.report_type) = lower(row.report_type)
          and other.examined_on = row.examined_on
          and other.source_status = row.source_status
          and lower(coalesce(other.source_text, other.source_reason)) =
            lower(coalesce(row.source_text, row.source_reason))
      union all
      select 'same_attachment_sha256'::text
        where row.record_status = 'active' and row.attachment_sha256 is not null
          and other.attachment_sha256 = row.attachment_sha256
    ) match
  ), counts as (
    select count(*) filter (where match_kind = 'exact_content')::integer as exact_count,
      count(*) filter (where match_kind = 'same_client_type_date_source')::integer as key_count,
      count(*) filter (where match_kind = 'same_attachment_sha256')::integer as attachment_count,
      count(*)::integer as match_count
    from matches
  )
  select jsonb_build_object(
    'exact_duplicate_count', counts.exact_count,
    'key_field_duplicate_count', counts.key_count,
    'attachment_duplicate_count', counts.attachment_count,
    'duplicate_warning', counts.match_count > 0,
    'duplicate_bases', to_jsonb(array_remove(array[
      case when counts.exact_count > 0 then 'exact_content' end,
      case when counts.key_count > 0 then 'same_client_type_date_source' end,
      case when counts.attachment_count > 0 then 'same_attachment_sha256' end
    ]::text[], null)),
    'duplicate_matches', coalesce((select jsonb_agg(jsonb_build_object(
      'report_key', match.report_key, 'record_version_id', match.record_version_id,
      'examined_on', match.examined_on, 'match_kind', match.match_kind
    ) order by match.match_kind, match.examined_on desc, match.report_key)
      from (select * from matches order by match_kind, examined_on desc, report_key limit 200) match),
      '[]'::jsonb),
    'duplicate_matches_truncated', counts.match_count > 200
  ) from counts;
$$;

create or replace function private.client_inspection_report_snapshot_response(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_report_type text default null,
  p_examined_from date default null, p_examined_to date default null,
  p_record_status text default 'all', p_result_status text default 'all',
  p_source_status text default 'all', p_attachment_status text default 'all',
  p_duplicate_status text default 'all', p_search text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, active_total bigint, voided_total bigint,
  missing_result_total bigint, missing_attachment_total bigint,
  duplicate_warning_total bigint, history jsonb, history_total bigint,
  history_truncated boolean, client_options jsonb, client_total bigint,
  clients_truncated boolean, type_options jsonb, type_total bigint,
  types_truncated boolean, duplicate_rule_status text,
  duplicate_resolution text, report_type_taxonomy_status text,
  medical_interpretation_status text, diagnosis_status text, ocr_status text,
  attachment_pipeline_status text, attachment_scan_status text,
  attachment_download_status text, export_status text, offline_status text,
  recent_aal2_max_age_minutes integer
) language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
begin
  if not private.client_report_current_authority(p_expected_organization_id,
      p_expected_branch_id, 'client_reports.read')
    or (p_client_id is not null and not private.client_report_client_authority(
      p_expected_organization_id, p_expected_branch_id, p_client_id,
      'client_reports.read'))
    or (p_report_type is not null and (char_length(btrim(p_report_type)) not between 1 and 160
      or p_report_type <> btrim(p_report_type) or p_report_type ~ '[[:cntrl:]]'))
    or (p_examined_from is not null and extract(year from p_examined_from) not between 1900 and 2200)
    or (p_examined_to is not null and extract(year from p_examined_to) not between 1900 and 2200)
    or (p_examined_from is not null and p_examined_to is not null
      and p_examined_from > p_examined_to)
    or p_record_status not in ('all','active','voided')
    or p_result_status not in ('all','present','missing','not_applicable')
    or p_source_status not in ('all','present','missing','not_applicable')
    or p_attachment_status not in ('all','provided','missing','not_applicable')
    or p_duplicate_status not in ('all','any','exact','key_fields','attachment','none')
    or (p_search is not null and (char_length(p_search) > 120
      or p_search <> btrim(p_search) or p_search ~ '[[:cntrl:]]')) then
    raise exception using errcode = '42501', message = 'client inspection report snapshot is not permitted';
  end if;

  return query
  with current_records as materialized (
    select record.*, client.client_code, client.display_name as client_display_name
    from public.client_inspection_report_versions record
    join public.clients client on client.id = record.client_id
      and client.organization_id = record.organization_id
      and client.branch_id = record.branch_id
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.can_staff_access_client(record.client_id, 'clients.read')
      and private.can_staff_access_client(record.client_id, 'health.read')
      and private.can_staff_access_client(record.client_id, 'client_reports.read')
      and not exists (select 1 from public.client_inspection_report_versions child
        where child.previous_version_id = record.id)
  ), summarized as materialized (
    select record.*, private.client_inspection_report_duplicate_summary(record.id) as duplicate
    from current_records record
  ), matching as materialized (
    select record.* from summarized record
    where (p_client_id is null or record.client_id = p_client_id)
      and (p_report_type is null or record.report_type = p_report_type)
      and (p_examined_from is null or record.examined_on >= p_examined_from)
      and (p_examined_to is null or record.examined_on <= p_examined_to)
      and (p_record_status = 'all' or record.record_status = p_record_status)
      and (p_result_status = 'all' or record.result_status = p_result_status)
      and (p_source_status = 'all' or record.source_status = p_source_status)
      and (p_attachment_status = 'all' or record.attachment_status = p_attachment_status)
      and (p_duplicate_status = 'all'
        or (p_duplicate_status = 'any' and (record.duplicate ->> 'duplicate_warning')::boolean)
        or (p_duplicate_status = 'exact'
          and (record.duplicate ->> 'exact_duplicate_count')::integer > 0)
        or (p_duplicate_status = 'key_fields'
          and (record.duplicate ->> 'key_field_duplicate_count')::integer > 0)
        or (p_duplicate_status = 'attachment'
          and (record.duplicate ->> 'attachment_duplicate_count')::integer > 0)
        or (p_duplicate_status = 'none'
          and not (record.duplicate ->> 'duplicate_warning')::boolean))
      and (p_search is null or strpos(lower(concat_ws(' ', record.client_code,
        record.client_display_name, record.report_type,
        coalesce(record.result_text, record.result_reason),
        coalesce(record.source_text, record.source_reason),
        record.attachment_source_filename)), lower(p_search)) > 0)
  ), page as materialized (
    select record.* from matching record
    order by record.examined_on desc, record.client_display_name, record.report_key
    limit 200
  ), history_scope as materialized (
    select history.*, page.examined_on as terminal_examined_on
    from public.client_inspection_report_versions history
    join page on page.report_key = history.report_key
      and page.organization_id = history.organization_id
      and page.branch_id = history.branch_id
      and page.client_id = history.client_id
    order by page.examined_on desc, history.report_key, history.version desc
  ), history_page as materialized (
    select history.* from history_scope history
    order by history.terminal_examined_on desc, history.report_key, history.version desc
    limit 500
  ), client_scope as materialized (
    select client.id, client.client_code, client.display_name
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'health.read')
      and private.can_staff_access_client(client.id, 'client_reports.read')
  ), client_page as materialized (
    select client.* from client_scope client
    order by client.display_name, client.id limit 200
  ), type_scope as materialized (
    select min(record.report_type) as report_type, count(*)::bigint as record_count
    from current_records record group by lower(record.report_type)
  ), type_page as materialized (
    select kind.* from type_scope kind order by kind.report_type limit 200
  )
  select p_expected_organization_id, p_expected_branch_id, v_now,
    (v_now at time zone 'Asia/Taipei')::date,
    coalesce((select jsonb_agg(jsonb_build_object(
      'record_version_id', record.id, 'report_key', record.report_key,
      'version', record.version, 'previous_version_id', record.previous_version_id,
      'record_status', record.record_status, 'correction_reason', record.correction_reason,
      'client_id', record.client_id, 'client_code', record.client_code,
      'client_display_name', record.client_display_name,
      'report_type', record.report_type, 'examined_on', record.examined_on,
      'result_status', record.result_status, 'result_text', record.result_text,
      'result_reason', record.result_reason, 'source_status', record.source_status,
      'source_text', record.source_text, 'source_reason', record.source_reason,
      'attachment_status', record.attachment_status, 'attachment_id', record.attachment_id,
      'attachment_sha256', record.attachment_sha256,
      'attachment_source_filename', record.attachment_source_filename,
      'payload_hash', record.payload_hash, 'content_hash', record.content_hash,
      'exact_duplicate_count', (record.duplicate ->> 'exact_duplicate_count')::integer,
      'key_field_duplicate_count', (record.duplicate ->> 'key_field_duplicate_count')::integer,
      'attachment_duplicate_count', (record.duplicate ->> 'attachment_duplicate_count')::integer,
      'duplicate_warning', (record.duplicate ->> 'duplicate_warning')::boolean,
      'duplicate_bases', record.duplicate -> 'duplicate_bases',
      'duplicate_matches', record.duplicate -> 'duplicate_matches',
      'duplicate_matches_truncated',
        (record.duplicate ->> 'duplicate_matches_truncated')::boolean,
      'recorded_by', record.recorded_by,
      'recorded_by_display_name', record.recorded_by_display_name,
      'recorded_at', record.recorded_at
    ) order by record.examined_on desc, record.client_display_name, record.report_key)
      from page record), '[]'::jsonb),
    (select count(*) from matching), (select count(*) from matching) > 200,
    (select count(*) from matching record where record.record_status = 'active'),
    (select count(*) from matching record where record.record_status = 'voided'),
    (select count(*) from matching record where record.result_status = 'missing'),
    (select count(*) from matching record where record.attachment_status = 'missing'),
    (select count(*) from matching record
      where (record.duplicate ->> 'duplicate_warning')::boolean),
    coalesce((select jsonb_agg(jsonb_build_object(
      'record_version_id', history.id, 'report_key', history.report_key,
      'version', history.version, 'previous_version_id', history.previous_version_id,
      'record_status', history.record_status, 'correction_reason', history.correction_reason,
      'report_type', history.report_type, 'examined_on', history.examined_on,
      'result_status', history.result_status, 'result_text', history.result_text,
      'result_reason', history.result_reason, 'source_status', history.source_status,
      'source_text', history.source_text, 'source_reason', history.source_reason,
      'attachment_status', history.attachment_status, 'attachment_id', history.attachment_id,
      'attachment_sha256', history.attachment_sha256,
      'attachment_source_filename', history.attachment_source_filename,
      'payload_hash', history.payload_hash, 'content_hash', history.content_hash,
      'recorded_by_display_name', history.recorded_by_display_name,
      'recorded_at', history.recorded_at
    ) order by history.terminal_examined_on desc, history.report_key, history.version desc)
      from history_page history), '[]'::jsonb),
    (select count(*) from history_scope), (select count(*) from history_scope) > 500,
    coalesce((select jsonb_agg(jsonb_build_object('client_id', client.id,
      'client_code', client.client_code, 'display_name', client.display_name)
      order by client.display_name, client.id) from client_page client), '[]'::jsonb),
    (select count(*) from client_scope), (select count(*) from client_scope) > 200,
    coalesce((select jsonb_agg(jsonb_build_object('report_type', kind.report_type,
      'record_count', kind.record_count) order by kind.report_type)
      from type_page kind), '[]'::jsonb),
    (select count(*) from type_scope), (select count(*) from type_scope) > 200,
    'configured'::text, 'warning_only_no_auto_merge'::text,
    'manual_unstandardized'::text, 'not_configured'::text,
    'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 15;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'client_inspection_report_versions', 'snapshot', array[]::text[],
    jsonb_build_object('workflow', 'page22_client_inspection_report_snapshot_v1',
      'client_filter_applied', p_client_id is not null,
      'type_filter_applied', p_report_type is not null,
      'date_filter_applied', p_examined_from is not null or p_examined_to is not null,
      'record_status_filter', p_record_status,
      'result_status_filter', p_result_status,
      'source_status_filter', p_source_status,
      'attachment_status_filter', p_attachment_status,
      'duplicate_status_filter', p_duplicate_status,
      'search_applied', p_search is not null,
      'result_logged', false, 'search_keyword_logged', false)
  );
  if not private.client_report_current_authority(p_expected_organization_id,
      p_expected_branch_id, 'client_reports.read') then
    raise exception using errcode = '42501', message = 'client inspection report snapshot authority expired';
  end if;
end;
$$;

create or replace function public.client_inspection_report_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_report_type text default null,
  p_examined_from date default null, p_examined_to date default null,
  p_record_status text default 'all', p_result_status text default 'all',
  p_source_status text default 'all', p_attachment_status text default 'all',
  p_duplicate_status text default 'all', p_search text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, active_total bigint, voided_total bigint,
  missing_result_total bigint, missing_attachment_total bigint,
  duplicate_warning_total bigint, history jsonb, history_total bigint,
  history_truncated boolean, client_options jsonb, client_total bigint,
  clients_truncated boolean, type_options jsonb, type_total bigint,
  types_truncated boolean, duplicate_rule_status text,
  duplicate_resolution text, report_type_taxonomy_status text,
  medical_interpretation_status text, diagnosis_status text, ocr_status text,
  attachment_pipeline_status text, attachment_scan_status text,
  attachment_download_status text, export_status text, offline_status text,
  recent_aal2_max_age_minutes integer
) language sql volatile security invoker set search_path = '' as $$
  select * from private.client_inspection_report_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id, p_report_type,
    p_examined_from, p_examined_to, p_record_status, p_result_status,
    p_source_status, p_attachment_status, p_duplicate_status, p_search);
$$;

revoke all on function private.client_inspection_report_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.client_report_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.client_report_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.client_report_attachment_pipeline_enabled(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_client_report_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.client_report_state_valid(text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.append_client_inspection_report_guarded(uuid,uuid,jsonb,uuid)
  from public, anon, service_role;
revoke all on function private.client_inspection_report_duplicate_summary(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.client_inspection_report_snapshot_response(
  uuid,uuid,uuid,text,date,date,text,text,text,text,text,text
) from public, anon, service_role;
revoke all on function public.append_client_inspection_report(uuid,uuid,jsonb,uuid)
  from public, anon, service_role;
revoke all on function public.client_inspection_report_snapshot(
  uuid,uuid,uuid,text,date,date,text,text,text,text,text,text
) from public, anon, service_role;
grant execute on function private.append_client_inspection_report_guarded(uuid,uuid,jsonb,uuid)
  to authenticated;
grant execute on function private.client_inspection_report_snapshot_response(
  uuid,uuid,uuid,text,date,date,text,text,text,text,text,text
) to authenticated;
grant execute on function public.append_client_inspection_report(uuid,uuid,jsonb,uuid)
  to authenticated;
grant execute on function public.client_inspection_report_snapshot(
  uuid,uuid,uuid,text,date,date,text,text,text,text,text,text
) to authenticated;
