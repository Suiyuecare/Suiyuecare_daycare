-- Candidate only. A timed-out decision may already have committed even after
-- its preview and AAL2 challenge expire. This endpoint never creates a review:
-- it only returns the exact same actor/session/request receipt, if committed.
begin;
set local lock_timeout = '5s';

create function private.require_jubo_profile_v2_review_scope(p_org uuid,p_branch uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  -- has_permission/is_active_user intentionally require an AAL2 JWT. Use the
  -- already-admitted Google session plus the same current membership grants
  -- for RECEIPT reads; never let this helper authorize a new write by itself.
  if p_org is null or p_branch is null or auth.uid() is null
    or public.is_staff_login_allowed() is not true
    or not exists (select 1 from public.branches branch
      join public.organizations organization on organization.id=branch.organization_id
      where branch.id=p_branch and branch.organization_id=p_org
        and branch.is_active and organization.is_active)
    or not exists (
      select 1 from public.memberships membership
      where membership.profile_id=auth.uid()
        and membership.organization_id=p_org
        and (membership.branch_id is null or membership.branch_id=p_branch)
        and membership.status='active'
        and membership.starts_at<=clock_timestamp()
        and (membership.ends_at is null or membership.ends_at>clock_timestamp())
        and exists (select 1 from public.membership_roles manager_assignment
          join public.roles manager_role on manager_role.id=manager_assignment.role_id
          where manager_assignment.membership_id=membership.id
            and manager_assignment.assigned_at<=clock_timestamp()
            and manager_role.is_active and manager_role.is_system
            and (manager_role.organization_id is null or manager_role.organization_id=p_org)
            and manager_role.role_key in ('organization_manager','branch_supervisor','branch_director'))
        and (select count(distinct permission.permission_key)
          from public.membership_roles assignment
          join public.roles role on role.id=assignment.role_id
          join public.role_permissions granted on granted.role_id=role.id
          join public.permissions permission on permission.id=granted.permission_id
          where assignment.membership_id=membership.id
            and assignment.assigned_at<=clock_timestamp()
            and role.is_active and (role.organization_id is null or role.organization_id=p_org)
            and granted.granted_at<=clock_timestamp()
            and permission.permission_key in (
              'clients.read','clients.demographics.read','clients.manage',
              'clients.view_all','imports.approve'))=5
    ) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REVIEW_DENIED';
  end if;
end;
$$;

-- Keep the existing write/preview gate unchanged in strength, and bring its
-- role check into line with the app gate. Receipt lookup calls only the scope
-- half, so stale AAL2 never authorizes a NEW write.
create or replace function private.require_jubo_profile_v2_reviewer(p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.require_jubo_profile_v2_review_scope(p_org,p_branch);
  -- Preserve the pre-existing AAL2-coupled database permission checks for
  -- preview, queue, and NEW decisions. Scope-only access is read-receipt only.
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve') then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REVIEW_DENIED';
  end if;
  return private.current_client_master_reauth_challenge();
end;
$$;

create function private.jubo_profile_mapping_v2_review_receipt(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_previous private.jubo_profile_mapping_v2_reviews%rowtype;
  v_reason text:=btrim(p_reason); v_request_sha text;
begin
  perform private.require_jubo_profile_v2_review_scope(p_org,p_branch);
  if p_pair is null or p_source_row is null or p_preview is null
    or p_idempotency_key is null or p_expected_source_sha256 is null
    or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[a-f0-9]{64}$'
    or p_expected_preview_sha256 is null or p_expected_preview_sha256 !~ '^[a-f0-9]{64}$'
    or p_purpose is distinct from 'jubo_intake_profile_mapping_v2'
    or p_decision is null or p_decision not in ('approved','held','rejected')
    or v_reason is null or char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode='22023',message='JUBO_PROFILE_V2_RECEIPT_INVALID';
  end if;
  begin
    v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SESSION_REQUIRED';
  end;
  if v_session is null or not exists (
    select 1 from auth.sessions session
    where session.id=v_session and session.user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SESSION_REQUIRED';
  end if;
  -- Keep this canonical JSONB request digest identical to the write RPC.
  -- A lookup with only an idempotency key would disclose another decision.
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair,'row',p_source_row,
    'preview',p_preview,'sourceSha',p_expected_source_sha256,
    'fingerprint',p_expected_fingerprint,'previewSha',p_expected_preview_sha256,
    'purpose',p_purpose,'decision',p_decision,'reason',v_reason)::text,'UTF8')),'hex');
  select review.* into v_previous from private.jubo_profile_mapping_v2_reviews review
    join private.jubo_profile_mapping_v2_previews preview on preview.id=review.preview_id
    where review.reviewer_user_id=auth.uid() and review.idempotency_key=p_idempotency_key
      and review.organization_id=p_org and review.branch_id=p_branch
      and review.pair_id=p_pair and review.master_source_row_id=p_source_row
      and review.preview_id=p_preview and review.review_purpose=p_purpose
      and preview.actor_user_id=auth.uid() and preview.actor_session_id=v_session;
  if v_previous.id is null then
    -- Absence is NOT proof of a failed write: the first request may still run.
    return jsonb_build_object('status','unconfirmed','receipt',null);
  end if;
  if v_previous.request_sha256<>v_request_sha then
    raise exception using errcode='23505',message='JUBO_PROFILE_V2_IDEMPOTENCY_CONFLICT';
  end if;
  return jsonb_build_object('status','found','receipt',jsonb_build_object(
    'reviewId',v_previous.id,'reviewVersion',v_previous.review_version,
    'decision',v_previous.decision,'replayed',true));
end;
$$;

create function public.jubo_profile_mapping_v2_review_receipt(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_profile_mapping_v2_review_receipt(p_org,p_branch,p_pair,p_source_row,p_preview,
    p_expected_source_sha256,p_expected_fingerprint,p_expected_preview_sha256,
    p_purpose,p_decision,p_reason,p_idempotency_key);
$$;

alter function private.require_jubo_profile_v2_review_scope(uuid,uuid) owner to postgres;
alter function private.require_jubo_profile_v2_reviewer(uuid,uuid) owner to postgres;
alter function private.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) owner to postgres;
revoke all on function private.require_jubo_profile_v2_review_scope(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.require_jubo_profile_v2_reviewer(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
comment on function public.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) is
  'Read-only same-actor, same-session, exact-request receipt lookup after an uncertain JUBO v2 review; no new approval, no AAL2 bypass for writes.';
commit;
