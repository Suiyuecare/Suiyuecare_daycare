import { billingCentsToMoney, billingMoneyToCents } from "./decimal";
import { projectBillingManagementSnapshot, type BillingSnapshotSourceRow } from "./projection";
import type { BillingFilters } from "./types";

const ids = {
  fee1: "64000000-0000-4000-8000-000000000001", feeKey1: "64000000-0000-4000-8000-000000000002",
  fee2: "64000000-0000-4000-8000-000000000003", feeKey2: "64000000-0000-4000-8000-000000000004",
  client1: "64000000-0000-4000-8000-000000000011", client2: "64000000-0000-4000-8000-000000000012",
  invoice1: "64000000-0000-4000-8000-000000000021", invoiceKey1: "64000000-0000-4000-8000-000000000022",
  invoice2: "64000000-0000-4000-8000-000000000023", invoiceKey2: "64000000-0000-4000-8000-000000000024",
  line1: "64000000-0000-4000-8000-000000000031", line2: "64000000-0000-4000-8000-000000000032",
  line3: "64000000-0000-4000-8000-000000000033",
  entry1: "64000000-0000-4000-8000-000000000041", entry2: "64000000-0000-4000-8000-000000000042",
  entry3: "64000000-0000-4000-8000-000000000043", entry4: "64000000-0000-4000-8000-000000000044",
  entry5: "64000000-0000-4000-8000-000000000045", entry6: "64000000-0000-4000-8000-000000000046",
  receipt: "64000000-0000-4000-8000-000000000051", receiptKey: "64000000-0000-4000-8000-000000000052",
  reconciliation: "64000000-0000-4000-8000-000000000061", actor: "64000000-0000-4000-8000-000000000071",
} as const;
const H = (character: string) => character.repeat(64);
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function atTaipei(date: string, hour = 9) { return `${date}T${String(hour).padStart(2, "0")}:00:00+08:00`; }

export function buildDemoBillingManagementSourceRow(input: {
  organizationId: string; branchId: string; filters: BillingFilters; now?: Date;
}): BillingSnapshotSourceRow {
  const generated = (input.now ?? new Date("2026-09-07T05:00:00.000Z")).toISOString();
  const { periodStart, periodEnd } = input.filters; const dueOn = addDays(periodEnd, 30);
  const feeItems = [{ fee_item_version_id: ids.fee1, fee_item_key: ids.feeKey1,
    version: 1, fee_code: "DAY-SYN", fee_name: "合成日照服務", unit_label: "日",
    unit_price: "100.00", currency: "TWD", tax_handling: "explicitly_not_applicable",
    effective_from: periodStart, effective_to: addDays(periodEnd, 60),
    approved_at: atTaipei(periodStart), content_hash: H("a") },
  { fee_item_version_id: ids.fee2, fee_item_key: ids.feeKey2,
    version: 1, fee_code: "MEAL-SYN", fee_name: "合成餐食服務", unit_label: "份",
    unit_price: "33.33", currency: "TWD", tax_handling: "explicitly_included_in_unit_price",
    effective_from: periodStart, effective_to: addDays(periodEnd, 60),
    approved_at: atTaipei(periodStart), content_hash: H("b") }];
  const clients = [
    { client_id: ids.client1, client_code: "SYN-001", display_name: "合成個案甲" },
    { client_id: ids.client2, client_code: "SYN-002", display_name: "合成個案乙" },
  ];
  const firstEntries = [
    { entry_id: ids.entry1, invoice_ledger_version: 1, branch_ledger_version: 1,
      entry_kind: "invoice_charge", amount: "299.99", signed_amount: "299.99", balance_after: "299.99",
      original_entry_id: null, payment_method: null, source_channel: "internal_ledger",
      occurred_at: atTaipei(periodEnd, 8), note: null, recorded_by: ids.actor,
      recorded_at: atTaipei(periodEnd, 8), content_hash: H("c") },
    { entry_id: ids.entry2, invoice_ledger_version: 2, branch_ledger_version: 2,
      entry_kind: "payment", amount: "100.00", signed_amount: "-100.00", balance_after: "199.99",
      original_entry_id: null, payment_method: "bank_transfer", source_channel: "staff_recorded_offline",
      occurred_at: atTaipei(periodEnd, 9), note: "合成離線轉帳登記", recorded_by: ids.actor,
      recorded_at: atTaipei(periodEnd, 9), content_hash: H("d") },
    { entry_id: ids.entry3, invoice_ledger_version: 3, branch_ledger_version: 3,
      entry_kind: "refund", amount: "20.00", signed_amount: "20.00", balance_after: "219.99",
      original_entry_id: ids.entry2, payment_method: null, source_channel: "internal_ledger",
      occurred_at: atTaipei(periodEnd, 10), note: "合成部分退款", recorded_by: ids.actor,
      recorded_at: atTaipei(periodEnd, 10), content_hash: H("e") },
    { entry_id: ids.entry4, invoice_ledger_version: 4, branch_ledger_version: 4,
      entry_kind: "adjustment_debit", amount: "5.00", signed_amount: "5.00", balance_after: "224.99",
      original_entry_id: null, payment_method: null, source_channel: "internal_ledger",
      occurred_at: atTaipei(periodEnd, 11), note: "合成人工補收", recorded_by: ids.actor,
      recorded_at: atTaipei(periodEnd, 11), content_hash: H("f") },
  ];
  const secondEntries = [
    { entry_id: ids.entry5, invoice_ledger_version: 1, branch_ledger_version: 5,
      entry_kind: "invoice_charge", amount: "200.00", signed_amount: "200.00", balance_after: "200.00",
      original_entry_id: null, payment_method: null, source_channel: "internal_ledger",
      occurred_at: atTaipei(periodEnd, 8), note: null, recorded_by: ids.actor,
      recorded_at: atTaipei(periodEnd, 8), content_hash: H("1") },
    { entry_id: ids.entry6, invoice_ledger_version: 2, branch_ledger_version: 6,
      entry_kind: "payment", amount: "200.00", signed_amount: "-200.00", balance_after: "0.00",
      original_entry_id: null, payment_method: "cash", source_channel: "staff_recorded_offline",
      occurred_at: atTaipei(periodEnd, 9), note: "合成現金登記", recorded_by: ids.actor,
      recorded_at: atTaipei(periodEnd, 9), content_hash: H("2") },
  ];
  const invoices = [
    { invoice_id: ids.invoice1, invoice_key: ids.invoiceKey1,
      invoice_number: "SYS-BILL-640000000001", reference_kind: "internal_non_tax_document", version: 1,
      client_id: ids.client1, client_code: "SYN-001", client_display_name: "合成個案甲",
      period_start: periodStart, period_end: periodEnd, issued_on: periodEnd, due_on: dueOn,
      currency: "TWD", invoice_total: "299.99", payment_total: "100.00", refund_total: "20.00",
      adjustment_debit_total: "5.00", adjustment_credit_total: "0.00",
      net_collected: "80.00", balance: "224.99", payment_status: "partial",
      invoice_ledger_version: 4, latest_entry_at: atTaipei(periodEnd, 11), line_count: 2,
      created_at: atTaipei(periodEnd, 8), created_by: ids.actor, content_hash: H("3"),
      lines: [
        { line_id: ids.line1, line_number: 1, fee_item_version_id: ids.fee1,
          fee_item_key: ids.feeKey1, fee_code: "DAY-SYN", fee_name: "合成日照服務", unit_label: "日",
          service_date: periodStart, quantity: "2.0000", unit_price: "100.00", amount: "200.00",
          currency: "TWD", tax_handling: "explicitly_not_applicable", line_note: "合成兩日服務", content_hash: H("4") },
        { line_id: ids.line2, line_number: 2, fee_item_version_id: ids.fee2,
          fee_item_key: ids.feeKey2, fee_code: "MEAL-SYN", fee_name: "合成餐食服務", unit_label: "份",
          service_date: periodEnd, quantity: "3.0000", unit_price: "33.33", amount: "99.99",
          currency: "TWD", tax_handling: "explicitly_included_in_unit_price", line_note: null, content_hash: H("5") },
      ], entry_total: 4, entries: firstEntries, entries_truncated: false,
      receipt_total: 1, receipts: [{ receipt_id: ids.receipt, payment_entry_id: ids.entry2,
        receipt_key: ids.receiptKey, receipt_number: "SYS-REC-640000000000",
        reference_kind: "internal_non_tax_receipt_record", amount: "100.00", currency: "TWD",
        issued_at: atTaipei(periodEnd, 9), issued_by: ids.actor,
        document_status: "not_configured", content_hash: H("6") }], receipts_truncated: false },
    { invoice_id: ids.invoice2, invoice_key: ids.invoiceKey2,
      invoice_number: "SYS-BILL-640000000000", reference_kind: "internal_non_tax_document", version: 1,
      client_id: ids.client2, client_code: "SYN-002", client_display_name: "合成個案乙",
      period_start: periodStart, period_end: periodEnd, issued_on: periodEnd, due_on: dueOn,
      currency: "TWD", invoice_total: "200.00", payment_total: "200.00", refund_total: "0.00",
      adjustment_debit_total: "0.00", adjustment_credit_total: "0.00",
      net_collected: "200.00", balance: "0.00", payment_status: "paid",
      invoice_ledger_version: 2, latest_entry_at: atTaipei(periodEnd, 9), line_count: 1,
      created_at: atTaipei(periodEnd, 8), created_by: ids.actor, content_hash: H("7"),
      lines: [{ line_id: ids.line3, line_number: 1, fee_item_version_id: ids.fee1,
        fee_item_key: ids.feeKey1, fee_code: "DAY-SYN", fee_name: "合成日照服務", unit_label: "日",
        service_date: periodStart, quantity: "2.0000", unit_price: "100.00", amount: "200.00",
        currency: "TWD", tax_handling: "explicitly_not_applicable", line_note: null, content_hash: H("8") }],
      entry_total: 2, entries: secondEntries, entries_truncated: false,
      receipt_total: 0, receipts: [], receipts_truncated: false },
  ];
  const filtered = invoices.filter((invoice) => (!input.filters.clientId || invoice.client_id === input.filters.clientId)
    && (input.filters.paymentStatus === "all" || invoice.payment_status === input.filters.paymentStatus));
  const total = (key: "invoice_total" | "net_collected" | "balance" | "refund_total") =>
    billingCentsToMoney(filtered.reduce((sum, invoice) => sum + billingMoneyToCents(invoice[key]), BigInt(0)));
  const reconciliations = [{
    reconciliation_id: ids.reconciliation, reconciliation_date: periodEnd,
    expected_branch_ledger_version: 6, source_entry_count: 6,
    invoice_total: "499.99", payment_total: "300.00", refund_total: "20.00",
    adjustment_debit_total: "5.00", adjustment_credit_total: "0.00",
    ledger_balance: "224.99", detail_balance: "224.99", difference: "0.00",
    reconciliation_status: "matched", source_hash: H("9"), reconciled_by: ids.actor,
    reconciled_at: atTaipei(periodEnd, 12), content_hash: H("0"),
  }];
  return { payload: { organization_id: input.organizationId, branch_id: input.branchId,
    generated_at: generated, stale_after: new Date(Date.parse(generated) + 60_000).toISOString(),
    filters: { period_start: periodStart, period_end: periodEnd,
      client_id: input.filters.clientId, payment_status: input.filters.paymentStatus },
    fee_configuration_status: "configured", fee_items: feeItems,
    fee_item_total: feeItems.length, fee_items_truncated: false,
    clients, client_total: clients.length, clients_truncated: false,
    invoices: filtered, matching_invoice_total: filtered.length, invoices_truncated: false,
    branch_ledger_version: 6, metrics: { receivable_total: total("invoice_total"),
      collected_total: total("net_collected"), outstanding_total: total("balance"),
      refund_total: total("refund_total") }, reconciliations,
    matching_reconciliation_total: reconciliations.length,
    reconciliations_truncated: false,
    latest_reconciliation_status: reconciliations.length ? "matched" : "not_run",
    latest_reconciliation_difference: reconciliations.length ? "0.00" : null,
    online_payment_status: "disabled", payment_channel_boundary: "staff_recorded_offline_only",
    numbering_policy_status: "internal_reference_only", statutory_document_status: "not_configured",
    tax_calculation_status: "explicit_fee_snapshot_only", export_status: "not_configured",
    offline_status: "online_only" } };
}

export function buildDemoBillingManagementSnapshot(input: {
  organizationId: string; branchId: string; filters: BillingFilters; now?: Date;
}) {
  return projectBillingManagementSnapshot({ row: buildDemoBillingManagementSourceRow(input),
    expectedOrganizationId: input.organizationId, expectedBranchId: input.branchId,
    filters: input.filters, demo: true });
}
