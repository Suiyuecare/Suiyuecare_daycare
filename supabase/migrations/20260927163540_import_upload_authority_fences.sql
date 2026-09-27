-- Repair the original upload entry points, including direct RPC callers.
-- No original key, captured proof, immutable source, archive rule or ACL changes.
-- Failed final authority checks roll back the whole reservation/completion audit.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.import_upload_current_authority_fence(
 p_org uuid,p_branch uuid,p_actor uuid,p_session uuid,p_challenge uuid,p_routine boolean
) returns timestamptz language plpgsql volatile security definer set search_path='' as $$
declare verified timestamptz;current_challenge uuid;
begin
 if p_routine is null or p_actor is null or p_session is null or auth.uid() is distinct from p_actor
  or auth.jwt()->>'sub' is distinct from p_actor::text
  or(auth.jwt()->>'session_id')::uuid is distinct from p_session then
  raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';end if;
 if p_routine then
  if p_challenge is not null or not private.has_routine_intake_access(p_org,p_branch,'cms.stage',null) then
   raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';end if;
  return null;
 end if;
 if p_challenge is null then raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';end if;
 -- This existing predicate includes actual session, admission, AMR, current
 -- membership/role/branch and the consumed original challenge. Its FOR SHARE
 -- protects rows, not passage of time: re-evaluate the real factor deadline.
 current_challenge:=private.require_import_upload_authority(p_org,p_branch);
 if current_challenge is distinct from p_challenge then
  raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';end if;
 select c.factor_verified_at into verified from private.reauth_challenges c
 join private.reauth_events e on e.challenge_id=c.id and e.user_id=c.user_id and e.session_id=c.session_id
 where c.id=p_challenge and c.user_id=p_actor and c.session_id=p_session
  and c.consumed_at is not null and c.invalidated_at is null and e.revoked_at is null
  and e.aal='aal2' and e.verification_method in('totp','webauthn','phone')
  and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and c.factor_verified_at<=clock_timestamp() and c.factor_verified_at>=clock_timestamp()-interval '15 minutes';
 if verified is null or verified>clock_timestamp() or verified<clock_timestamp()-interval '15 minutes' then
  raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';end if;
 return verified;
exception when invalid_text_representation then
 raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
end $$;
alter function private.import_upload_current_authority_fence(uuid,uuid,uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function private.import_upload_current_authority_fence(uuid,uuid,uuid,uuid,uuid,boolean)
 from public,anon,authenticated,service_role;

create or replace function private.reserve_import_upload(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_idempotency_key uuid,
  p_file_sha256 text, p_file_name text, p_mime_type text, p_file_size_bytes integer, p_mapping_version text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_challenge uuid;
  v_verified_at timestamptz;
  v_session uuid;
  v_claims jsonb;
  v_reservation private.import_upload_reservations%rowtype;
  v_receipt jsonb;
  v_replayed boolean := false;
begin
  v_challenge := private.require_import_upload_authority(p_expected_organization_id, p_expected_branch_id);
  v_session := (auth.jwt() ->> 'session_id')::uuid;
  v_verified_at:=private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,false);
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
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,false)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
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
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,false)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
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
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,false)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
  -- An ordinary replay is not a replacement of immutable MFA evidence.
  if v_reservation.reauth_challenge_id is distinct from v_challenge then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
  select receipt into v_receipt from private.import_upload_completions where id = v_reservation.id;
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,false)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
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

create or replace function private.reserve_intake_import_upload(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_idempotency_key uuid,
  p_file_sha256 text, p_file_name text, p_mime_type text, p_file_size_bytes integer, p_mapping_version text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_challenge uuid;
  v_verified_at timestamptz;
  v_session uuid;
  v_claims jsonb;
  v_reservation private.import_upload_reservations%rowtype;
  v_receipt jsonb;
  v_replayed boolean := false;
begin
  if not private.has_routine_intake_access(p_expected_organization_id,p_expected_branch_id,'cms.stage',null) then raise exception using errcode='42501',message='INTAKE_GOOGLE_ACTION_DENIED';end if;
  v_challenge := null;
  v_session := (auth.jwt() ->> 'session_id')::uuid;
  v_verified_at:=private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,true);
  if p_idempotency_key is null or p_file_sha256 is null or p_file_sha256 !~ '^[a-f0-9]{64}$'
    or p_file_name is null or char_length(p_file_name) not between 1 and 255
    or p_file_name ~ '[[:cntrl:]/\\]' or p_file_name !~* '\.html?$'
    or p_mime_type is null or p_mime_type not in ('text/html', 'application/xhtml+xml')
    or p_file_size_bytes is null or p_file_size_bytes not between 1 and 4194304
    or p_mapping_version is distinct from 'central-care-plan-html@1' then
    raise exception using errcode = '22023', message = 'IMPORT_STAGING_INVALID_INPUT';
  end if;

  -- Actor/key first, then content: every reservation uses this lock order.
  perform pg_advisory_xact_lock(hashtextextended('import-upload-key:' || v_actor || ':' || p_idempotency_key, 0));
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,true)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
  select * into v_reservation from private.import_upload_reservations
    where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_reservation.auth_context->>'policyVersion' is distinct from 'approved-google-intake@1' or v_reservation.organization_id <> p_expected_organization_id or v_reservation.branch_id <> p_expected_branch_id
      or v_reservation.session_id <> v_session or v_reservation.file_sha256 <> p_file_sha256
      or v_reservation.file_name <> p_file_name or v_reservation.mime_type <> p_mime_type
      or v_reservation.file_size_bytes <> p_file_size_bytes or v_reservation.mapping_version <> p_mapping_version then
      raise exception using errcode = '22023', message = 'IMPORT_STAGING_IDEMPOTENCY_CONFLICT';
    end if;
    v_replayed := true;
  else
    perform pg_advisory_xact_lock(hashtextextended('import-upload-content:' || p_expected_organization_id || ':' || p_expected_branch_id || ':' || p_file_sha256 || ':' || p_mapping_version, 0));
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,true)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
    if exists (select 1 from private.import_upload_reservations where organization_id = p_expected_organization_id
      and branch_id = p_expected_branch_id and file_sha256 = p_file_sha256 and mapping_version = p_mapping_version) then
      raise exception using errcode = '23505', message = 'IMPORT_CONTENT_ALREADY_RESERVED';
    end if;
    -- Save only database-validated claims, never token text or editable metadata.
    select jsonb_object_agg(key, value) into v_claims from jsonb_each(auth.jwt())
      where key in ('sub', 'session_id', 'role', 'aud', 'aal', 'is_anonymous', 'iat', 'exp', 'email', 'amr');
    insert into private.import_upload_reservations (
      organization_id, branch_id, actor_user_id, session_id, reauth_challenge_id, idempotency_key,
      file_sha256, file_name, mime_type, file_size_bytes, mapping_version, authorization_claims, auth_context
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_actor, v_session, v_challenge, p_idempotency_key,
      p_file_sha256, p_file_name, p_mime_type, p_file_size_bytes, p_mapping_version, v_claims, private.routine_intake_auth_evidence(p_expected_organization_id,p_expected_branch_id,'cms.stage',null)
    ) returning * into v_reservation;
  end if;
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,true)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
  select receipt into v_receipt from private.import_upload_completions where id = v_reservation.id;
  if private.import_upload_current_authority_fence(p_expected_organization_id,p_expected_branch_id,v_actor,v_session,v_challenge,true)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
  end if;
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

create or replace function private.complete_import_upload(
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
  v_verified_at timestamptz;
  v_is_routine boolean;
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
    or (case when v_reservation.auth_context->>'policyVersion'='approved-google-intake@1' then
      not private.has_routine_intake_access(v_reservation.organization_id,v_reservation.branch_id,'cms.stage',null)
    else private.require_import_upload_authority(v_reservation.organization_id, v_reservation.branch_id)
      is distinct from v_reservation.reauth_challenge_id end) then
    raise exception using errcode = '42501', message = 'IMPORT_STAGING_ACCESS_DENIED';
  end if;

  v_is_routine:=coalesce(v_reservation.auth_context->>'policyVersion'='approved-google-intake@1',false);
  v_verified_at:=private.import_upload_current_authority_fence(v_reservation.organization_id,v_reservation.branch_id,
    v_reservation.actor_user_id,v_reservation.session_id,v_reservation.reauth_challenge_id,v_is_routine);

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
  -- Completion insert and its audit trigger can both block. Check real current
  -- authority before exposing either a new result or an exact historical replay.
  if private.import_upload_current_authority_fence(v_reservation.organization_id,v_reservation.branch_id,
      v_reservation.actor_user_id,v_reservation.session_id,v_reservation.reauth_challenge_id,v_is_routine)
      is distinct from v_verified_at then
    raise exception using errcode='42501',message='IMPORT_STAGING_ACCESS_DENIED';
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

-- CREATE OR REPLACE preserves each original OID/owner/ACL. Do not rename the
-- prior implementation or grant callers a second bypass entry point.
commit;
