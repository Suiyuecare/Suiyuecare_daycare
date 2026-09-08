import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "27000000-0000-4000-8000-000000000090";
    try { return await operation(requestId); }
    catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { PATCH, POST } from "./route";

const organizationId = "27000000-0000-4000-8000-000000000001";
const branchId = "27000000-0000-4000-8000-000000000002";
const clientId = "27000000-0000-4000-8000-000000000003";
const incidentId = "27000000-0000-4000-8000-000000000004";
const membershipId = "27000000-0000-4000-8000-000000000008";
const idempotencyKey = "27000000-0000-4000-8000-000000000007";
const actor = { organizationId, organizationName: "測試機構", branchId, branchName: "測試分支",
  userId: "27000000-0000-4000-8000-000000000010", displayName: "測試人員",
  roles: ["nurse"], scopes: ["clients.read", "quality_events.read", "quality_events.manage", "quality_events.close"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-01T01:59:00Z", demo: false };
const reportBody = { action: "report", affectedTargetKind: "client", affectedClientId: clientId,
  affectedTargetLabel: null, occurredAt: "2026-09-01T01:00:00Z", location: "活動區",
  eventType: "人工類型", eventSummary: "事件內容", immediateAction: "確認安全",
  majorState: "unclassified", responsibleMembershipId: membershipId,
  improvementDueDate: "2026-09-03", lateEntryReason: null };

function request(method: "POST" | "PATCH", action?: string) {
  return new Request("https://example.invalid/api/abnormal-events", { method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey,
      ...(action ? { "X-Abnormal-Action": action } : {}) }, body: "{}" });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return { operation_id: "27000000-0000-4000-8000-000000000020", incident_id: incidentId,
    entry_id: null, operation_kind: "report", affected_target_kind: "client",
    affected_client_id: clientId, chain_version: 0, handling_status: "reported",
    responsible_membership_id: membershipId, effective_due_date: "2026-09-03",
    committed_at: "2026-09-01T02:00:00Z", replayed: false, ...overrides };
}

describe("abnormal event API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(reportBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "quality_events.read"] }, "ABNORMAL_EVENT_NOT_AUTHORIZED"],
  ])("rejects unauthorized report before body parsing", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect((await response.json()).errors[0].code).toBe(code);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds organization and branch from actor and returns a strict receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ affectedClientId: clientId, incidentId,
      responsibleMembershipId: membershipId, persisted: true });
    expect(stubs.rpc).toHaveBeenCalledWith("report_abnormal_event", expect.objectContaining({
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_affected_client_id: clientId, p_affected_target_label: null,
      p_responsible_membership_id: membershipId, p_idempotency_key: idempotencyKey,
    }));
  });

  it("fails closed on a forged target receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ affected_target_kind: "facility",
      affected_client_id: null }), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("ABNORMAL_EVENT_RECEIPT_INVALID");
  });

  it("routes manual evidence without claiming delivery", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "manual_notification", incidentId,
      affectedTargetKind: "client", affectedClientId: clientId,
      occurredAt: "2026-09-01T01:30:00Z", notificationTarget: "主管",
      notificationMethod: "人工電話", notificationResult: "承辦人記錄已說明",
      expectedChainVersion: 0 });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ entry_id: "27000000-0000-4000-8000-000000000021",
      operation_kind: "manual_notification", chain_version: 1, handling_status: "in_progress" }), error: null });
    const response = await PATCH(request("PATCH", "manual_notification"));
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("add_abnormal_event_manual_notification",
      expect.objectContaining({ p_notification_method: "人工電話", p_notification_result: "承辦人記錄已說明" }));
  });

  it("requires recent same-session AAL2 before reading closure content", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await PATCH(request("PATCH", "close"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects action/header mismatch before database execution", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "follow_up" });
    const response = await PATCH(request("PATCH", "improvement"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
