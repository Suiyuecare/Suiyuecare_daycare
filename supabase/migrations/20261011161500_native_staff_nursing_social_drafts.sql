begin;
set local lock_timeout='5s';

-- A page-specific ordinary-work path. No global permission/reauthentication
-- helper is relaxed, no user or professional role is provisioned here.
create function private.clinical_draft_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal1'
  and p_permission in ('clients.read','clients.view_all','nursing_assessments.read',
    'nursing_assessments.manage','social_work_records.read','social_work_records.manage')
  and exists(select 1 from private.routine_staff_scope() scope
    join public.profiles profile on profile.id=auth.uid() and profile.is_active
      and profile.kind in ('staff','professional')
    join public.role_permissions grant_row on grant_row.role_id=scope.role_id
      and grant_row.granted_at<=clock_timestamp()
    join public.permissions permission on permission.id=grant_row.permission_id
      and permission.permission_key=p_permission
    join public.branches branch on branch.id=p_branch and branch.organization_id=p_org and branch.is_active
    join public.organizations organization on organization.id=p_org and organization.is_active
    where scope.organization_id=p_org and (scope.branch_id is null or scope.branch_id=p_branch)),false);
$$;

create or replace function private.nursing_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.memberships membership
  join public.membership_roles membership_role on membership_role.membership_id=membership.id
    and membership_role.assigned_at<=clock_timestamp()
  join public.roles role on role.id=membership_role.role_id and role.is_active
  join public.role_permissions grant_row on grant_row.role_id=role.id and grant_row.granted_at<=clock_timestamp()
  join public.permissions permission on permission.id=grant_row.permission_id
  where membership.profile_id=auth.uid() and membership.organization_id=p_org
    and (membership.branch_id is null or membership.branch_id=p_branch)
    and membership.status='active' and membership.starts_at<=clock_timestamp()
    and (membership.ends_at is null or membership.ends_at>clock_timestamp())
    and (role.organization_id is null or role.organization_id=p_org)
    and permission.permission_key=p_permission);
$$;

create or replace function private.nursing_authority(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(public.is_staff_login_allowed() and auth.uid() is not null
  and p_permission in ('nursing_assessments.read','nursing_assessments.manage','nursing_assessments.sign')
  and exists(select 1 from public.profiles profile where profile.id=auth.uid() and profile.is_active and profile.kind='staff')
  and exists(select 1 from public.branches branch join public.organizations organization on organization.id=branch.organization_id
    where branch.id=p_branch and branch.organization_id=p_org and branch.is_active and organization.is_active)
  and ((auth.jwt()->>'aal'='aal2'
    and private.nursing_permission(p_org,p_branch,'clients.read')
    and private.nursing_permission(p_org,p_branch,'nursing_assessments.read')
    and private.nursing_permission(p_org,p_branch,p_permission))
   or (auth.jwt()->>'aal'='aal1' and p_permission<>'nursing_assessments.sign'
    and private.clinical_draft_permission(p_org,p_branch,'clients.read')
    and private.clinical_draft_permission(p_org,p_branch,'nursing_assessments.read')
    and private.clinical_draft_permission(p_org,p_branch,p_permission)))
  and (p_client is null or exists(select 1 from public.clients client where client.id=p_client
    and client.organization_id=p_org and client.branch_id=p_branch and (
      (p_permission='nursing_assessments.read' and
        (private.nursing_permission(p_org,p_branch,'clients.view_all') or private.clinical_draft_permission(p_org,p_branch,'clients.view_all')))
      or exists(select 1 from public.client_assignments assignment where assignment.client_id=client.id
        and assignment.organization_id=p_org and assignment.branch_id=p_branch and assignment.assignee_user_id=auth.uid()
        and assignment.starts_at<=clock_timestamp() and (assignment.ends_at is null or assignment.ends_at>clock_timestamp())))))
  and (p_permission='nursing_assessments.read' or (
    -- A director must carry a separately approved nurse role. The title itself
    -- is never a qualification, and view-all is not a clinical write grant.
    exists(select 1 from public.memberships membership
      join public.membership_roles membership_role on membership_role.membership_id=membership.id
        and membership_role.assigned_at<=clock_timestamp()
      join public.roles role on role.id=membership_role.role_id and role.is_system and role.is_active and role.role_key='nurse'
      where membership.profile_id=auth.uid() and membership.organization_id=p_org
        and (membership.branch_id is null or membership.branch_id=p_branch)
        and membership.status='active' and membership.starts_at<=clock_timestamp()
        and (membership.ends_at is null or membership.ends_at>clock_timestamp()))
    and p_client is not null)),false);
$$;

create or replace function private.social_work_current_authority(p_expected_organization_id uuid,p_expected_branch_id uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(public.is_staff_login_allowed() and auth.uid() is not null
  and p_permission in ('social_work_records.read','social_work_records.manage','social_work_records.sign')
  and exists(select 1 from public.profiles profile where profile.id=auth.uid() and profile.is_active and profile.kind in ('staff','professional'))
  and exists(select 1 from public.branches branch join public.organizations organization on organization.id=branch.organization_id
    where branch.id=p_expected_branch_id and branch.organization_id=p_expected_organization_id and branch.is_active and organization.is_active)
  and ((auth.jwt()->>'aal'='aal2' and private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.read')
    and private.has_permission(p_expected_organization_id,p_expected_branch_id,'social_work_records.read')
    and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
   or (auth.jwt()->>'aal'='aal1' and p_permission<>'social_work_records.sign'
    and private.clinical_draft_permission(p_expected_organization_id,p_expected_branch_id,'clients.read')
    and private.clinical_draft_permission(p_expected_organization_id,p_expected_branch_id,'social_work_records.read')
    and private.clinical_draft_permission(p_expected_organization_id,p_expected_branch_id,p_permission)
    and (p_permission='social_work_records.read' or exists(select 1 from private.routine_staff_scope() scope
      join public.roles role on role.id=scope.role_id and role.is_system and role.role_key='case_manager_social_worker'
      where scope.organization_id=p_expected_organization_id and (scope.branch_id is null or scope.branch_id=p_expected_branch_id))))),false);
$$;

create or replace function private.social_work_client_authority(p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(private.social_work_current_authority(p_expected_organization_id,p_expected_branch_id,p_permission)
  and exists(select 1 from public.clients client where client.id=p_client_id
    and client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id)
  and ((auth.jwt()->>'aal'='aal2' and private.can_staff_access_client(p_client_id,'clients.read')
    and private.can_staff_access_client(p_client_id,p_permission))
   or (auth.jwt()->>'aal'='aal1' and (
    (p_permission='social_work_records.read' and private.clinical_draft_permission(p_expected_organization_id,p_expected_branch_id,'clients.view_all'))
    or exists(select 1 from public.client_assignments assignment where assignment.client_id=p_client_id
      and assignment.organization_id=p_expected_organization_id and assignment.branch_id=p_expected_branch_id
      and assignment.assignee_user_id=auth.uid() and assignment.starts_at<=clock_timestamp()
      and (assignment.ends_at is null or assignment.ends_at>clock_timestamp()))))),false);
$$;

-- The Page 29 response must use its scoped read helper as well; otherwise
-- admitted AAL1 staff get an apparently successful but empty work list.
do $replace$ declare definition text; changed text; matches integer; begin
 definition:=pg_get_functiondef('private.social_work_service_snapshot_bundle(uuid,uuid,date,date,text,uuid,uuid,timestamptz)'::regprocedure);
 select count(*) into matches from regexp_matches(definition,'private\.can_staff_access_client\(','g');
 if matches<>4 then raise exception 'unexpected social-work snapshot source boundary'; end if;
 changed:=regexp_replace(definition,
  'private\.can_staff_access_client\([[:space:]]*([^,]+),[[:space:]]*(''clients.read''|''social_work_records.read'')[[:space:]]*\)',
  'private.social_work_client_authority(p_expected_organization_id,p_expected_branch_id,\1,''social_work_records.read'')','g');
 if changed=definition or position('private.can_staff_access_client(' in changed)>0 then
  raise exception 'social-work snapshot source replacement incomplete'; end if;
 execute changed;

 -- Only unsigned drafts are newly admitted at AAL1. The separate committed
 -- follow-up event workflow retains its original AAL2 admission.
 definition:=pg_get_functiondef('private.mutate_social_work_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure);
 if position(E'begin\n  if p_action' in definition)=0 then raise exception 'unexpected social-work follow-up boundary'; end if;
 execute replace(definition,E'begin\n  if p_action',
  E'begin\n  if coalesce(auth.jwt()->>''aal'','''')<>''aal2'' then\n    raise exception using errcode=''42501'',message=''social-work follow-up requires AAL2'';\n  end if;\n  if p_action');
end $replace$;

alter function private.clinical_draft_permission(uuid,uuid,text) owner to postgres;
revoke all on function private.clinical_draft_permission(uuid,uuid,text) from public,anon,authenticated,service_role;
comment on function private.nursing_authority(uuid,uuid,uuid,text) is
 'Approved native staff session, effective read/action grants and assigned client. AAL1 may read/save unsigned drafts only; signatures retain actual recent AAL2 evidence. Directors require a separate nurse role.';
comment on function private.social_work_current_authority(uuid,uuid,text) is
 'Page 29 approved native staff scope: AAL1 read/unsigned draft, with separate effective social-work role; signing/correction/follow-up retain AAL2. No global authority relaxation.';
commit;
