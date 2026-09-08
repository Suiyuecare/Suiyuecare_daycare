import { beforeEach, describe, expect, it, vi } from "vitest";
import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({ authorize: vi.fn(), reauth: vi.fn(), read: vi.fn(),
  client: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorize, requireRecentAal2: stubs.reauth, readJsonObject: stubs.read,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "49000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); }
    catch (error) { const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 }); }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { POST } from "./route";

const ORG = "49000000-0000-4000-8000-000000000001";
const BRANCH = "49000000-0000-4000-8000-000000000002";
const ACTOR = "49000000-0000-4000-8000-000000000003";
const BATCH = "49000000-0000-4000-8000-000000000004";
const KEY = "49000000-0000-4000-8000-000000000005";
const actor = { organizationId: ORG, branchId: BRANCH, userId: ACTOR,
  scopes: ["claims.manage"], assuranceLevel: "aal2", demo: false };
const body = { claim_batch_id: BATCH, expected_total_amount: "1200.10", expected_item_count: 2 };
const receipt = { organization_id: ORG, branch_id: BRANCH,
  idempotency_key: deterministicUuid(ORG, ACTOR, "claim-validate", KEY), request_hash: "a".repeat(64),
  claim_batch_id: BATCH, status: "validated", item_count: "2", total_amount: "1200.10", replayed: false };
function request() { return new Request("https://example.invalid/api/claims/validate", {
  method: "POST", headers: { "idempotency-key": KEY, "content-type": "application/json" }, body: "{}" }); }

describe("claim validation API exact database receipt", () => {
  beforeEach(() => { vi.resetAllMocks();
    stubs.authorize.mockResolvedValue(actor); stubs.reauth.mockResolvedValue(undefined);
    stubs.read.mockResolvedValue(body); stubs.client.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single });
    stubs.single.mockResolvedValue({ data: receipt, error: null });
  });
  it("returns a canonical bound receipt and no-store headers", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).data).toEqual({ claimBatchId: BATCH, idempotencyKey: KEY,
      status: "validated", itemCount: 2, totalAmount: "1200.10", replayed: false, persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith("validate_claim_batch_receipt", {
      p_expected_organization_id: ORG, p_expected_branch_id: BRANCH, p_claim_batch_id: BATCH,
      p_expected_total_amount: "1200.10", p_idempotency_key: deterministicUuid(ORG, ACTOR, "claim-validate", KEY),
      p_expected_item_count: 2,
    });
  });
  it("blocks stale MFA before reading the request or reaching the database", async () => {
    stubs.reauth.mockRejectedValue(Object.assign(new Error("reauth required"), { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(stubs.read).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects staff lacking claims.manage", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, scopes: [] });
    expect((await POST(request())).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
    expect(stubs.read).not.toHaveBeenCalled();
  });
  it("never calls persistence for a validated demo request", async () => {
    // Demo context intentionally has no production claim scopes and validates input only.
    stubs.authorize.mockResolvedValue({ ...actor, scopes: [], demo: true });
    const response = await POST(request());
    expect((await response.json()).data).toMatchObject({ claimBatchId: BATCH, idempotencyKey: KEY,
      itemCount: null, status: "draft", persisted: false, demo: true });
    expect(stubs.client).not.toHaveBeenCalled();
  });
  it.each([{ claim_batch_id: KEY }, { item_count: 0 }, { item_count: 3 }, { total_amount: "1200.11" },
    { status: "exported" }, { replayed: "yes" }, { extra: "SYNTH_PRIVATE_CONTENT" },
    { organization_id: BRANCH }, { branch_id: ORG }, { idempotency_key: KEY }])("fails closed on malformed database success %j", async (patch) => {
    stubs.single.mockResolvedValue({ data: { ...receipt, ...patch }, error: null });
    const response = await POST(request()); const result = await response.json();
    expect(response.status).toBe(502); expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_VALIDATION_RECEIPT_INVALID");
    expect(JSON.stringify(result)).not.toContain("SYNTH_PRIVATE_CONTENT");
  });
  it("does not claim no write occurred after a transport/database unknown failure", async () => {
    stubs.single.mockResolvedValue({ data: null, error: { code: "NETWORK", message: "SYNTH_SECRET_DETAIL" } });
    const response = await POST(request()); const result = await response.json();
    expect(result.errors[0].message).toContain("尚未確認");
    expect(JSON.stringify(result)).not.toMatch(/沒有部分凍結|SYNTH_SECRET_DETAIL/u);
  });
  it("rejects missing confirmed item count before constructing a database client", async () => {
    stubs.read.mockResolvedValue({ claim_batch_id: BATCH, expected_total_amount: "1200.10" });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(stubs.client).not.toHaveBeenCalled();
  });
  it("accepts the exact original replay result", async () => {
    stubs.single.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    expect((await (await POST(request())).json()).data.replayed).toBe(true);
  });
});
