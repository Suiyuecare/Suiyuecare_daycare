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
      }, {
        status: typeof candidate.httpStatus === "number" ? candidate.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
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
  infectionTypeState: "missing",
  infectionTypeText: null,
};

function request(method: "POST" | "PATCH", action?: string) {
  return new Request("https://example.invalid/api/infection-events", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(action ? { "X-Infection-Action": action } : {}),
    },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    incident_id: incidentId,
    client_id: clientId,
    entry_id: null,
    operation_kind: "report",
    chain_version: 0,
    handling_status: "reported",
    cluster_id: null,
    cluster_label: null,
    committed_at: "2026-09-01T02:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("infection event API boundary", () => {
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
    ["missing manage", { ...actor, scopes: ["clients.read", "quality_events.read"] }, "INFECTION_EVENT_NOT_AUTHORIZED"],
  ])("rejects %s before reading report content", async (_label, denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing PATCH action header before authorization or body parsing", async () => {
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds report scope from the actor and returns an exactly correlated client receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ clientId, incidentId, chainVersion: 0, persisted: true });
    expect(stubs.rpc).toHaveBeenCalledWith("report_infection_event", expect.objectContaining({
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
      p_infection_type_state: "missing",
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
    expect(body.errors[0].code).toBe("INFECTION_EVENT_RECEIPT_INVALID");
  });

  it("fails closed on a forged mutation incident, client or chain receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "follow_up", clientId, incidentId,
      occurredAt: "2026-09-01T01:30:00.000Z",
      entryText: "追蹤內容", expectedChainVersion: 2,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({
        entry_id: entryId,
        operation_kind: "follow_up",
        chain_version: 4,
        handling_status: "in_progress",
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH", "follow_up"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("INFECTION_EVENT_RECEIPT_INVALID");
  });

  it("maps an explicit new-cluster link and accepts only its correlated generated UUID receipt", async () => {
    const generatedClusterId = "24000000-0000-4000-8000-000000000088";
    stubs.readJsonObject.mockResolvedValue({
      action: "cluster_link",
      clientId,
      incidentId,
      occurredAt: "2026-09-01T01:30:00.000Z",
      clusterId: null,
      clusterLabel: "人工群聚 A",
      expectedChainVersion: 0,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({
        entry_id: entryId,
        operation_kind: "cluster_link",
        chain_version: 1,
        handling_status: "in_progress",
        cluster_id: generatedClusterId,
        cluster_label: "人工群聚 A",
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH", "cluster_link"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      operationKind: "cluster_link",
      incidentId,
      clientId,
      chainVersion: 1,
      clusterId: generatedClusterId,
      clusterLabel: "人工群聚 A",
    });
    expect(stubs.rpc).toHaveBeenCalledWith("link_infection_event_cluster", expect.objectContaining({
      p_cluster_id: null,
      p_cluster_label: "人工群聚 A",
      p_expected_chain_version: 0,
    }));
  });

  it("rejects a PATCH action/body mismatch without calling the database", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "treatment",
      clientId,
      incidentId,
      occurredAt: "2026-09-01T01:30:00.000Z",
      entryText: "人工處置",
      expectedChainVersion: 0,
    });
    const response = await PATCH(request("PATCH", "follow_up"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
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
    const response = await PATCH(request("PATCH", "close"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe("RECENT_AAL2_REQUIRED");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
