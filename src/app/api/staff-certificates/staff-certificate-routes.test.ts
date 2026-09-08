import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "72000000-0000-4000-8000-000000000099";
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

import { POST as saveException } from "./exceptions/route";
import { POST as saveRecord } from "./records/route";

const ORG = "72000000-0000-4000-8000-000000000001";
const BRANCH = "72000000-0000-4000-8000-000000000002";
const ACTOR = "72000000-0000-4000-8000-000000000003";
const STAFF = "72040000-0000-4000-8000-000000000001";
const KEY = "72000000-0000-4000-8000-000000000005";
const CERT = "72071000-0000-4000-8000-000000000005";
const VERSION = "72070000-0000-4000-8000-000000000005";
const REQUEST = "72080000-0000-4000-8000-000000000005";
const APPROVAL = "72090000-0000-4000-8000-000000000005";
const actor = { organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"], scopes: ["staff_certificates.read",
    "staff_certificates.manage", "staff_certificates.exceptions"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const recordBody = { action: "create", certificate_key: CERT,
  previous_version_id: null, expected_base_version: 0, staff_membership_id: STAFF,
  certificate_type: "合成證照", certificate_number: "SYNTH-001",
  effective_on: "2026-01-01", expires_on: "2027-01-01",
  registration_status: "registered", verification_status: "verified",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null };
const exceptionBody = { action: "approve", request_id: REQUEST,
  certificate_key: CERT, certificate_version_id: VERSION,
  expected_certificate_version: 1, expected_approval_count: 1 };
function request(path: string) {
  return new Request(`https://example.invalid${path}`, { method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "{}" });
}

describe("page-72 staff certificate API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects missing scope before reading the sensitive body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["staff_certificates.read"] });
    const response = await saveRecord(request("/api/staff-certificates/records"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects all demo writes before parsing the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await saveException(request("/api/staff-certificates/exceptions"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before reading an exception body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    const response = await saveException(request("/api/staff-certificates/exceptions"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, actor idempotency and strict record receipt", async () => {
    stubs.readJsonObject.mockResolvedValue(recordBody);
    const receipt = { organization_id: ORG, branch_id: BRANCH,
      certificate_key: CERT, record_version_id: VERSION, version: 1,
      previous_version_id: null, record_status: "active", staff_membership_id: STAFF,
      content_hash: "a".repeat(64), recorded_at: "2026-09-02T04:00:00.000Z",
      replayed: false };
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
    let response = await saveRecord(request("/api/staff-certificates/records"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      certificateKey: CERT, version: 1, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_staff_certificate",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_staff_membership_id: STAFF,
        p_idempotency_key: deterministicUuid(
          "page72-staff-certificate-record", ORG, ACTOR, KEY,
        ) }));
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    response = await saveRecord(request("/api/staff-certificates/records"));
    expect(response.status).toBe(200);
  });

  it("fails closed on a cross-branch receipt and sanitizes database detail", async () => {
    stubs.readJsonObject.mockResolvedValue(recordBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: ACTOR, secret: "private certificate" }, error: null });
    let response = await saveRecord(request("/api/staff-certificates/records"));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("private certificate");
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private tenant detail" } });
    response = await saveRecord(request("/api/staff-certificates/records"));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private tenant detail");
  });

  it("binds expected certificate version and approval count", async () => {
    stubs.readJsonObject.mockResolvedValue(exceptionBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: BRANCH, action: "approve", request_id: REQUEST,
      certificate_key: CERT, certificate_version_id: VERSION,
      expected_certificate_version: 1, approval_id: APPROVAL, approval_count: 2,
      exception_status: "approved", valid_from: "2026-09-02",
      valid_through: "2026-09-30", committed_at: "2026-09-02T04:00:00.000Z",
      replayed: false }, error: null });
    const response = await saveException(request("/api/staff-certificates/exceptions"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      requestId: REQUEST, approvalCount: 2, exceptionStatus: "approved",
    });
    expect(stubs.rpc).toHaveBeenCalledWith("approve_staff_certificate_exception",
      expect.objectContaining({ p_request_id: REQUEST,
        p_expected_certificate_version: 1, p_expected_approval_count: 1,
        p_idempotency_key: deterministicUuid(
          "page72-staff-certificate-exception", ORG, ACTOR, KEY,
        ) }));
  });

  it.each([null, 7, { organization_id: ORG }, {
    organization_id: ORG, branch_id: BRANCH, action: "approve",
    request_id: REQUEST, certificate_key: CERT, certificate_version_id: VERSION,
    expected_certificate_version: 1, approval_id: APPROVAL, approval_count: 1,
    exception_status: "pending", valid_from: "2026-09-02",
    valid_through: "2026-09-30", committed_at: "2026-09-02T04:00:00.000Z",
    replayed: false,
  }])("fails closed on mismatched exception receipt %#", async (data) => {
    stubs.readJsonObject.mockResolvedValue(exceptionBody);
    stubs.maybeSingle.mockResolvedValue({ data, error: null });
    const response = await saveException(request("/api/staff-certificates/exceptions"));
    expect(response.status).toBe(409);
  });
});
