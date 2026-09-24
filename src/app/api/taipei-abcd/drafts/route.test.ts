import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAIPEI_ABCD_TEMPLATE } from "@/lib/taipei-abcd/catalog";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: mocks.authorize, readJsonObject: mocks.read,
  databaseFailure: (code: string, message: string, httpStatus: number) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (op: (id: string) => Promise<Response>) => { try { return await op("aa010000-0000-4000-8000-000000000010"); } catch (error) {
    const e = error as { code?: string; message?: string; httpStatus?: number }; return Response.json({ errors: [{ code: e.code ?? "UNKNOWN", message: e.message }] }, { status: e.httpStatus ?? 500 }); } },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.authorize }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: mocks.authorize }));
import { GET, POST } from "./route";
const organizationId = "aa010000-0000-4000-8000-000000000001";
const branchId = "aa010000-0000-4000-8000-000000000002";
const clientId = "aa010000-0000-4000-8000-000000000003";
const key = "aa010000-0000-4000-8000-000000000004";
const actor = { organizationId, branchId, scopes: ["clients.read", "clients.demographics.read", "abcd_assessments.read", "abcd_assessments.manage"], demo: false };
const payload = { client_id: clientId, form: "A", usage_year: 115, month: 0, template_key: TAIPEI_ABCD_TEMPLATE.key,
  source_revision: "114.11", source_sha256: TAIPEI_ABCD_TEMPLATE.sourceSha256, expected_version: 0, expected_content_hash: null,
  answers: { "A1.name": { state: "recorded", value: "合成姓名", reason: null } }, idempotency_key: key };
const draft = { id: key, organizationId, branchId, clientId, form: "A", usageYear: 115, month: 0, version: 1,
  previousVersionId: null, contentHash: "a".repeat(64), answers: payload.answers, sourceSnapshot: null, createdAt: "2026-09-14T00:00:00Z", state: "draft", publicationStatus: "pending_approval" };
const snapshot = { organizationId, branchId, clientId, form: "A", usageYear: 115, month: 0, latest: draft, history: [], currentSources: null, canEdit: true };
const post = () => new Request("https://example.invalid/api/taipei-abcd/drafts", { method: "POST", headers: { "idempotency-key": key }, body: "{}" });
const get = () => new Request(`https://example.invalid/api/taipei-abcd/drafts?client=${clientId}&form=A&year=115&month=0`);
describe("Taipei draft API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue(actor); mocks.read.mockResolvedValue(payload); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); });
  it("denies writes before consuming sensitive content", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, scopes: ["clients.read"] });
    expect((await POST(post())).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not substitute demo data or save in demo", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, demo: true }); expect((await POST(post())).status).toBe(403); expect((await GET(get())).status).toBe(403);
  });
  it("blocks A reads and writes after demographic grant removal even with assessment permission", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, scopes: actor.scopes.filter(scope => scope !== "clients.demographics.read") });
    expect((await GET(get())).status).toBe(403);
    expect((await POST(post())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("binds authoritative tenant context, requires session RPC, private no-store response", async () => {
    mocks.rpc.mockResolvedValue({ data: { draft, idempotencyKey: key, replayed: false }, error: null });
    const response = await POST(post()); expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("save_taipei_abcd_draft", { p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_payload: payload, p_idempotency_key: key });
  });
  it("refuses forged signature or clinical field without DB call", async () => {
    mocks.read.mockResolvedValue({ ...payload, signed: true }); expect((await POST(post())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reads and validates complete saved snapshot identity", async () => {
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null }); const response = await GET(get()); expect(response.status).toBe(200); expect((await response.json()).data.latest.answers).toEqual(payload.answers);
  });
  it.each([{ organizationId: key }, { clientId: key }, { form: "B" }, { state: "signed" }, { answers: {} }, { version: 2 }])("rejects mutated or cross-scope receipt %j", async delta => {
    mocks.rpc.mockResolvedValue({ data: { draft: { ...draft, ...delta }, idempotencyKey: key, replayed: false }, error: null }); expect((await POST(post())).status).toBeGreaterThanOrEqual(500);
  });
  it.each([["42501", 403], ["40001", 409], ["23505", 409], ["22023", 400], ["XX000", 503]])("maps safe DB error %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "sensitive SQL details must not be returned" } });
    const response = await POST(post()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("sensitive SQL details");
  });
});
