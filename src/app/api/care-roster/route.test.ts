import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(), readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({ ...mocks,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => { try { return await fn("a1111111-1111-4111-8111-111111111111"); } catch (error) { const e = error as { httpStatus?: number; code?: string }; return Response.json({ status: "error", errors: [{ code: e.code }] }, { status: e.httpStatus ?? 500 }); } },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
import { POST } from "./route";
const id = "a1111111-1111-4111-8111-111111111111";
const input = { clientId: id, serviceDate: "2026-09-12", shift: "morning", staffUserId: null, expectedVersion: 0, state: "scheduled", sourceNote: "已確認照顧計畫", tasks: ["temperature"], approved: true, idempotency_key: id };
const actor = { organizationId: id, branchId: id, userId: id, scopes: ["staff_scheduling.manage", "clients.view_all", "clients.read"], demo: false };
const receipt = { id, clientId: id, serviceDate: input.serviceDate, shift: "morning", version: 1, replayed: false };
const request = (action = "approve_assignment") => new Request("http://localhost/api/care-roster", { method: "POST", headers: { "x-care-roster-action": action }, body: "{}" });
describe("daily roster guarded write", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authorizeStaffRequest.mockResolvedValue(actor); mocks.requireRecentAal2.mockResolvedValue(undefined); mocks.readJsonObject.mockResolvedValue(input); mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ maybeSingle: mocks.maybeSingle }); mocks.maybeSingle.mockResolvedValue({ data: { receipt }, error: null }); });
  it("requires action header before reading sensitive body", async () => { expect((await POST(request(""))).status).toBe(400); expect(mocks.readJsonObject).not.toHaveBeenCalled(); });
  it("denies care worker allocating peers before content parse", async () => { mocks.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: ["clients.read"] }); expect((await POST(request())).status).toBe(403); expect(mocks.readJsonObject).not.toHaveBeenCalled(); });
  it("does not write from demo", async () => { mocks.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true }); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("verifies scoped receipt before success", async () => { const res = await POST(request()); expect(res.status).toBe(201); expect(res.headers.get("Cache-Control")).toContain("no-store"); expect((await res.json()).data.persisted).toBe(true); expect(mocks.requireRecentAal2).toHaveBeenCalledWith(actor); });
  it("keeps replay success nonduplicate", async () => { mocks.maybeSingle.mockResolvedValue({ data: { receipt: { ...receipt, replayed: true } }, error: null }); expect((await POST(request())).status).toBe(200); });
  it.each([{ shift: "afternoon" }, { clientId: "b1111111-1111-4111-8111-111111111111" }, { version: 5 }])("rejects mismatched receipt %j", async (change) => { mocks.maybeSingle.mockResolvedValue({ data: { receipt: { ...receipt, ...change } }, error: null }); expect((await POST(request())).status).toBe(409); });
  it("does not leak database error text", async () => { mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "sensitive value" } }); const res = await POST(request()); expect(res.status).toBe(403); expect(await res.text()).not.toContain("sensitive value"); });
});
