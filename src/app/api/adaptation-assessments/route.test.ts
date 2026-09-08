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
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "32900000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }],
      }, {
        status: value.httpStatus ?? 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "32100000-0000-4000-8000-000000000091";
const branchId = "32200000-0000-4000-8000-000000000091";
const clientId = "32300000-0000-4000-8000-000000000091";
const assessmentKey = "32500000-0000-4000-8000-000000000091";
const draftVersionId = "32600000-0000-4000-8000-000000000091";
const signedVersionId = "32600000-0000-4000-8000-000000000092";
const operationId = "32700000-0000-4000-8000-000000000091";
const idempotencyKey = "32800000-0000-4000-8000-000000000091";

const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: "32400000-0000-4000-8000-000000000091",
  displayName: "測試社工",
  roles: ["case_manager_social_worker"],
  scopes: [
    "clients.read",
    "social_work_records.read",
    "social_work_records.manage",
    "social_work_records.sign",
  ],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:59:00Z",
  demo: false,
};

const createBody = {
  action: "create_draft",
  clientId,
  assessedOn: "2026-09-01",
  adaptationStatus: "adjusting",
  assessmentSummary: "合成人工評估摘要",
  reassessmentDueOn: "2026-09-15",
  needsFollowUp: true,
  formVersionReference: "manual-adaptation-v1",
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/adaptation-assessments", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: "{}",
  });
}

function assessmentReceipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    version_id: draftVersionId,
    assessment_version: 1,
    record_state: "draft",
    assessed_on: "2026-09-01",
    adaptation_status: "adjusting",
    reassessment_due_on: "2026-09-15",
    needs_follow_up: true,
    form_version_reference: "manual-adaptation-v1",
    committed_at: "2026-09-02T01:15:00Z",
    replayed: false,
    ...overrides,
  };
}

function followUpReceipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    follow_up_event_id: "32910000-0000-4000-8000-000000000091",
    follow_up_sequence: 1,
    follow_up_status: "pending",
    due_on: "2026-09-08",
    committed_at: "2026-09-02T01:30:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("adaptation assessment API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "social_work_records.read"] },
      "ADAPTATION_NOT_AUTHORIZED"],
  ])("rejects a denied create before detailed body parsing", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds actor scope and exact quick-add client into a strict receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: assessmentReceipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      receiptKind: "assessment",
      action: "create_draft",
      clientId,
      assessmentVersion: 1,
      recordState: "draft",
      formVersionReference: "manual-adaptation-v1",
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_adaptation_assessment_draft",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_assessed_on: "2026-09-01",
        p_form_version_reference: "manual-adaptation-v1",
        p_idempotency_key: idempotencyKey,
      }),
    );
  });

  it("fails closed when the database receipt changes the selected client", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: assessmentReceipt({
        client_id: "32300000-0000-4000-8000-000000000099",
      }),
      error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("ADAPTATION_RECEIPT_INVALID");
  });

  it("requires recent AAL2 before executing a signed correction", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "correct",
      clientId,
      assessmentKey,
      previousVersionId: signedVersionId,
      expectedVersion: 2,
      assessedOn: "2026-09-01",
      adaptationStatus: "support_requested",
      assessmentSummary: "更正後人工摘要",
      reassessmentDueOn: "2026-09-20",
      needsFollowUp: true,
      formVersionReference: "manual-adaptation-v1",
      correctionReason: "修正實際觀察事實",
    });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("correlates a signed assessment to its expected immutable chain", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: draftVersionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: assessmentReceipt({
        version_id: signedVersionId,
        assessment_version: 2,
        record_state: "signed",
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(body.data).toMatchObject({
      clientId, action: "sign", assessmentVersion: 2, recordState: "signed",
    });
  });

  it("routes append-only follow-up fields without inventing notifications", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "track",
      clientId,
      assessmentKey,
      assessmentVersionId: signedVersionId,
      expectedSequence: 0,
      dueOn: "2026-09-08",
      followUpPlan: "合成追蹤計畫",
    });
    stubs.maybeSingle.mockResolvedValue({ data: followUpReceipt(), error: null });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      receiptKind: "follow_up",
      action: "track",
      clientId,
      followUpSequence: 1,
      followUpStatus: "pending",
      dueOn: "2026-09-08",
      persisted: true,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "mutate_adaptation_follow_up",
      expect.objectContaining({
        p_action: "track",
        p_client_id: clientId,
        p_assessment_key: assessmentKey,
        p_due_on: "2026-09-08",
        p_follow_up_plan: "合成追蹤計畫",
        p_follow_up_outcome: null,
        p_transition_reason: null,
      }),
    );
  });

  it("maps stale database versions to a deterministic conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("ADAPTATION_VERSION_CONFLICT");
  });
});
