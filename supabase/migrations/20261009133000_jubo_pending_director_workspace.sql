-- Candidate only. The director may compare the immutable JUBO source with
-- the reviewed display profile for a pending client of the exact branch.
-- This does not grant clients.demographics.read, clients.manage, admission,
-- formal assessment, service, medication, transport or claims permissions.
begin;
set local lock_timeout = '5s';

insert into public.permissions(permission_key,description,risk_level)
values('clients.jubo_pending_source.read',
  'Read only reviewed JUBO source and mapped profile for pending clients in the director exact branch',2)
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011'::uuid,p.id
from public.permissions p where p.permission_key='clients.jubo_pending_source.read'
on conflict do nothing;

create function private.require_jubo_pending_director_source_scope(p_org uuid,p_branch uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if auth.uid() is null or p_org is null or p_branch is null or not exists(
    select 1 from private.routine_staff_scope() scope
    join public.roles role on role.id=scope.role_id and role.is_system
      and role.role_key='branch_director' and role.is_active
    join public.role_permissions grant_row on grant_row.role_id=role.id
      and grant_row.granted_at<=clock_timestamp()
    join public.permissions permission on permission.id=grant_row.permission_id
      and permission.permission_key='clients.jubo_pending_source.read'
    join public.branches branch on branch.id=p_branch
      and branch.organization_id=p_org and branch.is_active
    join public.organizations organization on organization.id=p_org and organization.is_active
    where scope.organization_id=p_org and scope.branch_id=p_branch
      and exists(select 1 from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id
        where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
          and p.permission_key='clients.read')
      and exists(select 1 from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id
        where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
          and p.permission_key='clients.view_all')
  ) then
    raise exception using errcode='42501',message='JUBO_DIRECTOR_SOURCE_ACCESS_DENIED';
  end if;
end;
$$;

create function private.jubo_pending_director_directory(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_total integer; v_rows jsonb;
begin
  perform private.require_jubo_pending_director_source_scope(p_org,p_branch);
  select count(*)::integer into v_total
  from public.clients client
  join private.jubo_public_pending_links link on link.client_id=client.id
    and link.organization_id=client.organization_id and link.branch_id=client.branch_id
  join private.jubo_intake_profile_sources source_link on source_link.client_id=client.id
    and source_link.organization_id=client.organization_id
    and source_link.branch_id=client.branch_id
  where client.organization_id=p_org and client.branch_id=p_branch
    and client.status='pending' and client.source_system='jubo'
    and client.admitted_on is null and client.ended_on is null;
  if v_total>500 then
    raise exception using errcode='54000',message='JUBO_DIRECTOR_DIRECTORY_TOO_LARGE';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('clientId',row.id,
    'displayName',row.display_name,'clientCode',row.client_code,
    'sourceStatus',row.source_status) order by row.display_name,row.id),'[]'::jsonb)
    into v_rows
  from (
    select client.id,client.display_name,client.client_code,pending.source_status
    from public.clients client
    join private.jubo_public_pending_links link on link.client_id=client.id
      and link.organization_id=client.organization_id and link.branch_id=client.branch_id
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
      and pending.organization_id=client.organization_id and pending.branch_id=client.branch_id
    join private.jubo_intake_profile_sources source_link on source_link.client_id=client.id
      and source_link.organization_id=client.organization_id
      and source_link.branch_id=client.branch_id
    where client.organization_id=p_org and client.branch_id=p_branch
      and client.status='pending' and client.source_system='jubo'
      and client.admitted_on is null and client.ended_on is null
    order by client.display_name,client.id
    limit 500
  ) row;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,
    action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.jubo_intake_profile_sources',
    p_branch::text,'{}'::text[],jsonb_build_object('projection','pending_director_directory_v1',
      'resultCount',v_total));
  return jsonb_build_object('clients',v_rows,'total',v_total);
end;
$$;

create function private.jubo_pending_director_source_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_source_id uuid; v_source private.jubo_source_rows%rowtype;
  v_pending private.jubo_pending_master_rows%rowtype;
  v_profile_source private.jubo_intake_profile_sources%rowtype;
  v_profile private.client_intake_versions%rowtype;
  v_review private.jubo_profile_mapping_v2_reviews%rowtype;
  v_fields jsonb; v_drafts jsonb;
begin
  perform private.require_jubo_pending_director_source_scope(p_org,p_branch);
  v_source_id:=private.require_jubo_pending_director_draft_scope(p_org,p_branch,p_client);
  select source.* into v_source from private.jubo_source_rows source
    where source.id=v_source_id and source.organization_id=p_org and source.branch_id=p_branch;
  select pending.* into v_pending from private.jubo_pending_master_rows pending
    where pending.source_row_id=v_source_id and pending.organization_id=p_org
      and pending.branch_id=p_branch;
  select source_link.* into v_profile_source from private.jubo_intake_profile_sources source_link
    where source_link.client_id=p_client and source_link.master_source_row_id=v_source_id
      and source_link.organization_id=p_org and source_link.branch_id=p_branch;
  select profile.* into v_profile from private.client_intake_versions profile
    where profile.id=v_profile_source.intake_version_id and profile.client_id=p_client
      and profile.organization_id=p_org and profile.branch_id=p_branch;
  select review.* into v_review from private.jubo_profile_mapping_v2_reviews review
    where review.pair_id=v_profile_source.pair_id and review.master_source_row_id=v_source_id
      and review.organization_id=p_org and review.branch_id=p_branch
    order by review.review_version desc limit 1;
  if v_source.id is null or v_pending.id is null or v_profile_source.id is null
    or v_profile.id is null or v_review.id is null
    or v_review.decision<>'approved'
    or v_source.row_sha256<>v_profile_source.master_source_row_sha256
    or v_source.row_sha256<>v_review.source_row_sha256
    or v_source.row_sha256<>encode(sha256(convert_to(v_source.raw_values::text,'UTF8')),'hex')
    or v_profile_source.profile_sha256<>encode(sha256(convert_to(v_profile.profile::text,'UTF8')),'hex')
    or v_profile_source.mapping_review_sha256<>v_review.mapping_review_sha256 then
    raise exception using errcode='42501',message='JUBO_DIRECTOR_SOURCE_UNAVAILABLE';
  end if;
  -- Identity is deliberately masked in this lower-privilege director view.
  -- The exact source remains private and immutable for a separate authorized
  -- identity-review workflow.
  v_fields:=jsonb_build_array(
    jsonb_build_object('key','displayName','label','姓名','original',v_source.raw_values->>2,
      'display',v_profile.profile->>'displayName'),
    jsonb_build_object('key','sex','label','性別','original',v_source.raw_values->>3,
      'display',v_profile.profile->>'sex'),
    jsonb_build_object('key','dateOfBirth','label','出生日期','original',v_source.raw_values->>23,
      'display',v_profile.profile->>'dateOfBirth'),
    jsonb_build_object('key','identityNumber','label','身分識別碼末四碼',
      'original',case when v_source.raw_values->>25 is null then null
        else '••••'||right(v_source.raw_values->>25,4) end,
      'display',case when v_profile.profile->>'identityNumber' is null then null
        else '••••'||right(v_profile.profile->>'identityNumber',4) end),
    jsonb_build_object('key','registeredAddress','label','戶籍地址',
      'original',v_source.raw_values->>32,'display',v_profile.profile->>'registeredAddress'),
    jsonb_build_object('key','residentialAddress','label','居住地址',
      'original',v_source.raw_values->>35,'display',v_profile.profile->>'residentialAddress'),
    jsonb_build_object('key','cmsLevel','label','CMS 等級',
      'original',v_source.raw_values->>48,'display',v_profile.profile->>'cmsLevel'),
    jsonb_build_object('key','disability','label','身障資料',
      'original',v_source.raw_values->>54,'display',v_profile.profile->>'disability'),
    jsonb_build_object('key','primaryContactName','label','主要聯絡人',
      'original',v_source.raw_values->>78,'display',v_profile.profile->'contacts'->0->>'name'),
    jsonb_build_object('key','primaryContactPhone','label','主要聯絡電話',
      'original',v_source.raw_values->>79,'display',v_profile.profile->'contacts'->0->>'phone'),
    jsonb_build_object('key','proxyName','label','代理人',
      'original',v_source.raw_values->>80,'display',
      (select contact->>'name' from jsonb_array_elements(v_profile.profile->'contacts') contact
       where contact->>'isPrimary'='false' limit 1)),
    jsonb_build_object('key','proxyPhone','label','代理人電話',
      'original',v_source.raw_values->>81,'display',
      (select contact->>'phone' from jsonb_array_elements(v_profile.profile->'contacts') contact
       where contact->>'isPrimary'='false' limit 1)));
  v_drafts:=private.jubo_pending_director_draft_workspace(p_org,p_branch,p_client);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,
    action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.jubo_source_rows',
    v_source.id::text,'{}'::text[],jsonb_build_object('projection','pending_director_source_v1',
      'clientId',p_client,'sourceRowId',v_source.id));
  return v_drafts||jsonb_build_object(
    'clientCode',v_profile.profile->>'clientCode',
    'displayName',v_profile.profile->>'displayName',
    'sourceStatus',v_pending.source_status,
    'sourceFirstServiceOn',v_pending.source_first_service_on,
    'profileVersion',v_profile.version,
    'humanReview',jsonb_build_object('decision',v_review.decision,
      'version',v_review.review_version,'reviewedAt',v_review.reviewed_at),
    'normalizationFieldIndices',v_profile_source.normalization_field_indices,
    'fields',v_fields,'formalOperationsAllowed',false);
end;
$$;

create function public.jubo_pending_director_directory(p_org uuid,p_branch uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_pending_director_directory(p_org,p_branch);
$$;
create function public.jubo_pending_director_source_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_pending_director_source_workspace(p_org,p_branch,p_client);
$$;

revoke all on function private.require_jubo_pending_director_source_scope(uuid,uuid),
  private.jubo_pending_director_directory(uuid,uuid),
  private.jubo_pending_director_source_workspace(uuid,uuid,uuid),
  public.jubo_pending_director_directory(uuid,uuid),
  public.jubo_pending_director_source_workspace(uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.jubo_pending_director_directory(uuid,uuid),
  private.jubo_pending_director_source_workspace(uuid,uuid,uuid),
  public.jubo_pending_director_directory(uuid,uuid),
  public.jubo_pending_director_source_workspace(uuid,uuid,uuid)
to authenticated;
commit;
