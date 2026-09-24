import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { DiaryRecord } from "@/lib/care-diary/schema";
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
const actor: TenantContext = { userId: id, organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", displayName: "合成護理人員", roles: ["nurse"], demo: false, assuranceLevel: "aal2", recentAal2At: "2026-09-13T01:00:00Z", scopes: ["care_records.read", "care_records.write", "care_records.sign"] };
const nextId = "b0100000-0000-4000-8000-000000000002";
const fields: DiaryRecord["fields"] = { shift: "morning", care_item: "合成照顧", note: "合成觀察", abnormal: false };
function persistedRecord(status: DiaryRecord["status"]): DiaryRecord {
  return { id: nextId, record_key: id, version: 2, client_id: id, status, occurred_at: "2026-09-13T01:00:00Z", fields,
    previous_version_id: id, correction_source_id: null, correction_reason: null,
    signed_at: status === "signed" ? "2026-09-13T01:05:00Z" : null, signed_by: status === "signed" ? id : null,
    content_hash: status === "signed" ? "a".repeat(64) : null, created_at: "2026-09-13T01:05:00Z", created_by: id };
}
function request(body: unknown, key = id) { return new Request("https://example.invalid/api/records/record/actions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }); }
function post(body: unknown) { return POST(request(body), { params: Promise.resolve({ id }) }); }
describe("care diary lifecycle HTTP boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); stubs.authorize.mockResolvedValue(actor); stubs.client.mockResolvedValue({ rpc: stubs.rpc }); });
  it("rejects signing without an explicit confirmation", async () => { expect((await post({ action: "sign", base_version: 1 })).status).toBe(422); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("does not use write scope as signing authority", async () => { stubs.authorize.mockResolvedValue({ ...actor, scopes: ["care_records.read", "care_records.write"] }); const response = await post({ action: "sign", base_version: 2, confirmed: true }); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "DIARY_NOT_AUTHORIZED" }); expect(stubs.reauth).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("requires recent authentication for signatures, without fabricating it", async () => { stubs.reauth.mockRejectedValue(Object.assign(new Error("reauth"), { code: "RECENT_AAL2_REQUIRED", httpStatus: 403 })); const response = await post({ action: "sign", base_version: 2, confirmed: true }); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "RECENT_AAL2_REQUIRED" }); expect(stubs.reauth).toHaveBeenCalledExactlyOnceWith(actor); expect(stubs.client).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("does not report simulated signatures as real ones", async () => { stubs.authorize.mockResolvedValue({ ...actor, demo: true }); expect((await post({ action: "sign", base_version: 2, confirmed: true })).status).toBe(409); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it("uses trusted actor scope and returns structured version conflict", async () => { stubs.rpc.mockResolvedValue({ data: null, error: { code: "40001" } }); const response = await post({ action: "submit", base_version: 2 }); expect(response.status).toBe(409); expect(stubs.rpc).toHaveBeenCalledWith("mutate_care_diary", expect.objectContaining({ p_expected_organization_id: id, p_expected_branch_id: id, p_record_id: id, p_base_version: 2 })); });
  it("rejects empty 2xx database receipts", async () => { stubs.rpc.mockResolvedValue({ data: {}, error: null }); expect((await post({ action: "submit", base_version: 1 })).status).toBe(503); });
  it("rejects extra client scope and signed author fields", async () => { expect((await post({ action: "correct", base_version: 3, reason: "reason", signed_by: id, organization_id: id })).status).toBe(422); expect(stubs.rpc).not.toHaveBeenCalled(); });
  it.each(["edit", "submit"] as const)("opts in to routine permission and allows authorized AAL1 %s to reach the RPC", async (action) => {
    stubs.authorize.mockResolvedValue({ ...actor, assuranceLevel: "aal1", recentAal2At: null });
    stubs.rpc.mockResolvedValue({ data: { record: persistedRecord(action === "edit" ? "draft" : "submitted"), replayed: false }, error: null });
    const response = await post({ action, base_version: 1, ...(action === "edit" ? { data: fields } : {}) });
    expect(response.status).toBe(201);
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({ routinePermission: "care_records.write" });
    expect(stubs.reauth).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith("mutate_care_diary", expect.objectContaining({ p_action: action, p_expected_organization_id: id, p_expected_branch_id: id, p_fields: action === "edit" ? fields : null }));
    expect((await response.json()).data).toMatchObject({ demo: false, persisted: true, record: { status: action === "edit" ? "draft" : "submitted" } });
  });
  it.each(["sign", "reopen", "correct"] as const)("rejects AAL1 %s before recent-auth and database calls", async (action) => {
    stubs.authorize.mockResolvedValue({ ...actor, assuranceLevel: "aal1", recentAal2At: null });
    const response = await post({ action, base_version: 1, ...(action === "sign" ? { confirmed: true } : { reason: "合成修訂原因" }) });
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "AAL2_REQUIRED" });
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({ routinePermission: "care_records.write" });
    expect(stubs.reauth).not.toHaveBeenCalled(); expect(stubs.client).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("an authorized AAL2 signature reaches RPC only after the recent-auth guard", async () => {
    stubs.rpc.mockImplementation(async () => {
      expect(stubs.reauth).toHaveBeenCalledExactlyOnceWith(actor);
      return { data: { record: persistedRecord("signed"), replayed: false }, error: null };
    });
    const response = await post({ action: "sign", base_version: 1, confirmed: true });
    expect(response.status).toBe(201);
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({ routinePermission: "care_records.write" });
    expect(stubs.reauth).toHaveBeenCalledExactlyOnceWith(actor);
    expect(stubs.rpc).toHaveBeenCalledOnce();
  });
});
