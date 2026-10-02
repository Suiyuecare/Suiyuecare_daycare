import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";

const mocks = vi.hoisted(() => ({ server: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
import { loadStaffCertificateDocumentsSnapshot, type StaffCertificateDocumentSourceRow } from "./snapshot";

const id = (n: number) => `bb72000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T06:00:00Z");
const actor = (): TenantContext => ({ organizationId: id(1), branchId: id(2), userId: id(8), displayName: "合成主管", organizationName: "合成機構", branchName: "合成分支",
  roles: ["branch_supervisor"], scopes: ["staff_certificates.read", "staff_certificates.manage"], assuranceLevel: "aal2", recentAal2At: null, demo: false });
const row = (): StaffCertificateDocumentSourceRow => ({ staffMembershipId: id(3), staffUserId: id(4), displayName: "合成員工", certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  version: 1, recordStatus: "active", certificateType: "合成證照", effectiveOn: "2026-01-01", expiresOn: "2027-01-01", canUpload: true });
const document = () => ({ documentId: id(7), organizationId: id(1), branchId: id(2), staffMembershipId: id(3), staffUserId: id(4), certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  sha256: "b".repeat(64), mimeType: "application/pdf", fileSizeBytes: 4, uploadedBy: id(8), uploadedAt: new Date(now - 70000).toISOString(), scanStatus: "clean", persisted: true,
  serviceEligibility: "not_evaluated", signable: false, demo: false, review: null, canDownload: true });
const snapshot = () => ({ organizationId: id(1), branchId: id(2), actorUserId: id(8), staffMembershipId: id(3), staffUserId: id(4), certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  generatedAt: new Date(now).toISOString(), documents: [document()], total: 1, truncated: false, serviceEligibility: "not_evaluated", signable: false, demo: false });
const payload = (value: unknown) => ({ data: { payload: value }, error: null });
async function failure(promise: Promise<unknown>, status: number) {
  const error: unknown = await promise.catch(value => value);
  expect(error).toBeInstanceOf(IntegrationError); expect((error as IntegrationError).httpStatus).toBe(status);
  expect(String(error)).not.toMatch(/private-provider|secret_token|service_role|clinical-answer/u);
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  mocks.single.mockResolvedValue(payload(snapshot()));
  mocks.rpc.mockImplementation(() => {
    const operation = { abortSignal: (signal: AbortSignal) => { mocks.abortSignal(signal); return operation; }, maybeSingle: mocks.single };
    return operation;
  });
  mocks.server.mockResolvedValue({ rpc: mocks.rpc });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("selected staff certificate documents user-scoped SSR snapshot", () => {
  it("loads only the selected record through the original audited read RPC, without recent evidence", async () => {
    expect(await loadStaffCertificateDocumentsSnapshot(actor(), row())).toEqual(snapshot());
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("staff_certificate_documents_snapshot", { p_org: id(1), p_branch: id(2), p_certificate_key: id(5), p_record_version_id: id(6) });
    expect(mocks.abortSignal).toHaveBeenCalledOnce();
  });
  it("allows actual read-only own history with no invented fresh MFA", async () => {
    const self = { ...actor(), scopes: ["staff_certificates.read"] };
    const selected = { ...row(), staffUserId: self.userId, canUpload: false };
    mocks.single.mockResolvedValue(payload({ ...snapshot(), staffUserId: self.userId, documents: [{ ...document(), staffUserId: self.userId }] }));
    expect((await loadStaffCertificateDocumentsSnapshot(self, selected)).staffUserId).toBe(self.userId);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("preserves an explicitly selected voided source without granting writer access", async () => {
    expect(await loadStaffCertificateDocumentsSnapshot(actor(), { ...row(), recordStatus: "voided", canUpload: false })).toEqual(snapshot());
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" }, { branchId: "" }, { scopes: [] }, { scopes: ["staff_certificates.manage"] }, { userId: "invalid" }])("denies inadmissible context %j before client creation", async change => {
    await failure(loadStaffCertificateDocumentsSnapshot({ ...actor(), ...change } as TenantContext, row()), 403);
    expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies other employee selection to read-only staff", async () => {
    await failure(loadStaffCertificateDocumentsSnapshot({ ...actor(), scopes: ["staff_certificates.read"] }, row()), 403);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each(["staffMembershipId", "staffUserId", "certificateKey", "recordVersionId"])("rejects invalid selected %s before RPC", async key => {
    await failure(loadStaffCertificateDocumentsSnapshot(actor(), { ...row(), [key]: "bad" }), 400); expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId", "staffMembershipId", "staffUserId", "certificateKey", "recordVersionId", "recordContentHash"])("rejects mismatched outer %s even with internally consistent nested documents", async key => {
    const value = key === "recordContentHash" ? "c".repeat(64) : id(99);
    const original = snapshot(); const changed = { ...original, [key]: value, documents: [{ ...document(), ...(key !== "actorUserId" ? { [key]: value } : {}) }] };
    mocks.single.mockResolvedValue(payload(changed)); await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
  });
  it.each(["organizationId", "branchId", "staffMembershipId", "staffUserId", "certificateKey", "recordVersionId", "recordContentHash"])("rejects mismatched nested %s", async key => {
    mocks.single.mockResolvedValue(payload({ ...snapshot(), documents: [{ ...document(), [key]: key === "recordContentHash" ? "c".repeat(64) : id(99) }] }));
    await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
  });
  it.each(["2026-09-27T05:58:59.999999Z", "2026-09-27T06:00:01.000001Z", "2026-09-27T06:00:01.001Z", "not-a-time"])("rejects stale/future/invalid read timestamp %s", async generatedAt => {
    mocks.single.mockResolvedValue(payload({ ...snapshot(), generatedAt })); await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
  });
  it.each(["2026-09-27T05:59:00Z", "2026-09-27T06:00:01Z", "2026-09-27T14:00:00.999999+08:00"])("accepts exact freshness boundary %s", async generatedAt => {
    mocks.single.mockResolvedValue(payload({ ...snapshot(), generatedAt })); expect((await loadStaffCertificateDocumentsSnapshot(actor(), row())).generatedAt).toBe(generatedAt);
  });
  it.each([{ demo: true }, { signable: true }, { serviceEligibility: "eligible" }, { total: 0 }, { truncated: true }, { secret_token: "private-provider" }, { documents: [document(), document()], total: 2 }])("rejects malformed snapshot %j", async change => {
    mocks.single.mockResolvedValue(payload({ ...snapshot(), ...change })); await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
  });
  it("rejects forged independent human review", async () => {
    const { review: unusedReview, canDownload: unusedDownload, ...base } = document(); void unusedReview; void unusedDownload;
    mocks.single.mockResolvedValue(payload({ ...snapshot(), documents: [{ ...document(), review: { ...base, reviewId: id(9), reviewedBy: base.uploadedBy, reviewedAt: new Date(now - 60000).toISOString(), decision: "verified", reason: "合成核驗", replayed: false } }] }));
    await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
  });
  it.each(["42501", "23514", "private-provider"])("normalizes provider SQL failure %s", async code => {
    mocks.single.mockResolvedValue({ data: null, error: { code, message: "private-provider secret_token clinical-answer" } });
    await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), code === "42501" ? 403 : 503);
  });
  it("normalizes thrown provider errors and missing client", async () => {
    mocks.server.mockRejectedValue(new Error("private-provider secret_token")); await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
    mocks.server.mockResolvedValue(null); await failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
  });
  it("captures authority and selected metadata before a suspended client resolves", async () => {
    let resolve!: (value: unknown) => void; mocks.server.mockReturnValue(new Promise(value => { resolve = value; }));
    const context = actor(), selected = row(); const operation = loadStaffCertificateDocumentsSnapshot(context, selected);
    context.organizationId = id(99); context.scopes.length = 0; selected.recordContentHash = "c".repeat(64);
    resolve({ rpc: mocks.rpc }); expect(await operation).toEqual(snapshot()); expect(mocks.rpc.mock.calls[0][1].p_org).toBe(id(1));
  });
  it("pre-abort reads nothing", async () => {
    const controller = new AbortController(); controller.abort(); await failure(loadStaffCertificateDocumentsSnapshot(actor(), row(), controller.signal), 503);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each(["client", "rpc"])("bounds an uncooperative stalled %s at 20 seconds", async stage => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    (stage === "client" ? mocks.server : mocks.single).mockReturnValue(new Promise(() => undefined));
    const result = failure(loadStaffCertificateDocumentsSnapshot(actor(), row()), 503);
    await vi.advanceTimersByTimeAsync(20000); await result; expect(vi.getTimerCount()).toBe(0);
  });
  it("abort fences an uncooperative late client before any RPC", async () => {
    let resolve!: (value: unknown) => void; mocks.server.mockReturnValue(new Promise(value => { resolve = value; }));
    const controller = new AbortController(), result = failure(loadStaffCertificateDocumentsSnapshot(actor(), row(), controller.signal), 503);
    controller.abort(); await result; resolve({ rpc: mocks.rpc }); await Promise.resolve(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("abort never publishes an ignored late RPC result", async () => {
    let resolve!: (value: unknown) => void; mocks.single.mockReturnValue(new Promise(value => { resolve = value; }));
    const controller = new AbortController(), result = failure(loadStaffCertificateDocumentsSnapshot(actor(), row(), controller.signal), 503);
    await Promise.resolve(); controller.abort(); await result; resolve(payload(snapshot())); await Promise.resolve(); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("server source imports contain no privileged upload, scanner, storage, cache or MFA acquisition", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain('import "server-only"');
    expect(source).not.toMatch(/createSupabaseAdminClient|requireRecentStaffDocumentEvidence|\.storage\b|revalidatePath|unstable_cache|fetch\(/u);
    expect([...source.matchAll(/\.rpc\("([^"]+)"/gu)].map(match => match[1])).toEqual(["staff_certificate_documents_snapshot"]);
  });
});
