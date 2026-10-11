
begin;
set local lock_timeout='5s';

create function private.questionnaire_rule_governance_authority(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.questionnaire_assessment_authority(p_org,p_branch,null,'spmsq','read')
  and private.questionnaire_assessment_permission(p_org,p_branch,'forms.manage');
$$;

create function private.questionnaire_rule_publication_guarded(p_org uuid,p_branch uuid,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); action text; publication private.questionnaire_rule_publications%rowtype;
 catalog private.questionnaire_form_catalog%rowtype; challenge uuid; form text; version text;
 start_date date; end_date date; evidence text; fingerprint text; publication_id uuid;
begin
 if not private.questionnaire_rule_governance_authority(p_org,p_branch) then
  raise exception using errcode='42501',message='questionnaire rule governance not authorized'; end if;
 challenge:=private.questionnaire_reauth();
 if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception using errcode='22023',message='invalid rule publication payload'; end if;
 action:=p_payload->>'action';
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'payload',p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-publication-operation:'||actor||':'||p_key,0));
 if action='request' then
  if p_payload-array['action','form_key','form_version','effective_from','effective_to','evidence_reference']<>'{}'::jsonb then
   raise exception using errcode='22023',message='invalid rule publication fields'; end if;
  form:=p_payload->>'form_key'; version:=p_payload->>'form_version'; evidence:=btrim(p_payload->>'evidence_reference');
  if evidence is null or length(evidence) not between 1 and 300 or evidence~'[[:cntrl:]]' then
   raise exception using errcode='22023',message='publication evidence reference required'; end if;
  begin start_date:=(p_payload->>'effective_from')::date; end_date:=nullif(p_payload->>'effective_to','')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
   raise exception using errcode='22023',message='invalid publication dates'; end;
  if start_date is null or start_date<date '1900-01-01' or start_date>date '2200-12-31'
   or (end_date is not null and (end_date<start_date or end_date>date '2200-12-31')) then
   raise exception using errcode='22023',message='invalid publication dates'; end if;
  select * into catalog from private.questionnaire_form_catalog where form_key=form and form_version=version;
  if not found then raise exception using errcode='22023',message='unknown immutable form rule catalogue'; end if;
  select * into publication from private.questionnaire_rule_publications where requested_by=actor and request_key=p_key;
  if found then
   if publication.request_hash<>fingerprint then raise exception using errcode='23505',message='publication key reused'; end if;
   return jsonb_build_object('publicationId',publication.id,'status',case when publication.approved_by is null then 'pending' else 'approved' end,'replayed',true);
  end if;
  insert into private.questionnaire_rule_publications(organization_id,branch_id,form_key,form_version,catalog_hash,
   effective_from,effective_to,evidence_reference,requested_by,requested_reauth,request_key,request_hash)
  values(p_org,p_branch,form,version,catalog.catalog_hash,start_date,end_date,evidence,actor,challenge,p_key,fingerprint)
  returning * into publication;
 elsif action='approve' then
  if p_payload-array['action','publication_id']<>'{}'::jsonb then
   raise exception using errcode='22023',message='invalid publication approval fields'; end if;
  begin publication_id:=(p_payload->>'publication_id')::uuid;
  exception when invalid_text_representation then raise exception using errcode='22023',message='invalid publication ID'; end;
  select * into publication from private.questionnaire_rule_publications where id=publication_id and organization_id=p_org and branch_id=p_branch;
  if not found then raise exception using errcode='42501',message='publication not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended('questionnaire-publication-scope:'||p_org||':'||p_branch||':'||publication.form_key,0));
  select * into publication from private.questionnaire_rule_publications where id=publication_id for update;
  if publication.requested_by=actor then raise exception using errcode='42501',message='independent rule approver required'; end if;
  if publication.approved_by is not null then
   if publication.approved_by=actor and publication.approval_key=p_key and publication.approval_hash=fingerprint then
    return jsonb_build_object('publicationId',publication.id,'status','approved','replayed',true);
   end if;
   raise exception using errcode='55000',message='rule publication already immutable';
  end if;
  if exists(select 1 from private.questionnaire_rule_publications p where p.approved_by=actor and p.approval_key=p_key) then
   raise exception using errcode='23505',message='publication key reused'; end if;
  if exists(select 1 from private.questionnaire_rule_publications p where p.organization_id=p_org and p.branch_id=p_branch
   and p.form_key=publication.form_key and p.approved_by is not null
   and daterange(p.effective_from,p.effective_to,'[]')&&daterange(publication.effective_from,publication.effective_to,'[]')) then
   raise exception using errcode='23P01',message='approved questionnaire rule periods overlap'; end if;
  if not exists(select 1 from private.questionnaire_form_catalog c where c.form_key=publication.form_key
   and c.form_version=publication.form_version and c.catalog_hash=publication.catalog_hash) then
   raise exception using errcode='55000',message='catalogue identity changed'; end if;
  update private.questionnaire_rule_publications set approved_by=actor,approved_at=clock_timestamp(),approved_reauth=challenge,
   approval_key=p_key,approval_hash=fingerprint where id=publication.id returning * into publication;
 else raise exception using errcode='22023',message='invalid publication action'; end if;
 if not private.questionnaire_rule_governance_authority(p_org,p_branch) or private.questionnaire_reauth() is null then
  raise exception using errcode='42501',message='rule governance authority expired'; end if;
 return jsonb_build_object('publicationId',publication.id,'status',case when publication.approved_by is null then 'pending' else 'approved' end,'replayed',false);
end; $$;

create function private.questionnaire_rule_governance_snapshot_guarded(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.questionnaire_rule_governance_authority(p_org,p_branch) then
  raise exception using errcode='42501',message='rule governance snapshot not authorized'; end if;
 select jsonb_build_object('generatedAt',clock_timestamp(),'catalogue',coalesce((select jsonb_agg(jsonb_build_object(
  'formKey',c.form_key,'formVersion',c.form_version,'catalogHash',c.catalog_hash,
  'title',c.form_snapshot->>'title','questionCount',jsonb_array_length(c.form_snapshot->'questions'),
  'sources',c.rule_snapshot->'sources','rule',c.rule_snapshot) order by c.form_key)
  from private.questionnaire_form_catalog c),'[]'::jsonb),'publications',coalesce((select jsonb_agg(jsonb_build_object(
  'publicationId',p.id,'formKey',p.form_key,'formVersion',p.form_version,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to,
  'evidenceReference',p.evidence_reference,'requestedAt',p.requested_at,'requestedBy',p.requested_by,
  'requestedName',requestor.display_name,'approvedAt',p.approved_at,'approvedName',approver.display_name,
  'canApprove',p.requested_by<>auth.uid() and p.approved_by is null,
  'status',case when p.approved_by is null then 'pending' else 'approved' end) order by p.requested_at desc)
  from (select * from private.questionnaire_rule_publications where organization_id=p_org and branch_id=p_branch order by requested_at desc,id desc limit 100) p
  join public.profiles requestor on requestor.id=p.requested_by left join public.profiles approver on approver.id=p.approved_by),'[]'::jsonb)) into result;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','questionnaire_rule_publications','snapshot',array[]::text[],jsonb_build_object('workflow','questionnaire_rule_governance_v1'));
 if not private.questionnaire_rule_governance_authority(p_org,p_branch) then
  raise exception using errcode='42501',message='rule governance authority expired'; end if;
 return result;
end; $$;

create function public.questionnaire_rule_governance_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.questionnaire_rule_governance_snapshot_guarded(p_expected_organization_id,p_expected_branch_id);
$$;
create function public.publish_questionnaire_rule(p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.questionnaire_rule_publication_guarded(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key);
$$;
revoke all on function private.questionnaire_rule_governance_authority(uuid,uuid),
 private.questionnaire_rule_publication_guarded(uuid,uuid,jsonb,uuid),private.questionnaire_rule_governance_snapshot_guarded(uuid,uuid),
 public.questionnaire_rule_governance_snapshot(uuid,uuid),public.publish_questionnaire_rule(uuid,uuid,jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.questionnaire_rule_publication_guarded(uuid,uuid,jsonb,uuid),
 private.questionnaire_rule_governance_snapshot_guarded(uuid,uuid),public.questionnaire_rule_governance_snapshot(uuid,uuid),
 public.publish_questionnaire_rule(uuid,uuid,jsonb,uuid) to authenticated;
commit;
