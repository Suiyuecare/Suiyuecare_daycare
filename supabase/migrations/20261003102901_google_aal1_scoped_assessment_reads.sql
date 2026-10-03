-- Normal Google work sessions may read only the seven named work snapshots.
-- This does not alter is_active_user, has_permission, attachment download,
-- export, or claim authorization. The body-specific authority also preserves
-- AAL2 sign scope and rejects future-dated grants. In particular, a
-- pending staff invitation is never sufficient: routine_intake_scope() only
-- yields a real, owner-approved, verified Google session with an active role.
begin;
set local lock_timeout = '5s';

create function private.has_permission_for_snapshot(
  p_org uuid, p_branch uuid, p_permission text
) returns boolean language sql volatile security definer set search_path = '' as $$
  select private.has_permission(p_org,p_branch,p_permission)
    or coalesce(
      p_org is not null and p_branch is not null
      and auth.jwt()->>'aal' = 'aal1'
      and p_permission in (
        'clients.read','clients.view_all','clients.demographics.read',
        'health.read','medications.read','body_assessments.read',
        'behavior_events.read','abcd_assessments.read',
        'insulin_administrations.read'
      )
      and private.has_routine_intake_permission(p_org,p_branch,'clients.read')
      and exists (
        select 1 from private.routine_intake_scope() scope
        join public.role_permissions grant_row on grant_row.role_id=scope.role_id
          and grant_row.granted_at<=clock_timestamp()
        join public.permissions permission on permission.id=grant_row.permission_id
          and permission.permission_key=p_permission
        join public.branches branch on branch.id=p_branch
          and branch.organization_id=p_org and branch.is_active
        where scope.organization_id=p_org
          and (scope.branch_id is null or scope.branch_id=p_branch)
      ),false);
$$;

create function private.can_staff_access_client_for_snapshot(
  p_client uuid, p_permission text
) returns boolean language sql volatile security definer set search_path = '' as $$
  select private.can_staff_access_client(p_client,p_permission)
    or coalesce(auth.jwt()->>'aal'='aal1' and exists (
      select 1 from public.clients client
      where client.id=p_client
        and private.has_permission_for_snapshot(
          client.organization_id,client.branch_id,'clients.read')
        and private.has_permission_for_snapshot(
          client.organization_id,client.branch_id,p_permission)
        and (
          private.has_permission_for_snapshot(
            client.organization_id,client.branch_id,'clients.view_all')
          or exists (
            select 1 from public.client_assignments assignment
            where assignment.client_id=client.id
              and assignment.organization_id=client.organization_id
              and assignment.branch_id=client.branch_id
              and assignment.assignee_user_id=auth.uid()
              and assignment.starts_at<=clock_timestamp()
              and (assignment.ends_at is null
                or assignment.ends_at>clock_timestamp())
          )
        )
    ),false);
$$;

-- Body assessment previously ignored future-dated role and permission grants.
-- AAL2 admission now includes approved non-executive staff, so a scheduled
-- assignment must never become a live clinical read or signature early.
create or replace function private.body_assessment_permission(
  p_org uuid,p_branch uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.memberships membership
  join public.membership_roles membership_role
    on membership_role.membership_id=membership.id
    and membership_role.assigned_at<=clock_timestamp()
  join public.roles role on role.id=membership_role.role_id and role.is_active
  join public.role_permissions role_permission
    on role_permission.role_id=role.id
    and role_permission.granted_at<=clock_timestamp()
  join public.permissions permission on permission.id=role_permission.permission_id
  where membership.profile_id=auth.uid() and membership.organization_id=p_org
    and membership.status='active' and membership.starts_at<=clock_timestamp()
    and (membership.ends_at is null or membership.ends_at>clock_timestamp())
    and (membership.branch_id is null or membership.branch_id=p_branch)
    and (role.organization_id is null or role.organization_id=p_org)
    and permission.permission_key=p_permission);
$$;

create or replace function private.body_assessment_authority(
  p_org uuid,p_branch uuid,p_client uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select p_permission in ('body_assessments.read','body_assessments.manage','body_assessments.sign')
    and (
      ((private.is_executive_login_allowed() or private.is_staff_google_session_allowed())
        and auth.uid() is not null and coalesce(auth.jwt()->>'aal','')='aal2'
        and exists(select 1 from public.profiles profile where profile.id=auth.uid()
          and profile.is_active and profile.kind in ('staff','professional'))
        and exists(select 1 from public.branches branch
          join public.organizations organization on organization.id=branch.organization_id
          where branch.id=p_branch and branch.organization_id=p_org
            and branch.is_active and organization.is_active)
        and private.body_assessment_permission(p_org,p_branch,'clients.read')
        and private.body_assessment_permission(p_org,p_branch,'body_assessments.read')
        and private.body_assessment_permission(p_org,p_branch,p_permission)
        and (p_client is null or (exists(select 1 from public.clients client
            where client.id=p_client and client.organization_id=p_org
              and client.branch_id=p_branch)
          and (private.body_assessment_permission(p_org,p_branch,'clients.view_all')
            or exists(select 1 from public.client_assignments assignment
              where assignment.client_id=p_client and assignment.organization_id=p_org
                and assignment.branch_id=p_branch and assignment.assignee_user_id=auth.uid()
                and assignment.starts_at<=clock_timestamp()
                and (assignment.ends_at is null
                  or assignment.ends_at>clock_timestamp()))))))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
        and p_permission='body_assessments.read'
        and private.has_permission_for_snapshot(p_org,p_branch,'body_assessments.read')
        and (p_client is null or
          (exists(select 1 from public.clients client where client.id=p_client
            and client.organization_id=p_org and client.branch_id=p_branch)
          and private.can_staff_access_client_for_snapshot(p_client,'body_assessments.read'))))
    );
$$;

create or replace function private.abcd_assessment_current_authority(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists(select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
        and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
        and p_permission='abcd_assessments.read'
        and private.has_permission_for_snapshot(
          p_expected_organization_id,p_expected_branch_id,p_permission)));
$$;

create or replace function private.abcd_assessment_client_authority(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_client_id uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select private.abcd_assessment_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists(select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
        and private.can_staff_access_client(p_client_id,'clients.read')
        and private.can_staff_access_client(p_client_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
        and p_permission='abcd_assessments.read'
        and private.can_staff_access_client_for_snapshot(
          p_client_id,'abcd_assessments.read')));
$$;

create or replace function private.behavior_event_current_authority(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists(select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
        and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
        and p_permission='behavior_events.read'
        and private.has_permission_for_snapshot(
          p_expected_organization_id,p_expected_branch_id,p_permission)));
$$;

create or replace function private.behavior_event_client_authority(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_client_id uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select private.behavior_event_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists(select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
        and private.can_staff_access_client(p_client_id,'clients.read')
        and private.can_staff_access_client(p_client_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
        and p_permission='behavior_events.read'
        and private.can_staff_access_client_for_snapshot(
          p_client_id,'behavior_events.read')));
$$;

create function private.insulin_base_authority_for_snapshot(
  p_org uuid,p_branch uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select private.insulin_base_authority(p_org,p_branch,p_permission)
    or (coalesce(auth.jwt()->>'aal','')='aal1'
      and p_permission='insulin_administrations.read'
      and private.has_permission_for_snapshot(p_org,p_branch,'clients.read')
      and private.has_permission_for_snapshot(p_org,p_branch,'medications.read')
      and private.has_permission_for_snapshot(p_org,p_branch,p_permission));
$$;

-- Update only six read-only response functions. The exact occurrence counts
-- are reviewed against the frozen source so a changed schema fails closed.
-- No mutation function or general access helper is rewritten.
do $migration$
declare v_row record; v_source text; v_old text; v_new text; v_count integer;
begin
  for v_row in select * from (values
    ('private.client_master_snapshot(uuid,uuid,text)'::regprocedure,2,1,0),
    ('private.medication_administration_day_snapshot(uuid,uuid,date)'::regprocedure,2,2,0),
    ('private.client_tocc_snapshot(uuid,uuid,uuid)'::regprocedure,2,2,0),
    ('private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text)'::regprocedure,0,8,0),
    ('private.behavior_event_snapshot_response(uuid,uuid,date,date,uuid,text,text)'::regprocedure,0,8,0),
    ('private.insulin_administration_snapshot_response(uuid,uuid,date,text,uuid,text)'::regprocedure,0,6,5)
  ) as expectation(function_oid,permission_calls,client_calls,insulin_calls) loop
    select pg_get_functiondef(v_row.function_oid) into v_source;
    if v_source is null or v_source not like '%SECURITY DEFINER%'
      or v_source not like '%SET search_path TO ''''%' then
      raise exception 'unreviewed snapshot definition: %',v_row.function_oid;
    end if;
    v_old:='private.has_permission(';
    v_count:=(length(v_source)-length(replace(v_source,v_old,'')))/length(v_old);
    if v_count<>v_row.permission_calls then
      raise exception 'snapshot permission boundary changed: %',v_row.function_oid;
    end if;
    v_source:=replace(v_source,v_old,'private.has_permission_for_snapshot(');
    v_old:='private.can_staff_access_client(';
    v_count:=(length(v_source)-length(replace(v_source,v_old,'')))/length(v_old);
    if v_count<>v_row.client_calls then
      raise exception 'snapshot client boundary changed: %',v_row.function_oid;
    end if;
    v_source:=replace(v_source,v_old,'private.can_staff_access_client_for_snapshot(');
    v_old:='private.insulin_base_authority(';
    v_count:=(length(v_source)-length(replace(v_source,v_old,'')))/length(v_old);
    if v_count<>v_row.insulin_calls then
      raise exception 'snapshot insulin boundary changed: %',v_row.function_oid;
    end if;
    v_source:=replace(v_source,v_old,'private.insulin_base_authority_for_snapshot(');
    if v_row.insulin_calls>0 then
      -- Designation counts span the branch. Do not let a staff AAL1 snapshot
      -- reveal whether an unassigned client's plan has been designated.
      v_old:='case when v_designations = 0 then ''not_configured'' else ''published'' end';
      v_count:=(length(v_source)-length(replace(v_source,v_old,'')))/length(v_old);
      if v_count<>1 then
        raise exception 'snapshot designation boundary changed: %',v_row.function_oid;
      end if;
      v_source:=replace(v_source,v_old,
        'case when auth.jwt()->>''aal'' = ''aal1'' then ''restricted'' '
        ||'when v_designations = 0 then ''not_configured'' else ''published'' end');
      v_old:='''designation_configured'', v_designations > 0';
      v_count:=(length(v_source)-length(replace(v_source,v_old,'')))/length(v_old);
      if v_count<>1 then
        raise exception 'snapshot designation audit boundary changed: %',v_row.function_oid;
      end if;
      v_source:=replace(v_source,v_old,
        '''designation_configured'', case when auth.jwt()->>''aal'' = ''aal1'' '
        ||'then null else v_designations > 0 end');
    end if;
    execute v_source;
  end loop;
end;
$migration$;

alter function private.has_permission_for_snapshot(uuid,uuid,text) owner to postgres;
alter function private.can_staff_access_client_for_snapshot(uuid,text) owner to postgres;
alter function private.insulin_base_authority_for_snapshot(uuid,uuid,text) owner to postgres;
revoke all on function private.has_permission_for_snapshot(uuid,uuid,text),
  private.can_staff_access_client_for_snapshot(uuid,text),
  private.insulin_base_authority_for_snapshot(uuid,uuid,text)
  from public,anon,authenticated,service_role;

comment on function private.has_permission_for_snapshot(uuid,uuid,text) is
  'Read-only snapshot use only. AAL1 requires a verified owner-approved Google session and effective role in the exact tenant/branch; never use in mutations.';
comment on function private.can_staff_access_client_for_snapshot(uuid,text) is
  'Read-only snapshot use only. Enforces exact client branch and view-all or active assignment; never use in mutations.';

commit;
