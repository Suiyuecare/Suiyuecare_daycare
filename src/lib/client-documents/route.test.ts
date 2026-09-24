import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_CATEGORIES } from "./schema";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), authorize: vi.fn(), recent: vi.fn(), client: vi.fn(), admin: vi.fn(), rpc: vi.fn(), single: vi.fn(), scanner: vi.fn(), process: vi.fn(), from: vi.fn(), signed: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/integrations/http", async () => ({ ...await vi.importActual<typeof import("@/lib/integrations/http")>("@/lib/integrations/http"), authorizeStaffRequest: mocks.authorize, requireRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("./pipeline", () => ({ DOCUMENT_BUCKET: "client-intake-documents", configuredDocumentScanner: mocks.scanner, processDocumentUpload: mocks.process }));
import { GET, POST, PATCH } from "@/app/api/client-documents/route";
const clientId = "c1600000-0000-4000-8000-000000000001"; const documentId = "d1600000-0000-4000-8000-000000000001";
const actor = { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001", scopes: ["clients.read", "clients.manage", "clients.demographics.read", "medications.read", "health.read"], demo: false };
const key = "c1800000-0000-4000-8000-000000000001";
const url = "https://example.invalid/api/client-documents";
function request(action: string, body: unknown, method = "POST") { return new Request(url, { method, headers: { "content-type": "application/json", "x-client-document-action": action }, body: JSON.stringify(body) }); }
function uploadForm(category = "identity_front") { const f = new FormData(); f.set("clientId", clientId); f.set("category", category); f.set("expectedDocumentVersion", "0"); f.set("idempotency_key", key); f.set("file", new File([new Uint8Array([137,80,78,71,13,10,26,10])], "synthetic.png", { type: "image/png" })); return f; }
const review = { clientId, category: "identity_front", expectedDocumentVersion: 1, expectedReviewVersion: 0, decision: "reviewed", reason: "已核對合成文件", idempotency_key: key };
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.authorize.mockResolvedValue(actor); mocks.recent.mockResolvedValue(undefined); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ maybeSingle: mocks.single }); mocks.admin.mockReturnValue({ storage: { from: mocks.from } }); mocks.from.mockReturnValue({ createSignedUrl: mocks.signed }); mocks.scanner.mockReturnValue(null); });
describe("private document API boundaries", () => {
  it("rejects anonymous with private no-store and does not query business data", async () => {
    mocks.actor.mockResolvedValue(null); const response = await GET(new Request(`${url}?client=${clientId}`)); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates exact six-category snapshot and surfaces unavailable uploader truthfully", async () => {
    mocks.single.mockResolvedValue({ error: null, data: { payload: { clientId, generatedAt: "2026-09-14T00:00:00Z", rows: DOCUMENT_CATEGORIES.map((category) => ({ category, accessible: true, canManage: true, documentId: null, documentVersion: 0, reviewVersion: 0, status: "missing", scanStatus: null, canDownload: false, mimeType: null, fileSizeBytes: null, reservedAt: null, reviewReason: null })), history: [], historyTruncated: false } } });
    const response = await GET(new Request(`${url}?client=${clientId}`)); expect(response.status).toBe(200); expect((await response.json()).data.uploadConfigured).toBe(false);
  });
  it("stops unconfigured scanner before file parsing, reservation, or blob storage", async () => {
    const response = await POST(request("upload", "not even multipart")); expect(response.status).toBe(503); expect((await response.json()).errors[0].code).toBe("DOCUMENT_SCANNER_NOT_CONFIGURED"); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("does not expose identity metadata from an overbroad database snapshot after demographic revocation", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: actor.scopes.filter(scope => scope !== "clients.demographics.read") });
    mocks.single.mockResolvedValue({ error: null, data: { payload: { clientId, generatedAt: "2026-09-14T00:00:00Z", rows: DOCUMENT_CATEGORIES.map((category) => ({ category, accessible: true, canManage: true, documentId: null, documentVersion: 0, reviewVersion: 0, status: "missing", scanStatus: null, canDownload: false, mimeType: null, fileSizeBytes: null, reservedAt: null, reviewReason: "synthetic-private-review" })), history: [], historyTruncated: false } } });
    const response = await GET(new Request(`${url}?client=${clientId}`));
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("synthetic-private-review");
  });
  it("blocks demo upload and enforces recent identity confirmation", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, demo: true }); expect((await POST(request("upload", {}))).status).toBe(403);
    mocks.authorize.mockResolvedValue(actor); await POST(request("upload", {})); expect(mocks.recent).toHaveBeenCalledWith(actor);
  });
  it("rejects caller-supplied scan/path fields before pipeline", async () => {
    mocks.scanner.mockReturnValue({ name: "synthetic-test" }); const form = uploadForm(); form.set("scanStatus", "clean");
    expect((await POST(new Request(url, { method: "POST", headers: { "x-client-document-action": "upload" }, body: form }))).status).toBe(400); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("requires medication permission for medication files, not merely client permission", async () => {
    mocks.scanner.mockReturnValue({ name: "synthetic-test" }); expect((await POST(new Request(url, { method: "POST", headers: { "x-client-document-action": "upload" }, body: uploadForm("medication_plan") }))).status).toBe(403); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("requires sensitive demographic scope for identity upload and review even with clients.manage", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, scopes: actor.scopes.filter(scope => scope !== "clients.demographics.read") });
    mocks.scanner.mockReturnValue({ name: "synthetic-test" });
    expect((await POST(new Request(url, { method: "POST", headers: { "x-client-document-action": "upload" }, body: uploadForm() }))).status).toBe(403);
    expect((await PATCH(request("review", review, "PATCH"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("never signs an identity download after demographic grant removal even with a stale permissive DB receipt", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, scopes: actor.scopes.filter(scope => scope !== "clients.demographics.read") });
    mocks.single.mockResolvedValue({ error: null, data: { payload: { id: documentId, clientId, category: "identity_front", version: 1, objectPath: `${actor.organizationId}/${clientId}/${documentId}`, mimeType: "image/png", expiresSeconds: 60 } } });
    expect((await POST(request("download", { clientId, documentId, idempotency_key: key }))).status).toBe(403);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("permits only user-authorized reserved-path downloads and no leaked keys", async () => {
    const path = `${actor.organizationId}/${clientId}/${documentId}`;
    mocks.single.mockResolvedValue({ error: null, data: { payload: { id: documentId, clientId, category: "identity_front", version: 1, objectPath: path, mimeType: "image/png", expiresSeconds: 60 } } });
    mocks.signed.mockResolvedValue({ data: { signedUrl: "https://synthetic.supabase.co/storage/v1/object/sign/client-intake-documents/synthetic" }, error: null });
    const response = await POST(request("download", { clientId, documentId, idempotency_key: key })); expect(response.status).toBe(200);
    expect(mocks.signed).toHaveBeenCalledWith(path, 60, { download: "identity_front-v1.png" });
    const body = await response.text(); expect(body).not.toContain("service_role"); expect(body).not.toContain("SUPABASE_SECRET_KEY"); expect(body).not.toContain("historicalOnly"); expect(body).not.toContain("disposition");
  });
  it("forwards validated inactive historical download evidence without inferring clinical approval", async () => {
    const path = `${actor.organizationId}/${clientId}/${documentId}`;
    mocks.single.mockResolvedValue({ error: null, data: { payload: { id: documentId, clientId, category: "identity_front", version: 1, objectPath: path, mimeType: "image/png", expiresSeconds: 60, disposition: "inactive", historicalOnly: true } } });
    mocks.signed.mockResolvedValue({ data: { signedUrl: "https://synthetic.supabase.co/storage/v1/object/sign/client-intake-documents/synthetic" }, error: null });
    const response = await POST(request("download", { clientId, documentId, idempotency_key: key })); expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ documentId, version: 1, disposition: "inactive", historicalOnly: true });
    expect(mocks.recent).toHaveBeenCalledWith(actor); expect(mocks.signed).toHaveBeenCalledWith(path, 60, { download: "identity_front-v1.png" });
  });
  it.each([{ disposition: "clinical_approved", historicalOnly: false }, { disposition: "inactive", historicalOnly: false }, { disposition: "unreviewed" }, { historicalOnly: true }])("does not sign with malformed historical disposition metadata", async (metadata) => {
    mocks.single.mockResolvedValue({ error: null, data: { payload: { id: documentId, clientId, category: "identity_front", version: 1, objectPath: `${actor.organizationId}/${clientId}/${documentId}`, mimeType: "image/png", expiresSeconds: 60, ...metadata } } });
    expect((await POST(request("download", { clientId, documentId, idempotency_key: key }))).status).toBe(409);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("never signs a URL after denied access or a forged object path", async () => {
    mocks.single.mockResolvedValue({ error: { code: "42501", message: "private field data" }, data: null }); const response = await POST(request("download", { clientId, documentId, idempotency_key: key })); expect(response.status).toBe(403); expect(await response.text()).not.toContain("private field data");
    mocks.single.mockResolvedValue({ error: null, data: { payload: { id: documentId, clientId, category: "identity_front", version: 1, objectPath: "another/tenant/path", mimeType: "image/png", expiresSeconds: 60 } } }); expect((await POST(request("download", { clientId, documentId, idempotency_key: key }))).status).toBe(409); expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("checks review receipt client, decision, and version", async () => {
    mocks.single.mockResolvedValue({ error: null, data: { receipt: { clientId, category: "identity_front", reviewVersion: 1, decision: "reviewed", replayed: false, persisted: true } } }); expect((await PATCH(request("review", review, "PATCH"))).status).toBe(201);
    mocks.single.mockResolvedValue({ error: null, data: { receipt: { clientId, category: "identity_front", reviewVersion: 9, decision: "reviewed", replayed: false, persisted: true } } }); expect((await PATCH(request("review", review, "PATCH"))).status).toBe(409);
  });
});
