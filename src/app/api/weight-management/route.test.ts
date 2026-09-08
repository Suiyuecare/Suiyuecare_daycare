import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(), requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest, readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (id: string) => Promise<Response>) => { const id = "41000000-0000-4000-8000-000000000001"; try { return await operation(id); } catch (error) { const value = error as { code?: string; message?: string; httpStatus?: number }; return Response.json({ requestId: id, status: "error", data: null, errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] }, { status: value.httpStatus ?? 500 }); } },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { PATCH, POST } from "./route";

const ids = { organization: "41000000-0000-4000-8000-000000000010", branch: "41000000-0000-4000-8000-000000000011", client: "41000000-0000-4000-8000-000000000012", observation: "41000000-0000-4000-8000-000000000013", prior: "41000000-0000-4000-8000-000000000014", rule: "41000000-0000-4000-8000-000000000015", operation: "41000000-0000-4000-8000-000000000016", acknowledgement: "41000000-0000-4000-8000-000000000017", key: "41000000-0000-4000-8000-000000000018" };
const actor = { organizationId: ids.organization, organizationName: "測試", branchId: ids.branch, branchName: "分支", userId: ids.operation, displayName: "護理師", roles: ["nurse"], scopes: ["clients.read", "quality_events.read", "quality_events.manage"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const request = (method: string) => new Request("https://example.invalid/api/weight-management", { method, headers: { "Content-Type": "application/json", "Idempotency-Key": ids.key }, body: "{}" });
const receipt = (overrides: Record<string, unknown> = {}) => ({ operation_id: ids.operation, operation_kind: "record", client_id: ids.client, observation_id: ids.observation, correction_id: null, correction_version: null, prior_observation_id: null, rule_version_id: null, current_evidence_correction_version: null, prior_evidence_correction_version: null, acknowledgement_id: null, committed_at: "2026-09-01T10:00:00+08:00", replayed: false, ...overrides });

describe("weight management API boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor); stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc }); stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle }); stubs.readJsonObject.mockResolvedValue({ action: "record", clientId: ids.client, observedAt: "2026-09-01T10:00:00+08:00", weightKg: "65.00", source: "人工量測" }); });

  it("rejects demo or missing manage before database access", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    expect((await (await POST(request("POST"))).json()).errors[0].code).toBe("DEMO_READ_ONLY");
    expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false, scopes: ["clients.read"] });
    expect((await (await POST(request("POST"))).json()).errors[0].code).toBe("WEIGHT_NOT_AUTHORIZED");
  });

  it("binds tenant scope and accepts only the exact record receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("record_weight_observation", expect.objectContaining({ p_expected_organization_id: ids.organization, p_expected_branch_id: ids.branch, p_client_id: ids.client, p_weight_kg: "65.00", p_idempotency_key: ids.key }));
  });

  it("fails closed when a 2xx receipt names another client", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ client_id: ids.branch }), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("WEIGHT_RECEIPT_INVALID");
  });

  it("requires recent AAL2 before parsing a correction", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "correct", clientId: ids.client, observationId: ids.observation, expectedCorrectionVersion: 0, replacementWeightKg: "66.00", correctionReason: "紙本核對" });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("recent"), { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("correlates acknowledgement observation, rule and correction versions", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "acknowledge", clientId: ids.client, currentObservationId: ids.observation, currentCorrectionVersion: 1, priorObservationId: ids.prior, priorCorrectionVersion: 0, ruleVersionId: ids.rule, acknowledgementNote: "已確認" });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ operation_kind: "acknowledge", prior_observation_id: ids.prior, rule_version_id: ids.rule, current_evidence_correction_version: 2, prior_evidence_correction_version: 0, acknowledgement_id: ids.acknowledgement }), error: null });
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(502); expect((await response.json()).errors[0].code).toBe("WEIGHT_RECEIPT_INVALID");
  });

  it("maps unknown database outcomes without leaking details", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "XX999" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(500); expect((await response.json()).errors[0].code).toBe("WEIGHT_SAVE_FAILED");
  });

  it("maps database numeric overflow to a bounded input error", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "22003" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("INVALID_WEIGHT_OPERATION");
  });
});
