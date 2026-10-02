import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { STAFF_CERTIFICATE_DOCUMENT_BUCKET, type StaffCertificateDocumentReceipt } from "./schema";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), client: vi.fn(), admin: vi.fn(), rpc: vi.fn(), adminRpc: vi.fn(),
  scanner: vi.fn(), scan: vi.fn(), from: vi.fn(), upload: vi.fn(), download: vi.fn(), signed: vi.fn(),
  configuration: { NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co", NODE_ENV: "production" } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/env", () => ({ env: mocks.configuration }));
vi.mock("./pipeline", async importOriginal => ({ ...await importOriginal<typeof import("./pipeline")>(), configuredStaffCertificateDocumentScanner: mocks.scanner }));

import { GET, PATCH, POST } from "@/app/api/staff-certificate-documents/route";

const id = (n: number) => `be12000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T04:00:00Z"), origin = mocks.configuration.NEXT_PUBLIC_APP_ORIGIN;
const url = `${origin}/api/staff-certificate-documents`;
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P8sAAAAASUVORK5CYII=", "base64");
const bytesHash = createHash("sha256").update(bytes).digest("hex"), recordHash = "a".repeat(64);
const actor: TenantContext = { organizationId: id(1), branchId: id(2), userId: id(8), organizationName: "合成機構", branchName: "合成分支", displayName: "合成核驗者",
  roles: ["branch_supervisor"], scopes: ["staff_certificates.read", "staff_certificates.manage"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
type ProviderResult = { data: unknown; error: null | { code: string; message?: string; details?: string } };
type Handler = (args: Record<string, unknown>) => Promise<ProviderResult> | ProviderResult;
let handlers: Record<string, Handler>, stored: Map<string, Uint8Array>;
const document = (): StaffCertificateDocumentReceipt => ({ documentId: id(7), organizationId: actor.organizationId, branchId: actor.branchId,
  staffMembershipId: id(3), staffUserId: id(4), certificateKey: id(5), recordVersionId: id(6), recordContentHash: recordHash,
  sha256: bytesHash, mimeType: "image/png", fileSizeBytes: bytes.length, uploadedBy: actor.userId, uploadedAt: new Date(now - 3000).toISOString(),
  scanStatus: "clean", persisted: true, serviceEligibility: "not_evaluated", signable: false, demo: false });
const objectPath = (doc = document()) => `${doc.organizationId}/${doc.branchId}/${doc.staffMembershipId}/${doc.certificateKey}/${doc.documentId}`;
const formFields = () => ({ staffMembershipId: id(3), certificateKey: id(5), recordVersionId: id(6), recordContentHash: recordHash, idempotency_key: id(9) });
const downloadInput = () => ({ documentId: id(7), recordVersionId: id(6), recordContentHash: recordHash, idempotency_key: id(9) });
const reviewInput = () => ({ ...downloadInput(), decision: "verified", reason: "核對合成原件" });
const reviewReceipt = () => ({ ...document(), uploadedBy: id(12), reviewId: id(10), reviewedBy: actor.userId, reviewedAt: new Date(now - 1000).toISOString(),
  decision: "verified", reason: "核對合成原件", replayed: false });
const snapshot = () => ({ organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId,
  staffMembershipId: id(3), staffUserId: id(4), certificateKey: id(5), recordVersionId: id(6), recordContentHash: recordHash,
  generatedAt: new Date(now).toISOString(), documents: [{ ...document(), review: null, canDownload: true }],
  total: 1, truncated: false, serviceEligibility: "not_evaluated", signable: false, demo: false });
const result = (payload: unknown): ProviderResult => ({ data: { payload }, error: null });
function query(extra = "") { return new Request(`${url}?certificateKey=${id(5)}&recordVersionId=${id(6)}${extra}`); }
function jsonRequest(action: string, body: unknown = downloadInput(), method = "POST", headers: Record<string, string> = {}) {
  return new Request(url, { method, headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-staff-document-action": action, ...headers }, body: JSON.stringify(body) });
}
function uploadForm() {
  const form = new FormData(); for (const [key, value] of Object.entries(formFields())) form.set(key, value);
  form.set("file", new File([bytes], "synthetic-proof.png", { type: "image/png" })); return form;
}
function multipart(form = uploadForm(), headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "x-staff-document-action": "upload", ...headers }, body: form });
}
async function denied(response: Response, status: number) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toContain("private"); expect(response.headers.get("cache-control")).toContain("no-store");
  const payload = await response.json(); expect(payload.data).toBeNull(); expect(payload.errors.length).toBeGreaterThan(0);
  expect(JSON.stringify(payload)).not.toMatch(/synthetic-private-provider|stack|service_role|SUPABASE_SECRET/u); return payload;
}
const calls = (name: string) => mocks.rpc.mock.calls.filter(([rpc]) => rpc === name);

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  mocks.configuration.NEXT_PUBLIC_APP_ORIGIN = origin; mocks.configuration.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.co";
  handlers = {
    staff_certificate_document_recent_aal2_evidence: () => ({ data: { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, verifiedAt: new Date(now - 1000).toISOString() }, error: null }),
    staff_certificate_documents_snapshot: () => result(snapshot()),
    reserve_staff_certificate_document: () => result({ ...document(), scanStatus: "reserved", objectPath: objectPath(), replayed: false, terminalReceipt: null }),
    complete_staff_certificate_document_scan: args => result({ ...document(), scanStatus: args.p_verdict }),
    review_staff_certificate_document: () => result(reviewReceipt()),
    prepare_staff_certificate_document_download: () => result({ ...document(), objectPath: objectPath(), expiresSeconds: 60, canDownload: true }),
  };
  const rpc = (name: string, args: Record<string, unknown>) => name === "staff_certificate_document_recent_aal2_evidence"
    ? Promise.resolve(handlers[name](args)) : { maybeSingle: () => Promise.resolve(handlers[name](args)) };
  mocks.rpc.mockImplementation(rpc); mocks.adminRpc.mockImplementation(rpc);
  mocks.actor.mockResolvedValue(actor); mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.admin.mockReturnValue({ rpc: mocks.adminRpc, storage: { from: mocks.from } });
  mocks.from.mockReturnValue({ upload: mocks.upload, download: mocks.download, createSignedUrl: mocks.signed });
  mocks.scan.mockResolvedValue("clean"); mocks.scanner.mockReturnValue({ name: "synthetic-scanner-only", scan: mocks.scan });
  stored = new Map([[objectPath(), bytes]]);
  mocks.upload.mockImplementation(async (path: string, contents: Uint8Array) => { stored.set(path, contents); return { error: null }; });
  mocks.download.mockImplementation(async (path: string) => ({ data: stored.has(path) ? new Blob([Uint8Array.from(stored.get(path)!).buffer]) : null, error: stored.has(path) ? null : { statusCode: "404" } }));
  mocks.signed.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://synthetic.supabase.co/storage/v1/object/sign/${STAFF_CERTIFICATE_DOCUMENT_BUCKET}/${path}?token=synthetic-token` }, error: null }));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("actual staff document API with real evidence pipeline and synthetic providers", () => {
  it("reads exact bounded scope and truthfully reports unconfigured uploads", async () => {
    mocks.scanner.mockReturnValue(null); const response = await GET(query()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store"); const body = await response.json();
    expect(body.data).toEqual({ snapshot: snapshot(), uploadConfigured: false });
    expect(mocks.rpc).toHaveBeenCalledWith("staff_certificate_documents_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_certificate_key: id(5), p_record_version_id: id(6) });
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...actor, demo: true }, { ...actor, assuranceLevel: "aal1" }, { ...actor, branchId: "" }, { ...actor, scopes: [] }])("rejects unavailable/unauthorized reader before provider", async principal => {
    mocks.actor.mockResolvedValue(principal); await denied(await GET(query()), principal === null ? 401 : 403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("allows same employee read-only but rejects another employee from stale permissive provider", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["staff_certificates.read"] });
    await denied(await GET(query()), 502);
    handlers.staff_certificate_documents_snapshot = () => result({ ...snapshot(), staffUserId: actor.userId, documents: [{ ...document(), staffUserId: actor.userId, review: null, canDownload: true }] });
    expect((await GET(query())).status).toBe(200);
  });
  it.each(["&extra=1", `&certificateKey=${id(5)}`, "&recordVersionId=bad", "&recordVersionId="])("rejects unknown/duplicate query %s before auth/body/provider", async extra => {
    await denied(await GET(query(extra)), 400); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId", "certificateKey", "recordVersionId"])("rejects GET returned wrong %s without source leakage", async field => {
    handlers.staff_certificate_documents_snapshot = () => result({ ...snapshot(), [field]: id(99), secret: "synthetic-private-provider" });
    await denied(await GET(query()), 502);
  });
  it.each(["organizationId", "branchId", "actorUserId", "certificateKey", "recordVersionId"])("rejects a structurally valid snapshot bound to another %s", async field => {
    handlers.staff_certificate_documents_snapshot = () => {
      const value = snapshot();
      return result({ ...value, [field]: id(99), documents: value.documents.map(entry => field === "actorUserId" ? entry : { ...entry, [field]: id(99) }) });
    };
    await denied(await GET(query()), 502); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each([-60001, 1001])("rejects snapshot generation outside the exact freshness window: %i ms", async offset => {
    handlers.staff_certificate_documents_snapshot = () => result({ ...snapshot(), generatedAt: new Date(now + offset).toISOString(),
      documents: [{ ...document(), uploadedAt: new Date(now - 120000).toISOString(), review: null, canDownload: true }] });
    await denied(await GET(query()), 502);
  });
  it.each([-60000, 1000])("admits inclusive snapshot generation freshness boundary: %i ms", async offset => {
    handlers.staff_certificate_documents_snapshot = () => result({ ...snapshot(), generatedAt: new Date(now + offset).toISOString(),
      documents: [{ ...document(), uploadedAt: new Date(now - 120000).toISOString(), review: null, canDownload: true }] });
    expect((await GET(query())).status).toBe(200); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...snapshot(), signable: true }, { ...snapshot(), serviceEligibility: "eligible" }, { ...snapshot(), total: 2 }])("rejects malformed snapshot %j", async payload => {
    handlers.staff_certificate_documents_snapshot = () => result(payload); await denied(await GET(query()), 502);
  });
  it("returns unavailable without using admin as an alternate reader", async () => {
    mocks.client.mockResolvedValue(null); await denied(await GET(query()), 503); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["42501", "40001", "unexpected"])("sanitizes GET provider error %s", async code => {
    handlers.staff_certificate_documents_snapshot = () => ({ data: null, error: { code, message: "synthetic-private-provider", details: "secret staff identifier" } });
    await denied(await GET(query()), code === "42501" ? 403 : 409);
  });
  it("stops unconfigured scanner before body, reserve, storage or server scan registration", async () => {
    mocks.scanner.mockReturnValue(null); const request = multipart();
    await denied(await POST(request), 503); expect(request.bodyUsed).toBe(false);
    expect(calls("reserve_staff_certificate_document")).toHaveLength(0); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each(["upload", "download"])("stops absent private storage for %s before consuming the body", async action => {
    mocks.admin.mockReturnValue(null); const request = action === "upload" ? multipart() : jsonRequest("download");
    await denied(await POST(request), 503); expect(request.bodyUsed).toBe(false);
    expect(calls("reserve_staff_certificate_document")).toHaveLength(0); expect(calls("prepare_staff_certificate_document_download")).toHaveLength(0);
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("executes actual multipart bytes→reserve→no-upsert blob→read/hash→scan→server completion", async () => {
    const response = await POST(multipart()); expect(response.status).toBe(201); const body = await response.json();
    expect(body.data).toEqual({ receipt: document(), needsVerification: true, serviceEligibility: "not_evaluated", signable: false });
    expect(calls("reserve_staff_certificate_document")[0]).toEqual(["reserve_staff_certificate_document", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: { ...formFields(), sha256: bytesHash, mimeType: "image/png", fileSizeBytes: bytes.length } }]);
    expect(mocks.upload).toHaveBeenCalledWith(objectPath(), expect.any(Uint8Array), { contentType: "image/png", cacheControl: "0", upsert: false });
    expect(mocks.download).toHaveBeenCalledWith(objectPath()); expect(mocks.scan).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(mocks.adminRpc).toHaveBeenCalledWith("complete_staff_certificate_document_scan", { p_document: id(7), p_sha256: bytesHash, p_verdict: "clean", p_scanner: "synthetic-scanner-only" });
    expect(calls("complete_staff_certificate_document_scan")).toHaveLength(0);
  });
  it.each(["infected", "failed"])("persists quarantine %s without verification/qualification", async verdict => {
    mocks.scan.mockResolvedValue(verdict); const response = await POST(multipart()); expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ receipt: { scanStatus: verdict, signable: false }, needsVerification: false, serviceEligibility: "not_evaluated", signable: false });
  });
  it.each(["objectPath", "sha256", "scanStatus", "uploadedBy", "staffUserId", "documentId", "certificateKey"])("rejects forged/duplicate multipart %s before reservation", async field => {
    const form = uploadForm(); form.append(field, "forged"); await denied(await POST(multipart(form)), 400);
    expect(calls("reserve_staff_certificate_document")).toHaveLength(0); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each(["extension", "mime", "empty", "html"])("rejects invalid upload %s before reserve/scan", async kind => {
    const form = uploadForm(); form.set("file", new File([kind === "empty" ? new Uint8Array() : kind === "html" ? Buffer.from("<script>evil()</script>") : bytes],
      kind === "extension" ? "proof.html" : "proof.png", { type: kind === "mime" ? "application/pdf" : "image/png" }));
    await denied(await POST(multipart(form)), 400); expect(calls("reserve_staff_certificate_document")).toHaveLength(0); expect(mocks.scan).not.toHaveBeenCalled();
  });
  it.each(["branch", "version", "hash", "path", "actor"])("does not touch storage for mismatched reserved %s", async field => {
    handlers.reserve_staff_certificate_document = () => result({ ...document(), scanStatus: "reserved", objectPath: field === "path" ? "browser://private" : objectPath(), replayed: false, terminalReceipt: null,
      ...(field === "branch" ? { branchId: id(99) } : field === "version" ? { recordVersionId: id(99) } : field === "hash" ? { recordContentHash: "b".repeat(64) } : field === "actor" ? { uploadedBy: id(99) } : {}) });
    await denied(await POST(multipart()), 502); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it("cannot use a browser action to register a clean scan", async () => {
    const request = jsonRequest("scan", { documentId: id(7), verdict: "clean" });
    await denied(await POST(request), 400); expect(request.bodyUsed).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each(["missing", "cross-site", "wrong-origin"])("denies %s upload/review before consuming request", async kind => {
    for (const method of ["POST", "PATCH"] as const) {
      const request = method === "POST" ? multipart() : jsonRequest("review", reviewInput(), "PATCH");
      if (kind === "missing") request.headers.delete("origin");
      else request.headers.set(kind === "cross-site" ? "sec-fetch-site" : "origin", kind === "cross-site" ? "cross-site" : "https://finance.example.test");
      await denied(await (method === "POST" ? POST(request) : PATCH(request)), 403); expect(request.bodyUsed).toBe(false);
    }
    expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps POST download JSON and PATCH review JSON boundaries explicit", async () => {
    const request = jsonRequest("upload", formFields()); await denied(await POST(request), 415); expect(request.bodyUsed).toBe(false);
    const patch = multipart(); await denied(await PATCH(patch), 403); expect(patch.bodyUsed).toBe(false);
    expect(mocks.actor).not.toHaveBeenCalled();
  });
  it.each(["actor", "branch", "org", "old", "future", "malformed", "extra"])("rejects bad recent evidence %s before body or downstream operations", async kind => {
    handlers.staff_certificate_document_recent_aal2_evidence = () => ({ data: { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: kind === "actor" ? id(99) : actor.userId,
      verifiedAt: new Date(now - 1000).toISOString(), ...(kind === "actor" ? {} : kind === "branch" ? { branchId: id(99) } : kind === "org" ? { organizationId: id(99) }
        : kind === "old" ? { verifiedAt: new Date(now - 900001).toISOString() } : kind === "future" ? { verifiedAt: new Date(now + 1001).toISOString() }
          : kind === "malformed" ? { verifiedAt: "2026-02-30T04:00:00Z" } : { extra: "synthetic-private-provider" }) }, error: null });
    const request = multipart(); await denied(await POST(request), 403); expect(request.bodyUsed).toBe(false); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each([-900000, 1000])("accepts only inclusive recent evidence boundary %i ms", async offset => {
    handlers.staff_certificate_document_recent_aal2_evidence = () => ({ data: { organizationId: actor.organizationId, branchId: actor.branchId,
      actorUserId: actor.userId, verifiedAt: new Date(now + offset).toISOString() }, error: null });
    expect((await POST(jsonRequest("download"))).status).toBe(200); expect(mocks.signed).toHaveBeenCalledTimes(1);
  });
  it("records actual independent human review and stable replay without enabling qualification", async () => {
    const response = await PATCH(jsonRequest("review", reviewInput(), "PATCH")); expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({ receipt: reviewReceipt(), serviceEligibility: "not_evaluated", signable: false });
    expect(mocks.rpc).toHaveBeenCalledWith("review_staff_certificate_document", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: reviewInput() });
    handlers.review_staff_certificate_document = () => result({ ...reviewReceipt(), replayed: true });
    expect((await PATCH(jsonRequest("review", reviewInput(), "PATCH"))).status).toBe(200); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each(["uploader", "target", "actor", "document", "record", "hash", "decision", "reason", "unclean"])("rejects false or uncorrelated review %s", async kind => {
    handlers.review_staff_certificate_document = () => result({ ...reviewReceipt(), ...(kind === "uploader" ? { uploadedBy: actor.userId } : kind === "target" ? { staffUserId: actor.userId }
      : kind === "actor" ? { reviewedBy: id(99) } : kind === "document" ? { documentId: id(99) } : kind === "record" ? { recordVersionId: id(99) }
        : kind === "hash" ? { recordContentHash: "b".repeat(64) } : kind === "decision" ? { decision: "rejected" } : kind === "reason" ? { reason: "不同理由" } : { scanStatus: "infected" }) });
    await denied(await PATCH(jsonRequest("review", reviewInput(), "PATCH")), 502);
  });
  it("rejects read-only review and invented verifier before writing", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["staff_certificates.read"] });
    const request = jsonRequest("review", reviewInput(), "PATCH"); await denied(await PATCH(request), 403); expect(request.bodyUsed).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.actor.mockResolvedValue(actor); await denied(await PATCH(jsonRequest("review", { ...reviewInput(), reviewedBy: id(99) }, "PATCH")), 400);
    expect(calls("review_staff_certificate_document")).toHaveLength(0);
  });
  it("downloads only exact blob bytes and URL, with a safe derived filename and fresh authorization", async () => {
    const response = await POST(jsonRequest("download")); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.data).toEqual({ url: `https://synthetic.supabase.co/storage/v1/object/sign/${STAFF_CERTIFICATE_DOCUMENT_BUCKET}/${objectPath()}?token=synthetic-token`,
      expiresSeconds: 60, documentId: id(7), serviceEligibility: "not_evaluated", signable: false });
    expect(mocks.signed).toHaveBeenCalledWith(objectPath(), 60, { download: "staff-certificate.png" });
    expect(calls("prepare_staff_certificate_document_download")).toHaveLength(2);
    expect(calls("staff_certificate_document_recent_aal2_evidence")).toHaveLength(2); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("admits encoded exact object path without trusting provider arbitrary path", async () => {
    mocks.signed.mockResolvedValue({ data: { signedUrl: `https://synthetic.supabase.co/storage/v1/object/sign/${STAFF_CERTIFICATE_DOCUMENT_BUCKET}/${encodeURIComponent(objectPath())}?token=synthetic-token` }, error: null });
    expect((await POST(jsonRequest("download"))).status).toBe(200);
  });
  it("permits a read-only employee to download only their own clean original", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["staff_certificates.read"] });
    handlers.prepare_staff_certificate_document_download = () => result({ ...document(), staffUserId: actor.userId, objectPath: objectPath(), expiresSeconds: 60, canDownload: true });
    const response = await POST(jsonRequest("download")); expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ signable: false, serviceEligibility: "not_evaluated" });
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it.each(["wrong-origin", "credentials", "hash", "wrong-path", "no-token", "duplicate-token", "http"])("never exposes provider signed URL %s", async kind => {
    const correct = `https://synthetic.supabase.co/storage/v1/object/sign/${STAFF_CERTIFICATE_DOCUMENT_BUCKET}/${objectPath()}?token=synthetic-token`;
    const bad = kind === "wrong-origin" ? correct.replace("synthetic.supabase.co", "evil.test") : kind === "credentials" ? correct.replace("https://", "https://secret:password@")
      : kind === "hash" ? `${correct}#secret` : kind === "wrong-path" ? correct.replace(id(3), id(99)) : kind === "no-token" ? correct.split("?")[0]
        : kind === "duplicate-token" ? `${correct}&token=second-synthetic-token` : correct.replace("https:", "http:");
    mocks.signed.mockResolvedValue({ data: { signedUrl: bad }, error: null }); const response = await POST(jsonRequest("download"));
    expect(response.status).toBe(502); const text = await response.text(); expect(text).not.toContain("token="); expect(text).not.toContain("password"); expect(text).not.toContain("evil.test");
  });
  it.each(["bytes", "size", "missing", "read-error"])("does not sign a download with unverified blob %s", async kind => {
    mocks.download.mockResolvedValue({ data: kind === "missing" ? null : new Blob([kind === "size" ? bytes.subarray(0, 1) : Buffer.from(bytes.map(byte => byte ^ 1))]),
      error: kind === "read-error" ? { message: "synthetic-private-provider" } : null });
    await denied(await POST(jsonRequest("download")), 409); expect(mocks.signed).not.toHaveBeenCalled();
  });
  it.each(["branch", "version", "hash", "unclean", "path", "readonly"])("denies invalid download proof %s before blob or URL creation", async kind => {
    if (kind === "readonly") mocks.actor.mockResolvedValue({ ...actor, scopes: ["staff_certificates.read"] });
    handlers.prepare_staff_certificate_document_download = () => result({ ...document(), objectPath: objectPath(), expiresSeconds: 60, canDownload: true,
      ...(kind === "branch" ? { branchId: id(99) } : kind === "version" ? { recordVersionId: id(99) } : kind === "hash" ? { recordContentHash: "c".repeat(64) }
        : kind === "unclean" ? { scanStatus: "failed" } : kind === "path" ? { objectPath: "browser://fake" } : {}) });
    await denied(await POST(jsonRequest("download")), 502); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("denies download after asynchronous storage work revoked the exact original source", async () => {
    let prepared = 0; handlers.prepare_staff_certificate_document_download = () => ++prepared === 1
      ? result({ ...document(), objectPath: objectPath(), expiresSeconds: 60, canDownload: true }) : { data: null, error: { code: "42501", message: "synthetic-private-provider" } };
    const response = await POST(jsonRequest("download")); await denied(response, 403); expect(mocks.signed).toHaveBeenCalledTimes(1);
    expect(calls("prepare_staff_certificate_document_download")).toHaveLength(2);
  });
  it("withholds the URL when a still-valid preparation changes during signing", async () => {
    let prepared = 0; handlers.prepare_staff_certificate_document_download = () => result({ ...document(),
      uploadedAt: new Date(now - (++prepared === 1 ? 3000 : 2000)).toISOString(), objectPath: objectPath(), expiresSeconds: 60, canDownload: true });
    await denied(await POST(jsonRequest("download")), 409); expect(mocks.signed).toHaveBeenCalledTimes(1);
    expect(calls("prepare_staff_certificate_document_download")).toHaveLength(2);
  });
  it("denies the final result if recent verification expires during provider work", async () => {
    let checks = 0; handlers.staff_certificate_document_recent_aal2_evidence = () => ({ data: { organizationId: actor.organizationId, branchId: actor.branchId,
      actorUserId: actor.userId, verifiedAt: new Date(now - (++checks === 1 ? 1000 : 900001)).toISOString() }, error: null });
    await denied(await POST(jsonRequest("download")), 403); expect(mocks.signed).toHaveBeenCalledTimes(1);
  });
  it("bounds an uncooperative recent evidence RPC to 20 seconds and ignores its late result", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: ProviderResult) => void;
    handlers.staff_certificate_document_recent_aal2_evidence = () => new Promise(resolve => { release = resolve; });
    const request = multipart(), pending = POST(request); await vi.advanceTimersByTimeAsync(19999); expect(request.bodyUsed).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await denied(await pending, 503); expect(vi.getTimerCount()).toBe(0);
    release({ data: { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, verifiedAt: new Date(now).toISOString() }, error: null });
    await Promise.resolve(); await Promise.resolve(); expect(request.bodyUsed).toBe(false); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it("bounds an uncooperative snapshot RPC without any alternate read or late output", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: ProviderResult) => void;
    handlers.staff_certificate_documents_snapshot = () => new Promise(resolve => { release = resolve; });
    const pending = GET(query()); await vi.advanceTimersByTimeAsync(19999); expect(mocks.admin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await denied(await pending, 503); expect(vi.getTimerCount()).toBe(0);
    release(result(snapshot())); await Promise.resolve(); await Promise.resolve();
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("clears owned deadline timers after successful evidence/download responses", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); expect((await POST(jsonRequest("download"))).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(20001); expect(mocks.signed).toHaveBeenCalledTimes(1);
  });
});
