-- User-approved administrative intake only. Real Google AAL1 remains AAL1.
-- No global permission/routine-care/signature/MFA helper is weakened.
begin;
set local lock_timeout = '5s';

create function private.routine_intake_scope()
returns table(membership_id uuid,organization_id uuid,branch_id uuid,role_id uuid)
language sql volatile security definer set search_path='' as $$
 select * from private.routine_staff_scope()
 union select * from private.executive_reader_scope();
$$;
create function private.has_routine_intake_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_org is not null and p_branch is not null and p_permission in (
 'clients.read','clients.view_all','clients.demographics.read','clients.manage',
 'imports.manage','imports.approve','staff_scheduling.manage','abcd_assessments.read','abcd_assessments.manage',
 'health.read','care_records.read') and exists(
 select 1 from private.routine_intake_scope() s
 join public.role_permissions rp on rp.role_id=s.role_id and rp.granted_at<=clock_timestamp()
 join public.permissions p on p.id=rp.permission_id and p.permission_key=p_permission
 join public.branches b on b.id=p_branch and b.organization_id=p_org and b.is_active
 where s.organization_id=p_org and (s.branch_id is null or s.branch_id=p_branch)),false);
$$;
create function private.can_routine_intake_access_client(p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.clients c where c.id=p_client
 and private.has_routine_intake_permission(c.organization_id,c.branch_id,'clients.read')
 and private.has_routine_intake_permission(c.organization_id,c.branch_id,p_permission)
 and (private.has_routine_intake_permission(c.organization_id,c.branch_id,'clients.view_all')
 or exists(select 1 from public.client_assignments a where a.client_id=c.id and a.organization_id=c.organization_id
 and a.branch_id=c.branch_id and a.assignee_user_id=auth.uid() and a.starts_at<=clock_timestamp()
 and (a.ends_at is null or a.ends_at>clock_timestamp()))));
$$;
create function private.has_routine_intake_access(p_org uuid,p_branch uuid,p_action text,p_client uuid default null)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare permissions text[]; permission text;
begin
 permissions:=case p_action
 when 'profile.read' then array['clients.read','clients.demographics.read']
 when 'profile.create' then array['clients.read','clients.demographics.read','clients.manage','clients.view_all']
 when 'profile.update' then array['clients.read','clients.demographics.read','clients.manage']
 when 'cms.stage' then array['clients.read','clients.demographics.read','clients.manage','imports.manage','clients.view_all']
 when 'cms.preview' then array['clients.read','clients.demographics.read','imports.manage']
 when 'cms.commit' then array['clients.read','clients.demographics.read','clients.manage','imports.manage','imports.approve']
 when 'weekly.read' then array['clients.read']
 when 'weekly.write' then array['clients.read','staff_scheduling.manage']
 when 'abcd.read' then array['clients.read','abcd_assessments.read']
 when 'abcd.save' then array['clients.read','abcd_assessments.read','abcd_assessments.manage']
 when 'abcd.submit' then array['clients.read','abcd_assessments.read','abcd_assessments.manage']
 when 'abcd.review' then array['clients.read','abcd_assessments.read','abcd_assessments.manage']
 else null end;
 if permissions is null or auth.uid() is null then return false; end if;
 if p_client is null and p_action in ('profile.update','weekly.read','weekly.write','abcd.read','abcd.save','abcd.submit','abcd.review') then return false;end if;
 if p_action='profile.create' and p_client is not null then return false;end if;
 if p_client is not null and not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch) then return false;end if;
 if p_client is null and p_action in ('cms.preview','cms.commit') then permissions:=permissions||array['clients.view_all'];end if;
 foreach permission in array permissions loop
  if not private.has_routine_intake_permission(p_org,p_branch,permission) then return false;end if;
  if p_client is not null and not private.can_routine_intake_access_client(p_client,permission) then return false;end if;
 end loop;
 return true;
end;$$;
create function public.has_routine_intake_access(target_org_id uuid,target_branch_id uuid,target_action text,target_client_id uuid default null)
returns boolean language sql volatile security invoker set search_path='' as $$
 select private.has_routine_intake_access(target_org_id,target_branch_id,target_action,target_client_id);
$$;
create function private.routine_intake_auth_evidence(p_org uuid,p_branch uuid,p_action text,p_client uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.has_routine_intake_access(p_org,p_branch,p_action,p_client) then raise exception using errcode='42501',message='INTAKE_GOOGLE_ACTION_DENIED';end if;
 return jsonb_build_object('policyVersion','approved-google-intake@1','method','google_oauth','action',p_action,
 'actorUserId',auth.uid(),'sessionId',auth.jwt()->>'session_id','assuranceLevel',auth.jwt()->>'aal','verifiedAt',clock_timestamp());
end;$$;
alter table private.client_intake_operations alter column reauth_challenge_id drop not null;
alter table private.client_intake_operations add column auth_context jsonb;
alter table private.client_intake_operations add constraint intake_operation_auth_evidence check(
 reauth_challenge_id is not null or coalesce(auth_context->>'policyVersion'='approved-google-intake@1'
 and auth_context->>'sessionId' is not null and auth_context->>'assuranceLevel' in ('aal1','aal2'),false));
create function private.capture_intake_operation_auth() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reauth_challenge_id is null then new.auth_context:=private.routine_intake_auth_evidence(new.organization_id,new.branch_id,
 case new.operation_kind when 'create_manual' then 'profile.create' when 'update_profile' then 'profile.update' else 'cms.commit' end,
 case when new.operation_kind='create_manual' then null else new.client_id end);end if;
 return new;
end;$$;
create trigger intake_operation_auth before insert on private.client_intake_operations for each row execute function private.capture_intake_operation_auth();
alter table private.import_upload_reservations alter column reauth_challenge_id drop not null;
alter table private.import_upload_reservations add column auth_context jsonb;
alter table private.import_upload_reservations add constraint intake_upload_auth_evidence check(
 reauth_challenge_id is not null or coalesce(auth_context->>'policyVersion'='approved-google-intake@1'
 and auth_context->>'action'='cms.stage' and auth_context->>'sessionId'=session_id::text
 and auth_context->>'assuranceLevel' in ('aal1','aal2'),false));
alter table private.client_weekly_versions add column auth_context jsonb;
alter table private.client_weekly_exceptions add column auth_context jsonb;
create function private.capture_weekly_intake_auth() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.has_routine_intake_access(new.organization_id,new.branch_id,'weekly.write',new.client_id) then
 new.auth_context:=private.routine_intake_auth_evidence(new.organization_id,new.branch_id,'weekly.write',new.client_id);
 else new.auth_context:=jsonb_build_object('method','legacy_recent_aal2','assuranceLevel',auth.jwt()->>'aal','sessionId',auth.jwt()->>'session_id');end if;
 return new;
end;$$;
create trigger weekly_plan_auth before insert on private.client_weekly_versions for each row execute function private.capture_weekly_intake_auth();
create trigger weekly_exception_auth before insert on private.client_weekly_exceptions for each row execute function private.capture_weekly_intake_auth();

revoke all on function private.routine_intake_scope(),private.has_routine_intake_permission(uuid,uuid,text),
 private.can_routine_intake_access_client(uuid,text),private.has_routine_intake_access(uuid,uuid,text,uuid),
 public.has_routine_intake_access(uuid,uuid,text,uuid),private.routine_intake_auth_evidence(uuid,uuid,text,uuid),
 private.capture_intake_operation_auth(),private.capture_weekly_intake_auth() from public,anon,authenticated,service_role;
grant execute on function private.has_routine_intake_access(uuid,uuid,text,uuid),public.has_routine_intake_access(uuid,uuid,text,uuid) to authenticated;
create or replace function private.require_intake_authority(p_org uuid,p_branch uuid,p_client uuid,p_write boolean)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare k text; v_challenge uuid;
begin
  if private.has_routine_intake_access(p_org,p_branch,case when not p_write then 'profile.read' when p_client is null then 'profile.create' else 'profile.update' end,p_client) then return null;end if;
  if auth.uid() is null or p_org is null or p_branch is null or not exists(
    select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and o.id=p_org and b.is_active and o.is_active) then
    raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  foreach k in array array['clients.read','clients.demographics.read'] loop
    if not(private.has_permission(p_org,p_branch,k) or (not p_write and private.has_executive_read_permission(p_org,p_branch,k))) then
      raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  end loop;
  if p_client is not null and (not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch)
    or not(private.can_staff_access_client(p_client,'clients.read') or (not p_write and private.can_executive_read_client(p_client,'clients.read')))) then
    raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  if p_write then
    if not private.has_permission(p_org,p_branch,'clients.manage') or
      (p_client is null and not private.has_permission(p_org,p_branch,'clients.view_all')) or
      (p_client is not null and not private.can_staff_access_client(p_client,'clients.manage')) then
      raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
    v_challenge:=private.current_client_master_reauth_challenge();
  end if;
  return v_challenge;
end;
$$;

create or replace function private.cms_intake_preview(p_org uuid,p_branch uuid,p_batch uuid,p_client uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare source private.import_upload_completions%rowtype; preview jsonb; current_profile jsonb; fields jsonb:='[]'; op private.client_intake_operations%rowtype;
  source_date date; current_source_date date;
begin
  perform private.require_intake_authority(p_org,p_branch,p_client,false);
  if not(private.has_permission(p_org,p_branch,'imports.manage') or private.has_routine_intake_access(p_org,p_branch,'cms.preview',p_client)) then raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  select * into source from private.import_upload_completions where id=p_batch and organization_id=p_org and branch_id=p_branch;
  if not found then raise exception using errcode='42501',message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  select * into op from private.client_intake_operations where source_batch_id=p_batch;
  if op.id is not null then perform private.require_intake_authority(p_org,p_branch,op.client_id,false); end if;
  if p_client is not null then current_profile:=private.client_intake_snapshot(p_org,p_branch,p_client); end if;
  source_date:=private.cms_intake_official_date(source.parsed_payload);
  if current_profile->>'sourceBatchId' is not null then
    select private.cms_intake_official_date(parsed_payload) into current_source_date
      from private.import_upload_completions where id=(current_profile->>'sourceBatchId')::uuid;
  end if;
  select coalesce(jsonb_agg(private.cms_intake_preview_field(entry.value) order by entry.ordinality),'[]'::jsonb)
    into fields from jsonb_array_elements(source.parsed_payload->'fields') with ordinality entry(value,ordinality);
  preview:=jsonb_build_object('batchId',source.id,'payloadSha256',source.payload_sha256,
    'mappingVersion',source.parsed_payload->>'mappingVersion','fields',fields,'sections',source.parsed_payload->'sections',
    'warnings',source.parsed_payload->'warnings','conflicts',source.parsed_payload->'conflicts',
    'current',current_profile,'imported',op.id is not null,'importReceipt',op.receipt,
    'sourceReviewRequired',p_client is not null,'sourceOfficialDate',source_date,'currentSourceOfficialDate',current_source_date,
    'sourceIsOlder',coalesce(source_date<current_source_date,false));
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','private.import_upload_completions',p_batch::text,'{}',jsonb_build_object('projection','cms_intake_preview_v1'));
  return preview;
end;
$$;

create or replace function private.find_cms_intake_source(p_org uuid,p_branch uuid,p_file_sha256 text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare reservation private.import_upload_reservations%rowtype; completion private.import_upload_completions%rowtype;
  imported_client uuid; result jsonb;
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not(private.has_permission(p_org,p_branch,'imports.manage') or private.has_routine_intake_access(p_org,p_branch,'cms.preview',null)) then
    raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='INTAKE_INVALID_INPUT'; end if;
  select * into reservation from private.import_upload_reservations where organization_id=p_org and branch_id=p_branch
    and file_sha256=p_file_sha256 and mapping_version='central-care-plan-html@1';
  if found then
    select * into completion from private.import_upload_completions where id=reservation.id;
    select client_id into imported_client from private.client_intake_operations where source_batch_id=reservation.id;
    if imported_client is not null and not(private.can_staff_access_client(imported_client,'clients.read')
      or private.can_executive_read_client(imported_client,'clients.read') or private.can_routine_intake_access_client(imported_client,'clients.read')) then imported_client:=null; end if;
    result:=jsonb_build_object('status',case when completion.id is null then 'queued' else 'completed' end,
      'reservationId',reservation.id,'payloadSha256',completion.payload_sha256,'clientId',imported_client);
  end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','private.import_upload_reservations',reservation.id::text,'{}',
      jsonb_build_object('projection','cms_source_lookup_v1','matched',reservation.id is not null));
  return result;
end;
$$;

create or replace function private.commit_cms_intake(p_org uuid,p_branch uuid,p_operation uuid,p_batch uuid,p_payload_sha256 text,
  p_client uuid,p_expected_version bigint,p_expected_client_version bigint,p_client_code text,p_decisions jsonb,p_source_review_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare source private.import_upload_completions%rowtype; c public.clients%rowtype; v private.client_intake_versions%rowtype;
  op private.client_intake_operations%rowtype; challenge uuid; h text; ih text; p jsonb; authority jsonb:='{}'; f jsonb; decision jsonb;
  target text; value jsonb; identity_value text; result jsonb; touched text[]:='{}'; contact jsonb:='{}';
  source_date date; current_source_date date;
begin
  challenge:=private.require_intake_authority(p_org,p_branch,p_client,true);
  if not private.has_routine_intake_access(p_org,p_branch,'cms.commit',p_client) then perform private.require_import_upload_authority(p_org,p_branch);end if;
  if not(private.has_permission(p_org,p_branch,'imports.approve') or private.has_routine_intake_access(p_org,p_branch,'cms.commit',p_client)) then raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  if p_operation is null or p_batch is null or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
    or p_decisions is null or jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions) not between 2 and 30
    or p_client_code is null or char_length(btrim(p_client_code)) not between 1 and 64
    or (p_client is null and (p_expected_version is not null or p_expected_client_version is not null))
    or (p_source_review_reason is not null and (char_length(btrim(p_source_review_reason)) not between 10 and 1000
      or translate(p_source_review_reason,E'\n\r\t','')~'[[:cntrl:]]')) then
    raise exception using errcode='22023',message='INTAKE_INVALID_INPUT'; end if;
  h:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'batch',p_batch,'payload',p_payload_sha256,
    'client',p_client,'version',p_expected_version,'clientVersion',p_expected_client_version,'clientCode',p_client_code,'decisions',p_decisions,
    'sourceReviewReason',p_source_review_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('intake-operation:'||auth.uid()||':'||p_operation,0));
  select * into op from private.client_intake_operations where actor_user_id=auth.uid() and idempotency_key=p_operation;
  if found then
    if op.request_sha256<>h then raise exception using errcode='23505',message='INTAKE_IDEMPOTENCY_CONFLICT'; end if;
    return op.receipt||jsonb_build_object('replayed',true);
  end if;
  select * into source from private.import_upload_completions where id=p_batch and organization_id=p_org and branch_id=p_branch for update;
  if not found then raise exception using errcode='42501',message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  if source.payload_sha256<>p_payload_sha256 then raise exception using errcode='40001',message='INTAKE_SOURCE_VERSION_CONFLICT'; end if;
  if exists(select 1 from private.client_intake_operations where source_batch_id=p_batch) then
    raise exception using errcode='23505',message='INTAKE_SOURCE_ALREADY_IMPORTED'; end if;
  if source.parsed_payload->>'mappingVersion' is distinct from 'central-care-plan-html@1'
    or exists(select 1 from jsonb_array_elements(source.parsed_payload->'fields') x group by x->>'id' having count(*)<>1)
    or exists(select 1 from jsonb_array_elements(source.parsed_payload->'fields') x where coalesce(x->>'id','')='') then
    raise exception using errcode='22023',message='INTAKE_SOURCE_INVALID'; end if;
  if p_client is not null then
    select * into c from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch for update;
    select * into v from private.client_intake_versions where client_id=c.id order by version desc limit 1;
    if p_expected_version is distinct from coalesce(v.version,0) or p_expected_client_version is distinct from c.row_version then
      raise exception using errcode='40001',message='INTAKE_VERSION_CONFLICT'; end if;
    if p_source_review_reason is null then raise exception using errcode='22023',message='INTAKE_SOURCE_CHRONOLOGY_REVIEW_REQUIRED'; end if;
    source_date:=private.cms_intake_official_date(source.parsed_payload);
    if v.source_batch_id is not null then
      select private.cms_intake_official_date(parsed_payload) into current_source_date
        from private.import_upload_completions where id=v.source_batch_id;
      if source_date is not null and current_source_date is not null and source_date<current_source_date then
        raise exception using errcode='22023',message='INTAKE_SOURCE_OLDER_THAN_CURRENT'; end if;
    end if;
    if c.status not in('active','suspended') then raise exception using errcode='42501',message='INTAKE_CLIENT_CLOSED'; end if;
    p:=coalesce(v.profile,jsonb_build_object('displayName',c.display_name,'clientCode',c.client_code,'dateOfBirth',c.date_of_birth));
    authority:=coalesce(v.field_authority,'{}'::jsonb);
  else p:=jsonb_build_object('clientCode',p_client_code); end if;
  for decision in select x from jsonb_array_elements(p_decisions) x loop
    if jsonb_typeof(decision)<>'object' or exists(select 1 from jsonb_object_keys(decision) x where x not in('fieldId','target','choice'))
      or decision->>'choice' is null or decision->>'choice' not in('use_source','keep_current') then
      raise exception using errcode='22023',message='INTAKE_DECISION_INVALID'; end if;
    select x into f from jsonb_array_elements(source.parsed_payload->'fields') x where x->>'id'=decision->>'fieldId';
    target:=private.cms_intake_field_target(f);
    if f is null or target is null or target is distinct from decision->>'target' or target=any(touched) then
      raise exception using errcode='22023',message='INTAKE_DECISION_INVALID'; end if;
    touched:=array_append(touched,target);
    if target='identityNumber' or decision->>'choice'='use_source' then
      if f->'warnings' is distinct from '[]'::jsonb then raise exception using errcode='22023',message='INTAKE_SOURCE_REVIEW_REQUIRED'; end if;
      value:=private.cms_intake_source_value(target,f->>'normalizedValue');
    end if;
    if target='identityNumber' then identity_value:=value#>>'{}'; end if;
    if decision->>'choice'='keep_current' then
      if p_client is null and target in('displayName','identityNumber') then
        raise exception using errcode='22023',message='INTAKE_DECISION_INVALID'; end if;
      continue;
    end if;
    if starts_with(target,'primaryContact') then
      if p_client is not null and coalesce(p->'contacts','[]'::jsonb)<>'[]'::jsonb then
        raise exception using errcode='42501',message='INTAKE_LOCAL_FIELD_PROTECTED'; end if;
      contact:=contact||jsonb_build_object(case target when 'primaryContactName' then 'name' when 'primaryContactRelationship' then 'relationship'
        when 'primaryContactPhone' then 'phone' else 'address' end,value);
    else
      if p_client is not null and not(target=any(private.intake_central_keys())) and nullif(p->target,'null'::jsonb) is not null
        and p->target<>to_jsonb(''::text) and p->target is distinct from value then
        raise exception using errcode='42501',message='INTAKE_LOCAL_FIELD_PROTECTED'; end if;
      p:=p||jsonb_build_object(target,value); authority:=authority||jsonb_build_object(target,'central');
    end if;
  end loop;
  if identity_value is null or not('displayName'=any(touched)) then
    raise exception using errcode='22023',message='INTAKE_SOURCE_IDENTITY_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements(source.parsed_payload->'fields') field_entry
    where private.cms_intake_field_target(field_entry) is not null and not(private.cms_intake_field_target(field_entry)=any(touched))) then
    raise exception using errcode='22023',message='INTAKE_DECISIONS_INCOMPLETE'; end if;
  ih:=encode(sha256(convert_to(identity_value,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('intake-identity:'||p_org||':'||ih,0));
  if p_client is not null then
    if not exists(select 1 from private.client_intake_identities where client_id=p_client and organization_id=p_org and identity_sha256=ih) then
      raise exception using errcode='42501',message='INTAKE_IDENTITY_MISMATCH'; end if;
    if p_client_code is distinct from c.client_code then raise exception using errcode='42501',message='INTAKE_LOCAL_FIELD_PROTECTED'; end if;
  elsif exists(select 1 from private.client_intake_identities where organization_id=p_org and identity_sha256=ih) then
    raise exception using errcode='23505',message='INTAKE_IDENTITY_ALREADY_EXISTS';
  end if;
  if contact<>'{}'::jsonb then
    if coalesce(contact->>'name','')='' then raise exception using errcode='22023',message='INTAKE_CONTACT_NAME_REQUIRED'; end if;
    p:=p||jsonb_build_object('contacts',jsonb_build_array(contact||jsonb_build_object('isPrimary',true,'isEmergency',false)));
    authority:=authority||jsonb_build_object('contacts','central');
  end if;
  p:=private.validate_intake_profile(p||jsonb_build_object('clientCode',p_client_code));
  if p_client is null then
    insert into public.clients(organization_id,branch_id,client_code,display_name,date_of_birth,status,admitted_on,source_system,source_updated_at)
      values(p_org,p_branch,p->>'clientCode',p->>'displayName',private.intake_date(p->>'dateOfBirth'),'active',null,'central_cms',source.completed_at) returning * into c;
    insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256) values(p_org,p_branch,c.id,ih);
  else
    update public.clients set display_name=p->>'displayName',date_of_birth=private.intake_date(p->>'dateOfBirth'),source_system='central_cms',
      source_updated_at=source.completed_at,row_version=c.row_version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
  for target in select jsonb_object_keys(p) loop
    if not(authority ? target) then authority:=authority||jsonb_build_object(target,'local'); end if;
  end loop;
  insert into private.client_intake_versions(organization_id,branch_id,client_id,version,profile,field_authority,source_batch_id,actor_user_id)
    values(p_org,p_branch,c.id,coalesce(v.version,0)+1,p,authority,p_batch,auth.uid());
  result:=jsonb_build_object('clientId',c.id,'profileVersion',coalesce(v.version,0)+1,'clientRowVersion',c.row_version,
    'pending',c.admitted_on is null,'replayed',false,'formallyImported',true,'batchId',p_batch,'operationId',p_operation);
  insert into private.client_intake_operations(organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_sha256,operation_kind,
    reauth_challenge_id,source_batch_id,source_payload_sha256,source_review_reason,decisions,receipt)
    values(p_org,p_branch,c.id,auth.uid(),p_operation,h,'commit_cms',challenge,p_batch,p_payload_sha256,p_source_review_reason,p_decisions,result);
  perform private.require_intake_authority(p_org,p_branch,c.id,true);
  if not private.has_routine_intake_access(p_org,p_branch,'cms.commit',c.id) then perform private.require_import_upload_authority(p_org,p_branch);end if;
  return result;
end;
$$;

create or replace function private.save_client_weekly_guarded(p_organization_id uuid,p_branch_id uuid,p_input jsonb)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_client uuid; v_key uuid; v_action text; v_date date; v_until date; v_plan jsonb;
 v_expected integer; v_version integer; v_hash text; v_prior private.client_weekly_operations; v_latest date;
 v_id uuid; v_receipt jsonb; v_today date:=(now() at time zone 'Asia/Taipei')::date;
begin
 if v_actor is null or (not private.has_routine_intake_permission(p_organization_id,p_branch_id,'staff_scheduling.manage') and (not private.has_permission(p_organization_id,p_branch_id,'clients.read')
 or not private.has_permission(p_organization_id,p_branch_id,'staff_scheduling.manage') or not private.has_recent_aal2(15)))
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 then raise exception using errcode='42501',message='weekly plan modification denied'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&array['action','clientId','expectedVersion','idempotency_key'])
 or jsonb_typeof(p_input->'action') is distinct from 'string' or p_input->>'action' not in ('save_plan','save_exception')
 or jsonb_typeof(p_input->'clientId') is distinct from 'string' or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string'
 or jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or (p_input->>'expectedVersion')!~'^[0-9]{1,7}$'
 then raise exception using errcode='22023',message='invalid weekly input'; end if;
 v_client:=(p_input->>'clientId')::uuid; v_key:=(p_input->>'idempotency_key')::uuid; v_action:=p_input->>'action'; v_expected:=(p_input->>'expectedVersion')::integer;
 if v_expected>1000000 or not exists(select 1 from public.clients c where c.id=v_client and c.organization_id=p_organization_id and c.branch_id=p_branch_id)
 or not(private.can_staff_access_client(v_client,'clients.read') or private.has_routine_intake_access(p_organization_id,p_branch_id,'weekly.write',v_client)) then raise exception using errcode='42501',message='client outside weekly scope'; end if;
 if v_action='save_plan' then
  if p_input-array['action','clientId','expectedVersion','idempotency_key','plan']<>'{}'::jsonb or jsonb_typeof(p_input->'plan') is distinct from 'object' then raise exception using errcode='22023',message='invalid weekly plan'; end if;
  v_plan:=p_input->'plan';
  if not(v_plan?&array['effectiveFrom','effectiveTo','days','reason']) or v_plan-array['effectiveFrom','effectiveTo','days','reason']<>'{}'::jsonb
  or jsonb_typeof(v_plan->'effectiveFrom') is distinct from 'string' or jsonb_typeof(v_plan->'effectiveTo') not in ('string','null')
  or (v_plan->>'effectiveFrom')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or (v_plan->>'effectiveTo')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(v_plan->'days') is distinct from 'array' or jsonb_array_length(v_plan->'days')<>7
  or jsonb_typeof(v_plan->'reason') is distinct from 'string' or char_length(btrim(v_plan->>'reason')) not between 3 and 300 or (v_plan->>'reason')~'[[:cntrl:]]'
  then raise exception using errcode='22023',message='invalid weekly plan'; end if;
  if exists(select 1 from jsonb_array_elements(v_plan->'days') d where not private.validate_client_weekly_day(d))
  or (select count(distinct d->>'weekday') from jsonb_array_elements(v_plan->'days') d)<>7 then raise exception using errcode='22023',message='invalid weekly days'; end if;
  v_date:=(v_plan->>'effectiveFrom')::date; v_until:=(v_plan->>'effectiveTo')::date;
  if to_char(v_date,'YYYY-MM-DD')<>v_plan->>'effectiveFrom' or (v_until is not null and (to_char(v_until,'YYYY-MM-DD')<>v_plan->>'effectiveTo' or v_until<v_date)) then raise exception using errcode='22023',message='invalid effective dates'; end if;
 else
  if not(p_input?&array['serviceDate','day','reason']) or p_input-array['action','clientId','expectedVersion','idempotency_key','serviceDate','day','reason']<>'{}'::jsonb
  or jsonb_typeof(p_input->'serviceDate') is distinct from 'string' or (p_input->>'serviceDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_input->'reason') is distinct from 'string' or char_length(btrim(p_input->>'reason')) not between 3 and 300 or (p_input->>'reason')~'[[:cntrl:]]'
  or not private.validate_client_weekly_day(p_input->'day') then raise exception using errcode='22023',message='invalid daily exception'; end if;
  v_date:=(p_input->>'serviceDate')::date;
  if to_char(v_date,'YYYY-MM-DD')<>p_input->>'serviceDate' or extract(isodow from v_date)::integer<>(p_input->'day'->>'weekday')::integer then raise exception using errcode='22023',message='date and weekday mismatch'; end if;
 end if;
 -- Replays are checked before temporal cutoffs, so retrying an acknowledged prior-day operation is safe.
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch_id,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||v_actor::text||v_key::text,0));
 select * into v_prior from private.client_weekly_operations where organization_id=p_organization_id and actor_id=v_actor and idempotency_key=v_key;
 if found then
  if v_prior.input_hash<>v_hash then raise exception using errcode='23505',message='weekly operation conflict'; end if;
  return query select v_prior.receipt||jsonb_build_object('replayed',true); return;
 end if;
 if v_date<v_today or v_date>v_today+366 then raise exception using errcode='22023',message='new weekly intent must start today or within one year'; end if;
 perform pg_advisory_xact_lock(hashtextextended('client-weekly:'||v_client::text,0));
 if v_action='save_plan' then
  select coalesce(max(version),0),max(effective_from) into v_version,v_latest from private.client_weekly_versions where client_id=v_client;
  if v_latest>v_date then raise exception using errcode='22023',message='weekly effective date cannot precede latest version'; end if;
 else
  select coalesce(max(version),0) into v_version from private.client_weekly_exceptions where client_id=v_client and service_date=v_date;
 end if;
 if v_expected<>v_version then raise exception using errcode='40001',message='weekly version changed'; end if;
 if v_action='save_plan' then
  insert into private.client_weekly_versions(organization_id,branch_id,client_id,version,effective_from,effective_to,plan,created_by)
  values(p_organization_id,p_branch_id,v_client,v_version+1,v_date,v_until,v_plan,v_actor) returning id into v_id;
 else
  insert into private.client_weekly_exceptions(organization_id,branch_id,client_id,service_date,version,day,reason,created_by)
  values(p_organization_id,p_branch_id,v_client,v_date,v_version+1,p_input->'day',btrim(p_input->>'reason'),v_actor) returning id into v_id;
 end if;
 v_receipt:=jsonb_build_object('id',v_id,'clientId',v_client,'action',v_action,'version',v_version+1,'replayed',false,'persisted',true);
 insert into private.client_weekly_operations values(p_organization_id,v_actor,v_key,v_hash,v_receipt);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,v_actor,'insert',case when v_action='save_plan' then 'client_weekly_versions' else 'client_weekly_exceptions' end,v_id::text,array['version'],jsonb_build_object('version',v_version+1));
 return query select v_receipt;
end; $$;

create or replace function private.client_weekly_projection_guarded(p_organization_id uuid,p_branch_id uuid,p_date date)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_rows jsonb; v_count integer;
begin
 if auth.uid() is null or p_date is null or p_date<'2000-01-01' or p_date>'2100-01-01'
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 or not(private.has_permission(p_organization_id,p_branch_id,'clients.read') or private.has_executive_read_permission(p_organization_id,p_branch_id,'clients.read') or private.has_routine_intake_permission(p_organization_id,p_branch_id,'clients.read'))
 then raise exception using errcode='42501',message='weekly projection denied'; end if;
 select count(*) into v_count from public.clients c where c.organization_id=p_organization_id and c.branch_id=p_branch_id and private.care_roster_can_read(c.id,'clients.read');
 if v_count>500 then raise exception using errcode='54000',message='weekly projection scope exceeds limit'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('clientId',c.id,'day',private.client_weekly_days(c.id,p_date,1)->0) order by c.id),'[]') into v_rows
 from public.clients c where c.organization_id=p_organization_id and c.branch_id=p_branch_id and private.care_roster_can_read(c.id,'clients.read');
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,auth.uid(),'select','client_weekly_projection',p_branch_id::text,array['bounded_projection'],jsonb_build_object('row_count',v_count));
 return query select jsonb_build_object('serviceDate',p_date,'generatedAt',now(),'rows',v_rows,'evidenceKind','planned_not_attended','transportStatus','unassigned_demand');
end; $$;

create or replace function private.reserve_intake_import_upload(
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
  if not private.has_routine_intake_access(p_expected_organization_id,p_expected_branch_id,'cms.stage',null) then raise exception using errcode='42501',message='INTAKE_GOOGLE_ACTION_DENIED';end if;
  v_challenge := null;
  v_session := (auth.jwt() ->> 'session_id')::uuid;
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


create function public.reserve_intake_import_upload(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_idempotency_key uuid,
 p_file_sha256 text,p_file_name text,p_mime_type text,p_file_size_bytes integer,p_mapping_version text
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.reserve_intake_import_upload(p_expected_organization_id,p_expected_branch_id,p_idempotency_key,p_file_sha256,p_file_name,p_mime_type,p_file_size_bytes,p_mapping_version);
$$;
revoke all on function private.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text),
 public.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text),
 public.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text) to authenticated;

create function private.intake_client_directory(p_org uuid,p_branch uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; visible_count integer;
begin
 perform private.require_intake_authority(p_org,p_branch,null,false);
 select count(*) into visible_count from public.clients c where c.organization_id=p_org and c.branch_id=p_branch
 and (private.can_staff_access_client(c.id,'clients.demographics.read') or private.can_routine_intake_access_client(c.id,'clients.demographics.read'));
 if visible_count>500 then raise exception using errcode='54000',message='intake client directory limit';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'displayName',c.display_name,'clientCode',c.client_code) order by c.client_code,c.id),'[]')
 into result from public.clients c where c.organization_id=p_org and c.branch_id=p_branch
 and (private.can_staff_access_client(c.id,'clients.demographics.read') or private.can_routine_intake_access_client(c.id,'clients.demographics.read'));
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
 values(p_org,p_branch,auth.uid(),'select','intake_client_directory',jsonb_build_object('row_count',visible_count));
 return result;
end;$$;
create function public.intake_client_directory(p_org uuid,p_branch uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.intake_client_directory(p_org,p_branch);$$;
revoke all on function private.intake_client_directory(uuid,uuid),public.intake_client_directory(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.intake_client_directory(uuid,uuid),public.intake_client_directory(uuid,uuid) to authenticated;
commit;
