import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { billingMoneyToCents } from "./decimal";
import { billingRangeDays, isBillingDate } from "./date";
import { BILLING_PAYMENT_METHODS, type BillingEntryReceipt,
  type BillingInvoiceReceipt, type BillingReceiptReceipt,
  type BillingReconciliationReceipt, type CreateBillingInvoiceInput,
  type IssueBillingReceiptInput, type RecordBillingEntryInput,
  type RunBillingReconciliationInput } from "./types";

export const BILLING_ACTION_HEADER = "x-billing-management-action";
export const BILLING_CREATE_MAX_BYTES = 64 * 1024;
export const BILLING_MUTATION_MAX_BYTES = 16 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().refine(isBillingDate);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value)
  && Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
const amount = z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u)
  .refine((value) => billingMoneyToCents(value) > BigInt(0));
const money = z.string().regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/u)
  .refine((value) => Number(value) > 0);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();
const idempotency = (value: string | null) => {
  const parsed = uuid.safeParse(value); if (!parsed.success) throw new IntegrationError(
    "INVALID_IDEMPOTENCY_KEY", "請提供有效的操作識別碼。", 400, "idempotency-key");
  return parsed.data;
};
const invalid = (message: string, field?: string): never => {
  throw new IntegrationError("INVALID_BILLING_INPUT", message, 400, field);
};

const createSchema = z.object({ action: z.literal("create_invoice"), client_id: uuid,
  invoice_key: uuid, period_start: date, period_end: date, issued_on: date, due_on: date,
  lines: z.array(z.object({ fee_item_version_id: uuid, service_date: date,
    quantity, line_note: optionalText(500).optional().default(null) }).strict()).min(1).max(50),
  expected_invoice_version: z.literal(0),
  expected_branch_ledger_version: z.number().int().nonnegative().safe(),
}).strict();
const entrySchema = z.object({ action: z.literal("record_entry"), invoice_id: uuid,
  entry_kind: z.enum(["payment", "refund", "adjustment_debit", "adjustment_credit"]),
  amount, original_entry_id: uuid.nullable(), payment_method: z.enum(BILLING_PAYMENT_METHODS).nullable(),
  occurred_at: timestamp, note: optionalText(1_000),
  expected_invoice_ledger_version: z.number().int().positive().safe(),
  expected_branch_ledger_version: z.number().int().positive().safe(),
}).strict();
const receiptInputSchema = z.object({ action: z.literal("issue_receipt"),
  invoice_id: uuid, payment_entry_id: uuid, receipt_key: uuid,
  expected_invoice_ledger_version: z.number().int().min(2).safe() }).strict();
const reconciliationInputSchema = z.object({ action: z.literal("run_reconciliation"),
  reconciliation_date: date,
  expected_branch_ledger_version: z.number().int().nonnegative().safe() }).strict();

export function parseCreateBillingInvoiceInput(body: unknown, key: string | null): CreateBillingInvoiceInput {
  const parsed = createSchema.safeParse(body); if (!parsed.success) return invalid("帳單內容不完整或包含未知欄位。");
  const value = parsed.data;
  if (billingRangeDays(value.period_start, value.period_end) < 1
    || billingRangeDays(value.period_start, value.period_end) > 367
    || value.issued_on < value.period_end || value.due_on < value.issued_on
    || billingRangeDays(value.issued_on, value.due_on) > 367) invalid("帳務期間、開立日或到期日不合法。", "period_start");
  if (value.lines.some((line) => line.service_date < value.period_start || line.service_date > value.period_end))
    invalid("每筆服務日期必須位於帳務期間內。", "lines");
  return { action: value.action, clientId: value.client_id, invoiceKey: value.invoice_key,
    periodStart: value.period_start, periodEnd: value.period_end, issuedOn: value.issued_on,
    dueOn: value.due_on, lines: value.lines.map((line) => ({
      feeItemVersionId: line.fee_item_version_id, serviceDate: line.service_date,
      quantity: line.quantity, lineNote: line.line_note })),
    expectedInvoiceVersion: 0, expectedBranchLedgerVersion: value.expected_branch_ledger_version,
    idempotencyKey: idempotency(key) };
}

export function parseRecordBillingEntryInput(body: unknown, key: string | null): RecordBillingEntryInput {
  const parsed = entrySchema.safeParse(body); if (!parsed.success) return invalid("帳務流水內容不完整或包含未知欄位。");
  const value = parsed.data; const adjustment = value.entry_kind !== "payment";
  if (value.entry_kind === "payment") {
    if (!value.payment_method || value.original_entry_id) invalid("付款只能選擇離線方式，且不得偽造退款來源。", "payment_method");
  } else if (value.payment_method || !value.note || value.note.length < 2
    || ((value.entry_kind === "refund") !== (value.original_entry_id !== null))) {
    invalid("退款或調整必須提供正確來源與至少兩字理由。", adjustment ? "note" : undefined);
  }
  if (Date.parse(value.occurred_at) > Date.now() + 5 * 60_000) invalid("發生時間不得位於未來。", "occurred_at");
  return { action: value.action, invoiceId: value.invoice_id, entryKind: value.entry_kind,
    amount: value.amount, originalEntryId: value.original_entry_id,
    paymentMethod: value.payment_method, occurredAt: value.occurred_at, note: value.note,
    expectedInvoiceLedgerVersion: value.expected_invoice_ledger_version,
    expectedBranchLedgerVersion: value.expected_branch_ledger_version,
    idempotencyKey: idempotency(key) };
}

export function parseIssueBillingReceiptInput(body: unknown, key: string | null): IssueBillingReceiptInput {
  const parsed = receiptInputSchema.safeParse(body); if (!parsed.success) return invalid("收據紀錄內容不完整或包含未知欄位。");
  return { action: parsed.data.action, invoiceId: parsed.data.invoice_id,
    paymentEntryId: parsed.data.payment_entry_id, receiptKey: parsed.data.receipt_key,
    expectedInvoiceLedgerVersion: parsed.data.expected_invoice_ledger_version,
    idempotencyKey: idempotency(key) };
}

export function parseRunBillingReconciliationInput(body: unknown, key: string | null): RunBillingReconciliationInput {
  const parsed = reconciliationInputSchema.safeParse(body); if (!parsed.success)
    return invalid("每日對帳內容不完整或包含未知欄位。");
  return { action: parsed.data.action, reconciliationDate: parsed.data.reconciliation_date,
    expectedBranchLedgerVersion: parsed.data.expected_branch_ledger_version,
    idempotencyKey: idempotency(key) };
}

const commonReceipt = { organization_id: uuid, branch_id: uuid, client_id: uuid,
  invoice_id: uuid, committed_at: timestamp, replayed: z.boolean() };
const invoiceReceiptSchema = z.object({ ...commonReceipt, invoice_key: uuid,
  invoice_number: z.string().regex(/^SYS-BILL-[A-F0-9]{12}$/u),
  invoice_version: z.literal(1), invoice_ledger_version: z.literal(1),
  branch_ledger_version: z.number().int().positive().safe(), invoice_total: amount,
  balance_after: amount, line_count: z.number().int().min(1).max(50),
  payment_status: z.literal("unpaid") }).strict();
const entryReceiptSchema = z.object({ ...commonReceipt, entry_id: uuid,
  entry_kind: z.enum(["payment", "refund", "adjustment_debit", "adjustment_credit"]),
  amount, signed_amount: z.string().regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u),
  balance_after: z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u),
  invoice_ledger_version: z.number().int().min(2).safe(),
  branch_ledger_version: z.number().int().min(2).safe(),
  payment_status: z.enum(["unpaid", "partial", "paid"]) }).strict();
const issuedReceiptSchema = z.object({ organization_id: uuid, branch_id: uuid,
  client_id: uuid, invoice_id: uuid, payment_entry_id: uuid, receipt_id: uuid,
  receipt_key: uuid, receipt_number: z.string().regex(/^SYS-REC-[A-F0-9]{12}$/u),
  amount, currency: z.string().regex(/^[A-Z]{3}$/u), document_status: z.literal("not_configured"),
  issued_at: timestamp, replayed: z.boolean() }).strict();
const reconciliationReceiptSchema = z.object({ organization_id: uuid, branch_id: uuid,
  reconciliation_id: uuid, reconciliation_date: date,
  expected_branch_ledger_version: z.number().int().nonnegative().safe(),
  source_entry_count: z.number().int().nonnegative().safe(), invoice_total: money,
  payment_total: money, refund_total: money, adjustment_debit_total: money,
  adjustment_credit_total: money, ledger_balance: money, detail_balance: money,
  difference: money, reconciliation_status: z.enum(["matched", "mismatch"]),
  source_hash: hash, reconciled_at: timestamp, replayed: z.boolean(),
}).strict();
function correlateTenant(value: { organization_id: string; branch_id: string }, organizationId: string, branchId: string) {
  if (value.organization_id !== organizationId.toLowerCase() || value.branch_id !== branchId.toLowerCase())
    throw new IntegrationError("BILLING_RECEIPT_MISMATCH", "帳務回執無法與目前分支核對。", 502);
}

export function parseBillingInvoiceReceipt(raw: unknown, input: CreateBillingInvoiceInput,
  organizationId: string, branchId: string): BillingInvoiceReceipt {
  const result = invoiceReceiptSchema.safeParse(raw); if (!result.success)
    throw new IntegrationError("BILLING_RECEIPT_INVALID", "帳單回執格式不完整。", 502);
  const value = result.data; correlateTenant(value, organizationId, branchId);
  if (value.client_id !== input.clientId || value.invoice_key !== input.invoiceKey
    || value.branch_ledger_version !== input.expectedBranchLedgerVersion + 1
    || value.line_count !== input.lines.length
    || billingMoneyToCents(value.invoice_total) !== billingMoneyToCents(value.balance_after))
    throw new IntegrationError("BILLING_RECEIPT_MISMATCH", "帳單回執無法與送出內容核對。", 502);
  return { organizationId: value.organization_id, branchId: value.branch_id,
    clientId: value.client_id, invoiceId: value.invoice_id, invoiceKey: value.invoice_key,
    invoiceNumber: value.invoice_number, invoiceVersion: value.invoice_version,
    invoiceLedgerVersion: value.invoice_ledger_version,
    branchLedgerVersion: value.branch_ledger_version, invoiceTotal: value.invoice_total,
    balanceAfter: value.balance_after, lineCount: value.line_count,
    paymentStatus: value.payment_status, committedAt: value.committed_at,
    replayed: value.replayed, persisted: true, demo: false };
}

export function parseBillingEntryReceipt(raw: unknown, input: RecordBillingEntryInput,
  organizationId: string, branchId: string): BillingEntryReceipt {
  const result = entryReceiptSchema.safeParse(raw); if (!result.success)
    throw new IntegrationError("BILLING_RECEIPT_INVALID", "帳務流水回執格式不完整。", 502);
  const value = result.data; correlateTenant(value, organizationId, branchId);
  const expectedSign = ["refund", "adjustment_debit"].includes(input.entryKind)
    ? BigInt(1) : BigInt(-1);
  if (value.invoice_id !== input.invoiceId || value.entry_kind !== input.entryKind
    || billingMoneyToCents(value.amount) !== billingMoneyToCents(input.amount)
    || billingMoneyToCents(value.signed_amount) !== expectedSign * billingMoneyToCents(input.amount)
    || value.invoice_ledger_version !== input.expectedInvoiceLedgerVersion + 1
    || value.branch_ledger_version !== input.expectedBranchLedgerVersion + 1)
    throw new IntegrationError("BILLING_RECEIPT_MISMATCH", "帳務流水回執無法與送出內容核對。", 502);
  return { organizationId: value.organization_id, branchId: value.branch_id,
    clientId: value.client_id, invoiceId: value.invoice_id, entryId: value.entry_id,
    entryKind: value.entry_kind, amount: value.amount, signedAmount: value.signed_amount,
    balanceAfter: value.balance_after, invoiceLedgerVersion: value.invoice_ledger_version,
    branchLedgerVersion: value.branch_ledger_version, paymentStatus: value.payment_status,
    committedAt: value.committed_at, replayed: value.replayed, persisted: true, demo: false };
}

export function parseBillingReceiptReceipt(raw: unknown, input: IssueBillingReceiptInput,
  organizationId: string, branchId: string): BillingReceiptReceipt {
  const result = issuedReceiptSchema.safeParse(raw); if (!result.success)
    throw new IntegrationError("BILLING_RECEIPT_INVALID", "收據紀錄回執格式不完整。", 502);
  const value = result.data; correlateTenant(value, organizationId, branchId);
  if (value.invoice_id !== input.invoiceId || value.payment_entry_id !== input.paymentEntryId
    || value.receipt_key !== input.receiptKey)
    throw new IntegrationError("BILLING_RECEIPT_MISMATCH", "收據紀錄回執無法與送出內容核對。", 502);
  return { organizationId: value.organization_id, branchId: value.branch_id,
    clientId: value.client_id, invoiceId: value.invoice_id,
    paymentEntryId: value.payment_entry_id, receiptId: value.receipt_id,
    receiptKey: value.receipt_key, receiptNumber: value.receipt_number,
    amount: value.amount, currency: value.currency, documentStatus: value.document_status,
    issuedAt: value.issued_at, replayed: value.replayed, persisted: true, demo: false };
}

export function parseBillingReconciliationReceipt(raw: unknown,
  input: RunBillingReconciliationInput, organizationId: string,
  branchId: string): BillingReconciliationReceipt {
  const result = reconciliationReceiptSchema.safeParse(raw); if (!result.success)
    throw new IntegrationError("BILLING_RECEIPT_INVALID", "每日對帳回執格式不完整。", 502);
  const value = result.data; correlateTenant(value, organizationId, branchId);
  const detail = billingMoneyToCents(value.invoice_total) - billingMoneyToCents(value.payment_total)
    + billingMoneyToCents(value.refund_total) + billingMoneyToCents(value.adjustment_debit_total)
    - billingMoneyToCents(value.adjustment_credit_total);
  const difference = detail - billingMoneyToCents(value.ledger_balance);
  if (value.reconciliation_date !== input.reconciliationDate
    || value.expected_branch_ledger_version !== input.expectedBranchLedgerVersion
    || billingMoneyToCents(value.detail_balance) !== detail
    || billingMoneyToCents(value.difference) !== difference
    || value.reconciliation_status !== (difference === BigInt(0) ? "matched" : "mismatch"))
    throw new IntegrationError("BILLING_RECEIPT_MISMATCH", "每日對帳回執無法與送出內容核對。", 502);
  return { organizationId: value.organization_id, branchId: value.branch_id,
    reconciliationId: value.reconciliation_id,
    reconciliationDate: value.reconciliation_date,
    expectedBranchLedgerVersion: value.expected_branch_ledger_version,
    sourceEntryCount: value.source_entry_count, invoiceTotal: value.invoice_total,
    paymentTotal: value.payment_total, refundTotal: value.refund_total,
    adjustmentDebitTotal: value.adjustment_debit_total,
    adjustmentCreditTotal: value.adjustment_credit_total,
    ledgerBalance: value.ledger_balance, detailBalance: value.detail_balance,
    difference: value.difference, reconciliationStatus: value.reconciliation_status,
    sourceHash: value.source_hash, reconciledAt: value.reconciled_at,
    replayed: value.replayed, persisted: true, demo: false };
}

const apiEnvelopeSchema = z.object({ requestId: uuid, status: z.literal("ok"),
  data: z.object({ receipt: z.record(z.string(), z.unknown()), persisted: z.literal(true),
    demo: z.literal(false) }).strict(), errors: z.array(z.never()).length(0) }).strict();
function apiReceipt(value: unknown, fields: Readonly<Record<string, string>>) {
  const parsed = apiEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError("BILLING_RECEIPT_INVALID",
    "帳務完成回執格式不完整；請保留相同操作鍵重試。", 502);
  const source = parsed.data.data.receipt;
  const expectedKeys = [...Object.keys(fields), "persisted", "demo"].sort();
  if (JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(expectedKeys)
    || source.persisted !== true || source.demo !== false) throw new IntegrationError(
      "BILLING_RECEIPT_INVALID", "帳務完成回執無法確認持久化；請保留相同操作鍵重試。", 502);
  return { requestId: parsed.data.requestId, raw: Object.fromEntries(
    Object.entries(fields).map(([camel, snake]) => [snake, source[camel]])) };
}
function apiStatus(replayed: boolean, httpStatus: number) {
  if (httpStatus !== (replayed ? 200 : 201)) throw new IntegrationError(
    "BILLING_RECEIPT_INVALID", "帳務 HTTP 狀態與完成回執不一致；請保留相同操作鍵重試。", 502);
}

export function parseBillingInvoiceApiEnvelope(value: unknown, input: CreateBillingInvoiceInput,
  organizationId: string, branchId: string, httpStatus: number) {
  const envelope = apiReceipt(value, { organizationId: "organization_id", branchId: "branch_id",
    clientId: "client_id", invoiceId: "invoice_id", invoiceKey: "invoice_key",
    invoiceNumber: "invoice_number", invoiceVersion: "invoice_version",
    invoiceLedgerVersion: "invoice_ledger_version", branchLedgerVersion: "branch_ledger_version",
    invoiceTotal: "invoice_total", balanceAfter: "balance_after", lineCount: "line_count",
    paymentStatus: "payment_status", committedAt: "committed_at", replayed: "replayed" });
  const receipt = parseBillingInvoiceReceipt(envelope.raw, input, organizationId, branchId);
  apiStatus(receipt.replayed, httpStatus); return { requestId: envelope.requestId, receipt };
}

export function parseBillingEntryApiEnvelope(value: unknown, input: RecordBillingEntryInput,
  organizationId: string, branchId: string, httpStatus: number) {
  const envelope = apiReceipt(value, { organizationId: "organization_id", branchId: "branch_id",
    clientId: "client_id", invoiceId: "invoice_id", entryId: "entry_id",
    entryKind: "entry_kind", amount: "amount", signedAmount: "signed_amount",
    balanceAfter: "balance_after", invoiceLedgerVersion: "invoice_ledger_version",
    branchLedgerVersion: "branch_ledger_version", paymentStatus: "payment_status",
    committedAt: "committed_at", replayed: "replayed" });
  const receipt = parseBillingEntryReceipt(envelope.raw, input, organizationId, branchId);
  apiStatus(receipt.replayed, httpStatus); return { requestId: envelope.requestId, receipt };
}

export function parseBillingReceiptApiEnvelope(value: unknown, input: IssueBillingReceiptInput,
  organizationId: string, branchId: string, httpStatus: number) {
  const envelope = apiReceipt(value, { organizationId: "organization_id", branchId: "branch_id",
    clientId: "client_id", invoiceId: "invoice_id", paymentEntryId: "payment_entry_id",
    receiptId: "receipt_id", receiptKey: "receipt_key", receiptNumber: "receipt_number",
    amount: "amount", currency: "currency", documentStatus: "document_status",
    issuedAt: "issued_at", replayed: "replayed" });
  const receipt = parseBillingReceiptReceipt(envelope.raw, input, organizationId, branchId);
  apiStatus(receipt.replayed, httpStatus); return { requestId: envelope.requestId, receipt };
}

export function parseBillingReconciliationApiEnvelope(value: unknown,
  input: RunBillingReconciliationInput, organizationId: string,
  branchId: string, httpStatus: number) {
  const envelope = apiReceipt(value, { organizationId: "organization_id", branchId: "branch_id",
    reconciliationId: "reconciliation_id", reconciliationDate: "reconciliation_date",
    expectedBranchLedgerVersion: "expected_branch_ledger_version",
    sourceEntryCount: "source_entry_count", invoiceTotal: "invoice_total",
    paymentTotal: "payment_total", refundTotal: "refund_total",
    adjustmentDebitTotal: "adjustment_debit_total",
    adjustmentCreditTotal: "adjustment_credit_total", ledgerBalance: "ledger_balance",
    detailBalance: "detail_balance", difference: "difference",
    reconciliationStatus: "reconciliation_status", sourceHash: "source_hash",
    reconciledAt: "reconciled_at", replayed: "replayed" });
  const receipt = parseBillingReconciliationReceipt(envelope.raw, input, organizationId, branchId);
  apiStatus(receipt.replayed, httpStatus); return { requestId: envelope.requestId, receipt };
}
