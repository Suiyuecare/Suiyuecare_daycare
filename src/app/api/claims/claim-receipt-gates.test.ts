import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorize: vi.fn(),
  reauth: vi.fn(),
  read: vi.fn(),
  client: vi.fn(),
  rpc: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorize,
  requireRecentAal2: stubs.reauth,
  readJsonObject: stubs.read,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "49000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); }
    catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));

import { POST as exportClaim } from "./export/route";
import { POST as reconcileClaim } from "./reconcile/route";

const ORG = "49000000-0000-4000-8000-000000000001";
const BRANCH = "49000000-0000-4000-8000-000000000002";
const ACTOR = "49000000-0000-4000-8000-000000000003";
const BATCH = "49000000-0000-4000-8000-000000000004";
const KEY = "claim-gate-20261008";
const ITEM_A = "49000000-0000-4000-8000-000000000011";
const ITEM_B = "49000000-0000-4000-8000-000000000012";
const actor = { organizationId: ORG, branchId: BRANCH, userId: ACTOR,
  scopes: ["claims.manage", "claims.export"], assuranceLevel: "aal2", demo: false };
const exportInput = { claim_batch_id: BATCH, expected_total_amount: "120.30" };
const reconcileInput = { ...exportInput, results: [
  { claim_item_id: ITEM_A, outcome: "accepted", response_code: "A000" },
  { claim_item_id: ITEM_B, outcome: "rejected", response_code: "R001" },
] };
const exportReceipt = { claim_batch_id: BATCH, format_version: "taipei-official-115",
  status: "exported", snapshot_hash: "a".repeat(64), item_count: "2",
  total_amount: "120.30", replayed: false };
const reconciliationReceipt = { claim_batch_id: BATCH, status: "reconciled",
  item_count: "2", accepted_count: "1", rejected_count: "1",
  total_amount: "120.30", replayed: false };

function request(action: "export" | "reconcile") {
  return new Request(`https://example.invalid/api/claims/${action}`, {
    method: "POST",
    headers: { "idempotency-key": KEY, "content-type": "application/json" },
    body: "{}",
  });
}

describe("claim receipts remain internal until a governed official source exists", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubs.authorize.mockResolvedValue(actor);
    stubs.reauth.mockResolvedValue(undefined);
    stubs.client.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single });
  });

  it("never treats an official-looking free-text version as an approved filing format", async () => {
    stubs.read.mockResolvedValue(exportInput);
    stubs.single.mockResolvedValue({ data: exportReceipt, error: null });
    const response = await exportClaim(request("export"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(result.data).toMatchObject({ claimBatchId: BATCH, status: "exported",
      itemCount: 2, totalAmount: "120.30", officialSubmissionReady: false,
      officialFormatStatus: "not_configured" });
  });

  it.each([
    { claim_batch_id: ITEM_A },
    { snapshot_hash: "short" },
    { item_count: "0" },
    { item_count: "5001" },
    { total_amount: "120.31" },
    { status: "submitted" },
    { extra: "SYNTH_SECRET_CONTENT" },
  ])("fails closed on inconsistent export database success %j", async (patch) => {
    stubs.read.mockResolvedValue(exportInput);
    stubs.single.mockResolvedValue({ data: { ...exportReceipt, ...patch }, error: null });
    const response = await exportClaim(request("export"));
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_EXPORT_RECEIPT_INVALID");
    expect(JSON.stringify(result)).not.toContain("SYNTH_SECRET_CONTENT");
  });

  it("does not accept a caller's claim that the format was officially approved", async () => {
    stubs.read.mockResolvedValue({ ...exportInput, official_format_approved: true });
    const response = await exportClaim(request("export"));
    expect(response.status).toBe(400);
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 and export scope before reading or writing a batch", async () => {
    stubs.reauth.mockRejectedValueOnce(Object.assign(new Error("reauth required"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await exportClaim(request("export"))).status).toBe(403);
    expect(stubs.read).not.toHaveBeenCalled();
    expect(stubs.client).not.toHaveBeenCalled();

    stubs.authorize.mockResolvedValueOnce({ ...actor, scopes: ["claims.manage"] });
    stubs.read.mockResolvedValue(exportInput);
    expect((await exportClaim(request("export"))).status).toBe(403);
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("labels JSON results as unverified operator input, not an official response file", async () => {
    stubs.read.mockResolvedValue(reconcileInput);
    stubs.single.mockResolvedValue({ data: reconciliationReceipt, error: null });
    const response = await reconcileClaim(request("reconcile"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data).toMatchObject({ claimBatchId: BATCH, status: "reconciled",
      itemCount: 2, acceptedCount: 1, rejectedCount: 1,
      officialSubmissionReady: false, officialFormatStatus: "not_configured",
      officialResponseVerified: false, responseSourceStatus: "operator_supplied_unverified" });
  });

  it("does not reconcile without the designated claim-management scope", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, scopes: ["claims.export"] });
    stubs.read.mockResolvedValue(reconcileInput);
    expect((await reconcileClaim(request("reconcile"))).status).toBe(403);
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it.each([
    { claim_batch_id: ITEM_A },
    { item_count: "3" },
    { accepted_count: "2" },
    { total_amount: "120.31" },
    { status: "accepted" },
    { extra: "SYNTH_SECRET_CONTENT" },
  ])("fails closed on inconsistent reconciliation database success %j", async (patch) => {
    stubs.read.mockResolvedValue(reconcileInput);
    stubs.single.mockResolvedValue({ data: { ...reconciliationReceipt, ...patch }, error: null });
    const response = await reconcileClaim(request("reconcile"));
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_RECONCILIATION_RECEIPT_INVALID");
    expect(JSON.stringify(result)).not.toContain("SYNTH_SECRET_CONTENT");
  });

  it("keeps demo requests non-persistent and equally non-official", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, demo: true, scopes: [] });
    stubs.read.mockResolvedValue(exportInput);
    const response = await exportClaim(request("export"));
    expect((await response.json()).data).toMatchObject({ persisted: false,
      officialSubmissionReady: false, officialFormatStatus: "not_configured" });
    expect(stubs.client).not.toHaveBeenCalled();
  });
});
