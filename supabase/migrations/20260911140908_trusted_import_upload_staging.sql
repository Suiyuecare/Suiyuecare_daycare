-- Trusted upload staging, deliberately separate from legacy public.import_*.
-- An authenticated caller may reserve metadata, never supply parser or archive
-- evidence. Only the server worker may attest a reserved parse/archive result.
-- No client, care-plan, signature, or legacy import table is written here.
-- Pending reservations are immutable. Expired/revoked authorization requires
-- reconciliation; this bounded slice does not silently rebind a new session.

create table private.import_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null, -- No FK: deleting an Auth session must remain possible.
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  file_name text not null check (char_length(file_name) between 1 and 255
    and file_name !~ '[[:cntrl:]/\\]' and file_name ~* '\.html?$'),
  mime_type text not null check (mime_type in ('text/html', 'application/xhtml+xml')),
  file_size_bytes integer not null check (file_size_bytes between 1 and 26214400),
  mapping_version text not null check (mapping_version = 'central-care-plan-html@1'),
  authorization_claims jsonb not null check (jsonb_typeof(authorization_claims) = 'object'),
  created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  constraint import_upload_reservation_scope foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint import_upload_reservation_actor_key unique (actor_user_id, idempotency_key),
  constraint import_upload_reservation_content_key unique (organization_id, branch_id, file_sha256, mapping_version),
  constraint import_upload_reservation_id_scope unique (id, organization_id, branch_id)
);
create index import_upload_reservation_branch_idx
  on private.import_upload_reservations (branch_id, organization_id);
create index import_upload_reservation_challenge_idx
  on private.import_upload_reservations (reauth_challenge_id);
create index import_upload_reservation_session_idx
  on private.import_upload_reservations (session_id, actor_user_id);

create table private.import_upload_completions (
  id uuid primary key,
  organization_id uuid not null,
  branch_id uuid not null,
  parsed_payload jsonb not null check (jsonb_typeof(parsed_payload) = 'object'
    and octet_length(parsed_payload::text) <= 16777216),
  archive_reference jsonb not null check (jsonb_typeof(archive_reference) = 'object'
    and octet_length(archive_reference::text) <= 8192),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  completed_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  constraint import_upload_completion_scope foreign key (id, organization_id, branch_id)
    references private.import_upload_reservations(id, organization_id, branch_id) on delete restrict
);
create index import_upload_completion_scope_idx
  on private.import_upload_completions (organization_id, branch_id);

alter table private.import_upload_reservations enable row level security;
alter table private.import_upload_reservations force row level security;
alter table private.import_upload_completions enable row level security;
alter table private.import_upload_completions force row level security;
revoke all on private.import_upload_reservations, private.import_upload_completions
  from public, anon, authenticated, service_role;

create function private.prevent_import_upload_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'IMPORT_STAGING_IMMUTABLE';
end;
$$;
create trigger import_upload_reservation_immutable before update or delete
  on private.import_upload_reservations for each row execute function private.prevent_import_upload_mutation();
create trigger import_upload_completion_immutable before update or delete
  on private.import_upload_completions for each row execute function private.prevent_import_upload_mutation();
create trigger import_upload_reservation_audit after insert
  on private.import_upload_reservations for each row execute function private.audit_row_change();
create trigger import_upload_completion_audit after insert
  on private.import_upload_completions for each row execute function private.audit_row_change();

-- Additional current-scope check supplements the existing executive, AAL2 and
-- permission helpers; future assignments or inactive branches never authorize.
create function private.require_import_upload_authority(p_organization_id uuid, p_branch_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not private.has_permission(p_organization_id, p_branch_id, 'imports.manage')
    or not exists (
      select 1 from public.organizations o join public.branches b on b.organization_id = o.id
      where o.id = p_organization_id and b.id = p_branch_id and o.is_active and b.is_active
    ) or not exists (
      select 1 from public.memberships m
      join public.membership_roles mr on mr.membership_id = m.id
      join public.roles r on r.id = mr.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions p on p.id = rp.permission_id
      where m.profile_id = auth.uid() and m.organization_id = p_organization_id
        and (m.branch_id is null or m.branch_id = p_branch_id)
        and m.status = 'active' and m.starts_at <= v_now and (m.ends_at is null or m.ends_at > v_now)
        and (r.organization_id is null or r.organization_id = p_organization_id)
        and mr.assigned_at <= v_now and rp.granted_at <= v_now and p.permission_key = 'imports.manage'
    ) then
    raise exception using errcode = '42501', message = 'IMPORT_STAGING_ACCESS_DENIED';
  end if;
  return private.current_client_master_reauth_challenge();
end;
$$;

create function private.reserve_import_upload(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_idempotency_key uuid,
  p_file_sha256 text, p_file_name text, p_mime_type text, p_file_size_bytes integer, p_mapping_version text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_challenge uuid;
  v_session uuid;
  v_claims jsonb;
  v_reservation private.import_upload_reservations%rowtype;
  v_receipt jsonb;
  v_replayed boolean := false;
begin
  v_challenge := private.require_import_upload_authority(p_expected_organization_id, p_expected_branch_id);
  v_session := (auth.jwt() ->> 'session_id')::uuid;
  if p_idempotency_key is null or p_file_sha256 is null or p_file_sha256 !~ '^[a-f0-9]{64}$'
    or p_file_name is null or char_length(p_file_name) not between 1 and 255
    or p_file_name ~ '[[:cntrl:]/\\]' or p_file_name !~* '\.html?$'
    or p_mime_type is null or p_mime_type not in ('text/html', 'application/xhtml+xml')
    or p_file_size_bytes is null or p_file_size_bytes not between 1 and 26214400
    or p_mapping_version is distinct from 'central-care-plan-html@1' then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end if;

  -- Actor/key first, then content: every reservation uses this lock order.
  perform pg_advisory_xact_lock(hashtextextended('import-upload-key:' || v_actor || ':' || p_idempotency_key, 0));
  select * into v_reservation from private.import_upload_reservations
    where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_reservation.organization_id <> p_expected_organization_id or v_reservation.branch_id <> p_expected_branch_id
      or v_reservation.session_id <> v_session or v_reservation.file_sha256 <> p_file_sha256
      or v_reservation.file_name <> p_file_name or v_reservation.mime_type <> p_mime_type
      or v_reservation.file_size_bytes <> p_file_size_bytes or v_reservation.mapping_version <> p_mapping_version then
      raise exception using errcode = '22023', message = 'IMPORT_STAGING_IDEMPOTENCY_CONFLICT';
    end if;
    v_replayed := true;
  else
    perform pg_advisory_xact_lock(hashtextextended('import-upload-content:' || p_expected_organization_id || ':' || p_expected_branch_id || ':' || p_file_sha256 || ':' || p_mapping_version, 0));
    if exists (select 1 from private.import_upload_reservations where organization_id = p_expected_organization_id
      and branch_id = p_expected_branch_id and file_sha256 = p_file_sha256 and mapping_version = p_mapping_version) then
      raise exception using errcode = '23505', message = 'IMPORT_CONTENT_ALREADY_RESERVED';
    end if;
    -- Save only database-validated claims, never token text or editable metadata.
    select jsonb_object_agg(key, value) into v_claims from jsonb_each(auth.jwt())
      where key in ('sub', 'session_id', 'role', 'aud', 'aal', 'is_anonymous', 'iat', 'exp', 'email', 'amr');
    insert into private.import_upload_reservations (
      organization_id, branch_id, actor_user_id, session_id, reauth_challenge_id, idempotency_key,
      file_sha256, file_name, mime_type, file_size_bytes, mapping_version, authorization_claims
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_actor, v_session, v_challenge, p_idempotency_key,
      p_file_sha256, p_file_name, p_mime_type, p_file_size_bytes, p_mapping_version, v_claims
    ) returning * into v_reservation;
  end if;
  select receipt into v_receipt from private.import_upload_completions where id = v_reservation.id;
  return jsonb_build_object(
    'reservation_id', v_reservation.id, 'organization_id', v_reservation.organization_id,
    'branch_id', v_reservation.branch_id, 'actor_user_id', v_reservation.actor_user_id,
    'file_sha256', v_reservation.file_sha256, 'file_name', v_reservation.file_name,
    'mime_type', v_reservation.mime_type, 'file_size_bytes', v_reservation.file_size_bytes,
    'mapping_version', v_reservation.mapping_version, 'created_at', v_reservation.created_at,
    'status', case when v_receipt is null then 'queued' else 'completed' end,
    'receipt', case when v_receipt is null then null else v_receipt || jsonb_build_object('replayed', true) end,
    'replayed', v_replayed
  );
end;
$$;

create function private.complete_import_upload(
  p_reservation_id uuid, p_parsed_payload text, p_archive_reference jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reservation private.import_upload_reservations%rowtype;
  v_existing private.import_upload_completions%rowtype;
  v_claims text := current_setting('request.jwt.claims', true);
  v_legacy_sub text := current_setting('request.jwt.claim.sub', true);
  v_legacy_role text := current_setting('request.jwt.claim.role', true);
  v_hash text;
  v_receipt jsonb;
  v_completed_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_key text;
  v_archive_created_at timestamptz;
  v_retain_until timestamptz;
  v_parsed_payload jsonb;
begin
  select * into v_reservation from private.import_upload_reservations where id = p_reservation_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'IMPORT_STAGING_ACCESS_DENIED';
  end if;
  -- The worker supplies no user identity or permissions. Use only the immutable
  -- reservation, and rerun live Auth/session, executive, role and AAL2 checks.
  -- Restore all legacy GUCs too: hosted auth.uid() can prioritize claim.sub.
  perform set_config('request.jwt.claims', v_reservation.authorization_claims::text, true);
  perform set_config('request.jwt.claim.sub', v_reservation.actor_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  if auth.uid() is distinct from v_reservation.actor_user_id
    or private.require_import_upload_authority(v_reservation.organization_id, v_reservation.branch_id)
      is distinct from v_reservation.reauth_challenge_id then
    raise exception using errcode = '42501', message = 'IMPORT_STAGING_ACCESS_DENIED';
  end if;

  if p_parsed_payload is null or octet_length(p_parsed_payload) > 16777216 then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end if;
  begin
    v_parsed_payload := p_parsed_payload::jsonb;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end;
  if jsonb_typeof(v_parsed_payload) is distinct from 'object'
    or octet_length(v_parsed_payload::text) > 16777216
    or p_archive_reference is null or jsonb_typeof(p_archive_reference) <> 'object'
    or octet_length(p_archive_reference::text) > 8192 then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end if;
  if v_parsed_payload ->> 'mappingVersion' is distinct from v_reservation.mapping_version
    or coalesce(v_parsed_payload ->> 'contentFingerprint', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(v_parsed_payload -> 'sections') is distinct from 'array'
    or jsonb_typeof(v_parsed_payload -> 'fields') is distinct from 'array'
    or jsonb_typeof(v_parsed_payload -> 'warnings') is distinct from 'array'
    or jsonb_typeof(v_parsed_payload -> 'conflicts') is distinct from 'array'
    or jsonb_typeof(v_parsed_payload -> 'security') is distinct from 'object'
    or v_parsed_payload -> 'security' ->> 'parser' is distinct from 'cheerio-static'
    or v_parsed_payload -> 'security' -> 'externalRequestCount' is distinct from '0'::jsonb then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end if;
  if jsonb_array_length(v_parsed_payload -> 'sections') > 500
    or jsonb_array_length(v_parsed_payload -> 'fields') > 50000
    or jsonb_array_length(v_parsed_payload -> 'warnings') > 100000
    or jsonb_array_length(v_parsed_payload -> 'conflicts') > 50000 then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end if;
  v_key := 'organizations/' || v_reservation.organization_id || '/branches/' || v_reservation.branch_id
    || '/central-html/' || v_reservation.file_sha256 || '/' || v_reservation.id || '.html';
  if p_archive_reference ->> 'key' is distinct from v_key
    or p_archive_reference ->> 'sha256' is distinct from v_reservation.file_sha256
    or p_archive_reference -> 'byteLength' is distinct from to_jsonb(v_reservation.file_size_bytes)
    or jsonb_typeof(p_archive_reference -> 'versionId') is distinct from 'string'
    or char_length(p_archive_reference ->> 'versionId') not between 1 and 1024
    or p_archive_reference ->> 'versionId' = 'null'
    or p_archive_reference ->> 'versionId' ~ '[[:space:][:cntrl:]]'
    or jsonb_typeof(p_archive_reference -> 'createdAt') is distinct from 'string'
    or jsonb_typeof(p_archive_reference -> 'retainUntil') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_ARCHIVE';
  end if;
  begin
    v_archive_created_at := (p_archive_reference ->> 'createdAt')::timestamptz;
    v_retain_until := (p_archive_reference ->> 'retainUntil')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_ARCHIVE';
  end;
  if not isfinite(v_archive_created_at) or not isfinite(v_retain_until)
    or v_archive_created_at <> v_reservation.created_at
    or v_retain_until < ((v_reservation.created_at at time zone 'UTC') + interval '7 years') at time zone 'UTC' then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_ARCHIVE';
  end if;

  v_hash := encode(sha256(convert_to(p_parsed_payload, 'UTF8')), 'hex');
  select * into v_existing from private.import_upload_completions where id = v_reservation.id;
  if found then
    if v_existing.payload_sha256 <> v_hash or v_existing.parsed_payload is distinct from v_parsed_payload
      or v_existing.archive_reference is distinct from p_archive_reference then
      raise exception using errcode = '22023', message = 'IMPORT_STAGING_IDEMPOTENCY_CONFLICT';
    end if;
    v_receipt := v_existing.receipt || jsonb_build_object('replayed', true);
  else
    v_receipt := jsonb_build_object(
      'reservation_id', v_reservation.id, 'status', 'completed', 'staging_only', true, 'formally_imported', false,
      'file_sha256', v_reservation.file_sha256, 'content_fingerprint', v_parsed_payload ->> 'contentFingerprint',
      'mapping_version', v_reservation.mapping_version, 'payload_sha256', v_hash,
      'section_count', jsonb_array_length(v_parsed_payload -> 'sections'),
      'field_count', jsonb_array_length(v_parsed_payload -> 'fields'), 'completed_at', v_completed_at
    );
    insert into private.import_upload_completions (
      id, organization_id, branch_id, parsed_payload, archive_reference, payload_sha256, receipt, completed_at
    ) values (
      v_reservation.id, v_reservation.organization_id, v_reservation.branch_id,
      v_parsed_payload, p_archive_reference, v_hash, v_receipt, v_completed_at
    );
    v_receipt := v_receipt || jsonb_build_object('replayed', false);
  end if;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_legacy_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_legacy_role, ''), true);
  return v_receipt;
exception when others then
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_legacy_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_legacy_role, ''), true);
  raise;
end;
$$;

create function public.reserve_import_upload(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_idempotency_key uuid,
  p_file_sha256 text, p_file_name text, p_mime_type text, p_file_size_bytes integer, p_mapping_version text
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.reserve_import_upload(p_expected_organization_id, p_expected_branch_id, p_idempotency_key,
    p_file_sha256, p_file_name, p_mime_type, p_file_size_bytes, p_mapping_version);
$$;
create function public.complete_import_upload(p_reservation_id uuid, p_parsed_payload text, p_archive_reference jsonb)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.complete_import_upload(p_reservation_id, p_parsed_payload, p_archive_reference);
$$;

alter function private.require_import_upload_authority(uuid,uuid) owner to postgres;
alter function private.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text) owner to postgres;
alter function private.complete_import_upload(uuid,text,jsonb) owner to postgres;
revoke all on function private.prevent_import_upload_mutation(), private.require_import_upload_authority(uuid,uuid),
  private.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text),
  private.complete_import_upload(uuid,text,jsonb),
  public.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text),
  public.complete_import_upload(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text),
  public.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text) to authenticated;
grant execute on function private.complete_import_upload(uuid,text,jsonb),
  public.complete_import_upload(uuid,text,jsonb) to service_role;

comment on table private.import_upload_reservations is
  'Immutable user-authorized queued uploads; a reservation is not archive evidence or a formal client import.';
comment on table private.import_upload_completions is
  'Immutable trusted-server staging only. Archive metadata requires real WORM verification by the server; SQL is not an S3 verifier.';
comment on function public.complete_import_upload(uuid,text,jsonb) is
  'Server-only completion, bound to a live revalidated reservation. Never promotes client or care-plan data.';
