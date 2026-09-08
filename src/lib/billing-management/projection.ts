import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { billingCentsToMoney, billingLineAmountIsExact, billingMoneyToCents } from "./decimal";
import { isBillingDate } from "./date";
import { BILLING_ENTRY_KINDS, BILLING_PAYMENT_METHODS, BILLING_TAX_HANDLINGS,
  type BillingFilters, type BillingManagementSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value)
  && Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isBillingDate);
const count = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe())]);
const money = z.string().regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u);
const positiveMoney = money.refine((value) => billingMoneyToCents(value) > BigInt(0));
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/u);
const text = (max: number) => z.string().trim().min(1).max(max);

const feeSchema = z.object({
  fee_item_version_id: uuid, fee_item_key: uuid, version: z.number().int().positive().safe(),
  fee_code: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/u),
  fee_name: text(120), unit_label: text(40), unit_price: positiveMoney,
  currency: z.string().regex(/^[A-Z]{3}$/u), tax_handling: z.enum(BILLING_TAX_HANDLINGS),
  effective_from: date, effective_to: date.nullable(), approved_at: timestamp,
  content_hash: hash,
}).strict();
const clientSchema = z.object({ client_id: uuid, client_code: text(120), display_name: text(120) }).strict();
const lineSchema = z.object({
  line_id: uuid, line_number: z.number().int().min(1).max(50),
  fee_item_version_id: uuid, fee_item_key: uuid,
  fee_code: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/u),
  fee_name: text(120), unit_label: text(40), service_date: date,
  quantity, unit_price: positiveMoney, amount: positiveMoney,
  currency: z.string().regex(/^[A-Z]{3}$/u), tax_handling: z.enum(BILLING_TAX_HANDLINGS),
  line_note: text(500).nullable(), content_hash: hash,
}).strict();
const entrySchema = z.object({
  entry_id: uuid, invoice_ledger_version: z.number().int().positive().safe(),
  branch_ledger_version: count.pipe(z.number().positive()), entry_kind: z.enum(BILLING_ENTRY_KINDS),
  amount: positiveMoney, signed_amount: money, balance_after: money,
  original_entry_id: uuid.nullable(), payment_method: z.enum(BILLING_PAYMENT_METHODS).nullable(),
  source_channel: z.enum(["internal_ledger", "staff_recorded_offline"]),
  occurred_at: timestamp, note: text(1_000).nullable(), recorded_by: uuid,
  recorded_at: timestamp, content_hash: hash,
}).strict();
const receiptSchema = z.object({
  receipt_id: uuid, payment_entry_id: uuid, receipt_key: uuid,
  receipt_number: z.string().regex(/^SYS-REC-[A-F0-9]{12}$/u),
  reference_kind: z.literal("internal_non_tax_receipt_record"),
  amount: positiveMoney, currency: z.string().regex(/^[A-Z]{3}$/u),
  issued_at: timestamp, issued_by: uuid, document_status: z.literal("not_configured"),
  content_hash: hash,
}).strict();
const invoiceSchema = z.object({
  invoice_id: uuid, invoice_key: uuid,
  invoice_number: z.string().regex(/^SYS-BILL-[A-F0-9]{12}$/u),
  reference_kind: z.literal("internal_non_tax_document"), version: z.literal(1),
  client_id: uuid, client_code: text(120), client_display_name: text(120),
  period_start: date, period_end: date, issued_on: date, due_on: date,
  currency: z.string().regex(/^[A-Z]{3}$/u), invoice_total: positiveMoney,
  payment_total: money, refund_total: money, adjustment_debit_total: money,
  adjustment_credit_total: money, net_collected: money, balance: money,
  payment_status: z.enum(["unpaid", "partial", "paid"]),
  invoice_ledger_version: z.number().int().positive().safe(), latest_entry_at: timestamp,
  line_count: z.number().int().min(1).max(50), created_at: timestamp,
  created_by: uuid, content_hash: hash, lines: z.array(lineSchema).max(50),
  entry_total: count, entries: z.array(entrySchema).max(200), entries_truncated: z.boolean(),
  receipt_total: count, receipts: z.array(receiptSchema).max(100), receipts_truncated: z.boolean(),
}).strict();
const reconciliationSchema = z.object({
  reconciliation_id: uuid, reconciliation_date: date,
  expected_branch_ledger_version: count, source_entry_count: count,
  invoice_total: money, payment_total: money, refund_total: money,
  adjustment_debit_total: money, adjustment_credit_total: money,
  ledger_balance: money, detail_balance: money, difference: money,
  reconciliation_status: z.enum(["matched", "mismatch"]), source_hash: hash,
  reconciled_by: uuid, reconciled_at: timestamp, content_hash: hash,
}).strict();
const payloadSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp, stale_after: timestamp,
  filters: z.object({ period_start: date, period_end: date, client_id: uuid.nullable(),
    payment_status: z.enum(["all", "unpaid", "partial", "paid"]) }).strict(),
  fee_configuration_status: z.enum(["configured", "not_configured"]),
  fee_items: z.array(feeSchema).max(200), fee_item_total: count, fee_items_truncated: z.boolean(),
  clients: z.array(clientSchema).max(500), client_total: count, clients_truncated: z.boolean(),
  invoices: z.array(invoiceSchema).max(200), matching_invoice_total: count,
  invoices_truncated: z.boolean(), branch_ledger_version: count,
  metrics: z.object({ receivable_total: money, collected_total: money,
    outstanding_total: money, refund_total: money }).strict(),
  reconciliations: z.array(reconciliationSchema).max(100),
  matching_reconciliation_total: count, reconciliations_truncated: z.boolean(),
  latest_reconciliation_status: z.enum(["matched", "mismatch", "not_run"]),
  latest_reconciliation_difference: money.nullable(),
  online_payment_status: z.literal("disabled"),
  payment_channel_boundary: z.literal("staff_recorded_offline_only"),
  numbering_policy_status: z.literal("internal_reference_only"),
  statutory_document_status: z.literal("not_configured"),
  tax_calculation_status: z.literal("explicit_fee_snapshot_only"),
  export_status: z.literal("not_configured"), offline_status: z.literal("online_only"),
}).strict();

export type BillingSnapshotSourceRow = { payload: unknown };
export class BillingProjectionError extends Error {
  constructor() { super("BILLING_MANAGEMENT_SNAPSHOT_INVALID"); this.name = "BillingProjectionError"; }
}

function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function paymentStatus(balance: bigint, invoice: bigint) {
  return balance === BigInt(0) ? "paid" : balance === invoice ? "unpaid" : "partial";
}

export function projectBillingManagementSnapshot(input: {
  row: BillingSnapshotSourceRow; expectedOrganizationId: string;
  expectedBranchId: string; filters: BillingFilters; demo: boolean;
}): BillingManagementSnapshot {
  try {
    const value = payloadSchema.parse(input.row.payload);
    if (value.organization_id !== input.expectedOrganizationId.toLowerCase()
      || value.branch_id !== input.expectedBranchId.toLowerCase()
      || value.filters.period_start !== input.filters.periodStart
      || value.filters.period_end !== input.filters.periodEnd
      || value.filters.client_id !== input.filters.clientId
      || value.filters.payment_status !== input.filters.paymentStatus
      || Date.parse(value.stale_after) - Date.parse(value.generated_at) !== 60_000
      || value.fee_item_total < value.fee_items.length
      || value.fee_items_truncated !== (value.fee_item_total > value.fee_items.length)
      || value.client_total < value.clients.length
      || value.clients_truncated !== (value.client_total > value.clients.length)
      || value.matching_invoice_total < value.invoices.length
      || value.invoices_truncated !== (value.matching_invoice_total > value.invoices.length)
      || value.matching_reconciliation_total < value.reconciliations.length
      || value.reconciliations_truncated !== (value.matching_reconciliation_total > value.reconciliations.length)
      || (value.fee_configuration_status === "not_configured" && value.fee_item_total !== 0)
      || (value.fee_configuration_status === "configured" && value.fee_item_total === 0)
      || !unique(value.fee_items.map((item) => item.fee_item_version_id))
      || !unique(value.clients.map((item) => item.client_id))
      || !unique(value.invoices.map((item) => item.invoice_id))) throw new Error("top-level drift");

    const branchVersions: number[] = [];
    for (const invoice of value.invoices) {
      if (invoice.period_end < invoice.period_start || invoice.issued_on < invoice.period_end
        || invoice.due_on < invoice.issued_on || invoice.line_count !== invoice.lines.length
        || invoice.entry_total < invoice.entries.length
        || invoice.entries_truncated !== (invoice.entry_total > invoice.entries.length)
        || invoice.receipt_total < invoice.receipts.length
        || invoice.receipts_truncated !== (invoice.receipt_total > invoice.receipts.length)
        || !unique(invoice.lines.map((line) => line.line_id))
        || !unique(invoice.entries.map((entry) => entry.entry_id))
        || !unique(invoice.receipts.map((receipt) => receipt.receipt_id))) throw new Error("invoice shape");
      let lineTotal = BigInt(0);
      invoice.lines.forEach((line, index) => {
        if (line.line_number !== index + 1 || line.currency !== invoice.currency
          || line.service_date < invoice.period_start || line.service_date > invoice.period_end
          || !billingLineAmountIsExact(line.quantity, line.unit_price, line.amount)) throw new Error("line drift");
        lineTotal += billingMoneyToCents(line.amount);
      });
      const invoiceTotal = billingMoneyToCents(invoice.invoice_total);
      if (lineTotal !== invoiceTotal) throw new Error("line total drift");

      const entries = [...invoice.entries].sort((a, b) => a.invoice_ledger_version - b.invoice_ledger_version);
      let running: bigint | null = invoice.entries_truncated ? null : BigInt(0);
      let payment = BigInt(0); let refund = BigInt(0);
      let debit = BigInt(0); let credit = BigInt(0);
      entries.forEach((entry, index) => {
        const amount = billingMoneyToCents(entry.amount);
        const expectedSigned = ["invoice_charge", "refund", "adjustment_debit"].includes(entry.entry_kind)
          ? amount : -amount;
        if (billingMoneyToCents(entry.signed_amount) !== expectedSigned
          || (entry.entry_kind === "payment") !== (entry.source_channel === "staff_recorded_offline")
          || (entry.entry_kind === "payment") !== (entry.payment_method !== null)
          || (entry.entry_kind === "refund") !== (entry.original_entry_id !== null)) throw new Error("entry drift");
        if (!invoice.entries_truncated) {
          if (entry.invoice_ledger_version !== index + 1
            || (index === 0 && (entry.entry_kind !== "invoice_charge" || amount !== invoiceTotal))) throw new Error("ledger sequence");
          running = running! + expectedSigned;
          if (billingMoneyToCents(entry.balance_after) !== running || running < BigInt(0)) throw new Error("ledger balance");
        }
        branchVersions.push(entry.branch_ledger_version);
        if (entry.entry_kind === "payment") payment += amount;
        if (entry.entry_kind === "refund") refund += amount;
        if (entry.entry_kind === "adjustment_debit") debit += amount;
        if (entry.entry_kind === "adjustment_credit") credit += amount;
      });
      if (!invoice.entries_truncated && (invoice.invoice_ledger_version !== entries.length
        || payment !== billingMoneyToCents(invoice.payment_total)
        || refund !== billingMoneyToCents(invoice.refund_total)
        || debit !== billingMoneyToCents(invoice.adjustment_debit_total)
        || credit !== billingMoneyToCents(invoice.adjustment_credit_total)
        || running !== billingMoneyToCents(invoice.balance))) throw new Error("invoice aggregates");
      if (billingMoneyToCents(invoice.net_collected)
          !== billingMoneyToCents(invoice.payment_total) - billingMoneyToCents(invoice.refund_total)
        || invoice.payment_status !== paymentStatus(billingMoneyToCents(invoice.balance), invoiceTotal)) throw new Error("status drift");
      const byId = new Map(invoice.entries.map((entry) => [entry.entry_id, entry]));
      invoice.receipts.forEach((receipt) => {
        const source = byId.get(receipt.payment_entry_id);
        if (!source || source.entry_kind !== "payment" || source.amount !== receipt.amount
          || receipt.currency !== invoice.currency) throw new Error("receipt drift");
      });
    }
    if (!unique(branchVersions.map(String))
      || Math.max(0, ...branchVersions) > value.branch_ledger_version) throw new Error("branch ledger drift");

    let receivable = BigInt(0); let collected = BigInt(0);
    let outstanding = BigInt(0); let refunds = BigInt(0);
    value.invoices.forEach((invoice) => { receivable += billingMoneyToCents(invoice.invoice_total);
      collected += billingMoneyToCents(invoice.net_collected);
      outstanding += billingMoneyToCents(invoice.balance); refunds += billingMoneyToCents(invoice.refund_total); });
    if (!value.invoices_truncated && (billingCentsToMoney(receivable) !== billingCentsToMoney(billingMoneyToCents(value.metrics.receivable_total))
      || billingCentsToMoney(collected) !== billingCentsToMoney(billingMoneyToCents(value.metrics.collected_total))
      || billingCentsToMoney(outstanding) !== billingCentsToMoney(billingMoneyToCents(value.metrics.outstanding_total))
      || billingCentsToMoney(refunds) !== billingCentsToMoney(billingMoneyToCents(value.metrics.refund_total)))) throw new Error("metric drift");

    value.reconciliations.forEach((item) => {
      const detail = billingMoneyToCents(item.invoice_total) - billingMoneyToCents(item.payment_total)
        + billingMoneyToCents(item.refund_total) + billingMoneyToCents(item.adjustment_debit_total)
        - billingMoneyToCents(item.adjustment_credit_total);
      const difference = detail - billingMoneyToCents(item.ledger_balance);
      if (detail !== billingMoneyToCents(item.detail_balance)
        || difference !== billingMoneyToCents(item.difference)
        || item.reconciliation_status !== (difference === BigInt(0) ? "matched" : "mismatch")
        || item.expected_branch_ledger_version > value.branch_ledger_version) throw new Error("reconciliation drift");
    });
    if ((value.reconciliations.length === 0) !== (value.latest_reconciliation_status === "not_run")
      || (value.latest_reconciliation_status === "not_run") !== (value.latest_reconciliation_difference === null)
      || (value.reconciliations[0] && (value.latest_reconciliation_status !== value.reconciliations[0].reconciliation_status
        || value.latest_reconciliation_difference !== value.reconciliations[0].difference))) throw new Error("latest reconciliation drift");

    return {
      organizationId: value.organization_id, branchId: value.branch_id,
      generatedAt: value.generated_at, staleAfter: value.stale_after,
      filters: { periodStart: value.filters.period_start, periodEnd: value.filters.period_end,
        clientId: value.filters.client_id, paymentStatus: value.filters.payment_status },
      feeConfigurationStatus: value.fee_configuration_status,
      feeItems: value.fee_items.map((fee) => ({ feeItemVersionId: fee.fee_item_version_id,
        feeItemKey: fee.fee_item_key, version: fee.version, feeCode: fee.fee_code,
        feeName: fee.fee_name, unitLabel: fee.unit_label, unitPrice: fee.unit_price,
        currency: fee.currency, taxHandling: fee.tax_handling,
        effectiveFrom: fee.effective_from, effectiveTo: fee.effective_to,
        approvedAt: fee.approved_at, contentHash: fee.content_hash })),
      feeItemTotal: value.fee_item_total, feeItemsTruncated: value.fee_items_truncated,
      clients: value.clients.map((client) => ({ clientId: client.client_id,
        clientCode: client.client_code, displayName: client.display_name })),
      clientTotal: value.client_total, clientsTruncated: value.clients_truncated,
      invoices: value.invoices.map((invoice) => ({ invoiceId: invoice.invoice_id,
        invoiceKey: invoice.invoice_key, invoiceNumber: invoice.invoice_number,
        referenceKind: invoice.reference_kind, version: invoice.version,
        clientId: invoice.client_id, clientCode: invoice.client_code,
        clientDisplayName: invoice.client_display_name, periodStart: invoice.period_start,
        periodEnd: invoice.period_end, issuedOn: invoice.issued_on, dueOn: invoice.due_on,
        currency: invoice.currency, invoiceTotal: invoice.invoice_total,
        paymentTotal: invoice.payment_total, refundTotal: invoice.refund_total,
        adjustmentDebitTotal: invoice.adjustment_debit_total,
        adjustmentCreditTotal: invoice.adjustment_credit_total,
        netCollected: invoice.net_collected, balance: invoice.balance,
        paymentStatus: invoice.payment_status,
        invoiceLedgerVersion: invoice.invoice_ledger_version,
        latestEntryAt: invoice.latest_entry_at, lineCount: invoice.line_count,
        createdAt: invoice.created_at, createdBy: invoice.created_by,
        contentHash: invoice.content_hash,
        lines: invoice.lines.map((line) => ({ lineId: line.line_id,
          lineNumber: line.line_number, feeItemVersionId: line.fee_item_version_id,
          feeItemKey: line.fee_item_key, feeCode: line.fee_code,
          feeName: line.fee_name, unitLabel: line.unit_label,
          serviceDate: line.service_date, quantity: line.quantity,
          unitPrice: line.unit_price, amount: line.amount, currency: line.currency,
          taxHandling: line.tax_handling, lineNote: line.line_note,
          contentHash: line.content_hash })),
        entryTotal: invoice.entry_total, entries: invoice.entries.map((entry) => ({
          entryId: entry.entry_id, invoiceLedgerVersion: entry.invoice_ledger_version,
          branchLedgerVersion: entry.branch_ledger_version, entryKind: entry.entry_kind,
          amount: entry.amount, signedAmount: entry.signed_amount,
          balanceAfter: entry.balance_after, originalEntryId: entry.original_entry_id,
          paymentMethod: entry.payment_method, sourceChannel: entry.source_channel,
          occurredAt: entry.occurred_at, note: entry.note, recordedBy: entry.recorded_by,
          recordedAt: entry.recorded_at, contentHash: entry.content_hash })),
        entriesTruncated: invoice.entries_truncated, receiptTotal: invoice.receipt_total,
        receipts: invoice.receipts.map((receipt) => ({ receiptId: receipt.receipt_id,
          paymentEntryId: receipt.payment_entry_id, receiptKey: receipt.receipt_key,
          receiptNumber: receipt.receipt_number, referenceKind: receipt.reference_kind,
          amount: receipt.amount, currency: receipt.currency,
          issuedAt: receipt.issued_at, issuedBy: receipt.issued_by,
          documentStatus: receipt.document_status, contentHash: receipt.content_hash })),
        receiptsTruncated: invoice.receipts_truncated })),
      matchingInvoiceTotal: value.matching_invoice_total,
      invoicesTruncated: value.invoices_truncated,
      branchLedgerVersion: value.branch_ledger_version,
      metrics: { receivableTotal: value.metrics.receivable_total,
        collectedTotal: value.metrics.collected_total,
        outstandingTotal: value.metrics.outstanding_total,
        refundTotal: value.metrics.refund_total },
      reconciliations: value.reconciliations.map((item) => ({
        reconciliationId: item.reconciliation_id,
        reconciliationDate: item.reconciliation_date,
        expectedBranchLedgerVersion: item.expected_branch_ledger_version,
        sourceEntryCount: item.source_entry_count, invoiceTotal: item.invoice_total,
        paymentTotal: item.payment_total, refundTotal: item.refund_total,
        adjustmentDebitTotal: item.adjustment_debit_total,
        adjustmentCreditTotal: item.adjustment_credit_total,
        ledgerBalance: item.ledger_balance, detailBalance: item.detail_balance,
        difference: item.difference, reconciliationStatus: item.reconciliation_status,
        sourceHash: item.source_hash, reconciledBy: item.reconciled_by,
        reconciledAt: item.reconciled_at, contentHash: item.content_hash })),
      matchingReconciliationTotal: value.matching_reconciliation_total,
      reconciliationsTruncated: value.reconciliations_truncated,
      latestReconciliationStatus: value.latest_reconciliation_status,
      latestReconciliationDifference: value.latest_reconciliation_difference,
      onlinePaymentStatus: value.online_payment_status,
      paymentChannelBoundary: value.payment_channel_boundary,
      numberingPolicyStatus: value.numbering_policy_status,
      statutoryDocumentStatus: value.statutory_document_status,
      taxCalculationStatus: value.tax_calculation_status,
      exportStatus: value.export_status, offlineStatus: value.offline_status,
      demo: input.demo,
    };
  } catch (error) {
    if (error instanceof BillingProjectionError) throw error;
    throw new BillingProjectionError();
  }
}
