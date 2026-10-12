import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/env", () => ({ isSyntheticReadMode: () => false }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest, readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "79900000-0000-4000-8000-000000000099";
    try { return await operation(requestId); }
    catch (error) {
      const value = error as { code?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: "bounded error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const organizationId = "79100000-0000-4000-8000-000000000001";
const branchId = "79200000-0000-4000-8000-000000000001";
const actorUserId = "79000000-0000-4000-8000-000000000001";
const idempotencyKey = "79800000-0000-4000-8000-000000000001";
const input = { itemCode: "WANHUA_01", expectedVersion: 0, ownerUserId: null,
  dueOn: null, evidenceReference: null, progress: "collecting", changeReason: "initial" };
const actor = { organizationId, branchId, userId: actorUserId,
  scopes: ["audit.view"], roles: ["branch_supervisor"], demo: false, assuranceLevel: "aal2" };
function request(header = idempotencyKey) {
  return new Request("https://example.invalid/api/evaluation-preparation/receipt", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": header }, body: "{}",
  });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return { operationId: "79900000-0000-4000-8000-000000000001", organizationId, branchId,
    actorUserId, idempotencyKey, replayed: true, formalSubmissionEnabled: false,
    result: { versionId: "79900000-0000-4000-8000-000000000002", itemCode: "WANHUA_01",
      version: 1, previousVersionId: null, ownerUserId: null, dueOn: null, evidenceReference: null,
      progress: "collecting", changeReason: "initial", recordedBy: actorUserId,
      recordedAt: "2026-10-08T10:00:00.000Z", contentHash: "a".repeat(64) }, ...overrides };
}

describe("Page 79 read-only receipt lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue({ request: input, idempotency_key: idempotencyKey });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data: receipt(), error: null });
  });
  it("denies a revoked role before reading the request", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: [] });
    expect((await POST(request())).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("looks up only the current actor's tenant and original request", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.receipt).toMatchObject({ organizationId, branchId, actorUserId, idempotencyKey });
    expect(stubs.rpc).toHaveBeenCalledWith("evaluation_preparation_receipt", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_request: input, p_idempotency_key: idempotencyKey,
    });
  });
  it("returns absence without claiming that a prior write failed", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ receipt: null });
  });
  it("rejects a mismatched key or receipt scope", async () => {
    expect((await POST(request("79800000-0000-4000-8000-000000000009"))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.rpc.mockResolvedValue({ data: receipt({ branchId: "79200000-0000-4000-8000-000000000009" }), error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it("does not expose a receipt when database authorization is revoked", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private data" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private data");
  });
});
