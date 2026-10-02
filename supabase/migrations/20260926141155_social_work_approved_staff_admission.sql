-- Pages 28/29 only: approved Google staff, effective scoped capabilities and
-- current assignments. Global CEO/permission/recent-MFA predicates unchanged.
create function private.social_work_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission in('clients.read','clients.view_all','social_work_records.read','social_work_records.manage','social_work_records.sign')
  and auth.uid() is not null
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and(private.is_executive_login_allowed() or exists(select 1 from private.routine_staff_scope() s where s.organization_id=p_org and(s.branch_id is null or s.branch_id=p_branch)))
  and exists(select 1 from public.profiles profile join public.memberships m on m.profile_id=profile.id
   join public.membership_roles mr on mr.membership_id=m.id
   join public.roles r on r.id=mr.role_id and r.is_active
   join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
   where profile.id=auth.uid() and profile.is_active and profile.kind in('staff','professional')
    and m.organization_id=p_org and m.status='active' and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
    and(m.branch_id is null or m.branch_id=p_branch) and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp()
    and(r.organization_id is null or r.organization_id=p_org) and p.permission_key=p_permission),false);
$$;
create function private.can_social_work_access_client(p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission in('clients.read','social_work_records.read','social_work_records.manage','social_work_records.sign')
  and exists(select 1 from public.clients c where c.id=p_client
   and private.social_work_permission(c.organization_id,c.branch_id,'clients.read')
   and private.social_work_permission(c.organization_id,c.branch_id,'social_work_records.read')
   and private.social_work_permission(c.organization_id,c.branch_id,p_permission)
   and(private.social_work_permission(c.organization_id,c.branch_id,'clients.view_all') or exists(select 1 from public.client_assignments a
    where a.client_id=c.id and a.organization_id=c.organization_id and a.branch_id=c.branch_id and a.assignee_user_id=auth.uid()
     and a.starts_at<=clock_timestamp() and(a.ends_at is null or a.ends_at>clock_timestamp())))),false);
$$;
create function private.social_work_mfa_scope(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.social_work_permission(p_org,p_branch,'clients.read')
  and private.social_work_permission(p_org,p_branch,'social_work_records.read')
  and private.social_work_permission(p_org,p_branch,'social_work_records.sign');
$$;
create function private.has_any_social_work_mfa_scope()
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.branches b where b.is_active and private.social_work_mfa_scope(b.organization_id,b.id));
$$;
create function private.social_work_recent_aal2_evidence(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_session uuid;v_challenge uuid;v_verified timestamptz;
begin
 if coalesce(auth.jwt()->>'aal','')<>'aal2' or not private.social_work_mfa_scope(p_expected_organization_id,p_expected_branch_id) then return null;end if;
 begin v_session:=(auth.jwt()->>'session_id')::uuid;exception when others then return null;end;
 select c.id,e.verified_at into v_challenge,v_verified from private.reauth_events e join private.reauth_challenges c
  on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
 where e.user_id=v_actor and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
  and e.verification_method in('totp','webauthn','phone') and c.consumed_at is not null and c.invalidated_at is null
  and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and e.verified_at>=clock_timestamp()-interval '15 minutes' and e.verified_at<=clock_timestamp()
 order by e.verified_at desc limit 1 for share of e,c;
 if v_challenge is null or not private.social_work_mfa_scope(p_expected_organization_id,p_expected_branch_id)
  or not exists(select 1 from private.reauth_events e join private.reauth_challenges c on c.id=e.challenge_id
   where c.id=v_challenge and e.user_id=v_actor and e.session_id=v_session and c.user_id=v_actor and c.session_id=v_session
    and e.aal='aal2' and e.revoked_at is null and c.consumed_at is not null and c.invalidated_at is null
    and e.verification_method in('totp','webauthn','phone') and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
    and e.verified_at=v_verified and v_verified>=clock_timestamp()-interval '15 minutes' and v_verified<=clock_timestamp()) then return null;end if;
 return jsonb_build_object('organizationId',p_expected_organization_id,'branchId',p_expected_branch_id,'actorUserId',v_actor,'verifiedAt',v_verified);
end;$$;
create function public.social_work_recent_aal2_evidence(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.social_work_recent_aal2_evidence(p_expected_organization_id,p_expected_branch_id);
$$;
create function private.require_social_work_scoped_reauth(p_actor uuid,p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_evidence jsonb;v_challenge uuid;
begin
 if p_actor is distinct from auth.uid() then raise exception using errcode='42501',message='social-work signer identity is invalid';end if;
 v_evidence:=private.social_work_recent_aal2_evidence(p_org,p_branch);
 if v_evidence is null then raise exception using errcode='42501',message='current same-session recent social-work AAL2 evidence is required';end if;
 select e.challenge_id into v_challenge from private.reauth_events e
 where e.user_id=p_actor and e.session_id=(auth.jwt()->>'session_id')::uuid and e.revoked_at is null
  and e.verified_at=(v_evidence->>'verifiedAt')::timestamptz;
 if v_challenge is null or not private.social_work_mfa_scope(p_org,p_branch) then raise exception using errcode='42501',message='social-work verification authority expired';end if;
 return v_challenge;
end;$$;

-- Per-function verified anchors: retain validators, immutable evidence, audit,
-- idempotency and before/after snapshot comparison. A source drift aborts DDL.
do $$declare source text;changed text;fn text;function_id oid;anchor text;begin
 foreach fn in array array['psychosocial_current_authority','social_work_current_authority',
  'psychosocial_client_authority','social_work_client_authority','psychosocial_assessment_snapshot_bundle',
  'social_work_service_snapshot_bundle','psychosocial_assessment_snapshot_response'] loop
  if(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=fn)<>1 then raise exception 'social-work function signature drift: %',fn;end if;
  select p.oid into function_id from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=fn;
  source:=pg_get_functiondef(function_id);
  if fn like '%current_authority' then
   if strpos(source,'private.has_permission(')=0 then raise exception 'social-work authority anchor missing: %',fn;end if;
   changed:=replace(source,'private.has_permission(','private.social_work_permission(');
  else
   if strpos(source,'private.can_staff_access_client(')=0 then raise exception 'social-work client/snapshot anchor missing: %',fn;end if;
   changed:=replace(source,'private.can_staff_access_client(','private.can_social_work_access_client(');
  end if;
  changed:=replace(changed,'STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER');
  if changed=source then raise exception 'social-work no-op patch: %',fn;end if;execute changed;
 end loop;
 source:=pg_get_functiondef('private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)'::regprocedure);
 if strpos(source,'private.social_work_current_authority(')=0 or strpos(source,'v_after is distinct from v_bundle')=0 then raise exception 'social-work read before/after anchors missing';end if;
 foreach fn in array array['mutate_psychosocial_assessment_guarded','mutate_social_work_service_record_guarded'] loop
  if(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=fn)<>1 then raise exception 'social-work mutation signature drift: %',fn;end if;
  select p.oid into function_id from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=fn;
  source:=pg_get_functiondef(function_id);
  anchor:=case when fn='mutate_psychosocial_assessment_guarded' then E'private.require_psychosocial_reauth_evidence(\n      v_actor, v_now\n    )' else 'private.require_social_work_reauth_evidence(v_actor, v_now)' end;
  if strpos(source,anchor)=0 then raise exception 'social-work scoped sign anchor missing: %',fn;end if;
  changed:=replace(source,anchor,'private.require_social_work_scoped_reauth(v_actor,p_expected_organization_id,p_expected_branch_id)');
  -- All receipt returns, including exact replay, re-check current evidence for
  -- sign/correct. Draft/revise retain their original non-signing AAL2 policy.
  if strpos(changed,'return query select v_operation.id')=0 then raise exception 'social-work receipt anchor missing: %',fn;end if;
  changed:=replace(changed,'return query select v_operation.id',E'if p_action in (\'sign\',\'correct\') then perform private.require_social_work_scoped_reauth(v_actor,p_expected_organization_id,p_expected_branch_id);end if;\n  return query select v_operation.id');
  if strpos(changed,'membership.starts_at <= v_now')=0 or strpos(changed,'membership.ends_at > v_now')=0 or strpos(changed,'on membership_role.membership_id = membership.id')=0 then raise exception 'social-work signer role anchor missing: %',fn;end if;
  changed:=replace(changed,'membership.starts_at <= v_now','membership.starts_at <= clock_timestamp()');
  changed:=replace(changed,'membership.ends_at > v_now','membership.ends_at > clock_timestamp()');
  changed:=replace(changed,'on membership_role.membership_id = membership.id','on membership_role.membership_id = membership.id and membership_role.assigned_at<=clock_timestamp()');
  execute changed;
 end loop;
 source:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
 changed:=replace(source,'private.has_any_referral_mfa_scope()','private.has_any_referral_mfa_scope() or private.has_any_social_work_mfa_scope()');
 if changed=source then raise exception 'social-work MFA acquisition anchor missing';end if;execute changed;
 source:=pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure);
 anchor:='private.is_active_user() or private.has_any_custom_governance_scope() or private.has_any_nursing_mfa_scope() or private.has_any_referral_mfa_scope()';
 if strpos(source,anchor)=0 then raise exception 'social-work MFA admission anchor missing';end if;
 changed:=replace(source,anchor,anchor||' or private.has_any_social_work_mfa_scope()');
 anchor:=E'when private.has_any_referral_mfa_scope() then \'referral\' end;';
 if strpos(changed,anchor)=0 then raise exception 'social-work selected MFA capture anchor missing';end if;
 changed:=replace(changed,anchor,E'when private.has_any_referral_mfa_scope() then \'referral\'\n    when private.has_any_social_work_mfa_scope() then \'social_work\' end;');
 anchor:=E'when \'referral\' then private.has_any_referral_mfa_scope() end';
 if strpos(changed,anchor)=0 then raise exception 'social-work selected MFA final anchor missing';end if;
 changed:=replace(changed,anchor,E'when \'referral\' then private.has_any_referral_mfa_scope()\n    when \'social_work\' then private.has_any_social_work_mfa_scope() end');
 execute changed;
end;$$;

alter function private.social_work_permission(uuid,uuid,text) owner to postgres;
alter function private.can_social_work_access_client(uuid,text) owner to postgres;
alter function private.social_work_mfa_scope(uuid,uuid) owner to postgres;
alter function private.has_any_social_work_mfa_scope() owner to postgres;
alter function private.social_work_recent_aal2_evidence(uuid,uuid) owner to postgres;
alter function public.social_work_recent_aal2_evidence(uuid,uuid) owner to postgres;
alter function private.require_social_work_scoped_reauth(uuid,uuid,uuid) owner to postgres;
revoke all on function private.social_work_permission(uuid,uuid,text),private.can_social_work_access_client(uuid,text),
 private.social_work_mfa_scope(uuid,uuid),private.has_any_social_work_mfa_scope(),private.require_social_work_scoped_reauth(uuid,uuid,uuid),
 private.social_work_recent_aal2_evidence(uuid,uuid),public.social_work_recent_aal2_evidence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.social_work_recent_aal2_evidence(uuid,uuid),public.social_work_recent_aal2_evidence(uuid,uuid) to authenticated;
