import { describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { billingLineAmountIsExact, billingMoneyToCents } from "./decimal";
import { billingRangeDays, billingTaipeiDate, isBillingDate } from "./date";
import { buildDemoBillingManagementSnapshot, buildDemoBillingManagementSourceRow } from "./demo";
import { parseBillingEntryReceipt, parseBillingInvoiceApiEnvelope, parseBillingInvoiceReceipt,
  parseBillingReceiptReceipt, parseBillingReconciliationReceipt,
  parseCreateBillingInvoiceInput, parseIssueBillingReceiptInput,
  parseRecordBillingEntryInput, parseRunBillingReconciliationInput } from "./parser";
import { projectBillingManagementSnapshot } from "./projection";
import { parseBillingManagementFilters } from "./query";

const ORG = "64000000-0000-4000-8000-000000000101";
const BRANCH = "64000000-0000-4000-8000-000000000102";
const CLIENT = "64000000-0000-4000-8000-000000000011";
const KEY = "64000000-0000-4000-8000-000000000103";
const INVOICE_KEY = "64000000-0000-4000-8000-000000000104";
const INVOICE = "64000000-0000-4000-8000-000000000105";
const ENTRY = "64000000-0000-4000-8000-000000000106";
const RECEIPT = "64000000-0000-4000-8000-000000000107";
const RECONCILIATION = "64000000-0000-4000-8000-000000000108";
const HASH = "a".repeat(64);
const NOW = new Date("2026-09-07T05:00:00.000Z");
type MutableBillingPayload = {
  invoices: Array<{
    lines: Array<{ amount: string }>;
    entries: Array<{ entry_id: string; source_channel: string }>;
    receipts: Array<{ payment_entry_id: string }>;
  }>;
  reconciliations: Array<{ difference: string }>;
};
const filters = { periodStart: "2026-09-01", periodEnd: "2026-09-07",
  clientId: null, paymentStatus: "all" as const };
function createBody(extra: Record<string, unknown> = {}) { return {
  action: "create_invoice", client_id: CLIENT, invoice_key: INVOICE_KEY,
  period_start: "2026-09-01", period_end: "2026-09-06",
  issued_on: "2026-09-07", due_on: "2026-10-07",
  lines: [{ fee_item_version_id: "64000000-0000-4000-8000-000000000001",
    service_date: "2026-09-06", quantity: "2", line_note: null }],
  expected_invoice_version: 0, expected_branch_ledger_version: 6, ...extra,
}; }

describe("Page 64 governed billing contracts", () => {
  it("uses real Taiwan dates and an inclusive bounded filter range", () => {
    expect(isBillingDate("2024-02-29")).toBe(true);
    expect(isBillingDate("2025-02-29")).toBe(false);
    expect(billingTaipeiDate(NOW)).toBe("2026-09-07");
    expect(billingRangeDays("2026-09-01", "2026-09-07")).toBe(7);
  });

  it("strictly parses known filters and preserves an explicit invalid state", () => {
    expect(parseBillingManagementFilters({ from: "2026-09-01", to: "2026-09-07",
      client: CLIENT.toUpperCase(), status: "partial" }, NOW)).toEqual({ invalid: false,
      filters: { periodStart: "2026-09-01", periodEnd: "2026-09-07",
        clientId: CLIENT, paymentStatus: "partial" } });
    expect(parseBillingManagementFilters({ from: ["2026-09-01"] }, NOW).invalid).toBe(true);
    expect(parseBillingManagementFilters({ online: "true" }, NOW).invalid).toBe(true);
  });

  it("uses integer cents and rejects an amount needing an unspecified rounding rule", () => {
    expect(billingMoneyToCents("299.99")).toBe(BigInt(29_999));
    expect(billingLineAmountIsExact("3", "33.33", "99.99")).toBe(true);
    expect(billingLineAmountIsExact("0.1", "33.33", "3.33")).toBe(false);
  });

  it("projects a consistent synthetic offline-only billing snapshot", () => {
    const snapshot = buildDemoBillingManagementSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: NOW });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.onlinePaymentStatus).toBe("disabled");
    expect(snapshot.statutoryDocumentStatus).toBe("not_configured");
    expect(snapshot.metrics).toEqual({ receivableTotal: "499.99",
      collectedTotal: "280.00", outstandingTotal: "224.99", refundTotal: "20.00" });
    expect(snapshot.reconciliations[0]?.reconciliationStatus).toBe("matched");
  });

  it("keeps selected client and payment state bound to metrics from one snapshot", () => {
    const snapshot = buildDemoBillingManagementSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, clientId: CLIENT, paymentStatus: "partial" }, now: NOW });
    expect(snapshot.invoices).toHaveLength(1);
    expect(snapshot.metrics.outstandingTotal).toBe("224.99");
    expect(snapshot.matchingInvoiceTotal).toBe(1);
  });

  it.each([
    (row: Record<string, unknown>) => ({ ...row, organization_id: CLIENT }),
    (row: Record<string, unknown>) => ({ ...row, fee_item_total: 3 }),
    (row: Record<string, unknown>) => ({ ...row, online_payment_status: "enabled" }),
    (row: Record<string, unknown>) => ({ ...row, metrics: {
      ...(row.metrics as Record<string, unknown>), outstanding_total: "1.00" } }),
  ])("rejects top-level tenant, count, payment-boundary or metric drift", (mutate) => {
    const source = buildDemoBillingManagementSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: NOW });
    expect(() => projectBillingManagementSnapshot({ row: {
      payload: mutate(source.payload as Record<string, unknown>) },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("BILLING_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("rejects line arithmetic and immutable fee snapshot drift", () => {
    const source = buildDemoBillingManagementSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: NOW }); const payload = structuredClone(source.payload) as MutableBillingPayload;
    payload.invoices[0].lines[0].amount = "199.99";
    expect(() => projectBillingManagementSnapshot({ row: { payload },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("BILLING_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("rejects ledger sign, continuity and offline-channel drift", () => {
    const source = buildDemoBillingManagementSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: NOW }); const payload = structuredClone(source.payload) as MutableBillingPayload;
    payload.invoices[0].entries[1].source_channel = "internal_ledger";
    expect(() => projectBillingManagementSnapshot({ row: { payload },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("BILLING_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("rejects a receipt detached from its exact offline payment", () => {
    const source = buildDemoBillingManagementSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: NOW }); const payload = structuredClone(source.payload) as MutableBillingPayload;
    payload.invoices[0].receipts[0].payment_entry_id = payload.invoices[0].entries[0].entry_id;
    expect(() => projectBillingManagementSnapshot({ row: { payload },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("BILLING_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("rejects a reconciliation whose detail and ledger no longer balance", () => {
    const source = buildDemoBillingManagementSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: NOW }); const payload = structuredClone(source.payload) as MutableBillingPayload;
    payload.reconciliations[0].difference = "1.00";
    expect(() => projectBillingManagementSnapshot({ row: { payload },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("BILLING_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("parses strict invoice creation and rejects unknown, reversed or external amount fields", () => {
    expect(parseCreateBillingInvoiceInput(createBody(), KEY).lines[0]?.quantity).toBe("2");
    expect(() => parseCreateBillingInvoiceInput(createBody({ total: "100.00" }), KEY))
      .toThrow(IntegrationError);
    expect(() => parseCreateBillingInvoiceInput(createBody({ due_on: "2026-09-01" }), KEY))
      .toThrow("帳務期間");
    expect(() => parseCreateBillingInvoiceInput(createBody({ lines: [{
      fee_item_version_id: "64000000-0000-4000-8000-000000000001",
      service_date: "2026-09-06", quantity: "1", amount: "100.00" }] }), KEY))
      .toThrow(IntegrationError);
  });

  it("accepts offline payment and requires exact refund or adjustment evidence", () => {
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    const base = { action: "record_entry", invoice_id: INVOICE, entry_kind: "payment",
      amount: "100.00", original_entry_id: null, payment_method: "bank_transfer",
      occurred_at: "2026-09-07T10:00:00Z", note: null,
      expected_invoice_ledger_version: 1, expected_branch_ledger_version: 6 };
    expect(parseRecordBillingEntryInput(base, KEY).paymentMethod).toBe("bank_transfer");
    expect(() => parseRecordBillingEntryInput({ ...base, payment_method: "online_card" }, KEY))
      .toThrow(IntegrationError);
    expect(() => parseRecordBillingEntryInput({ ...base, entry_kind: "refund",
      payment_method: null, note: "退", original_entry_id: null }, KEY)).toThrow(IntegrationError);
    vi.useRealTimers();
  });

  it("strictly parses receipt and reconciliation commands", () => {
    expect(parseIssueBillingReceiptInput({ action: "issue_receipt", invoice_id: INVOICE,
      payment_entry_id: ENTRY, receipt_key: RECEIPT,
      expected_invoice_ledger_version: 2 }, KEY).receiptKey).toBe(RECEIPT);
    expect(parseRunBillingReconciliationInput({ action: "run_reconciliation",
      reconciliation_date: "2026-09-07", expected_branch_ledger_version: 6 }, KEY)
      .expectedBranchLedgerVersion).toBe(6);
  });

  it("correlates database invoice and entry receipts to exact versions and deltas", () => {
    const create = parseCreateBillingInvoiceInput(createBody(), KEY);
    expect(parseBillingInvoiceReceipt({ organization_id: ORG, branch_id: BRANCH,
      client_id: CLIENT, invoice_id: INVOICE, invoice_key: INVOICE_KEY,
      invoice_number: "SYS-BILL-640000000000", invoice_version: 1,
      invoice_ledger_version: 1, branch_ledger_version: 7,
      invoice_total: "200.00", balance_after: "200.00", line_count: 1,
      payment_status: "unpaid", committed_at: NOW.toISOString(), replayed: false },
    create, ORG, BRANCH).branchLedgerVersion).toBe(7);
    const entryInput = parseRecordBillingEntryInput({ action: "record_entry",
      invoice_id: INVOICE, entry_kind: "payment", amount: "100.00",
      original_entry_id: null, payment_method: "cash", occurred_at: NOW.toISOString(),
      note: null, expected_invoice_ledger_version: 1,
      expected_branch_ledger_version: 6 }, KEY);
    expect(parseBillingEntryReceipt({ organization_id: ORG, branch_id: BRANCH,
      client_id: CLIENT, invoice_id: INVOICE, entry_id: ENTRY, entry_kind: "payment",
      amount: "100.00", signed_amount: "-100.00", balance_after: "100.00",
      invoice_ledger_version: 2, branch_ledger_version: 7, payment_status: "partial",
      committed_at: NOW.toISOString(), replayed: false }, entryInput, ORG, BRANCH).entryId).toBe(ENTRY);
  });

  it("strictly correlates a browser invoice envelope and its HTTP replay status", () => {
    const input = parseCreateBillingInvoiceInput(createBody(), KEY);
    const receipt = { organizationId: ORG, branchId: BRANCH, clientId: CLIENT,
      invoiceId: INVOICE, invoiceKey: INVOICE_KEY, invoiceNumber: "SYS-BILL-640000000000",
      invoiceVersion: 1, invoiceLedgerVersion: 1, branchLedgerVersion: 7,
      invoiceTotal: "200.00", balanceAfter: "200.00", lineCount: 1,
      paymentStatus: "unpaid", committedAt: NOW.toISOString(), replayed: false,
      persisted: true, demo: false };
    expect(parseBillingInvoiceApiEnvelope({ requestId: KEY, status: "ok",
      data: { receipt, persisted: true, demo: false }, errors: [] }, input,
    ORG, BRANCH, 201).receipt.invoiceId).toBe(INVOICE);
  });

  it("rejects a partial, extra-field, mismatched or wrong-status browser receipt", () => {
    const input = parseCreateBillingInvoiceInput(createBody(), KEY);
    const base = { requestId: KEY, status: "ok", data: { persisted: true, demo: false,
      receipt: { organizationId: ORG, branchId: BRANCH, clientId: CLIENT,
        invoiceId: INVOICE, invoiceKey: INVOICE_KEY, invoiceNumber: "SYS-BILL-640000000000",
        invoiceVersion: 1, invoiceLedgerVersion: 1, branchLedgerVersion: 7,
        invoiceTotal: "200.00", balanceAfter: "200.00", lineCount: 1,
        paymentStatus: "unpaid", committedAt: NOW.toISOString(), replayed: false,
        persisted: true, demo: false } }, errors: [] };
    expect(() => parseBillingInvoiceApiEnvelope({ ...base, extra: true }, input,
      ORG, BRANCH, 201)).toThrow(IntegrationError);
    expect(() => parseBillingInvoiceApiEnvelope({ ...base, data: { ...base.data,
      receipt: { ...base.data.receipt, branchLedgerVersion: 8 } } }, input,
    ORG, BRANCH, 201)).toThrow(IntegrationError);
    expect(() => parseBillingInvoiceApiEnvelope(base, input, ORG, BRANCH, 200))
      .toThrow(IntegrationError);
  });

  it("correlates internal receipt and daily reconciliation evidence", () => {
    const receiptInput = parseIssueBillingReceiptInput({ action: "issue_receipt",
      invoice_id: INVOICE, payment_entry_id: ENTRY, receipt_key: RECEIPT,
      expected_invoice_ledger_version: 2 }, KEY);
    expect(parseBillingReceiptReceipt({ organization_id: ORG, branch_id: BRANCH,
      client_id: CLIENT, invoice_id: INVOICE, payment_entry_id: ENTRY,
      receipt_id: RECEIPT, receipt_key: RECEIPT, receipt_number: "SYS-REC-640000000000",
      amount: "100.00", currency: "TWD", document_status: "not_configured",
      issued_at: NOW.toISOString(), replayed: false }, receiptInput, ORG, BRANCH).documentStatus)
      .toBe("not_configured");
    const input = parseRunBillingReconciliationInput({ action: "run_reconciliation",
      reconciliation_date: "2026-09-07", expected_branch_ledger_version: 6 }, KEY);
    expect(parseBillingReconciliationReceipt({ organization_id: ORG, branch_id: BRANCH,
      reconciliation_id: RECONCILIATION, reconciliation_date: "2026-09-07",
      expected_branch_ledger_version: 6, source_entry_count: 6,
      invoice_total: "499.99", payment_total: "300.00", refund_total: "20.00",
      adjustment_debit_total: "5.00", adjustment_credit_total: "0.00",
      ledger_balance: "224.99", detail_balance: "224.99", difference: "0.00",
      reconciliation_status: "matched", source_hash: HASH,
      reconciled_at: NOW.toISOString(), replayed: false }, input, ORG, BRANCH)
      .reconciliationStatus).toBe("matched");
  });
});
