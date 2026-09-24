import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoFormResponses } from "@/lib/custom-form-responses/demo";
import { IntegrationError } from "@/lib/integrations/errors";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), reauth: vi.fn(), db: vi.fn(), rpc: vi.fn(), render: vi.fn(), readFile: vi.fn(), hash: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async (original) => ({ ...await original<typeof import("@/lib/integrations/http")>(), authorizeStaffRequest: mocks.authorize, requireRecentAal2: mocks.reauth }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/integrations/security", () => ({ sha256Hex: mocks.hash }));
vi.mock("@/lib/document-printing/pdf-renderer", () => ({ renderDocumentPdf: mocks.render }));
import { GET } from "./route";
import { issuePrintToken } from "@/lib/custom-form-responses/print-token";
const record = buildDemoFormResponses("2026-09-22").records[0]!;
const actor = { userId: "d8100000-0000-4000-8000-000000000001", organizationId: "d8500000-0000-4000-8000-000000000001", branchId: "d8600000-0000-4000-8000-000000000001", scopes: ["care_records.read", "document_printing.read", "document_printing.access"], assuranceLevel: "aal2", demo: false };
const job = { jobId: "d9600000-0000-4000-8000-000000000002", responseId: record.id, clientId: record.clientId, actorId: actor.userId, organizationId: actor.organizationId, branchId: actor.branchId,
  createdAt: "2026-09-22T06:00:00Z", expiresAt: "2026-09-22T06:05:00Z", snapshotHash: "a".repeat(64), replayed: false,
  snapshot: { response: record, organizationName: "合成機構", branchName: "合成分支", clientCode: "DEMO-01", clientName: "合成個案", formName: "合成表單", formKey: "tenant.custom.synthetic", formVersion: 1, preparedByName: "合成使用者" } };
const invoke = (query = `token=${issuePrintToken(job)}`, jobId = job.jobId) => GET(new Request(`https://example.invalid/api/forms/responses/prints/${jobId}/pdf?${query}`), { params: Promise.resolve({ jobId }) });
describe("authenticated private PDF bytes", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(job.createdAt)); vi.stubEnv("DOCUMENT_DOWNLOAD_SIGNING_SECRET", "s".repeat(48));
    mocks.authorize.mockResolvedValue(actor); mocks.reauth.mockResolvedValue(undefined); mocks.db.mockResolvedValue({ rpc: (...args: unknown[]) => ({ abortSignal: () => mocks.rpc(...args) }) });
    mocks.rpc.mockResolvedValue({ data: job, error: null }); mocks.readFile.mockResolvedValue(new Uint8Array([1])); mocks.hash.mockReturnValue("b4ebe30cc77de66e271483b41f5d7ee60baa070054a0b938f87c88491b5d1b91"); mocks.render.mockResolvedValue(new TextEncoder().encode("%PDF-test"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it("rechecks auth, hash, expiry and live DB access before streaming private PDF", async () => {
    const response = await invoke(); expect(response.status).toBe(200); expect(await response.text()).toBe("%PDF-test"); expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(mocks.reauth).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("read_custom_response_print", { p_org: actor.organizationId, p_branch: actor.branchId, p_job: job.jobId, p_snapshot_hash: job.snapshotHash });
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-type")).toBe("application/pdf"); expect(response.headers.get("content-disposition")).not.toContain(job.snapshot.clientName); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.render.mock.calls[0][0].model.sections[1].rows.map((r: { value: string }) => r.value)).toContain("否");
  });
  it.each(["", "token=bad", "token=bad&token=bad", "token=bad&org=other"])("rejects invalid/duplicate query %s without db read", async (query) => { expect((await invoke(query)).status).toBe(query === "token=bad" ? 403 : 400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects a forwarded link from another account", async () => { const query = `token=${issuePrintToken(job)}`; mocks.authorize.mockResolvedValue({ ...actor, userId: record.clientId }); expect((await invoke(query)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("refuses revoked permission before render", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); expect((await invoke()).status).toBe(403); expect(mocks.render).not.toHaveBeenCalled(); });
  it("does not stream if permission is revoked during render", async () => { mocks.rpc.mockResolvedValueOnce({ data: job, error: null }).mockResolvedValueOnce({ data: null, error: { code: "42501" } }); const response = await invoke(); expect(response.status).toBe(403); expect(await response.text()).not.toContain("%PDF"); });
  it("does not stream if recent verification is revoked during render", async () => { mocks.reauth.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new IntegrationError("AAL2_REQUIRED", "重新確認", 403)); const response = await invoke(); expect(response.status).toBe(403); expect(mocks.rpc).toHaveBeenCalledOnce(); });
  it("does not stream when token expires during render", async () => { mocks.render.mockImplementationOnce(async () => { vi.setSystemTime(new Date(job.expiresAt)); return new Uint8Array([1]); }); expect((await invoke()).status).toBe(403); expect(mocks.rpc).toHaveBeenCalledOnce(); });
  it("does not stream when the final database read waits past the token deadline", async () => { mocks.rpc.mockResolvedValueOnce({ data: job, error: null }).mockImplementationOnce(async () => { vi.setSystemTime(new Date(job.expiresAt)); return { data: job, error: null }; }); const response = await invoke(); expect(response.status).toBe(403); expect(await response.text()).not.toContain("%PDF"); expect(mocks.rpc).toHaveBeenCalledTimes(2); });
  it("rejects a changed frozen response on final confirmation", async () => { mocks.rpc.mockResolvedValueOnce({ data: job, error: null }).mockResolvedValueOnce({ data: { ...job, snapshot: { ...job.snapshot, response: { ...record, answers: {} } } }, error: null }); expect((await invoke()).status).toBe(409); });
  it.each(["font", "render"])("fails closed on %s failure without partial output", async (kind) => { if (kind === "font") mocks.hash.mockReturnValue("bad"); else mocks.render.mockRejectedValue(new Error("SECRET_GLYPH")); const response = await invoke(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET"); expect(mocks.rpc).toHaveBeenCalledOnce(); });
});
