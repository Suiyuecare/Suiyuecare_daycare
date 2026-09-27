-- Durable general-import staging only. No client, plan, qualification or clinical
-- record is promoted by these RPCs. A trusted completed WORM source is mandatory.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table private.general_import_repository_sources (
 batch_id uuid primary key, organization_id uuid not null, branch_id uuid not null,
 reservation_id uuid not null unique references private.import_upload_completions(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 upload_key text not null check(char_length(upload_key) between 1 and 200 and upload_key!~'^[[:space:]]*$' and upload_key!~'[[:cntrl:]]'),
 file_sha256 text not null check(file_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 unique(batch_id,organization_id,branch_id),unique(organization_id,branch_id,file_sha256)
);
create index general_import_repository_sources_branch_idx on private.general_import_repository_sources(branch_id,organization_id);
create index general_import_repository_sources_actor_idx on private.general_import_repository_sources(actor_user_id);
create table private.general_import_repository_versions (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null,organization_id uuid not null,branch_id uuid not null,
 version bigint not null check(version>0), previous_version_id uuid references private.general_import_repository_versions(id) on delete restrict,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=18000000),
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 actor_user_id uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),
 foreign key(batch_id,organization_id,branch_id) references private.general_import_repository_sources(batch_id,organization_id,branch_id) on delete restrict,
 unique(batch_id,version),unique(id,batch_id,organization_id,branch_id),unique(previous_version_id),
 check((version=1)=(previous_version_id is null))
);
create index general_import_repository_versions_scope_idx on private.general_import_repository_versions(batch_id,organization_id,branch_id,version desc);
create index general_import_repository_versions_actor_idx on private.general_import_repository_versions(actor_user_id);
create table private.general_import_repository_operations (
 actor_user_id uuid not null references auth.users(id) on delete restrict,idempotency_key text not null,
 organization_id uuid not null,branch_id uuid not null,batch_id uuid not null,
 kind text not null check(kind in('upload','reparse','approve')),request jsonb not null check(jsonb_typeof(request)='object'),
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),result_version_id uuid not null,
 duplicate boolean not null default false,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_user_id,idempotency_key),check(char_length(idempotency_key) between 1 and 200 and idempotency_key!~'^[[:space:]]*$' and idempotency_key!~'[[:cntrl:]]'),
 check(not duplicate or kind='upload'),
 foreign key(result_version_id,batch_id,organization_id,branch_id) references private.general_import_repository_versions(id,batch_id,organization_id,branch_id) on delete restrict
);
create index general_import_repository_operations_result_idx on private.general_import_repository_operations(result_version_id,batch_id,organization_id,branch_id);
do $$declare n text;begin
 foreach n in array array['general_import_repository_sources','general_import_repository_versions','general_import_repository_operations'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('alter table private.%I force row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',n||'_immutable',n);
  execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',n||'_audit',n);
 end loop;
end $$;

create function private.general_import_repository_authority(p_org uuid,p_branch uuid,p_approve boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();t timestamptz:=clock_timestamp();
begin
 if actor is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
  or not private.has_permission(p_org,p_branch,'imports.manage')
  or (p_approve and not private.has_permission(p_org,p_branch,'imports.approve'))
  or not exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
   where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  or exists(select 1 from unnest(case when p_approve then array['imports.manage','imports.approve'] else array['imports.manage'] end) required(permission)
   where not exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id and r.is_active join public.role_permissions rp on rp.role_id=r.id
    join public.permissions perm on perm.id=rp.permission_id
    where m.profile_id=actor and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
     and m.status='active' and m.starts_at<=t and(m.ends_at is null or m.ends_at>t)
     and mr.assigned_at<=t and rp.granted_at<=t and(r.organization_id is null or r.organization_id=p_org)
     and perm.permission_key=required.permission)) then
  raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';
 end if;
 return actor;
end $$;
create function private.general_import_recent_aal2_evidence(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;challenge uuid;verified timestamptz;
begin
 actor:=private.general_import_repository_authority(p_org,p_branch,false);
 challenge:=private.current_client_master_reauth_challenge();
 select c.factor_verified_at into verified from private.reauth_challenges c join private.reauth_events e on e.challenge_id=c.id
 where c.id=challenge and c.user_id=actor and c.session_id=(auth.jwt()->>'session_id')::uuid
  and e.user_id=actor and e.session_id=c.session_id and e.revoked_at is null and c.invalidated_at is null
  and c.consumed_at is not null and c.factor_verified_at=e.verified_at and c.factor_method=e.verification_method
  and e.aal='aal2' and c.factor_verified_at<=clock_timestamp() and c.factor_verified_at>=clock_timestamp()-interval '15 minutes';
 if verified is null then raise exception using errcode='42501',message='GENERAL_IMPORT_RECENT_AAL2_REQUIRED';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'select','private.general_import_repository_sources',null,'{}','{"projection":"general_import_aal2_evidence_v1"}');
 if private.general_import_repository_authority(p_org,p_branch,false)<>actor
  or private.current_client_master_reauth_challenge()<>challenge or verified>clock_timestamp()
  or verified<clock_timestamp()-interval '15 minutes' then raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',actor,'verifiedAt',verified);
end $$;
create function private.general_import_repository_uuid(p_text text)
returns uuid language plpgsql immutable security invoker set search_path='' as $$
declare b bytea:=substring(sha256(convert_to(p_text,'UTF8')) from 1 for 16);h text;
begin
 b:=set_byte(b,6,(get_byte(b,6)&15)|80);b:=set_byte(b,8,(get_byte(b,8)&63)|128);h:=encode(b,'hex');
 return (substring(h,1,8)||'-'||substring(h,9,4)||'-'||substring(h,13,4)||'-'||substring(h,17,4)||'-'||substring(h,21,12))::uuid;
end $$;
create function private.general_import_repository_timestamp(p_time timestamptz)
returns text language sql immutable security invoker set search_path='' as $$
 select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;
create function private.general_import_repository_authorize(p_org uuid,p_branch uuid,p_action text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;evidence jsonb;verified timestamptz;
begin
 if p_action is null or p_action not in('read','write','approve') then
  raise exception using errcode='22023',message='GENERAL_IMPORT_INVALID_INPUT';end if;
 actor:=private.general_import_repository_authority(p_org,p_branch,p_action='approve');
 if p_action<>'read' then evidence:=private.general_import_recent_aal2_evidence(p_org,p_branch);verified:=(evidence->>'verifiedAt')::timestamptz;end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'select','private.general_import_repository_sources',null,'{}',jsonb_build_object('projection','general_import_authorize_v1','operation',p_action));
 if private.general_import_repository_authority(p_org,p_branch,p_action='approve') is distinct from actor
  or (p_action<>'read' and (verified is null or verified>clock_timestamp() or verified<clock_timestamp()-interval '15 minutes'
   or (private.general_import_recent_aal2_evidence(p_org,p_branch)->>'verifiedAt')::timestamptz is distinct from verified)) then
  raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',actor,'assuranceLevel','aal2','verifiedAt',verified);
end $$;
create function private.general_import_repository_exact_keys(p_value jsonb,p_keys text[])
returns boolean language sql immutable security invoker set search_path='' as $$
 select jsonb_typeof(p_value)='object' and p_value?&p_keys and (select count(*) from jsonb_object_keys(p_value))=cardinality(p_keys);
$$;
create function private.general_import_repository_text(p_value jsonb,p_nullable boolean default false)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce((p_nullable and p_value='null'::jsonb) or(jsonb_typeof(p_value)='string' and char_length(p_value#>>'{}')<=250000),false);
$$;
create function private.general_import_repository_status(p_parsed jsonb)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb;entry jsonb;k text;field jsonb;
begin
 if jsonb_typeof(p_parsed) is distinct from 'object' or p_parsed->>'mappingVersion' is distinct from 'central-care-plan-html@1'
  or jsonb_typeof(p_parsed->'sections') is distinct from 'array' or jsonb_typeof(p_parsed->'fields') is distinct from 'array'
  or jsonb_typeof(p_parsed->'warnings') is distinct from 'array' or jsonb_typeof(p_parsed->'conflicts') is distinct from 'array'
  or jsonb_typeof(p_parsed->'security') is distinct from 'object' or coalesce(p_parsed->>'contentFingerprint','')!~'^[a-f0-9]{64}$'
  or p_parsed->'security'->>'parser' is distinct from 'cheerio-static' or p_parsed->'security'->'externalRequestCount' is distinct from '0'::jsonb
  or exists(select 1 from jsonb_array_elements(p_parsed->'sections') s where jsonb_typeof(s->'recognized') is distinct from 'boolean')
  or exists(select 1 from jsonb_array_elements(p_parsed->'fields') f where coalesce(f->>'mappingState','') not in('mapped','unknown','conflict')) then
  raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 if not private.general_import_repository_exact_keys(p_parsed,array['mappingVersion','sections','fields','warnings','conflicts','contentFingerprint','security'])
  or jsonb_array_length(p_parsed->'sections')>500 or jsonb_array_length(p_parsed->'fields')>50000
  or jsonb_array_length(p_parsed->'warnings')>50500 or jsonb_array_length(p_parsed->'conflicts')>50000
  or octet_length(p_parsed::text)>16777216 then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 for item in select value from jsonb_array_elements(p_parsed->'sections') loop
  if not private.general_import_repository_exact_keys(item,array['id','index','code','title','sourceHeadingId','recognized'])
   or coalesce(item->>'id','')!~'^section_[a-f0-9]{20}$' or jsonb_typeof(item->'index') is distinct from 'number'
   or not private.general_import_repository_text(item->'sourceHeadingId',true) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
  foreach k in array array['code','title'] loop if not private.general_import_repository_text(item->k) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_parsed->'sections') with ordinality part(value,position) where part.value->'index' is distinct from to_jsonb(part.position-1))
  or(select count(distinct s->>'id') from jsonb_array_elements(p_parsed->'sections') s)<>jsonb_array_length(p_parsed->'sections') then
  raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 for item in select value from jsonb_array_elements(p_parsed->'fields') loop
  if not private.general_import_repository_exact_keys(item,array['id','mappingKey','mappingVersion','mappingState','targetPath','source','rawValue','normalizedValue','sensitive','warnings'])
   or coalesce(item->>'id','')!~'^field_[a-f0-9]{24}$' or item->>'mappingVersion' is distinct from 'central-care-plan-html@1'
   or not private.general_import_repository_text(item->'targetPath',true) or jsonb_typeof(item->'sensitive') is distinct from 'boolean'
   or jsonb_typeof(item->'warnings') is distinct from 'array' or jsonb_array_length(item->'warnings')>50000
   or not private.general_import_repository_exact_keys(item->'source',array['sectionCode','sectionTitle','label','parentPath','controlName'])
   or not private.general_import_repository_text(item->'source'->'controlName',true) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
  foreach k in array array['mappingKey','rawValue','normalizedValue'] loop if not private.general_import_repository_text(item->k) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;end loop;
  foreach k in array array['sectionCode','sectionTitle','label','parentPath'] loop if not private.general_import_repository_text(item->'source'->k) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;end loop;
  if exists(select 1 from jsonb_array_elements(item->'warnings') w where not private.general_import_repository_text(w))
   or not exists(select 1 from jsonb_array_elements(p_parsed->'sections') s where s->>'code'=item->'source'->>'sectionCode' and s->>'title'=item->'source'->>'sectionTitle') then
   raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 end loop;
 if(select count(distinct f->>'id') from jsonb_array_elements(p_parsed->'fields') f)<>jsonb_array_length(p_parsed->'fields') then
  raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 for item in select value from jsonb_array_elements(p_parsed->'warnings') loop
  if jsonb_typeof(item) is distinct from 'object' or not(item?&array['id','code','severity','message'])
   or exists(select 1 from jsonb_object_keys(item) key where key not in('id','code','severity','message','sectionCode','fieldId'))
   or coalesce(item->>'id','')!~'^warning_[a-f0-9]{20}$' or coalesce(item->>'severity','') not in('info','warning','error')
   or not private.general_import_repository_text(item->'code') or not private.general_import_repository_text(item->'message')
   or(item?'sectionCode' and not private.general_import_repository_text(item->'sectionCode'))
   or(item?'fieldId' and (coalesce(item->>'fieldId','')!~'^field_[a-f0-9]{24}$' or not exists(select 1 from jsonb_array_elements(p_parsed->'fields') f where f->>'id'=item->>'fieldId'))) then
   raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 end loop;
 for item in select value from jsonb_array_elements(p_parsed->'conflicts') loop
  if not private.general_import_repository_exact_keys(item,array['id','mappingKey','sectionCode','label','candidates','reason'])
   or coalesce(item->>'id','')!~'^conflict_[a-f0-9]{24}$' or coalesce(item->>'reason','') not in('multiple_source_values','existing_value_differs')
   or jsonb_typeof(item->'candidates') is distinct from 'array' or jsonb_array_length(item->'candidates') not between 2 and 50000 then
   raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
  foreach k in array array['mappingKey','sectionCode','label'] loop if not private.general_import_repository_text(item->k) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;end loop;
  for entry in select value from jsonb_array_elements(item->'candidates') loop
   if not private.general_import_repository_exact_keys(entry,array['fieldId','value']) or coalesce(entry->>'fieldId','')!~'^field_[a-f0-9]{24}$'
    or not private.general_import_repository_text(entry->'value') then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
   select f into field from jsonb_array_elements(p_parsed->'fields') f where f->>'id'=entry->>'fieldId';
   if field is null or field->>'mappingKey' is distinct from item->>'mappingKey' or field->>'normalizedValue' is distinct from entry->>'value' then
    raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
  end loop;
  if(select count(distinct c->>'fieldId') from jsonb_array_elements(item->'candidates') c)<>jsonb_array_length(item->'candidates') then
   raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 end loop;
 if(select count(distinct c->>'id') from jsonb_array_elements(p_parsed->'conflicts') c)<>jsonb_array_length(p_parsed->'conflicts')
  or not private.general_import_repository_exact_keys(p_parsed->'security',array['parser','scriptElementsBlocked','formElementsNeutralized','redirectElementsBlocked','activeElementsBlocked','inlineEventHandlersBlocked','externalReferencesBlocked','externalRequestCount']) then
  raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 foreach k in array array['scriptElementsBlocked','formElementsNeutralized','redirectElementsBlocked','activeElementsBlocked','inlineEventHandlersBlocked','externalReferencesBlocked'] loop
  if jsonb_typeof(p_parsed->'security'->k) is distinct from 'number' or(p_parsed->'security'->>k)::numeric<0
   or(p_parsed->'security'->>k)::numeric<>floor((p_parsed->'security'->>k)::numeric) then raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 end loop;
 return case when exists(select 1 from jsonb_array_elements(p_parsed->'sections') s where s->'recognized'='false'::jsonb)
  or exists(select 1 from jsonb_array_elements(p_parsed->'fields') f where f->>'mappingState'='unknown') then 'mapping_required' else 'ready_for_approval' end;
end $$;

-- Reconstruct immutable source attributes from the actual trusted worker result.
create function private.general_import_repository_base(p_batch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s private.general_import_repository_sources;r private.import_upload_reservations;c private.import_upload_completions;
 status text;archive_created timestamptz;retained timestamptz;
begin
 select * into s from private.general_import_repository_sources where batch_id=p_batch;
 if not found then return null;end if;
 select * into r from private.import_upload_reservations where id=s.reservation_id;
 select * into c from private.import_upload_completions where id=s.reservation_id;
 if r.id is null or c.id is null or r.organization_id<>s.organization_id or r.branch_id<>s.branch_id or r.actor_user_id<>s.actor_user_id
  or c.organization_id<>s.organization_id or c.branch_id<>s.branch_id or r.reauth_challenge_id is null
  or r.file_sha256<>s.file_sha256 or r.mapping_version<>'central-care-plan-html@1'
  or r.idempotency_key<>private.general_import_repository_uuid(array_to_json(array['trusted-html-upload/v1',s.organization_id::text,s.branch_id::text,s.actor_user_id::text,s.upload_key])::text)
  or s.batch_id<>private.general_import_repository_uuid(s.organization_id::text||chr(31)||s.branch_id::text||chr(31)||s.actor_user_id::text||chr(31)||s.upload_key)
  or c.payload_sha256!~'^[a-f0-9]{64}$' or c.completed_at<r.created_at or c.completed_at>clock_timestamp()
  or not private.general_import_repository_exact_keys(c.archive_reference,array['key','versionId','sha256','createdAt','retainUntil','byteLength'])
  or jsonb_typeof(c.archive_reference->'key') is distinct from 'string' or char_length(c.archive_reference->>'key')>1024
  or jsonb_typeof(c.archive_reference->'sha256') is distinct from 'string'
  or jsonb_typeof(c.archive_reference->'createdAt') is distinct from 'string' or jsonb_typeof(c.archive_reference->'retainUntil') is distinct from 'string'
  or c.receipt is distinct from jsonb_build_object('reservation_id',r.id,'status','completed','staging_only',true,'formally_imported',false,
    'file_sha256',r.file_sha256,'content_fingerprint',c.parsed_payload->>'contentFingerprint','mapping_version',r.mapping_version,
    'payload_sha256',c.payload_sha256,'section_count',jsonb_array_length(c.parsed_payload->'sections'),
    'field_count',jsonb_array_length(c.parsed_payload->'fields'),'completed_at',c.receipt->'completed_at')
  or (c.receipt->>'completed_at')::timestamptz is distinct from c.completed_at
  or c.archive_reference->>'key' is distinct from 'organizations/'||s.organization_id||'/branches/'||s.branch_id||'/central-html/'||s.file_sha256||'/'||s.reservation_id||'.html'
  or c.archive_reference->>'sha256' is distinct from r.file_sha256 or c.archive_reference->'byteLength' is distinct from to_jsonb(r.file_size_bytes)
  or jsonb_typeof(c.archive_reference->'versionId') is distinct from 'string'
  or char_length(c.archive_reference->>'versionId') not between 1 and 1024
  or coalesce(c.archive_reference->>'versionId','') in('','null') or c.archive_reference->>'versionId'~'[[:space:][:cntrl:]]' then
  raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 archive_created:=(c.archive_reference->>'createdAt')::timestamptz;retained:=(c.archive_reference->>'retainUntil')::timestamptz;
 if archive_created is distinct from r.created_at or retained is null or not isfinite(retained)
  or retained<((r.created_at at time zone 'UTC')+interval '7 years') at time zone 'UTC' then
  raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';end if;
 status:=private.general_import_repository_status(c.parsed_payload);
 return jsonb_build_object('id',s.batch_id,'organizationId',s.organization_id,'branchId',s.branch_id,'version',1,'status',status,
  'fileName',r.file_name,'mimeType',r.mime_type,'charset','utf-8','byteLength',r.file_size_bytes,'fileSha256',r.file_sha256,
  'contentFingerprint',c.parsed_payload->>'contentFingerprint','mappingVersion',r.mapping_version,
  'createdAt',private.general_import_repository_timestamp(r.created_at),'createdBy',r.actor_user_id,
  'updatedAt',private.general_import_repository_timestamp(c.completed_at),'sections',c.parsed_payload->'sections',
  'fields',c.parsed_payload->'fields','warnings',c.parsed_payload->'warnings','conflicts',c.parsed_payload->'conflicts',
  'security',c.parsed_payload->'security','approval',null,'originalObjectReference',
    jsonb_build_object('reservationId',r.id,'archive',c.archive_reference)::text,
  'operationKeys',jsonb_build_object('upload',s.upload_key));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception using errcode='23514',message='GENERAL_IMPORT_SOURCE_INVALID';
end $$;
create function private.general_import_repository_version(p_batch uuid,p_version_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v private.general_import_repository_versions;prev private.general_import_repository_versions;base jsonb;
begin
 base:=private.general_import_repository_base(p_batch);if base is null then return null;end if;
 if p_version_id is null then select * into v from private.general_import_repository_versions where batch_id=p_batch order by version desc limit 1;
 else select * into v from private.general_import_repository_versions where id=p_version_id and batch_id=p_batch;end if;
 if v.id is null or v.content_hash<>encode(sha256(convert_to(v.snapshot::text,'UTF8')),'hex')
  or v.snapshot-'version'-'updatedAt'-'approval'-'operationKeys' is distinct from base-'version'-'updatedAt'-'approval'-'operationKeys'
  or v.snapshot->'version' is distinct from to_jsonb(v.version) or (v.snapshot->>'updatedAt')::timestamptz is distinct from v.created_at
  or v.organization_id::text is distinct from base->>'organizationId' or v.branch_id::text is distinct from base->>'branchId'
  or not(v.snapshot?'approval') or jsonb_typeof(v.snapshot->'approval') not in('null','object')
  or jsonb_typeof(v.snapshot->'operationKeys') is distinct from 'object' or v.snapshot->'operationKeys'->>'upload' is distinct from base->'operationKeys'->>'upload'
  or exists(select 1 from jsonb_each(v.snapshot->'operationKeys') k where k.key not in('upload','reparse:central-care-plan-html@1','approve')
   or jsonb_typeof(k.value) is distinct from 'string' or char_length(k.value#>>'{}') not between 1 and 200
   or(k.value#>>'{}')~'^[[:space:]]*$' or(k.value#>>'{}')~'[[:cntrl:]]')
  or (select count(*) from private.general_import_repository_versions where batch_id=p_batch and version<=v.version)<>v.version then
  raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 if v.version=1 then
  if v.snapshot is distinct from base then raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 else
  select * into prev from private.general_import_repository_versions where id=v.previous_version_id and batch_id=p_batch
   and organization_id=v.organization_id and branch_id=v.branch_id and version=v.version-1;
  if prev.id is null or prev.content_hash<>encode(sha256(convert_to(prev.snapshot::text,'UTF8')),'hex')
   or prev.snapshot->'approval' is distinct from 'null'::jsonb or v.created_at<prev.created_at
   or prev.snapshot-'version'-'updatedAt'-'approval'-'operationKeys' is distinct from base-'version'-'updatedAt'-'approval'-'operationKeys' then
   raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
  if v.snapshot->'approval'<>'null'::jsonb and (not private.general_import_repository_exact_keys(v.snapshot->'approval',array['approvedAt','approvedBy','idempotencyKey','conflictResolutions'])
   or v.snapshot->'approval'->'approvedAt' is distinct from v.snapshot->'updatedAt'
   or jsonb_typeof(v.snapshot->'approval'->'conflictResolutions') is distinct from 'object'
   or v.snapshot->'approval'->>'approvedBy' is distinct from v.actor_user_id::text
   or (v.snapshot->'approval'->>'approvedAt')::timestamptz is distinct from v.created_at
   or v.snapshot->'approval'->>'idempotencyKey' is distinct from v.snapshot->'operationKeys'->>'approve') then
   raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 end if;
 if v.snapshot->'approval'='null'::jsonb and v.snapshot->'operationKeys'?'approve' then
  raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 return v.snapshot;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';
end $$;

create function private.general_import_repository_operation(p_org uuid,p_branch uuid,p_actor uuid,p_key text,p_kind text,p_request jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare o private.general_import_repository_operations;record jsonb;
begin
 select * into o from private.general_import_repository_operations where actor_user_id=p_actor and idempotency_key=p_key;
 if not found then return null;end if;
 if o.organization_id<>p_org or o.branch_id<>p_branch or o.kind<>p_kind or(p_request is not null and o.request is distinct from p_request) then
  raise exception using errcode='23505',message='GENERAL_IMPORT_IDEMPOTENCY_CONFLICT';end if;
 if o.request_hash<>encode(sha256(convert_to(o.request::text,'UTF8')),'hex')
  or (not o.duplicate and not exists(select 1 from private.general_import_repository_versions v where v.id=o.result_version_id
   and v.actor_user_id=o.actor_user_id)) then
  raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 record:=private.general_import_repository_version(o.batch_id,o.result_version_id);
 if record is null then raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 if o.kind='upload' then
  if (select count(*) from jsonb_object_keys(o.request))<>3 or o.request->>'fileSha256' is distinct from record->>'fileSha256'
   or jsonb_typeof(o.request->'fileSha256') is distinct from 'string'
   or jsonb_typeof(o.request->'fileName') is distinct from 'string' or jsonb_typeof(o.request->'mimeType') is distinct from 'string'
   or char_length(o.request->>'fileName') not between 1 and 255 or o.request->>'fileName'~'[[:cntrl:]/\\]'
   or o.request->>'fileName'!~*'\.html?$' or o.request->>'mimeType' not in('text/html','application/xhtml+xml')
   or(not o.duplicate and (record->'version'<>'1'::jsonb or record->>'createdBy'<>p_actor::text
    or record->'operationKeys'->>'upload'<>p_key or o.request->>'fileName'<>record->>'fileName' or o.request->>'mimeType'<>record->>'mimeType')) then
   raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
  return jsonb_build_object('batch',record,'request',o.request,'duplicate',o.duplicate,'replayed',true);
 elsif o.kind='reparse' then
  if (select count(*) from jsonb_object_keys(o.request))<>3 or o.request->>'batchId' is distinct from o.batch_id::text or o.request->>'status' is distinct from record->>'status'
   or o.request->'parsed' is distinct from jsonb_build_object('mappingVersion',record->'mappingVersion','sections',record->'sections','fields',record->'fields',
    'warnings',record->'warnings','conflicts',record->'conflicts','contentFingerprint',record->'contentFingerprint','security',record->'security')
   or record->'operationKeys'->>('reparse:'||(record->>'mappingVersion')) is distinct from p_key then
   raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 else
  if (select count(*) from jsonb_object_keys(o.request))<>2 or o.request->>'batchId' is distinct from o.batch_id::text or o.request->'resolutions' is distinct from record->'approval'->'conflictResolutions'
   or record->'approval'->>'approvedBy' is distinct from p_actor::text or record->'approval'->>'idempotencyKey' is distinct from p_key then
   raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 end if;
 return record;
end $$;

-- Private single dispatcher keeps lock order, shared-key and final fences identical.
create function private.general_import_repository_dispatch(p_org uuid,p_branch uuid,p_action text,p_batch uuid default null,
 p_key text default null,p_input jsonb default null,p_expected_version bigint default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;challenge uuid;verified timestamptz;original_actor uuid;record jsonb;result jsonb;request jsonb;prior jsonb;source_id uuid;
 r private.import_upload_reservations;c private.import_upload_completions;s private.general_import_repository_sources;
 v private.general_import_repository_versions;newid uuid;stamp timestamptz;status text;candidate jsonb;conflict jsonb;
begin
 actor:=private.general_import_repository_authority(p_org,p_branch,p_action='approve');original_actor:=actor;
 if p_action not in('read','find_hash','find_upload','attach','duplicate','find_reparse','reparse','approve') then
  raise exception using errcode='22023',message='GENERAL_IMPORT_INVALID_INPUT';end if;
 if p_action not in('read','find_hash') and (p_key is null or char_length(p_key) not between 1 and 200 or p_key~'^[[:space:]]*$' or p_key~'[[:cntrl:]]') then
  raise exception using errcode='22023',message='GENERAL_IMPORT_INVALID_INPUT';end if;
 if p_action in('attach','duplicate','reparse','approve') then
  verified:=(private.general_import_recent_aal2_evidence(p_org,p_branch)->>'verifiedAt')::timestamptz;
  challenge:=private.current_client_master_reauth_challenge();
 end if;
 if p_action in('attach','duplicate','reparse','approve') then
  perform pg_advisory_xact_lock(hashtextextended('general-import-operation:'||actor||':'||p_key,0));
 end if;
 if p_action='read' then
  select * into s from private.general_import_repository_sources where batch_id=p_batch;
  if s.batch_id is not null and(s.organization_id<>p_org or s.branch_id<>p_branch) then raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';end if;
  result:=private.general_import_repository_version(p_batch);
 elsif p_action='find_hash' then
  if jsonb_typeof(p_input->'sha') is distinct from 'string' or p_input->>'sha'!~'^[a-f0-9]{64}$' then raise exception using errcode='22023',message='GENERAL_IMPORT_INVALID_INPUT';end if;
  select * into s from private.general_import_repository_sources where organization_id=p_org and branch_id=p_branch and file_sha256=p_input->>'sha';
  p_batch:=s.batch_id;result:=private.general_import_repository_version(p_batch);
 elsif p_action='find_upload' then
  result:=private.general_import_repository_operation(p_org,p_branch,actor,p_key,'upload');
  p_batch:=(result->'batch'->>'id')::uuid;
 elsif p_action='attach' then
  source_id:=(p_input->>'reservationId')::uuid;
  select * into r from private.import_upload_reservations where id=source_id;
  select * into c from private.import_upload_completions where id=source_id;
  if r.id is null or c.id is null or r.organization_id<>p_org or r.branch_id<>p_branch or r.actor_user_id<>actor
   or r.reauth_challenge_id is null or r.idempotency_key<>private.general_import_repository_uuid(array_to_json(array['trusted-html-upload/v1',p_org::text,p_branch::text,actor::text,p_key])::text)
   or p_batch is distinct from private.general_import_repository_uuid(p_org::text||chr(31)||p_branch::text||chr(31)||actor::text||chr(31)||p_key) then
   raise exception using errcode='42501',message='GENERAL_IMPORT_SOURCE_DENIED';end if;
  request:=jsonb_build_object('fileSha256',r.file_sha256,'fileName',r.file_name,'mimeType',r.mime_type);
  prior:=private.general_import_repository_operation(p_org,p_branch,actor,p_key,'upload',request);
  if prior is not null then result:=prior;
  else
   perform pg_advisory_xact_lock(hashtextextended('general-import-content:'||p_org||':'||p_branch||':'||r.file_sha256,0));
   perform pg_advisory_xact_lock(hashtextextended('general-import-batch:'||p_batch,0));
   if exists(select 1 from private.general_import_repository_sources where organization_id=p_org and branch_id=p_branch and file_sha256=r.file_sha256) then
    raise exception using errcode='23505',message='GENERAL_IMPORT_SOURCE_ALREADY_ATTACHED';end if;
   insert into private.general_import_repository_sources(batch_id,organization_id,branch_id,reservation_id,actor_user_id,upload_key,file_sha256)
   values(p_batch,p_org,p_branch,source_id,actor,p_key,r.file_sha256);
   record:=private.general_import_repository_base(p_batch);stamp:=(record->>'updatedAt')::timestamptz;
   insert into private.general_import_repository_versions(batch_id,organization_id,branch_id,version,snapshot,content_hash,actor_user_id,created_at)
   values(p_batch,p_org,p_branch,1,record,encode(sha256(convert_to(record::text,'UTF8')),'hex'),actor,stamp) returning id into newid;
   insert into private.general_import_repository_operations(actor_user_id,idempotency_key,organization_id,branch_id,batch_id,kind,request,request_hash,result_version_id)
   values(actor,p_key,p_org,p_branch,p_batch,'upload',request,encode(sha256(convert_to(request::text,'UTF8')),'hex'),newid);
   result:=jsonb_build_object('batch',record,'request',request,'duplicate',false,'replayed',false);
  end if;
 else
  select * into s from private.general_import_repository_sources where batch_id=p_batch and organization_id=p_org and branch_id=p_branch;
  if not found then raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';end if;
  if p_action='duplicate' then
   request:=p_input;
   if jsonb_typeof(request) is distinct from 'object' or (select count(*) from jsonb_object_keys(request))<>3
    or jsonb_typeof(request->'fileSha256') is distinct from 'string' or jsonb_typeof(request->'mimeType') is distinct from 'string'
    or request->>'fileSha256' is distinct from s.file_sha256 or jsonb_typeof(request->'fileName') is distinct from 'string'
    or char_length(request->>'fileName') not between 1 and 255
    or request->>'fileName'~'[[:cntrl:]/\\]' or request->>'fileName'!~*'\.html?$'
    or coalesce(request->>'mimeType','') not in('text/html','application/xhtml+xml') then raise exception using errcode='22023',message='GENERAL_IMPORT_INVALID_INPUT';end if;
   prior:=private.general_import_repository_operation(p_org,p_branch,actor,p_key,'upload',request);
  elsif p_action in('find_reparse','reparse') then
   select * into c from private.import_upload_completions where id=s.reservation_id;
   status:=private.general_import_repository_status(c.parsed_payload);
   if p_input->'parsed' is distinct from c.parsed_payload or p_input->>'status' is distinct from status then
    raise exception using errcode='22023',message='GENERAL_IMPORT_REPARSE_SOURCE_MISMATCH';end if;
   request:=jsonb_build_object('batchId',p_batch,'parsed',p_input->'parsed','status',status);
   prior:=private.general_import_repository_operation(p_org,p_branch,actor,p_key,'reparse',request);
  else
   if jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='GENERAL_IMPORT_INVALID_INPUT';end if;
   request:=jsonb_build_object('batchId',p_batch,'resolutions',p_input);
   prior:=private.general_import_repository_operation(p_org,p_branch,actor,p_key,'approve',request);
  end if;
  if prior is not null then result:=prior;
  elsif p_action='find_reparse' then result:=null;
  else
   perform pg_advisory_xact_lock(hashtextextended('general-import-batch:'||p_batch,0));
   record:=private.general_import_repository_version(p_batch);
   select * into v from private.general_import_repository_versions where batch_id=p_batch order by version desc limit 1;
   if p_action='duplicate' then
    insert into private.general_import_repository_operations(actor_user_id,idempotency_key,organization_id,branch_id,batch_id,kind,request,request_hash,result_version_id,duplicate)
    values(actor,p_key,p_org,p_branch,p_batch,'upload',request,encode(sha256(convert_to(request::text,'UTF8')),'hex'),v.id,true);
    result:=jsonb_build_object('batch',record,'request',request,'duplicate',true,'replayed',false);
   else
    if record->'approval'<>'null'::jsonb then raise exception using errcode='55000',message='GENERAL_IMPORT_APPROVED_IMMUTABLE';end if;
    if p_expected_version is null or p_expected_version<>v.version then raise exception using errcode='40001',message='GENERAL_IMPORT_VERSION_CONFLICT';end if;
    stamp:=clock_timestamp();
    if p_action='approve' then
     if record->>'status'<>'ready_for_approval' or jsonb_array_length(record->'fields')=0
      or exists(select 1 from jsonb_each(p_input) decisions(entry_key,entry_value) where jsonb_typeof(decisions.entry_value) is distinct from 'string')
      or exists(select 1 from jsonb_array_elements(record->'warnings') w where w->>'severity'='error')
      or exists(select 1 from jsonb_object_keys(p_input) k where not exists(select 1 from jsonb_array_elements(record->'conflicts') f where f->>'id'=k)) then
      raise exception using errcode='22023',message='GENERAL_IMPORT_APPROVAL_INCOMPLETE';end if;
     for conflict in select value from jsonb_array_elements(record->'conflicts') loop
      if not exists(select 1 from jsonb_array_elements(conflict->'candidates') entry where entry->>'fieldId'=p_input->> (conflict->>'id')
       and exists(select 1 from jsonb_array_elements(record->'fields') field where field->>'id'=entry->>'fieldId'
        and field->>'mappingKey'=conflict->>'mappingKey' and field->>'normalizedValue'=entry->>'value')) then
       raise exception using errcode='22023',message='GENERAL_IMPORT_APPROVAL_INCOMPLETE';end if;
     end loop;
     record:=record||jsonb_build_object('version',v.version+1,'updatedAt',private.general_import_repository_timestamp(stamp),
      'approval',jsonb_build_object('approvedAt',private.general_import_repository_timestamp(stamp),'approvedBy',actor,'idempotencyKey',p_key,'conflictResolutions',p_input),
      'operationKeys',record->'operationKeys'||jsonb_build_object('approve',p_key));
    else
     record:=record||jsonb_build_object('version',v.version+1,'updatedAt',private.general_import_repository_timestamp(stamp),
      'operationKeys',record->'operationKeys'||jsonb_build_object('reparse:central-care-plan-html@1',p_key));
    end if;
    insert into private.general_import_repository_versions(batch_id,organization_id,branch_id,version,previous_version_id,snapshot,content_hash,actor_user_id,created_at)
    values(p_batch,p_org,p_branch,v.version+1,v.id,record,encode(sha256(convert_to(record::text,'UTF8')),'hex'),actor,stamp) returning id into newid;
    insert into private.general_import_repository_operations(actor_user_id,idempotency_key,organization_id,branch_id,batch_id,kind,request,request_hash,result_version_id)
    values(actor,p_key,p_org,p_branch,p_batch,p_action,request,encode(sha256(convert_to(request::text,'UTF8')),'hex'),newid);
    result:=record;
   end if;
  end if;
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'select','private.general_import_repository_sources',p_batch::text,'{}',jsonb_build_object('projection','general_import_repository_v1','operation',p_action));
 if private.general_import_repository_authority(p_org,p_branch,p_action='approve') is distinct from original_actor then
  raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';end if;
 if challenge is not null and (private.current_client_master_reauth_challenge() is distinct from challenge
  or (private.general_import_recent_aal2_evidence(p_org,p_branch)->>'verifiedAt')::timestamptz is distinct from verified) then
  raise exception using errcode='42501',message='GENERAL_IMPORT_ACCESS_DENIED';end if;
 -- Audit insertion may wait. Revalidate immutable result/source instead of
 -- returning a pre-wait projection from a revoked or corrupted source.
 if result is not null then
  if p_action in('find_upload','attach','duplicate') then
   if private.general_import_repository_operation(p_org,p_branch,actor,p_key,'upload',request) is distinct from result||jsonb_build_object('replayed',true) then
    raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
  elsif p_action in('find_reparse','reparse','approve') then
   if private.general_import_repository_operation(p_org,p_branch,actor,p_key,case when p_action='find_reparse' then 'reparse' else p_action end,request) is distinct from result then
    raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
  elsif private.general_import_repository_version(p_batch,(select id from private.general_import_repository_versions where batch_id=p_batch and version=(result->>'version')::bigint)) is distinct from result then
   raise exception using errcode='23514',message='GENERAL_IMPORT_RECEIPT_INVALID';end if;
 end if;
 return result;
end $$;

create function public.general_import_recent_aal2_evidence(p_org uuid,p_branch uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_recent_aal2_evidence(p_org,p_branch);$$;
create function public.general_import_repository_authorize(p_org uuid,p_branch uuid,p_action text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_authorize(p_org,p_branch,p_action);$$;
create function public.general_import_repository_read(p_org uuid,p_branch uuid,p_batch uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'read',p_batch);$$;
create function public.general_import_repository_find_hash(p_org uuid,p_branch uuid,p_sha text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'find_hash',null,null,jsonb_build_object('sha',p_sha));$$;
create function public.general_import_repository_find_upload(p_org uuid,p_branch uuid,p_key text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'find_upload',null,p_key);$$;
create function public.general_import_repository_attach(p_org uuid,p_branch uuid,p_batch uuid,p_reservation uuid,p_key text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'attach',p_batch,p_key,jsonb_build_object('reservationId',p_reservation));$$;
create function public.general_import_repository_duplicate(p_org uuid,p_branch uuid,p_batch uuid,p_file_sha256 text,p_file_name text,p_mime_type text,p_key text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'duplicate',p_batch,p_key,jsonb_build_object('fileSha256',p_file_sha256,'fileName',p_file_name,'mimeType',p_mime_type));$$;
create function public.general_import_repository_find_reparse(p_org uuid,p_branch uuid,p_batch uuid,p_parsed jsonb,p_status text,p_key text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'find_reparse',p_batch,p_key,jsonb_build_object('parsed',p_parsed,'status',p_status));$$;
create function public.general_import_repository_reparse(p_org uuid,p_branch uuid,p_batch uuid,p_parsed jsonb,p_status text,p_key text,p_expected_version bigint) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'reparse',p_batch,p_key,jsonb_build_object('parsed',p_parsed,'status',p_status),p_expected_version);$$;
create function public.general_import_repository_approve(p_org uuid,p_branch uuid,p_batch uuid,p_expected_version bigint,p_resolutions jsonb,p_key text) returns jsonb language sql volatile security invoker set search_path='' as $$select private.general_import_repository_dispatch(p_org,p_branch,'approve',p_batch,p_key,p_resolutions,p_expected_version);$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('private','public') and (p.proname like 'general_import_repository_%' or p.proname='general_import_recent_aal2_evidence') loop
  execute format('alter function %s owner to postgres',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.nspname='public' or f.signature::text like 'private.general_import_repository_dispatch(%' or f.signature::text like 'private.general_import_repository_authorize(%' or f.signature::text like 'private.general_import_recent_aal2_evidence(%' then
   execute format('grant execute on function %s to authenticated',f.signature);
  end if;
 end loop;
end $$;
commit;
