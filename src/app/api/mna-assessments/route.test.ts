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
    const requestId = "13900000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }],
      }, { status: value.httpStatus ?? 500 });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { MNA_GOVERNANCE_VERSION } from "@/lib/mna-assessments/types";
import { PATCH, POST } from "./route";

const organizationId = "13100000-0000-4000-8000-000000000091";
const branchId = "13200000-0000-4000-8000-000000000091";
const clientId = "13300000-0000-4000-8000-000000000091";
const userId = "13400000-0000-4000-8000-000000000091";
const assessmentKey = "13500000-0000-4000-8000-000000000091";
const previousVersionId = "13600000-0000-4000-8000-000000000091";
const idempotencyKey = "13800000-0000-4000-8000-000000000091";

const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId,
  displayName: "測試專業人員",
  roles: ["professional"],
  scopes: [
    "clients.read", "mna_assessments.read", "mna_assessments.manage",
    "mna_assessments.sign",
  ],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:59:00Z",
  demo: false,
};
const createBody = {
  action: "create_draft",
  clientId,
  assessedOn: "2026-09-02",
  formVariant: "mna_sf",
  governanceVersionId: MNA_GOVERNANCE_VERSION,
};

function request(method: "POST" | "PATCH", operation?: string) {
  return new Request("https://example.invalid/api/mna-assessments", {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...(operation ? { "x-mna-operation": operation } : {}),
    },
    body: "{}",
  });
}

function blockedReceipt(action = "create_draft", overrides = {}) {
  return {
    operation_id: "13700000-0000-4000-8000-000000000091",
    action,
    client_id: clientId,
    actor_user_id: userId,
    idempotency_key: idempotencyKey,
    status: "blocked_license_not_configured",
    replayed: false,
    ...overrides,
  };
}

describe("page 36 MNA API license gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({
      data: blockedReceipt(),
      error: null,
    });
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, roles: ["branch_supervisor"] }, "MNA_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["clients.read", "mna_assessments.read"] }, "MNA_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["mna_assessments.read", "mna_assessments.manage"] }, "MNA_NOT_AUTHORIZED"],
  ])("rejects denied writes before body parsing", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale AAL2 before body parsing", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED",
      httpStatus: 403,
    }));
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, exact client and actor idempotency then stays blocked", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect(stubs.rpc).toHaveBeenCalledWith("create_mna_assessment_draft", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
      p_assessed_on: "2026-09-02",
      p_form_variant: "mna_sf",
      p_governance_version_id: MNA_GOVERNANCE_VERSION,
      p_idempotency_key: idempotencyKey,
    });
    expect((await response.json()).errors[0].code)
      .toBe("MNA_LICENSE_NOT_CONFIGURED");
  });

  it.each([
    [{ client_id: "13300000-0000-4000-8000-000000000099" }, "client"],
    [{ actor_user_id: "13400000-0000-4000-8000-000000000099" }, "actor"],
    [{ idempotency_key: "13800000-0000-4000-8000-000000000099" }, "key"],
    [{ action: "sign" }, "action"],
    [{ status: "ok" }, "status"],
    [{ replayed: "false" }, "replayed"],
  ])("fails closed on mismatched blocked receipt: %s", async (change, label) => {
    expect(label.length).toBeGreaterThan(0);
    stubs.maybeSingle.mockResolvedValue({
      data: blockedReceipt("create_draft", change),
      error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("MNA_RECEIPT_INVALID");
  });

  it("requires a governed PATCH action header before authorization", async () => {
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires sign permission before reading a sign body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      scopes: ["clients.read", "mna_assessments.read", "mna_assessments.manage"],
    });
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("passes expected version to the blocked sign boundary", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId,
      expectedVersion: 2,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: blockedReceipt("sign"),
      error: null,
    });
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(409);
    expect(stubs.rpc).toHaveBeenCalledWith("sign_mna_assessment", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
      p_assessment_key: assessmentKey,
      p_previous_version_id: previousVersionId,
      p_expected_version: 2,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("rejects header/body action mismatch", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId,
      expectedVersion: 2,
    });
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403, "MNA_NOT_AUTHORIZED"],
    ["40001", 409, "MNA_VERSION_CONFLICT"],
    ["23505", 409, "MNA_IDEMPOTENCY_CONFLICT"],
    ["22023", 400, "INVALID_MNA_ASSESSMENT"],
    ["XX000", 500, "MNA_OPERATION_UNKNOWN"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });
});

