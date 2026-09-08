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
    const requestId = "22000000-0000-4000-8000-000000000099";
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

const ORG = "22000000-0000-4000-8000-000000000001";
const BRANCH = "22000000-0000-4000-8000-000000000002";
const ACTOR = "22000000-0000-4000-8000-000000000003";
const CLIENT = "22000000-0000-4000-8000-000000000004";
const KEY = "22000000-0000-4000-8000-000000000005";
const REPORT = "22000000-0000-4000-8000-000000000006";
const VERSION = "22000000-0000-4000-8000-000000000007";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "護理主管",
  roles: ["nurse"], scopes: ["clients.read", "health.read",
    "client_reports.read", "client_reports.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const createBody = {
  action: "create", report_key: REPORT, previous_version_id: null,
  expected_base_version: 0, client_id: CLIENT, report_type: "合成檢查",
  examined_on: "2026-08-20", result_status: "present",
  result_text: "合成結果來源原文", result_reason: null,
  source_status: "missing", source_text: null,
  source_reason: "來源單位仍待人工確認補齊", attachment_status: "missing",
  attachment_id: null, attachment_sha256: null,
  attachment_source_filename: null, correction_reason: null,
};

function request(operation: "create" | "correct" | "void" = "create",
  includeOperation = true) {
  const headers: Record<string, string> = { "content-type": "application/json",
    "idempotency-key": KEY };
  if (includeOperation) headers["x-client-inspection-report-operation"] = operation;
  return new Request("https://example.invalid/api/client-inspection-reports", {
    method: "POST", headers, body: "{}",
  });
}

function successReceipt(overrides: Record<string, unknown> = {}) {
  return { organization_id: ORG, branch_id: BRANCH, report_key: REPORT,
    record_version_id: VERSION, version: 1, previous_version_id: null,
    record_status: "active", client_id: CLIENT, content_hash: "a".repeat(64),
    payload_hash: "b".repeat(64), exact_duplicate_count: 1,
    key_field_duplicate_count: 2, attachment_duplicate_count: 0,
    duplicate_warning: true, duplicate_resolution: "warning_only_no_auto_merge",
    recorded_at: "2026-09-07T04:00:00.000Z", replayed: false, ...overrides };
}

describe("Page 22 client inspection report API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: successReceipt(), error: null });
  });

  it("requires the explicit operation header before any body is parsed", async () => {
    const response = await POST(request("create", false));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    { ...actor, scopes: ["clients.read", "health.read", "client_reports.read"] },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects unauthorized writes before reading sensitive content %#",
    async (unauthorizedActor) => {
      stubs.authorizeStaffRequest.mockResolvedValue(unauthorizedActor);
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
      expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
    });

  it("does not demand recent reauthentication for an original create", async () => {
    const response = await POST(request("create"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 for correction before parsing", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("請重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    const response = await POST(request("correct"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects a claimed browser attachment before invoking the database", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...createBody,
      attachment_status: "provided",
      attachment_id: "22000000-0000-4000-8000-000000000020",
      attachment_sha256: "c".repeat(64),
      attachment_source_filename: "pretend.pdf" });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds tenant and actor idempotency and validates the strict receipt", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      reportKey: REPORT, exactDuplicateCount: 1, keyFieldDuplicateCount: 2,
      attachmentDuplicateCount: 0, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_client_inspection_report", {
      p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
      p_payload: expect.objectContaining({ client_id: CLIENT,
        attachment_status: "missing", attachment_id: null }),
      p_idempotency_key: deterministicUuid(
        "page22-client-inspection-report", ORG, ACTOR, KEY,
      ),
    });
  });

  it.each([
    { duplicate_warning: false }, { exact_duplicate_count: 3,
      key_field_duplicate_count: 2 }, { branch_id: ACTOR },
    { payload_hash: "private-result" },
  ])("fails closed on malformed or mismatched persistence receipts %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue({ data: successReceipt(override), error: null });
    expect((await POST(request())).status).toBe(409);
  });

  it("maps database authorization without exposing private details", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private result and policy detail" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private result");
  });
});
