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
    const requestId = "71000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST as saveRecord } from "./records/route";
import { POST as saveRule } from "./rules/route";

const ORG = "71000000-0000-4000-8000-000000000001";
const BRANCH = "71000000-0000-4000-8000-000000000002";
const ACTOR = "71000000-0000-4000-8000-000000000003";
const STAFF = "71000000-0000-4000-8000-000000000004";
const KEY = "71000000-0000-4000-8000-000000000005";
const TRAINING = "71000000-0000-4000-8000-000000000006";
const VERSION = "71000000-0000-4000-8000-000000000007";
const PROPOSAL = "71000000-0000-4000-8000-000000000008";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["staff_training.read", "staff_training.manage", "staff_training.rules"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const recordBody = {
  action: "create", training_key: TRAINING, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF, course_title: "訓練",
  training_date: "2026-08-20", starts_at: "2026-08-20T09:00:00+08:00",
  ends_at: "2026-08-20T10:00:00+08:00", course_type: "機構自訂",
  hours: "1.0000", credits: null, provider_name: "辦理單位",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null,
};
const ruleBody = { action: "propose", effective_from: "2026-09-02",
  effective_to: null, window_years: 6, required_credits: "120.0000",
  expiry_notice_days: 30 };
function request(path: string) {
  return new Request(`https://example.invalid${path}`, { method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "{}" });
}

describe("page-71 staff training API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects missing record scope before reading the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["staff_training.read"] });
    const response = await saveRecord(request("/api/staff-training/records"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects demo writes before parsing the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await saveRecord(request("/api/staff-training/records"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires rule scope and recent AAL2 before parsing the body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    const response = await saveRule(request("/api/staff-training/rules"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds record scope, actor idempotency and strict new/replay receipts", async () => {
    stubs.readJsonObject.mockResolvedValue(recordBody);
    const receipt = { organization_id: ORG, branch_id: BRANCH,
      training_key: TRAINING, record_version_id: VERSION, version: 1,
      previous_version_id: null, record_status: "active",
      staff_membership_id: STAFF, content_hash: "a".repeat(64),
      recorded_at: "2026-08-20T10:01:00+08:00", replayed: false };
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
    let response = await saveRecord(request("/api/staff-training/records"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      trainingKey: TRAINING, version: 1, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_staff_training_record",
      expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_staff_membership_id: STAFF,
        p_idempotency_key: deterministicUuid(
          "page71-staff-training-record", ORG, ACTOR, KEY,
        ),
      }));
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    response = await saveRecord(request("/api/staff-training/records"));
    expect(response.status).toBe(200);
  });

  it("fails closed on malicious record receipts and sanitizes database detail", async () => {
    stubs.readJsonObject.mockResolvedValue(recordBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: ACTOR, secret: "private row" }, error: null });
    let response = await saveRecord(request("/api/staff-training/records"));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("private row");
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private tenant details" } });
    response = await saveRecord(request("/api/staff-training/records"));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private tenant details");
  });

  it("binds rule proposal arguments and returns strict persisted receipt", async () => {
    stubs.readJsonObject.mockResolvedValue(ruleBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: BRANCH, action: "propose", proposal_id: PROPOSAL,
      rule_version_id: null, version: null, effective_from: "2026-09-02",
      effective_to: null, window_years: 6, required_credits: "120.0000",
      expiry_notice_days: 30, committed_at: "2026-09-01T12:00:00+08:00",
      replayed: false }, error: null });
    const response = await saveRule(request("/api/staff-training/rules"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      action: "propose", proposalId: PROPOSAL, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("propose_staff_training_rule",
      expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_required_credits: "120.0000",
        p_idempotency_key: deterministicUuid(
          "page71-staff-training-rule", ORG, ACTOR, KEY,
        ),
      }));
  });

  it.each([null, 7, { action: "propose", organization_id: ORG },
    { organization_id: ORG, branch_id: ACTOR, action: "propose",
      proposal_id: PROPOSAL, rule_version_id: null, version: null,
      effective_from: "2026-09-02", effective_to: null, window_years: 6,
      required_credits: "120.0000", expiry_notice_days: 30,
      committed_at: "2026-09-01T12:00:00+08:00", replayed: false }])(
    "fails closed on malicious rule receipt %#", async (data) => {
      stubs.readJsonObject.mockResolvedValue(ruleBody);
      stubs.maybeSingle.mockResolvedValue({ data, error: null });
      const response = await saveRule(request("/api/staff-training/rules"));
      expect(response.status).toBe(409);
    },
  );
});
