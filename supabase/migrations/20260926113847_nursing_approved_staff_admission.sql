-- Admit individually approved Google staff to the existing nursing boundary.
-- Admission is pinned to the grant's organization and an effective membership
-- scope. A second membership/assignment elsewhere never expands that grant.
-- The CEO path and every existing role/AAL2/assignment/signature guard remain.
-- Permission union must include only roles and grants already in effect. An
-- otherwise-valid nurse cannot borrow a future manager role's view_all grant.
create or replace function private.nursing_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
  join public.roles r on r.id=mr.role_id and r.is_active
  join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
  where m.profile_id=auth.uid() and m.organization_id=p_org and(m.branch_id is null or m.branch_id=p_branch)
   and m.status='active' and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
   and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp()
   and(r.organization_id is null or r.organization_id=p_org) and p.permission_key=p_permission);
$$;
alter function private.nursing_permission(uuid,uuid,text) owner to postgres;
revoke all on function private.nursing_permission(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function private.nursing_authority(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select case when private.is_executive_login_allowed() or exists (
  select 1 from private.routine_staff_scope() s
  where s.organization_id=p_org and (s.branch_id is null or s.branch_id=p_branch)
 ) then (
  select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
    and p_permission in ('nursing_assessments.read','nursing_assessments.manage','nursing_assessments.sign')
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind='staff')
    and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
      where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
    and private.nursing_permission(p_org,p_branch,'clients.read')
    and private.nursing_permission(p_org,p_branch,'nursing_assessments.read')
    and private.nursing_permission(p_org,p_branch,p_permission)
    and (p_client is null or exists(select 1 from public.clients c where c.id=p_client
      and c.organization_id=p_org and c.branch_id=p_branch
      and (private.nursing_permission(p_org,p_branch,'clients.view_all') or exists (
        select 1 from public.client_assignments a where a.client_id=c.id
          and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
          and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())
      ))))
    and (p_permission='nursing_assessments.read' or (
      exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
        join public.roles r on r.id=mr.role_id where m.profile_id=auth.uid()
        and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
        and m.status='active' and m.starts_at<=clock_timestamp()
        and (m.ends_at is null or m.ends_at>clock_timestamp())
        and mr.assigned_at<=clock_timestamp() and r.is_system and r.is_active and r.role_key='nurse')
      and exists(select 1 from public.client_assignments a where a.client_id=p_client
        and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
        and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))
    )),false)
 ) else false end;
$$;
alter function private.nursing_authority(uuid,uuid,uuid,text) owner to postgres;
revoke all on function private.nursing_authority(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
comment on function private.nursing_authority(uuid,uuid,uuid,text) is
 'Current nursing boundary: original CEO or individually approved Google staff in their pinned organization/effective membership scope; unchanged AAL2, nursing role, assignment and operation-specific evidence requirements.';

-- This is an admission capability, not a clinical-write/assignment predicate.
-- AAL1 is needed to acquire MFA; no clinical operation gains AAL1 permission.
create function private.nursing_mfa_scope(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_org is not null and p_branch is not null and auth.uid() is not null
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind='staff')
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and (private.is_executive_login_allowed() or exists(select 1 from private.routine_staff_scope() s
    where s.organization_id=p_org and(s.branch_id is null or s.branch_id=p_branch)))
  and private.nursing_permission(p_org,p_branch,'clients.read')
  and private.nursing_permission(p_org,p_branch,'nursing_assessments.read')
  and private.nursing_permission(p_org,p_branch,'nursing_assessments.sign')
  and exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id where m.profile_id=auth.uid()
    and m.organization_id=p_org and(m.branch_id is null or m.branch_id=p_branch)
    and m.status='active' and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
    and mr.assigned_at<=clock_timestamp() and r.is_system and r.is_active and r.role_key='nurse'),false);
$$;
create function private.has_any_nursing_mfa_scope()
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.branches b where b.is_active and private.nursing_mfa_scope(b.organization_id,b.id));
$$;
alter function private.nursing_mfa_scope(uuid,uuid) owner to postgres;
alter function private.has_any_nursing_mfa_scope() owner to postgres;
revoke all on function private.nursing_mfa_scope(uuid,uuid),private.has_any_nursing_mfa_scope()
 from public,anon,authenticated,service_role;

-- Preserve both original CEO and custom-governance paths verbatim. Only the
-- new nurse path gains admission, with wall-clock checks after waits/writes.
do $$declare source text;changed text;begin
 source:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
 changed:=replace(source,'private.is_executive_login_allowed() or private.has_any_custom_governance_scope()',
  'private.is_executive_login_allowed() or private.has_any_custom_governance_scope() or private.has_any_nursing_mfa_scope()');
 if changed=source then raise exception 'nursing MFA admission anchor missing';end if;execute changed;
 source:=pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure);
 changed:=replace(source,E'  v_headers jsonb;\n',E'  v_headers jsonb;\n  v_nursing_path boolean := false;\n');
 if changed=source then raise exception 'nursing MFA path capture anchor missing';end if;
 changed:=replace(changed,'private.is_active_user() or private.has_any_custom_governance_scope()',
  'private.is_active_user() or private.has_any_custom_governance_scope() or private.has_any_nursing_mfa_scope()');
 -- Capture which admission path actually permits consumption AFTER the row
 -- lock, not the caller's possibly obsolete pre-wait capability.
 if strpos(changed,E'  update private.reauth_challenges\n')=0 then raise exception 'nursing MFA consumption anchor missing';end if;
 changed:=replace(changed,E'  update private.reauth_challenges\n',E'  v_nursing_path := not (private.is_active_user() or private.has_any_custom_governance_scope());\n  update private.reauth_challenges\n');
 if strpos(changed,E'  return true;\n')=0 then raise exception 'nursing MFA final authority anchor missing';end if;
 changed:=replace(changed,E'  return true;\n',E'  if v_nursing_path and not private.has_any_nursing_mfa_scope() then\n    raise exception using errcode=\'42501\',message=\'nursing MFA admission expired after evidence write\';\n  end if;\n  return true;\n');
 execute changed;
 source:=pg_get_functiondef('private.nursing_reauth(uuid)'::regprocedure);
 changed:=replace(source,'not private.has_recent_aal2(15)',
  'not (private.has_recent_aal2(15) or private.has_any_nursing_mfa_scope())');
 if changed=source then raise exception 'nursing recent evidence admission anchor missing';end if;
 changed:=replace(changed,'return v_id;',E'if not (private.has_recent_aal2(15) or private.has_any_nursing_mfa_scope())\n    or not exists(select 1 from private.reauth_events e join private.reauth_challenges c on c.id=e.challenge_id\n      where c.id=v_id and e.user_id=p_actor and e.session_id=v_session and c.user_id=p_actor and c.session_id=v_session\n        and e.aal=\'aal2\' and e.revoked_at is null and c.consumed_at is not null and c.invalidated_at is null\n        and e.verification_method in(\'totp\',\'webauthn\',\'phone\') and c.factor_method=e.verification_method\n        and c.factor_verified_at=e.verified_at and e.verified_at>=clock_timestamp()-interval \'15 minutes\'\n        and e.verified_at<=clock_timestamp()+interval \'1 minute\') then\n    raise exception using errcode=\'42501\',message=\'nursing signing requires recent same-session AAL2\';end if;\n  return v_id;');
 execute changed;
end;$$;

-- Read-only server evidence: never substitute browser time or an AAL flag for
-- the actual consumed, non-invalidated, same-session verification timestamp.
create function private.nursing_recent_aal2_evidence(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_session uuid;v_challenge uuid;v_verified timestamptz;
begin
 if coalesce(auth.jwt()->>'aal','')<>'aal2'
  or not private.nursing_mfa_scope(p_expected_organization_id,p_expected_branch_id) then return null;end if;
 begin v_session:=(auth.jwt()->>'session_id')::uuid;exception when others then return null;end;
 select c.id,e.verified_at into v_challenge,v_verified
 from private.reauth_events e join private.reauth_challenges c
  on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
 where e.user_id=v_actor and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
  and e.verification_method in('totp','webauthn','phone') and c.consumed_at is not null
  and c.invalidated_at is null and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and e.verified_at>=clock_timestamp()-interval '15 minutes' and e.verified_at<=clock_timestamp()+interval '1 minute'
 order by e.verified_at desc limit 1 for share of e,c;
 if v_challenge is null or not private.nursing_mfa_scope(p_expected_organization_id,p_expected_branch_id)
  or not exists(select 1 from private.reauth_events e join private.reauth_challenges c on c.id=e.challenge_id
   where c.id=v_challenge and e.user_id=v_actor and e.session_id=v_session and c.user_id=v_actor and c.session_id=v_session
    and e.aal='aal2' and e.revoked_at is null and c.consumed_at is not null and c.invalidated_at is null
    and e.verification_method in('totp','webauthn','phone') and c.factor_method=e.verification_method
    and c.factor_verified_at=e.verified_at and e.verified_at=v_verified
    and v_verified>=clock_timestamp()-interval '15 minutes' and v_verified<=clock_timestamp()+interval '1 minute')
 then return null;end if;
 return jsonb_build_object('organizationId',p_expected_organization_id,'branchId',p_expected_branch_id,
  'actorUserId',v_actor,'verifiedAt',v_verified);
end;$$;
create function public.nursing_recent_aal2_evidence(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.nursing_recent_aal2_evidence(p_expected_organization_id,p_expected_branch_id);
$$;
alter function private.nursing_recent_aal2_evidence(uuid,uuid) owner to postgres;
alter function public.nursing_recent_aal2_evidence(uuid,uuid) owner to postgres;
revoke all on function private.nursing_recent_aal2_evidence(uuid,uuid),public.nursing_recent_aal2_evidence(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.nursing_recent_aal2_evidence(uuid,uuid),public.nursing_recent_aal2_evidence(uuid,uuid) to authenticated;
