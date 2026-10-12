begin;
set local lock_timeout='5s';

-- A local supplement is an append-only intake profile, not an admission or a
-- replacement for the immutable JUBO source. The normal RPC remains the only
-- write entry. Roles, tenant, field permissions and native Google stay checked.
create function private.jubo_pending_profile_operation_matches(p_org uuid,p_branch uuid,p_client uuid,p_version bigint,p_profile jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare operation uuid; op private.client_intake_operations%rowtype;
begin
 if not private.jubo_pending_questionnaire_scope(p_org,p_branch,p_client)
  or not private.has_routine_intake_access(p_org,p_branch,'profile.update',p_client) then return false; end if;
 begin operation:=nullif(current_setting('app.jubo_pending_profile_operation',true),'')::uuid;
 exception when invalid_text_representation then return false; end;
 if operation is null then return false; end if;
 select * into op from private.client_intake_operations where actor_user_id=auth.uid() and idempotency_key=operation;
 return coalesce(op.organization_id=p_org and op.branch_id=p_branch and op.client_id=p_client
  and op.operation_kind='update_profile'
  and op.receipt->>'clientId'=p_client::text and op.receipt->>'profileVersion'=p_version::text
  and op.receipt->'pending'='true'::jsonb
  and op.decisions=jsonb_build_array(jsonb_build_object('kind','jubo_pending_local_supplement',
   'transactionId',txid_current()::text,'profileVersion',p_version,
   'profileSha256',encode(sha256(convert_to(p_profile::text,'UTF8')),'hex'))),false);
end; $$;
revoke all on function private.jubo_pending_profile_operation_matches(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;

create function private.jubo_pending_client_profile_update_matches(p_old public.clients,p_new public.clients)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare op private.client_intake_operations%rowtype; v private.client_intake_versions%rowtype;
begin
 if p_old.status<>'pending' or p_new.status<>'pending' or p_new.admitted_on is not null or p_new.ended_on is not null
  or p_new.row_version<>p_old.row_version+1
  or (to_jsonb(p_new)-array['client_code','display_name','date_of_birth','row_version','updated_at'])
    is distinct from (to_jsonb(p_old)-array['client_code','display_name','date_of_birth','row_version','updated_at']) then return false; end if;
 select * into v from private.client_intake_versions where client_id=p_old.id order by version desc limit 1;
 if not private.jubo_pending_profile_operation_matches(p_old.organization_id,p_old.branch_id,p_old.id,v.version,v.profile)
  or v.actor_user_id is distinct from auth.uid() or p_new.client_code is distinct from v.profile->>'clientCode'
  or p_new.display_name is distinct from v.profile->>'displayName'
  or p_new.date_of_birth is distinct from private.intake_date(v.profile->>'dateOfBirth') then return false; end if;
 select * into op from private.client_intake_operations where actor_user_id=auth.uid()
  and idempotency_key=current_setting('app.jubo_pending_profile_operation')::uuid;
 return op.receipt->>'clientRowVersion'=p_new.row_version::text;
end; $$;
revoke all on function private.jubo_pending_client_profile_update_matches(public.clients,public.clients) from public,anon,authenticated,service_role;

create function private.write_jubo_pending_intake_supplement(p_org uuid,p_branch uuid,p_operation uuid,p_client uuid,
 p_expected_version bigint,p_expected_client_version bigint,p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare c public.clients%rowtype; v private.client_intake_versions%rowtype; op private.client_intake_operations%rowtype;
 p jsonb; baseline jsonb; original jsonb; authority jsonb; k text; h text; result jsonb; challenge uuid; previous_setting text;
begin
 if not private.jubo_pending_questionnaire_scope(p_org,p_branch,p_client)
  or not private.has_routine_intake_access(p_org,p_branch,'profile.update',p_client) then
  raise exception using errcode='42501',message='JUBO_PENDING_SUPPLEMENT_DENIED'; end if;
 challenge:=private.require_intake_authority(p_org,p_branch,p_client,true);
 if p_operation is null then raise exception using errcode='22023',message='INTAKE_INVALID_INPUT'; end if;
 p:=private.validate_intake_profile(p_profile);
 h:=encode(sha256(convert_to(jsonb_build_object('kind','update_profile','org',p_org,'branch',p_branch,'client',p_client,
  'version',p_expected_version,'clientVersion',p_expected_client_version,'profile',p)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('intake-operation:'||auth.uid()||':'||p_operation,0));
 select * into op from private.client_intake_operations where actor_user_id=auth.uid() and idempotency_key=p_operation;
 if found then
  if op.request_sha256<>h then raise exception using errcode='23505',message='INTAKE_IDEMPOTENCY_CONFLICT'; end if;
  return op.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into c from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch for update;
 if c.status is distinct from 'pending' or c.admitted_on is not null or c.ended_on is not null then
  raise exception using errcode='42501',message='JUBO_PENDING_SUPPLEMENT_DENIED'; end if;
 select * into v from private.client_intake_versions where client_id=c.id order by version desc limit 1;
 if p_expected_version is distinct from coalesce(v.version,0) or p_expected_client_version is distinct from c.row_version then
  raise exception using errcode='40001',message='INTAKE_VERSION_CONFLICT'; end if;
 select coalesce(
  (select source_version.profile from private.jubo_intake_profile_sources source_link
   join private.client_intake_versions source_version on source_version.id=source_link.intake_version_id
   where source_link.client_id=c.id and source_link.organization_id=p_org and source_link.branch_id=p_branch),
  (select link.profile from private.jubo_operator_master_links link where link.client_id=c.id and link.organization_id=p_org and link.branch_id=p_branch)) into original;
 if original is null then raise exception using errcode='42501',message='JUBO_PENDING_SOURCE_REQUIRED'; end if;
 baseline:=coalesce(v.profile,original); authority:=coalesce(v.field_authority,'{}'::jsonb);
 if p->>'clientCode' is distinct from original->>'clientCode' then
  raise exception using errcode='42501',message='JUBO_PENDING_SOURCE_FIELD_PROTECTED'; end if;
 foreach k in array private.intake_central_keys() loop
  if (authority->>k='central' and baseline->k is distinct from p->k)
   or (original->k is not null and original->k<>'null'::jsonb and original->k<>'"unknown"'::jsonb and original->k is distinct from p->k)
   or (k='identityNumber' and baseline->>'identityNumber' is not null and baseline->k is distinct from p->k) then
   raise exception using errcode='42501',message='JUBO_PENDING_SOURCE_FIELD_PROTECTED'; end if;
 end loop;
 if p->>'identityNumber' is not null and exists(select 1 from private.client_intake_identities
  where client_id=c.id and identity_sha256<>encode(sha256(convert_to(p->>'identityNumber','UTF8')),'hex')) then
  raise exception using errcode='42501',message='JUBO_PENDING_SOURCE_FIELD_PROTECTED'; end if;
 if p->>'identityNumber' is not null and exists(select 1 from private.client_intake_identities
  where organization_id=p_org and identity_sha256=encode(sha256(convert_to(p->>'identityNumber','UTF8')),'hex') and client_id<>c.id) then
  raise exception using errcode='23505',message='INTAKE_IDENTITY_ALREADY_EXISTS'; end if;
 for k in select jsonb_object_keys(p) loop
  if p->k is distinct from baseline->k then authority:=authority||jsonb_build_object(k,'local');
  elsif not(authority ? k) then authority:=authority||jsonb_build_object(k,'jubo_export'); end if;
 end loop;
 result:=jsonb_build_object('clientId',c.id,'profileVersion',coalesce(v.version,0)+1,'clientRowVersion',c.row_version+1,
  'pending',true,'replayed',false,'operationId',p_operation);
 -- Evidence precedes the guarded projection, but every write is in one
 -- transaction. A failure rolls back the operation, version and projection.
 insert into private.client_intake_operations(organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_sha256,
  operation_kind,reauth_challenge_id,receipt,decisions) values(p_org,p_branch,c.id,auth.uid(),p_operation,h,'update_profile',challenge,result,
  jsonb_build_array(jsonb_build_object('kind','jubo_pending_local_supplement','transactionId',txid_current()::text,
   'profileVersion',coalesce(v.version,0)+1,'profileSha256',encode(sha256(convert_to(p::text,'UTF8')),'hex'))));
 previous_setting:=coalesce(current_setting('app.jubo_pending_profile_operation',true),'');
 perform set_config('app.jubo_pending_profile_operation',p_operation::text,true);
 insert into private.client_intake_versions(organization_id,branch_id,client_id,version,profile,field_authority,source_batch_id,actor_user_id)
  values(p_org,p_branch,c.id,coalesce(v.version,0)+1,p,authority,v.source_batch_id,auth.uid());
 update public.clients set client_code=p->>'clientCode',display_name=p->>'displayName',date_of_birth=private.intake_date(p->>'dateOfBirth'),
  row_version=c.row_version+1,updated_at=clock_timestamp() where id=c.id;
 if p->>'identityNumber' is not null and not exists(select 1 from private.client_intake_identities where client_id=c.id) then
  insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256)
   values(p_org,p_branch,c.id,encode(sha256(convert_to(p->>'identityNumber','UTF8')),'hex'));
 end if;
 perform set_config('app.jubo_pending_profile_operation',previous_setting,true);
 perform private.require_intake_authority(p_org,p_branch,c.id,true);
 return result;
end; $$;
revoke all on function private.write_jubo_pending_intake_supplement(uuid,uuid,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated,service_role;

do $guards$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('private.write_intake_profile(uuid,uuid,uuid,uuid,bigint,bigint,jsonb)'::regprocedure);
 anchor:=E'begin\n';
 if position(anchor in definition)=0 then raise exception 'unexpected intake writer'; end if;
 definition:=overlay(definition placing anchor||$dispatch$
 if p_client is not null and exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch and status='pending') then
  return private.write_jubo_pending_intake_supplement(p_org,p_branch,p_operation,p_client,p_expected_version,p_expected_client_version,p_profile); end if;
$dispatch$ from position(anchor in definition) for length(anchor));
 execute definition;
 definition:=pg_get_functiondef('private.guard_jubo_pending_client_insert()'::regprocedure);
 anchor:='if tg_op=''UPDATE'' and old.status=''pending'' then';
 if position(anchor in definition)=0 then raise exception 'unexpected pending client guard'; end if;
 execute replace(definition,anchor,anchor||E'\n    if private.jubo_pending_client_profile_update_matches(old,new) then return new; end if;');
 definition:=pg_get_functiondef('private.guard_jubo_pending_profile_version()'::regprocedure);
 anchor:='if new.source_batch_id is null and exists(';
 if position(anchor in definition)=0 then raise exception 'unexpected pending profile guard'; end if;
 execute replace(definition,anchor,'if new.source_batch_id is null and not private.jubo_pending_profile_operation_matches(new.organization_id,new.branch_id,new.client_id,new.version,new.profile) and exists(');
end $guards$;

-- The existing snapshot authorizes sensitive profile access before exposing
-- field metadata. Empty source values remain fillable; the immutable original
-- is used even after a local supplement creates a newer profile version.
do $snapshot$ declare definition text; anchor text:='return result;'; begin
 definition:=pg_get_functiondef('private.client_intake_snapshot(uuid,uuid,uuid)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'unexpected intake snapshot definition'; end if;
 execute replace(definition,anchor,$keys$
 result:=result||jsonb_build_object('protectedFieldKeys',(
  with source as (select coalesce(
   (select original.profile from private.jubo_intake_profile_sources link join private.client_intake_versions original on original.id=link.intake_version_id
    where link.client_id=c.id and link.organization_id=p_org and link.branch_id=p_branch),
   (select link.profile from private.jubo_operator_master_links link where link.client_id=c.id and link.organization_id=p_org and link.branch_id=p_branch)) profile),
  protected as (
   select k from unnest(private.intake_central_keys()) k cross join source
   where v.field_authority->>k='central' or (c.status='pending' and source.profile->k is not null
    and source.profile->k<>'null'::jsonb and source.profile->k<>'"unknown"'::jsonb)
   union select 'clientCode' from source where c.status='pending' and source.profile is not null
   union select 'identityNumber' where result->'profile'->>'identityNumber' is not null)
  select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from protected));
 return result;
$keys$);
end $snapshot$;

-- Only identifiers already requested by the caller are returned. This grants
-- neither roster access nor PHI. Read-only users receive an empty draft set.
create function private.authorized_pending_questionnaire_client_ids(p_org uuid,p_branch uuid,p_visible_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare forms text[]:=array['spmsq','gds_15','fall_risk_taipei_115','nsi_determine','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','mna_sf']; result jsonb;
begin
 if p_visible_ids is null or cardinality(p_visible_ids)>500 or array_position(p_visible_ids,null) is not null then
  raise exception using errcode='22023',message='QUESTIONNAIRE_CLIENT_IDS_INVALID'; end if;
 if not exists(select 1 from unnest(forms) form where private.questionnaire_assessment_authority(p_org,p_branch,null,form,'read')) then
  raise exception using errcode='42501',message='QUESTIONNAIRE_ACCESS_DENIED'; end if;
 select coalesce(jsonb_agg(c.id order by c.id),'[]'::jsonb) into result from public.clients c
 where c.id=any(p_visible_ids) and c.organization_id=p_org and c.branch_id=p_branch
  and private.jubo_pending_questionnaire_scope(p_org,p_branch,c.id)
  and exists(select 1 from unnest(forms) form where private.questionnaire_assessment_authority(p_org,p_branch,c.id,form,'manage'));
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','public.clients','{}',jsonb_build_object('projection','pending_questionnaire_draft_ids','authorizedCount',jsonb_array_length(result)));
 return result;
end; $$;
create function public.authorized_pending_questionnaire_client_ids(p_org uuid,p_branch uuid,p_visible_ids uuid[])
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.authorized_pending_questionnaire_client_ids(p_org,p_branch,p_visible_ids);
$$;
revoke all on function private.authorized_pending_questionnaire_client_ids(uuid,uuid,uuid[]),public.authorized_pending_questionnaire_client_ids(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.authorized_pending_questionnaire_client_ids(uuid,uuid,uuid[]),public.authorized_pending_questionnaire_client_ids(uuid,uuid,uuid[]) to authenticated;
commit;
