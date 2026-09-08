import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest, readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "20aa0000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const organizationId = "20100000-0000-4000-8000-000000000001";
const branchId = "20200000-0000-4000-8000-000000000001";
const userId = "20300000-0000-4000-8000-000000000001";
const clientId = "20400000-0000-4000-8000-000000000001";
const key = "20500000-0000-4000-8000-000000000001";
const eventKey = "20600000-0000-4000-8000-000000000001";
const versionId = "20700000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const actor = { organizationId, organizationName: "合成機構", branchId, branchName: "合成分支",
  userId, displayName: "合成照服員", roles: ["care_worker"], scopes: ["clients.read",
    "behavior_events.read", "behavior_events.manage", "behavior_events.sign"], assuranceLevel: "aal2",
  recentAal2At: null, demo: false };
const body = { action: "save_event", mode: "create", event_key: null, previous_version_id: null,
  expected_version: 0, expected_content_hash: null, client_id: clientId,
  occurred_at: "2026-09-07T09:00:00+08:00", event_type: "活動參與",
  antecedent: { state: "missing", text: null }, behavior: { state: "recorded", text: "人工行為內容" },
  intervention: { state: "not_applicable", text: null }, outcome: { state: "missing", text: null },
  revision_reason: "建立事件初稿" };
const receipt = { operation_id: key, action: "save_event", decision: null, event_key: eventKey,
  version_id: versionId, version: 1, event_state: "draft", content_hash: hash,
  committed_at: "2026-09-07T01:01:00Z", replayed: false };

function request(operation?: string) {
  return new Request("https://example.invalid/api/behavior-events", { method: "POST", body: "{}",
    headers: { "content-type": "application/json", "idempotency-key": key,
      ...(operation ? { "x-behavior-event-operation": operation } : {}) } });
}

describe("Page 20 behavior-event API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
  });

  it("requires the governed header before authority or content parsing", async () => {
    const response = await POST(request()); expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled(); expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([[{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "behavior_events.read"] }, "BEHAVIOR_EVENT_NOT_AUTHORIZED"]])
  ("rejects denied writes before reading narrative", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied); const response = await POST(request("create"));
    expect(response.status).toBe(403); expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before parsing a sign body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request("sign")); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, action, explicit fields and idempotency", async () => {
    const response = await POST(request("create")); expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_behavior_event", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_action: "save_event", p_payload: expect.objectContaining({ client_id: clientId,
        behavior: { state: "recorded", text: "人工行為內容" },
        antecedent: { state: "missing", text: null } }), p_idempotency_key: key,
    });
    expect((await response.json()).data).toMatchObject({ eventKey, persisted: true, demo: false });
  });

  it("rejects header and body disagreement without touching the database", async () => {
    const response = await POST(request("revise")); expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("correlates a signed receipt and replay status", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "finalize_event", decision: "sign",
      client_id: clientId, event_key: eventKey, previous_version_id: versionId,
      expected_version: 1, expected_content_hash: hash, reason: null });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, action: "finalize_event", decision: "sign",
      version_id: "20700000-0000-4000-8000-000000000002", version: 2,
      event_state: "signed", replayed: true }, error: null });
    const response = await POST(request("sign")); expect(response.status).toBe(200);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
  });

  it("fails closed on a mismatched database receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, version: 2 }, error: null });
    const response = await POST(request("create")); expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("BEHAVIOR_EVENT_RECEIPT_INVALID");
  });

  it.each([["42501", 403, "BEHAVIOR_EVENT_NOT_AUTHORIZED"],
    ["40001", 409, "BEHAVIOR_EVENT_VERSION_CONFLICT"], ["23505", 409, "BEHAVIOR_EVENT_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "BEHAVIOR_EVENT_STATE_CONFLICT"], ["22023", 400, "INVALID_BEHAVIOR_EVENT_OPERATION"],
    ["XX000", 409, "BEHAVIOR_EVENT_RESULT_UNCERTAIN"]])
  ("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("create")); expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });
});
