import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
const mocks = vi.hoisted(() => ({ context: vi.fn(), server: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn(), recent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
import { GET } from "./route";
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const organizationId = id(1), branchId = id(2), userId = id(3), clientId = id(4), key = id(5), nonce = id(6);
function actor(): TenantContext { return { organizationId, branchId, userId, organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成員工", roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read"], assuranceLevel: "aal1", recentAal2At: null, demo: false }; }
function fixture() {
  const form = QUESTIONNAIRE_FORMS.spmsq, answers = Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }]));
  const createdAt = "2026-09-27T10:30:00.123456Z", contentHash = "a".repeat(64);
  return { schemaVersion: 1, organizationId, branchId, actorUserId: userId, clientId, formKey: "spmsq", action: "create",
    idempotencyKey: key, nonce, verifiedAt: new Date().toISOString(), status: "committed", persisted: true, demo: false,
    receipt: { action: "create", clientId, formKey: "spmsq", assessmentKey: id(7), versionId: id(8), version: 1,
      recordState: "draft", assessedOn: "2026-09-27", contentHash, committedAt: createdAt, replayed: false },
    request: { action: "create", client_id: clientId, form_key: "spmsq", form_version: form.version, assessed_on: "2026-09-27",
      answers, context: {}, assessment_key: null, previous_version_id: null, expected_version: 0 },
    draft: { assessmentKey: id(7), versionId: id(8), version: 1, formVersion: form.version, assessedOn: "2026-09-27", answers,
      context: {}, recordState: "draft", authorDisplayName: "合成員工", createdAt, contentHash } };
}
function request(headers: Record<string, string> = {}, query = "", method = "GET", signal?: AbortSignal) {
  return new Request("https://example.invalid/api/questionnaire-assessments/receipt" + query, { method, signal, headers: {
    "x-organization-id": organizationId, "x-branch-id": branchId, "x-client-id": clientId, "x-questionnaire-form-key": "spmsq",
    "x-questionnaire-operation": "create", "idempotency-key": key, "x-questionnaire-receipt-nonce": nonce, ...headers } });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-27T11:00:00Z")); vi.resetAllMocks();
  mocks.context.mockResolvedValue(actor()); mocks.server.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal }); mocks.abortSignal.mockResolvedValue({ data: fixture(), error: null }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("current admitted actor's original questionnaire receipt GET", () => {
  it("reads AAL1 without manage/sign, new MFA, mutation or an actor RPC argument", async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect((await response.json()).data).toEqual(fixture());
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("staff"); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("questionnaire_assessment_operation_receipt", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_client_id: clientId,
      p_form_key: "spmsq", p_action: "create", p_idempotency_key: key, p_nonce: nonce });
    expect(mocks.recent).not.toHaveBeenCalled(); expect(mocks.abortSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("AAL2 also reads without invoking recent-MFA evidence", async () => {
    mocks.context.mockResolvedValue({ ...actor(), assuranceLevel: "aal2" }); expect((await GET(request())).status).toBe(200); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("requires a current session and selected branch", async () => {
    mocks.context.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
    mocks.context.mockResolvedValue({ ...actor(), branchId: null }); expect((await GET(request())).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { scopes: [] }, { scopes: ["clients.read"] }, { scopes: ["questionnaire_cognition.read"] }])("denies incomplete authority %#", async change => {
    mocks.context.mockResolvedValue({ ...actor(), ...change }); expect((await GET(request())).status).toBe(403); expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id", "x-client-id", "idempotency-key", "x-questionnaire-receipt-nonce"])("rejects invalid %s before authority/RPC", async header => {
    expect((await GET(request({ [header]: "invalid" }))).status).toBe(400); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["", "sign", "create,revise"])("rejects action %s", async action => {
    expect((await GET(request({ "x-questionnaire-operation": action }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["unknown", "constructor", "__proto__"])("rejects form %s", async form => {
    expect((await GET(request({ "x-questionnaire-form-key": form }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["?actor=other", "?idempotency_key=secret", "?nonce=secret"])("accepts no query %s", async query => {
    expect((await GET(request({}, query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ "x-idempotency-key": key }, { "transfer-encoding": "chunked" }, { "content-length": "1" },
    { "content-length": "bad" }, { "content-length": "00" }])("rejects alternate key/body declaration %#", async headers => {
    expect((await GET(request(headers))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects non-GET or actual body", async () => {
    expect((await GET(request({}, "", "POST"))).status).toBe(400); const forged = request(); Object.defineProperty(forged, "body", { value: new ReadableStream() });
    expect((await GET(forged)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id"])("rejects wrong context %s", async header => {
    expect((await GET(request({ [header]: id(99) }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("ignores caller spoofed actor and rejects an unrelated DB actor proof", async () => {
    expect((await GET(request({ "x-actor-user-id": id(99) }))).status).toBe(200);
    mocks.abortSignal.mockResolvedValue({ data: { ...fixture(), actorUserId: id(99) }, error: null }); expect((await GET(request())).status).toBe(503);
  });
  it("not_found remains null observed absence, not a write confirmation", async () => {
    const data = { ...fixture(), status: "not_found", persisted: false, receipt: null, request: null, draft: null };
    mocks.abortSignal.mockResolvedValue({ data, error: null }); expect((await (await GET(request())).json()).data).toEqual(data);
  });
  it.each([["42501", 403], ["22023", 400], ["23514", 503], ["23505", 503], ["XX000", 503]])("redacts DB %s to HTTP %d", async (code, status) => {
    mocks.abortSignal.mockResolvedValue({ data: null, error: { code, message: "PRIVATE_CONTENT", details: "PRIVATE_CONTENT" } });
    const response = await GET(request()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("PRIVATE_CONTENT");
  });
  it.each([null, {}, { data: null }, { error: null }, { data: null, error: null }])("redacts malformed result %#", async data => {
    mocks.abortSignal.mockResolvedValue(data); expect((await GET(request())).status).toBe(503);
  });
  it.each([{ nonce: id(99) }, { clientId: id(99) }, { demo: true }, { action: "revise" }, { persisted: false },
    { verifiedAt: "2026-09-27T11:01:00.001Z" }, { verifiedAt: "2026-09-27T10:58:59.999Z" }])("revalidates entire DB proof %#", async change => {
    mocks.abortSignal.mockResolvedValue({ data: { ...fixture(), ...change }, error: null }); expect((await GET(request())).status).toBe(503);
  });
  it.each(["auth", "server", "rpc"])("hard bounds uncooperative %s at 20 seconds and ignores late completion", async phase => {
    let release!: (value: unknown) => void; const waiting = new Promise(resolve => { release = resolve; });
    if (phase === "auth") mocks.context.mockReturnValue(waiting);
    if (phase === "server") mocks.server.mockReturnValue(waiting);
    if (phase === "rpc") mocks.abortSignal.mockReturnValue(waiting);
    const pending = GET(request()); await vi.advanceTimersByTimeAsync(19_999); let done = false; pending.then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false); await vi.advanceTimersByTimeAsync(1); const response = await pending; expect(response.status).toBe(503);
    if (phase === "rpc") expect((mocks.abortSignal.mock.calls[0]![0] as AbortSignal).aborted).toBe(true);
    release(phase === "auth" ? actor() : phase === "server" ? { rpc: mocks.rpc } : { data: fixture(), error: null });
    await vi.advanceTimersByTimeAsync(1); expect(vi.getTimerCount()).toBe(0); expect(await response.text()).not.toContain("answers");
  });
  it("honors owner abort before/while reading without leaking late JSON", async () => {
    const owner = new AbortController(); owner.abort(); expect((await GET(request({}, "", "GET", owner.signal))).status).toBe(503); expect(mocks.context).not.toHaveBeenCalled();
    const active = new AbortController(); mocks.abortSignal.mockReturnValue(new Promise(() => {})); const pending = GET(request({}, "", "GET", active.signal));
    await vi.advanceTimersByTimeAsync(0); active.abort(); expect((await pending).status).toBe(503); expect((mocks.abortSignal.mock.calls[0]![0] as AbortSignal).aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
});
