-- Keep the legacy RPC contract stable; new consumers require persisted scope
-- and operation evidence, rather than an API-generated echo of request fields.
create or replace function public.validate_claim_batch_receipt(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_expected_item_count integer,
  p_idempotency_key uuid
)
returns table (
  organization_id uuid,
  branch_id uuid,
  idempotency_key uuid,
  request_hash text,
  claim_batch_id uuid,
  status public.claim_status,
  item_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_result record;
  v_batch public.claim_batches%rowtype;
begin
  if p_expected_item_count is null or p_expected_item_count not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'valid confirmed claim count is required';
  end if;
  select result.* into strict v_result
  from public.validate_claim_batch(p_expected_organization_id, p_expected_branch_id,
    p_claim_batch_id, p_expected_total_amount, p_idempotency_key) result;

  -- The underlying atomic function holds the batch row lock through this
  -- statement. RLS and current authorization still apply to this read.
  select batch.* into v_batch from public.claim_batches batch
  where batch.id = v_result.claim_batch_id
    and batch.organization_id = p_expected_organization_id
    and batch.branch_id = p_expected_branch_id;
  if not found then
    raise exception using errcode = '42501', message = 'claim validation receipt scope unavailable';
  end if;
  if v_batch.id <> p_claim_batch_id
    or v_batch.validation_idempotency_key is distinct from p_idempotency_key
    or v_batch.validation_request_hash is null
    or v_batch.validation_request_hash !~ '^[a-f0-9]{64}$'
    or v_result.status <> 'validated'
    or v_result.total_amount is distinct from p_expected_total_amount
    or v_result.item_count is distinct from p_expected_item_count then
    raise exception using errcode = '55000', message = 'claim validation persisted receipt mismatch';
  end if;
  return query select v_batch.organization_id, v_batch.branch_id,
    v_batch.validation_idempotency_key, v_batch.validation_request_hash,
    v_batch.id, v_result.status, v_result.item_count, v_result.total_amount, v_result.replayed;
end;
$$;

revoke all on function public.validate_claim_batch_receipt(uuid,uuid,uuid,numeric,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.validate_claim_batch_receipt(uuid,uuid,uuid,numeric,integer,uuid)
  to authenticated;
comment on function public.validate_claim_batch_receipt(uuid,uuid,uuid,numeric,integer,uuid) is
  'Atomic claim validation with persisted tenant and operation evidence; no external claim submission.';
