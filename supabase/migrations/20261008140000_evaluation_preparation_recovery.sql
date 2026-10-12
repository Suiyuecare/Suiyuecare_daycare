-- A timed-out write can commit before its HTTP response is lost. Look up only
-- the same actor's receipt for the exact tenant, key, and original JSON request.
create function private.evaluation_preparation_receipt(p_org uuid,p_branch uuid,p_request jsonb,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_hash text; v_found boolean;
  v_prior private.evaluation_preparation_operations%rowtype;
begin
  if not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation receipt denied'; end if;
  if p_key is null or jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid evaluation preparation receipt request'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'request',p_request)::text,'UTF8')),'hex');
  select * into v_prior from private.evaluation_preparation_operations
    where actor_user_id=v_actor and idempotency_key=p_key;
  v_found:=found;
  if not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation receipt denied'; end if;
  if not v_found then return null; end if;
  if v_prior.request_hash is distinct from v_hash
    or v_prior.receipt->>'organizationId' is distinct from p_org::text
    or v_prior.receipt->>'branchId' is distinct from p_branch::text
    or v_prior.receipt->>'actorUserId' is distinct from v_actor::text
    or v_prior.receipt->>'idempotencyKey' is distinct from p_key::text then
    raise exception using errcode='23505',message='evaluation preparation receipt mismatch'; end if;
  return v_prior.receipt||jsonb_build_object('replayed',true);
end;
$$;

create function public.evaluation_preparation_receipt(p_expected_organization_id uuid,p_expected_branch_id uuid,p_request jsonb,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.evaluation_preparation_receipt(p_expected_organization_id,p_expected_branch_id,p_request,p_idempotency_key);
$$;
revoke all on function private.evaluation_preparation_receipt(uuid,uuid,jsonb,uuid),
  public.evaluation_preparation_receipt(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.evaluation_preparation_receipt(uuid,uuid,jsonb,uuid),
  public.evaluation_preparation_receipt(uuid,uuid,jsonb,uuid) to authenticated;
