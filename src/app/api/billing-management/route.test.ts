import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(),
  maybeSingle: vi.fn(), deterministicUuid: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "64990000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/integrations/security", () => ({
  deterministicUuid: stubs.deterministicUuid,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "64010000-0000-4000-8000-000000000001";
const branchId = "64020000-0000-4000-8000-000000000001";
const userId = "64030000-0000-4000-8000-000000000001";
const key = "64040000-0000-4000-8000-000000000001";
const clientId = "64050000-0000-4000-8000-000000000001";
const invoiceId = "64060000-0000-4000-8000-000000000001";
const invoiceKey = "64070000-0000-4000-8000-000000000001";
const feeId = "64080000-0000-4000-8000-000000000001";
const entryId = "64090000-0000-4000-8000-000000000001";
const receiptId = "64100000-0000-4000-8000-000000000001";
const actor = { organizationId, organizationName: "合成機構", branchId,
  branchName: "合成分支", userId, displayName: "合成財務人員",
  roles: ["finance_claims"], scopes: ["billing.read", "billing.manage",
    "billing.adjust", "billing.reconcile"], assuranceLevel: "aal2",
  recentAal2At: "2026-09-07T08:00:00Z", demo: false };
const createBody = { action: "create_invoice", client_id: clientId,
  invoice_key: invoiceKey, period_start: "2026-08-01", period_end: "2026-08-31",
  issued_on: "2026-09-01", due_on: "2026-09-15",
  lines: [{ fee_item_version_id: feeId, service_date: "2026-08-15",
    quantity: "2.0000", line_note: null }], expected_invoice_version: 0,
  expected_branch_ledger_version: 6 };
const invoiceReceipt = { organization_id: organizationId, branch_id: branchId,
  client_id: clientId, invoice_id: invoiceId, invoice_key: invoiceKey,
  invoice_number: "SYS-BILL-640000000001", invoice_version: 1,
  invoice_ledger_version: 1, branch_ledger_version: 7, invoice_total: "200.00",
  balance_after: "200.00", line_count: 1, payment_status: "unpaid",
  committed_at: "2026-09-07T08:00:00Z", replayed: false };

function request(method: "POST" | "PATCH", action?: string) {
  return new Request("https://example.invalid/api/billing-management", { method, body: "{}",
    headers: { "content-type": "application/json", "idempotency-key": key,
      ...(action ? { "x-billing-management-action": action } : {}) } });
}

describe("Page 64 billing-management API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.deterministicUuid.mockReturnValue(key);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: invoiceReceipt, error: null });
  });

  it("requires the action header before authority and body parsing", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["billing.read"] }, "BILLING_NOT_AUTHORIZED"],
  ])("rejects denied writes before reading financial content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST", "create_invoice"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before reading financial content", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request("POST", "create_invoice"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds approved fee lines, tenant, branch, versions and actor-scoped idempotency", async () => {
    const response = await POST(request("POST", "create_invoice"));
    expect(response.status).toBe(201);
    expect(stubs.deterministicUuid).toHaveBeenCalledWith(
      "page64-create-billing-invoice", organizationId, userId, key);
    expect(stubs.rpc).toHaveBeenCalledWith("create_billing_invoice", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_client_id: clientId, p_invoice_key: invoiceKey,
      p_period_start: "2026-08-01", p_period_end: "2026-08-31",
      p_issued_on: "2026-09-01", p_due_on: "2026-09-15",
      p_lines: [{ fee_item_version_id: feeId, service_date: "2026-08-15",
        quantity: "2.0000" }], p_expected_invoice_version: 0,
      p_expected_branch_ledger_version: 6, p_idempotency_key: key,
    });
    expect((await response.json()).data.receipt).toMatchObject({
      invoiceId, invoiceTotal: "200.00", persisted: true, demo: false,
    });
  });

  it("rejects online or unknown payment methods before touching the database", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "record_entry", invoice_id: invoiceId,
      entry_kind: "payment", amount: "100.00", original_entry_id: null,
      payment_method: "credit_card", occurred_at: "2026-09-07T08:00:00+08:00",
      note: null, expected_invoice_ledger_version: 1, expected_branch_ledger_version: 7 });
    const response = await PATCH(request("PATCH", "record_payment"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects a header and entry-kind mismatch", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "record_entry", invoice_id: invoiceId,
      entry_kind: "payment", amount: "100.00", original_entry_id: null,
      payment_method: "cash", occurred_at: "2026-09-07T08:00:00+08:00",
      note: null, expected_invoice_ledger_version: 1, expected_branch_ledger_version: 7 });
    const response = await PATCH(request("PATCH", "record_refund"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("records an offline payment with exact amount and both expected versions", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "record_entry", invoice_id: invoiceId,
      entry_kind: "payment", amount: "100.00", original_entry_id: null,
      payment_method: "bank_transfer", occurred_at: "2026-09-07T08:00:00+08:00",
      note: null, expected_invoice_ledger_version: 1, expected_branch_ledger_version: 7 });
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: organizationId,
      branch_id: branchId, client_id: clientId, invoice_id: invoiceId,
      entry_id: entryId, entry_kind: "payment", amount: "100.00",
      signed_amount: "-100.00", balance_after: "100.00", invoice_ledger_version: 2,
      branch_ledger_version: 8, payment_status: "partial",
      committed_at: "2026-09-07T08:00:00Z", replayed: false }, error: null });
    const response = await PATCH(request("PATCH", "record_payment"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("record_billing_entry",
      expect.objectContaining({ p_entry_kind: "payment", p_amount_text: "100.00",
        p_payment_method: "bank_transfer", p_expected_invoice_ledger_version: 1,
        p_expected_branch_ledger_version: 7, p_idempotency_key: key }));
  });

  it("requires adjustment permission before reading refund details", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: actor.scopes.filter((scope) => scope !== "billing.adjust") });
    const response = await PATCH(request("PATCH", "record_refund"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("issues only an internal non-tax receipt record for a known payment", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "issue_receipt", invoice_id: invoiceId,
      payment_entry_id: entryId, receipt_key: key, expected_invoice_ledger_version: 2 });
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: organizationId,
      branch_id: branchId, client_id: clientId, invoice_id: invoiceId,
      payment_entry_id: entryId, receipt_id: receiptId, receipt_key: key,
      receipt_number: "SYS-REC-640000000001", amount: "100.00", currency: "TWD",
      document_status: "not_configured", issued_at: "2026-09-07T08:00:00Z",
      replayed: false }, error: null });
    const response = await PATCH(request("PATCH", "issue_receipt"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      documentStatus: "not_configured", paymentEntryId: entryId,
    });
  });

  it("runs daily detail-to-ledger reconciliation at an exact branch version", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "run_reconciliation",
      reconciliation_date: "2026-09-07", expected_branch_ledger_version: 7 });
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: organizationId,
      branch_id: branchId, reconciliation_id: receiptId,
      reconciliation_date: "2026-09-07", expected_branch_ledger_version: 7,
      source_entry_count: 7, invoice_total: "200.00", payment_total: "100.00",
      refund_total: "0.00", adjustment_debit_total: "0.00",
      adjustment_credit_total: "0.00", ledger_balance: "100.00",
      detail_balance: "100.00", difference: "0.00", reconciliation_status: "matched",
      source_hash: "a".repeat(64), reconciled_at: "2026-09-07T08:00:00Z",
      replayed: true }, error: null });
    const response = await PATCH(request("PATCH", "run_reconciliation"));
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("run_billing_reconciliation",
      expect.objectContaining({ p_reconciliation_date: "2026-09-07",
        p_expected_branch_ledger_version: 7, p_idempotency_key: key }));
  });

  it.each([
    ["42501", 403, "BILLING_NOT_AUTHORIZED"],
    ["55000", 503, "BILLING_RULES_NOT_CONFIGURED"],
    ["40001", 409, "BILLING_VERSION_CONFLICT"],
    ["23505", 409, "BILLING_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "BILLING_STATE_CONFLICT"],
    ["22023", 400, "INVALID_BILLING_INPUT"],
    ["XX000", 409, "BILLING_RESULT_UNCERTAIN"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST", "create_invoice"));
    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });
});
