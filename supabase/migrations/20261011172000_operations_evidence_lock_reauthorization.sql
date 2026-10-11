-- Do not accept a stale authorization decision after an advisory lock wait.
-- Preserve the existing scope, recent AAL2, independent reviewer, immutable
-- evidence and hash/CAS rules; repeat exact admission before reads/replays/writes.
begin;
set local lock_timeout='5s';

create or replace function private.quality_monthly_freeze(p_org uuid,p_branch uuid,p_month text,p_expected_hash text,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_payload jsonb;v_hash text;v_request_hash text;v_saved private.quality_monthly_snapshots;
begin
 if not private.quality_monthly_authorized(p_org,p_branch) or not private.has_operations_evidence_permission(p_org,p_branch,'quality_monthly.export')
 or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='quality freeze denied';end if;
 if p_key is null or p_month is null or p_month!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_expected_hash is null or p_expected_hash!~'^[a-f0-9]{64}$' then
 raise exception using errcode='22023',message='invalid snapshot request';end if;
 v_request_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'month',p_month,'expected',p_expected_hash)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 if not private.quality_monthly_authorized(p_org,p_branch) or not private.has_operations_evidence_permission(p_org,p_branch,'quality_monthly.export') or private.data_inventory_reauth() is null then
  raise exception using errcode='42501',message='quality freeze denied after lock';end if;
 select * into v_saved from private.quality_monthly_snapshots where actor_user_id=auth.uid() and idempotency_key=p_key;
 if found then
  if v_saved.request_hash<>v_request_hash then raise exception using errcode='23505',message='idempotency conflict';end if;
  return v_saved.payload||jsonb_build_object('hash',v_saved.payload_hash,'generatedAt',v_saved.created_at,'snapshotId',v_saved.id);
 end if;
 v_payload:=private.quality_monthly_payload(p_org,p_branch,p_month);
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 if v_hash<>p_expected_hash then raise exception using errcode='40001',message='monthly data changed';end if;
 if exists(select 1 from jsonb_array_elements(v_payload->'metrics')m where jsonb_array_length(m->'numeratorItems')>25000 or jsonb_array_length(m->'denominatorItems')>25000) then
  raise exception using errcode='54000',message='monthly detail capacity exceeded';end if;
 insert into private.quality_monthly_snapshots(organization_id,branch_id,month,payload,payload_hash,actor_user_id,idempotency_key,request_hash)
 values(p_org,p_branch,p_month,v_payload,v_hash,auth.uid(),p_key,v_request_hash) returning * into v_saved;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'insert','quality_monthly_snapshots',v_saved.id::text,array[]::text[],jsonb_build_object('month',p_month,'rule_version','organization.quality-monthly-v1'));
 return v_payload||jsonb_build_object('hash',v_hash,'generatedAt',v_saved.created_at,'snapshotId',v_saved.id);
end;$$;

create or replace function private.evaluation_evidence_review(p_org uuid,p_branch uuid,p_version uuid,p_decision text,p_reason text,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_version private.evaluation_preparation_versions;v_old private.evaluation_evidence_reviews;v_evidence jsonb;v_hash text;v_payload jsonb;
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='evidence review denied';end if;
 if p_key is null or p_version is null or p_decision not in ('approved','needs_changes') or p_decision is null
 or p_reason is null or p_reason not in ('review_complete','evidence_missing','source_not_verified','incomplete')
 or ((p_decision='approved')<>(p_reason='review_complete')) then raise exception using errcode='22023',message='invalid review';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text,7902));
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then
  raise exception using errcode='42501',message='evidence review denied after lock';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'version',p_version,'decision',p_decision,'reason',p_reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,79));
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then
  raise exception using errcode='42501',message='evidence review denied after lock';end if;
 select * into v_old from private.evaluation_evidence_reviews where reviewer_user_id=auth.uid() and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='23505',message='review idempotency conflict';end if;
 else
  select * into v_version from private.evaluation_preparation_versions where id=p_version and organization_id=p_org and branch_id=p_branch;
  if not found then raise exception using errcode='42501',message='review version out of scope';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text||':'||v_version.item_code,79));
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then
  raise exception using errcode='42501',message='evidence review denied after lock';end if;
  if exists(select 1 from private.evaluation_preparation_versions where organization_id=p_org and branch_id=p_branch and item_code=v_version.item_code and version>v_version.version)
   or exists(select 1 from private.evaluation_evidence_reviews where version_id=p_version) then raise exception using errcode='40001',message='review version changed';end if;
  if auth.uid()=v_version.recorded_by or auth.uid()=v_version.owner_user_id then raise exception using errcode='42501',message='independent reviewer required';end if;
  if v_version.progress<>'internal_review_requested' then raise exception using errcode='23514',message='review not requested';end if;
  if p_decision='approved' then v_evidence:=private.evaluation_evidence_resolve(p_org,p_branch,v_version.evidence_reference);end if;
  v_payload:=jsonb_build_object('versionId',p_version,'versionHash',v_version.content_hash,'reviewerUserId',auth.uid(),'decision',p_decision,'reasonCode',p_reason,'evidence',v_evidence);
  insert into private.evaluation_evidence_reviews(organization_id,branch_id,version_id,reviewer_user_id,decision,reason_code,evidence,content_hash,idempotency_key,request_hash)
  values(p_org,p_branch,p_version,auth.uid(),p_decision,p_reason,v_evidence,encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),p_key,v_hash) returning * into v_old;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
  values(p_org,p_branch,auth.uid(),'insert','evaluation_evidence_reviews',v_old.id::text,jsonb_build_object('decision',p_decision,'version_id',p_version));
 end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'idempotencyKey',p_key,
 'reviewId',v_old.id,'versionId',v_old.version_id,'decision',v_old.decision,'formalSubmissionEnabled',false);
end;$$;

create or replace function private.evaluation_evidence_bundle(p_org uuid,p_branch uuid,p_expected_hash text,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_state jsonb;v_hash text;v_request_hash text;v_old private.evaluation_evidence_bundles;v_item jsonb;v_evidence jsonb;
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='bundle denied';end if;
 if p_key is null or p_expected_hash is null or p_expected_hash!~'^[a-f0-9]{64}$' then raise exception using errcode='22023',message='invalid bundle';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text,7902));
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then
  raise exception using errcode='42501',message='bundle denied after lock';end if;
 v_request_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'expected',p_expected_hash)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,7901));
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then
  raise exception using errcode='42501',message='bundle denied after lock';end if;
 select * into v_old from private.evaluation_evidence_bundles where actor_user_id=auth.uid() and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_request_hash then raise exception using errcode='23505',message='bundle idempotency conflict';end if;
 else
  v_state:=private.evaluation_evidence_state(p_org,p_branch);
  v_hash:=encode(sha256(convert_to(v_state::text,'UTF8')),'hex');
  if v_hash<>p_expected_hash then raise exception using errcode='40001',message='evidence collection changed';end if;
  if (v_state->>'total')::integer=0 or (v_state->>'total')::integer<>(v_state->>'approved')::integer or (v_state->>'total')::integer>2500 then raise exception using errcode='23514',message='bundle has unresolved items';end if;
  -- Re-check current scope, scanner verdict and exact evidence version. Never
  -- grant access merely because another reviewer saw it earlier.
  for v_item in select value from jsonb_array_elements(v_state->'items') loop
   v_evidence:=private.evaluation_evidence_resolve(p_org,p_branch,(v_item#>>'{version,evidenceReference}')::uuid);
   if v_evidence is distinct from v_item#>'{review,evidence}' then raise exception using errcode='40001',message='reviewed evidence changed';end if;
  end loop;
  insert into private.evaluation_evidence_bundles(organization_id,branch_id,payload,payload_hash,actor_user_id,idempotency_key,request_hash)
  values(p_org,p_branch,v_state,v_hash,auth.uid(),p_key,v_request_hash) returning * into v_old;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
  values(p_org,p_branch,auth.uid(),'insert','evaluation_evidence_bundles',v_old.id::text,jsonb_build_object('item_count',v_state->'total','official_submission',false));
 end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'idempotencyKey',p_key,'bundleId',v_old.id,'hash',v_old.payload_hash,'formalSubmissionEnabled',false);
end;$$;

commit;
