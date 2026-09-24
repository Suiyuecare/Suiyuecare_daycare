import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), routine: vi.fn(), read: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: mocks.routine }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/integrations/http", () => ({ readJsonObject: mocks.read, handleIntegrationRoute: async (op: (id: string) => Promise<Response>) => { try { return await op("aa010000-0000-4000-8000-000000000010"); } catch (cause) { const e = cause as { code?: string; message?: string; httpStatus?: number }; return Response.json({ errors: [{ code: e.code, message: e.message }] }, { status: e.httpStatus ?? 500 }); } } }));
import { POST } from "./route";
const org = "aa010000-0000-4000-8000-000000000001", branch = "aa010000-0000-4000-8000-000000000002", client = "aa010000-0000-4000-8000-000000000003", id = "aa010000-0000-4000-8000-000000000004", key = "aa010000-0000-4000-8000-000000000005";
const actor = { organizationId: org, branchId: branch, assuranceLevel: "aal1", demo: false };
const payload = { clientId: client, draftId: id, contentHash: "a".repeat(64), expectedSequence: 0, action: "submit", reason: "合成行政送審", checklist: {}, idempotency_key: key };
const receipt = { eventId: key, draftId: id, state: "submitted", sequence: 1, idempotencyKey: key, replayed: false, isElectronicSignature: false };
const request = () => new Request("https://example.invalid/api/taipei-abcd/workflow", { method: "POST", headers: { "idempotency-key": key }, body: "{}" });
describe("Taipei administrative workflow API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.routine.mockResolvedValue(actor); mocks.read.mockResolvedValue(payload); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
  it("denies anonymous before reading input and distinguishes demo", async () => { mocks.actor.mockResolvedValue(null); const r = await POST(request()); expect(r.status).toBe(401); expect((await r.json()).errors[0].code).toBe("AUTH_REQUIRED"); expect(mocks.read).not.toHaveBeenCalled(); mocks.actor.mockResolvedValue({ ...actor, demo: true }); expect((await POST(request())).status).toBe(403); });
  it.each([["submit", "abcd.submit", "submitted"], ["approve", "abcd.review", "approved"], ["return", "abcd.review", "returned"], ["correct", "abcd.save", "draft"]])("uses scoped real AAL1 action %s", async (action, authorization, state) => {
    mocks.read.mockResolvedValue({ ...payload, action }); mocks.rpc.mockResolvedValue({ data: { ...receipt, state, draftId: action === "correct" ? branch : id }, error: null });
    const r = await POST(request()); expect(r.status).toBe(201); expect(mocks.routine).toHaveBeenCalledWith(authorization, client); expect(mocks.rpc.mock.calls[0][1].p_expected_organization_id).toBe(org);
  });
  it("preserves legacy actual AAL2 without manufacturing assurance", async () => { mocks.actor.mockResolvedValue({ ...actor, assuranceLevel: "aal2" }); expect((await POST(request())).status).toBe(201); expect(mocks.routine).not.toHaveBeenCalled(); });
  it("rejects signature keys and mismatched idempotency headers", async () => { mocks.read.mockResolvedValue({ ...payload, signed: true }); expect((await POST(request())).status).toBe(400); mocks.read.mockResolvedValue({ ...payload, idempotency_key: id }); expect((await POST(request())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each([{ draftId: org }, { sequence: 2 }, { state: "approved" }, { isElectronicSignature: true }, { idempotencyKey: id }])("rejects inconsistent persisted receipt %j", async delta => { mocks.rpc.mockResolvedValue({ data: { ...receipt, ...delta }, error: null }); expect((await POST(request())).status).toBe(502); });
  it.each([["42501", 403], ["22023", 400], ["40001", 409]])("does not reveal SQL details for %s", async (code, status) => { mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE_RECORD" } }); const r = await POST(request()); expect(r.status).toBe(status); expect(await r.text()).not.toContain("PRIVATE_RECORD"); });
});
