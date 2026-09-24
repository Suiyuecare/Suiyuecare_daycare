import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
import { buildDemoFormResponses } from "@/lib/custom-form-responses/demo";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), reauth: vi.fn(), db: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async (original) => ({ ...await original<typeof import("@/lib/integrations/http")>(), authorizeStaffRequest: mocks.authorize, requireRecentAal2: mocks.reauth }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
import { POST } from "./route";
import { verifyPrintToken } from "@/lib/custom-form-responses/print-token";
const record = buildDemoFormResponses("2026-09-22").records[0]!;
const actor = { userId: "d8100000-0000-4000-8000-000000000001", organizationId: "d8500000-0000-4000-8000-000000000001", branchId: "d8600000-0000-4000-8000-000000000001", scopes: ["care_records.read", "document_printing.read", "document_printing.manage", "document_printing.access"], assuranceLevel: "aal2", demo: false };
const job = { jobId: "d9600000-0000-4000-8000-000000000002", responseId: record.id, clientId: record.clientId, actorId: actor.userId, organizationId: actor.organizationId, branchId: actor.branchId,
  createdAt: "2026-09-22T06:00:00Z", expiresAt: "2026-09-22T06:05:00Z", snapshotHash: "a".repeat(64), replayed: false,
  snapshot: { response: record, organizationName: "合成機構", branchName: "合成分支", clientCode: "DEMO-01", clientName: "合成個案", formName: "合成表單", formKey: "tenant.custom.synthetic", formVersion: 1, preparedByName: "合成使用者" } };
const key = "d9600000-0000-4000-8000-000000000001";
const input = { clientId: record.clientId, responseId: record.id };
const request = (body: unknown = input, idempotency = key) => new Request("https://example.invalid/api/forms/responses/prints", { method: "POST", headers: { "Idempotency-Key": idempotency }, body: JSON.stringify(body) });
describe("prepare private custom response print API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(job.createdAt)); vi.stubEnv("DOCUMENT_DOWNLOAD_SIGNING_SECRET", "s".repeat(48));
    mocks.authorize.mockResolvedValue(actor); mocks.reauth.mockResolvedValue(undefined); mocks.db.mockResolvedValue({ rpc: (...args: unknown[]) => ({ abortSignal: () => mocks.rpc(...args) }) }); mocks.rpc.mockResolvedValue({ data: job, error: null });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it("binds exact actor scope and returns a five-minute authenticated download", async () => {
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(201); expect(body.data.persisted).toBe(true); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_custom_response_print", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: record.clientId, p_response: record.id, p_key: key });
    expect(mocks.reauth).toHaveBeenCalledWith(actor);
    const token = new URL(body.data.downloadUrl, "https://example.invalid").searchParams.get("token")!;
    expect(verifyPrintToken(token, { jobId: job.jobId, actorId: actor.userId, organizationId: actor.organizationId, branchId: actor.branchId }).snapshotHash).toBe(job.snapshotHash);
  });
  it("replay uses original expiry, never another five minutes", async () => {
    vi.setSystemTime(new Date("2026-09-22T06:04:00Z")); mocks.rpc.mockResolvedValue({ data: { ...job, replayed: true }, error: null });
    const response = await POST(request()); expect(response.status).toBe(200); expect((await response.json()).data.job.expiresAt).toBe(job.expiresAt);
  });
  it.each([{}, { ...input, organizationId: actor.organizationId }, { ...input, answers: {} }, { ...input, responseId: "bad" }])("rejects untrusted request fields", async (body) => { expect((await POST(request(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects missing key and oversized body", async () => { expect((await POST(request(input, ""))).status).toBe(400); expect((await POST(request({ text: "x".repeat(3000) }))).status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each([{ ...actor, demo: true }, { ...actor, assuranceLevel: "aal1" }, ...actor.scopes.map((scope) => ({ ...actor, scopes: actor.scopes.filter((entry) => entry !== scope) }))])("denies missing authority before db", async (context) => { mocks.authorize.mockResolvedValue(context); expect((await POST(request())).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled(); });
  it("checks recent verification and signing configuration before mutation", async () => {
    mocks.reauth.mockRejectedValueOnce(new IntegrationError("AAL2_REQUIRED", "重新確認", 403)); expect((await POST(request())).status).toBe(403);
    vi.stubEnv("DOCUMENT_DOWNLOAD_SIGNING_SECRET", ""); expect((await POST(request())).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["actorId", "organizationId", "branchId", "clientId", "responseId"])("refuses wrong-scope %s receipt", async (field) => { mocks.rpc.mockResolvedValue({ data: { ...job, [field]: key }, error: null }); expect((await POST(request())).status).toBe(409); });
  it("expired success cannot issue a fresh token", async () => { vi.setSystemTime(new Date(job.expiresAt)); expect((await POST(request())).status).toBe(410); });
  it.each([["42501",403], ["55000",410], ["23505",409], ["22023",400], ["XX000",503]])("sanitizes database failure %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SECRET_DATABASE" } }); const response = await POST(request()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("SECRET_DATABASE");
  });
});
