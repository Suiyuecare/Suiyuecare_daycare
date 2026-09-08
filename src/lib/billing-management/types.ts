export const BILLING_PAYMENT_STATUSES = ["all", "unpaid", "partial", "paid"] as const;
export const BILLING_ENTRY_KINDS = [
  "invoice_charge", "payment", "refund", "adjustment_debit", "adjustment_credit",
] as const;
export const BILLING_PAYMENT_METHODS = ["cash", "bank_transfer", "offline_other"] as const;
export const BILLING_TAX_HANDLINGS = [
  "explicitly_included_in_unit_price", "explicitly_exempt", "explicitly_not_applicable",
] as const;

export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];
export type BillingInvoicePaymentStatus = Exclude<BillingPaymentStatus, "all">;
export type BillingEntryKind = (typeof BILLING_ENTRY_KINDS)[number];
export type BillingTransactionKind = Exclude<BillingEntryKind, "invoice_charge">;
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHODS)[number];
export type BillingTaxHandling = (typeof BILLING_TAX_HANDLINGS)[number];

export type BillingFilters = {
  periodStart: string;
  periodEnd: string;
  clientId: string | null;
  paymentStatus: BillingPaymentStatus;
};

export type BillingFeeItem = {
  feeItemVersionId: string; feeItemKey: string; version: number;
  feeCode: string; feeName: string; unitLabel: string; unitPrice: string;
  currency: string; taxHandling: BillingTaxHandling; effectiveFrom: string;
  effectiveTo: string | null; approvedAt: string; contentHash: string;
};

export type BillingClientOption = {
  clientId: string; clientCode: string; displayName: string;
};

export type BillingInvoiceLine = {
  lineId: string; lineNumber: number; feeItemVersionId: string; feeItemKey: string;
  feeCode: string; feeName: string; unitLabel: string; serviceDate: string;
  quantity: string; unitPrice: string; amount: string; currency: string;
  taxHandling: BillingTaxHandling; lineNote: string | null; contentHash: string;
};

export type BillingLedgerEntry = {
  entryId: string; invoiceLedgerVersion: number; branchLedgerVersion: number;
  entryKind: BillingEntryKind; amount: string; signedAmount: string;
  balanceAfter: string; originalEntryId: string | null;
  paymentMethod: BillingPaymentMethod | null;
  sourceChannel: "internal_ledger" | "staff_recorded_offline";
  occurredAt: string; note: string | null; recordedBy: string;
  recordedAt: string; contentHash: string;
};

export type BillingReceipt = {
  receiptId: string; paymentEntryId: string; receiptKey: string;
  receiptNumber: string; referenceKind: "internal_non_tax_receipt_record";
  amount: string; currency: string; issuedAt: string; issuedBy: string;
  documentStatus: "not_configured"; contentHash: string;
};

export type BillingInvoice = {
  invoiceId: string; invoiceKey: string; invoiceNumber: string;
  referenceKind: "internal_non_tax_document"; version: 1;
  clientId: string; clientCode: string; clientDisplayName: string;
  periodStart: string; periodEnd: string; issuedOn: string; dueOn: string;
  currency: string; invoiceTotal: string; paymentTotal: string; refundTotal: string;
  adjustmentDebitTotal: string; adjustmentCreditTotal: string;
  netCollected: string; balance: string; paymentStatus: BillingInvoicePaymentStatus;
  invoiceLedgerVersion: number; latestEntryAt: string; lineCount: number;
  createdAt: string; createdBy: string; contentHash: string;
  lines: readonly BillingInvoiceLine[]; entryTotal: number;
  entries: readonly BillingLedgerEntry[]; entriesTruncated: boolean;
  receiptTotal: number; receipts: readonly BillingReceipt[];
  receiptsTruncated: boolean;
};

export type BillingReconciliation = {
  reconciliationId: string; reconciliationDate: string;
  expectedBranchLedgerVersion: number; sourceEntryCount: number;
  invoiceTotal: string; paymentTotal: string; refundTotal: string;
  adjustmentDebitTotal: string; adjustmentCreditTotal: string;
  ledgerBalance: string; detailBalance: string; difference: string;
  reconciliationStatus: "matched" | "mismatch"; sourceHash: string;
  reconciledBy: string; reconciledAt: string; contentHash: string;
};

export type BillingManagementSnapshot = {
  organizationId: string; branchId: string; generatedAt: string; staleAfter: string;
  filters: BillingFilters; feeConfigurationStatus: "configured" | "not_configured";
  feeItems: readonly BillingFeeItem[]; feeItemTotal: number; feeItemsTruncated: boolean;
  clients: readonly BillingClientOption[]; clientTotal: number; clientsTruncated: boolean;
  invoices: readonly BillingInvoice[]; matchingInvoiceTotal: number;
  invoicesTruncated: boolean; branchLedgerVersion: number;
  metrics: { receivableTotal: string; collectedTotal: string;
    outstandingTotal: string; refundTotal: string };
  reconciliations: readonly BillingReconciliation[];
  matchingReconciliationTotal: number; reconciliationsTruncated: boolean;
  latestReconciliationStatus: "matched" | "mismatch" | "not_run";
  latestReconciliationDifference: string | null;
  onlinePaymentStatus: "disabled";
  paymentChannelBoundary: "staff_recorded_offline_only";
  numberingPolicyStatus: "internal_reference_only";
  statutoryDocumentStatus: "not_configured";
  taxCalculationStatus: "explicit_fee_snapshot_only";
  exportStatus: "not_configured"; offlineStatus: "online_only";
  demo: boolean;
};

export type CreateBillingInvoiceInput = {
  action: "create_invoice"; clientId: string; invoiceKey: string;
  periodStart: string; periodEnd: string; issuedOn: string; dueOn: string;
  lines: readonly { feeItemVersionId: string; serviceDate: string;
    quantity: string; lineNote: string | null }[];
  expectedInvoiceVersion: 0; expectedBranchLedgerVersion: number;
  idempotencyKey: string;
};

export type RecordBillingEntryInput = {
  action: "record_entry"; invoiceId: string; entryKind: BillingTransactionKind;
  amount: string; originalEntryId: string | null;
  paymentMethod: BillingPaymentMethod | null; occurredAt: string; note: string | null;
  expectedInvoiceLedgerVersion: number; expectedBranchLedgerVersion: number;
  idempotencyKey: string;
};

export type IssueBillingReceiptInput = {
  action: "issue_receipt"; invoiceId: string; paymentEntryId: string;
  receiptKey: string; expectedInvoiceLedgerVersion: number; idempotencyKey: string;
};

export type RunBillingReconciliationInput = {
  action: "run_reconciliation"; reconciliationDate: string;
  expectedBranchLedgerVersion: number; idempotencyKey: string;
};

export type BillingInvoiceReceipt = {
  organizationId: string; branchId: string; clientId: string; invoiceId: string;
  invoiceKey: string; invoiceNumber: string; invoiceVersion: number;
  invoiceLedgerVersion: number; branchLedgerVersion: number;
  invoiceTotal: string; balanceAfter: string; lineCount: number;
  paymentStatus: BillingInvoicePaymentStatus; committedAt: string;
  replayed: boolean; persisted: true; demo: false;
};

export type BillingEntryReceipt = {
  organizationId: string; branchId: string; clientId: string; invoiceId: string;
  entryId: string; entryKind: BillingTransactionKind; amount: string;
  signedAmount: string; balanceAfter: string; invoiceLedgerVersion: number;
  branchLedgerVersion: number; paymentStatus: BillingInvoicePaymentStatus;
  committedAt: string; replayed: boolean; persisted: true; demo: false;
};

export type BillingReceiptReceipt = {
  organizationId: string; branchId: string; clientId: string; invoiceId: string;
  paymentEntryId: string; receiptId: string; receiptKey: string;
  receiptNumber: string; amount: string; currency: string;
  documentStatus: "not_configured"; issuedAt: string;
  replayed: boolean; persisted: true; demo: false;
};

export type BillingReconciliationReceipt = {
  organizationId: string; branchId: string; reconciliationId: string;
  reconciliationDate: string; expectedBranchLedgerVersion: number;
  sourceEntryCount: number; invoiceTotal: string; paymentTotal: string;
  refundTotal: string; adjustmentDebitTotal: string; adjustmentCreditTotal: string;
  ledgerBalance: string; detailBalance: string; difference: string;
  reconciliationStatus: "matched" | "mismatch"; sourceHash: string;
  reconciledAt: string; replayed: boolean; persisted: true; demo: false;
};
