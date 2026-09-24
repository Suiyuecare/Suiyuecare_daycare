import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorizeCompletionActor: vi.fn(), canUseRoutineCompletion: vi.fn(), requireRecentAal2: vi.fn(), readJsonObject: vi.fn(), client: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/auth/routine-completion", () => mocks);
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/integrations/http", () => ({ ...mocks,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => { try { return await fn("a1111111-1111-4111-8111-111111111111"); } catch (error) { const e = error as { httpStatus?: number; code?: string }; return Response.json({ errors: [{ code: e.code }] }, { status: e.httpStatus ?? 500 }); } },
}));
import { POST } from "./route";
const id = "a1111111-1111-4111-8111-111111111111";
const actor = { organizationId: id, branchId: id, userId: id, scopes: ["clients.read", "clients.manage"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const body = { client_id: id, event_kind: "admit", effective_on: "2026-09-01", reason: "已確認文件與服務日", expected_row_version: 1 };
const request = () => new Request("http://localhost/api/clients/transitions", { method: "POST", headers: { "Idempotency-Key": id }, body: "{}" });
beforeEach(() => {
  vi.resetAllMocks(); mocks.authorizeCompletionActor.mockResolvedValue(actor); mocks.canUseRoutineCompletion.mockResolvedValue(true);
  mocks.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), { httpStatus: 403, code: "AAL2_REQUIRED" }));
  mocks.readJsonObject.mockResolvedValue(body); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ maybeSingle: mocks.single });
  mocks.single.mockResolvedValue({ data: { transition_id: id, client_id: id, from_status: "active", to_status: "active", resulting_row_version: 2, replayed: false }, error: null });
});
describe("formal admission independent routine policy", () => {
  it("allows scoped Google AAL1 admission with no recent MFA mutation", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(mocks.canUseRoutineCompletion).toHaveBeenCalledExactlyOnceWith(actor, "admission.create", id);
    expect(mocks.requireRecentAal2).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_expected_organization_id: id, p_expected_branch_id: id, p_client_id: id, p_event_kind: "admit", p_expected_row_version: 1 });
  });
  it.each(["suspend", "resume", "transfer", "close", "death"])("keeps recent AAL2 for %s even when routine grant would pass", async (event_kind) => {
    mocks.readJsonObject.mockResolvedValue({ ...body, event_kind, handoff_note: "已交接服務狀態" });
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.canUseRoutineCompletion).not.toHaveBeenCalled();
  });
  it("denies unapproved AAL1 before the mutation RPC", async () => {
    mocks.canUseRoutineCompletion.mockResolvedValue(false); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves the original recent AAL2 route for users without routine grants", async () => {
    mocks.canUseRoutineCompletion.mockResolvedValue(false); mocks.requireRecentAal2.mockResolvedValue(undefined);
    expect((await POST(request())).status).toBe(201);
  });
  it("rejects missing management permission before parsing client input", async () => {
    mocks.authorizeCompletionActor.mockResolvedValue({ ...actor, scopes: ["clients.read"] }); expect((await POST(request())).status).toBe(403);
    expect(mocks.readJsonObject).not.toHaveBeenCalled(); expect(mocks.canUseRoutineCompletion).not.toHaveBeenCalled();
  });
  it("returns database revocation denial even when the preflight passed", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "42501" } }); expect((await POST(request())).status).toBe(403);
  });
  it("preserves optimistic version conflicts", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "40001" } }); expect((await POST(request())).status).toBe(409);
  });
});
