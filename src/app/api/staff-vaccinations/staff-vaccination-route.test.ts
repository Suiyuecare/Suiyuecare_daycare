import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "73000000-0000-4000-8000-000000000099";
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

const ORG = "73000000-0000-4000-8000-000000000001";
const BRANCH = "73000000-0000-4000-8000-000000000002";
const ACTOR = "73000000-0000-4000-8000-000000000003";
const KEY = "73000000-0000-4000-8000-000000000004";
const VACCINATION = "73071000-0000-4000-8000-000000000005";
const VERSION = "73070000-0000-4000-8000-000000000005";
const STAFF = "73040000-0000-4000-8000-000000000005";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["staff_health.read", "staff_health.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const body = {
  action: "create", vaccination_key: VACCINATION,
  previous_version_id: null, expected_base_version: 0,
  staff_membership_id: STAFF, vaccine_name: "合成疫苗",
  dose_number: "合成第 1 劑", vaccinated_on: "2026-08-20",
  lot_number: "SYNTH-LOT-01", provider_name: "合成院所",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null,
};
function request() {
  return new Request("https://example.invalid/api/staff-vaccinations", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "{}",
  });
}

describe("page-73 staff vaccination API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    { ...actor, scopes: ["staff_health.read"] },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects sensitive writes before body parsing %#", async (unauthorizedActor) => {
    stubs.authorizeStaffRequest.mockResolvedValue(unauthorizedActor);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, actor idempotency and duplicate-warning receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      organization_id: ORG, branch_id: BRANCH,
      vaccination_key: VACCINATION, record_version_id: VERSION,
      version: 1, previous_version_id: null, record_status: "active",
      staff_membership_id: STAFF, content_hash: "a".repeat(64),
      duplicate_warning: true, duplicate_count: 1,
      duplicate_basis: "same_staff_normalized_vaccine_and_dose",
      recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
    }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      vaccinationKey: VACCINATION, duplicateWarning: true,
      duplicateCount: 1, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_staff_vaccination",
      expect.objectContaining({
        p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH,
        p_staff_membership_id: STAFF,
        p_idempotency_key: deterministicUuid(
          "page73-staff-vaccination-record", ORG, ACTOR, KEY,
        ),
      }));
  });

  it.each([
    { duplicate_warning: false, duplicate_count: 1 },
    { duplicate_warning: true, duplicate_count: 1,
      duplicate_basis: "untrusted_basis" },
    { branch_id: ACTOR },
  ])("fails closed on a mismatched receipt %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      organization_id: ORG, branch_id: BRANCH,
      vaccination_key: VACCINATION, record_version_id: VERSION,
      version: 1, previous_version_id: null, record_status: "active",
      staff_membership_id: STAFF, content_hash: "a".repeat(64),
      duplicate_warning: false, duplicate_count: 0,
      duplicate_basis: "same_staff_normalized_vaccine_and_dose",
      recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
      ...override,
    }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
  });

  it("sanitizes database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private health detail" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private health detail");
  });
});
