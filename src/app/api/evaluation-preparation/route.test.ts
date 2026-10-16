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

const org = "79100000-0000-4000-8000-000000000001";
const branch = "79200000-0000-4000-8000-000000000001";
const user = "79000000-0000-4000-8000-000000000001";
const key = "79800000-0000-4000-8000-000000000001";
const input = { itemCode: "WANHUA_01", expectedVersion: 0, ownerUserId: null,
  dueOn: null, evidenceReference: null, progress: "collecting", changeReason: "initial", idempotency_key: key };
const actor = { organizationId: org, branchId: branch, userId: user,
  scopes: ["audit.view"], roles: ["branch_supervisor"], demo: false, assuranceLevel: "aal2" };
function request(header = key) {
  return new Request("https://example.invalid/api/evaluation-preparation", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": header }, body: "{}",
  });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return { operationId: "79900000-0000-4000-8000-000000000001",
    organizationId: org, branchId: branch, actorUserId: user, idempotencyKey: key,
    replayed: false, formalSubmissionEnabled: false,
    result: { versionId: "79900000-0000-4000-8000-000000000002", itemCode: "WANHUA_01",
      version: 1, previousVersionId: null, ownerUserId: null, dueOn: null, evidenceReference: null,
      progress: "collecting", changeReason: "initial", recordedBy: user,
      recordedAt: "2026-10-08T10:00:00.000Z", contentHash: "a".repeat(64) }, ...overrides };
}

describe("Page 79 write API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(input);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data: receipt(), error: null });
  });
  it.each([
    ["staff", { ...actor, roles: ["care_worker"] }],
    ["no audit", { ...actor, scopes: [] }],
    ["demo", { ...actor, demo: true }],
  ])("denies %s before parsing", async (_label, denied) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects a different header/body operation key", async () => {
    const response = await POST(request("79800000-0000-4000-8000-000000000009"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("binds scope to the actor and accepts an exact immutable receipt", async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ organizationId: org, branchId: branch, actorUserId: user,
      idempotencyKey: key, formalSubmissionEnabled: false });
    expect(stubs.rpc).toHaveBeenCalledWith("evaluation_preparation_mutate", {
      p_expected_organization_id: org, p_expected_branch_id: branch,
      p_request: { itemCode: "WANHUA_01", expectedVersion: 0, ownerUserId: null,
        dueOn: null, evidenceReference: null, progress: "collecting", changeReason: "initial" },
      p_idempotency_key: key,
    });
  });
  it("rejects a cross-branch or overclaiming database receipt", async () => {
    stubs.rpc.mockResolvedValue({ data: receipt({ branchId: "79200000-0000-4000-8000-000000000009" }), error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("EVALUATION_PREPARATION_RESULT_UNCERTAIN");
    stubs.rpc.mockResolvedValue({ data: receipt({ formalSubmissionEnabled: true }), error: null });
    expect((await POST(request())).status).toBe(409);
  });
  it("maps explicit authorization denial without leaking database details", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private details" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private details");
  });
});
