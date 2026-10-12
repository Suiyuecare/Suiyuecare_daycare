
begin;
set local lock_timeout='5s';
create function private.questionnaire_version_json(p_version public.questionnaire_assessment_versions,p_latest boolean)
returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('assessmentKey',p_version.assessment_key,'versionId',p_version.id,'version',p_version.version,
  'formVersion',p_version.form_version,'assessedOn',p_version.assessed_on,'answers',p_version.answers,'context',p_version.context,
  'recordState',p_version.record_state,'authorDisplayName',p_version.author_display_name,'createdAt',p_version.created_at,
  'contentHash',p_version.content_hash,'isLatest',p_latest,'correctionOfVersionId',p_version.correction_of_version_id,
  'changeReason',p_version.change_reason,'followUpDueOn',p_version.follow_up_due_on,
  'signedAt',p_version.signed_at,'signerDisplayName',p_version.signer_display_name,
  'formSnapshot',coalesce(p_version.form_snapshot,(select c.form_snapshot from private.questionnaire_form_catalog c where c.form_key=p_version.form_key and c.form_version=p_version.form_version)),
  'resultSnapshot',case when p_version.record_state='signed' then p_version.result_snapshot else null end,
  'ruleAvailable',private.questionnaire_rule_authority(p_version.organization_id,p_version.branch_id,p_version.form_key,p_version.form_version,p_version.assessed_on) is not null);
$$;
create function private.questionnaire_workspace_snapshot_guarded(p_org uuid,p_branch uuid,p_form text,p_client uuid,
 p_version uuid,p_month date,p_new boolean,p_history_page integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; selected public.questionnaire_assessment_versions%rowtype; history jsonb; history_count integer; is_latest boolean;
begin
 if p_history_page is null or p_history_page not between 1 and 1000000 or p_new is null
  or (p_version is not null and (p_new or p_client is null))
  or (p_month is not null and (p_month<>date_trunc('month',p_month)::date or p_month<date '1900-01-01' or p_month>date '2200-12-01')) then
  raise exception using errcode='22023',message='invalid questionnaire history selection'; end if;
 -- Existing guarded selector proves admission, org/branch, page permissions and assignment.
 result:=private.questionnaire_assessment_snapshot_guarded(p_org,p_branch,p_form,p_client);
 if p_client is not null then
  if p_version is not null then
   select * into selected from public.questionnaire_assessment_versions where id=p_version and organization_id=p_org
    and branch_id=p_branch and client_id=p_client and form_key=p_form;
   if not found or (p_month is not null and date_trunc('month',selected.assessed_on)::date<>p_month) then
    raise exception using errcode='42501',message='questionnaire history version not authorized'; end if;
  elsif not p_new then
   select * into selected from public.questionnaire_assessment_versions v where v.organization_id=p_org and v.branch_id=p_branch
    and v.client_id=p_client and v.form_key=p_form
    and (p_month is null or date_trunc('month',v.assessed_on)::date=p_month)
    and not exists(select 1 from public.questionnaire_assessment_versions next where next.previous_version_id=v.id)
   order by v.assessed_on desc,v.created_at desc,v.assessment_key,v.version desc limit 1;
  end if;
  is_latest:=selected.id is not null and not exists(select 1 from public.questionnaire_assessment_versions where previous_version_id=selected.id);
  select coalesce(jsonb_agg(case when item->>'clientId'=p_client::text then item||jsonb_build_object('latest',
   case when selected.id is null then null else private.questionnaire_version_json(selected,is_latest) end) else item end),'[]'::jsonb)
  into history from jsonb_array_elements(result->'clients') item;
  result:=jsonb_set(result,'{clients}',history);
  select count(*) into history_count from public.questionnaire_assessment_versions v
   where v.organization_id=p_org and v.branch_id=p_branch and v.client_id=p_client and v.form_key=p_form
   and not exists(select 1 from public.questionnaire_assessment_versions next where next.previous_version_id=v.id);
  select coalesce(jsonb_agg(jsonb_build_object('assessmentKey',v.assessment_key,'versionId',v.id,'version',v.version,
   'assessedOn',v.assessed_on,'recordState',v.record_state,'authorDisplayName',v.author_display_name,
   'followUpDueOn',v.follow_up_due_on,'signedAt',v.signed_at,'correctionOfVersionId',v.correction_of_version_id,
   'versions',(select jsonb_agg(jsonb_build_object('versionId',old.id,'version',old.version,'recordState',old.record_state,'createdAt',old.created_at) order by old.version desc)
    from (select * from public.questionnaire_assessment_versions old where old.assessment_key=v.assessment_key
     and old.organization_id=p_org and old.branch_id=p_branch and old.client_id=p_client and old.form_key=p_form
     order by old.version desc limit 20) old))
   order by v.assessed_on desc,v.created_at desc,v.id),'[]'::jsonb) into history from (
   select v.* from public.questionnaire_assessment_versions v where v.organization_id=p_org and v.branch_id=p_branch
    and v.client_id=p_client and v.form_key=p_form
    and not exists(select 1 from public.questionnaire_assessment_versions next where next.previous_version_id=v.id)
   order by v.assessed_on desc,v.created_at desc,v.id limit 10 offset (p_history_page-1)*10) v;
 else history:='[]'::jsonb; history_count:=0; end if;
 if not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form,'read') then
  raise exception using errcode='42501',message='questionnaire read authority expired'; end if;
 return result||jsonb_build_object('history',history,'historyTotal',history_count,'historyPage',p_history_page,
  'canSign',p_client is not null and private.questionnaire_sign_authority(p_org,p_branch,p_client,p_form),
  'selection',jsonb_build_object('versionId',p_version,'month',case when p_month is null then null else to_char(p_month,'YYYY-MM') end,'newAssessment',p_new));
end; $$;
create function public.questionnaire_assessment_workspace_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,
 p_form_key text,p_client_id uuid default null,p_version_id uuid default null,p_month date default null,
 p_new_assessment boolean default false,p_history_page integer default 1)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.questionnaire_workspace_snapshot_guarded(p_expected_organization_id,p_expected_branch_id,p_form_key,p_client_id,
  p_version_id,p_month,p_new_assessment,p_history_page);
$$;
revoke all on function private.questionnaire_version_json(public.questionnaire_assessment_versions,boolean),
 private.questionnaire_workspace_snapshot_guarded(uuid,uuid,text,uuid,uuid,date,boolean,integer),
 public.questionnaire_assessment_workspace_snapshot(uuid,uuid,text,uuid,uuid,date,boolean,integer)
 from public,anon,authenticated,service_role;
grant execute on function private.questionnaire_workspace_snapshot_guarded(uuid,uuid,text,uuid,uuid,date,boolean,integer),
 public.questionnaire_assessment_workspace_snapshot(uuid,uuid,text,uuid,uuid,date,boolean,integer) to authenticated;
commit;
