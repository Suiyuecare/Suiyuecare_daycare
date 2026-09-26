-- Page 39 admission only. Global CEO, permission and recent-MFA predicates
-- intentionally remain unchanged. Approved Google staff stay organization-pinned.
create or replace function private.referral_management_user_has_permission(
 p_organization_id uuid,p_branch_id uuid,p_user_id uuid,p_permission text,p_reference_time timestamptz
) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.profiles profile
  join public.memberships membership on membership.profile_id=profile.id
  join public.membership_roles membership_role on membership_role.membership_id=membership.id
  join public.roles role on role.id=membership_role.role_id and role.is_active
  join public.role_permissions role_permission on role_permission.role_id=role.id
  join public.permissions permission on permission.id=role_permission.permission_id
  where profile.id=p_user_id and profile.is_active and profile.kind in('staff','professional')
   and membership.organization_id=p_organization_id and membership.status='active'
   and membership.starts_at<=clock_timestamp() and(membership.ends_at is null or membership.ends_at>clock_timestamp())
   and(membership.branch_id is null or membership.branch_id=p_branch_id)
   and membership_role.assigned_at<=clock_timestamp() and role_permission.granted_at<=clock_timestamp()
   and(role.organization_id is null or role.organization_id=p_organization_id)
   and permission.permission_key=p_permission);
$$;
create function private.referral_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission in('clients.read','clients.view_all','referral_management.read',
  'referral_management.create','referral_management.submit','referral_management.receive',
  'referral_management.respond','referral_management.close','referral_management.correct')
  and auth.uid() is not null
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and(private.is_executive_login_allowed() or exists(select 1 from private.routine_staff_scope() s
    where s.organization_id=p_org and(s.branch_id is null or s.branch_id=p_branch)))
  and private.referral_management_user_has_permission(p_org,p_branch,auth.uid(),p_permission,clock_timestamp()),false);
$$;
create function private.can_referral_access_client(p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission='clients.read' and exists(select 1 from public.clients c
  where c.id=p_client and private.referral_permission(c.organization_id,c.branch_id,'clients.read')
   and private.referral_permission(c.organization_id,c.branch_id,'referral_management.read')
   and(private.referral_permission(c.organization_id,c.branch_id,'clients.view_all') or exists(
    select 1 from public.client_assignments a where a.client_id=c.id and a.organization_id=c.organization_id
     and a.branch_id=c.branch_id and a.assignee_user_id=auth.uid() and a.starts_at<=clock_timestamp()
     and(a.ends_at is null or a.ends_at>clock_timestamp())))),false);
$$;
-- Eligibility to acquire MFA is distinct from clinical-write eligibility.
create function private.referral_mfa_scope(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.referral_permission(p_org,p_branch,'clients.read')
  and private.referral_permission(p_org,p_branch,'referral_management.read')
  and exists(select 1 from unnest(array['referral_management.create','referral_management.submit',
   'referral_management.receive','referral_management.respond','referral_management.close','referral_management.correct']) permission
   where private.referral_permission(p_org,p_branch,permission));
$$;
create function private.has_any_referral_mfa_scope()
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.branches b where b.is_active and private.referral_mfa_scope(b.organization_id,b.id));
$$;

create function private.referral_recent_aal2_evidence(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_session uuid;v_challenge uuid;v_verified timestamptz;
begin
 if coalesce(auth.jwt()->>'aal','')<>'aal2'
  or not private.referral_mfa_scope(p_expected_organization_id,p_expected_branch_id) then return null;end if;
 begin v_session:=(auth.jwt()->>'session_id')::uuid;exception when others then return null;end;
 select c.id,e.verified_at into v_challenge,v_verified
 from private.reauth_events e join private.reauth_challenges c
  on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
 where e.user_id=v_actor and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
  and e.verification_method in('totp','webauthn','phone') and c.consumed_at is not null
  and c.invalidated_at is null and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and e.verified_at>=clock_timestamp()-interval '15 minutes' and e.verified_at<=clock_timestamp()
 order by e.verified_at desc limit 1 for share of e,c;
 if v_challenge is null or not private.referral_mfa_scope(p_expected_organization_id,p_expected_branch_id)
  or not exists(select 1 from private.reauth_events e join private.reauth_challenges c on c.id=e.challenge_id
   where c.id=v_challenge and e.user_id=v_actor and e.session_id=v_session and c.user_id=v_actor and c.session_id=v_session
    and e.aal='aal2' and e.revoked_at is null and c.consumed_at is not null and c.invalidated_at is null
    and e.verification_method in('totp','webauthn','phone') and c.factor_method=e.verification_method
    and c.factor_verified_at=e.verified_at and e.verified_at=v_verified
    and v_verified>=clock_timestamp()-interval '15 minutes' and v_verified<=clock_timestamp())
 then return null;end if;
 return jsonb_build_object('organizationId',p_expected_organization_id,'branchId',p_expected_branch_id,
  'actorUserId',v_actor,'verifiedAt',v_verified);
end;$$;
create function public.referral_recent_aal2_evidence(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.referral_recent_aal2_evidence(p_expected_organization_id,p_expected_branch_id);
$$;
create or replace function private.referral_management_authority(
 p_organization_id uuid,p_branch_id uuid,p_permission text,p_require_recent_aal2 boolean default false
) returns boolean language sql volatile security definer set search_path='' as $$
 select private.referral_permission(p_organization_id,p_branch_id,'clients.read')
  and private.referral_permission(p_organization_id,p_branch_id,'referral_management.read')
  and private.referral_permission(p_organization_id,p_branch_id,p_permission)
  and(not p_require_recent_aal2 or private.referral_recent_aal2_evidence(p_organization_id,p_branch_id) is not null);
$$;

-- Fail loudly if a preceding definition changed: bounded replacements preserve
-- all existing validation, immutable ledgers, transitions and public RPC shape.
do $$declare source text;changed text;begin
 source:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
 changed:=replace(source,'private.has_any_nursing_mfa_scope()',
  'private.has_any_nursing_mfa_scope() or private.has_any_referral_mfa_scope()');
 if changed=source then raise exception 'referral MFA acquisition anchor missing';end if;execute changed;
 source:=pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure);
 changed:=replace(source,'v_nursing_path boolean := false;','v_module_path text;');
 if changed=source then raise exception 'referral selected MFA declaration anchor missing';end if;
 changed:=replace(changed,'private.is_active_user() or private.has_any_custom_governance_scope() or private.has_any_nursing_mfa_scope()',
  'private.is_active_user() or private.has_any_custom_governance_scope() or private.has_any_nursing_mfa_scope() or private.has_any_referral_mfa_scope()');
 if strpos(changed,'v_nursing_path := not (private.is_active_user() or private.has_any_custom_governance_scope());')=0 then raise exception 'referral selected MFA capture anchor missing';end if;
 changed:=replace(changed,'v_nursing_path := not (private.is_active_user() or private.has_any_custom_governance_scope());',
  E'v_module_path := case when private.is_active_user() then \'executive\'\n    when private.has_any_custom_governance_scope() then \'custom\'\n    when private.has_any_nursing_mfa_scope() then \'nursing\'\n    when private.has_any_referral_mfa_scope() then \'referral\' end;\n  if v_module_path is null then return false;end if;');
 if strpos(changed,'if v_nursing_path and not private.has_any_nursing_mfa_scope() then')=0 then raise exception 'referral selected MFA final anchor missing';end if;
 changed:=replace(changed,'if v_nursing_path and not private.has_any_nursing_mfa_scope() then',
  E'if not coalesce(case v_module_path when \'executive\' then private.is_active_user()\n    when \'custom\' then private.has_any_custom_governance_scope()\n    when \'nursing\' then private.has_any_nursing_mfa_scope()\n    when \'referral\' then private.has_any_referral_mfa_scope() end,false) then');
 changed:=replace(changed,'nursing MFA admission expired after evidence write','selected MFA admission expired after evidence write');
 execute changed;

 source:=pg_get_functiondef('private.referral_management_staff_snapshot(uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure);
 changed:=replace(source,'LANGUAGE sql STABLE','LANGUAGE sql VOLATILE');
 changed:=replace(changed,'private.can_staff_access_client(', 'private.can_referral_access_client(');
 changed:=replace(changed,'membership.starts_at <= p_reference_time','membership.starts_at <= clock_timestamp()');
 changed:=replace(changed,'membership.ends_at > p_reference_time','membership.ends_at > clock_timestamp()');
 if changed=source then raise exception 'referral staff source anchor missing';end if;execute changed;

 source:=pg_get_functiondef('private.require_referral_management_reauth(uuid,timestamptz)'::regprocedure);
 changed:=replace(source,'if v_challenge_id is null then',E'if v_challenge_id is null or p_actor is distinct from auth.uid()\n    or not exists(select 1 from private.reauth_events e join private.reauth_challenges c on c.id=e.challenge_id\n      where c.id=v_challenge_id and e.user_id=p_actor and e.session_id=v_session_id and c.user_id=p_actor and c.session_id=v_session_id\n        and e.aal=\'aal2\' and e.revoked_at is null and c.consumed_at is not null and c.invalidated_at is null\n        and e.verification_method in(\'totp\',\'webauthn\',\'phone\') and c.factor_method=e.verification_method\n        and c.factor_verified_at=e.verified_at and e.verified_at>=clock_timestamp()-interval \'15 minutes\'\n        and e.verified_at<=clock_timestamp()) then');
 if changed=source then raise exception 'referral post-lock evidence anchor missing';end if;execute changed;

 source:=pg_get_functiondef('private.mutate_referral_management_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)'::regprocedure);
 changed:=replace(source,'private.has_permission(', 'private.referral_permission(');
 changed:=replace(changed,'private.can_staff_access_client(', 'private.can_referral_access_client(');
 changed:=replace(changed,E'    return query select p_expected_organization_id, p_expected_branch_id,\n      v_operation.id',E'    if not exists(select 1 from public.referral_events e where e.id=v_operation.result_event_id\n      and e.organization_id=p_expected_organization_id and e.branch_id=p_expected_branch_id\n      and private.can_referral_access_client(e.client_id,\'clients.read\'))\n      or not private.referral_management_authority(p_expected_organization_id,p_expected_branch_id,v_permission,true) then\n      raise exception using errcode=\'42501\',message=\'referral replay client authority expired\';end if;\n    return query select p_expected_organization_id, p_expected_branch_id,\n      v_operation.id');
 changed:=replace(changed,E'  return query select p_expected_organization_id, p_expected_branch_id,\n    v_operation_id',E'  if not private.can_referral_access_client(v_client_id,\'clients.read\')\n    or not private.referral_management_authority(p_expected_organization_id,p_expected_branch_id,v_permission,true) then\n    raise exception using errcode=\'42501\',message=\'referral client authority expired\';end if;\n  return query select p_expected_organization_id, p_expected_branch_id,\n    v_operation_id');
 if changed=source or strpos(changed,'referral replay client authority expired')=0 or strpos(changed,'referral client authority expired')=0 then raise exception 'referral mutation guard anchors missing';end if;execute changed;

 source:=pg_get_functiondef('private.referral_management_snapshot_response(uuid,uuid,uuid,text,text,text,date,date,text)'::regprocedure);
 changed:=replace(source,'private.has_permission(', 'private.referral_permission(');
 changed:=replace(changed,'private.can_staff_access_client(', 'private.can_referral_access_client(');
 changed:=replace(changed,E'  v_clients jsonb; v_units jsonb;\n',E'  v_clients jsonb; v_units jsonb;\n  v_access_ids uuid[];\n');
 changed:=replace(changed,E'  with current_events as materialized (',E'  select coalesce(array_agg(c.id order by c.id),\'{}\'::uuid[]) into v_access_ids from public.clients c\n    where c.organization_id=p_expected_organization_id and c.branch_id=p_expected_branch_id\n      and private.can_referral_access_client(c.id,\'clients.read\');\n  with current_events as materialized (');
 changed:=replace(changed,E'  return query select p_expected_organization_id, v_organization_name,',E'  if v_access_ids is distinct from (select coalesce(array_agg(c.id order by c.id),\'{}\'::uuid[]) from public.clients c\n      where c.organization_id=p_expected_organization_id and c.branch_id=p_expected_branch_id\n        and private.can_referral_access_client(c.id,\'clients.read\'))\n    or not private.referral_management_authority(p_expected_organization_id,p_expected_branch_id,\'referral_management.read\',false) then\n    raise exception using errcode=\'42501\',message=\'referral snapshot client scope changed\';end if;\n  return query select p_expected_organization_id, v_organization_name,');
 if changed=source or strpos(changed,'v_access_ids uuid[]')=0 or strpos(changed,'referral snapshot client scope changed')=0 then raise exception 'referral snapshot guard anchors missing';end if;execute changed;
end;$$;

alter function private.referral_permission(uuid,uuid,text) owner to postgres;
alter function private.can_referral_access_client(uuid,text) owner to postgres;
alter function private.referral_mfa_scope(uuid,uuid) owner to postgres;
alter function private.has_any_referral_mfa_scope() owner to postgres;
alter function private.referral_recent_aal2_evidence(uuid,uuid) owner to postgres;
alter function public.referral_recent_aal2_evidence(uuid,uuid) owner to postgres;
revoke all on function private.referral_permission(uuid,uuid,text),private.can_referral_access_client(uuid,text),
 private.referral_mfa_scope(uuid,uuid),private.has_any_referral_mfa_scope(),
 private.referral_recent_aal2_evidence(uuid,uuid),public.referral_recent_aal2_evidence(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.referral_recent_aal2_evidence(uuid,uuid),public.referral_recent_aal2_evidence(uuid,uuid) to authenticated;
