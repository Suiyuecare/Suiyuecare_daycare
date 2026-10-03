-- Ordinary, explicitly approved Google work sessions may save unsigned
-- clinical drafts. Body signatures also gain a narrowly scoped approved-staff
-- AAL2 preflight; factor evidence remains mandatory. Correction, medication
-- execution, attachment, export, and general permission helpers are unchanged.
begin;
set local lock_timeout = '5s';

create function private.has_google_assessment_draft_access(
  p_org uuid,p_branch uuid,p_kind text,p_client uuid default null
) returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal'='aal1'
    and p_kind in ('body','abcd','behavior')
    and private.has_permission_for_snapshot(p_org,p_branch,'clients.read')
    and private.has_permission_for_snapshot(p_org,p_branch,case p_kind
      when 'body' then 'body_assessments.read'
      when 'abcd' then 'abcd_assessments.read'
      when 'behavior' then 'behavior_events.read' end)
    and exists (
      select 1 from private.routine_intake_scope() scope
      join public.role_permissions role_grant on role_grant.role_id=scope.role_id
        and role_grant.granted_at<=clock_timestamp()
      join public.permissions permission on permission.id=role_grant.permission_id
        and permission.permission_key=case p_kind
          when 'body' then 'body_assessments.manage'
          when 'abcd' then 'abcd_assessments.manage'
          when 'behavior' then 'behavior_events.manage' end
      join public.branches branch on branch.id=p_branch
        and branch.organization_id=p_org and branch.is_active
      join public.organizations organization on organization.id=p_org
        and organization.is_active
      where scope.organization_id=p_org
        and (scope.branch_id is null or scope.branch_id=p_branch)
    )
    and (p_client is null or (exists(select 1 from public.clients client
      where client.id=p_client and client.organization_id=p_org
        and client.branch_id=p_branch)
      and private.can_staff_access_client_for_snapshot(
        p_client,case p_kind
          when 'body' then 'body_assessments.read'
          when 'abcd' then 'abcd_assessments.read'
          when 'behavior' then 'behavior_events.read' end))),false);
$$;

create function public.has_google_assessment_draft_access(
  target_org_id uuid,target_branch_id uuid,target_kind text,target_client_id uuid default null
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.has_google_assessment_draft_access(
    target_org_id,target_branch_id,target_kind,target_client_id);
$$;

-- The original mutation state machines already separate save from sign and
-- require same-session recent AAL2 for sign/correct. Their write payloads and
-- version transitions stay unchanged; only draft-manage authority and the
-- body-specific approved-staff AAL2 admission below are extended.
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
      or (p_permission='body_assessments.manage'
        and private.has_google_assessment_draft_access(p_org,p_branch,'body',p_client))
    );
$$;

-- The legacy reauthentication helper used private.has_recent_aal2(), whose
-- global executive-only admission rejects otherwise approved Google staff.
-- Keep the same real-session challenge evidence and 15-minute limit, but
-- admit only the two explicitly approved Google identities under this page's
-- already-scoped sign authority. No general AAL2 helper is relaxed.
create or replace function private.body_assessment_reauth(p_actor uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_challenge uuid; v_now timestamptz:=clock_timestamp();
begin
 if p_actor is null or p_actor<>auth.uid()
   or coalesce(auth.jwt()->>'aal','')<>'aal2'
   or not (private.is_executive_login_allowed() or private.is_staff_google_session_allowed()) then
  raise exception using errcode='42501',message='body assessment requires recent same-session AAL2';
 end if;
 begin v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then
  raise exception using errcode='42501',message='body assessment requires recent same-session AAL2'; end;
 select challenge.id into v_challenge from private.reauth_challenges challenge
 join private.reauth_events event
   on event.challenge_id=challenge.id and event.user_id=challenge.user_id
   and event.session_id=challenge.session_id
 where event.user_id=p_actor and event.session_id=v_session and event.aal='aal2'
   and event.revoked_at is null and challenge.consumed_at is not null
   and challenge.invalidated_at is null
   and event.verification_method in ('totp','webauthn','phone')
   and challenge.factor_method=event.verification_method
   and challenge.factor_verified_at=event.verified_at
   and challenge.factor_verified_at between v_now-interval '15 minutes'
     and v_now+interval '1 minute'
 order by challenge.factor_verified_at desc,challenge.id desc limit 1
 for share of challenge,event;
 if v_challenge is null then
  raise exception using errcode='42501',message='body assessment requires recent same-session AAL2';
 end if;
 return v_challenge;
end; $$;

-- A body-only preflight for an approved, authorized signer. The general
-- has_recent_aal2 RPC intentionally keeps its original policy unchanged.
create function private.has_recent_body_assessment_aal2(
  p_org uuid,p_branch uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.body_assessment_authority(
   p_org,p_branch,null,'body_assessments.sign') then
  return false;
 end if;
 perform private.body_assessment_reauth(auth.uid());
 return true;
exception when insufficient_privilege then
 return false;
end; $$;

create function public.has_recent_body_assessment_aal2(
  target_org_id uuid,target_branch_id uuid
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.has_recent_body_assessment_aal2(
    target_org_id,target_branch_id);
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
          p_expected_organization_id,p_expected_branch_id,p_permission))
      or (p_permission='abcd_assessments.manage'
        and private.has_google_assessment_draft_access(
          p_expected_organization_id,p_expected_branch_id,'abcd')));
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
          p_client_id,'abcd_assessments.read'))
      or (p_permission='abcd_assessments.manage'
        and private.has_google_assessment_draft_access(
          p_expected_organization_id,p_expected_branch_id,'abcd',p_client_id)));
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
          p_expected_organization_id,p_expected_branch_id,p_permission))
      or (p_permission='behavior_events.manage'
        and private.has_google_assessment_draft_access(
          p_expected_organization_id,p_expected_branch_id,'behavior')));
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
          p_client_id,'behavior_events.read'))
      or (p_permission='behavior_events.manage'
        and private.has_google_assessment_draft_access(
          p_expected_organization_id,p_expected_branch_id,'behavior',p_client_id)));
$$;

alter function private.has_google_assessment_draft_access(uuid,uuid,text,uuid) owner to postgres;
alter function private.has_recent_body_assessment_aal2(uuid,uuid) owner to postgres;
alter function public.has_google_assessment_draft_access(uuid,uuid,text,uuid) owner to postgres;
alter function public.has_recent_body_assessment_aal2(uuid,uuid) owner to postgres;
revoke all on function private.has_google_assessment_draft_access(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.has_recent_body_assessment_aal2(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.has_google_assessment_draft_access(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.has_recent_body_assessment_aal2(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.has_google_assessment_draft_access(uuid,uuid,text,uuid)
  to authenticated;
grant execute on function private.has_google_assessment_draft_access(uuid,uuid,text,uuid)
  to authenticated;
grant execute on function public.has_recent_body_assessment_aal2(uuid,uuid)
  to authenticated;
grant execute on function private.has_recent_body_assessment_aal2(uuid,uuid)
  to authenticated;

comment on function public.has_google_assessment_draft_access(uuid,uuid,text,uuid) is
  'Preflight for three unsigned manual draft types only; mutation RPCs enforce the same tenant, branch, client and action boundaries again.';
comment on function public.has_recent_body_assessment_aal2(uuid,uuid) is
  'Body assessment signer preflight only; approved Google AAL2, live role grant and same-session factor evidence are verified again during mutation.';
commit;
