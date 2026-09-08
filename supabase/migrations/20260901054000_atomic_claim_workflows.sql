-- Atomic claim export, reconciliation, and database-authoritative summaries.
--
-- Claim contents are locked through the parent batch before mutation. Export
-- and reconciliation therefore observe one serial transaction snapshot and
-- are safe to replay with the same actor-derived idempotency UUID.

alter table public.claim_batches
  add column snapshot_item_count bigint,
  add column snapshot_total_amount numeric(14,2),
  add column snapshot_hash_version text,
  add column validation_idempotency_key uuid,
  add column validation_request_hash text,
  add column export_idempotency_key uuid,
  add column export_request_hash text,
  add column reconciliation_idempotency_key uuid,
  add column reconciliation_request_hash text;

alter table public.claim_items
  add column response_outcome text;

-- Mark only rows that predate this migration as legacy. NULL is not a
-- permanent escape hatch for future exports; legacy rows remain readable but
-- cannot be reconciled by the new workflow until an explicit upgrade exists.
update public.claim_batches
set snapshot_hash_version = 'legacy-js-v1'
where status not in ('draft', 'validated');

alter table public.claim_batches
  add constraint claim_batches_snapshot_count_check
    check (snapshot_item_count is null or snapshot_item_count > 0),
  add constraint claim_batches_snapshot_total_check
    check (
      snapshot_total_amount is null
      or (
        snapshot_total_amount >= 0
        and snapshot_total_amount <> 'NaN'::numeric
        and snapshot_total_amount <> 'Infinity'::numeric
      )
    ),
  add constraint claim_batches_validation_request_hash_check
    check (
      validation_request_hash is null
      or validation_request_hash ~ '^[a-f0-9]{64}$'
    ),
  add constraint claim_batches_export_request_hash_check
    check (export_request_hash is null or export_request_hash ~ '^[a-f0-9]{64}$'),
  add constraint claim_batches_reconciliation_request_hash_check
    check (
      reconciliation_request_hash is null
      or reconciliation_request_hash ~ '^[a-f0-9]{64}$'
    ),
  add constraint claim_batches_snapshot_hash_version_check
    check (
      snapshot_hash_version is null
      or snapshot_hash_version in ('legacy-js-v1', 'postgres-jsonb-v1')
    ),
  add constraint claim_batches_validation_evidence_check check (
    (
      validation_idempotency_key is null
      and validation_request_hash is null
    )
    or (
      status <> 'draft'
      and validation_idempotency_key is not null
      and validation_request_hash is not null
    )
  ),
  add constraint claim_batches_pre_export_metadata_check check (
    status not in ('draft', 'validated')
    or (
      snapshot_hash is null
      and snapshot_item_count is null
      and snapshot_total_amount is null
      and snapshot_hash_version is null
      and exported_at is null
      and export_idempotency_key is null
      and export_request_hash is null
      and submitted_at is null
      and reconciled_at is null
      and reconciliation_idempotency_key is null
      and reconciliation_request_hash is null
    )
  ),
  add constraint claim_batches_atomic_snapshot_check check (
    status in ('draft', 'validated')
    or (
      snapshot_hash is not null
      and exported_at is not null
      and snapshot_hash_version is not null
      and (
        -- Rows exported before this migration remain readable but fail closed
        -- for reconciliation until deliberately upgraded.
        snapshot_hash_version = 'legacy-js-v1'
        or (
          snapshot_hash_version = 'postgres-jsonb-v1'
          and snapshot_item_count is not null
          and snapshot_total_amount is not null
          and export_idempotency_key is not null
          and export_request_hash is not null
        )
      )
    )
  ),
  add constraint claim_batches_atomic_reconciliation_check check (
    status <> 'reconciled'
    or snapshot_hash_version = 'legacy-js-v1'
    or (
      reconciled_at is not null
      and reconciliation_idempotency_key is not null
      and reconciliation_request_hash is not null
    )
  );

alter table public.claim_items
  add constraint claim_items_response_outcome_check
    check (response_outcome is null or response_outcome in ('accepted', 'rejected')),
  add constraint claim_items_units_finite_check
    check (units <> 'NaN'::numeric and units <> 'Infinity'::numeric),
  add constraint claim_items_amount_finite_check
    check (amount <> 'NaN'::numeric and amount <> 'Infinity'::numeric);

create index claim_items_batch_id_idx
  on public.claim_items (claim_batch_id, id);

create unique index claim_batches_validation_idempotency_key_idx
  on public.claim_batches (validation_idempotency_key)
  where validation_idempotency_key is not null;
create unique index claim_batches_export_idempotency_key_idx
  on public.claim_batches (export_idempotency_key)
  where export_idempotency_key is not null;
create unique index claim_batches_reconciliation_idempotency_key_idx
  on public.claim_batches (reconciliation_idempotency_key)
  where reconciliation_idempotency_key is not null;

create table private.claim_service_allocations (
  service_event_id uuid primary key,
  claim_batch_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  allocated_at timestamptz not null default clock_timestamp(),
  constraint claim_service_allocations_item_fkey
    foreign key (claim_batch_id, service_event_id)
    references public.claim_items(claim_batch_id, service_event_id)
    on delete restrict,
  constraint claim_service_allocations_batch_scope_fkey
    foreign key (claim_batch_id, organization_id, branch_id)
    references public.claim_batches(id, organization_id, branch_id)
    on delete restrict
);

create index claim_service_allocations_batch_scope_idx
  on private.claim_service_allocations (claim_batch_id, organization_id, branch_id);

comment on table private.claim_service_allocations is
  'Internal append-only allocation ledger preventing one signed service event from being exported in multiple claim batches.';

-- Historical exports must reserve their service events before any new export
-- is possible. Ambiguous legacy duplicates deliberately stop the migration so
-- a data steward can resolve them instead of silently selecting one batch.
do $$
declare
  v_duplicate_count bigint;
begin
  select count(*) into v_duplicate_count
  from (
    select item.service_event_id
    from public.claim_items item
    join public.claim_batches batch on batch.id = item.claim_batch_id
    where batch.status not in ('draft', 'validated')
    group by item.service_event_id
    having count(*) > 1
  ) duplicates;

  if v_duplicate_count > 0 then
    raise exception using
      errcode = '23505',
      message = format(
        'legacy claim allocation backfill found %s duplicated service events; resolve them before migration',
        v_duplicate_count
      );
  end if;
end;
$$;

insert into private.claim_service_allocations (
  service_event_id,
  claim_batch_id,
  organization_id,
  branch_id,
  allocated_at
)
select
  item.service_event_id,
  item.claim_batch_id,
  item.organization_id,
  item.branch_id,
  coalesce(batch.exported_at, batch.updated_at, batch.created_at)
from public.claim_items item
join public.claim_batches batch on batch.id = item.claim_batch_id
where batch.status not in ('draft', 'validated');

create or replace function private.prevent_claim_allocation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'claim service allocations are append-only';
end;
$$;

create trigger claim_service_allocations_append_only
before update or delete on private.claim_service_allocations
for each row execute function private.prevent_claim_allocation_mutation();

create or replace function private.protect_claim_batch_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'validated') then
      raise exception using
        errcode = '55000',
        message = 'exported claim snapshots cannot be deleted';
    end if;
    return old;
  end if;

  if not (
    new.status = old.status
    or (old.status = 'draft' and new.status in ('validated', 'voided'))
    or (old.status = 'validated' and new.status in ('exported', 'voided'))
    or (old.status = 'exported' and new.status in ('submitted', 'reconciled', 'voided'))
    or (old.status = 'submitted' and new.status in ('accepted', 'rejected', 'reconciled', 'voided'))
    or (old.status in ('accepted', 'rejected') and new.status in ('reconciled', 'voided'))
    or (old.status = 'reconciled' and new.status = 'voided')
  ) then
    raise exception using
      errcode = '23514',
      message = 'invalid claim batch status transition';
  end if;

  if old.validation_idempotency_key is not null
     and (
       new.validation_idempotency_key is distinct from old.validation_idempotency_key
       or new.validation_request_hash is distinct from old.validation_request_hash
     ) then
    raise exception using
      errcode = '55000',
      message = 'claim validation evidence is immutable';
  end if;

  if old.status not in ('draft', 'validated') then
    if new.claim_period_start is distinct from old.claim_period_start
       or new.claim_period_end is distinct from old.claim_period_end
       or new.format_version is distinct from old.format_version
       or new.snapshot_hash is distinct from old.snapshot_hash
       or new.snapshot_hash_version is distinct from old.snapshot_hash_version
       or new.snapshot_item_count is distinct from old.snapshot_item_count
       or new.snapshot_total_amount is distinct from old.snapshot_total_amount
       or new.exported_at is distinct from old.exported_at
       or new.export_idempotency_key is distinct from old.export_idempotency_key
       or new.export_request_hash is distinct from old.export_request_hash
       or new.created_by is distinct from old.created_by then
      raise exception using
        errcode = '55000',
        message = 'exported claim snapshot content is immutable';
    end if;
  end if;

  if old.status = 'reconciled'
     and (
       new.reconciled_at is distinct from old.reconciled_at
       or new.reconciliation_idempotency_key is distinct from old.reconciliation_idempotency_key
       or new.reconciliation_request_hash is distinct from old.reconciliation_request_hash
     ) then
    raise exception using
      errcode = '55000',
      message = 'reconciled claim result is immutable';
  end if;

  return new;
end;
$$;

create or replace function private.protect_claim_item_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid := case when tg_op = 'DELETE' then old.claim_batch_id else new.claim_batch_id end;
  v_batch public.claim_batches%rowtype;
begin
  -- Every item writer takes the same parent-row lock as export/reconcile. This
  -- prevents inserts and edits from crossing the immutable snapshot boundary.
  select batch.* into strict v_batch
  from public.claim_batches batch
  where batch.id = v_batch_id
  for update;

  if auth.uid() is not null
     and (
       not private.has_permission(v_batch.organization_id, v_batch.branch_id, 'claims.manage')
       or not private.has_recent_aal2(15)
     ) then
    raise exception using
      errcode = '42501',
      message = 'claim item mutation is not permitted';
  end if;

  if tg_op = 'INSERT' then
    if v_batch.status <> 'draft' then
      raise exception using
        errcode = '55000',
        message = 'items can only be added while a claim batch is draft';
    end if;
    if new.response_outcome is not null
       or new.response_code is not null
       or new.response_message is not null then
      raise exception using
        errcode = '23514',
        message = 'claim response fields must be empty before reconciliation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_batch.status <> 'draft' then
      raise exception using
        errcode = '55000',
        message = 'items can only be deleted while a claim batch is draft';
    end if;
    return old;
  end if;

  if v_batch.status = 'draft' then
    if new.response_outcome is not null
       or new.response_code is not null
       or new.response_message is not null then
      raise exception using
        errcode = '23514',
        message = 'claim response fields must be empty before reconciliation';
    end if;
    return new;
  end if;

  if v_batch.status = 'validated' then
    raise exception using
      errcode = '55000',
      message = 'validated claim items are immutable';
  end if;

  if (to_jsonb(new) - array['response_outcome', 'response_code', 'response_message', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['response_outcome', 'response_code', 'response_message', 'updated_at']) then
    raise exception using
      errcode = '55000',
      message = 'exported claim item content is immutable; only reconciliation response fields may change';
  end if;

  if v_batch.status = 'reconciled'
     and (
       new.response_outcome is distinct from old.response_outcome
       or new.response_code is distinct from old.response_code
       or new.response_message is distinct from old.response_message
     ) then
    raise exception using
      errcode = '55000',
      message = 'reconciled claim item response is immutable';
  end if;

  return new;
end;
$$;

drop trigger claim_items_protect_snapshot on public.claim_items;
create trigger claim_items_protect_snapshot
before insert or update or delete on public.claim_items
for each row execute function private.protect_claim_item_snapshot();

create or replace function private.claim_snapshot_metrics(p_claim_batch_id uuid)
returns table(
  item_count bigint,
  total_amount numeric(14,2),
  snapshot_hash text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with material as (
    select
      batch.id,
      batch.claim_period_start,
      batch.claim_period_end,
      batch.format_version,
      count(item.id)::bigint as item_count,
      coalesce(sum(item.amount), 0)::numeric(14,2) as total_amount,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'client_id', item.client_id,
            'service_event_id', item.service_event_id,
            'service_code', item.service_code,
            'service_date', item.service_date,
            'units', item.units,
            'amount', item.amount,
            'evidence_hash', item.evidence_hash
          )
          order by item.id
        ) filter (where item.id is not null),
        '[]'::jsonb
      ) as items
    from public.claim_batches batch
    left join public.claim_items item on item.claim_batch_id = batch.id
    where batch.id = p_claim_batch_id
    group by
      batch.id,
      batch.claim_period_start,
      batch.claim_period_end,
      batch.format_version
  ), snapshot as (
    select
      material.item_count,
      material.total_amount,
      jsonb_build_object(
        'schema_version', 1,
        'batch', jsonb_build_object(
          'id', material.id,
          'claim_period_start', material.claim_period_start,
          'claim_period_end', material.claim_period_end,
          'format_version', material.format_version
        ),
        'item_count', material.item_count,
        'total_amount', material.total_amount,
        'items', material.items
      ) as payload
    from material
  )
  select
    snapshot.item_count,
    snapshot.total_amount,
    encode(sha256(convert_to(snapshot.payload::text, 'UTF8')), 'hex')
  from snapshot;
$$;

create or replace function private.claim_batch_has_ineligible_items(
  p_claim_batch_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.claim_batches batch
    join public.claim_items item on item.claim_batch_id = batch.id
    left join public.service_events event on event.id = item.service_event_id
    left join public.client_service_plans service_plan
      on service_plan.id = event.client_service_plan_id
    left join lateral (
      select
        case
          when count(*) = 1 then min(terminal.id::text)::uuid
          else null
        end as authorized_care_plan_id
      from (
        select distinct on (authorized.plan_key)
          authorized.id,
          authorized.status
        from public.authorized_care_plans authorized
        where authorized.organization_id = event.organization_id
          and authorized.branch_id = event.branch_id
          and authorized.client_id = event.client_id
          and authorized.status in ('signed', 'voided')
          and (event.started_at at time zone 'Asia/Taipei')::date
              between authorized.effective_from and authorized.effective_to
        order by
          authorized.plan_key,
          authorized.version desc,
          authorized.created_at desc,
          authorized.id desc
      ) terminal
      where terminal.status = 'signed'
    ) current_authorization on true
    where batch.id = p_claim_batch_id
      and (
        item.organization_id <> batch.organization_id
        or item.branch_id <> batch.branch_id
        or item.service_date not between batch.claim_period_start and batch.claim_period_end
        or item.units <= 0
        or item.units = 'NaN'::numeric
        or item.units = 'Infinity'::numeric
        or item.amount < 0
        or item.amount = 'NaN'::numeric
        or item.amount = 'Infinity'::numeric
        or item.response_outcome is not null
        or item.response_code is not null
        or item.response_message is not null
        or event.id is null
        or event.organization_id <> item.organization_id
        or event.branch_id <> item.branch_id
        or event.client_id <> item.client_id
        or event.service_code <> item.service_code
        or (event.started_at at time zone 'Asia/Taipei')::date <> item.service_date
        or event.status <> 'completed'
        or event.client_service_plan_id is null
        or service_plan.id is null
        or service_plan.organization_id <> event.organization_id
        or service_plan.branch_id <> event.branch_id
        or service_plan.client_id <> event.client_id
        or service_plan.status <> 'signed'
        or (event.started_at at time zone 'Asia/Taipei')::date
            not between service_plan.effective_from and service_plan.effective_to
        or service_plan.authorized_care_plan_id
            is distinct from current_authorization.authorized_care_plan_id
        or exists (
          select 1
          from public.client_service_plans later_service_plan
          where later_service_plan.organization_id = service_plan.organization_id
            and later_service_plan.plan_key = service_plan.plan_key
            and later_service_plan.version > service_plan.version
            and later_service_plan.status in ('signed', 'voided')
            and (event.started_at at time zone 'Asia/Taipei')::date
                between later_service_plan.effective_from and later_service_plan.effective_to
        )
        or event.signed_at is null
        or event.signed_by is null
        or event.content_hash is null
        or event.content_hash is distinct from item.evidence_hash
      )
  );
$$;

create or replace function private.lock_claim_plan_scopes(
  p_claim_batch_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scope record;
begin
  -- Match the service-plan -> authorized-plan order used by both plan insert
  -- guards. Distinct client scopes are sorted so concurrent multi-client
  -- batches cannot acquire the same set in opposite order.
  for v_scope in
    select distinct
      item.organization_id,
      item.branch_id,
      item.client_id
    from public.claim_items item
    where item.claim_batch_id = p_claim_batch_id
    order by item.organization_id, item.branch_id, item.client_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'client-service-plan:' || v_scope.organization_id::text || ':' ||
        v_scope.branch_id::text || ':' || v_scope.client_id::text,
        0
      )
    );
    perform pg_advisory_xact_lock(
      hashtextextended(
        'authorized-care-plan:' || v_scope.organization_id::text || ':' ||
        v_scope.branch_id::text || ':' || v_scope.client_id::text,
        0
      )
    );
  end loop;
end;
$$;

create or replace function private.validate_claim_batch_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_idempotency_key uuid
)
returns table(
  claim_batch_id uuid,
  status public.claim_status,
  item_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.claim_batches%rowtype;
  v_metrics record;
  v_request_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_claim_batch_id is null
     or p_expected_total_amount is null
     or p_expected_total_amount < 0
     or p_expected_total_amount = 'NaN'::numeric
     or p_expected_total_amount = 'Infinity'::numeric
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'valid claim validation parameters are required';
  end if;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'operation', 'claim_validation',
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'claim_batch_id', p_claim_batch_id,
          'expected_total_amount', p_expected_total_amount
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select batch.* into v_batch
  from public.claim_batches batch
  where batch.id = p_claim_batch_id
    and batch.organization_id = p_expected_organization_id
    and batch.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.has_permission(v_batch.organization_id, v_batch.branch_id, 'claims.manage'))
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501', message = 'claim validation is not permitted';
  end if;

  if v_batch.validation_idempotency_key = p_idempotency_key
     and v_batch.validation_request_hash is distinct from v_request_hash then
    raise exception using errcode = '23505', message = 'claim validation idempotency conflict';
  end if;

  -- A successful operation remains exactly replayable after the batch advances
  -- to export/reconciliation or the client's current plan later changes. Item
  -- content is already frozen once validation succeeds, so these metrics
  -- reproduce the original validated result without reapplying mutable gates.
  if v_batch.validation_idempotency_key = p_idempotency_key
     and v_batch.validation_request_hash = v_request_hash then
    select metrics.* into strict v_metrics
    from private.claim_snapshot_metrics(v_batch.id) metrics;

    return query select
      v_batch.id,
      'validated'::public.claim_status,
      v_metrics.item_count,
      v_metrics.total_amount,
      true;
    return;
  end if;

  if v_batch.validation_idempotency_key is not null
     and v_batch.validation_idempotency_key <> p_idempotency_key then
    raise exception using errcode = 'P2001', message = 'claim batch was validated by a different operation';
  end if;

  if v_batch.status not in ('draft', 'validated') then
    raise exception using errcode = '55000', message = 'only a draft claim batch can be validated';
  end if;

  select metrics.* into strict v_metrics
  from private.claim_snapshot_metrics(v_batch.id) metrics;

  if v_metrics.item_count not between 1 and 5000 then
    raise exception using errcode = '23514', message = 'claim batch must contain between 1 and 5000 eligible items';
  end if;
  if v_metrics.total_amount is distinct from p_expected_total_amount
     or v_metrics.total_amount = 'NaN'::numeric
     or v_metrics.total_amount = 'Infinity'::numeric then
    raise exception using errcode = '23514', message = 'claim batch total does not match confirmed total';
  end if;
  perform private.lock_claim_plan_scopes(v_batch.id);
  if (select private.claim_batch_has_ineligible_items(v_batch.id)) then
    raise exception using
      errcode = '23514',
      message = 'claim batch contains an ineligible, unsigned, mismatched, or out-of-period service';
  end if;

  if v_batch.status = 'validated' then
    raise exception using
      errcode = '55000',
      message = 'legacy validated claim batch must be returned to governance before validation';
  end if;

  update public.claim_batches batch
  set
    status = 'validated',
    validation_idempotency_key = p_idempotency_key,
    validation_request_hash = v_request_hash,
    updated_at = clock_timestamp()
  where batch.id = v_batch.id
  returning batch.* into v_batch;

  return query select
    v_batch.id,
    v_batch.status,
    v_metrics.item_count,
    v_metrics.total_amount,
    false;
end;
$$;

create or replace function private.export_claim_batch_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_idempotency_key uuid
)
returns table(
  claim_batch_id uuid,
  format_version text,
  status public.claim_status,
  snapshot_hash text,
  item_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.claim_batches%rowtype;
  v_metrics record;
  v_request_hash text;
  v_validation_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_claim_batch_id is null
     or p_expected_total_amount is null
     or p_expected_total_amount < 0
     or p_expected_total_amount = 'NaN'::numeric
     or p_expected_total_amount = 'Infinity'::numeric
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'valid claim export parameters are required';
  end if;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'operation', 'claim_export',
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'claim_batch_id', p_claim_batch_id,
          'expected_total_amount', p_expected_total_amount
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  v_validation_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'operation', 'claim_validation',
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'claim_batch_id', p_claim_batch_id,
          'expected_total_amount', p_expected_total_amount
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select batch.* into v_batch
  from public.claim_batches batch
  where batch.id = p_claim_batch_id
    and batch.organization_id = p_expected_organization_id
    and batch.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.has_permission(v_batch.organization_id, v_batch.branch_id, 'claims.manage'))
     or not (select private.has_permission(v_batch.organization_id, v_batch.branch_id, 'claims.export'))
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501', message = 'claim export is not permitted';
  end if;

  if v_batch.export_idempotency_key = p_idempotency_key
     and v_batch.export_request_hash is distinct from v_request_hash then
    raise exception using errcode = '23505', message = 'claim export idempotency conflict';
  end if;

  if v_batch.export_idempotency_key = p_idempotency_key
     and v_batch.export_request_hash = v_request_hash then
    if v_batch.snapshot_hash_version is distinct from 'postgres-jsonb-v1'
       or v_batch.snapshot_hash is null
       or v_batch.snapshot_item_count is null
       or v_batch.snapshot_total_amount is null then
      raise exception using
        errcode = '55000',
        message = 'stored claim export receipt is incomplete';
    end if;

    return query select
      v_batch.id,
      v_batch.format_version,
      'exported'::public.claim_status,
      v_batch.snapshot_hash,
      v_batch.snapshot_item_count,
      v_batch.snapshot_total_amount,
      true;
    return;
  end if;

  if v_batch.export_idempotency_key is not null
     and v_batch.export_idempotency_key <> p_idempotency_key then
    raise exception using errcode = 'P2001', message = 'claim batch was exported by a different operation';
  end if;

  select metrics.* into strict v_metrics
  from private.claim_snapshot_metrics(v_batch.id) metrics;

  if v_metrics.item_count not between 1 and 5000 then
    raise exception using errcode = '23514', message = 'claim batch must contain between 1 and 5000 exportable items';
  end if;
  if v_metrics.total_amount is distinct from p_expected_total_amount then
    raise exception using errcode = '23514', message = 'claim batch total does not match confirmed total';
  end if;

  if v_batch.status not in ('draft', 'validated') then
    raise exception using errcode = '55000', message = 'claim batch cannot be exported in its current state';
  end if;

  if v_batch.status <> 'validated' then
    raise exception using errcode = '55000', message = 'claim batch must be validated before export';
  end if;

  if v_batch.validation_idempotency_key is null
     or v_batch.validation_request_hash is distinct from v_validation_hash then
    raise exception using
      errcode = '55000',
      message = 'claim batch does not have matching database validation evidence';
  end if;

  perform private.lock_claim_plan_scopes(v_batch.id);
  if (select private.claim_batch_has_ineligible_items(v_batch.id)) then
    raise exception using
      errcode = '23514',
      message = 'claim batch contains an ineligible, unsigned, mismatched, or out-of-period service';
  end if;

  begin
    insert into private.claim_service_allocations (
      service_event_id,
      claim_batch_id,
      organization_id,
      branch_id
    )
    select
      item.service_event_id,
      item.claim_batch_id,
      item.organization_id,
      item.branch_id
    from public.claim_items item
    where item.claim_batch_id = v_batch.id;
  exception
    when unique_violation then
      -- Keep a cross-batch duplicate service distinct from a true request-key
      -- collision. The API intentionally does not expose the conflicting row.
      raise exception using
        errcode = '23514',
        message = 'claim service is already allocated to another batch';
  end;

  update public.claim_batches batch
  set
    status = 'exported',
    snapshot_hash = v_metrics.snapshot_hash,
    snapshot_hash_version = 'postgres-jsonb-v1',
    snapshot_item_count = v_metrics.item_count,
    snapshot_total_amount = v_metrics.total_amount,
    exported_at = clock_timestamp(),
    export_idempotency_key = p_idempotency_key,
    export_request_hash = v_request_hash,
    updated_at = clock_timestamp()
  where batch.id = v_batch.id
  returning batch.* into v_batch;

  return query select
    v_batch.id,
    v_batch.format_version,
    v_batch.status,
    v_batch.snapshot_hash,
    v_batch.snapshot_item_count,
    v_batch.snapshot_total_amount,
    false;
end;
$$;

create or replace function private.reconcile_claim_batch_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_results jsonb,
  p_idempotency_key uuid
)
returns table(
  claim_batch_id uuid,
  status public.claim_status,
  item_count bigint,
  accepted_count bigint,
  rejected_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.claim_batches%rowtype;
  v_metrics record;
  v_result_count bigint;
  v_unique_count bigint;
  v_accepted_count bigint;
  v_rejected_count bigint;
  v_normalized_results jsonb;
  v_request_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_claim_batch_id is null
     or p_expected_total_amount is null
     or p_expected_total_amount < 0
     or p_expected_total_amount = 'NaN'::numeric
     or p_expected_total_amount = 'Infinity'::numeric
     or p_idempotency_key is null
     or jsonb_typeof(p_results) <> 'array'
     or jsonb_array_length(p_results) not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'valid claim reconciliation parameters are required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result
    where jsonb_typeof(result) <> 'object'
       or not (result ? 'claim_item_id')
       or jsonb_typeof(result -> 'claim_item_id') <> 'string'
       or not (result ? 'outcome')
       or jsonb_typeof(result -> 'outcome') <> 'string'
       or not (result ? 'response_code')
       or jsonb_typeof(result -> 'response_code') <> 'string'
       or (
         result ? 'response_message'
         and jsonb_typeof(result -> 'response_message') not in ('string', 'null')
       )
       or exists (
         select 1
         from jsonb_object_keys(result) key
         where key not in ('claim_item_id', 'outcome', 'response_code', 'response_message')
       )
  ) then
    raise exception using errcode = '22023', message = 'claim reconciliation contains unsupported fields';
  end if;

  select batch.* into v_batch
  from public.claim_batches batch
  where batch.id = p_claim_batch_id
    and batch.organization_id = p_expected_organization_id
    and batch.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.has_permission(v_batch.organization_id, v_batch.branch_id, 'claims.manage'))
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501', message = 'claim reconciliation is not permitted';
  end if;

  with results as (
    select parsed.*
    from jsonb_to_recordset(p_results) as parsed(
      claim_item_id uuid,
      outcome text,
      response_code text,
      response_message text
    )
  )
  select
    count(*),
    count(distinct results.claim_item_id),
    count(*) filter (where results.outcome = 'accepted'),
    count(*) filter (where results.outcome = 'rejected')
  into v_result_count, v_unique_count, v_accepted_count, v_rejected_count
  from results
  where results.claim_item_id is not null
    and results.outcome in ('accepted', 'rejected')
    and octet_length(btrim(results.response_code)) between 1 and 40
    and btrim(results.response_code) ~ '^[A-Za-z0-9._:/-]+$'
    and btrim(results.response_code) !~ '[[:cntrl:]]'
    and (
      results.response_message is null
      or (
        octet_length(btrim(results.response_message)) <= 64
        and btrim(results.response_message) !~ '[[:cntrl:]]'
      )
    );

  with results as (
    select parsed.*
    from jsonb_to_recordset(p_results) as parsed(
      claim_item_id uuid,
      outcome text,
      response_code text,
      response_message text
    )
  )
  select jsonb_agg(
    jsonb_build_object(
      'claim_item_id', results.claim_item_id,
      'outcome', results.outcome,
      'response_code', btrim(results.response_code),
      'response_message', nullif(btrim(results.response_message), '')
    )
    order by results.claim_item_id
  )
  into v_normalized_results
  from results;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'operation', 'claim_reconciliation',
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'claim_batch_id', p_claim_batch_id,
          'expected_total_amount', p_expected_total_amount,
          'results', v_normalized_results
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  if v_batch.reconciliation_idempotency_key = p_idempotency_key
     and v_batch.reconciliation_request_hash is distinct from v_request_hash then
    raise exception using errcode = '23505', message = 'claim reconciliation idempotency conflict';
  end if;

  if v_batch.reconciliation_idempotency_key = p_idempotency_key
     and v_batch.reconciliation_request_hash = v_request_hash then
    if v_batch.snapshot_hash_version is distinct from 'postgres-jsonb-v1'
       or v_batch.snapshot_item_count is null
       or v_batch.snapshot_total_amount is null then
      raise exception using
        errcode = '55000',
        message = 'stored claim reconciliation receipt is incomplete';
    end if;
    select
      count(*) filter (where item.response_outcome = 'accepted'),
      count(*) filter (where item.response_outcome = 'rejected')
    into v_accepted_count, v_rejected_count
    from public.claim_items item
    where item.claim_batch_id = v_batch.id;

    return query select
      v_batch.id,
      'reconciled'::public.claim_status,
      v_batch.snapshot_item_count,
      v_accepted_count,
      v_rejected_count,
      v_batch.snapshot_total_amount,
      true;
    return;
  end if;

  if v_batch.reconciliation_idempotency_key is not null
     and v_batch.reconciliation_idempotency_key <> p_idempotency_key then
    raise exception using errcode = 'P2001', message = 'claim batch was reconciled by a different operation';
  end if;

  if v_batch.status not in ('exported', 'submitted', 'accepted', 'rejected', 'reconciled') then
    raise exception using errcode = '55000', message = 'claim batch must have an immutable export before reconciliation';
  end if;

  if v_batch.snapshot_hash_version is distinct from 'postgres-jsonb-v1' then
    raise exception using errcode = '55000', message = 'legacy claim snapshot requires an explicit upgrade before reconciliation';
  end if;

  select metrics.* into strict v_metrics
  from private.claim_snapshot_metrics(v_batch.id) metrics;

  if v_batch.snapshot_hash is distinct from v_metrics.snapshot_hash
     or v_batch.snapshot_item_count is distinct from v_metrics.item_count
     or v_batch.snapshot_total_amount is distinct from v_metrics.total_amount
     or v_metrics.total_amount is distinct from p_expected_total_amount then
    raise exception using errcode = '55000', message = 'immutable claim snapshot validation failed';
  end if;

  if jsonb_array_length(p_results)::bigint <> v_metrics.item_count
     or v_result_count <> v_metrics.item_count
     or v_unique_count <> v_metrics.item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_results) as parsed(claim_item_id uuid)
       left join public.claim_items item
         on item.id = parsed.claim_item_id
        and item.claim_batch_id = v_batch.id
       where item.id is null
     ) then
    raise exception using errcode = '23514', message = 'reconciliation must validly cover every claim item exactly once';
  end if;

  with results as (
    select parsed.*
    from jsonb_to_recordset(p_results) as parsed(
      claim_item_id uuid,
      outcome text,
      response_code text,
      response_message text
    )
  )
  update public.claim_items item
  set
    response_outcome = results.outcome,
    response_code = btrim(results.response_code),
    response_message = nullif(btrim(results.response_message), ''),
    updated_at = clock_timestamp()
  from results
  where item.id = results.claim_item_id
    and item.claim_batch_id = v_batch.id;

  update public.claim_batches batch
  set
    status = 'reconciled',
    reconciled_at = clock_timestamp(),
    reconciliation_idempotency_key = p_idempotency_key,
    reconciliation_request_hash = v_request_hash,
    updated_at = clock_timestamp()
  where batch.id = v_batch.id
  returning batch.* into v_batch;

  return query select
    v_batch.id,
    v_batch.status,
    v_batch.snapshot_item_count,
    v_accepted_count,
    v_rejected_count,
    v_batch.snapshot_total_amount,
    false;
end;
$$;

-- Exposed RPCs remain SECURITY INVOKER. The private implementations are the
-- only definer functions and repeat every authorization/AAL2/scope check
-- before touching data, matching the project's public-function boundary.
create or replace function public.validate_claim_batch(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_idempotency_key uuid
)
returns table(
  claim_batch_id uuid,
  status public.claim_status,
  item_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.validate_claim_batch_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_claim_batch_id,
    p_expected_total_amount,
    p_idempotency_key
  );
$$;

create or replace function public.export_claim_batch(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_idempotency_key uuid
)
returns table(
  claim_batch_id uuid,
  format_version text,
  status public.claim_status,
  snapshot_hash text,
  item_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.export_claim_batch_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_claim_batch_id,
    p_expected_total_amount,
    p_idempotency_key
  );
$$;

create or replace function public.reconcile_claim_batch(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_claim_batch_id uuid,
  p_expected_total_amount numeric(14,2),
  p_results jsonb,
  p_idempotency_key uuid
)
returns table(
  claim_batch_id uuid,
  status public.claim_status,
  item_count bigint,
  accepted_count bigint,
  rejected_count bigint,
  total_amount numeric(14,2),
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.reconcile_claim_batch_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_claim_batch_id,
    p_expected_total_amount,
    p_results,
    p_idempotency_key
  );
$$;

create or replace function public.claim_batch_summaries(
  p_branch_id uuid,
  p_limit integer default 200
)
returns table(
  id uuid,
  claim_period_start date,
  claim_period_end date,
  format_version text,
  status public.claim_status,
  item_count bigint,
  total_amount numeric(14,2),
  responded_item_count bigint,
  rejected_item_count bigint,
  legacy_response_unknown boolean,
  has_immutable_snapshot boolean,
  exported_at timestamptz,
  submitted_at timestamptz,
  reconciled_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    batch.id,
    batch.claim_period_start,
    batch.claim_period_end,
    batch.format_version,
    batch.status,
    coalesce(batch.snapshot_item_count, count(item.id))::bigint,
    coalesce(batch.snapshot_total_amount, coalesce(sum(item.amount), 0))::numeric(14,2),
    count(item.id) filter (where item.response_outcome is not null)::bigint,
    count(item.id) filter (where item.response_outcome = 'rejected')::bigint,
    batch.snapshot_hash_version = 'legacy-js-v1'
      and batch.status in ('submitted', 'accepted', 'rejected', 'reconciled'),
    batch.snapshot_hash is not null
      and batch.snapshot_hash_version = 'postgres-jsonb-v1'
      and batch.snapshot_item_count is not null
      and batch.snapshot_total_amount is not null
      and batch.exported_at is not null,
    batch.exported_at,
    batch.submitted_at,
    batch.reconciled_at,
    batch.updated_at
  from public.claim_batches batch
  left join public.claim_items item on item.claim_batch_id = batch.id
  where batch.branch_id = p_branch_id
  group by batch.id
  order by batch.claim_period_end desc, batch.id
  limit least(greatest(coalesce(p_limit, 200), 1), 200);
$$;

comment on function public.validate_claim_batch(uuid, uuid, uuid, numeric, uuid) is
  'Atomically validates every draft claim item and freezes the batch before export.';
comment on function public.export_claim_batch(uuid, uuid, uuid, numeric, uuid) is
  'Atomically locks and exports one immutable claim snapshot with AAL2 and idempotency enforcement.';
comment on function public.reconcile_claim_batch(uuid, uuid, uuid, numeric, jsonb, uuid) is
  'Atomically validates full reconciliation coverage and freezes item responses with AAL2 and idempotency enforcement.';
comment on function public.claim_batch_summaries(uuid, integer) is
  'Returns RLS-filtered, database-aggregated claim batch counts and exact decimal totals without PostgREST row-limit truncation.';

revoke all on function private.claim_snapshot_metrics(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.claim_batch_has_ineligible_items(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_claim_plan_scopes(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_claim_allocation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_claim_item_snapshot()
  from public, anon, authenticated, service_role;
revoke all on table private.claim_service_allocations
  from public, anon, authenticated, service_role;
revoke all on function private.validate_claim_batch_atomic(uuid, uuid, uuid, numeric, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.export_claim_batch_atomic(uuid, uuid, uuid, numeric, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_claim_batch_atomic(uuid, uuid, uuid, numeric, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.export_claim_batch(uuid, uuid, uuid, numeric, uuid)
  from public, anon;
revoke all on function public.validate_claim_batch(uuid, uuid, uuid, numeric, uuid)
  from public, anon;
revoke all on function public.reconcile_claim_batch(uuid, uuid, uuid, numeric, jsonb, uuid)
  from public, anon;
revoke all on function public.claim_batch_summaries(uuid, integer)
  from public, anon;

grant execute on function public.export_claim_batch(uuid, uuid, uuid, numeric, uuid)
  to authenticated;
grant execute on function public.validate_claim_batch(uuid, uuid, uuid, numeric, uuid)
  to authenticated;
grant execute on function public.reconcile_claim_batch(uuid, uuid, uuid, numeric, jsonb, uuid)
  to authenticated;
grant execute on function public.claim_batch_summaries(uuid, integer)
  to authenticated;
grant execute on function private.export_claim_batch_atomic(uuid, uuid, uuid, numeric, uuid)
  to authenticated;
grant execute on function private.validate_claim_batch_atomic(uuid, uuid, uuid, numeric, uuid)
  to authenticated;
grant execute on function private.reconcile_claim_batch_atomic(uuid, uuid, uuid, numeric, jsonb, uuid)
  to authenticated;

-- Sensitive state transitions and post-export responses are RPC-only. Draft
-- creation/item insertion remain governed by their existing RLS policies.
revoke update on table public.claim_batches from authenticated;
revoke update on table public.claim_items from authenticated;
