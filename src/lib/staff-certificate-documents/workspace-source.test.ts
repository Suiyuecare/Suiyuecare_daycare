import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";

const mocks = vi.hoisted(() => ({ sources: vi.fn(), server: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./sources", () => ({ loadStaffCertificateDocumentSources: mocks.sources }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
import { loadStaffCertificateDocumentWorkspace, parseStaffCertificateDocumentsWorkspaceQuery } from "./workspace-source";

const id = (n: number) => `bc72000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T06:00:00Z");
const actor = (): TenantContext => ({ organizationId: id(1), branchId: id(2), userId: id(8), displayName: "合成主管", organizationName: "合成機構", branchName: "合成分支",
  roles: ["branch_supervisor"], scopes: ["staff_certificates.read", "staff_certificates.manage"], assuranceLevel: "aal2", recentAal2At: null, demo: false });
const row = () => ({ staffMembershipId: id(3), staffUserId: id(4), displayName: "合成員工", certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  version: 1, recordStatus: "active", certificateType: "合成證照", effectiveOn: "2026-01-01", expiresOn: "2027-01-01", canUpload: true });
const sources = () => ({ organizationId: id(1), branchId: id(2), actorUserId: id(8), staffMembershipId: null, generatedAt: new Date(now).toISOString(),
  page: 1, pageSize: 50, rows: [row()], total: 1, hasMore: false, canManageDocuments: true, serviceEligibility: "not_evaluated", signable: false, demo: false });
const documents = () => ({ organizationId: id(1), branchId: id(2), actorUserId: id(8), staffMembershipId: id(3), staffUserId: id(4), certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  generatedAt: new Date(now).toISOString(), documents: [], total: 0, truncated: false, serviceEligibility: "not_evaluated", signable: false, demo: false });
const payload = (value: unknown) => ({ data: { payload: value }, error: null });
async function failure(promise: Promise<unknown>, status: number) {
  const error: unknown = await promise.catch(value => value);
  expect(error).toBeInstanceOf(IntegrationError); expect((error as IntegrationError).httpStatus).toBe(status);
  expect(String(error)).not.toMatch(/private-provider|secret_token|service_role/u);
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  mocks.sources.mockResolvedValue(sources()); mocks.single.mockResolvedValue(payload(documents()));
  mocks.rpc.mockImplementation(() => {
    const operation = { abortSignal: () => operation, maybeSingle: mocks.single }; return operation;
  });
  mocks.server.mockResolvedValue({ rpc: mocks.rpc });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("strict page-72 read-only documents query", () => {
  it("permits only explicit documents view or an empty fallback", () => {
    expect(parseStaffCertificateDocumentsWorkspaceQuery({})).toEqual({ view: "documents", staffMembershipId: null, page: 1, versionId: null });
    expect(parseStaffCertificateDocumentsWorkspaceQuery({ view: "documents", staff: "all", page: "10000", version: id(6).toUpperCase() }))
      .toEqual({ view: "documents", staffMembershipId: null, page: 10000, versionId: id(6) });
    expect(parseStaffCertificateDocumentsWorkspaceQuery({ staff: id(3).toUpperCase(), page: "2" }).staffMembershipId).toBe(id(3));
  });
  it.each([null, [], new Date(), "documents", Object.create({ staff: "all" })])("rejects non-plain query input %j", async value => {
    await failure(loadStaffCertificateDocumentWorkspace(actor(), value as Parameters<typeof loadStaffCertificateDocumentWorkspace>[1]), 400);
    expect(mocks.sources).not.toHaveBeenCalled();
  });
  it("rejects accessors without evaluating arbitrary code", () => {
    const getter = vi.fn(() => { throw new Error("private-provider secret_token"); });
    const query = Object.defineProperty({}, "staff", { get: getter });
    expect(() => parseStaffCertificateDocumentsWorkspaceQuery(query)).toThrow(IntegrationError); expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    { view: "metadata" }, { view: "" }, { staff: "" }, { version: "" }, { page: "" }, { staff: "ALL" },
    { staff: "bad" }, { version: "bad" }, { status: "active" }, { type: "all" }, { q: "secret_token" }, { state: "all" }, { unknown: undefined },
    { view: ["documents"] }, { staff: ["all"] }, { page: ["1", "2"] }, { version: [id(6)] },
    { page: "0" }, { page: "01" }, { page: "1.0" }, { page: "+1" }, { page: " 1" }, { page: "1 " }, { page: "1e0" }, { page: "10001" }, { page: "999999" },
  ])("rejects invalid/duplicate/legacy query %j before any read", async query => {
    expect(() => parseStaffCertificateDocumentsWorkspaceQuery(query)).toThrow(IntegrationError);
    await failure(loadStaffCertificateDocumentWorkspace(actor(), query), 400); expect(mocks.sources).not.toHaveBeenCalled(); expect(mocks.server).not.toHaveBeenCalled();
  });
});

describe("staff certificate documents SSR source selection", () => {
  it("loads shared authorized sources but never automatically selects a certificate", async () => {
    expect(await loadStaffCertificateDocumentWorkspace(actor(), { view: "documents" })).toEqual({ sources: sources(), selected: null, documents: null });
    expect(mocks.sources).toHaveBeenCalledWith(actor(), { staffMembershipId: null, page: 1 }, undefined, expect.any(AbortSignal)); expect(mocks.server).not.toHaveBeenCalled();
  });
  it("accepts an exact current-page pointer and validates the real document RPC projection", async () => {
    expect(await loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) })).toEqual({ sources: sources(), selected: row(), documents: documents() });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("staff_certificate_documents_snapshot", { p_org: id(1), p_branch: id(2), p_certificate_key: id(5), p_record_version_id: id(6) });
  });
  it("returns an empty source page without synthetic replacement", async () => {
    const empty = { ...sources(), rows: [], total: 0 }; mocks.sources.mockResolvedValue(empty);
    expect(await loadStaffCertificateDocumentWorkspace(actor(), {})).toEqual({ sources: empty, selected: null, documents: null }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("pins member and page filter, without reading another page's selected version", async () => {
    mocks.sources.mockResolvedValue({ ...sources(), staffMembershipId: id(3), page: 2, rows: [], total: 1 });
    await failure(loadStaffCertificateDocumentWorkspace(actor(), { staff: id(3), page: "2", version: id(6) }), 400);
    expect(mocks.sources).toHaveBeenCalledWith(actor(), { staffMembershipId: id(3), page: 2 }, undefined, expect.any(AbortSignal)); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects unknown version rather than fetching it directly", async () => {
    await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(99) }), 400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("supports read-only self source and attachments without granting management", async () => {
    const self = { ...actor(), scopes: ["staff_certificates.read"] }, selected = { ...row(), staffUserId: self.userId, canUpload: false };
    const source = { ...sources(), rows: [selected], canManageDocuments: false };
    mocks.sources.mockResolvedValue(source); mocks.single.mockResolvedValue(payload({ ...documents(), staffUserId: self.userId }));
    const result = await loadStaffCertificateDocumentWorkspace(self, { version: id(6) }); expect(result.selected).toEqual(selected); expect(result.sources.canManageDocuments).toBe(false);
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" }, { branchId: "" }, { scopes: [] }])("denies context %j before source loading", async change => {
    await failure(loadStaffCertificateDocumentWorkspace({ ...actor(), ...change } as TenantContext, {}), 403); expect(mocks.sources).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId", "staffMembershipId"])("rejects incorrect source %s", async key => {
    const changed = { ...sources(), [key]: id(99) }; mocks.sources.mockResolvedValue(changed);
    await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ page: 2, rows: [] }, { total: 0 }, { pageSize: 25 }, { hasMore: true }, { rows: [row(), row()], total: 2 },
    { demo: true }, { signable: true }, { serviceEligibility: "eligible" }, { secret_token: "private-provider" }])("rejects malformed source %j", async change => {
    mocks.sources.mockResolvedValue({ ...sources(), ...change }); await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects management capability or other employee invented for a read-only actor", async () => {
    const self = { ...actor(), scopes: ["staff_certificates.read"] };
    await failure(loadStaffCertificateDocumentWorkspace(self, {}), 503);
    mocks.sources.mockResolvedValue({ ...sources(), canManageDocuments: false, rows: [{ ...row(), canUpload: false }] });
    await failure(loadStaffCertificateDocumentWorkspace(self, {}), 503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["2026-09-27T05:58:59.999999Z", "2026-09-27T06:00:01.000001Z", "bad"])("rejects source stale/future/invalid stamp %s before selection", async generatedAt => {
    mocks.sources.mockResolvedValue({ ...sources(), generatedAt }); await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId", "staffMembershipId", "staffUserId", "certificateKey", "recordVersionId", "recordContentHash"])("selected metadata binds document %s", async key => {
    mocks.single.mockResolvedValue(payload({ ...documents(), [key]: key === "recordContentHash" ? "c".repeat(64) : id(99) }));
    await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503);
  });
  it("rechecks source freshness after slow document read", async () => {
    mocks.sources.mockResolvedValue({ ...sources(), generatedAt: new Date(now - 50000).toISOString() });
    mocks.single.mockImplementation(async () => { vi.setSystemTime(now + 12000); return payload({ ...documents(), generatedAt: new Date(now + 12000).toISOString() }); });
    await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503);
  });
  it("rejects a document read stamp earlier than source without losing microseconds", async () => {
    mocks.sources.mockResolvedValue({ ...sources(), generatedAt: "2026-09-27T06:00:00.000001Z" });
    await failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503);
  });
  it.each([403, 409, 502, 503])("normalizes source IntegrationError %s without its raw message", async status => {
    mocks.sources.mockRejectedValue(new IntegrationError("raw-provider", "private-provider secret_token", status));
    await failure(loadStaffCertificateDocumentWorkspace(actor(), {}), status === 403 ? 403 : 503);
  });
  it("normalizes an unexpected source failure", async () => {
    mocks.sources.mockRejectedValue(new Error("private-provider secret_token")); await failure(loadStaffCertificateDocumentWorkspace(actor(), {}), 503);
  });
  it("captures query and context before a late source result", async () => {
    let resolve!: (value: unknown) => void; mocks.sources.mockReturnValue(new Promise(value => { resolve = value; }));
    const context = actor(), query = { version: id(6) }; const pending = loadStaffCertificateDocumentWorkspace(context, query);
    context.organizationId = id(99); context.scopes.length = 0; query.version = id(99); resolve(sources());
    expect((await pending).selected?.recordVersionId).toBe(id(6)); expect(mocks.rpc.mock.calls[0][1].p_org).toBe(id(1));
  });
  it("bounds the combined source and document read to 20 seconds, not 20 seconds each", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    mocks.sources.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(sources()), 12000)));
    mocks.single.mockReturnValue(new Promise(() => undefined));
    const result = failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }), 503);
    await vi.advanceTimersByTimeAsync(20000); await result; expect(mocks.rpc).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("abort fences a late source before selecting or reading attachments", async () => {
    let resolve!: (value: unknown) => void; mocks.sources.mockReturnValue(new Promise(value => { resolve = value; }));
    const controller = new AbortController(), result = failure(loadStaffCertificateDocumentWorkspace(actor(), { version: id(6) }, controller.signal), 503);
    controller.abort(); await result; resolve(sources()); await Promise.resolve(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("pre-abort never loads a source", async () => {
    const controller = new AbortController(); controller.abort(); await failure(loadStaffCertificateDocumentWorkspace(actor(), {}, controller.signal), 503); expect(mocks.sources).not.toHaveBeenCalled();
  });
  it("imports only the compiled source/read projections, never a route or privileged writer", () => {
    const source = readFileSync(new URL("./workspace-source.ts", import.meta.url), "utf8"); expect(source).toContain('import "server-only"');
    expect(source).not.toMatch(/createSupabaseAdminClient|requireRecentStaffDocumentEvidence|\.storage\b|revalidatePath|unstable_cache|@\/app\/api|fetch\(/u);
    expect(source).toContain("loadStaffCertificateDocumentSources");
  });
});
