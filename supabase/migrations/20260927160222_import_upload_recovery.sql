-- Explicit same-actor continuation, not rekeying or replacing immutable uploads.
-- Recovery authorizes staging only. No client, plan, qualification or signature
-- is created, and no original Auth evidence or Object Lock retention is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table private.import_upload_recoveries(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null, branch_id uuid not null,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 reservation_id uuid not null, original_operation_id uuid not null,
 recovery_operation_id uuid not null, mode text not null check(mode in('routine-intake','general')),
 session_id uuid not null, reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
 authorization_claims jsonb not null check(jsonb_typeof(authorization_claims)='object'),
 verified_at timestamptz, created_at timestamptz not null default date_trunc('milliseconds',clock_timestamp()),
 expires_at timestamptz not null, request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 constraint import_upload_recovery_scope foreign key(reservation_id,organization_id,branch_id)
  references private.import_upload_reservations(id,organization_id,branch_id) on delete restrict,
 constraint import_upload_recovery_key unique(actor_user_id,recovery_operation_id),
 constraint import_upload_recovery_id_scope unique(id,organization_id,branch_id),
 check(original_operation_id<>recovery_operation_id),
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check((mode='routine-intake' and reauth_challenge_id is null and verified_at is null)
  or(mode='general' and reauth_challenge_id is not null and verified_at is not null and verified_at<=created_at
   and expires_at<=verified_at+interval '15 minutes'))
);
create index import_upload_recovery_reservation_idx on private.import_upload_recoveries(reservation_id,organization_id,branch_id);
create index import_upload_recovery_challenge_idx on private.import_upload_recoveries(reauth_challenge_id);
-- The scoped key is needed before the new composite foreign key is declared.
alter table private.import_upload_completions add constraint import_upload_completion_id_scope unique(id,organization_id,branch_id);
create table private.import_upload_recovery_completions(
 id uuid primary key, organization_id uuid not null,branch_id uuid not null,reservation_id uuid not null,
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 completed_at timestamptz not null default date_trunc('milliseconds',clock_timestamp()),
 constraint import_upload_recovery_completion_attempt foreign key(id,organization_id,branch_id)
  references private.import_upload_recoveries(id,organization_id,branch_id) on delete restrict,
 constraint import_upload_recovery_completion_original foreign key(reservation_id,organization_id,branch_id)
  references private.import_upload_completions(id,organization_id,branch_id) on delete restrict
);
create index import_upload_recovery_completion_original_idx on private.import_upload_recovery_completions(reservation_id,organization_id,branch_id);
create index import_upload_recovery_completion_attempt_idx on private.import_upload_recovery_completions(id,organization_id,branch_id);
alter table private.import_upload_recoveries enable row level security;
alter table private.import_upload_recoveries force row level security;
alter table private.import_upload_recovery_completions enable row level security;
alter table private.import_upload_recovery_completions force row level security;
revoke all on private.import_upload_recoveries,private.import_upload_recovery_completions from public,anon,authenticated,service_role;
create trigger import_upload_recovery_immutable before update or delete on private.import_upload_recoveries
 for each row execute function private.prevent_import_upload_mutation();
create trigger import_upload_recovery_completion_immutable before update or delete on private.import_upload_recovery_completions
 for each row execute function private.prevent_import_upload_mutation();
create trigger import_upload_recovery_audit after insert on private.import_upload_recoveries
 for each row execute function private.audit_row_change();
create trigger import_upload_recovery_completion_audit after insert on private.import_upload_recovery_completions
 for each row execute function private.audit_row_change();

create function private.import_upload_recovery_authority(p_org uuid,p_branch uuid,p_mode text,p_write boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();challenge uuid;verified timestamptz;evidence jsonb;
begin
 if p_mode is null or p_mode not in('routine-intake','general') then
  raise exception using errcode='22023',message='IMPORT_RECOVERY_INVALID_INPUT';end if;
 if p_mode='routine-intake' then
  if not private.has_routine_intake_access(p_org,p_branch,case when p_write then 'cms.stage' else 'cms.preview' end,null) then
   raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
 else
  actor:=private.general_import_repository_authority(p_org,p_branch,false);
  if p_write then
   evidence:=private.general_import_recent_aal2_evidence(p_org,p_branch);
   verified:=(evidence->>'verifiedAt')::timestamptz;
   challenge:=private.require_import_upload_authority(p_org,p_branch);
  end if;
 end if;
 if actor is null or(auth.jwt()->>'session_id') is null then
  raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
 return jsonb_build_object('actor',actor,'session',(auth.jwt()->>'session_id')::uuid,'challenge',challenge,'verified',verified);
end $$;




create function private.import_upload_recovery_request_hash(r private.import_upload_reservations,p_mode text,p_operation uuid)
returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('organizationId',r.organization_id,'branchId',r.branch_id,
  'actorUserId',r.actor_user_id,'reservationId',r.id,'originalOperationId',r.idempotency_key,'recoveryOperationId',p_operation,
  'mode',p_mode,'fileSha256',r.file_sha256,'fileName',r.file_name,'mimeType',r.mime_type,
  'fileSizeBytes',r.file_size_bytes,'mappingVersion',r.mapping_version)::text,'UTF8')),'hex');
$$;

create function private.import_upload_recovery_integrity(a private.import_upload_recoveries)
returns private.import_upload_reservations language plpgsql volatile security definer set search_path='' as $$
declare r private.import_upload_reservations%rowtype;c private.import_upload_completions%rowtype;t private.import_upload_recovery_completions%rowtype;
 stored private.import_upload_recoveries%rowtype;
begin
 select * into stored from private.import_upload_recoveries where id=a.id;
 if not found or stored is distinct from a then
  raise exception using errcode='40001',message='IMPORT_RECOVERY_SOURCE_CHANGED';end if;
 select * into r from private.import_upload_reservations where id=a.reservation_id;
 if not found or r.organization_id<>a.organization_id or r.branch_id<>a.branch_id or r.actor_user_id<>a.actor_user_id
  or r.idempotency_key<>a.original_operation_id
  or(a.mode='routine-intake') is distinct from coalesce(r.auth_context->>'policyVersion'='approved-google-intake@1',false)
  or(a.mode='general' and r.reauth_challenge_id is null)
  or a.request_hash<>private.import_upload_recovery_request_hash(r,a.mode,a.recovery_operation_id)
  or a.authorization_claims->>'sub' is distinct from a.actor_user_id::text
  or a.authorization_claims->>'session_id' is distinct from a.session_id::text then
  raise exception using errcode='23514',message='IMPORT_RECOVERY_SOURCE_INVALID';end if;
 select * into c from private.import_upload_completions where id=r.id;
 if found and(c.organization_id<>r.organization_id or c.branch_id<>r.branch_id
  or c.receipt->>'reservation_id' is distinct from r.id::text
  or c.receipt->>'file_sha256' is distinct from r.file_sha256
  or c.receipt->>'mapping_version' is distinct from r.mapping_version
  or c.receipt->>'payload_sha256' is distinct from c.payload_sha256
  or c.receipt->>'status' is distinct from 'completed' or c.receipt->'staging_only' is distinct from 'true'::jsonb
  or c.receipt->'formally_imported' is distinct from 'false'::jsonb
  or c.receipt->>'content_fingerprint' is distinct from c.parsed_payload->>'contentFingerprint'
  or c.receipt->'section_count' is distinct from to_jsonb(jsonb_array_length(c.parsed_payload->'sections'))
  or c.receipt->'field_count' is distinct from to_jsonb(jsonb_array_length(c.parsed_payload->'fields'))
  or(c.receipt->>'completed_at')::timestamptz is distinct from c.completed_at
  or c.archive_reference->>'key' is distinct from('organizations/'||r.organization_id||'/branches/'||r.branch_id||'/central-html/'||r.file_sha256||'/'||r.id||'.html')
  or c.archive_reference->>'sha256' is distinct from r.file_sha256
  or c.archive_reference->'byteLength' is distinct from to_jsonb(r.file_size_bytes)
  or(c.archive_reference->>'createdAt')::timestamptz is distinct from r.created_at
  or(c.archive_reference->>'retainUntil')::timestamptz<(((r.created_at at time zone 'UTC')+interval '7 years') at time zone 'UTC')
  or coalesce(c.archive_reference->>'versionId','') in('','null')
  or c.archive_reference->>'versionId'~'[[:space:][:cntrl:]]') then
  raise exception using errcode='23514',message='IMPORT_RECOVERY_SOURCE_INVALID';end if;
 select * into t from private.import_upload_recovery_completions where id=a.id;
 if found and(t.organization_id<>a.organization_id or t.branch_id<>a.branch_id or t.reservation_id<>r.id
  or c.id is null or t.receipt is distinct from c.receipt) then
  raise exception using errcode='23514',message='IMPORT_RECOVERY_SOURCE_INVALID';end if;
 return r;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
 raise exception using errcode='23514',message='IMPORT_RECOVERY_SOURCE_INVALID';
end $$;

create function private.import_upload_recovery_envelope(a private.import_upload_recoveries,p_replayed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r private.import_upload_reservations%rowtype;receipt jsonb;
begin
 r:=private.import_upload_recovery_integrity(a);
 select c.receipt||jsonb_build_object('replayed',false) into receipt from private.import_upload_completions c where c.id=r.id;
 return jsonb_build_object('schema_version',1,'recovery_id',a.id,'recovery_operation_id',a.recovery_operation_id,
  'original_operation_id',a.original_operation_id,'reservation_id',r.id,'organization_id',a.organization_id,
  'branch_id',a.branch_id,'actor_user_id',a.actor_user_id,'mode',a.mode,'file_sha256',r.file_sha256,
  'file_name',r.file_name,'mime_type',r.mime_type,'file_size_bytes',r.file_size_bytes,'mapping_version',r.mapping_version,
  'created_at',r.created_at,'recovery_created_at',a.created_at,'expires_at',a.expires_at,
  'status',case when receipt is null then 'queued' else 'completed' end,'receipt',receipt,
  'replayed',p_replayed,'staging_only',true,'formally_imported',false);
end $$;

create function private.import_upload_recovery_current(a private.import_upload_recoveries)
returns void language plpgsql volatile security definer set search_path='' as $$
declare evidence jsonb;
begin
 evidence:=private.import_upload_recovery_authority(a.organization_id,a.branch_id,a.mode,true);
 if evidence->>'actor' is distinct from a.actor_user_id::text or evidence->>'session' is distinct from a.session_id::text
  or(evidence->>'challenge')::uuid is distinct from a.reauth_challenge_id
  or(evidence->>'verified')::timestamptz is distinct from a.verified_at or a.expires_at<=clock_timestamp()
  or a.created_at>clock_timestamp() then raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
 perform private.import_upload_recovery_integrity(a);
end $$;

create function private.reserve_import_upload_recovery(p_org uuid,p_branch uuid,p_reservation uuid,p_original_operation uuid,
 p_recovery_operation uuid,p_file_sha256 text,p_file_name text,p_mime_type text,p_file_size_bytes integer,p_mapping_version text,p_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();evidence jsonb;r private.import_upload_reservations%rowtype;a private.import_upload_recoveries%rowtype;
 replayed boolean:=false;claims jsonb;created timestamptz;expiry timestamptz;result jsonb;
begin
 evidence:=private.import_upload_recovery_authority(p_org,p_branch,p_mode,true);
 if p_reservation is null or p_original_operation is null or p_recovery_operation is null or p_original_operation=p_recovery_operation then
  raise exception using errcode='22023',message='IMPORT_RECOVERY_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('import-recovery-key:'||actor||':'||p_recovery_operation,0));
 perform pg_advisory_xact_lock(hashtextextended('import-upload-key:'||actor||':'||p_original_operation,0));
 select * into r from private.import_upload_reservations where id=p_reservation for update;
 if not found or r.actor_user_id<>actor or r.organization_id<>p_org or r.branch_id<>p_branch or r.idempotency_key<>p_original_operation then
  raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
 if r.file_sha256 is distinct from p_file_sha256 or r.file_name is distinct from p_file_name or r.mime_type is distinct from p_mime_type
  or r.file_size_bytes is distinct from p_file_size_bytes or r.mapping_version is distinct from p_mapping_version
  or(p_mode='routine-intake') is distinct from coalesce(r.auth_context->>'policyVersion'='approved-google-intake@1',false)
  or(p_mode='general' and r.reauth_challenge_id is null) or(p_mode='routine-intake' and r.file_size_bytes>4194304) then
  raise exception using errcode='22023',message='IMPORT_RECOVERY_IDEMPOTENCY_CONFLICT';end if;
 if exists(select 1 from private.import_upload_reservations where actor_user_id=actor and idempotency_key=p_recovery_operation) then
  raise exception using errcode='23505',message='IMPORT_RECOVERY_KEY_CONFLICT';end if;
 select * into a from private.import_upload_recoveries where actor_user_id=actor and recovery_operation_id=p_recovery_operation;
 if found then
  if a.reservation_id<>r.id or a.mode<>p_mode or a.request_hash<>private.import_upload_recovery_request_hash(r,p_mode,p_recovery_operation)
   then raise exception using errcode='23505',message='IMPORT_RECOVERY_KEY_CONFLICT';end if;
  replayed:=true;
 else
  created:=clock_timestamp();
  select jsonb_object_agg(key,value) into claims from jsonb_each(auth.jwt())
   where key in('sub','session_id','role','aud','aal','is_anonymous','iat','exp','email','amr');
  if jsonb_typeof(claims->'exp') is distinct from 'number' or(claims->>'exp')!~'^[0-9]{1,12}$' then
   raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
  expiry:=least(to_timestamp((claims->>'exp')::bigint),created+interval '15 minutes');
  if p_mode='general' then expiry:=least(expiry,(evidence->>'verified')::timestamptz+interval '15 minutes');end if;
  if expiry<=created then raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
  insert into private.import_upload_recoveries(organization_id,branch_id,actor_user_id,reservation_id,original_operation_id,
   recovery_operation_id,mode,session_id,reauth_challenge_id,authorization_claims,verified_at,created_at,expires_at,request_hash)
  values(p_org,p_branch,actor,r.id,p_original_operation,p_recovery_operation,p_mode,(evidence->>'session')::uuid,
   (evidence->>'challenge')::uuid,claims,(evidence->>'verified')::timestamptz,created,expiry,
   private.import_upload_recovery_request_hash(r,p_mode,p_recovery_operation)) returning * into a;
 end if;
 perform private.import_upload_recovery_current(a);
 result:=private.import_upload_recovery_envelope(a,replayed);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'select','private.import_upload_recoveries',a.id::text,'{}','{"projection":"import_recovery_reserve_v1"}');
 perform private.import_upload_recovery_current(a);
 if result is distinct from private.import_upload_recovery_envelope(a,replayed) then
  raise exception using errcode='40001',message='IMPORT_RECOVERY_SOURCE_CHANGED';end if;
 return result;
end $$;

create function private.import_upload_recovery_receipt(p_org uuid,p_branch uuid,p_recovery_operation uuid,p_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();a private.import_upload_recoveries%rowtype;result jsonb;
begin
 perform private.import_upload_recovery_authority(p_org,p_branch,p_mode,false);
 if p_recovery_operation is null then raise exception using errcode='22023',message='IMPORT_RECOVERY_INVALID_INPUT';end if;
 select * into a from private.import_upload_recoveries where actor_user_id=actor and recovery_operation_id=p_recovery_operation
  and organization_id=p_org and branch_id=p_branch and mode=p_mode;
 if found then result:=private.import_upload_recovery_envelope(a,false);end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'select','private.import_upload_recoveries',null,'{}','{"projection":"import_recovery_receipt_v1"}');
 perform private.import_upload_recovery_authority(p_org,p_branch,p_mode,false);
 if auth.uid() is distinct from actor then raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
 if a.id is not null and result is distinct from private.import_upload_recovery_envelope(a,false) then
  raise exception using errcode='40001',message='IMPORT_RECOVERY_SOURCE_CHANGED';end if;
 return result;
end $$;

create function private.complete_recovered_import_upload(p_recovery uuid,p_parsed_payload text,p_archive_reference jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 a private.import_upload_recoveries%rowtype;
 v_reservation private.import_upload_reservations%rowtype;
 v_existing private.import_upload_completions%rowtype;
 t private.import_upload_recovery_completions%rowtype;
 v_claims text:=current_setting('request.jwt.claims',true);
 v_legacy_sub text:=current_setting('request.jwt.claim.sub',true);
 v_legacy_role text:=current_setting('request.jwt.claim.role',true);
 v_hash text;v_receipt jsonb;v_completed_at timestamptz;v_key text;
 v_archive_created_at timestamptz;v_retain_until timestamptz;v_parsed_payload jsonb;
begin
 select * into a from private.import_upload_recoveries where id=p_recovery;
 if not found then raise exception using errcode='42501',message='IMPORT_RECOVERY_ACCESS_DENIED';end if;
 -- Identity comes exclusively from the immutable, database-authorized attempt.
 perform set_config('request.jwt.claims',a.authorization_claims::text,true);
 perform set_config('request.jwt.claim.sub',a.actor_user_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform private.import_upload_recovery_current(a);
 -- All continuations lock recovery key, original operation, then original row.
 perform pg_advisory_xact_lock(hashtextextended('import-recovery-key:'||a.actor_user_id||':'||a.recovery_operation_id,0));
 perform pg_advisory_xact_lock(hashtextextended('import-upload-key:'||a.actor_user_id||':'||a.original_operation_id,0));
 select * into v_reservation from private.import_upload_reservations where id=a.reservation_id for update;
 perform private.import_upload_recovery_current(a);
 v_completed_at:=date_trunc('milliseconds',clock_timestamp());
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

 -- A continuation may encounter completion by the original worker or another
 -- authorized continuation. It must match the exact original bytes/result;
 -- the per-attempt terminal record is an observation, never a replacement.
 select * into t from private.import_upload_recovery_completions where id=a.id;
 if found then
  if t.receipt is distinct from(v_receipt-'replayed') then
   raise exception using errcode='23514',message='IMPORT_RECOVERY_SOURCE_INVALID';end if;
 else
  insert into private.import_upload_recovery_completions(id,organization_id,branch_id,reservation_id,receipt)
  values(a.id,a.organization_id,a.branch_id,a.reservation_id,v_receipt-'replayed');
 end if;
 perform private.import_upload_recovery_current(a);
 perform private.import_upload_recovery_integrity(a);
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_legacy_sub,''),true);
 perform set_config('request.jwt.claim.role',coalesce(v_legacy_role,''),true);
 return v_receipt;
exception when others then
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_legacy_sub,''),true);
 perform set_config('request.jwt.claim.role',coalesce(v_legacy_role,''),true);
 raise;
end $$;

-- Prevent a later ordinary reservation from borrowing a recovery key. This is
-- an identity fence only: original admission/evidence/content checks remain.
create function private.import_upload_recovery_key_fence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('import-recovery-key:'||new.actor_user_id||':'||new.idempotency_key,0));
 if exists(select 1 from private.import_upload_recoveries where actor_user_id=new.actor_user_id and recovery_operation_id=new.idempotency_key) then
  raise exception using errcode='23505',message='IMPORT_RECOVERY_KEY_CONFLICT';end if;
 return new;
end $$;
create trigger import_upload_recovery_key_fence before insert on private.import_upload_reservations
 for each row execute function private.import_upload_recovery_key_fence();

create function public.reserve_import_upload_recovery(p_org uuid,p_branch uuid,p_reservation uuid,p_original_operation uuid,
 p_recovery_operation uuid,p_file_sha256 text,p_file_name text,p_mime_type text,p_file_size_bytes integer,p_mapping_version text,p_mode text)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.reserve_import_upload_recovery(p_org,p_branch,p_reservation,p_original_operation,p_recovery_operation,
 p_file_sha256,p_file_name,p_mime_type,p_file_size_bytes,p_mapping_version,p_mode);
$$;
create function public.import_upload_recovery_receipt(p_org uuid,p_branch uuid,p_recovery_operation uuid,p_mode text)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.import_upload_recovery_receipt(p_org,p_branch,p_recovery_operation,p_mode);
$$;
create function public.complete_recovered_import_upload(p_recovery uuid,p_parsed_payload text,p_archive_reference jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.complete_recovered_import_upload(p_recovery,p_parsed_payload,p_archive_reference);
$$;

do $$
declare f record;
begin
 for f in select n.nspname,p.proname,p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('private','public') and p.proname in(
  'import_upload_recovery_authority','import_upload_recovery_request_hash','import_upload_recovery_integrity',
  'import_upload_recovery_envelope','import_upload_recovery_current','reserve_import_upload_recovery',
  'import_upload_recovery_receipt','complete_recovered_import_upload','import_upload_recovery_key_fence') loop
  execute format('alter function %s owner to postgres',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('reserve_import_upload_recovery','import_upload_recovery_receipt') then
   execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname='complete_recovered_import_upload' then
   execute format('grant execute on function %s to service_role',f.signature);
  end if;
 end loop;
end $$;
commit;
