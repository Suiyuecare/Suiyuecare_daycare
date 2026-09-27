import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), server: vi.fn(), rpc: vi.fn(), admin: vi.fn(), abortSignal: vi.fn(),
  configuration: { NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test", NODE_ENV: "production" } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/env", () => ({ env: mocks.configuration }));

import { GET as sourcesGet } from "@/app/api/staff-certificate-documents/sources/route";
import { GET as receiptGet } from "@/app/api/staff-certificate-documents/receipt/route";
import { POST as reconcilePost } from "@/app/api/staff-certificate-documents/reconcile/route";
import { loadStaffCertificateDocumentSources } from "./sources";

const id = (n: number) => `bd49000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T06:00:00Z"), origin = mocks.configuration.NEXT_PUBLIC_APP_ORIGIN;
const actor: TenantContext = { organizationId: id(1), branchId: id(2), userId: id(8), displayName: "合成使用者", organizationName: "合成機構", branchName: "合成分支",
  roles: ["branch_supervisor"], scopes: ["staff_certificates.read", "staff_certificates.manage"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const scope = { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId };
const reserveBinding = () => ({ staffMembershipId: id(3), certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  sha256: "b".repeat(64), mimeType: "image/png", fileSizeBytes: 67 });
const reason = "核對合成原件 ✅", reasonHash = createHash("sha256").update(reason, "utf8").digest("hex");
const reviewBinding = () => ({ documentId: id(7), recordVersionId: id(6), recordContentHash: "a".repeat(64), decision: "verified", reasonSha256: reasonHash });
const baseDocument = () => ({ documentId: id(7), organizationId: id(1), branchId: id(2), ...reserveBinding(), staffUserId: id(4), uploadedBy: id(8),
  uploadedAt: new Date(now - 3000).toISOString(), scanStatus: "clean", persisted: true, serviceEligibility: "not_evaluated", signable: false, demo: false });
const common = () => ({ schemaVersion: 1, ...scope, idempotencyKey: id(9), nonce: id(10), checkedAt: new Date(now).toISOString(),
  serviceEligibility: "not_evaluated", signable: false, demo: false });
const completed = () => ({ ...common(), action: "reserve", binding: reserveBinding(), status: "completed", receipt: baseDocument(), persisted: true, reservationState: null, closure: null });
const notFound = () => ({ ...completed(), status: "not_found", receipt: null, persisted: false });
const reserved = (reservationState = "pending") => ({ ...completed(), status: "reserved", receipt: { ...baseDocument(), scanStatus: "reserved" }, reservationState });
const reviewed = () => ({ ...common(), action: "review", binding: reviewBinding(), status: "completed", receipt: { ...baseDocument(), uploadedBy: id(12), reviewId: id(13),
  reviewedBy: actor.userId, reviewedAt: new Date(now - 2000).toISOString(), reason, decision: "verified", replayed: false }, persisted: true, reservationState: null, closure: null });
const closure = () => ({ terminationId: id(14), documentId: id(7), originalIdempotencyKey: id(9), reconciliationKey: id(11), closedBy: actor.userId,
  closedAt: new Date(now - 1000).toISOString(), reason: "reservation_expired" });
const closureInput = () => ({ originalIdempotencyKey: id(9), reconciliationKey: id(11), binding: reserveBinding(), nonce: id(10) });
const closed = () => ({ ...completed(), status: "expired_closed", receipt: { ...baseDocument(), scanStatus: "reserved" }, closure: closure() });
const closureResult = () => ({ ...closed(), reconciliationKey: id(11), replayed: false });
const sourceRow = () => ({ staffMembershipId: id(3), staffUserId: id(4), displayName: "合成員工", certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  version: 1, recordStatus: "active", certificateType: "合成證照", effectiveOn: "2026-01-01", expiresOn: "2027-01-01", canUpload: true });
const sources = () => ({ ...scope, staffMembershipId: null, generatedAt: new Date(now).toISOString(), page: 1, pageSize: 50, rows: [sourceRow()], total: 1,
  hasMore: false, canManageDocuments: true, serviceEligibility: "not_evaluated", signable: false, demo: false });
type Provider = { data: unknown; error: null | { code: string; message?: string } };
type Handler = (args: Record<string, unknown>) => Provider | Promise<Provider>;
let handlers: Record<string, Handler>;
const payload = (value: unknown): Provider => ({ data: { payload: value }, error: null });
const headers = () => ({ "x-organization-id": actor.organizationId, "x-branch-id": actor.branchId });
const bindingHeader = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const sourceRequest = (query = "", customHeaders: Record<string, string> = {}) => new Request(`${origin}/api/staff-certificate-documents/sources${query}`, { headers: { ...headers(), ...customHeaders } });
function receiptRequest(action = "reserve", customHeaders: Record<string, string> = {}, query = "") {
  return new Request(`${origin}/api/staff-certificate-documents/receipt${query}`, { headers: { ...headers(), "x-staff-document-action": action,
    "idempotency-key": id(9), "x-staff-document-receipt-nonce": id(10), "x-staff-document-binding": bindingHeader(action === "review" ? reviewBinding() : reserveBinding()), ...customHeaders } });
}
const reconcileRequest = (value: unknown = closureInput(), customHeaders: Record<string, string> = {}, query = "") => new Request(`${origin}/api/staff-certificate-documents/reconcile${query}`, {
  method: "POST", headers: { ...headers(), origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...customHeaders }, body: JSON.stringify(value) });
async function denial(response: Response, status: number) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toContain("private"); expect(response.headers.get("cache-control")).toContain("no-store");
  const value = await response.json(); expect(value.data).toBeNull(); expect(value.errors.length).toBeGreaterThan(0);
  expect(JSON.stringify(value)).not.toMatch(/synthetic-private-provider|stack|service_role|secret_token/u); return value;
}
const calls = (name: string) => mocks.rpc.mock.calls.filter(([rpc]) => rpc === name);
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  handlers = { staff_certificate_document_sources: () => payload(sources()), staff_certificate_document_operation_receipt: () => payload(completed()),
    reconcile_expired_staff_certificate_document: () => payload(closureResult()), staff_certificate_document_recent_aal2_evidence: () => ({ data: { ...scope, verifiedAt: new Date(now - 1000).toISOString() }, error: null }) };
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "staff_certificate_document_recent_aal2_evidence"
    ? Promise.resolve(handlers[name](args)) : (() => {
      const builder = { abortSignal: (signal: AbortSignal) => { mocks.abortSignal(signal); return builder; },
        maybeSingle: () => Promise.resolve(handlers[name](args)) };
      return builder;
    })());
  mocks.actor.mockResolvedValue(actor); mocks.server.mockResolvedValue({ rpc: mocks.rpc });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("actual staff document source/receipt/reconciliation HTTP contracts", () => {
  it("reads the document-only source with explicit branch pinning and no alternate/admin writer", async () => {
    const response = await sourcesGet(sourceRequest()); expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ snapshot: sources() });
    expect(mocks.rpc).toHaveBeenCalledWith("staff_certificate_document_sources", { p_org: actor.organizationId, p_branch: actor.branchId, p_staff_membership_id: null, p_page: 1 });
    expect(mocks.admin).not.toHaveBeenCalled(); expect(calls("staff_certificate_document_recent_aal2_evidence")).toHaveLength(0);
  });
  it("accepts exact source member/page and verifies them in the result", async () => {
    handlers.staff_certificate_document_sources = () => payload({ ...sources(), staffMembershipId: id(3), page: 2, rows: [], total: 1 });
    expect((await sourcesGet(sourceRequest(`?staffMembershipId=${id(3)}&page=2`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("staff_certificate_document_sources", { p_org: actor.organizationId, p_branch: actor.branchId, p_staff_membership_id: id(3), p_page: 2 });
  });
  it.each(["?page=0", "?page=01", "?page=1.0", "?page=+1", "?page=10001", "?page=", "?page=1&page=2", "?extra=1", "?staffMembershipId=bad"])("rejects malformed source query %s before admission/RPC", async query => {
    await denial(await sourcesGet(sourceRequest(query)), 400); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["sources", "receipt", "reconcile"])("requires literal scope for %s before reading source or body", async route => {
    const request = route === "sources" ? sourceRequest() : route === "receipt" ? receiptRequest() : reconcileRequest(); request.headers.delete("x-branch-id");
    await denial(await (route === "sources" ? sourcesGet(request) : route === "receipt" ? receiptGet(request) : reconcilePost(request)), 400);
    expect(request.bodyUsed).toBe(false); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id"])("rejects switched %s rather than silently using the new active branch", async header => {
    for (const request of [sourceRequest("", { [header]: id(99) }), receiptRequest("reserve", { [header]: id(99) }), reconcileRequest(closureInput(), { [header]: id(99) })]) {
      const route = new URL(request.url).pathname.split("/").pop(); await denial(await (route === "sources" ? sourcesGet(request) : route === "receipt" ? receiptGet(request) : reconcilePost(request)), 403);
      expect(request.bodyUsed).toBe(false);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...actor, demo: true }, { ...actor, assuranceLevel: "aal1" }, { ...actor, scopes: [] }])("keeps all new routes fail closed for denied actor", async deniedActor => {
    mocks.actor.mockResolvedValue(deniedActor);
    for (const [handle, request] of [[sourcesGet, sourceRequest()], [receiptGet, receiptRequest()], [reconcilePost, reconcileRequest()]] as const) {
      await denial(await handle(request), deniedActor === null ? 401 : 403); expect(request.bodyUsed).toBe(false);
    }
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("allows read-only own original lookup without recent MFA, but cannot terminate it", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["staff_certificates.read"] });
    expect((await receiptGet(receiptRequest())).status).toBe(200);
    expect(calls("staff_certificate_document_recent_aal2_evidence")).toHaveLength(0);
    const request = reconcileRequest(); await denial(await reconcilePost(request), 403); expect(request.bodyUsed).toBe(false);
    expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(0);
  });
  it("projects only authorized read-only self source, not old certificate writer authority", async () => {
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["staff_certificates.read"] });
    handlers.staff_certificate_document_sources = () => payload({ ...sources(), canManageDocuments: false, rows: [{ ...sourceRow(), staffUserId: actor.userId, canUpload: false }] });
    expect((await sourcesGet(sourceRequest())).status).toBe(200);
    handlers.staff_certificate_document_sources = () => payload(sources()); await denial(await sourcesGet(sourceRequest()), 502);
  });
  it.each(["organizationId", "branchId", "actorUserId", "page", "member", "fresh", "future", "extra", "qualification"])("rejects source payload discrepancy %s", async field => {
    handlers.staff_certificate_document_sources = () => payload({ ...sources(), ...(field === "page" ? { page: 2 } : field === "member" ? { staffMembershipId: id(99) }
      : field === "fresh" ? { generatedAt: new Date(now - 60001).toISOString() } : field === "future" ? { generatedAt: new Date(now + 1001).toISOString() }
        : field === "extra" ? { privateText: "synthetic-private-provider" } : field === "qualification" ? { signable: true } : { [field]: id(99) }) });
    await denial(await sourcesGet(sourceRequest()), 502);
  });
  it("shared SSR loader denies demo or unconfigured user client with no fallback", async () => {
    await expect(loadStaffCertificateDocumentSources({ ...actor, demo: true }, { staffMembershipId: null, page: 1 })).rejects.toMatchObject({ httpStatus: 403 });
    mocks.server.mockResolvedValue(null); await expect(loadStaffCertificateDocumentSources(actor, { staffMembershipId: null, page: 1 })).rejects.toMatchObject({ httpStatus: 503 });
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["completed", "not_found", "pending", "expired", "closed"])("reads exact original %s as information, with zero extra business write", async state => {
    const proof = state === "completed" ? completed() : state === "not_found" ? notFound() : state === "closed" ? closed() : reserved(state);
    handlers.staff_certificate_document_operation_receipt = () => payload(proof); const response = await receiptGet(receiptRequest()); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ receipt: proof }); expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["staff_certificate_document_operation_receipt"]);
    expect(mocks.rpc).toHaveBeenCalledWith("staff_certificate_document_operation_receipt", { p_org: actor.organizationId, p_branch: actor.branchId,
      p_action: "reserve", p_key: id(9), p_nonce: id(10), p_binding: reserveBinding() }); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("verifies actual original review reason digest without putting the reason in request headers", async () => {
    handlers.staff_certificate_document_operation_receipt = () => payload(reviewed());
    const request = receiptRequest("review"); expect(request.headers.get("x-staff-document-binding")).not.toContain(reason);
    const response = await receiptGet(request); expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ receipt: reviewed() });
    handlers.staff_certificate_document_operation_receipt = () => payload({ ...reviewed(), receipt: { ...reviewed().receipt, reason: "另一份不同原件" } });
    await denial(await receiptGet(receiptRequest("review")), 502);
  });
  it.each(["empty", "padding", "not-json", "invalid-utf8", "too-large", "extra-field", "bad-nonce", "bad-key", "bad-action"])("rejects malformed operation header %s before provider", async kind => {
    const change: Record<string, string> = kind === "empty" ? { "x-staff-document-binding": "" } : kind === "padding" ? { "x-staff-document-binding": `${bindingHeader(reserveBinding())}=` }
      : kind === "not-json" ? { "x-staff-document-binding": Buffer.from("garbage").toString("base64url") }
        : kind === "invalid-utf8" ? { "x-staff-document-binding": Buffer.from([0xc3, 0x28]).toString("base64url") }
          : kind === "too-large" ? { "x-staff-document-binding": "A".repeat(2049) }
            : kind === "extra-field" ? { "x-staff-document-binding": bindingHeader({ ...reserveBinding(), scanStatus: "clean" }) }
              : kind === "bad-nonce" ? { "x-staff-document-receipt-nonce": "bad" } : kind === "bad-key" ? { "idempotency-key": "bad" } : { "x-staff-document-action": "scan" };
    await denial(await receiptGet(receiptRequest("reserve", change)), 400); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["receipt", "sources"])("rejects a %s GET with body/method/declared-body and never starts a mutation", async route => {
    const handle = route === "receipt" ? receiptGet : sourcesGet, request = route === "receipt" ? receiptRequest() : sourceRequest();
    request.headers.set("content-length", "1"); await denial(await handle(request), 400);
    const body = new Request(request.url, { method: "POST", headers: request.headers, body: "sensitive" }); await denial(await handle(body), 400);
    expect(body.bodyUsed).toBe(false); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["receipt", "sources"])("rejects transfer-encoding on %s before admission", async route => {
    const request = route === "receipt" ? receiptRequest() : sourceRequest(); request.headers.set("transfer-encoding", "chunked");
    await denial(await (route === "receipt" ? receiptGet(request) : sourcesGet(request)), 400); expect(mocks.actor).not.toHaveBeenCalled();
  });
  it("rejects a second idempotency header alias rather than guessing the original key", async () => {
    await denial(await receiptGet(receiptRequest("reserve", { "x-idempotency-key": id(9) })), 400); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId", "idempotencyKey", "nonce", "binding", "stale", "future", "extra", "fake-sign"])("rejects original receipt mismatch %s without raw result leakage", async field => {
    handlers.staff_certificate_document_operation_receipt = () => payload({ ...completed(), ...(field === "binding" ? { binding: { ...reserveBinding(), sha256: "c".repeat(64) } }
      : field === "stale" ? { checkedAt: new Date(now - 60001).toISOString() } : field === "future" ? { checkedAt: new Date(now + 1001).toISOString() }
        : field === "extra" ? { privateData: "synthetic-private-provider" } : field === "fake-sign" ? { signable: true } : { [field]: id(99) }) });
    await denial(await receiptGet(receiptRequest()), 502);
  });
  it("posts explicit original expired closure only with fresh live evidence and exact separate key", async () => {
    const request = reconcileRequest(), response = await reconcilePost(request); expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({ receipt: closureResult() });
    expect(mocks.rpc).toHaveBeenCalledWith("reconcile_expired_staff_certificate_document", { p_org: actor.organizationId, p_branch: actor.branchId,
      p_key: id(9), p_reconciliation_key: id(11), p_binding: reserveBinding(), p_nonce: id(10) }); expect(calls("staff_certificate_document_recent_aal2_evidence")).toHaveLength(1);
  });
  it("preserves immutable closure replay and returns an already completed original without a fictitious termination", async () => {
    handlers.reconcile_expired_staff_certificate_document = () => payload({ ...closureResult(), replayed: true }); expect((await reconcilePost(reconcileRequest())).status).toBe(200);
    handlers.reconcile_expired_staff_certificate_document = () => payload({ ...completed(), reconciliationKey: id(11), replayed: true });
    const response = await reconcilePost(reconcileRequest()); expect(response.status).toBe(200); expect((await response.json()).data.receipt.closure).toBeNull();
  });
  it.each(["origin", "cross-site", "media", "query"])("rejects closure %s before consuming body/admission", async kind => {
    const request = reconcileRequest(closureInput(), {}, kind === "query" ? "?force=1" : "");
    if (kind === "origin") request.headers.delete("origin"); if (kind === "cross-site") request.headers.set("sec-fetch-site", "cross-site"); if (kind === "media") request.headers.set("content-type", "multipart/form-data; boundary=123");
    await denial(await reconcilePost(request), kind === "media" ? 415 : kind === "query" ? 400 : 403);
    expect(request.bodyUsed).toBe(false); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["expired", "wrong-actor", "bad-shape"])("rejects invalid closure recent evidence %s before request body", async kind => {
    handlers.staff_certificate_document_recent_aal2_evidence = () => ({ data: { ...scope, verifiedAt: new Date(now - (kind === "expired" ? 900001 : 1000)).toISOString(),
      ...(kind === "wrong-actor" ? { actorUserId: id(99) } : kind === "bad-shape" ? { unsafe: "synthetic-private-provider" } : {}) }, error: null });
    const request = reconcileRequest(); await denial(await reconcilePost(request), 403); expect(request.bodyUsed).toBe(false); expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(0);
  });
  it.each(["same-key", "wrong-binding", "force", "bad-json"])("rejects invalid explicit reconciliation %s without writing", async kind => {
    const value = kind === "same-key" ? { ...closureInput(), reconciliationKey: id(9) } : kind === "wrong-binding" ? { ...closureInput(), binding: reviewBinding() }
      : kind === "force" ? { ...closureInput(), reservationExpired: true } : "not JSON object";
    await denial(await reconcilePost(reconcileRequest(value)), 400); expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(0);
  });
  it.each(["not_found", "reserved", "wrong-reconciliation", "wrong-actor", "future"])("rejects uncertain or substituted termination proof %s", async kind => {
    handlers.reconcile_expired_staff_certificate_document = () => payload(kind === "not_found" ? { ...notFound(), reconciliationKey: id(11), replayed: false }
      : kind === "reserved" ? { ...reserved("expired"), reconciliationKey: id(11), replayed: false }
        : { ...closureResult(), ...(kind === "wrong-reconciliation" ? { reconciliationKey: id(99) } : kind === "wrong-actor" ? { actorUserId: id(99) } : { checkedAt: new Date(now + 1001).toISOString() }) });
    await denial(await reconcilePost(reconcileRequest()), 502);
  });
  it.each(["42501", "40001", "23505", "unexpected"])("sanitizes user provider errors %s without admin fallback or changing operation", async code => {
    const failed = () => ({ data: null, error: { code, message: "synthetic-private-provider" } });
    handlers.staff_certificate_document_sources = failed; handlers.staff_certificate_document_operation_receipt = failed; handlers.reconcile_expired_staff_certificate_document = failed;
    for (const [handle, request] of [[sourcesGet, sourceRequest()], [receiptGet, receiptRequest()], [reconcilePost, reconcileRequest()]] as const) await denial(await handle(request), code === "42501" ? 403 : 409);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["source", "receipt", "closure"])("bounds uncooperative %s provider work and ignores late results", async target => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: Provider) => void;
    const rpc = target === "source" ? "staff_certificate_document_sources" : target === "receipt" ? "staff_certificate_document_operation_receipt" : "reconcile_expired_staff_certificate_document";
    handlers[rpc] = () => new Promise(resolve => { release = resolve; });
    const pending = target === "source" ? sourcesGet(sourceRequest()) : target === "receipt" ? receiptGet(receiptRequest()) : reconcilePost(reconcileRequest());
    await vi.advanceTimersByTimeAsync(20000); await denial(await pending, 503); expect(vi.getTimerCount()).toBe(0);
    const before = mocks.rpc.mock.calls.length; release(payload(target === "source" ? sources() : target === "receipt" ? completed() : closureResult()));
    await Promise.resolve(); await Promise.resolve(); expect(mocks.rpc.mock.calls).toHaveLength(before); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("bounds a hung reason digest and never treats its late result as another response", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: ArrayBuffer) => void;
    handlers.staff_certificate_document_operation_receipt = () => payload(reviewed());
    vi.stubGlobal("crypto", { subtle: { digest: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) } });
    const pending = receiptGet(receiptRequest("review")); await vi.advanceTimersByTimeAsync(20000); await denial(await pending, 503); expect(vi.getTimerCount()).toBe(0);
    release(Uint8Array.from(Buffer.from(reasonHash, "hex")).buffer); await Promise.resolve(); await Promise.resolve(); expect(calls("staff_certificate_document_operation_receipt")).toHaveLength(1);
  });
  it.each(["sources", "receipt", "closure"])("pre-cancelled %s starts no admission/provider/body operation", async target => {
    const controller = new AbortController(); controller.abort();
    const original = target === "sources" ? sourceRequest() : target === "receipt" ? receiptRequest() : reconcileRequest();
    const request = new Request(original, { signal: controller.signal });
    await denial(await (target === "sources" ? sourcesGet(request) : target === "receipt" ? receiptGet(request) : reconcilePost(request)), 503);
    expect(request.bodyUsed).toBe(false); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["sources", "receipt", "closure"])("blocked %s authentication times out before late provider work can start", async target => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: TenantContext) => void;
    mocks.actor.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const request = target === "sources" ? sourceRequest() : target === "receipt" ? receiptRequest() : reconcileRequest();
    const pending = target === "sources" ? sourcesGet(request) : target === "receipt" ? receiptGet(request) : reconcilePost(request);
    await vi.advanceTimersByTimeAsync(20000); await denial(await pending, 503); expect(request.bodyUsed).toBe(false);
    release(actor); await Promise.resolve(); await Promise.resolve(); expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("a blocked server constructor cannot dispatch reconciliation after its deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: { rpc: typeof mocks.rpc }) => void;
    mocks.server.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const request = reconcileRequest(), pending = reconcilePost(request);
    await vi.advanceTimersByTimeAsync(20000); await denial(await pending, 503); expect(request.bodyUsed).toBe(false);
    release({ rpc: mocks.rpc }); await Promise.resolve(); await Promise.resolve(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("shares one 20 second budget across slow admission and an uncooperative original GET", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: Provider) => void;
    mocks.actor.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(actor), 18000)));
    handlers.staff_certificate_document_operation_receipt = () => new Promise(resolve => { release = resolve; });
    const pending = receiptGet(receiptRequest()); await vi.advanceTimersByTimeAsync(19999);
    expect(mocks.abortSignal).toHaveBeenCalledTimes(1); expect(mocks.abortSignal.mock.calls[0][0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await denial(await pending, 503); expect(mocks.abortSignal.mock.calls[0][0].aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    release(payload(completed())); await vi.advanceTimersByTimeAsync(0); expect(calls("staff_certificate_document_operation_receipt")).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("caller cancellation fences a late issued write but never claims its database rollback", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: Provider) => void;
    handlers.reconcile_expired_staff_certificate_document = () => new Promise(resolve => { release = resolve; });
    const controller = new AbortController(), request = new Request(reconcileRequest(), { signal: controller.signal });
    const pending = reconcilePost(request); await vi.advanceTimersByTimeAsync(0); expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(1);
    controller.abort(); await denial(await pending, 503); expect(mocks.abortSignal.mock.calls[0][0].aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    release(payload(closureResult())); await vi.advanceTimersByTimeAsync(0); expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("caller cancellation during recent verification starts no late reconciliation or body read", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: Provider) => void;
    handlers.staff_certificate_document_recent_aal2_evidence = () => new Promise(resolve => { release = resolve; });
    const controller = new AbortController(), request = new Request(reconcileRequest(), { signal: controller.signal });
    const pending = reconcilePost(request); await vi.advanceTimersByTimeAsync(0); controller.abort(); await denial(await pending, 503); expect(vi.getTimerCount()).toBe(0);
    release({ data: { ...scope, verifiedAt: new Date(now - 1000).toISOString() }, error: null }); await vi.advanceTimersByTimeAsync(0);
    expect(request.bodyUsed).toBe(false); expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("caller cancellation during authentication clears all owner timers before the provider resolves", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: TenantContext) => void;
    mocks.actor.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const controller = new AbortController(), request = new Request(reconcileRequest(), { signal: controller.signal });
    const pending = reconcilePost(request); await vi.advanceTimersByTimeAsync(1); controller.abort(); await denial(await pending, 503);
    expect(vi.getTimerCount()).toBe(0); expect(request.bodyUsed).toBe(false); expect(mocks.server).not.toHaveBeenCalled();
    release(actor); await vi.advanceTimersByTimeAsync(0); expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("caller cancellation during reason hashing clears all timers and cannot publish its late digest", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let release!: (value: ArrayBuffer) => void;
    handlers.staff_certificate_document_operation_receipt = () => payload(reviewed());
    vi.stubGlobal("crypto", { subtle: { digest: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) } });
    const controller = new AbortController(), request = new Request(receiptRequest("review"), { signal: controller.signal });
    const pending = receiptGet(request); await vi.advanceTimersByTimeAsync(1); controller.abort(); await denial(await pending, 503);
    expect(vi.getTimerCount()).toBe(0); release(Uint8Array.from(Buffer.from(reasonHash, "hex")).buffer); await vi.advanceTimersByTimeAsync(0);
    expect(calls("staff_certificate_document_operation_receipt")).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["caller-abort", "whole-deadline"])("cleans actual stalled body reader and timers on %s without starting closure", async finish => {
    vi.useFakeTimers(); vi.setSystemTime(now); const cancelled = vi.fn(), controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ pull() {}, cancel: cancelled });
    if (finish === "whole-deadline") mocks.actor.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(actor), 18000)));
    const request = new Request(`${origin}/api/staff-certificate-documents/reconcile`, { method: "POST", headers: { ...headers(), origin,
      "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: stream, signal: controller.signal, duplex: "half" } as RequestInit & { duplex: "half" });
    const pending = reconcilePost(request); await vi.advanceTimersByTimeAsync(finish === "whole-deadline" ? 19999 : 1);
    expect(request.bodyUsed).toBe(true); expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(0);
    if (finish === "caller-abort") controller.abort(); else await vi.advanceTimersByTimeAsync(1);
    await denial(await pending, 503); await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toHaveBeenCalledTimes(1); expect(request.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(calls("reconcile_expired_staff_certificate_document")).toHaveLength(0);
  });
  it("clears successful full-route deadline without late aborting its already read proof", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); expect((await receiptGet(receiptRequest())).status).toBe(200);
    const signal = mocks.abortSignal.mock.calls[0][0] as AbortSignal; expect(signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20001); expect(signal.aborted).toBe(false); expect(calls("staff_certificate_document_operation_receipt")).toHaveLength(1);
  });
});
