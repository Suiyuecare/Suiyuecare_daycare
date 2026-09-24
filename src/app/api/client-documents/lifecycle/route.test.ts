import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), recent: vi.fn(), client: vi.fn(), rpc: vi.fn(), abort: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async () => ({ ...await vi.importActual<typeof import("@/lib/integrations/http")>("@/lib/integrations/http"), authorizeStaffRequest: mocks.authorize, requireRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { IntegrationError } from "@/lib/integrations/errors";
import { POST } from "./route";
const clientId = "c1600000-0000-4000-8000-000000000001";
const documentId = "d1600000-0000-4000-8000-000000000001";
const actor = { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001", scopes: ["clients.read", "clients.manage", "clients.demographics.read"], demo: false };
const input = { clientId, documentId, category: "identity_front", expectedReviewRevision: 1, disposition: "reviewed", reason: "合成附件已核對", idempotency_key: "c1800000-0000-4000-8000-000000000001" };
const receipt = { clientId, documentId, category: "identity_front", reviewRevision: 2, disposition: "reviewed", replayed: false, persisted: true };
function request(body: unknown = input, contentType = "application/json") { return new Request("https://example.invalid/api/client-documents/lifecycle", { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) }); }
function result(value: unknown = receipt) { mocks.single.mockResolvedValue({ error: null, data: { receipt: value } }); }
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue(actor); mocks.recent.mockResolvedValue(undefined); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockReturnValue({ maybeSingle: mocks.single }); result(); });
afterEach(() => vi.useRealTimers());

describe("per-document lifecycle write API", () => {
  it("authenticates before payload validation and preserves no-store envelope", async () => {
    mocks.authorize.mockRejectedValue(new IntegrationError("AUTH_REQUIRED", "請先登入。", 401)); const response = await POST(request({ garbage: true }));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("private, no-store"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, demo: true }, { ...actor, branchId: null }, { ...actor, scopes: [] }])("blocks unauthorized context without mutation", async (value) => {
    mocks.authorize.mockResolvedValue(value); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains existing recent AAL2 boundary without extra authorization type", async () => {
    mocks.recent.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "需要驗證", 403)); expect((await POST(request())).status).toBe(403);
    expect(mocks.authorize).toHaveBeenCalledWith(); expect(mocks.recent).toHaveBeenCalledWith(actor); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ category: "medication_plan" }, { category: "health_exam" }])("requires exact category write scope before mutation", async (bad) => {
    expect((await POST(request({ ...input, ...bad }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires demographic field permission even with client manage", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, scopes: ["clients.read", "clients.manage"] }); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ reason: "短" }, { objectPath: "private/path" }, { expectedReviewRevision: -1 }, { documentId: "invalid" }, { disposition: "delete" }])("rejects malformed writes before DB", async (bad) => {
    expect((await POST(request({ ...input, ...bad }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires JSON and bounds the request", async () => {
    expect((await POST(request(input, "text/plain"))).status).toBe(415);
    expect((await POST(request({ ...input, reason: "x".repeat(5000) }))).status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends only actor scope and checked payload and returns actual receipt", async () => {
    const response = await POST(request()); expect(response.status).toBe(201); expect((await response.json()).data.receipt).toEqual(receipt);
    expect(mocks.rpc).toHaveBeenCalledWith("change_client_document_disposition", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: input }); expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("returns replay receipt without advancing or replacing original key", async () => {
    result({ ...receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("change_client_document_disposition", expect.objectContaining({ p_input: input }));
  });
  it.each([["42501", 403], ["40001", 409], ["23505", 409], ["22023", 400], ["23514", 409], ["55000", 409], ["57014", 503]])("maps %s to safe actionable state", async (code, status) => {
    mocks.single.mockResolvedValue({ data: null, error: { code, message: "sensitive health detail" } }); const response = await POST(request());
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("sensitive health detail");
  });
  it.each([{ clientId: documentId }, { documentId: clientId }, { category: "health_exam" }, { reviewRevision: 9 }, { disposition: "inactive" }, { persisted: false }, { secret: "never expose" }])("keeps uncertain outcome for wrong-target or malformed receipt", async (bad) => {
    result({ ...receipt, ...bad }); const response = await POST(request()); expect(response.status).toBe(503);
    const body = await response.text(); expect(body).toContain("DOCUMENT_LIFECYCLE_UNCERTAIN"); expect(body).not.toContain("never expose");
  });
  it("bounds hung write and instructs original-key retry, never claims rollback", async () => {
    vi.useFakeTimers(); mocks.single.mockReturnValue(new Promise(() => {})); const pending = POST(request()); await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending; expect(response.status).toBe(503); expect((await response.json()).errors[0].code).toBe("DOCUMENT_LIFECYCLE_UNCERTAIN");
  });
  it("handles absent server and private transport errors", async () => {
    mocks.client.mockResolvedValue(null); expect((await POST(request())).status).toBe(503);
    mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.single.mockRejectedValue(new Error("secret bearer")); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("bearer");
  });
});
