import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "24000000-0000-4000-8000-000000000090";
    try {
      return await operation(requestId);
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: typeof candidate.code === "string" ? candidate.code : "ERROR",
          message: typeof candidate.message === "string" ? candidate.message : "error",
        }],
      }, { status: typeof candidate.httpStatus === "number" ? candidate.httpStatus : 500 });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "24000000-0000-4000-8000-000000000001";
const branchId = "24000000-0000-4000-8000-000000000002";
const clientId = "24000000-0000-4000-8000-000000000003";
const incidentId = "24000000-0000-4000-8000-000000000004";
const operationId = "24000000-0000-4000-8000-000000000005";
const entryId = "24000000-0000-4000-8000-000000000006";
const idempotencyKey = "24000000-0000-4000-8000-000000000007";
const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: "24000000-0000-4000-8000-000000000008",
  displayName: "測試人員",
  roles: ["nurse"],
  scopes: ["clients.read", "quality_events.read", "quality_events.manage", "quality_events.close"],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-01T01:59:00.000Z",
  demo: false,
};
const reportBody = {
  action: "report",
  clientId,
  occurredAt: "2026-09-01T01:00:00.000Z",
  location: "活動區",
  eventSummary: "第一行\n第二行",
  injuryDegreeState: "missing",
  injuryDegreeText: null,
  lateEntryReason: null,
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/fall-events", {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    incident_id: incidentId,
    client_id: clientId,
    entry_id: null,
    chain_version: 0,
    handling_status: "reported",
    committed_at: "2026-09-01T02:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("fall event API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(reportBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    ["demo", { ...actor, demo: true }, "DEMO_READ_ONLY"],
    ["missing manage", { ...actor, scopes: ["clients.read", "quality_events.read"] }, "FALL_EVENT_NOT_AUTHORIZED"],
  ])("rejects %s before reading report content", async (_label, denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds report scope from the actor and returns an exactly correlated client receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ clientId, incidentId, chainVersion: 0, persisted: true });
    expect(stubs.rpc).toHaveBeenCalledWith("report_fall_event", expect.objectContaining({
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
      p_late_entry_reason: null,
      p_idempotency_key: idempotencyKey,
    }));
  });

  it("fails closed when a report receipt names another client", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({ client_id: "24000000-0000-4000-8000-000000000099" }), error: null,
    });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("FALL_EVENT_RECEIPT_INVALID");
  });

  it("fails closed on a forged mutation incident, client or chain receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "follow_up", clientId, incidentId,
      occurredAt: "2026-09-01T01:30:00.000Z",
      entryText: "追蹤內容", expectedChainVersion: 2,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({ entry_id: entryId, chain_version: 4, handling_status: "in_progress" }),
      error: null,
    });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("FALL_EVENT_RECEIPT_INVALID");
  });

  it("requires current recent AAL2 before sending a close mutation to the database", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "close", clientId, incidentId,
      occurredAt: "2026-09-01T01:30:00.000Z",
      closureOutcome: "結果", closureReason: "理由", expectedChainVersion: 2,
    });
    stubs.requireRecentAal2.mockRejectedValue(
      Object.assign(new Error("reauth required"), { code: "RECENT_AAL2_REQUIRED", httpStatus: 403 }),
    );
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe("RECENT_AAL2_REQUIRED");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
