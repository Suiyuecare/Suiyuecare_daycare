-- Read-only locator for an ACK-lost ORIGINAL upload operation. This is not an
-- upload replay, recovery authorization, archive write or formal client import.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.import_upload_operation_projection(
 r private.import_upload_reservations,c private.import_upload_completions,p_mode text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare proof jsonb;archive_created timestamptz;retained timestamptz;receipt_time timestamptz;entry text;
begin
 if r.id is null or r.actor_user_id is null or r.session_id is null or r.idempotency_key is null
  or not isfinite(r.created_at) or r.created_at>clock_timestamp()
  or r.file_sha256!~'^[a-f0-9]{64}$' or char_length(r.file_name) not between 1 and 255
  or r.file_name~'[[:cntrl:]/\\]' or r.file_name!~*'\.html?$'
  or r.mime_type not in('text/html','application/xhtml+xml')
  or r.file_size_bytes not between 1 and 26214400 or r.mapping_version<>'central-care-plan-html@1'
  or jsonb_typeof(r.authorization_claims) is distinct from 'object'
  or r.authorization_claims->>'sub' is distinct from r.actor_user_id::text
  or r.authorization_claims->>'session_id' is distinct from r.session_id::text
  or r.authorization_claims->>'role' is distinct from 'authenticated'
  or exists(select 1 from jsonb_object_keys(r.authorization_claims) k
    where k not in('sub','session_id','role','aud','aal','is_anonymous','iat','exp','email','amr')) then
  raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
 if p_mode='routine-intake' then
  if r.reauth_challenge_id is not null or r.file_size_bytes>4194304
   or private.general_import_repository_exact_keys(r.auth_context,
     array['policyVersion','method','action','actorUserId','sessionId','assuranceLevel','verifiedAt']) is not true
   or r.auth_context->>'policyVersion' is distinct from 'approved-google-intake@1'
   or r.auth_context->>'method' is distinct from 'google_oauth'
   or r.auth_context->>'action' is distinct from 'cms.stage'
   or r.auth_context->>'actorUserId' is distinct from r.actor_user_id::text
   or r.auth_context->>'sessionId' is distinct from r.session_id::text
   or coalesce(r.auth_context->>'assuranceLevel','') not in('aal1','aal2')
   or r.auth_context->>'assuranceLevel' is distinct from r.authorization_claims->>'aal'
   or jsonb_typeof(r.auth_context->'verifiedAt') is distinct from 'string'
   or not isfinite((r.auth_context->>'verifiedAt')::timestamptz)
   or (r.auth_context->>'verifiedAt')::timestamptz>clock_timestamp() then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
 elsif p_mode='general' then
  -- Historical captured proof must belong to the original identity, but need
  -- not still be unexpired/unrevoked. Only CURRENT read authority admits GET.
  if r.auth_context is not null or r.reauth_challenge_id is null
   or r.authorization_claims->>'aal' is distinct from 'aal2'
   or not exists(select 1 from private.reauth_challenges challenge
      where challenge.id=r.reauth_challenge_id and challenge.user_id=r.actor_user_id
       and challenge.session_id=r.session_id) then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
 else raise exception using errcode='22023',message='IMPORT_OPERATION_INVALID_INPUT';end if;
 if c.id is not null then
  if c.id<>r.id or c.organization_id<>r.organization_id or c.branch_id<>r.branch_id
   or jsonb_typeof(c.parsed_payload) is distinct from 'object' or octet_length(c.parsed_payload::text)>16777216
   or c.parsed_payload->>'mappingVersion' is distinct from r.mapping_version
   or coalesce(c.parsed_payload->>'contentFingerprint','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(c.parsed_payload->'sections') is distinct from 'array'
   or jsonb_typeof(c.parsed_payload->'fields') is distinct from 'array'
   or jsonb_typeof(c.parsed_payload->'warnings') is distinct from 'array'
   or jsonb_typeof(c.parsed_payload->'conflicts') is distinct from 'array'
   or jsonb_typeof(c.parsed_payload->'security') is distinct from 'object'
   or c.parsed_payload->'security'->>'parser' is distinct from 'cheerio-static'
   or c.parsed_payload->'security'->'externalRequestCount' is distinct from '0'::jsonb
   or c.payload_sha256!~'^[a-f0-9]{64}$'
   or not isfinite(c.completed_at) or c.completed_at<r.created_at or c.completed_at>clock_timestamp() then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  if jsonb_array_length(c.parsed_payload->'sections')>500 or jsonb_array_length(c.parsed_payload->'fields')>50000
   or jsonb_array_length(c.parsed_payload->'warnings')>100000 or jsonb_array_length(c.parsed_payload->'conflicts')>50000 then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  -- The worker hashes original serialized TEXT; JSONB does not retain its
  -- original spelling. Bind the stored hash to the exact immutable receipt,
  -- never pretend that reserializing JSONB is an original-byte rehash.
  if jsonb_typeof(c.receipt->'completed_at') is distinct from 'string'
   or (c.receipt->>'completed_at')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
   or c.receipt is distinct from jsonb_build_object('reservation_id',r.id,'status','completed','staging_only',true,
      'formally_imported',false,'file_sha256',r.file_sha256,
      'content_fingerprint',c.parsed_payload->>'contentFingerprint','mapping_version',r.mapping_version,
      'payload_sha256',c.payload_sha256,'section_count',jsonb_array_length(c.parsed_payload->'sections'),
      'field_count',jsonb_array_length(c.parsed_payload->'fields'),'completed_at',c.receipt->'completed_at') then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  receipt_time:=(c.receipt->>'completed_at')::timestamptz;
  if receipt_time is distinct from c.completed_at then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  if private.general_import_repository_exact_keys(c.archive_reference,
      array['key','versionId','sha256','createdAt','retainUntil','byteLength']) is not true
   or jsonb_typeof(c.archive_reference->'key') is distinct from 'string'
   or c.archive_reference->>'key' is distinct from 'organizations/'||r.organization_id||'/branches/'||r.branch_id
      ||'/central-html/'||r.file_sha256||'/'||r.id||'.html'
   or c.archive_reference->>'sha256' is distinct from r.file_sha256
   or c.archive_reference->'byteLength' is distinct from to_jsonb(r.file_size_bytes)
   or jsonb_typeof(c.archive_reference->'versionId') is distinct from 'string'
   or char_length(c.archive_reference->>'versionId') not between 1 and 1024
   or c.archive_reference->>'versionId'='null' or c.archive_reference->>'versionId'~'[[:space:][:cntrl:]]' then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  foreach entry in array array['createdAt','retainUntil'] loop
   if jsonb_typeof(c.archive_reference->entry) is distinct from 'string'
    or (c.archive_reference->>entry)!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  end loop;
  archive_created:=(c.archive_reference->>'createdAt')::timestamptz;
  retained:=(c.archive_reference->>'retainUntil')::timestamptz;
  if not isfinite(archive_created) or not isfinite(retained) or archive_created is distinct from r.created_at
   or retained<(((r.created_at at time zone 'UTC')+interval '7 years') at time zone 'UTC') then
   raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';end if;
  proof:=c.receipt||jsonb_build_object('replayed',false);
 end if;
 return jsonb_build_object('schema_version',1,'original_operation_id',r.idempotency_key,'reservation_id',r.id,
  'organization_id',r.organization_id,'branch_id',r.branch_id,'actor_user_id',r.actor_user_id,'mode',p_mode,
  'file_sha256',r.file_sha256,'file_name',r.file_name,'mime_type',r.mime_type,'file_size_bytes',r.file_size_bytes,
  'mapping_version',r.mapping_version,'created_at',r.created_at,
  -- No original expiry column exists. This is an observational source window,
  -- NOT permission to write or the minimum original JWT/factor deadline.
  'expires_at',r.created_at+interval '15 minutes','status',case when c.id is null then 'queued' else 'completed' end,
  'receipt',proof,'staging_only',true,'formally_imported',false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
 raise exception using errcode='23514',message='IMPORT_OPERATION_SOURCE_INVALID';
end $$;

create function private.import_upload_operation_receipt(p_org uuid,p_branch uuid,p_original_operation uuid,p_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();evidence jsonb;initial_evidence jsonb;r private.import_upload_reservations%rowtype;
 c private.import_upload_completions%rowtype;initial_source jsonb;initial_completion jsonb;result jsonb;current_result jsonb;
 round integer;
begin
 if p_org is null or p_branch is null or p_original_operation is null or p_mode is null
  or p_mode not in('routine-intake','general') then
  raise exception using errcode='22023',message='IMPORT_OPERATION_INVALID_INPUT';end if;
 initial_evidence:=private.import_upload_recovery_authority(p_org,p_branch,p_mode,false);
 if initial_evidence->>'actor' is distinct from actor::text then
  raise exception using errcode='42501',message='IMPORT_OPERATION_ACCESS_DENIED';end if;
 for round in 1..2 loop
  evidence:=private.import_upload_recovery_authority(p_org,p_branch,p_mode,false);
  if auth.uid() is distinct from actor or evidence->>'actor' is distinct from actor::text
   or evidence->>'session' is distinct from initial_evidence->>'session' then
   raise exception using errcode='42501',message='IMPORT_OPERATION_ACCESS_DENIED';end if;
  select * into r from private.import_upload_reservations reservation
   where reservation.organization_id=p_org and reservation.branch_id=p_branch
    and reservation.actor_user_id=actor and reservation.idempotency_key=p_original_operation
    and (p_mode='routine-intake')=coalesce(reservation.auth_context->>'policyVersion'='approved-google-intake@1',false);
  c:=null;current_result:=null;
  if found then
   select * into c from private.import_upload_completions completion where completion.id=r.id;
   current_result:=private.import_upload_operation_projection(r,c,p_mode);
  end if;
  if round=1 then
   result:=current_result;initial_source:=to_jsonb(r);initial_completion:=to_jsonb(c);
   insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,actor,'select','private.import_upload_reservations',r.id::text,'{}',
      '{"projection":"import_upload_operation_receipt_v1"}');
  elsif result is distinct from current_result or initial_source is distinct from to_jsonb(r)
    or initial_completion is distinct from to_jsonb(c) then
   -- An absent source/completion may appear during the audited read. Do not
   -- expose the old queued/null observation as an exact completed result.
   raise exception using errcode='40001',message='IMPORT_OPERATION_SOURCE_CHANGED';
  end if;
 end loop;
 return result;
end $$;

-- Public wrappers remain invokers. Only the checked private entry is executable
-- by authenticated; its actual auth.uid/JWT, live permission and source checks
-- remain mandatory on direct calls as well. The projector is never granted.
create function public.import_upload_operation_receipt(p_org uuid,p_branch uuid,p_original_operation uuid,p_mode text)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.import_upload_operation_receipt(p_org,p_branch,p_original_operation,p_mode);
$$;
alter function private.import_upload_operation_projection(private.import_upload_reservations,private.import_upload_completions,text) owner to postgres;
alter function private.import_upload_operation_receipt(uuid,uuid,uuid,text) owner to postgres;
alter function public.import_upload_operation_receipt(uuid,uuid,uuid,text) owner to postgres;
revoke all on function private.import_upload_operation_projection(private.import_upload_reservations,private.import_upload_completions,text),
 private.import_upload_operation_receipt(uuid,uuid,uuid,text),public.import_upload_operation_receipt(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function private.import_upload_operation_receipt(uuid,uuid,uuid,text),
 public.import_upload_operation_receipt(uuid,uuid,uuid,text) to authenticated;
commit;
