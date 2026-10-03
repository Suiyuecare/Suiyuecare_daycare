-- Keep the selector complete while loading answer payloads for only the
-- explicitly selected, authorized client. Repeated assessments are separate
-- assessment_key chains; choose one terminal version deterministically.
create or replace function private.questionnaire_assessment_snapshot_guarded(
  p_org uuid, p_branch uuid, p_form_key text, p_client uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_form_key not in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf')
    or not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode = '42501', message = 'questionnaire snapshot is not permitted';
  end if;

  with visible_clients as materialized (
    select c.id as client_id,c.display_name,c.status
    from public.clients c
    where c.organization_id=p_org and c.branch_id=p_branch
      and c.status in ('active','suspended')
      and (private.questionnaire_assessment_permission(p_org,p_branch,'clients.view_all') or exists (
        select 1 from public.client_assignments a where a.client_id=c.id and a.organization_id=p_org
          and a.branch_id=p_branch and a.assignee_user_id=auth.uid() and a.starts_at<=clock_timestamp()
          and (a.ends_at is null or a.ends_at>clock_timestamp())))
  ), terminal_versions as materialized (
    select distinct on (v.assessment_key) v.*
    from public.questionnaire_assessment_versions v
    join visible_clients c on c.client_id=v.client_id
    where p_client is not null and v.client_id=p_client
      and v.organization_id=p_org and v.branch_id=p_branch and v.form_key=p_form_key
    order by v.assessment_key,v.version desc
  ), selected_latest as materialized (
    select * from terminal_versions
    order by assessed_on desc,created_at desc,assessment_key,version desc
    limit 1
  )
  select jsonb_build_object(
    'formKey',p_form_key,'generatedAt',clock_timestamp(),
    'clients',(select coalesce(jsonb_agg(jsonb_build_object(
      'clientId',c.client_id,'displayName',c.display_name,'serviceStatus',c.status,
      'latest',case when c.client_id=p_client then (select jsonb_build_object(
        'assessmentKey',l.assessment_key,'versionId',l.id,'version',l.version,
        'formVersion',l.form_version,'assessedOn',l.assessed_on,'answers',l.answers,'context',l.context,
        'recordState',l.record_state,'authorDisplayName',l.author_display_name,'createdAt',l.created_at,
        'contentHash',l.content_hash) from selected_latest l) else null end
    ) order by c.display_name collate "C",c.client_id),'[]'::jsonb) from visible_clients c),
    'matchingTotal',(select count(*) from visible_clients)) into v_result;

  -- Authority validates tenant and assignment; the selector additionally
  -- excludes ended clients. Never accept a selected ID absent from its roster.
  if p_client is not null and not exists (
    select 1 from jsonb_array_elements(v_result->'clients') item
    where item->>'clientId'=p_client::text
  ) then
    raise exception using errcode = '42501', message = 'questionnaire client is not selectable';
  end if;

  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_assessment_versions','snapshot',array[]::text[],
    jsonb_build_object('workflow','questionnaire_assessment_snapshot_v2','form_key',p_form_key,
      'row_count',coalesce(jsonb_array_length(v_result->'clients'),0),
      'answers_excluded',p_client is null,
      'answer_scope',case when p_client is null then 'none' else 'selected_client_only' end));
  return v_result;
end;
$$;
