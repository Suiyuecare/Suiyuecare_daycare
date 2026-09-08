import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoDataInventorySnapshot } from "@/lib/data-inventory/demo";
import { emptyDataInventoryContent } from "@/lib/data-inventory/types";
const stubs = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), reauth: vi.fn(), client: vi.fn(), rpc: vi.fn(), synthetic: vi.fn() }));
vi.mock("@/lib/env", () => ({ isSyntheticReadMode: stubs.synthetic }));
vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: stubs.auth, readJsonObject: stubs.read, requireRecentAal2: stubs.reauth,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => {
    try { return await fn("83000000-0000-4000-8000-000000000001"); } catch (error) {
      const value = error as { httpStatus?: number; code?: string };
      return Response.json({ status: "error", data: null, errors: [{ code: value.code }] }, { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { POST } from "./route";
const id = "83000000-0000-4000-8000-000000000001";
const actor = { organizationId: id, branchId: id, userId: id, demo: false, roles: ["branch_supervisor"], scopes: ["audit.view"] };
const mutation = { action: "save", itemKey: "client_master", expectedVersion: 0, content: emptyDataInventoryContent() };
const result = { ...buildDemoDataInventorySnapshot(id, id).records[0].current, content: mutation.content, recordedBy: id, contentRecordedBy: id };
const receipt = { operationId: id, organizationId: id, branchId: id, actorUserId: id, idempotencyKey: id, request: mutation, result, replayed: false };
const request = () => new Request("https://example.invalid/api/data-inventory", { method: "POST", headers: { "idempotency-key": id }, body: "{}" });
beforeEach(() => { vi.resetAllMocks(); stubs.synthetic.mockReturnValue(false); stubs.auth.mockResolvedValue(actor);
  stubs.read.mockResolvedValue({ ...mutation, idempotency_key: id }); stubs.client.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockResolvedValue({ data: receipt, error: null }); });
describe("inventory route boundary", () => {
  it("denies synthetic mode before auth, body reads and database", async () => {
    stubs.synthetic.mockReturnValue(true); expect((await POST(request())).status).toBe(403);
    expect(stubs.auth).not.toHaveBeenCalled(); expect(stubs.read).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, demo: true }, { ...actor, scopes: [] }, { ...actor, roles: ["finance_claims"] }])("denies demo or authority before parsing", async (denied) => {
    stubs.auth.mockResolvedValue(denied); expect((await POST(request())).status).toBe(403); expect(stubs.read).not.toHaveBeenCalled();
  });
  it("rejects absent body idempotency key before RPC", async () => {
    stubs.read.mockResolvedValue(mutation); expect((await POST(request())).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("requires recent AAL2 for review", async () => {
    stubs.read.mockResolvedValue({ action: "verify", itemKey: "client_master", expectedVersion: 1, expectedVersionId: id, expectedContentHash: "a".repeat(64), idempotency_key: id });
    stubs.reauth.mockRejectedValue(Object.assign(new Error("not recent"), { httpStatus: 403 }));
    expect((await POST(request())).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("only accepts payload-bound scoped receipt", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_data_inventory", { p_expected_organization_id: id, p_expected_branch_id: id, p_request: mutation, p_idempotency_key: id });
    stubs.rpc.mockResolvedValue({ data: { ...receipt, result: { ...result, content: { ...result.content, actualCount: 99 } } }, error: null });
    expect((await POST(request())).status).toBe(502);
  });
  it.each([["40001", 409], ["23505", 409], ["23514", 400], ["42501", 403], ["XX000", 409]])("maps SQL %s without internal detail", async (code, status) => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code, message: "secret-token-raw-PII" } });
    const response = await POST(request()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("secret-token");
  });
  it("fails closed without configured service", async () => { stubs.client.mockResolvedValue(null); expect((await POST(request())).status).toBe(503); });
});
