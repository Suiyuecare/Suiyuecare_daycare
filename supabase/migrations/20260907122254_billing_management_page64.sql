-- Page 64: governed billing with approved fee snapshots and immutable ledgers.
-- This surface records offline payments only. It is not a payment gateway and
-- does not generate a statutory invoice or receipt document.

insert into public.permissions (permission_key, description, risk_level) values
  ('billing.read', 'Read branch billing snapshots and reconciliation evidence', 3),
  ('billing.manage', 'Issue bills and record offline payments and receipts', 3),
  ('billing.adjust', 'Record refunds and debit or credit adjustments', 3),
  ('billing.reconcile', 'Run immutable daily billing reconciliations', 3)
on conflict (permission_key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.role_key in ('organization_manager', 'finance_claims')
  and permission.permission_key in (
    'billing.read', 'billing.manage', 'billing.adjust', 'billing.reconcile'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.role_key = 'branch_supervisor'
  and permission.permission_key = 'billing.read'
on conflict do nothing;

create table public.billing_fee_item_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  fee_item_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  fee_code text not null,
  fee_name text not null,
  unit_label text not null,
  unit_price numeric(18,2) not null,
  currency text not null,
  tax_handling text not null,
  effective_from date not null,
  effective_to date,
  source_status text not null,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  governance_note text not null,
  content_hash text not null,
  constraint billing_fee_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint billing_fee_id_scope_key unique (id, organization_id, branch_id),
  constraint billing_fee_id_key_scope_key
    unique (id, organization_id, branch_id, fee_item_key),
  constraint billing_fee_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, fee_item_key)
    references public.billing_fee_item_versions(
      id, organization_id, branch_id, fee_item_key
    ) on delete restrict,
  constraint billing_fee_version_key
    unique (organization_id, branch_id, fee_item_key, version),
  constraint billing_fee_code_version_key
    unique (organization_id, branch_id, fee_code, version),
  constraint billing_fee_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null))
  ),
  constraint billing_fee_text_check check (
    fee_code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'
    and char_length(btrim(fee_name)) between 1 and 120
    and fee_name !~ '[[:cntrl:]]'
    and char_length(btrim(unit_label)) between 1 and 40
    and unit_label !~ '[[:cntrl:]]'
    and char_length(btrim(governance_note)) between 1 and 1000
    and translate(governance_note, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint billing_fee_amount_check check (
    unit_price > 0 and unit_price <= 9999999999999999.99
  ),
  constraint billing_fee_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint billing_fee_tax_check check (
    tax_handling in (
      'explicitly_included_in_unit_price',
      'explicitly_exempt',
      'explicitly_not_applicable'
    )
  ),
  constraint billing_fee_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint billing_fee_source_check check (
    source_status = 'governance_approved'
  ),
  constraint billing_fee_independent_approval_check check (
    proposed_by <> approved_by
  ),
  constraint billing_fee_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  invoice_key uuid not null,
  invoice_number text not null,
  reference_kind text not null default 'internal_non_tax_document',
  version integer not null default 1,
  period_start date not null,
  period_end date not null,
  issued_on date not null,
  due_on date not null,
  currency text not null,
  invoice_total numeric(18,2) not null,
  line_count integer not null,
  lifecycle_status text not null default 'issued',
  created_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null,
  created_at timestamptz not null,
  content_hash text not null,
  constraint billing_invoice_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint billing_invoice_reauth_fkey
    foreign key (reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  constraint billing_invoice_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint billing_invoice_id_tenant_key
    unique (id, organization_id, branch_id),
  constraint billing_invoice_key_unique
    unique (organization_id, branch_id, invoice_key),
  constraint billing_invoice_number_unique
    unique (organization_id, branch_id, invoice_number),
  constraint billing_invoice_version_check check (version = 1),
  constraint billing_invoice_period_check check (
    period_end >= period_start
    and issued_on >= period_end
    and due_on >= issued_on
    and due_on <= issued_on + 366
  ),
  constraint billing_invoice_reference_check check (
    invoice_number ~ '^SYS-BILL-[A-F0-9]{12}$'
    and reference_kind = 'internal_non_tax_document'
  ),
  constraint billing_invoice_amount_check check (
    invoice_total > 0 and invoice_total <= 9999999999999999.99
    and line_count between 1 and 50
  ),
  constraint billing_invoice_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint billing_invoice_status_check check (lifecycle_status = 'issued'),
  constraint billing_invoice_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  invoice_id uuid not null,
  client_id uuid not null,
  line_number integer not null,
  fee_item_version_id uuid not null,
  fee_item_key uuid not null,
  fee_code text not null,
  fee_name text not null,
  unit_label text not null,
  service_date date not null,
  quantity numeric(12,4) not null,
  unit_price numeric(18,2) not null,
  amount numeric(18,2) not null,
  currency text not null,
  tax_handling text not null,
  line_note text,
  content_hash text not null,
  constraint billing_line_invoice_scope_fkey
    foreign key (invoice_id, organization_id, branch_id, client_id)
    references public.billing_invoices(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint billing_line_fee_scope_fkey
    foreign key (fee_item_version_id, organization_id, branch_id, fee_item_key)
    references public.billing_fee_item_versions(
      id, organization_id, branch_id, fee_item_key
    ) on delete restrict,
  constraint billing_line_invoice_number_key unique (invoice_id, line_number),
  constraint billing_line_id_scope_key
    unique (id, organization_id, branch_id, invoice_id),
  constraint billing_line_number_check check (line_number between 1 and 50),
  constraint billing_line_quantity_check check (
    quantity > 0 and quantity <= 99999999.9999
  ),
  constraint billing_line_amount_check check (
    unit_price > 0 and amount > 0
    and amount = quantity * unit_price
  ),
  constraint billing_line_text_check check (
    fee_code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'
    and char_length(btrim(fee_name)) between 1 and 120
    and char_length(btrim(unit_label)) between 1 and 40
    and (line_note is null or (
      char_length(btrim(line_note)) between 1 and 500
      and translate(line_note, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
  ),
  constraint billing_line_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint billing_line_tax_check check (
    tax_handling in (
      'explicitly_included_in_unit_price',
      'explicitly_exempt',
      'explicitly_not_applicable'
    )
  ),
  constraint billing_line_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.billing_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  invoice_id uuid not null,
  client_id uuid not null,
  invoice_ledger_version integer not null,
  branch_ledger_version bigint not null,
  entry_kind text not null,
  amount numeric(18,2) not null,
  signed_amount numeric(18,2) not null,
  balance_after numeric(18,2) not null,
  original_entry_id uuid,
  payment_method text,
  source_channel text not null,
  occurred_at timestamptz not null,
  note text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint billing_entry_invoice_scope_fkey
    foreign key (invoice_id, organization_id, branch_id, client_id)
    references public.billing_invoices(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint billing_entry_reauth_fkey
    foreign key (reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  constraint billing_entry_id_scope_key
    unique (id, organization_id, branch_id, invoice_id),
  constraint billing_entry_original_scope_fkey
    foreign key (original_entry_id, organization_id, branch_id, invoice_id)
    references public.billing_ledger_entries(id, organization_id, branch_id, invoice_id)
    on delete restrict,
  constraint billing_entry_invoice_version_key
    unique (invoice_id, invoice_ledger_version),
  constraint billing_entry_branch_version_key
    unique (organization_id, branch_id, branch_ledger_version),
  constraint billing_entry_version_check check (
    invoice_ledger_version > 0 and branch_ledger_version > 0
  ),
  constraint billing_entry_kind_check check (
    entry_kind in (
      'invoice_charge', 'payment', 'refund',
      'adjustment_debit', 'adjustment_credit'
    )
  ),
  constraint billing_entry_amount_check check (
    amount > 0 and amount <= 9999999999999999.99
    and balance_after >= 0
    and signed_amount = case
      when entry_kind in ('invoice_charge', 'refund', 'adjustment_debit')
        then amount
      else -amount
    end
  ),
  constraint billing_entry_reference_check check (
    (entry_kind = 'refund' and original_entry_id is not null)
    or (entry_kind <> 'refund' and original_entry_id is null)
  ),
  constraint billing_entry_payment_check check (
    (entry_kind = 'payment'
      and payment_method in ('cash', 'bank_transfer', 'offline_other')
      and source_channel = 'staff_recorded_offline')
    or (entry_kind <> 'payment'
      and payment_method is null
      and source_channel = 'internal_ledger')
  ),
  constraint billing_entry_note_check check (
    (entry_kind in ('refund', 'adjustment_debit', 'adjustment_credit')
      and note is not null and char_length(btrim(note)) between 2 and 1000)
    or (entry_kind not in ('refund', 'adjustment_debit', 'adjustment_credit')
      and (note is null or char_length(btrim(note)) between 1 and 1000))
  ),
  constraint billing_entry_control_check check (
    note is null or translate(note, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint billing_entry_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.billing_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  invoice_id uuid not null,
  client_id uuid not null,
  payment_entry_id uuid not null,
  receipt_key uuid not null,
  receipt_number text not null,
  reference_kind text not null default 'internal_non_tax_receipt_record',
  amount numeric(18,2) not null,
  currency text not null,
  issued_at timestamptz not null,
  issued_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null,
  document_status text not null default 'not_configured',
  content_hash text not null,
  constraint billing_receipt_invoice_scope_fkey
    foreign key (invoice_id, organization_id, branch_id, client_id)
    references public.billing_invoices(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint billing_receipt_payment_scope_fkey
    foreign key (payment_entry_id, organization_id, branch_id, invoice_id)
    references public.billing_ledger_entries(id, organization_id, branch_id, invoice_id)
    on delete restrict,
  constraint billing_receipt_reauth_fkey
    foreign key (reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  constraint billing_receipt_id_scope_key
    unique (id, organization_id, branch_id, invoice_id),
  constraint billing_receipt_payment_unique unique (payment_entry_id),
  constraint billing_receipt_key_unique
    unique (organization_id, branch_id, receipt_key),
  constraint billing_receipt_number_unique
    unique (organization_id, branch_id, receipt_number),
  constraint billing_receipt_reference_check check (
    receipt_number ~ '^SYS-REC-[A-F0-9]{12}$'
    and reference_kind = 'internal_non_tax_receipt_record'
    and document_status = 'not_configured'
  ),
  constraint billing_receipt_amount_check check (amount > 0),
  constraint billing_receipt_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint billing_receipt_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.billing_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  reconciliation_date date not null,
  expected_branch_ledger_version bigint not null,
  source_entry_count bigint not null,
  invoice_total numeric(18,2) not null,
  payment_total numeric(18,2) not null,
  refund_total numeric(18,2) not null,
  adjustment_debit_total numeric(18,2) not null,
  adjustment_credit_total numeric(18,2) not null,
  ledger_balance numeric(18,2) not null,
  detail_balance numeric(18,2) not null,
  difference numeric(18,2) not null,
  reconciliation_status text not null,
  source_hash text not null,
  reconciled_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null,
  reconciled_at timestamptz not null,
  content_hash text not null,
  constraint billing_reconciliation_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint billing_reconciliation_reauth_fkey
    foreign key (reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  constraint billing_reconciliation_id_scope_key
    unique (id, organization_id, branch_id),
  constraint billing_reconciliation_source_unique
    unique (organization_id, branch_id, reconciliation_date, source_hash),
  constraint billing_reconciliation_count_check check (
    expected_branch_ledger_version >= 0 and source_entry_count >= 0
  ),
  constraint billing_reconciliation_amount_check check (
    invoice_total >= 0 and payment_total >= 0 and refund_total >= 0
    and adjustment_debit_total >= 0 and adjustment_credit_total >= 0
    and ledger_balance >= 0 and detail_balance >= 0
    and difference = detail_balance - ledger_balance
  ),
  constraint billing_reconciliation_status_check check (
    (reconciliation_status = 'matched' and difference = 0)
    or (reconciliation_status = 'mismatch' and difference <> 0)
  ),
  constraint billing_reconciliation_hash_check check (
    source_hash ~ '^[a-f0-9]{64}$' and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.billing_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_invoice_id uuid,
  result_entry_id uuid,
  result_receipt_id uuid,
  result_reconciliation_id uuid,
  created_at timestamptz not null,
  constraint billing_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint billing_operations_invoice_scope_fkey
    foreign key (result_invoice_id, organization_id, branch_id)
    references public.billing_invoices(id, organization_id, branch_id)
    on delete restrict,
  constraint billing_operations_entry_scope_fkey
    foreign key (result_entry_id, organization_id, branch_id, result_invoice_id)
    references public.billing_ledger_entries(id, organization_id, branch_id, invoice_id)
    on delete restrict,
  constraint billing_operations_receipt_scope_fkey
    foreign key (result_receipt_id, organization_id, branch_id, result_invoice_id)
    references public.billing_receipts(id, organization_id, branch_id, invoice_id)
    on delete restrict,
  constraint billing_operations_reconciliation_scope_fkey
    foreign key (result_reconciliation_id, organization_id, branch_id)
    references public.billing_reconciliation_runs(id, organization_id, branch_id)
    on delete restrict,
  constraint billing_operations_kind_check check (
    operation_kind in (
      'create_invoice', 'record_payment', 'record_refund',
      'record_adjustment_debit', 'record_adjustment_credit',
      'issue_receipt', 'run_reconciliation'
    )
  ),
  constraint billing_operations_result_check check (
    (operation_kind = 'create_invoice'
      and result_invoice_id is not null and result_entry_id is not null
      and result_receipt_id is null and result_reconciliation_id is null)
    or (operation_kind in (
        'record_payment', 'record_refund',
        'record_adjustment_debit', 'record_adjustment_credit'
      ) and result_invoice_id is not null and result_entry_id is not null
      and result_receipt_id is null and result_reconciliation_id is null)
    or (operation_kind = 'issue_receipt'
      and result_invoice_id is not null and result_entry_id is null
      and result_receipt_id is not null and result_reconciliation_id is null)
    or (operation_kind = 'run_reconciliation'
      and result_invoice_id is null and result_entry_id is null
      and result_receipt_id is null and result_reconciliation_id is not null)
  ),
  constraint billing_operations_hash_check check (request_hash ~ '^[a-f0-9]{64}$')
);

create index billing_fee_branch_effective_idx on public.billing_fee_item_versions
  (organization_id, branch_id, effective_from, effective_to);
create index billing_fee_key_idx on public.billing_fee_item_versions
  (fee_item_key, organization_id, branch_id, version desc);
create index billing_fee_previous_idx on public.billing_fee_item_versions
  (previous_version_id) where previous_version_id is not null;
create index billing_fee_proposed_by_idx on public.billing_fee_item_versions (proposed_by);
create index billing_fee_approved_by_idx on public.billing_fee_item_versions (approved_by);
create index billing_invoice_scope_period_idx on public.billing_invoices
  (organization_id, branch_id, period_start, period_end, client_id);
create index billing_invoice_client_idx on public.billing_invoices (client_id);
create index billing_invoice_created_by_idx on public.billing_invoices (created_by);
create index billing_invoice_reauth_idx on public.billing_invoices (reauth_challenge_id);
create index billing_line_scope_idx on public.billing_invoice_lines
  (organization_id, branch_id, invoice_id, line_number);
create index billing_line_client_idx on public.billing_invoice_lines (client_id);
create index billing_line_fee_idx on public.billing_invoice_lines (fee_item_version_id);
create index billing_line_fee_key_idx on public.billing_invoice_lines (fee_item_key);
create index billing_entry_scope_time_idx on public.billing_ledger_entries
  (organization_id, branch_id, occurred_at desc, branch_ledger_version desc);
create index billing_entry_invoice_idx on public.billing_ledger_entries
  (invoice_id, invoice_ledger_version desc);
create index billing_entry_client_idx on public.billing_ledger_entries (client_id);
create index billing_entry_original_idx on public.billing_ledger_entries (original_entry_id)
  where original_entry_id is not null;
create index billing_entry_recorded_by_idx on public.billing_ledger_entries (recorded_by);
create index billing_entry_reauth_idx on public.billing_ledger_entries (reauth_challenge_id);
create index billing_receipt_invoice_idx on public.billing_receipts (invoice_id);
create index billing_receipt_client_idx on public.billing_receipts (client_id);
create index billing_receipt_issued_by_idx on public.billing_receipts (issued_by);
create index billing_receipt_reauth_idx on public.billing_receipts (reauth_challenge_id);
create index billing_reconciliation_scope_date_idx on public.billing_reconciliation_runs
  (organization_id, branch_id, reconciliation_date desc, reconciled_at desc);
create index billing_reconciliation_reconciled_by_idx
  on public.billing_reconciliation_runs (reconciled_by);
create index billing_reconciliation_reauth_idx
  on public.billing_reconciliation_runs (reauth_challenge_id);
create index billing_operations_scope_idx on private.billing_operations
  (organization_id, branch_id, created_at desc);
create index billing_operations_actor_idx on private.billing_operations (actor_user_id);
create index billing_operations_invoice_idx on private.billing_operations (result_invoice_id)
  where result_invoice_id is not null;
create index billing_operations_entry_idx on private.billing_operations (result_entry_id)
  where result_entry_id is not null;
create index billing_operations_receipt_idx on private.billing_operations (result_receipt_id)
  where result_receipt_id is not null;
create index billing_operations_reconciliation_idx
  on private.billing_operations (result_reconciliation_id)
  where result_reconciliation_id is not null;

create or replace function private.billing_records_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'billing records and operation receipts are immutable';
end;
$$;

create trigger billing_fee_item_versions_append_only
before update or delete on public.billing_fee_item_versions
for each row execute function private.billing_records_are_append_only();
create trigger billing_invoices_append_only
before update or delete on public.billing_invoices
for each row execute function private.billing_records_are_append_only();
create trigger billing_invoice_lines_append_only
before update or delete on public.billing_invoice_lines
for each row execute function private.billing_records_are_append_only();
create trigger billing_ledger_entries_append_only
before update or delete on public.billing_ledger_entries
for each row execute function private.billing_records_are_append_only();
create trigger billing_receipts_append_only
before update or delete on public.billing_receipts
for each row execute function private.billing_records_are_append_only();
create trigger billing_reconciliation_runs_append_only
before update or delete on public.billing_reconciliation_runs
for each row execute function private.billing_records_are_append_only();
create trigger billing_operations_append_only
before update or delete on private.billing_operations
for each row execute function private.billing_records_are_append_only();

create trigger billing_fee_item_versions_audit_row_change
after insert on public.billing_fee_item_versions
for each row execute function private.audit_row_change();
create trigger billing_invoices_audit_row_change
after insert on public.billing_invoices
for each row execute function private.audit_row_change();
create trigger billing_invoice_lines_audit_row_change
after insert on public.billing_invoice_lines
for each row execute function private.audit_row_change();
create trigger billing_ledger_entries_audit_row_change
after insert on public.billing_ledger_entries
for each row execute function private.audit_row_change();
create trigger billing_receipts_audit_row_change
after insert on public.billing_receipts
for each row execute function private.audit_row_change();
create trigger billing_reconciliation_runs_audit_row_change
after insert on public.billing_reconciliation_runs
for each row execute function private.audit_row_change();
create trigger billing_operations_audit_row_change
after insert on private.billing_operations
for each row execute function private.audit_row_change();

create or replace function private.validate_billing_fee_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.billing_fee_item_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'billing-fee:' || new.organization_id::text || ':' ||
    new.branch_id::text || ':' || new.fee_item_key::text, 0
  ));
  select fee.* into v_latest
  from public.billing_fee_item_versions fee
  where fee.organization_id = new.organization_id
    and fee.branch_id = new.branch_id
    and fee.fee_item_key = new.fee_item_key
  order by fee.version desc
  limit 1
  for share;
  if found then
    if new.version <> v_latest.version + 1
       or new.previous_version_id <> v_latest.id
       or new.fee_code <> v_latest.fee_code
       or new.currency <> v_latest.currency then
      raise exception using errcode = '40001',
        message = 'billing fee version chain is stale or changes stable identity';
    end if;
  elsif new.version <> 1 or new.previous_version_id is not null then
    raise exception using errcode = '40001',
      message = 'billing fee chain must begin at version one';
  end if;
  if exists (
    select 1 from public.billing_fee_item_versions fee
    where fee.organization_id = new.organization_id
      and fee.branch_id = new.branch_id
      and fee.fee_item_key = new.fee_item_key
      and daterange(fee.effective_from, fee.effective_to, '[]') &&
        daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception using errcode = '23P01',
      message = 'billing fee effective periods cannot overlap';
  end if;
  return new;
end;
$$;

create trigger billing_fee_item_versions_validate
before insert on public.billing_fee_item_versions
for each row execute function private.validate_billing_fee_version();

alter table public.billing_fee_item_versions enable row level security;
alter table public.billing_fee_item_versions force row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoices force row level security;
alter table public.billing_invoice_lines enable row level security;
alter table public.billing_invoice_lines force row level security;
alter table public.billing_ledger_entries enable row level security;
alter table public.billing_ledger_entries force row level security;
alter table public.billing_receipts enable row level security;
alter table public.billing_receipts force row level security;
alter table public.billing_reconciliation_runs enable row level security;
alter table public.billing_reconciliation_runs force row level security;
alter table private.billing_operations enable row level security;
alter table private.billing_operations force row level security;

comment on table public.billing_fee_item_versions is
  'Page-82-governed, independently approved fee evidence; Page 64 never invents or publishes rates.';
comment on table public.billing_ledger_entries is
  'Append-only exact-decimal branch and invoice ledger; online payment channels are impossible.';
comment on table public.billing_receipts is
  'Internal immutable receipt record only; statutory document generation remains not configured.';

create or replace function private.billing_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'finance')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.require_billing_reauth_evidence(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current billing AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current billing AAL2 evidence is required';
  end;
  if v_session_id is null then
    raise exception using errcode = '42501',
      message = 'current billing AAL2 evidence is required';
  end if;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor
    and event.session_id = v_session_id
    and event.aal = 'aal2'
    and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current billing AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.create_billing_invoice_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_invoice_key uuid,
  p_period_start date,
  p_period_end date,
  p_issued_on date,
  p_due_on date,
  p_lines jsonb,
  p_expected_invoice_version integer,
  p_expected_branch_ledger_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  client_id uuid,
  invoice_id uuid,
  invoice_key uuid,
  invoice_number text,
  invoice_version integer,
  invoice_ledger_version integer,
  branch_ledger_version bigint,
  invoice_total text,
  balance_after text,
  line_count integer,
  payment_status text,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_reauth uuid;
  v_request_hash text;
  v_existing private.billing_operations%rowtype;
  v_existing_invoice public.billing_invoices%rowtype;
  v_existing_entry public.billing_ledger_entries%rowtype;
  v_client public.clients%rowtype;
  v_line jsonb;
  v_line_number integer;
  v_fee public.billing_fee_item_versions%rowtype;
  v_fee_id uuid;
  v_service_date date;
  v_quantity_text text;
  v_quantity numeric(12,4);
  v_line_amount numeric(18,2);
  v_total numeric(18,2) := 0;
  v_currency text;
  v_note text;
  v_invoice public.billing_invoices%rowtype;
  v_entry public.billing_ledger_entries%rowtype;
  v_current_branch_version bigint;
  v_lines_count integer;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_invoice_key is null
     or p_period_start is null or p_period_end is null
     or p_issued_on is null or p_due_on is null
     or p_expected_invoice_version is null
     or p_expected_branch_ledger_version is null
     or p_idempotency_key is null
     or p_expected_invoice_version <> 0
     or p_expected_branch_ledger_version < 0
     or p_period_end < p_period_start
     or p_period_end > p_period_start + 366
     or p_issued_on < p_period_end
     or p_due_on < p_issued_on
     or p_due_on > p_issued_on + 366
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'invalid billing invoice input';
  end if;
  if not private.billing_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'billing.manage'
  ) then
    raise exception using errcode = '42501',
      message = 'billing invoice creation is not permitted';
  end if;
  v_reauth := private.require_billing_reauth_evidence(v_actor, v_now);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'invoice_key', p_invoice_key,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'issued_on', p_issued_on,
    'due_on', p_due_on,
    'lines', p_lines,
    'expected_invoice_version', p_expected_invoice_version,
    'expected_branch_ledger_version', p_expected_branch_ledger_version
  )::text, 'UTF8')), 'hex');

  select operation.* into v_existing
  from private.billing_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request_hash
       or v_existing.operation_kind <> 'create_invoice'
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id then
      raise exception using errcode = '23505',
        message = 'billing idempotency key conflict';
    end if;
    select invoice.* into strict v_existing_invoice
    from public.billing_invoices invoice
    where invoice.id = v_existing.result_invoice_id;
    select entry.* into strict v_existing_entry
    from public.billing_ledger_entries entry
    where entry.id = v_existing.result_entry_id;
    return query select
      v_existing_invoice.organization_id, v_existing_invoice.branch_id,
      v_existing_invoice.client_id, v_existing_invoice.id,
      v_existing_invoice.invoice_key, v_existing_invoice.invoice_number,
      v_existing_invoice.version, v_existing_entry.invoice_ledger_version,
      v_existing_entry.branch_ledger_version,
      v_existing_invoice.invoice_total::text,
      v_existing_entry.balance_after::text, v_existing_invoice.line_count,
      'unpaid'::text, v_existing.created_at, true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for share;
  if not found
     or v_client.admitted_on is null
     or p_period_end < v_client.admitted_on
     or (v_client.ended_on is not null and p_period_start > v_client.ended_on) then
    raise exception using errcode = '42501',
      message = 'billing client is outside current branch or service period';
  end if;

  for v_line, v_line_number in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality item(value, ordinality)
  loop
    if jsonb_typeof(v_line) <> 'object'
       or not (v_line ? 'fee_item_version_id')
       or not (v_line ? 'service_date')
       or not (v_line ? 'quantity')
       or exists (
         select 1 from jsonb_object_keys(v_line) key
         where key not in (
           'fee_item_version_id', 'service_date', 'quantity', 'line_note'
         )
       ) then
      raise exception using errcode = '22023',
        message = 'invalid billing invoice line shape';
    end if;
    begin
      v_fee_id := (v_line ->> 'fee_item_version_id')::uuid;
      v_service_date := (v_line ->> 'service_date')::date;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '22023',
        message = 'invalid billing invoice line reference';
    end;
    if (v_line ->> 'service_date') !~ '^\d{4}-\d{2}-\d{2}$'
       or v_service_date::text <> (v_line ->> 'service_date')
       or v_service_date < p_period_start or v_service_date > p_period_end
       or v_service_date < v_client.admitted_on
       or (v_client.ended_on is not null and v_service_date > v_client.ended_on) then
      raise exception using errcode = '22023',
        message = 'billing service date is outside the invoice or client period';
    end if;
    v_quantity_text := v_line ->> 'quantity';
    if v_quantity_text is null
       or v_quantity_text !~ '^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$' then
      raise exception using errcode = '22023',
        message = 'invalid exact billing quantity';
    end if;
    v_quantity := v_quantity_text::numeric(12,4);
    if v_quantity <= 0 then
      raise exception using errcode = '22023',
        message = 'invalid exact billing quantity';
    end if;
    v_note := nullif(btrim(v_line ->> 'line_note'), '');
    if (v_line ? 'line_note') and (
      v_note is null or char_length(v_note) > 500
      or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
    ) then
      raise exception using errcode = '22023',
        message = 'invalid billing invoice line note';
    end if;
    select fee.* into v_fee
    from public.billing_fee_item_versions fee
    where fee.id = v_fee_id
      and fee.organization_id = p_expected_organization_id
      and fee.branch_id = p_expected_branch_id
      and fee.source_status = 'governance_approved'
      and fee.effective_from <= v_service_date
      and (fee.effective_to is null or fee.effective_to >= v_service_date)
    for share;
    if not found then
      raise exception using errcode = '55000',
        message = 'approved billing fee version is not configured for service date';
    end if;
    if exists (
      select 1 from public.billing_fee_item_versions other_fee
      where other_fee.organization_id = p_expected_organization_id
        and other_fee.branch_id = p_expected_branch_id
        and other_fee.fee_item_key = v_fee.fee_item_key
        and other_fee.id <> v_fee.id
        and other_fee.source_status = 'governance_approved'
        and other_fee.effective_from <= v_service_date
        and (other_fee.effective_to is null or other_fee.effective_to >= v_service_date)
    ) then
      raise exception using errcode = '55000',
        message = 'billing fee configuration is ambiguous';
    end if;
    if v_currency is null then
      v_currency := v_fee.currency;
    elsif v_currency <> v_fee.currency then
      raise exception using errcode = '22023',
        message = 'billing invoice cannot mix currencies';
    end if;
    if round(v_quantity * v_fee.unit_price, 2) <> v_quantity * v_fee.unit_price then
      raise exception using errcode = '22023',
        message = 'billing line requires an unconfigured rounding rule';
    end if;
    v_line_amount := (v_quantity * v_fee.unit_price)::numeric(18,2);
    v_total := v_total + v_line_amount;
  end loop;
  v_lines_count := jsonb_array_length(p_lines);
  if v_total <= 0 then
    raise exception using errcode = '22023', message = 'billing invoice total is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'billing-branch-ledger:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text, 0
  ));
  select coalesce(max(entry.branch_ledger_version), 0) into v_current_branch_version
  from public.billing_ledger_entries entry
  where entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id;
  if v_current_branch_version <> p_expected_branch_ledger_version then
    raise exception using errcode = '40001',
      message = 'billing branch ledger version conflict';
  end if;

  insert into public.billing_invoices (
    organization_id, branch_id, client_id, invoice_key, invoice_number,
    period_start, period_end, issued_on, due_on, currency,
    invoice_total, line_count, created_by, reauth_challenge_id,
    created_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_invoice_key,
    'SYS-BILL-' || upper(substr(replace(p_invoice_key::text, '-', ''), 1, 12)),
    p_period_start, p_period_end, p_issued_on, p_due_on, v_currency,
    v_total, v_lines_count, v_actor, v_reauth, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'hash_version', 1, 'invoice_key', p_invoice_key,
      'client_id', p_client_id, 'period_start', p_period_start,
      'period_end', p_period_end, 'issued_on', p_issued_on,
      'due_on', p_due_on, 'currency', v_currency,
      'invoice_total', v_total, 'line_count', v_lines_count,
      'created_by', v_actor, 'created_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_invoice;

  for v_line, v_line_number in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality item(value, ordinality)
  loop
    v_fee_id := (v_line ->> 'fee_item_version_id')::uuid;
    v_service_date := (v_line ->> 'service_date')::date;
    v_quantity := (v_line ->> 'quantity')::numeric(12,4);
    v_note := nullif(btrim(v_line ->> 'line_note'), '');
    select fee.* into strict v_fee
    from public.billing_fee_item_versions fee
    where fee.id = v_fee_id
      and fee.organization_id = p_expected_organization_id
      and fee.branch_id = p_expected_branch_id;
    v_line_amount := (v_quantity * v_fee.unit_price)::numeric(18,2);
    insert into public.billing_invoice_lines (
      organization_id, branch_id, invoice_id, client_id, line_number,
      fee_item_version_id, fee_item_key, fee_code, fee_name, unit_label,
      service_date, quantity, unit_price, amount, currency, tax_handling,
      line_note, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_invoice.id,
      p_client_id, v_line_number, v_fee.id, v_fee.fee_item_key,
      v_fee.fee_code, v_fee.fee_name, v_fee.unit_label,
      v_service_date, v_quantity, v_fee.unit_price, v_line_amount,
      v_fee.currency, v_fee.tax_handling, v_note,
      encode(sha256(convert_to(jsonb_build_object(
        'hash_version', 1, 'invoice_id', v_invoice.id,
        'line_number', v_line_number, 'fee_item_version_id', v_fee.id,
        'service_date', v_service_date, 'quantity', v_quantity,
        'unit_price', v_fee.unit_price, 'amount', v_line_amount,
        'line_note', v_note
      )::text, 'UTF8')), 'hex')
    );
  end loop;

  insert into public.billing_ledger_entries (
    organization_id, branch_id, invoice_id, client_id,
    invoice_ledger_version, branch_ledger_version, entry_kind,
    amount, signed_amount, balance_after, source_channel, occurred_at,
    recorded_by, reauth_challenge_id, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_invoice.id,
    p_client_id, 1, v_current_branch_version + 1, 'invoice_charge',
    v_total, v_total, v_total, 'internal_ledger',
    (p_issued_on::timestamp at time zone 'Asia/Taipei'),
    v_actor, v_reauth, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'hash_version', 1, 'invoice_id', v_invoice.id,
      'invoice_ledger_version', 1,
      'branch_ledger_version', v_current_branch_version + 1,
      'entry_kind', 'invoice_charge', 'amount', v_total,
      'balance_after', v_total, 'recorded_by', v_actor,
      'recorded_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_entry;

  insert into private.billing_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_invoice_id, result_entry_id,
    created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'create_invoice', v_request_hash,
    v_invoice.id, v_entry.id, v_now
  );
  return query select
    v_invoice.organization_id, v_invoice.branch_id, v_invoice.client_id,
    v_invoice.id, v_invoice.invoice_key, v_invoice.invoice_number,
    v_invoice.version, v_entry.invoice_ledger_version,
    v_entry.branch_ledger_version, v_invoice.invoice_total::text,
    v_entry.balance_after::text, v_invoice.line_count,
    'unpaid'::text, v_now, false;
end;
$$;

create or replace function public.create_billing_invoice(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_invoice_key uuid,
  p_period_start date,
  p_period_end date,
  p_issued_on date,
  p_due_on date,
  p_lines jsonb,
  p_expected_invoice_version integer,
  p_expected_branch_ledger_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, client_id uuid, invoice_id uuid,
  invoice_key uuid, invoice_number text, invoice_version integer,
  invoice_ledger_version integer, branch_ledger_version bigint,
  invoice_total text, balance_after text, line_count integer,
  payment_status text, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.create_billing_invoice_guarded(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_invoice_key, p_period_start, p_period_end, p_issued_on, p_due_on,
    p_lines, p_expected_invoice_version, p_expected_branch_ledger_version,
    p_idempotency_key
  );
$$;

create or replace function private.record_billing_entry_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_invoice_id uuid,
  p_entry_kind text,
  p_amount_text text,
  p_original_entry_id uuid,
  p_payment_method text,
  p_occurred_at timestamptz,
  p_note text,
  p_expected_invoice_ledger_version integer,
  p_expected_branch_ledger_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  client_id uuid,
  invoice_id uuid,
  entry_id uuid,
  entry_kind text,
  amount text,
  signed_amount text,
  balance_after text,
  invoice_ledger_version integer,
  branch_ledger_version bigint,
  payment_status text,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_reauth uuid;
  v_amount numeric(18,2);
  v_clean_note text := nullif(btrim(p_note), '');
  v_request_hash text;
  v_operation_kind text;
  v_permission text;
  v_existing private.billing_operations%rowtype;
  v_existing_entry public.billing_ledger_entries%rowtype;
  v_invoice public.billing_invoices%rowtype;
  v_original public.billing_ledger_entries%rowtype;
  v_invoice_version integer;
  v_branch_version bigint;
  v_balance numeric(18,2);
  v_signed numeric(18,2);
  v_balance_after numeric(18,2);
  v_refunded numeric(18,2);
  v_entry public.billing_ledger_entries%rowtype;
  v_status text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_invoice_id is null or p_idempotency_key is null
     or p_entry_kind not in (
       'payment', 'refund', 'adjustment_debit', 'adjustment_credit'
     )
     or p_expected_invoice_ledger_version is null
     or p_expected_invoice_ledger_version < 1
     or p_expected_branch_ledger_version is null
     or p_expected_branch_ledger_version < 1
     or p_amount_text is null
     or p_amount_text !~ '^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$'
     or p_occurred_at is null
     or p_occurred_at > v_now + interval '5 minutes'
     or (v_clean_note is not null and (
       char_length(v_clean_note) > 1000
       or translate(v_clean_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023', message = 'invalid billing entry input';
  end if;
  v_amount := p_amount_text::numeric(18,2);
  if v_amount <= 0 then
    raise exception using errcode = '22023', message = 'billing amount must be positive';
  end if;
  if p_entry_kind = 'payment' then
    v_permission := 'billing.manage';
    v_operation_kind := 'record_payment';
    if p_payment_method not in ('cash', 'bank_transfer', 'offline_other')
       or p_original_entry_id is not null then
      raise exception using errcode = '22023',
        message = 'billing payment must use an approved offline method';
    end if;
  else
    v_permission := 'billing.adjust';
    v_operation_kind := 'record_' || p_entry_kind;
    if p_payment_method is not null
       or v_clean_note is null or char_length(v_clean_note) < 2
       or ((p_entry_kind = 'refund') <> (p_original_entry_id is not null)) then
      raise exception using errcode = '22023',
        message = 'billing adjustment or refund evidence is incomplete';
    end if;
  end if;
  if not private.billing_current_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission
  ) then
    raise exception using errcode = '42501',
      message = 'billing entry operation is not permitted';
  end if;
  v_reauth := private.require_billing_reauth_evidence(v_actor, v_now);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'hash_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'invoice_id', p_invoice_id,
    'entry_kind', p_entry_kind, 'amount_text', p_amount_text,
    'original_entry_id', p_original_entry_id,
    'payment_method', p_payment_method, 'occurred_at', p_occurred_at,
    'note', v_clean_note,
    'expected_invoice_ledger_version', p_expected_invoice_ledger_version,
    'expected_branch_ledger_version', p_expected_branch_ledger_version
  )::text, 'UTF8')), 'hex');

  select operation.* into v_existing
  from private.billing_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request_hash
       or v_existing.operation_kind <> v_operation_kind
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.result_invoice_id <> p_invoice_id then
      raise exception using errcode = '23505',
        message = 'billing idempotency key conflict';
    end if;
    select entry.* into strict v_existing_entry
    from public.billing_ledger_entries entry
    where entry.id = v_existing.result_entry_id;
    select invoice.* into strict v_invoice
    from public.billing_invoices invoice
    where invoice.id = v_existing_entry.invoice_id;
    v_status := case
      when v_existing_entry.balance_after = 0 then 'paid'
      when v_existing_entry.balance_after = v_invoice.invoice_total then 'unpaid'
      else 'partial'
    end;
    return query select v_existing_entry.organization_id,
      v_existing_entry.branch_id, v_existing_entry.client_id,
      v_existing_entry.invoice_id, v_existing_entry.id,
      v_existing_entry.entry_kind, v_existing_entry.amount::text,
      v_existing_entry.signed_amount::text,
      v_existing_entry.balance_after::text,
      v_existing_entry.invoice_ledger_version,
      v_existing_entry.branch_ledger_version, v_status,
      v_existing.created_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'billing-branch-ledger:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'billing-invoice-ledger:' || p_invoice_id::text, 0
  ));
  select invoice.* into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id
    and invoice.organization_id = p_expected_organization_id
    and invoice.branch_id = p_expected_branch_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'billing invoice is outside scope';
  end if;
  if p_occurred_at < (v_invoice.issued_on::timestamp at time zone 'Asia/Taipei') then
    raise exception using errcode = '22023',
      message = 'billing entry cannot occur before invoice issuance';
  end if;
  select coalesce(max(entry.invoice_ledger_version), 0),
    coalesce((array_agg(entry.balance_after order by entry.invoice_ledger_version desc))[1], 0)
    into v_invoice_version, v_balance
  from public.billing_ledger_entries entry
  where entry.invoice_id = v_invoice.id;
  select coalesce(max(entry.branch_ledger_version), 0)
    into v_branch_version
  from public.billing_ledger_entries entry
  where entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id;
  if v_invoice_version <> p_expected_invoice_ledger_version
     or v_branch_version <> p_expected_branch_ledger_version then
    raise exception using errcode = '40001',
      message = 'billing ledger version conflict';
  end if;
  if v_balance < 0 then
    raise exception using errcode = '23514',
      message = 'billing ledger is inconsistent';
  end if;
  if p_entry_kind = 'refund' then
    select entry.* into v_original
    from public.billing_ledger_entries entry
    where entry.id = p_original_entry_id
      and entry.organization_id = p_expected_organization_id
      and entry.branch_id = p_expected_branch_id
      and entry.invoice_id = p_invoice_id
      and entry.entry_kind = 'payment'
    for share;
    if not found then
      raise exception using errcode = '22023',
        message = 'billing refund must reference a payment on the same invoice';
    end if;
    select coalesce(sum(entry.amount), 0) into v_refunded
    from public.billing_ledger_entries entry
    where entry.original_entry_id = v_original.id
      and entry.entry_kind = 'refund';
    if v_refunded + v_amount > v_original.amount then
      raise exception using errcode = '23514',
        message = 'billing refund exceeds original payment';
    end if;
  end if;
  v_signed := case
    when p_entry_kind in ('refund', 'adjustment_debit') then v_amount
    else -v_amount
  end;
  v_balance_after := v_balance + v_signed;
  if v_balance_after < 0 then
    raise exception using errcode = '23514',
      message = 'billing entry would create a negative balance';
  end if;

  insert into public.billing_ledger_entries (
    organization_id, branch_id, invoice_id, client_id,
    invoice_ledger_version, branch_ledger_version, entry_kind,
    amount, signed_amount, balance_after, original_entry_id,
    payment_method, source_channel, occurred_at, note, recorded_by,
    reauth_challenge_id, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_invoice.id,
    v_invoice.client_id, v_invoice_version + 1, v_branch_version + 1,
    p_entry_kind, v_amount, v_signed, v_balance_after,
    p_original_entry_id, p_payment_method,
    case when p_entry_kind = 'payment'
      then 'staff_recorded_offline' else 'internal_ledger' end,
    p_occurred_at, v_clean_note, v_actor, v_reauth, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'hash_version', 1, 'invoice_id', v_invoice.id,
      'invoice_ledger_version', v_invoice_version + 1,
      'branch_ledger_version', v_branch_version + 1,
      'entry_kind', p_entry_kind, 'amount', v_amount,
      'signed_amount', v_signed, 'balance_after', v_balance_after,
      'original_entry_id', p_original_entry_id,
      'payment_method', p_payment_method,
      'source_channel', case when p_entry_kind = 'payment'
        then 'staff_recorded_offline' else 'internal_ledger' end,
      'occurred_at', p_occurred_at, 'note', v_clean_note,
      'recorded_by', v_actor, 'recorded_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_entry;
  insert into private.billing_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_invoice_id, result_entry_id,
    created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_operation_kind, v_request_hash,
    v_invoice.id, v_entry.id, v_now
  );
  v_status := case
    when v_balance_after = 0 then 'paid'
    when v_balance_after = v_invoice.invoice_total then 'unpaid'
    else 'partial'
  end;
  return query select v_entry.organization_id, v_entry.branch_id,
    v_entry.client_id, v_entry.invoice_id, v_entry.id,
    v_entry.entry_kind, v_entry.amount::text, v_entry.signed_amount::text,
    v_entry.balance_after::text, v_entry.invoice_ledger_version,
    v_entry.branch_ledger_version, v_status, v_now, false;
end;
$$;

create or replace function public.record_billing_entry(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_invoice_id uuid,
  p_entry_kind text,
  p_amount_text text,
  p_original_entry_id uuid,
  p_payment_method text,
  p_occurred_at timestamptz,
  p_note text,
  p_expected_invoice_ledger_version integer,
  p_expected_branch_ledger_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, client_id uuid, invoice_id uuid,
  entry_id uuid, entry_kind text, amount text, signed_amount text,
  balance_after text, invoice_ledger_version integer,
  branch_ledger_version bigint, payment_status text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.record_billing_entry_guarded(
    p_expected_organization_id, p_expected_branch_id, p_invoice_id,
    p_entry_kind, p_amount_text, p_original_entry_id, p_payment_method,
    p_occurred_at, p_note, p_expected_invoice_ledger_version,
    p_expected_branch_ledger_version, p_idempotency_key
  );
$$;

create or replace function private.issue_billing_receipt_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_invoice_id uuid,
  p_payment_entry_id uuid,
  p_receipt_key uuid,
  p_expected_invoice_ledger_version integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  client_id uuid,
  invoice_id uuid,
  payment_entry_id uuid,
  receipt_id uuid,
  receipt_key uuid,
  receipt_number text,
  amount text,
  currency text,
  document_status text,
  issued_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_reauth uuid;
  v_request_hash text;
  v_existing private.billing_operations%rowtype;
  v_existing_receipt public.billing_receipts%rowtype;
  v_invoice public.billing_invoices%rowtype;
  v_payment public.billing_ledger_entries%rowtype;
  v_current_version integer;
  v_receipt public.billing_receipts%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_invoice_id is null or p_payment_entry_id is null
     or p_receipt_key is null or p_idempotency_key is null
     or p_expected_invoice_ledger_version is null
     or p_expected_invoice_ledger_version < 2 then
    raise exception using errcode = '22023', message = 'invalid billing receipt input';
  end if;
  if not private.billing_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'billing.manage'
  ) then
    raise exception using errcode = '42501',
      message = 'billing receipt operation is not permitted';
  end if;
  v_reauth := private.require_billing_reauth_evidence(v_actor, v_now);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'hash_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'invoice_id', p_invoice_id,
    'payment_entry_id', p_payment_entry_id, 'receipt_key', p_receipt_key,
    'expected_invoice_ledger_version', p_expected_invoice_ledger_version
  )::text, 'UTF8')), 'hex');
  select operation.* into v_existing
  from private.billing_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request_hash
       or v_existing.operation_kind <> 'issue_receipt'
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.result_invoice_id <> p_invoice_id then
      raise exception using errcode = '23505',
        message = 'billing idempotency key conflict';
    end if;
    select receipt.* into strict v_existing_receipt
    from public.billing_receipts receipt
    where receipt.id = v_existing.result_receipt_id;
    return query select v_existing_receipt.organization_id,
      v_existing_receipt.branch_id, v_existing_receipt.client_id,
      v_existing_receipt.invoice_id, v_existing_receipt.payment_entry_id,
      v_existing_receipt.id, v_existing_receipt.receipt_key,
      v_existing_receipt.receipt_number, v_existing_receipt.amount::text,
      v_existing_receipt.currency, v_existing_receipt.document_status,
      v_existing_receipt.issued_at, true;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'billing-invoice-ledger:' || p_invoice_id::text, 0
  ));
  select invoice.* into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id
    and invoice.organization_id = p_expected_organization_id
    and invoice.branch_id = p_expected_branch_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'billing invoice is outside scope';
  end if;
  select coalesce(max(entry.invoice_ledger_version), 0)
    into v_current_version
  from public.billing_ledger_entries entry
  where entry.invoice_id = v_invoice.id;
  if v_current_version <> p_expected_invoice_ledger_version then
    raise exception using errcode = '40001',
      message = 'billing invoice ledger version conflict';
  end if;
  select entry.* into v_payment
  from public.billing_ledger_entries entry
  where entry.id = p_payment_entry_id
    and entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id
    and entry.invoice_id = p_invoice_id
    and entry.entry_kind = 'payment'
  for share;
  if not found then
    raise exception using errcode = '22023',
      message = 'billing receipt must reference an offline payment';
  end if;
  if exists (
    select 1 from public.billing_receipts receipt
    where receipt.payment_entry_id = p_payment_entry_id
  ) then
    raise exception using errcode = '23505',
      message = 'billing payment already has an internal receipt record';
  end if;
  insert into public.billing_receipts (
    organization_id, branch_id, invoice_id, client_id,
    payment_entry_id, receipt_key, receipt_number, amount, currency,
    issued_at, issued_by, reauth_challenge_id, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_invoice.id,
    v_invoice.client_id, v_payment.id, p_receipt_key,
    'SYS-REC-' || upper(substr(replace(p_receipt_key::text, '-', ''), 1, 12)),
    v_payment.amount, v_invoice.currency, v_now, v_actor, v_reauth,
    encode(sha256(convert_to(jsonb_build_object(
      'hash_version', 1, 'invoice_id', v_invoice.id,
      'payment_entry_id', v_payment.id, 'receipt_key', p_receipt_key,
      'amount', v_payment.amount, 'currency', v_invoice.currency,
      'issued_at', v_now, 'issued_by', v_actor,
      'document_status', 'not_configured'
    )::text, 'UTF8')), 'hex')
  ) returning * into v_receipt;
  insert into private.billing_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_invoice_id, result_receipt_id,
    created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'issue_receipt', v_request_hash,
    v_invoice.id, v_receipt.id, v_now
  );
  return query select v_receipt.organization_id, v_receipt.branch_id,
    v_receipt.client_id, v_receipt.invoice_id,
    v_receipt.payment_entry_id, v_receipt.id, v_receipt.receipt_key,
    v_receipt.receipt_number, v_receipt.amount::text,
    v_receipt.currency, v_receipt.document_status,
    v_receipt.issued_at, false;
end;
$$;

create or replace function public.issue_billing_receipt(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_invoice_id uuid,
  p_payment_entry_id uuid,
  p_receipt_key uuid,
  p_expected_invoice_ledger_version integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, client_id uuid, invoice_id uuid,
  payment_entry_id uuid, receipt_id uuid, receipt_key uuid,
  receipt_number text, amount text, currency text, document_status text,
  issued_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.issue_billing_receipt_guarded(
    p_expected_organization_id, p_expected_branch_id, p_invoice_id,
    p_payment_entry_id, p_receipt_key,
    p_expected_invoice_ledger_version, p_idempotency_key
  );
$$;

create or replace function private.run_billing_reconciliation_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reconciliation_date date,
  p_expected_branch_ledger_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  reconciliation_id uuid,
  reconciliation_date date,
  expected_branch_ledger_version bigint,
  source_entry_count bigint,
  invoice_total text,
  payment_total text,
  refund_total text,
  adjustment_debit_total text,
  adjustment_credit_total text,
  ledger_balance text,
  detail_balance text,
  difference text,
  reconciliation_status text,
  source_hash text,
  reconciled_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_cutoff timestamptz;
  v_reauth uuid;
  v_request_hash text;
  v_existing private.billing_operations%rowtype;
  v_existing_run public.billing_reconciliation_runs%rowtype;
  v_current_branch_version bigint;
  v_source_count bigint;
  v_invoice_total numeric(18,2);
  v_payment_total numeric(18,2);
  v_refund_total numeric(18,2);
  v_debit_total numeric(18,2);
  v_credit_total numeric(18,2);
  v_ledger_balance numeric(18,2);
  v_detail_balance numeric(18,2);
  v_difference numeric(18,2);
  v_source_hash text;
  v_run public.billing_reconciliation_runs%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_reconciliation_date is null or p_reconciliation_date > v_today
     or p_expected_branch_ledger_version is null
     or p_expected_branch_ledger_version < 0
     or p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'invalid billing reconciliation input';
  end if;
  if not private.billing_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'billing.reconcile'
  ) then
    raise exception using errcode = '42501',
      message = 'billing reconciliation is not permitted';
  end if;
  v_reauth := private.require_billing_reauth_evidence(v_actor, v_now);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'hash_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'reconciliation_date', p_reconciliation_date,
    'expected_branch_ledger_version', p_expected_branch_ledger_version
  )::text, 'UTF8')), 'hex');
  select operation.* into v_existing
  from private.billing_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request_hash
       or v_existing.operation_kind <> 'run_reconciliation'
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id then
      raise exception using errcode = '23505',
        message = 'billing idempotency key conflict';
    end if;
    select reconciliation.* into strict v_existing_run
    from public.billing_reconciliation_runs reconciliation
    where reconciliation.id = v_existing.result_reconciliation_id;
    return query select v_existing_run.organization_id,
      v_existing_run.branch_id, v_existing_run.id,
      v_existing_run.reconciliation_date,
      v_existing_run.expected_branch_ledger_version,
      v_existing_run.source_entry_count,
      v_existing_run.invoice_total::text,
      v_existing_run.payment_total::text,
      v_existing_run.refund_total::text,
      v_existing_run.adjustment_debit_total::text,
      v_existing_run.adjustment_credit_total::text,
      v_existing_run.ledger_balance::text,
      v_existing_run.detail_balance::text,
      v_existing_run.difference::text,
      v_existing_run.reconciliation_status,
      v_existing_run.source_hash, v_existing_run.reconciled_at, true;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'billing-branch-ledger:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text, 0
  ));
  select coalesce(max(entry.branch_ledger_version), 0)
    into v_current_branch_version
  from public.billing_ledger_entries entry
  where entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id;
  if v_current_branch_version <> p_expected_branch_ledger_version then
    raise exception using errcode = '40001',
      message = 'billing branch ledger version conflict';
  end if;
  v_cutoff := ((p_reconciliation_date + 1)::timestamp at time zone 'Asia/Taipei');
  select count(*),
    coalesce(sum(entry.amount) filter (
      where entry.entry_kind = 'payment'
    ), 0),
    coalesce(sum(entry.amount) filter (
      where entry.entry_kind = 'refund'
    ), 0),
    coalesce(sum(entry.amount) filter (
      where entry.entry_kind = 'adjustment_debit'
    ), 0),
    coalesce(sum(entry.amount) filter (
      where entry.entry_kind = 'adjustment_credit'
    ), 0),
    coalesce(sum(entry.signed_amount), 0),
    encode(sha256(convert_to(coalesce(string_agg(
      entry.id::text || ':' || entry.content_hash,
      '|' order by entry.branch_ledger_version
    ), 'empty'), 'UTF8')), 'hex')
  into v_source_count, v_payment_total, v_refund_total,
    v_debit_total, v_credit_total, v_ledger_balance, v_source_hash
  from public.billing_ledger_entries entry
  where entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id
    and entry.occurred_at < v_cutoff;
  select coalesce(sum(invoice.invoice_total), 0)
    into v_invoice_total
  from public.billing_invoices invoice
  where invoice.organization_id = p_expected_organization_id
    and invoice.branch_id = p_expected_branch_id
    and invoice.issued_on <= p_reconciliation_date;
  v_detail_balance := v_invoice_total - v_payment_total + v_refund_total
    + v_debit_total - v_credit_total;
  v_difference := v_detail_balance - v_ledger_balance;
  if v_detail_balance < 0 or v_ledger_balance < 0 then
    raise exception using errcode = '23514',
      message = 'billing reconciliation found an invalid negative balance';
  end if;
  insert into public.billing_reconciliation_runs (
    organization_id, branch_id, reconciliation_date,
    expected_branch_ledger_version, source_entry_count, invoice_total,
    payment_total, refund_total, adjustment_debit_total,
    adjustment_credit_total, ledger_balance, detail_balance, difference,
    reconciliation_status, source_hash, reconciled_by,
    reauth_challenge_id, reconciled_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_reconciliation_date,
    p_expected_branch_ledger_version, v_source_count, v_invoice_total,
    v_payment_total, v_refund_total, v_debit_total, v_credit_total,
    v_ledger_balance, v_detail_balance, v_difference,
    case when v_difference = 0 then 'matched' else 'mismatch' end,
    v_source_hash, v_actor, v_reauth, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'hash_version', 1, 'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id,
      'reconciliation_date', p_reconciliation_date,
      'expected_branch_ledger_version', p_expected_branch_ledger_version,
      'source_entry_count', v_source_count, 'invoice_total', v_invoice_total,
      'payment_total', v_payment_total, 'refund_total', v_refund_total,
      'adjustment_debit_total', v_debit_total,
      'adjustment_credit_total', v_credit_total,
      'ledger_balance', v_ledger_balance,
      'detail_balance', v_detail_balance, 'difference', v_difference,
      'source_hash', v_source_hash, 'reconciled_by', v_actor,
      'reconciled_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_run;
  insert into private.billing_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_reconciliation_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'run_reconciliation', v_request_hash, v_run.id, v_now
  );
  return query select v_run.organization_id, v_run.branch_id, v_run.id,
    v_run.reconciliation_date, v_run.expected_branch_ledger_version,
    v_run.source_entry_count, v_run.invoice_total::text,
    v_run.payment_total::text, v_run.refund_total::text,
    v_run.adjustment_debit_total::text,
    v_run.adjustment_credit_total::text, v_run.ledger_balance::text,
    v_run.detail_balance::text, v_run.difference::text,
    v_run.reconciliation_status, v_run.source_hash,
    v_run.reconciled_at, false;
end;
$$;

create or replace function public.run_billing_reconciliation(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reconciliation_date date,
  p_expected_branch_ledger_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, reconciliation_id uuid,
  reconciliation_date date, expected_branch_ledger_version bigint,
  source_entry_count bigint, invoice_total text, payment_total text,
  refund_total text, adjustment_debit_total text,
  adjustment_credit_total text, ledger_balance text, detail_balance text,
  difference text, reconciliation_status text, source_hash text,
  reconciled_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.run_billing_reconciliation_guarded(
    p_expected_organization_id, p_expected_branch_id,
    p_reconciliation_date, p_expected_branch_ledger_version,
    p_idempotency_key
  );
$$;

create or replace function private.billing_management_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_generated_at timestamptz,
  p_period_start date,
  p_period_end date,
  p_client_id uuid,
  p_payment_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_generated_at is null
     or p_period_start is null or p_period_end is null
     or p_period_end < p_period_start
     or p_period_end > p_period_start + 366
     or p_payment_status not in ('all', 'unpaid', 'partial', 'paid') then
       raise exception using errcode = '22023',
      message = 'invalid billing snapshot filters';
  end if;
  if not private.billing_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'billing.read'
  ) then
    raise exception using errcode = '42501',
      message = 'billing snapshot is not permitted';
  end if;
  perform private.require_billing_reauth_evidence(v_actor, p_generated_at);
  if p_client_id is not null and not exists (
    select 1 from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
  ) then
    raise exception using errcode = '42501',
      message = 'billing client filter is outside scope';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action,
    table_name, occurred_at, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'billing_management_snapshot', p_generated_at,
    '{}'::text[], jsonb_build_object(
      'period_filter_present', true,
      'client_filter_present', p_client_id is not null,
      'payment_status_filter_present', p_payment_status <> 'all'
    )
  );

  with fee_all as materialized (
    select fee.*
    from public.billing_fee_item_versions fee
    where fee.organization_id = p_expected_organization_id
      and fee.branch_id = p_expected_branch_id
      and fee.source_status = 'governance_approved'
      and fee.effective_from <= p_period_end
      and (fee.effective_to is null or fee.effective_to >= p_period_start)
  ), fee_limited as (
    select fee.* from fee_all fee
    order by fee.fee_code, fee.effective_from desc, fee.version desc
    limit 200
  ), client_all as materialized (
    select client.id, client.client_code, client.display_name
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.admitted_on is not null
      and client.admitted_on <= p_period_end
      and (client.ended_on is null or client.ended_on >= p_period_start)
  ), client_limited as (
    select client.* from client_all client
    order by client.client_code, client.id
    limit 500
  ), invoice_all as materialized (
    select invoice.*, client.client_code, client.display_name,
      coalesce(sum(entry.amount) filter (where entry.entry_kind = 'payment'), 0)::numeric(18,2)
        as payment_total,
      coalesce(sum(entry.amount) filter (where entry.entry_kind = 'refund'), 0)::numeric(18,2)
        as refund_total,
      coalesce(sum(entry.amount) filter (where entry.entry_kind = 'adjustment_debit'), 0)::numeric(18,2)
        as adjustment_debit_total,
      coalesce(sum(entry.amount) filter (where entry.entry_kind = 'adjustment_credit'), 0)::numeric(18,2)
        as adjustment_credit_total,
      coalesce(sum(entry.signed_amount), 0)::numeric(18,2) as balance,
      coalesce(max(entry.invoice_ledger_version), 0) as invoice_ledger_version,
      max(entry.occurred_at) as latest_entry_at,
      count(entry.id)::bigint as entry_total,
      count(receipt.id)::bigint as joined_receipt_total
    from public.billing_invoices invoice
    join public.clients client on client.id = invoice.client_id
    join public.billing_ledger_entries entry on entry.invoice_id = invoice.id
    left join public.billing_receipts receipt
      on receipt.invoice_id = invoice.id and receipt.payment_entry_id = entry.id
    where invoice.organization_id = p_expected_organization_id
      and invoice.branch_id = p_expected_branch_id
      and invoice.period_start <= p_period_end
      and invoice.period_end >= p_period_start
      and (p_client_id is null or invoice.client_id = p_client_id)
    group by invoice.id, client.client_code, client.display_name
  ), invoice_statused as materialized (
    select invoice.*,
      case when invoice.balance = 0 then 'paid'
        when invoice.balance = invoice.invoice_total then 'unpaid'
        else 'partial' end as payment_status
    from invoice_all invoice
  ), invoice_filtered as materialized (
    select invoice.* from invoice_statused invoice
    where p_payment_status = 'all' or invoice.payment_status = p_payment_status
  ), invoice_limited as (
    select invoice.* from invoice_filtered invoice
    order by invoice.issued_on desc, invoice.invoice_number desc, invoice.id
    limit 200
  ), reconciliation_all as materialized (
    select reconciliation.*
    from public.billing_reconciliation_runs reconciliation
    where reconciliation.organization_id = p_expected_organization_id
      and reconciliation.branch_id = p_expected_branch_id
      and reconciliation.reconciliation_date between p_period_start and p_period_end
  ), reconciliation_limited as (
    select reconciliation.* from reconciliation_all reconciliation
    order by reconciliation.reconciliation_date desc,
      reconciliation.reconciled_at desc, reconciliation.id
    limit 100
  ), branch_ledger as (
    select coalesce(max(entry.branch_ledger_version), 0)::bigint as version
    from public.billing_ledger_entries entry
    where entry.organization_id = p_expected_organization_id
      and entry.branch_id = p_expected_branch_id
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_generated_at,
    'stale_after', p_generated_at + interval '60 seconds',
    'filters', jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'client_id', p_client_id,
      'payment_status', p_payment_status
    ),
    'fee_configuration_status', case when exists(select 1 from fee_all)
      then 'configured' else 'not_configured' end,
    'fee_items', coalesce((select jsonb_agg(jsonb_build_object(
      'fee_item_version_id', fee.id,
      'fee_item_key', fee.fee_item_key,
      'version', fee.version,
      'fee_code', fee.fee_code,
      'fee_name', fee.fee_name,
      'unit_label', fee.unit_label,
      'unit_price', fee.unit_price::text,
      'currency', fee.currency,
      'tax_handling', fee.tax_handling,
      'effective_from', fee.effective_from,
      'effective_to', fee.effective_to,
      'approved_at', fee.approved_at,
      'content_hash', fee.content_hash
    ) order by fee.fee_code, fee.effective_from desc, fee.version desc)
      from fee_limited fee), '[]'::jsonb),
    'fee_item_total', (select count(*) from fee_all),
    'fee_items_truncated', (select count(*) > 200 from fee_all),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
      'client_id', client.id,
      'client_code', client.client_code,
      'display_name', client.display_name
    ) order by client.client_code, client.id) from client_limited client), '[]'::jsonb),
    'client_total', (select count(*) from client_all),
    'clients_truncated', (select count(*) > 500 from client_all),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
      'invoice_id', invoice.id,
      'invoice_key', invoice.invoice_key,
      'invoice_number', invoice.invoice_number,
      'reference_kind', invoice.reference_kind,
      'version', invoice.version,
      'client_id', invoice.client_id,
      'client_code', invoice.client_code,
      'client_display_name', invoice.display_name,
      'period_start', invoice.period_start,
      'period_end', invoice.period_end,
      'issued_on', invoice.issued_on,
      'due_on', invoice.due_on,
      'currency', invoice.currency,
      'invoice_total', invoice.invoice_total::text,
      'payment_total', invoice.payment_total::text,
      'refund_total', invoice.refund_total::text,
      'adjustment_debit_total', invoice.adjustment_debit_total::text,
      'adjustment_credit_total', invoice.adjustment_credit_total::text,
      'net_collected', (invoice.payment_total - invoice.refund_total)::text,
      'balance', invoice.balance::text,
      'payment_status', invoice.payment_status,
      'invoice_ledger_version', invoice.invoice_ledger_version,
      'latest_entry_at', invoice.latest_entry_at,
      'line_count', invoice.line_count,
      'created_at', invoice.created_at,
      'created_by', invoice.created_by,
      'content_hash', invoice.content_hash,
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'line_id', line.id,
        'line_number', line.line_number,
        'fee_item_version_id', line.fee_item_version_id,
        'fee_item_key', line.fee_item_key,
        'fee_code', line.fee_code,
        'fee_name', line.fee_name,
        'unit_label', line.unit_label,
        'service_date', line.service_date,
        'quantity', line.quantity::text,
        'unit_price', line.unit_price::text,
        'amount', line.amount::text,
        'currency', line.currency,
        'tax_handling', line.tax_handling,
        'line_note', line.line_note,
        'content_hash', line.content_hash
      ) order by line.line_number) from public.billing_invoice_lines line
        where line.invoice_id = invoice.id), '[]'::jsonb),
      'entry_total', invoice.entry_total,
      'entries', coalesce((select jsonb_agg(jsonb_build_object(
        'entry_id', entry.id,
        'invoice_ledger_version', entry.invoice_ledger_version,
        'branch_ledger_version', entry.branch_ledger_version,
        'entry_kind', entry.entry_kind,
        'amount', entry.amount::text,
        'signed_amount', entry.signed_amount::text,
        'balance_after', entry.balance_after::text,
        'original_entry_id', entry.original_entry_id,
        'payment_method', entry.payment_method,
        'source_channel', entry.source_channel,
        'occurred_at', entry.occurred_at,
        'note', entry.note,
        'recorded_by', entry.recorded_by,
        'recorded_at', entry.recorded_at,
        'content_hash', entry.content_hash
      ) order by entry.invoice_ledger_version) from (
        select entry.* from public.billing_ledger_entries entry
        where entry.invoice_id = invoice.id
        order by entry.invoice_ledger_version desc limit 200
      ) entry), '[]'::jsonb),
      'entries_truncated', invoice.entry_total > 200,
      'receipt_total', (select count(*) from public.billing_receipts receipt
        where receipt.invoice_id = invoice.id),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object(
        'receipt_id', receipt.id,
        'payment_entry_id', receipt.payment_entry_id,
        'receipt_key', receipt.receipt_key,
        'receipt_number', receipt.receipt_number,
        'reference_kind', receipt.reference_kind,
        'amount', receipt.amount::text,
        'currency', receipt.currency,
        'issued_at', receipt.issued_at,
        'issued_by', receipt.issued_by,
        'document_status', receipt.document_status,
        'content_hash', receipt.content_hash
      ) order by receipt.issued_at, receipt.id) from (
        select receipt.* from public.billing_receipts receipt
        where receipt.invoice_id = invoice.id
        order by receipt.issued_at desc, receipt.id limit 100
      ) receipt), '[]'::jsonb),
      'receipts_truncated', (select count(*) > 100
        from public.billing_receipts receipt where receipt.invoice_id = invoice.id)
    ) order by invoice.issued_on desc, invoice.invoice_number desc, invoice.id)
      from invoice_limited invoice), '[]'::jsonb),
    'matching_invoice_total', (select count(*) from invoice_filtered),
    'invoices_truncated', (select count(*) > 200 from invoice_filtered),
    'branch_ledger_version', (select version from branch_ledger),
    'metrics', jsonb_build_object(
      'receivable_total', coalesce((select sum(invoice.invoice_total)::text
        from invoice_filtered invoice), '0.00'),
      'collected_total', coalesce((select sum(
        invoice.payment_total - invoice.refund_total
      )::text from invoice_filtered invoice), '0.00'),
      'outstanding_total', coalesce((select sum(invoice.balance)::text
        from invoice_filtered invoice), '0.00'),
      'refund_total', coalesce((select sum(invoice.refund_total)::text
        from invoice_filtered invoice), '0.00')
    ),
    'reconciliations', coalesce((select jsonb_agg(jsonb_build_object(
      'reconciliation_id', reconciliation.id,
      'reconciliation_date', reconciliation.reconciliation_date,
      'expected_branch_ledger_version', reconciliation.expected_branch_ledger_version,
      'source_entry_count', reconciliation.source_entry_count,
      'invoice_total', reconciliation.invoice_total::text,
      'payment_total', reconciliation.payment_total::text,
      'refund_total', reconciliation.refund_total::text,
      'adjustment_debit_total', reconciliation.adjustment_debit_total::text,
      'adjustment_credit_total', reconciliation.adjustment_credit_total::text,
      'ledger_balance', reconciliation.ledger_balance::text,
      'detail_balance', reconciliation.detail_balance::text,
      'difference', reconciliation.difference::text,
      'reconciliation_status', reconciliation.reconciliation_status,
      'source_hash', reconciliation.source_hash,
      'reconciled_by', reconciliation.reconciled_by,
      'reconciled_at', reconciliation.reconciled_at,
      'content_hash', reconciliation.content_hash
    ) order by reconciliation.reconciliation_date desc,
      reconciliation.reconciled_at desc, reconciliation.id)
      from reconciliation_limited reconciliation), '[]'::jsonb),
    'matching_reconciliation_total', (select count(*) from reconciliation_all),
    'reconciliations_truncated', (select count(*) > 100 from reconciliation_all),
    'latest_reconciliation_status', coalesce((select reconciliation.reconciliation_status
      from reconciliation_all reconciliation
      order by reconciliation.reconciliation_date desc,
        reconciliation.reconciled_at desc, reconciliation.id
      limit 1), 'not_run'),
    'latest_reconciliation_difference', (select reconciliation.difference::text
      from reconciliation_all reconciliation
      order by reconciliation.reconciliation_date desc,
        reconciliation.reconciled_at desc, reconciliation.id
      limit 1),
    'online_payment_status', 'disabled',
    'payment_channel_boundary', 'staff_recorded_offline_only',
    'numbering_policy_status', 'internal_reference_only',
    'statutory_document_status', 'not_configured',
    'tax_calculation_status', 'explicit_fee_snapshot_only',
    'export_status', 'not_configured',
    'offline_status', 'online_only'
  ) into v_payload;
  return v_payload;
end;
$$;

create or replace function private.billing_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_period_start date,
  p_period_end date,
  p_client_id uuid,
  p_payment_status text
)
returns table(payload jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
  select private.billing_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, clock_timestamp(),
    p_period_start, p_period_end, p_client_id, p_payment_status
  );
$$;

create or replace function public.billing_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_period_start date,
  p_period_end date,
  p_client_id uuid default null,
  p_payment_status text default 'all'
)
returns table(payload jsonb)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.billing_management_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_period_start, p_period_end, p_client_id, p_payment_status
  );
$$;

create policy billing_fee_item_versions_select
on public.billing_fee_item_versions for select to authenticated
using (private.billing_current_authority(
  organization_id, branch_id, 'billing.read'
));
create policy billing_invoices_select
on public.billing_invoices for select to authenticated
using (private.billing_current_authority(
  organization_id, branch_id, 'billing.read'
));
create policy billing_invoice_lines_select
on public.billing_invoice_lines for select to authenticated
using (private.billing_current_authority(
  organization_id, branch_id, 'billing.read'
));
create policy billing_ledger_entries_select
on public.billing_ledger_entries for select to authenticated
using (private.billing_current_authority(
  organization_id, branch_id, 'billing.read'
));
create policy billing_receipts_select
on public.billing_receipts for select to authenticated
using (private.billing_current_authority(
  organization_id, branch_id, 'billing.read'
));
create policy billing_reconciliation_runs_select
on public.billing_reconciliation_runs for select to authenticated
using (private.billing_current_authority(
  organization_id, branch_id, 'billing.read'
));

revoke all on table public.billing_fee_item_versions
  from public, anon, authenticated, service_role;
revoke all on table public.billing_invoices
  from public, anon, authenticated, service_role;
revoke all on table public.billing_invoice_lines
  from public, anon, authenticated, service_role;
revoke all on table public.billing_ledger_entries
  from public, anon, authenticated, service_role;
revoke all on table public.billing_receipts
  from public, anon, authenticated, service_role;
revoke all on table public.billing_reconciliation_runs
  from public, anon, authenticated, service_role;
revoke all on table private.billing_operations
  from public, anon, authenticated, service_role;

revoke all on function private.billing_records_are_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_billing_fee_version()
  from public, anon, authenticated, service_role;
revoke all on function private.billing_current_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_billing_reauth_evidence(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.create_billing_invoice_guarded(
  uuid, uuid, uuid, uuid, date, date, date, date, jsonb, integer, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.record_billing_entry_guarded(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, text,
  integer, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.issue_billing_receipt_guarded(
  uuid, uuid, uuid, uuid, uuid, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.run_billing_reconciliation_guarded(
  uuid, uuid, date, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.billing_management_snapshot_bundle(
  uuid, uuid, timestamptz, date, date, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.billing_management_snapshot_response(
  uuid, uuid, date, date, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_billing_invoice(
  uuid, uuid, uuid, uuid, date, date, date, date, jsonb, integer, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_billing_entry(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, text,
  integer, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.issue_billing_receipt(
  uuid, uuid, uuid, uuid, uuid, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.run_billing_reconciliation(
  uuid, uuid, date, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.billing_management_snapshot(
  uuid, uuid, date, date, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_billing_invoice(
  uuid, uuid, uuid, uuid, date, date, date, date, jsonb, integer, bigint, uuid
) to authenticated;
grant execute on function public.record_billing_entry(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, text,
  integer, bigint, uuid
) to authenticated;
grant execute on function public.issue_billing_receipt(
  uuid, uuid, uuid, uuid, uuid, integer, uuid
) to authenticated;
grant execute on function public.run_billing_reconciliation(
  uuid, uuid, date, bigint, uuid
) to authenticated;
grant execute on function public.billing_management_snapshot(
  uuid, uuid, date, date, uuid, text
) to authenticated;
grant execute on function private.create_billing_invoice_guarded(
  uuid, uuid, uuid, uuid, date, date, date, date, jsonb, integer, bigint, uuid
) to authenticated;
grant execute on function private.record_billing_entry_guarded(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, text,
  integer, bigint, uuid
) to authenticated;
grant execute on function private.issue_billing_receipt_guarded(
  uuid, uuid, uuid, uuid, uuid, integer, uuid
) to authenticated;
grant execute on function private.run_billing_reconciliation_guarded(
  uuid, uuid, date, bigint, uuid
) to authenticated;
grant execute on function private.billing_management_snapshot_response(
  uuid, uuid, date, date, uuid, text
) to authenticated;

comment on function public.create_billing_invoice(
  uuid, uuid, uuid, uuid, date, date, date, date, jsonb, integer, bigint, uuid
) is 'Issues one immutable internal bill from exact independently approved fee versions; no rate or tax inference.';
comment on function public.record_billing_entry(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, text,
  integer, bigint, uuid
) is 'Appends one exact-decimal offline payment, bounded refund, or reasoned adjustment under locked expected versions.';
comment on function public.billing_management_snapshot(
  uuid, uuid, date, date, uuid, text
) is 'Returns one bounded Page-64 snapshot whose metrics, invoices, details, receipts and reconciliation evidence share one SQL statement.';
