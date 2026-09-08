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
    const requestId = "50300000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number; field?: string };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error",
          ...(value.field ? { field: value.field } : {}) }] },
      { status: value.httpStatus ?? 500, headers: { "Cache-Control": "private, no-store" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const ORG = "50310000-0000-4000-8000-000000000001";
const BRANCH = "50320000-0000-4000-8000-000000000001";
const ACTOR = "50330000-0000-4000-8000-000000000001";
const CLIENT = "50340000-0000-4000-8000-000000000001";
const KEY = "50350000-0000-4000-8000-000000000001";
const RECORD = "50360000-0000-4000-8000-000000000001";
const VERSION = "50370000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const actor = {
  organizationId: ORG, organizationName: "合成機構", branchId: BRANCH,
  branchName: "合成分支", userId: ACTOR, displayName: "合成專業人員",
  roles: ["professional"], scopes: ["clients.read", "case_service_records.read",
    "case_service_records.manage", "case_service_records.sign"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const recordPayload = {
  client_id: CLIENT, started_at: "2026-09-08T01:00:00.000Z",
  ended_at: "2026-09-08T01:30:00.000Z", service_type: "生活支持",
  service_content: "人工服務內容。", service_result: "人工服務結果。",
  execution_reference_id: null, execution_reference_status: "not_linked",
  execution_reference_content_hash: null, author_user_id: ACTOR,
  source_kind: "manual_local", schema_kind: "manual_service_narrative_v1",
  statutory_rule_status: "not_configured", claim_eligibility_status: "not_configured",
};
const createBody = {
  action: "save_record", mode: "create", record_key: null, previous_version_id: null,
  expected_version: 0, expected_content_hash: null, client_id: CLIENT,
  started_at: "2026-09-08T09:00:00+08:00", ended_at: "2026-09-08T09:30:00+08:00",
  service_type: "生活支持", service_content: "人工服務內容。",
  service_result: "人工服務結果。", execution_reference_id: null,
  revision_reason: "建立人工服務敘事草稿",
};
const receipt = {
  organization_id: ORG, branch_id: BRANCH, client_id: CLIENT, actor_user_id: ACTOR,
  operation_id: KEY, idempotency_key: KEY, action: "save_record", record_key: RECORD,
  version_id: VERSION, version: 1, record_state: "draft", previous_version_id: null,
  source_content_hash: null, content_hash: HASH, record_payload: recordPayload,
  committed_at: "2026-09-08T01:31:00.000Z", replayed: false,
};

function request(method: "POST" | "PATCH", operation?: "create" | "revise" | "sign" | "correct") {
  return new Request("https://example.invalid/api/case-service-records", {
    method, body: "{}", headers: { "content-type": "application/json", "idempotency-key": KEY,
      ...(operation ? { "x-case-service-record-operation": operation } : {}) },
  });
}

describe("Page 50 case-service-record API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
  });

  it("requires a governed operation header before authority or narrative parsing", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "case_service_records.read"] },
      "CASE_SERVICE_RECORD_NOT_AUTHORIZED"],
  ])("rejects denied creates before reading manual content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it.each(["sign", "correct"] as const)(
    "requires recent same-session AAL2 before parsing %s content",
    async (operation) => {
      stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
        { code: "AAL2_REQUIRED", httpStatus: 403 }));
      const response = await PATCH(request("PATCH", operation));
      expect(response.status).toBe(403);
      expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
      expect(stubs.rpc).not.toHaveBeenCalled();
    },
  );

  it("binds tenant, branch, actor-derived author, exact content and idempotency", async () => {
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_case_service_record", {
      p_expected_organization_id: ORG,
      p_expected_branch_id: BRANCH,
      p_action: "save_record",
      p_payload: { client_id: CLIENT, record_key: null, previous_version_id: null,
        expected_version: 0, expected_content_hash: null,
        started_at: "2026-09-08T01:00:00.000Z", ended_at: "2026-09-08T01:30:00.000Z",
        service_type: "生活支持", service_content: "人工服務內容。",
        service_result: "人工服務結果。", execution_reference_id: null,
        reason: "建立人工服務敘事草稿", mode: "create" },
      p_idempotency_key: KEY,
    });
    expect((await response.json()).data).toMatchObject({ organizationId: ORG,
      actorUserId: ACTOR, recordKey: RECORD, persisted: true, demo: false });
  });

  it("rejects a header/body disagreement before touching the database", async () => {
    const response = await PATCH(request("PATCH", "revise"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("sends and correlates the full selected draft when signing", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "sign_record", client_id: CLIENT,
      record_key: RECORD, previous_version_id: VERSION, expected_version: 1,
      expected_content_hash: HASH, expected_record_payload: recordPayload });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, action: "sign_record",
      version_id: "50370000-0000-4000-8000-000000000002", version: 2,
      record_state: "signed", previous_version_id: VERSION, source_content_hash: HASH,
      replayed: true }, error: null });
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(200);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_case_service_record",
      expect.objectContaining({ p_payload: expect.objectContaining({
        expected_record_payload: recordPayload,
      }) }));
    expect((await response.json()).data).toMatchObject({ recordState: "signed",
      previousVersionId: VERSION, sourceContentHash: HASH, replayed: true });
  });

  it("binds a correction to the immutable original author", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "correct_record", client_id: CLIENT,
      record_key: RECORD, previous_version_id: VERSION, expected_version: 1,
      expected_content_hash: HASH, expected_author_user_id: ACTOR,
      started_at: "2026-09-08T09:00:00+08:00", ended_at: "2026-09-08T09:30:00+08:00",
      service_type: "生活支持", service_content: "人工服務內容。",
      service_result: "依紙本核對後修正人工結果。", execution_reference_id: null,
      reason: "依紙本原始紀錄核對後修正人工結果" });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, action: "correct_record",
      version_id: "50370000-0000-4000-8000-000000000002", version: 2,
      record_state: "corrected", previous_version_id: VERSION, source_content_hash: HASH,
      record_payload: { ...recordPayload, service_result: "依紙本核對後修正人工結果。" },
      replayed: false }, error: null });
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_case_service_record",
      expect.objectContaining({ p_payload: expect.objectContaining({
        expected_author_user_id: ACTOR,
      }) }));
    expect((await response.json()).data).toMatchObject({ recordState: "corrected",
      actorUserId: ACTOR, recordPayload: { authorUserId: ACTOR } });
  });

  it.each([
    { organization_id: ACTOR }, { branch_id: ACTOR }, { client_id: ACTOR },
    { actor_user_id: CLIENT }, { version: 2 },
    { record_payload: { ...recordPayload, service_result: "遭置換" } },
  ])("fails closed on a mismatched 2xx database receipt", async (forgery) => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, ...forgery }, error: null });
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("CASE_SERVICE_RECORD_RECEIPT_INVALID");
  });

  it.each([
    ["42501", 403, "CASE_SERVICE_RECORD_NOT_AUTHORIZED"],
    ["40001", 409, "CASE_SERVICE_RECORD_VERSION_CONFLICT"],
    ["23505", 409, "CASE_SERVICE_RECORD_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "CASE_SERVICE_RECORD_STATE_CONFLICT"],
    ["22023", 400, "INVALID_CASE_SERVICE_RECORD_OPERATION"],
    ["XX000", 409, "CASE_SERVICE_RECORD_RESULT_UNCERTAIN"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "sensitive detail" } });
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(status);
    const payload = await response.json();
    expect(payload.errors[0].code).toBe(expected);
    expect(JSON.stringify(payload)).not.toContain("sensitive detail");
    if (code === "XX000") expect(payload.errors[0].message).toContain("相同操作鍵");
  });
});
