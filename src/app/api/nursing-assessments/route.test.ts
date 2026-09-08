import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
const stubs = vi.hoisted(() => ({ actor: vi.fn(), reauth: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.actor, requireRecentAal2: stubs.reauth,
  readJsonObject: async (request: Request) => request.json(),
  handleIntegrationRoute: async (operation: (id: string) => Promise<Response>) => {
    try { return await operation("51000000-0000-4000-8000-000000000099"); }
    catch (error) { const e = error as { code?: string; httpStatus?: number };
      return Response.json({ code: e.code }, { status: e.httpStatus ?? 500 }); }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { POST, PATCH } from "./route";
const id = "51000000-0000-4000-8000-000000000001";
const demo = buildDemoNursingAssessmentSnapshot(id, id);
const version = demo.clients[0]!.versions[0]!;
const actor = { organizationId: id, branchId: id, userId: version.recordedBy, roles: ["nurse"],
  scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"], demo: false };
const input = { action: "create_draft", clientId: id, content: version.content };
function request(body: unknown = input, operation = "create_draft") {
  return new Request("http://localhost/api/nursing-assessments", { method: operation === "create_draft" ? "POST" : "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": id, "x-nursing-operation": operation }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks(); stubs.actor.mockResolvedValue(actor); stubs.reauth.mockResolvedValue(undefined);
  stubs.client.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockResolvedValue({ data: { operationId: id, organizationId: id, branchId: id,
    actorUserId: actor.userId, idempotencyKey: id, request: input, result: version,
    replayed: false, persisted: true, demo: false }, error: null });
});
describe("nursing API", () => {
  it("saves exact actor-scoped manual draft and correlates receipt", async () => {
    const response = await POST(request()); expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_nursing_assessment", {
      p_expected_organization_id: id, p_expected_branch_id: id, p_request: input, p_idempotency_key: id });
    expect(stubs.reauth).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, demo: true }, { ...actor, roles: ["organization_manager"] },
    { ...actor, scopes: ["clients.read", "nursing_assessments.read"] }])("rejects demo, non-nurse or missing permission", async (value) => {
    stubs.actor.mockResolvedValue(value); expect((await POST(request())).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("sign runs recent AAL2 guard before any database operation", async () => {
    stubs.reauth.mockRejectedValue(Object.assign(new Error("reauth"), { httpStatus: 403 }));
    const sign = { action: "sign", clientId: id, assessmentKey: id, previousVersionId: id, expectedVersion: 1, expectedContentHash: "a".repeat(64) };
    expect((await PATCH(request(sign, "sign"))).status).toBe(403);
    expect(stubs.reauth).toHaveBeenCalledWith(actor); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects header mismatch and extra content", async () => {
    expect((await PATCH(request(input, "sign"))).status).toBe(400);
    expect((await POST(request({ ...input, totalScore: 10 }))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["40001", 409], ["23505", 409], ["22023", 400]])("maps database %s safely", async (code, status) => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code } });
    expect((await POST(request())).status).toBe(status);
  });
  it("does not acknowledge a wrong tenant receipt", async () => {
    const response = await stubs.rpc(); response.data.branchId = "51000000-0000-4000-8000-000000000099";
    stubs.rpc.mockResolvedValue(response); expect((await POST(request())).status).toBe(502);
  });
});
