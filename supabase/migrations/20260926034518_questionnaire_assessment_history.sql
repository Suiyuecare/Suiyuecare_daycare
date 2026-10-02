begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Read-only additions for the existing unsigned questionnaire ledger. No
-- mutation, admission, clinical qualification, or signing policy is changed.
create function private.questionnaire_assessment_json(v public.questionnaire_assessment_versions)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('assessmentKey',v.assessment_key,'versionId',v.id,'version',v.version,
    'formVersion',v.form_version,'assessedOn',v.assessed_on,'answers',v.answers,'context',v.context,
    'recordState',v.record_state,'authorDisplayName',v.author_display_name,'createdAt',v.created_at,
    'contentHash',v.content_hash);
$$;

create function private.questionnaire_assessment_list_guarded(
  p_org uuid, p_branch uuid, p_form_key text, p_client uuid,
  p_before_created_at timestamptz default null, p_before_assessment_key uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_items jsonb; v_page jsonb; v_total integer; v_last jsonb; v_cursor jsonb;
begin
  if p_client is null or not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode='42501',message='questionnaire list is not permitted';
  end if;
  if (p_before_created_at is null) <> (p_before_assessment_key is null) then
    raise exception using errcode='22023',message='both assessment cursor fields are required';
  end if;
  with roots as materialized (
    select r.assessment_key,r.created_at from public.questionnaire_assessment_versions r
    where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=p_client
      and r.form_key=p_form_key and r.version=1
  ), page as (
    select r.assessment_key,r.created_at,terminal.* from roots r
    cross join lateral (
      select private.questionnaire_assessment_json(v) as item
      from public.questionnaire_assessment_versions v
      where v.organization_id=p_org and v.branch_id=p_branch and v.client_id=p_client
        and v.form_key=p_form_key and v.assessment_key=r.assessment_key
      order by v.version desc limit 1
    ) terminal
    where p_before_created_at is null or (r.created_at,r.assessment_key)<(p_before_created_at,p_before_assessment_key)
    order by r.created_at desc,r.assessment_key desc limit 21
  )
  select coalesce((select jsonb_agg(item||jsonb_build_object('assessmentCreatedAt',created_at)
      order by created_at desc,assessment_key desc) from page),'[]'::jsonb),
    (select count(*)::integer from roots) into v_items,v_total;
  v_page:=v_items-20;
  if jsonb_array_length(v_items)>20 then
    v_last:=v_page->19;
    v_cursor:=jsonb_build_object('createdAt',v_last->>'assessmentCreatedAt','assessmentKey',v_last->>'assessmentKey');
  else v_cursor:=null; end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_assessment_versions','assessment-list',array[]::text[],
    jsonb_build_object('workflow','questionnaire_assessment_list_v1','form_key',p_form_key,'row_count',jsonb_array_length(v_page),'answers_excluded',true));
  -- An audit write may wait on another transaction. Do not return scoped data
  -- if admission, membership or assignment expired during that wait.
  if not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode='42501',message='questionnaire list authority changed';
  end if;
  return jsonb_build_object('formKey',p_form_key,'clientId',p_client,'assessments',v_page,'total',v_total,'nextCursor',v_cursor);
end;
$$;

create function private.questionnaire_assessment_history_guarded(
  p_org uuid, p_branch uuid, p_form_key text, p_client uuid,
  p_assessment_key uuid, p_before_version integer default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_items jsonb; v_page jsonb; v_total integer; v_before integer;
begin
  if p_client is null or p_assessment_key is null
    or not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode='42501',message='questionnaire history is not permitted';
  end if;
  if p_before_version is not null and p_before_version not between 1 and 1000001 then
    raise exception using errcode='22023',message='invalid version cursor';
  end if;
  with versions as materialized (
    select v.* from public.questionnaire_assessment_versions v
    where v.organization_id=p_org and v.branch_id=p_branch and v.client_id=p_client
      and v.form_key=p_form_key and v.assessment_key=p_assessment_key
  ), page as (
    select * from versions where p_before_version is null or version<p_before_version
    order by version desc limit 21
  )
  select coalesce((select jsonb_agg(private.questionnaire_assessment_json(page) order by version desc) from page),'[]'::jsonb),
    (select count(*)::integer from versions) into v_items,v_total;
  if v_total=0 then raise exception using errcode='42501',message='questionnaire history is not permitted'; end if;
  v_page:=v_items-20;
  if jsonb_array_length(v_items)>20 then v_before:=(v_page->19->>'version')::integer; else v_before:=null; end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_assessment_versions','assessment-history',array[]::text[],
    jsonb_build_object('workflow','questionnaire_assessment_history_v1','form_key',p_form_key,'row_count',jsonb_array_length(v_page),'answers_excluded',true));
  if not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode='42501',message='questionnaire history authority changed';
  end if;
  return jsonb_build_object('formKey',p_form_key,'clientId',p_client,'assessmentKey',p_assessment_key,
    'versions',v_page,'total',v_total,'nextBeforeVersion',v_before);
end;
$$;

create or replace function private.questionnaire_assessment_snapshot_guarded(
  p_org uuid, p_branch uuid, p_form_key text, p_client uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb; v_clients jsonb:='[]'::jsonb; v_client record; v_latest jsonb; v_list jsonb; v_total integer;
begin
  if not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode='42501',message='questionnaire snapshot is not permitted';
  end if;
  for v_client in select c.id,c.display_name,c.status from public.clients c
    where c.organization_id=p_org and c.branch_id=p_branch and c.status in ('active','suspended')
      and (p_client is null or c.id=p_client)
      and private.questionnaire_assessment_authority(p_org,p_branch,c.id,p_form_key,'read')
    order by c.display_name collate "C",c.id
  loop
    -- A deterministic single terminal replaces the former multi-row scalar
    -- subquery. Independent assessments remain separate and browseable.
    select private.questionnaire_assessment_json(v) into v_latest
    from public.questionnaire_assessment_versions v
    where v.organization_id=p_org and v.branch_id=p_branch and v.client_id=v_client.id and v.form_key=p_form_key
      and not exists(select 1 from public.questionnaire_assessment_versions child where child.previous_version_id=v.id)
    order by v.assessed_on desc,v.created_at desc,v.id desc limit 1;
    if p_client is not null then
      v_list:=private.questionnaire_assessment_list_guarded(p_org,p_branch,p_form_key,v_client.id);
    else
      select count(*)::integer into v_total from public.questionnaire_assessment_versions v
      where v.organization_id=p_org and v.branch_id=p_branch and v.client_id=v_client.id and v.form_key=p_form_key and v.version=1;
      v_list:=jsonb_build_object('assessments','[]'::jsonb,'total',v_total,'nextCursor',null);
    end if;
    v_clients:=v_clients||jsonb_build_array(jsonb_build_object('clientId',v_client.id,'displayName',v_client.display_name,
      'serviceStatus',v_client.status,'latest',v_latest,'assessments',case when p_client is null then '[]'::jsonb else v_list->'assessments' end,
      'assessmentTotal',v_list->'total','nextAssessmentCursor',case when p_client is null then null else v_list->'nextCursor' end));
  end loop;
  v_result:=jsonb_build_object('formKey',p_form_key,'generatedAt',clock_timestamp(),'clients',v_clients,'matchingTotal',jsonb_array_length(v_clients));
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_assessment_versions','snapshot',array[]::text[],
    jsonb_build_object('workflow','questionnaire_assessment_snapshot_v2','form_key',p_form_key,'row_count',jsonb_array_length(v_clients),'answers_excluded',true));
  if not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read')
    or exists(select 1 from jsonb_array_elements(v_clients) c where not private.questionnaire_assessment_authority(p_org,p_branch,(c->>'clientId')::uuid,p_form_key,'read')) then
    raise exception using errcode='42501',message='questionnaire snapshot authority changed';
  end if;
  return v_result;
end;
$$;

create function public.questionnaire_assessment_list(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_key text,p_client_id uuid,
  p_before_created_at timestamptz default null,p_before_assessment_key uuid default null
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.questionnaire_assessment_list_guarded(p_expected_organization_id,p_expected_branch_id,p_form_key,p_client_id,p_before_created_at,p_before_assessment_key);
$$;
create function public.questionnaire_assessment_history(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_key text,p_client_id uuid,
  p_assessment_key uuid,p_before_version integer default null
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.questionnaire_assessment_history_guarded(p_expected_organization_id,p_expected_branch_id,p_form_key,p_client_id,p_assessment_key,p_before_version);
$$;
alter function private.questionnaire_assessment_json(public.questionnaire_assessment_versions) owner to postgres;
alter function private.questionnaire_assessment_list_guarded(uuid,uuid,text,uuid,timestamptz,uuid) owner to postgres;
alter function private.questionnaire_assessment_history_guarded(uuid,uuid,text,uuid,uuid,integer) owner to postgres;
alter function public.questionnaire_assessment_list(uuid,uuid,text,uuid,timestamptz,uuid) owner to postgres;
alter function public.questionnaire_assessment_history(uuid,uuid,text,uuid,uuid,integer) owner to postgres;
revoke all on function private.questionnaire_assessment_json(public.questionnaire_assessment_versions),
  private.questionnaire_assessment_list_guarded(uuid,uuid,text,uuid,timestamptz,uuid),
  private.questionnaire_assessment_history_guarded(uuid,uuid,text,uuid,uuid,integer),
  public.questionnaire_assessment_list(uuid,uuid,text,uuid,timestamptz,uuid),
  public.questionnaire_assessment_history(uuid,uuid,text,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.questionnaire_assessment_list_guarded(uuid,uuid,text,uuid,timestamptz,uuid),
  private.questionnaire_assessment_history_guarded(uuid,uuid,text,uuid,uuid,integer),
  public.questionnaire_assessment_list(uuid,uuid,text,uuid,timestamptz,uuid),
  public.questionnaire_assessment_history(uuid,uuid,text,uuid,uuid,integer) to authenticated;
commit;
