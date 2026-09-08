import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "65000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const ORG = "65000000-0000-4000-8000-000000000001";
const BRANCH = "65000000-0000-4000-8000-000000000002";
const ACTOR = "65000000-0000-4000-8000-000000000003";
const DEVICE = "65000000-0000-4000-8000-000000000004";
const CLIENT = "65000000-0000-4000-8000-000000000005";
const MEASUREMENT = "65000000-0000-4000-8000-000000000006";
const KEY = "65000000-0000-4000-8000-000000000007";
const OPERATION = "65000000-0000-4000-8000-000000000008";
const STATE = "65000000-0000-4000-8000-000000000009";
const CORRECTION = "65000000-0000-4000-8000-000000000010";
const actor = { organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["external_health_devices.read", "external_health_devices.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const matchBody = { action: "correct_measurement_match",
  measurementId: MEASUREMENT, expectedCorrectionSequence: 0,
  matchStatus: "matched", clientId: CLIENT, reason: "核對設備個案標籤" };
const matchReceipt = { organization_id: ORG, branch_id: BRANCH,
  operation_id: OPERATION, action: "correct_measurement_match",
  measurement_id: MEASUREMENT, correction_id: CORRECTION,
  correction_sequence: 1, match_status: "matched", client_id: CLIENT,
  committed_at: "2026-09-02T05:00:00.000Z", replayed: false };

function request() {
  return new Request("https://example.invalid/api/external-health-devices/actions", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": KEY }, body: "{}",
  });
}

describe("page-65 external health device action API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(matchBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: matchReceipt, error: null });
  });

  it("rejects missing manage scope before reading sensitive input", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["external_health_devices.read"] });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects demo writes and requires recent AAL2 before parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("recent"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, measurement, optimistic base and actor-scoped operation key", async () => {
    let response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      receiptKind: "measurement_match", measurementId: MEASUREMENT,
      correctionSequence: 1, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "correct_external_health_measurement_match", expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_measurement_id: MEASUREMENT, p_expected_correction_sequence: 0,
        p_client_id: CLIENT, p_idempotency_key: deterministicUuid(
          "page65-external-health-action", ORG, ACTOR, KEY,
        ),
      }),
    );
    stubs.maybeSingle.mockResolvedValue({ data: { ...matchReceipt, replayed: true },
      error: null });
    response = await POST(request());
    expect(response.status).toBe(200);
  });

  it("uses the dedicated device state RPC and verifies its receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "disable_device",
      deviceId: DEVICE, expectedStateSequence: 2, clientId: null,
      reason: "設備送修，人工停用" });
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: BRANCH, operation_id: OPERATION, action: "disable_device",
      device_id: DEVICE, state_event_id: STATE, state_sequence: 3,
      operational_status: "disabled", assigned_client_id: CLIENT,
      committed_at: "2026-09-02T05:00:00.000Z", replayed: false }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      receiptKind: "device_state", deviceId: DEVICE,
      operationalStatus: "disabled", assignedClientId: CLIENT,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_external_health_device_state",
      expect.objectContaining({ p_device_id: DEVICE, p_action: "disable_device",
        p_expected_state_sequence: 2 }));
  });

  it.each([
    { ...matchReceipt, branch_id: ACTOR },
    { ...matchReceipt, measurement_id: DEVICE },
    { ...matchReceipt, correction_sequence: 2 },
    { ...matchReceipt, match_status: "unmatched" },
    { ...matchReceipt, client_id: null },
    { organization_id: ORG, branch_id: BRANCH, private_detail: "secret" },
  ])("fails closed on an uncorrelated database receipt %#", async (data) => {
    stubs.maybeSingle.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("maps database authorization without returning private details", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private client details" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private client details");
  });

  it("returns an uncertain result for an unclassified database failure", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "57014", message: "private timeout" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.errors[0].code).toBe("EXTERNAL_HEALTH_SAVE_UNCERTAIN");
    expect(JSON.stringify(payload)).not.toContain("private timeout");
  });
});
