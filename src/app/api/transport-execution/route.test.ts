import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(),
  maybeSingle: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "48800000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const organizationId = "48810000-0000-4000-8000-000000000001";
const branchId = "48820000-0000-4000-8000-000000000001";
const userId = "48830000-0000-4000-8000-000000000001";
const key = "48840000-0000-4000-8000-000000000001";
const planId = "48850000-0000-4000-8000-000000000001";
const tripKey = "48860000-0000-4000-8000-000000000001";
const eventId = "48870000-0000-4000-8000-000000000001";
const hash = "d".repeat(64);
const actor = { organizationId, organizationName: "合成機構", branchId,
  branchName: "合成分支", userId, displayName: "合成接送人員",
  roles: ["transport_driver"], scopes: ["clients.read", "transport_execution.read",
    "transport_execution.record", "transport_execution.exception",
    "transport_execution.complete"], assuranceLevel: "aal2",
  recentAal2At: "2026-09-07T08:00:00Z", demo: false };
const body = { action: "append_event", event_type: "trip_started",
  plan_version_id: planId, expected_trip_key: tripKey,
  expected_plan_content_hash: hash, expected_sequence: 0,
  occurred_at: "2026-09-07T08:00:00+08:00", client_id: null,
  note: null, resolves_pairing: false };
const result = { operation_id: key, event_id: eventId, event_type: "trip_started",
  plan_version_id: planId, trip_key: tripKey, client_id: null, sequence: 1,
  status: "in_progress", actual_started_at: "2026-09-07T00:00:00Z",
  actual_completed_at: null, exception_count: 0, unmatched_passenger_count: 2,
  late_seconds: 0, resolves_pairing: false, event_content_hash: "e".repeat(64),
  plan_content_hash: hash, committed_at: "2026-09-07T00:00:01Z", replayed: false };

function request(operation?: string) {
  return new Request("https://example.invalid/api/transport-execution", {
    method: "POST", body: "{}", headers: { "content-type": "application/json",
      "idempotency-key": key,
      ...(operation ? { "x-transport-execution-operation": operation } : {}) },
  });
}

describe("Page 48 transport-execution API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: result, error: null });
  });

  it("requires the governed header before authority or body parsing", async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "transport_execution.read"] },
      "TRANSPORT_EXECUTION_NOT_AUTHORIZED"],
  ])("rejects denied writes before reading location or exception content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("start_trip"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("does not require a fresh challenge for ordinary start or pairing events", async () => {
    const response = await POST(request("start_trip"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it.each(["record_exception", "complete_trip"])(
    "requires recent AAL2 before reading %s content", async (operation) => {
      stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
        { code: "AAL2_REQUIRED", httpStatus: 403 }));
      const response = await POST(request(operation));
      expect(response.status).toBe(403);
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    });

  it("binds tenant, branch, immutable plan evidence, sequence and idempotency", async () => {
    const response = await POST(request("start_trip"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_transport_execution", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_payload: { event_type: "trip_started", plan_version_id: planId,
        expected_trip_key: tripKey, expected_plan_content_hash: hash,
        expected_sequence: 0, occurred_at: "2026-09-07T00:00:00.000Z",
        client_id: null, note: null, resolves_pairing: false },
      p_idempotency_key: key,
    });
    expect((await response.json()).data).toMatchObject({ eventId,
      persisted: true, demo: false });
  });

  it("rejects a header and event disagreement without calling the database", async () => {
    const response = await POST(request("passenger_boarded"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("returns exact replay as 200", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...result, replayed: true }, error: null });
    const response = await POST(request("start_trip"));
    expect(response.status).toBe(200);
  });

  it("fails closed on a mismatched database receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...result, sequence: 2 }, error: null });
    const response = await POST(request("start_trip"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code)
      .toBe("TRANSPORT_EXECUTION_RECEIPT_INVALID");
  });

  it.each([
    ["42501", 403, "TRANSPORT_EXECUTION_NOT_AUTHORIZED"],
    ["40001", 409, "TRANSPORT_EXECUTION_VERSION_CONFLICT"],
    ["23505", 409, "TRANSPORT_EXECUTION_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "TRANSPORT_EXECUTION_STATE_CONFLICT"],
    ["22023", 400, "INVALID_TRANSPORT_EXECUTION_OPERATION"],
    ["XX000", 409, "TRANSPORT_EXECUTION_RESULT_UNCERTAIN"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("start_trip"));
    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });
});
