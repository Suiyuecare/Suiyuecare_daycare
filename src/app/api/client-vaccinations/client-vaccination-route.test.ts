import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "23000000-0000-4000-8000-000000000099";
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

const ORG = "23000000-0000-4000-8000-000000000001";
const BRANCH = "23000000-0000-4000-8000-000000000002";
const ACTOR = "23000000-0000-4000-8000-000000000003";
const KEY = "23000000-0000-4000-8000-000000000004";
const VACCINATION = "23030000-0000-4000-8000-000000000005";
const VERSION = "23020000-0000-4000-8000-000000000005";
const CLIENT = "23010000-0000-4000-8000-000000000005";
const actor = {
  organizationId: ORG, organizationName: "合成機構", branchId: BRANCH,
  branchName: "合成分支", userId: ACTOR, displayName: "合成主管",
  roles: ["branch_supervisor"],
  scopes: ["clients.read", "client_vaccinations.read", "client_vaccinations.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const body = {
  action: "create", vaccination_key: VACCINATION,
  previous_version_id: null, expected_base_version: 0,
  client_id: CLIENT, vaccine_name: "合成疫苗", dose_number: "合成第 1 劑",
  vaccinated_on: "2026-09-06", lot_number: "SYNTH-LOT-01",
  provider_name: "合成院所", evidence_status: "missing",
  evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
  source_system: "manual_entry", source_record_id: null, correction_reason: null,
};

function request(operation = "create") {
  return new Request("https://example.invalid/api/client-vaccinations", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": KEY, "x-client-vaccination-operation": operation },
    body: "{}",
  });
}

function databaseReceipt(overrides: Record<string, unknown> = {}) {
  return { record_payload: Object.fromEntries(Object.entries(body).filter(([key]) =>
    !["action", "vaccination_key", "previous_version_id", "expected_base_version", "correction_reason"].includes(key))),
    organization_id: ORG, branch_id: BRANCH,
    vaccination_key: VACCINATION, record_version_id: VERSION,
    version: 1, previous_version_id: null, record_status: "active",
    client_id: CLIENT, content_hash: "a".repeat(64), duplicate_warning: true,
    duplicate_count: 1,
    duplicate_basis: "same_client_normalized_vaccine_and_dose",
    recorded_at: "2026-09-07T04:00:00.000Z", replayed: false, ...overrides };
}

describe("Page 23 client vaccination API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: databaseReceipt(), error: null });
  });

  it.each([
    { ...actor, scopes: ["clients.read", "client_vaccinations.read"] },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects writes before parsing sensitive content %#", async (unauthorizedActor) => {
    stubs.authorizeStaffRequest.mockResolvedValue(unauthorizedActor);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects an absent governed-operation header before authorization or body", async () => {
    const response = await POST(new Request(
      "https://example.invalid/api/client-vaccinations",
      { method: "POST", body: "{}" },
    ));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before parsing correction content", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("需要重新驗證"), { code: "RECENT_AAL2_REQUIRED", httpStatus: 403 },
    ));
    const response = await POST(request("correct"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant and actor-scoped exact replay key", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      vaccinationKey: VACCINATION, duplicateWarning: true,
      duplicateCount: 1, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_client_vaccination",
      expect.objectContaining({
        p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH,
        p_client_id: CLIENT,
        p_evidence_reference_id: null,
        p_source_system: "manual_entry",
        p_idempotency_key: deterministicUuid(
          "page23-client-vaccination-record", ORG, ACTOR, KEY,
        ),
      }));
  });

  it.each([
    { duplicate_warning: false, duplicate_count: 1 },
    { duplicate_warning: true, duplicate_count: 1, duplicate_basis: "untrusted" },
    { branch_id: ACTOR },
    { client_id: ACTOR },
  ])("fails closed on a mismatched completion receipt %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue({ data: databaseReceipt(override), error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
  });

  it("does not expose database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private client health detail" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private client health detail");
  });
});
