import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";

const mocks = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/form-governance/lifecycle-auth", () => ({ requireCustomFormAal2: mocks.requireRecentAal2 }));
vi.mock("@/lib/integrations/http", async (original) => ({ ...await original<typeof import("@/lib/integrations/http")>(), authorizeStaffRequest: mocks.authorizeStaffRequest, requireRecentAal2: mocks.requireRecentAal2 }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
import { POST } from "./route";
import { GET } from "./[id]/route";

const actor = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222", scopes: ["forms.manage"], demo: false };
const versionId = "aa200000-0000-4000-8000-000000000001";
const key = "aa100000-0000-4000-8000-000000000001";
const definitionId = "aa300000-0000-4000-8000-000000000001";
const payload = { formKey: "tenant.custom.daily_check", name: "合成表單", category: "行政表單", effectiveFrom: null, effectiveTo: null,
  schema: { builder: "tenant-custom.v1", fields: [{ key: "note", label: "內容", type: "text", required: true, maxLength: 500 }] } };
const input = { formVersionId: null, baseRevision: null, payload };
function request(body: unknown = input) { return new Request("https://example.invalid/api/forms/drafts", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) }); }
const rpcSignals: AbortSignal[] = [];
function rpcClient(rpc: (...args: unknown[]) => unknown) {
  return { rpc: (...args: unknown[]) => ({ abortSignal: (signal: AbortSignal) => { rpcSignals.push(signal); return rpc(...args); } }) };
}

describe("custom draft API security and evidence", () => {
  beforeEach(() => { vi.clearAllMocks(); rpcSignals.length = 0; mocks.authorizeStaffRequest.mockResolvedValue(actor); mocks.requireRecentAal2.mockResolvedValue(undefined); });
  it.each([{ ...actor, scopes: [] }, { ...actor, demo: true }])("denies unprivileged/demo caller before Supabase", async (context) => {
    mocks.authorizeStaffRequest.mockResolvedValue(context);
    const response = await POST(request());
    expect(response.status).toBe(403); expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("denies missing reauthentication before database or body validation", async () => {
    mocks.requireRecentAal2.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "需要重新驗證", 403));
    expect((await POST(request({ invalid: true }))).status).toBe(403);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });
  it("uses only context-derived scope and audited RPC, returning exact receipt", async () => {
    const receipt = { formVersionId: versionId, definitionId, revision: 1, status: "draft", replayed: false };
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(rpcClient(rpc));
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "ok", data: { receipt, persisted: true, demo: false } });
    expect(rpc).toHaveBeenCalledWith("save_custom_form_draft", { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_form_version_id: null, p_base_revision: null, p_idempotency_key: key, p_payload: payload });
    expect(rpcSignals).toHaveLength(1); expect(rpcSignals[0]).toBeInstanceOf(AbortSignal);
  });
  it.each([["42501",403], ["40001",409], ["23505",409], ["23514",409], ["22023",400], ["XX000",503]])("maps SQL %s without leaking database detail", async (code, status) => {
    mocks.createServerSupabaseClient.mockResolvedValue(rpcClient(vi.fn().mockResolvedValue({ data: null, error: { code, message: "SECRET_RAW_PAYLOAD" } })));
    const response = await POST(request()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("SECRET_RAW_PAYLOAD");
  });
  it("rejects tenant spoofing, huge body, and unsupported scoring without RPC writes", async () => {
    const rpc = vi.fn(); mocks.createServerSupabaseClient.mockResolvedValue(rpcClient(rpc));
    expect((await POST(request({ ...input, organizationId: actor.organizationId }))).status).toBe(400);
    expect((await POST(request({ ...input, payload: { ...payload, scoring: {} } }))).status).toBe(400);
    expect((await POST(request({ extra: "x".repeat(70000) }))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed success and supports replay status", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { formVersionId: versionId, definitionId, revision: 99, status: "draft", replayed: false }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(rpcClient(rpc));
    expect((await POST(request())).status).toBe(409);
    rpc.mockResolvedValue({ data: { formVersionId: versionId, definitionId, revision: 1, status: "draft", replayed: true }, error: null });
    expect((await POST(request())).status).toBe(200);
  });
  it("reads only exact scoped custom draft and refuses mismatched identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { formVersionId: versionId, definitionId, revision: 1, version: 1, status: "draft", payload }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(rpcClient(rpc));
    const context = { params: Promise.resolve({ id: versionId }) };
    const response = await GET(new Request("https://example.invalid/api/forms/drafts/" + versionId), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.requireRecentAal2).not.toHaveBeenCalled();
    expect(rpcSignals).toHaveLength(1); expect(rpcSignals[0]).toBeInstanceOf(AbortSignal);
    rpc.mockResolvedValue({ data: { formVersionId: definitionId, definitionId, revision: 1, version: 1, status: "draft", payload }, error: null });
    expect((await GET(new Request("https://example.invalid"), context)).status).toBe(503);
  });
  it.each(["read", "write"])("bounds %s RPC with a 10 second abort signal and safe timeout response", async (operation) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const rpc = vi.fn().mockRejectedValue(new Error("SECRET_TIMEOUT_DETAILS"));
    mocks.createServerSupabaseClient.mockResolvedValue(rpcClient(rpc));
    const response = operation === "write" ? await POST(request()) : await GET(new Request("https://example.invalid"), { params: Promise.resolve({ id: versionId }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "error", errors: [{ code: "CUSTOM_FORM_TIMEOUT" }] });
    expect(timeout).toHaveBeenCalledWith(10_000); expect(rpcSignals).toHaveLength(1);
    timeout.mockRestore();
  });
});
