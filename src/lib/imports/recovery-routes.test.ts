import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ routine: vi.fn(), general: vi.fn(), user: vi.fn(), worker: vi.fn(),
  factory: vi.fn(), recover: vi.fn(), read: vi.fn(), repoRecover: vi.fn(), demo: false,
  env: { NEXT_PUBLIC_APP_ORIGIN: "https://example.invalid", NODE_ENV: "test", AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "", AWS_KMS_KEY_ID: "" } }));
vi.mock("@/lib/env", () => ({ env: mocks.env, isDemoMode: () => mocks.demo }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: mocks.routine }));
vi.mock("@/lib/imports/http", async importOriginal => ({ ...await importOriginal<typeof import("./http")>(), authorizeImportRequest: mocks.general }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.worker }));
vi.mock("@/lib/imports/production-repository", () => ({ createProductionImportRepository: mocks.factory }));
vi.mock("@/lib/imports/trusted-recovery", () => ({ recoverTrustedHtmlImport: mocks.recover, readTrustedUploadRecovery: mocks.read }));
import { GET as routineGet, POST as routinePost } from "@/app/api/client-intake/imports/recovery/route";
import { GET as generalGet, POST as generalPost } from "@/app/api/imports/recovery/route";
import { ImportError } from "./errors";
const organizationId = "10000000-0000-4000-8000-000000000001", branchId = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001", reservationId = "40000000-0000-4000-8000-000000000001";
const originalOperationKey = "50000000-0000-4000-8000-000000000001", recoveryOperationKey = "60000000-0000-4000-8000-000000000001";
const context = { organizationId, branchId, userId, scopes: ["imports.manage", "imports.approve"], assuranceLevel: "aal1", demo: false };
const actor = { organizationId, branchId, userId, assuranceLevel: "aal2", recentAal2At: "2026-09-28T00:00:00Z" };
function postRequest(general = false, headers: Record<string,string> = {}) {
  const form = new FormData(); form.set("file", new File(["<!doctype html><body>合成 CMS</body>"], "synthetic.html", { type: "text/html" }));
  form.set("reservation_id", reservationId); form.set("original_operation_key", originalOperationKey); form.set("idempotency_key", recoveryOperationKey);
  return new Request(`https://example.invalid/api/${general ? "imports" : "client-intake/imports"}/recovery`, { method: "POST", body: form,
    headers: { origin: "https://example.invalid", "idempotency-key": recoveryOperationKey, ...headers } });
}
const readRequest = (general = false) => new Request(`https://example.invalid/api/${general ? "imports" : "client-intake/imports"}/recovery?key=${recoveryOperationKey}`);
const options = { reservationId, originalOperationKey, recoveryOperationKey };
const staging = { reservation_id: reservationId, status: "completed", staging_only: true, formally_imported: false };
beforeEach(() => {
  vi.resetAllMocks(); mocks.demo = false; mocks.env.AWS_REGION = "ap-northeast-1";
  mocks.env.HTML_ARCHIVE_BUCKET = "synthetic-archive"; mocks.env.AWS_KMS_KEY_ID = "arn:aws:kms:ap-northeast-1:123456789012:key/synthetic-key";
  mocks.routine.mockResolvedValue(context); mocks.general.mockResolvedValue(actor);
  mocks.user.mockResolvedValue({ rpc: vi.fn() }); mocks.worker.mockReturnValue({ rpc: vi.fn() });
  mocks.factory.mockResolvedValue({ recoverQueuedUpload: mocks.repoRecover }); mocks.read.mockResolvedValue(null); mocks.recover.mockResolvedValue(staging);
  mocks.repoRecover.mockResolvedValue({ duplicate: false, replayed: false, batch: { id: reservationId, version: 1, status: "ready_for_approval",
    fileName: "synthetic.html", byteLength: 43, fileSha256: "a".repeat(64), contentFingerprint: "b".repeat(64), mappingVersion: "central-care-plan-html@1",
    createdAt: actor.recentAal2At, updatedAt: actor.recentAal2At, sections: [], fields: [], warnings: [], conflicts: [], security: {} } });
});
describe("explicit CMS recovery routes", () => {
  it("routine recovery retains actual AAL1 action and only returns staging receipt", async () => {
    const request = postRequest(); const response = await routinePost(request);
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual(staging);
    expect(mocks.routine).toHaveBeenCalledWith("cms.stage");
    expect(mocks.recover).toHaveBeenCalledWith(expect.objectContaining({ signal: request.signal, reauthorize: expect.any(Function) }),
      { organizationId, branchId, userId, assuranceLevel: "aal1", recentAal2At: null }, expect.objectContaining({ fileName: "synthetic.html" }), options, "routine-intake");
    const deps = mocks.recover.mock.calls[0]![0]; expect(await deps.reauthorize()).toMatchObject({ assuranceLevel: "aal1" });
    expect(mocks.repoRecover).not.toHaveBeenCalled();
  });
  it("general recovery uses explicit production repository and original identifiers", async () => {
    const request = postRequest(true); const response = await generalPost(request);
    expect(response.status).toBe(201); const body = await response.json();
    expect(body.data).toMatchObject({ staging_only: true, formally_imported: false });
    expect(mocks.general).toHaveBeenCalledWith(request, "upload"); expect(mocks.factory).toHaveBeenCalledWith(actor, "upload");
    expect(mocks.repoRecover).toHaveBeenCalledWith(expect.objectContaining({ fileName: "synthetic.html" }), options, request.signal);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it.each([[routineGet, false, "routine-intake"], [generalGet, true, "general"]] as const)("observes exact own recovery without write/archive credentials %#", async (handler, general, mode) => {
    mocks.env.HTML_ARCHIVE_BUCKET = ""; mocks.env.AWS_KMS_KEY_ID = ""; mocks.worker.mockReturnValue(null);
    const response = await handler(readRequest(general));
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ found: false, recovery: null });
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId, branchId, userId }), recoveryOperationKey, mode);
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it.each([[routineGet, false], [generalGet, true]] as const)("does not convert returned observation into new upload or formal import %#", async (handler, general) => {
    mocks.read.mockResolvedValue({ schema_version: 1, status: "queued", staging_only: true, formally_imported: false });
    const response = await handler(readRequest(general));
    expect((await response.json()).data).toMatchObject({ found: true, recovery: { status: "queued", formally_imported: false } });
    expect(mocks.recover).not.toHaveBeenCalled(); expect(mocks.repoRecover).not.toHaveBeenCalled();
  });
  it.each([routinePost, generalPost])("denies origin before auth, body or persistence %#", async handler => {
    const request = postRequest(true, { origin: "https://other.invalid" }); const response = await handler(request);
    expect(response.status).toBe(403); expect(request.bodyUsed).toBe(false); expect(mocks.routine).not.toHaveBeenCalled();
    expect(mocks.general).not.toHaveBeenCalled(); expect(mocks.repoRecover).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled();
  });
  it("routine unconfigured archive refuses before consuming a file", async () => {
    mocks.env.HTML_ARCHIVE_BUCKET = ""; const request = postRequest();
    expect((await routinePost(request)).status).toBe(503); expect(request.bodyUsed).toBe(false); expect(mocks.recover).not.toHaveBeenCalled();
  });
  it.each(["demo", "scope", "branch"])("routine denied %s cannot recover", async kind => {
    mocks.routine.mockResolvedValue({ ...context, ...(kind === "demo" ? { demo: true } : kind === "branch" ? { branchId: null } : { scopes: [] }) });
    expect((await routinePost(postRequest())).status).toBe(403); expect(mocks.recover).not.toHaveBeenCalled();
  });
  it.each([generalGet, generalPost])("general demo never reaches real storage %#", async handler => {
    mocks.demo = true; expect((await handler(handler === generalGet ? readRequest(true) : postRequest(true))).status).toBe(403);
    expect(mocks.general).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([routinePost, generalPost])("returns safe unknown without reflecting upstream details %#", async handler => {
    mocks.recover.mockRejectedValue(new Error("PRIVATE_CMS_AND_TOKEN")); mocks.repoRecover.mockRejectedValue(new Error("PRIVATE_CMS_AND_TOKEN"));
    const response = await handler(postRequest(true)); expect(response.status).toBe(500);
    const body = await response.text(); expect(body).not.toContain("PRIVATE_CMS_AND_TOKEN"); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([routineGet, generalGet])("rejects unsupported read filters before auth %#", async handler => {
    expect((await handler(new Request(`https://example.invalid/api/imports/recovery?key=${recoveryOperationKey}&actor=${userId}`))).status).toBe(400);
    expect(mocks.general).not.toHaveBeenCalled(); expect(mocks.routine).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([routineGet, generalGet])("preserves exact current denial from read %#", async handler => {
    mocks.read.mockRejectedValue(new ImportError("IMPORT_PERMISSION_DENIED", "目前無法授權原操作查證。", 403));
    expect((await handler(readRequest(true))).status).toBe(403); expect(mocks.recover).not.toHaveBeenCalled();
  });
});
