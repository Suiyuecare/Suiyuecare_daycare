-- Additive receipt projection over the existing atomic claim workflows.
-- No actor is inferred, no historic operation is backfilled, and no official
-- submission/file-format approval is implied by this database commit evidence.
create function private.export_claim_batch_receipt(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_claim_batch_id uuid, p_expected_total_amount numeric(14,2), p_idempotency_key uuid
)
returns table (
  organization_id uuid, branch_id uuid, idempotency_key uuid, request_hash text,
  snapshot_hash_version text, committed_at timestamptz,
  claim_batch_id uuid, format_version text, status public.claim_status,
  snapshot_hash text, item_count bigint, total_amount numeric(14,2), replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_batch public.claim_batches%rowtype;
  v_result record;
  v_metrics record;
begin
  if auth.uid() is null or p_expected_organization_id is null
    or p_expected_branch_id is null or p_claim_batch_id is null
    or p_idempotency_key is null then
    raise exception using errcode='42501', message='claim export receipt access denied';
  end if;
  if not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.read'),false)
    or not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.manage'),false)
    or not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.export'),false)
    or not coalesce(private.has_recent_aal2(15),false) then
    raise exception using errcode='42501', message='claim export receipt access denied';
  end if;
  select batch.* into v_batch from public.claim_batches batch
  where batch.id=p_claim_batch_id and batch.organization_id=p_expected_organization_id
    and batch.branch_id=p_expected_branch_id for update;
  if not found then
    raise exception using errcode='42501', message='claim export receipt scope unavailable';
  end if;
  select result.* into strict v_result from private.export_claim_batch_atomic(
    p_expected_organization_id,p_expected_branch_id,p_claim_batch_id,
    p_expected_total_amount,p_idempotency_key) result;
  -- The underlying call may wait for plan/other transaction locks. Recheck
  -- current admission, permissions and the same-session AAL2 after that wait.
  -- This is not a claim that all long-transaction revocation windows disappear.
  if not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.read'),false)
    or not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.manage'),false)
    or not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.export'),false)
    or not coalesce(private.has_recent_aal2(15),false) then
    raise exception using errcode='42501', message='claim export receipt access denied';
  end if;
  select batch.* into strict v_batch from public.claim_batches batch
  where batch.id=p_claim_batch_id and batch.organization_id=p_expected_organization_id
    and batch.branch_id=p_expected_branch_id;
  select metrics.* into strict v_metrics from private.claim_snapshot_metrics(v_batch.id) metrics;
  if v_batch.export_idempotency_key is distinct from p_idempotency_key
    or v_batch.export_request_hash is null or v_batch.export_request_hash !~ '^[a-f0-9]{64}$'
    or v_batch.snapshot_hash_version is distinct from 'postgres-jsonb-v1'
    or v_batch.exported_at is null or not isfinite(v_batch.exported_at)
    or v_batch.snapshot_hash is null or v_batch.snapshot_hash !~ '^[a-f0-9]{64}$'
    or v_metrics.snapshot_hash is distinct from v_batch.snapshot_hash
    or v_metrics.item_count is distinct from v_batch.snapshot_item_count
    or v_metrics.total_amount is distinct from v_batch.snapshot_total_amount
    or v_result.claim_batch_id is distinct from v_batch.id
    or v_result.format_version is distinct from v_batch.format_version
    or v_result.status is distinct from 'exported'::public.claim_status
    or v_result.snapshot_hash is distinct from v_batch.snapshot_hash
    or v_result.item_count is distinct from v_batch.snapshot_item_count
    or v_result.item_count not between 1 and 5000
    or v_result.total_amount is distinct from v_batch.snapshot_total_amount
    or v_result.total_amount is distinct from p_expected_total_amount
    or v_result.replayed is null then
    raise exception using errcode='55000', message='claim export persisted receipt mismatch';
  end if;
  return query select v_batch.organization_id,v_batch.branch_id,v_batch.export_idempotency_key,
    v_batch.export_request_hash,v_batch.snapshot_hash_version,v_batch.exported_at,
    v_batch.id,v_batch.format_version,v_result.status,v_batch.snapshot_hash,
    v_batch.snapshot_item_count,v_batch.snapshot_total_amount,v_result.replayed;
end;
$$;

create function private.reconcile_claim_batch_receipt(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_claim_batch_id uuid, p_expected_total_amount numeric(14,2),
  p_results jsonb, p_idempotency_key uuid
)
returns table (
  organization_id uuid, branch_id uuid, idempotency_key uuid, request_hash text,
  snapshot_hash_version text, committed_at timestamptz,
  claim_batch_id uuid, status public.claim_status, item_count bigint,
  accepted_count bigint, rejected_count bigint, total_amount numeric(14,2), replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_batch public.claim_batches%rowtype;
  v_result record;
  v_metrics record;
  v_accepted bigint;
  v_rejected bigint;
  v_response_hash text;
begin
  if auth.uid() is null or p_expected_organization_id is null
    or p_expected_branch_id is null or p_claim_batch_id is null
    or p_idempotency_key is null then
    raise exception using errcode='42501', message='claim reconciliation receipt access denied';
  end if;
  if not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.read'),false)
    or not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.manage'),false)
    or not coalesce(private.has_recent_aal2(15),false) then
    raise exception using errcode='42501', message='claim reconciliation receipt access denied';
  end if;
  select batch.* into v_batch from public.claim_batches batch
  where batch.id=p_claim_batch_id and batch.organization_id=p_expected_organization_id
    and batch.branch_id=p_expected_branch_id for update;
  if not found then
    raise exception using errcode='42501', message='claim reconciliation receipt scope unavailable';
  end if;
  select result.* into strict v_result from private.reconcile_claim_batch_atomic(
    p_expected_organization_id,p_expected_branch_id,p_claim_batch_id,
    p_expected_total_amount,p_results,p_idempotency_key) result;
  if not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.read'),false)
    or not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'claims.manage'),false)
    or not coalesce(private.has_recent_aal2(15),false) then
    raise exception using errcode='42501', message='claim reconciliation receipt access denied';
  end if;
  select batch.* into strict v_batch from public.claim_batches batch
  where batch.id=p_claim_batch_id and batch.organization_id=p_expected_organization_id
    and batch.branch_id=p_expected_branch_id;
  select metrics.* into strict v_metrics from private.claim_snapshot_metrics(v_batch.id) metrics;
  select count(*) filter(where item.response_outcome='accepted'),
    count(*) filter(where item.response_outcome='rejected')
  into v_accepted,v_rejected from public.claim_items item
  where item.claim_batch_id=v_batch.id and item.organization_id=v_batch.organization_id
    and item.branch_id=v_batch.branch_id;
  -- A voided legacy batch permits privileged maintenance. Do not return its
  -- stored original hash beside subsequently changed outcomes or response text.
  select encode(sha256(convert_to(jsonb_build_object(
    'operation','claim_reconciliation','organization_id',v_batch.organization_id,
    'branch_id',v_batch.branch_id,'claim_batch_id',v_batch.id,
    'expected_total_amount',p_expected_total_amount,
    'results',jsonb_agg(jsonb_build_object('claim_item_id',item.id,
      'outcome',item.response_outcome,'response_code',btrim(item.response_code),
      'response_message',nullif(btrim(item.response_message),'')) order by item.id)
    )::text,'UTF8')),'hex') into v_response_hash
  from public.claim_items item where item.claim_batch_id=v_batch.id
    and item.organization_id=v_batch.organization_id and item.branch_id=v_batch.branch_id;
  if v_batch.reconciliation_idempotency_key is distinct from p_idempotency_key
    or v_batch.reconciliation_request_hash is null or v_batch.reconciliation_request_hash !~ '^[a-f0-9]{64}$'
    or v_response_hash is distinct from v_batch.reconciliation_request_hash
    or v_batch.snapshot_hash_version is distinct from 'postgres-jsonb-v1'
    or v_metrics.snapshot_hash is distinct from v_batch.snapshot_hash
    or v_metrics.item_count is distinct from v_batch.snapshot_item_count
    or v_metrics.total_amount is distinct from v_batch.snapshot_total_amount
    or v_batch.reconciled_at is null or not isfinite(v_batch.reconciled_at)
    or v_result.claim_batch_id is distinct from v_batch.id
    or v_result.status is distinct from 'reconciled'::public.claim_status
    or v_result.item_count is distinct from v_batch.snapshot_item_count
    or v_result.item_count not between 1 and 5000
    or v_result.accepted_count is distinct from v_accepted
    or v_result.rejected_count is distinct from v_rejected
    or v_accepted+v_rejected is distinct from v_batch.snapshot_item_count
    or v_result.total_amount is distinct from v_batch.snapshot_total_amount
    or v_result.total_amount is distinct from p_expected_total_amount
    or v_result.replayed is null then
    raise exception using errcode='55000', message='claim reconciliation persisted receipt mismatch';
  end if;
  return query select v_batch.organization_id,v_batch.branch_id,v_batch.reconciliation_idempotency_key,
    v_batch.reconciliation_request_hash,v_batch.snapshot_hash_version,v_batch.reconciled_at,
    v_batch.id,v_result.status,v_batch.snapshot_item_count,v_accepted,v_rejected,
    v_batch.snapshot_total_amount,v_result.replayed;
end;
$$;

create function public.export_claim_batch_receipt(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_claim_batch_id uuid, p_expected_total_amount numeric(14,2), p_idempotency_key uuid
)
returns table (
  organization_id uuid, branch_id uuid, idempotency_key uuid, request_hash text,
  snapshot_hash_version text, committed_at timestamptz,
  claim_batch_id uuid, format_version text, status public.claim_status,
  snapshot_hash text, item_count bigint, total_amount numeric(14,2), replayed boolean
)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  -- Preserve caller RLS read access in addition to the private action checks.
  perform 1 from public.claim_batches batch where batch.id=p_claim_batch_id
    and batch.organization_id=p_expected_organization_id and batch.branch_id=p_expected_branch_id;
  if not found then
    raise exception using errcode='42501', message='claim export receipt scope unavailable';
  end if;
  return query select * from private.export_claim_batch_receipt(p_expected_organization_id,
    p_expected_branch_id,p_claim_batch_id,p_expected_total_amount,p_idempotency_key);
end;
$$;

create function public.reconcile_claim_batch_receipt(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_claim_batch_id uuid, p_expected_total_amount numeric(14,2),
  p_results jsonb, p_idempotency_key uuid
)
returns table (
  organization_id uuid, branch_id uuid, idempotency_key uuid, request_hash text,
  snapshot_hash_version text, committed_at timestamptz,
  claim_batch_id uuid, status public.claim_status, item_count bigint,
  accepted_count bigint, rejected_count bigint, total_amount numeric(14,2), replayed boolean
)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform 1 from public.claim_batches batch where batch.id=p_claim_batch_id
    and batch.organization_id=p_expected_organization_id and batch.branch_id=p_expected_branch_id;
  if not found then
    raise exception using errcode='42501', message='claim reconciliation receipt scope unavailable';
  end if;
  return query select * from private.reconcile_claim_batch_receipt(p_expected_organization_id,
    p_expected_branch_id,p_claim_batch_id,p_expected_total_amount,p_results,p_idempotency_key);
end;
$$;

alter function private.export_claim_batch_receipt(uuid,uuid,uuid,numeric,uuid) owner to postgres;
alter function private.reconcile_claim_batch_receipt(uuid,uuid,uuid,numeric,jsonb,uuid) owner to postgres;
revoke all on function private.export_claim_batch_receipt(uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.reconcile_claim_batch_receipt(uuid,uuid,uuid,numeric,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.export_claim_batch_receipt(uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.reconcile_claim_batch_receipt(uuid,uuid,uuid,numeric,jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.export_claim_batch_receipt(uuid,uuid,uuid,numeric,uuid) to authenticated;
grant execute on function private.reconcile_claim_batch_receipt(uuid,uuid,uuid,numeric,jsonb,uuid) to authenticated;
grant execute on function public.export_claim_batch_receipt(uuid,uuid,uuid,numeric,uuid) to authenticated;
grant execute on function public.reconcile_claim_batch_receipt(uuid,uuid,uuid,numeric,jsonb,uuid) to authenticated;
comment on function public.export_claim_batch_receipt(uuid,uuid,uuid,numeric,uuid) is
  'Existing atomic export with persisted scoped key/hash/version and original commit time; not an official claim file or external submission.';
comment on function public.reconcile_claim_batch_receipt(uuid,uuid,uuid,numeric,jsonb,uuid) is
  'Existing atomic reconciliation with persisted scoped key/hash/version and original commit time; replay never invents a new commit.';
