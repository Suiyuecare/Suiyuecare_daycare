-- Keep the executive's AAL1 Google session narrow: only reviewed assessment
-- drafts and vaccination reads/individual entry may use it. All other
-- permissions still follow the existing AAL2 and RLS gates.

create or replace function private.executive_scoped_permission(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission_key text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->>'aal','') = 'aal1'
    and private.is_executive_login_allowed()
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff','professional')
        and profile.is_active
    )
    and exists (
      select 1 from public.organizations organization
      where organization.id = p_organization_id and organization.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and exists (
      select 1
      from public.memberships membership
      join public.membership_roles membership_role
        on membership_role.membership_id = membership.id
      join public.roles role
        on role.id = membership_role.role_id and role.is_active
      join public.role_permissions role_permission
        on role_permission.role_id = role.id
      join public.permissions permission
        on permission.id = role_permission.permission_id
      where membership.profile_id = auth.uid()
        and membership.organization_id = p_organization_id
        and membership.status = 'active'
        and membership.starts_at <= clock_timestamp()
        and (membership.ends_at is null or membership.ends_at > clock_timestamp())
        and (membership.branch_id is null or membership.branch_id = p_branch_id)
        and (role.organization_id is null or role.organization_id = p_organization_id)
        and membership_role.assigned_at <= clock_timestamp()
        and role_permission.granted_at <= clock_timestamp()
        and permission.permission_key = p_permission_key
    );
$$;

create or replace function private.executive_scoped_client_permission(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_id uuid,
  p_permission_key text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_client_id is not null
    and private.executive_scoped_permission(
      p_organization_id,p_branch_id,'clients.read')
    and private.executive_scoped_permission(
      p_organization_id,p_branch_id,p_permission_key)
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_organization_id
        and client.branch_id = p_branch_id
    )
    and (
      private.executive_scoped_permission(
        p_organization_id,p_branch_id,'clients.view_all')
      or exists (
        select 1 from public.client_assignments assignment
        where assignment.client_id = p_client_id
          and assignment.organization_id = p_organization_id
          and assignment.branch_id = p_branch_id
          and assignment.assignee_user_id = auth.uid()
          and assignment.starts_at <= clock_timestamp()
          and (assignment.ends_at is null or assignment.ends_at > clock_timestamp())
      )
    );
$$;

alter function private.executive_scoped_permission(uuid,uuid,text) owner to postgres;
alter function private.executive_scoped_client_permission(uuid,uuid,uuid,text) owner to postgres;
revoke all on function private.executive_scoped_permission(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.executive_scoped_client_permission(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function private.spmsq_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_permission in ('assessments.read','assessments.manage')
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or private.executive_scoped_permission(
          p_expected_organization_id,p_expected_branch_id,p_permission));
$$;

create or replace function private.spmsq_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.spmsq_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.can_staff_access_client(p_client_id,'clients.read')
          and private.can_staff_access_client(p_client_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,'clients.read')
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,p_permission)));
$$;

create or replace function private.gds_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_permission in ('gds_assessments.read','gds_assessments.manage','gds_assessments.sign')
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or private.executive_scoped_permission(
          p_expected_organization_id,p_expected_branch_id,p_permission));
$$;

create or replace function private.gds_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.gds_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.can_staff_access_client(p_client_id,'clients.read')
          and private.can_staff_access_client(p_client_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,'clients.read')
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,p_permission)));
$$;

create or replace function private.fall_risk_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_permission in ('fall_risk_assessments.read','fall_risk_assessments.manage','fall_risk_assessments.sign')
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or private.executive_scoped_permission(
          p_expected_organization_id,p_expected_branch_id,p_permission));
$$;

create or replace function private.fall_risk_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.fall_risk_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.can_staff_access_client(p_client_id,'clients.read')
          and private.can_staff_access_client(p_client_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,'clients.read')
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,p_permission)));
$$;

create or replace function private.nsi_nutrition_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_permission in ('nsi_nutrition_screenings.read','nsi_nutrition_screenings.manage','nsi_nutrition_screenings.sign')
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or private.executive_scoped_permission(
          p_expected_organization_id,p_expected_branch_id,p_permission));
$$;

create or replace function private.nsi_nutrition_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.nsi_nutrition_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
          and private.can_staff_access_client(p_client_id,'clients.read')
          and private.can_staff_access_client(p_client_id,p_permission))
      or (coalesce(auth.jwt()->>'aal','')='aal1'
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,'clients.read')
          and private.executive_scoped_client_permission(
            p_expected_organization_id,p_expected_branch_id,p_client_id,p_permission)));
$$;

create or replace function private.client_vaccination_current_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
      and private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.read')
      and private.has_permission(p_expected_organization_id,p_expected_branch_id,'client_vaccinations.read')
      and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
    or (private.executive_scoped_permission(p_expected_organization_id,p_expected_branch_id,'clients.read')
      and private.executive_scoped_permission(p_expected_organization_id,p_expected_branch_id,'client_vaccinations.read')
      and private.executive_scoped_permission(p_expected_organization_id,p_expected_branch_id,p_permission)));
$$;

create or replace function private.client_vaccination_client_authority(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.client_vaccination_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
      and private.can_staff_access_client(p_client_id,'clients.read')
      and private.can_staff_access_client(p_client_id,'client_vaccinations.read')
      and private.can_staff_access_client(p_client_id,p_permission))
    or (coalesce(auth.jwt()->>'aal','')='aal1'
      and private.executive_scoped_client_permission(
        p_expected_organization_id,p_expected_branch_id,p_client_id,'clients.read')
      and private.executive_scoped_client_permission(
        p_expected_organization_id,p_expected_branch_id,p_client_id,'client_vaccinations.read')
      and private.executive_scoped_client_permission(
        p_expected_organization_id,p_expected_branch_id,p_client_id,p_permission)));
$$;

-- Candidate observations remain unsigned and unstandardized. The allowlisted
-- executive may save only a draft after the guarded mutation has checked the
-- module permission and assigned-client scope. No AAL2 evidence is fabricated.
create or replace function private.require_candidate_assessment_draft_evidence(
  p_actor uuid,p_reference_time timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid() then
    raise exception using errcode='42501',message='same signed-in actor required for assessment draft';
  end if;
  if coalesce(auth.jwt()->>'aal','')='aal1'
    and private.is_executive_login_allowed()
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active) then
    return null;
  end if;
  if coalesce(auth.jwt()->>'aal','') <> 'aal2' or not private.has_recent_aal2(15) then
    raise exception using errcode='42501',message='recent same-session AAL2 required for assessment draft';
  end if;
  begin
    v_session_id := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='recent same-session AAL2 required for assessment draft';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id=event.challenge_id and challenge.user_id=event.user_id
   and challenge.session_id=event.session_id
  where event.user_id=p_actor and event.session_id=v_session_id and event.aal='aal2'
    and event.revoked_at is null and event.verification_method in ('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and challenge.factor_verified_at=event.verified_at
    and challenge.factor_verified_at>=p_reference_time-interval '15 minutes'
    and challenge.factor_verified_at<=p_reference_time+interval '1 minute'
  order by challenge.factor_verified_at desc,challenge.id desc
  limit 1 for share of event,challenge;
  if v_challenge_id is null then
    raise exception using errcode='42501',message='recent same-session AAL2 required for assessment draft';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.require_spmsq_reauth_evidence(
  p_actor uuid,p_reference_time timestamptz
) returns uuid language sql volatile security definer set search_path = '' as $$
  select private.require_candidate_assessment_draft_evidence(p_actor,p_reference_time);
$$;
create or replace function private.require_gds_reauth_evidence(
  p_actor uuid,p_reference_time timestamptz
) returns uuid language sql volatile security definer set search_path = '' as $$
  select private.require_candidate_assessment_draft_evidence(p_actor,p_reference_time);
$$;
create or replace function private.require_fall_risk_reauth_evidence(
  p_actor uuid,p_reference_time timestamptz
) returns uuid language sql volatile security definer set search_path = '' as $$
  select private.require_candidate_assessment_draft_evidence(p_actor,p_reference_time);
$$;
create or replace function private.require_nsi_nutrition_reauth_evidence(
  p_actor uuid,p_reference_time timestamptz
) returns uuid language sql volatile security definer set search_path = '' as $$
  select private.require_candidate_assessment_draft_evidence(p_actor,p_reference_time);
$$;
alter function private.require_candidate_assessment_draft_evidence(uuid,timestamptz) owner to postgres;
revoke all on function private.require_candidate_assessment_draft_evidence(uuid,timestamptz)
  from public,anon,authenticated,service_role;

alter table public.spmsq_assessment_versions alter column write_reauth_challenge_id drop not null;
alter table private.spmsq_assessment_operations alter column reauth_challenge_id drop not null;
alter table public.gds_assessment_versions alter column write_reauth_challenge_id drop not null;
alter table private.gds_assessment_operations alter column reauth_challenge_id drop not null;
alter table public.fall_risk_assessment_versions alter column write_reauth_challenge_id drop not null;
alter table private.fall_risk_assessment_operations alter column reauth_challenge_id drop not null;
alter table public.nsi_nutrition_screening_versions alter column write_reauth_challenge_id drop not null;
alter table private.nsi_nutrition_screening_operations alter column reauth_challenge_id drop not null;

comment on function private.executive_scoped_permission(uuid,uuid,text) is
  'AAL1 authorization is limited to the allowlisted executive Google login and an active organization, branch, membership, role, and permission.';
comment on function private.executive_scoped_client_permission(uuid,uuid,uuid,text) is
  'AAL1 client access additionally requires clients.read and either clients.view_all or a current assignment.';
comment on function private.require_candidate_assessment_draft_evidence(uuid,timestamptz) is
  'Allows an allowlisted active executive to save unsigned candidate drafts with NULL step-up evidence; ordinary users still require recent AAL2.';
