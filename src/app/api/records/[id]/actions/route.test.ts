import { beforeEach, describe, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ authorize: vi.fn(), reauth: vi.fn(), rpc: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorize, requireRecentAal2: stubs.reauth,
  readJsonObject: (request: Request) => request.json(),
  databaseFailure: (code: string, message: string, httpStatus: number) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (run: (id: string) => Promise<Response>) => {
    try { return await run("synthetic-request"); } catch (error) { const value = error as { code: string; httpStatus: number }; return Response.json({ error: value.code }, { status: value.httpStatus ?? 500 }); }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { POST } from "./route";
const id = "b0100000-0000-4000-8000-000000000001";
const actor = { userId: id, organizationId: id, branchId: id, demo: false, scopes: ["care_records.read", "care_records.write", "care_records.sign"] };
function request(body: unknown, key = id) { return new Request("https://example.invalid/api/records/record/actions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }); }
function post(body: unknown) { return POST(request(body), { params: Promise.resolve({ id }) }); }
describe("care diary lifecycle HTTP boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); stubs.authorize.mockResolvedValue(actor); stubs.client.mockResolvedValue({ rpc: stubs.rpc }); });
  it("rejects signing without an explicit confirmation", async () => { expect((await post({ action: "sign", base_version: 1 })).status).toBe(422); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("does not use write scope as signing authority", async () => { stubs.authorize.mockResolvedValue({ ...actor, scopes: ["care_records.read", "care_records.write"] }); expect((await post({ action: "sign", base_version: 2, confirmed: true })).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("requires recent authentication for signatures, without fabricating it", async () => { stubs.reauth.mockRejectedValue(Object.assign(new Error("reauth"), { httpStatus: 403 })); expect((await post({ action: "sign", base_version: 2, confirmed: true })).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("does not report simulated signatures as real ones", async () => { stubs.authorize.mockResolvedValue({ ...actor, demo: true }); expect((await post({ action: "sign", base_version: 2, confirmed: true })).status).toBe(409); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("uses trusted actor scope and returns structured version conflict", async () => { stubs.rpc.mockResolvedValue({ data: null, error: { code: "40001" } }); const response = await post({ action: "submit", base_version: 2 }); expect(response.status).toBe(409); expect(stubs.rpc).toHaveBeenCalledWith("mutate_care_diary", expect.objectContaining({ p_expected_organization_id: id, p_expected_branch_id: id, p_record_id: id, p_base_version: 2 })); });
  it("rejects empty 2xx database receipts", async () => { stubs.rpc.mockResolvedValue({ data: {}, error: null }); expect((await post({ action: "submit", base_version: 1 })).status).toBe(503); });
  it("rejects extra client scope and signed author fields", async () => { expect((await post({ action: "correct", base_version: 3, reason: "reason", signed_by: id, organization_id: id })).status).toBe(422); expect(stubs.rpc).not.toHaveBeenCalled(); });
});
