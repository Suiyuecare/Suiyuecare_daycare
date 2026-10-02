import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyIntakeProfile } from "./model";
import { IntegrationError } from "@/lib/integrations/errors";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), authorize: vi.fn(), recent: vi.fn(), client: vi.fn(), rpc: vi.fn(), admin: vi.fn(), stage: vi.fn(), env: { NODE_ENV: "test", NEXT_PUBLIC_APP_ORIGIN: "https://example.invalid", AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "", AWS_KMS_KEY_ID: "" } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: mocks.authorize }));
vi.mock("@/lib/env", () => ({ env: mocks.env, hasSupabaseConfiguration: () => true, isDemoMode: () => false }));
vi.mock("@/lib/integrations/http", async () => ({ ...await vi.importActual<typeof import("@/lib/integrations/http")>("@/lib/integrations/http"), authorizeStaffRequest: mocks.authorize, requireRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/imports/trusted-staging", () => ({ stageTrustedIntakeHtmlImport: mocks.stage }));
import { GET, POST } from "@/app/api/client-intake/route";
import { POST as upload, GET as preview } from "@/app/api/client-intake/imports/route";
import { POST as approve } from "@/app/api/client-intake/imports/approve/route";
const id = "c1600000-0000-4000-8000-000000000001";
const operation = "c1800000-0000-4000-8000-000000000001";
const actor = { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001", userId: "d1600000-0000-4000-8000-000000000001", scopes: ["clients.read", "clients.manage", "clients.demographics.read", "clients.view_all", "imports.manage", "imports.approve"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const profile = { ...emptyIntakeProfile, displayName: "合成測試個案", clientCode: "TEST-001" };
const body = { action: "create", idempotency_key: operation, profile };
const receipt = { clientId: id, operationId: operation, profileVersion: 1, clientRowVersion: 1, pending: true, replayed: false };
const request = (value: unknown) => new Request("https://example.invalid", { method: "POST", headers: { origin: "https://example.invalid", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(value) });
const sourceHtml = "<!doctype html><html><body><h5>需要服務者基本資料</h5><table><tr><td>姓名</td><td>合成個案</td></tr></table></body></html>";
const uploadRequest = () => {
  const form = new FormData();
  form.set("file", new File([sourceHtml], "synthetic.html", { type: "text/html" }));
  return new Request("https://example.invalid", { method: "POST", headers: { origin: "https://example.invalid", "sec-fetch-site": "same-origin", "idempotency-key": operation }, body: form });
};
beforeEach(() => { vi.resetAllMocks(); mocks.env.HTML_ARCHIVE_BUCKET = ""; mocks.env.AWS_KMS_KEY_ID = ""; mocks.actor.mockResolvedValue(actor); mocks.authorize.mockResolvedValue(actor); mocks.recent.mockResolvedValue(undefined); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ error: null, data: receipt }); });
describe("real intake API boundaries", () => {
  it("denies anonymous and absent branch reads, without querying a database", async () => {
    mocks.actor.mockResolvedValue(null); expect((await GET(new Request(`https://example.invalid?client=${id}`))).status).toBe(401);
    mocks.actor.mockResolvedValue({ ...actor, branchId: null }); expect((await GET(new Request(`https://example.invalid?client=${id}`))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not grant demographic access from page access", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["clients.read"] }); expect((await GET(new Request(`https://example.invalid?client=${id}`))).status).toBe(403);
  });
  it("rejects demo, missing permission, and failed live Google action authorization", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, demo: true }); expect((await POST(request(body))).status).toBe(403);
    mocks.authorize.mockResolvedValue({ ...actor, scopes: ["clients.read", "clients.demographics.read"] }); expect((await POST(request(body))).status).toBe(403);
    mocks.authorize.mockRejectedValue(new IntegrationError("INTAKE_NOT_AUTHORIZED", "請聯絡管理員", 403)); expect((await POST(request(body))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates fields and injected scope before write", async () => { expect((await POST(request({ ...body, branchId: id }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("uses server-owned tenant and only claims persisted with a bound receipt", async () => {
    const result = await POST(request(body)); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store"); expect((await result.json()).data.persisted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("create_intake_client", { p_org: actor.organizationId, p_branch: actor.branchId, p_operation: operation, p_profile: profile });
    expect(mocks.authorize).toHaveBeenCalledWith("profile.create", null); expect(mocks.recent).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ error: null, data: { ...receipt, operationId: id } }); expect((await POST(request(body))).status).toBe(503);
  });
  it("sanitizes database errors and preserves conflicts", async () => {
    for (const [code, status] of [["42501", 403], ["40001", 409], ["23505", 409], ["22023", 400], ["random", 503]] as const) { mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SECRET_SOURCE_CONTENT" } }); const result = await POST(request(body)); expect(result.status).toBe(status); expect(await result.text()).not.toContain("SECRET_SOURCE_CONTENT"); }
  });
  it("rejects stale or wrong-client readback", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { clientId: operation, profileVersion: 1, clientRowVersion: 1, pending: true, profile, fieldAuthority: {}, sourceBatchId: null } }); expect((await GET(new Request(`https://example.invalid?client=${id}`))).status).toBe(503);
  });
  it("stops HTML before reading bytes when immutable archive is unavailable", async () => {
    const result = await upload(uploadRequest()); expect(result.status).toBe(503); expect((await result.json()).errors[0].code).toBe("ARCHIVE_NOT_READY"); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("preview is scoped and denies identifiers or missing imports permission", async () => {
    expect((await preview(new Request("https://example.invalid?batch=bad"))).status).toBe(400);
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["clients.read", "clients.demographics.read"] }); expect((await preview(new Request(`https://example.invalid?batch=${id}`))).status).toBe(403);
  });
  it("commit never accepts parsed fields/archive evidence supplied by the browser", async () => {
    expect((await approve(request({ parsedPayload: {}, archive: "forged" }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("creates CMS cases with null base versions and binds the committed receipt", async () => {
    const input = { batchId: id, idempotency_key: operation, payloadSha256: "a".repeat(64), clientId: null, expectedVersion: 0, expectedClientVersion: 0, clientCode: "TEST-001", sourceReviewReason: null, decisions: [{ fieldId: "field-1", target: "displayName", choice: "use_source" }, { fieldId: "field-2", target: "identityNumber", choice: "use_source" }] };
    mocks.rpc.mockResolvedValue({ error: null, data: { ...receipt, formallyImported: true, batchId: id } });
    expect((await approve(request(input))).status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith("cms.commit", null); expect(mocks.recent).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("commit_cms_intake", expect.objectContaining({ p_expected_version: null, p_expected_client_version: null, p_source_review_reason: null }));
    mocks.rpc.mockResolvedValue({ error: null, data: { ...receipt, formallyImported: true, batchId: operation } }); expect((await approve(request(input))).status).toBe(503);
  });
  it("recovers an identical completed upload after a new selection without archiving or creating again", async () => {
    mocks.env.HTML_ARCHIVE_BUCKET = "synthetic-archive"; mocks.env.AWS_KMS_KEY_ID = "synthetic-key"; mocks.admin.mockReturnValue({});
    mocks.rpc.mockResolvedValue({ error: null, data: { status: "completed", reservationId: id, payloadSha256: "a".repeat(64), clientId: null } });
    const result = await upload(uploadRequest());
    expect(result.status).toBe(200); const envelope = await result.json();
    expect(envelope).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u), status: "ok", errors: [], data: {
      reservation_id: id, status: "completed", recovered: true, file_sha256: createHash("sha256").update(sourceHtml).digest("hex"),
      payload_sha256: "a".repeat(64), mapping_version: "central-care-plan-html@1" } }); expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("find_cms_intake_source", expect.objectContaining({ p_org: actor.organizationId, p_branch: actor.branchId, p_file_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }));
    expect(mocks.authorize.mock.calls.map(call => call[0])).toEqual(["cms.stage", "cms.preview"]);
    expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("completed duplicate ACK is refused if current preview authorization is revoked", async () => {
    mocks.env.HTML_ARCHIVE_BUCKET = "synthetic-archive"; mocks.env.AWS_KMS_KEY_ID = "synthetic-key"; mocks.admin.mockReturnValue({});
    mocks.rpc.mockResolvedValue({ error: null, data: { status: "completed", reservationId: id, payloadSha256: "a".repeat(64), clientId: null } });
    mocks.authorize.mockResolvedValueOnce(actor).mockRejectedValueOnce(new IntegrationError("INTAKE_NOT_AUTHORIZED", "目前無法授權查證原上傳。", 403));
    const response = await upload(uploadRequest()); expect(response.status).toBe(403); expect((await response.json()).data).toBeNull();
    expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.authorize).toHaveBeenLastCalledWith("cms.preview");
  });
  it.each(["organizationId", "branchId", "userId", "scopes"] as const)("completed duplicate ACK binds the current %s", async field => {
    mocks.env.HTML_ARCHIVE_BUCKET = "synthetic-archive"; mocks.env.AWS_KMS_KEY_ID = "synthetic-key"; mocks.admin.mockReturnValue({});
    mocks.rpc.mockResolvedValue({ error: null, data: { status: "completed", reservationId: id, payloadSha256: "a".repeat(64), clientId: null } });
    mocks.authorize.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, [field]: field === "scopes" ? [] : operation });
    const response = await upload(uploadRequest()); expect(response.status).toBe(403); expect((await response.json()).data).toBeNull(); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("preview rejects an otherwise valid other-case source before disclosure", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { batchId: id, payloadSha256: "a".repeat(64), mappingVersion: "central-care-plan-html@1",
      fields: [], sections: [], warnings: [], conflicts: [], imported: false, importReceipt: null,
      current: { clientId: operation, profileVersion: 1, clientRowVersion: 1, pending: true, profile, fieldAuthority: {}, sourceBatchId: null } } });
    const response = await preview(new Request(`https://example.invalid?batch=${id}&client=${id}`)); expect(response.status).toBe(502);
    expect((await response.json()).data).toBeNull();
  });
  it("denies simple browser form posts for sensitive JSON mutations", async () => {
    expect((await POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify(body) }))).status).toBe(415);
  });
});
