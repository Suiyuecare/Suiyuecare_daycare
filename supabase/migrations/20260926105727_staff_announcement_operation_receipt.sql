-- R1: own, already committed announcement operation evidence only. This is
-- not a current announcement projection and not a negative/in-flight receipt.
begin;

create function private.staff_announcement_operation_receipt_core(
  p_organization_id uuid,p_branch_id uuid,p_action text,p_idempotency_key uuid,p_nonce uuid
)
returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_operation private.staff_announcement_operations%rowtype;
  v_version public.staff_announcement_versions%rowtype;
  v_read_at timestamptz; v_evidence jsonb:=null; v_found boolean:=false;
begin
  if p_organization_id is null or p_branch_id is null or p_idempotency_key is null or p_nonce is null
    or p_action is null or p_action not in ('draft','publish','withdraw','read') then
    raise exception using errcode='22023',message='valid announcement receipt lookup parameters are required';
  end if;
  if private.staff_announcement_authority(p_organization_id,p_branch_id,'announcements.read') is not true
    or p_action<>'read' and private.staff_announcement_authority(p_organization_id,p_branch_id,'announcements.manage') is not true
    or p_action in ('publish','withdraw') and private.staff_announcement_authority(p_organization_id,p_branch_id,'announcements.publish') is not true then
    raise exception using errcode='42501',message='announcement operation receipt is not permitted';
  end if;
  if p_action in ('publish','withdraw') then
    perform private.require_staff_announcement_reauth(v_actor,clock_timestamp());
  end if;

  select operation.* into v_operation from private.staff_announcement_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key
    and operation.organization_id=p_organization_id and operation.branch_id=p_branch_id and operation.action=p_action;
  v_found:=found;
  if v_found then
    if p_action in ('publish','withdraw') and not exists (
      select 1 from private.reauth_challenges challenge where challenge.id=v_operation.reauth_challenge_id
        and challenge.user_id=v_actor and challenge.consumed_at is not null and challenge.invalidated_at is null
    ) then
      raise exception using errcode='42501',message='announcement operation receipt is not permitted';
    end if;
    select version.* into strict v_version from public.staff_announcement_versions version
    where version.id=v_operation.result_version_id and version.organization_id=p_organization_id
      and version.branch_id=p_branch_id and version.announcement_key=v_operation.result_announcement_key
      and version.version=v_operation.result_version;
    if (p_action='draft' and v_version.version_state<>'draft')
      or (p_action in ('publish','read') and v_version.version_state<>'release')
      or (p_action='withdraw' and v_version.version_state<>'withdrawal') then
      raise exception using errcode='23514',message='announcement operation receipt evidence is inconsistent';
    end if;
    if p_action='read' then
      select receipt.read_at into strict v_read_at from public.staff_announcement_read_receipts receipt
      where receipt.release_version_id=v_version.id and receipt.recipient_user_id=v_actor
        and receipt.organization_id=p_organization_id and receipt.branch_id=p_branch_id
        and receipt.announcement_key=v_version.announcement_key;
      if v_read_at is distinct from v_operation.result_at then
        raise exception using errcode='23514',message='announcement operation receipt evidence is inconsistent';
      end if;
    end if;
    v_evidence:=jsonb_build_object(
      'announcementKey',v_version.announcement_key,'versionId',v_version.id,'version',v_version.version,
      'sourceVersionId',case when p_action='read' then v_version.id else v_version.previous_version_id end,
      'releaseVersionId',case when p_action in ('publish','read') then v_version.id
        when p_action='withdraw' then v_version.withdrawn_release_version_id else null end,
      'effectiveAt',v_operation.result_at,'recordedAt',v_operation.created_at
    );
  end if;

  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,changed_fields,metadata)
  values(p_organization_id,p_branch_id,v_actor,'select','staff_announcement_operation_receipt','{}'::text[],
    jsonb_build_object('projection','page68_own_operation_receipt_v1','operation_action',p_action,'found',v_found));

  -- Audit hooks or a concurrent admission change must not release stale evidence.
  if private.staff_announcement_authority(p_organization_id,p_branch_id,'announcements.read') is not true
    or p_action<>'read' and private.staff_announcement_authority(p_organization_id,p_branch_id,'announcements.manage') is not true
    or p_action in ('publish','withdraw') and private.staff_announcement_authority(p_organization_id,p_branch_id,'announcements.publish') is not true
    or v_found and p_action in ('publish','withdraw') and not exists (
      select 1 from private.reauth_challenges challenge where challenge.id=v_operation.reauth_challenge_id
        and challenge.user_id=v_actor and challenge.consumed_at is not null and challenge.invalidated_at is null
    ) then
    raise exception using errcode='42501',message='announcement operation receipt authority expired after audit';
  end if;
  if p_action in ('publish','withdraw') then
    perform private.require_staff_announcement_reauth(v_actor,clock_timestamp());
  end if;
  return jsonb_build_object('schemaVersion',1,'status',case when v_found then 'committed' else 'not_found' end,
    'organizationId',p_organization_id,'branchId',p_branch_id,'actorUserId',v_actor,'action',p_action,
    'idempotencyKey',p_idempotency_key,'nonce',p_nonce,'verifiedAt',clock_timestamp(),
    'persisted',v_found,'demo',false,'evidence',v_evidence);
end;
$$;

create function public.staff_announcement_operation_receipt(
  p_organization_id uuid,p_branch_id uuid,p_action text,p_idempotency_key uuid,p_nonce uuid
)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.staff_announcement_operation_receipt_core($1,$2,$3,$4,$5);
$$;

revoke all on function private.staff_announcement_operation_receipt_core(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.staff_announcement_operation_receipt(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.staff_announcement_operation_receipt_core(uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.staff_announcement_operation_receipt(uuid,uuid,text,uuid,uuid) to authenticated;
commit;
