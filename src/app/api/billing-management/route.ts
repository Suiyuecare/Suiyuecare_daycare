import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import { BILLING_ACTION_HEADER, BILLING_CREATE_MAX_BYTES, BILLING_MUTATION_MAX_BYTES,
  parseBillingEntryReceipt, parseBillingInvoiceReceipt, parseBillingReceiptReceipt,
  parseBillingReconciliationReceipt, parseCreateBillingInvoiceInput,
  parseIssueBillingReceiptInput, parseRecordBillingEntryInput,
  parseRunBillingReconciliationInput } from "@/lib/billing-management/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Action = "create_invoice" | "record_payment" | "record_refund"
  | "record_adjustment_debit" | "record_adjustment_credit"
  | "issue_receipt" | "run_reconciliation";
const ACTIONS: readonly Action[] = ["create_invoice", "record_payment", "record_refund",
  "record_adjustment_debit", "record_adjustment_credit", "issue_receipt", "run_reconciliation"];

function declaredAction(request: Request, allowed: readonly Action[]) {
  const action = request.headers.get(BILLING_ACTION_HEADER);
  if (!action || !ACTIONS.includes(action as Action) || !allowed.includes(action as Action))
    throw new IntegrationError("INVALID_BILLING_ACTION",
      "缺少或不支援的帳務管理操作標頭。", 400, BILLING_ACTION_HEADER);
  return action as Action;
}
function requiredPermission(action: Action) {
  if (["record_refund", "record_adjustment_debit", "record_adjustment_credit"].includes(action))
    return "billing.adjust" as const;
  if (action === "run_reconciliation") return "billing.reconcile" as const;
  return "billing.manage" as const;
}
async function authorize(action: Action): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
    "展示模式只顯示合成帳務，不會建立帳單、付款、退款、調整、收據或對帳。", 403);
  const permission = requiredPermission(action);
  if (!actor.scopes.includes("billing.read") || !actor.scopes.includes(permission))
    throw new IntegrationError("BILLING_NOT_AUTHORIZED", "目前角色沒有這項帳務操作權限。", 403);
  await requireRecentAal2(actor);
  return actor;
}
function billingFailure(code?: string) {
  if (code === "42501") return databaseFailure("BILLING_NOT_AUTHORIZED",
    "目前角色、機構、分支或工作階段不允許這項帳務操作。", 403);
  if (code === "55000") return databaseFailure("BILLING_RULES_NOT_CONFIGURED",
    "核准費目、費率、稅務處理或法定文件規則尚未完整配置，已停止操作。", 503);
  if (code === "40001") return databaseFailure("BILLING_VERSION_CONFLICT",
    "帳單或分支流水已改變，請重新載入後再操作。", 409);
  if (code === "23505") return databaseFailure("BILLING_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或已有相同帳務證據。", 409);
  if (["23514", "23503"].includes(code ?? "")) return databaseFailure(
    "BILLING_STATE_CONFLICT", "退款、調整、付款、收據或對帳狀態不允許此操作。", 409);
  if (["22023", "22P02", "22003"].includes(code ?? "")) return databaseFailure(
    "INVALID_BILLING_INPUT", "帳務日期、金額、費目、付款方式或版本未通過驗證。", 400);
  return databaseFailure("BILLING_RESULT_UNCERTAIN",
    "帳務操作結果尚未確認；請保留內容並使用相同操作鍵重試。", 409);
}
async function database() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式帳務資料服務尚未設定。", 503);
  return supabase;
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const action = declaredAction(request, ["create_invoice"]);
    const actor = await authorize(action);
    const input = parseCreateBillingInvoiceInput(
      await readJsonObject(request, BILLING_CREATE_MAX_BYTES), request.headers.get("idempotency-key"));
    const supabase = await database();
    const { data, error } = await supabase.rpc("create_billing_invoice", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_client_id: input.clientId,
      p_invoice_key: input.invoiceKey, p_period_start: input.periodStart,
      p_period_end: input.periodEnd, p_issued_on: input.issuedOn, p_due_on: input.dueOn,
      p_lines: input.lines.map((line) => ({ fee_item_version_id: line.feeItemVersionId,
        service_date: line.serviceDate, quantity: line.quantity,
        ...(line.lineNote ? { line_note: line.lineNote } : {}) })),
      p_expected_invoice_version: input.expectedInvoiceVersion,
      p_expected_branch_ledger_version: input.expectedBranchLedgerVersion,
      p_idempotency_key: deterministicUuid("page64-create-billing-invoice",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw billingFailure(error?.code);
    const receipt = parseBillingInvoiceReceipt(data, input, actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const action = declaredAction(request, ["record_payment", "record_refund",
      "record_adjustment_debit", "record_adjustment_credit", "issue_receipt", "run_reconciliation"]);
    const actor = await authorize(action);
    const body = await readJsonObject(request, BILLING_MUTATION_MAX_BYTES);
    const supabase = await database();
    if (action.startsWith("record_")) {
      const input = parseRecordBillingEntryInput(body, request.headers.get("idempotency-key"));
      if (`record_${input.entryKind}` !== action) throw new IntegrationError(
        "INVALID_BILLING_ACTION", "帳務操作標頭與內容不一致。", 400, "entry_kind");
      const { data, error } = await supabase.rpc("record_billing_entry", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId, p_invoice_id: input.invoiceId,
        p_entry_kind: input.entryKind, p_amount_text: input.amount,
        p_original_entry_id: input.originalEntryId,
        p_payment_method: input.paymentMethod, p_occurred_at: input.occurredAt,
        p_note: input.note,
        p_expected_invoice_ledger_version: input.expectedInvoiceLedgerVersion,
        p_expected_branch_ledger_version: input.expectedBranchLedgerVersion,
        p_idempotency_key: deterministicUuid("page64-record-billing-entry",
          actor.organizationId, actor.userId, input.idempotencyKey),
      }).maybeSingle();
      if (error || !data) throw billingFailure(error?.code);
      const receipt = parseBillingEntryReceipt(data, input, actor.organizationId, actor.branchId);
      return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
    }
    if (action === "issue_receipt") {
      const input = parseIssueBillingReceiptInput(body, request.headers.get("idempotency-key"));
      const { data, error } = await supabase.rpc("issue_billing_receipt", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId, p_invoice_id: input.invoiceId,
        p_payment_entry_id: input.paymentEntryId, p_receipt_key: input.receiptKey,
        p_expected_invoice_ledger_version: input.expectedInvoiceLedgerVersion,
        p_idempotency_key: deterministicUuid("page64-issue-billing-receipt",
          actor.organizationId, actor.userId, input.idempotencyKey),
      }).maybeSingle();
      if (error || !data) throw billingFailure(error?.code);
      const receipt = parseBillingReceiptReceipt(data, input, actor.organizationId, actor.branchId);
      return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
    }
    const input = parseRunBillingReconciliationInput(body, request.headers.get("idempotency-key"));
    const { data, error } = await supabase.rpc("run_billing_reconciliation", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_reconciliation_date: input.reconciliationDate,
      p_expected_branch_ledger_version: input.expectedBranchLedgerVersion,
      p_idempotency_key: deterministicUuid("page64-run-billing-reconciliation",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw billingFailure(error?.code);
    const receipt = parseBillingReconciliationReceipt(data, input, actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
