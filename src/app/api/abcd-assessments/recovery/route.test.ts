import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), getTenantContext: vi.fn(),
  authorizeRoutineIntake: vi.fn() }));

vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.getTenantContext }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: stubs.authorizeRoutineIntake }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest, readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "21aa0000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { GET, POST } from "./route";

const organizationId = "21110000-0000-4000-8000-000000000001";
const branchId = "21120000-0000-4000-8000-000000000001";
const clientId = "21140000-0000-4000-8000-000000000001";
const actorId = "21130000-0000-4000-8000-000000000001";
const key = "21150000-0000-4000-8000-000000000001";
const reservationId = "21150000-0000-4000-8000-000000000020";
const assessmentKey = "21160000-0000-4000-8000-000000000001";
const versionId = "21170000-0000-4000-8000-000000000001";
const actor = { organizationId, branchId, userId: actorId, demo: false,
  scopes: ["clients.read", "abcd_assessments.read", "abcd_assessments.manage"] };
const payload = { mode: "create", assessment_key: null, previous_version_id: null,
  expected_version: 0, expected_content_hash: null, client_id: clientId,
  assessment_type: "A", assessment_year: 2026, assessment_date: "2026-09-01",
  manual_summary: "合成評估摘要", result: { state: "recorded", text: "合成結果", reason: null },
  reassessment: { state: "recorded", date: "2026-12-01", basis: "人工複評" },
  reason: "建立初稿" };
const receipt = { organization_id: organizationId, branch_id: branchId, client_id: clientId,
  operation_id: actorId, idempotency_key: key, action: "save_assessment",
  assessment_key: assessmentKey, version_id: versionId, version: 1,
  assessment_state: "draft", assessment_type: "A", assessment_year: 2026,
  previous_version_id: null, source_content_hash: null, content_hash: "a".repeat(64),
  record_payload: { client_id: clientId, assessment_type: "A", assessment_year: 2026,
    assessment_date: "2026-09-01", manual_summary: "合成評估摘要",
    result: { state: "recorded", text: "合成結果", reason: null },
    reassessment: { state: "recorded", date: "2026-12-01", basis: "人工複評" },
    form_kind: "manual_unstandardized", formal_rule_status: "not_configured" },
  committed_at: "2026-09-28T01:02:00Z", replayed: false };
const summary = { organization_id: organizationId, branch_id: branchId,
  client_id: null, generated_at: "2026-09-28T01:02:00Z", absence_is_final: false,
  truncated: false, pending_truncated: false, operations: [{ reservation_id: reservationId,
    client_id: clientId, operation: "create", assessment_type: "A", assessment_year: 2026,
    baseline_version: 0, state: "pending", created_at: "2026-09-28T01:01:00Z",
    committed_at: null }] };

describe("ABCD reload recovery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.getTenantContext.mockResolvedValue({ ...actor, assuranceLevel: "aal2" });
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, assuranceLevel: "aal2" });
    stubs.authorizeRoutineIntake.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    stubs.readJsonObject.mockResolvedValue({ reservation_id: reservationId });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockImplementation((name: string) => Promise.resolve({ data: name ===
      "abcd_assessment_recovery_snapshot" ? summary : { receipt,
        request: { action: "save_assessment", payload, idempotency_key: key } }, error: null }));
  });

  it("lists only bounded metadata; absence is explicitly non-final", async () => {
    const response = await GET(new Request("https://example.invalid/api/abcd-assessments/recovery"));
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("abcd_assessment_recovery_snapshot", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_client_id: null });
    const result = (await response.json()).data;
    expect(result).toMatchObject({ absenceIsFinal: false, truncated: false,
      operations: [{ reservationId, clientId, state: "pending" }] });
    expect(JSON.stringify(result)).not.toContain("合成評估摘要");
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("supports exact client filtering, but rejects extra or repeated filters", async () => {
    stubs.rpc.mockResolvedValue({ data: { ...summary, client_id: clientId }, error: null });
    const url = `https://example.invalid/api/abcd-assessments/recovery?client_id=${clientId}`;
    expect((await GET(new Request(url))).status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("abcd_assessment_recovery_snapshot",
      expect.objectContaining({ p_client_id: clientId }));
    expect((await GET(new Request(`${url}&client_id=${clientId}`))).status).toBe(400);
    expect((await GET(new Request(`${url}&q=x`))).status).toBe(400);
  });

  it("uses exact-client approved Google intake for AAL1 read and denies unapproved access", async () => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    stubs.rpc.mockResolvedValue({ data: { ...summary, client_id: clientId }, error: null });
    const url = `https://example.invalid/api/abcd-assessments/recovery?client_id=${clientId}`;
    expect((await GET(new Request(url))).status).toBe(200);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.authorizeRoutineIntake).toHaveBeenCalledExactlyOnceWith("abcd.read", clientId);
    stubs.rpc.mockClear();
    stubs.authorizeRoutineIntake.mockRejectedValueOnce(Object.assign(new Error("not approved"),
      { code: "INTAKE_NOT_AUTHORIZED", httpStatus: 403 }));
    expect((await GET(new Request(url))).status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("lets an AAL1 actor query the bounded actor-owned list and resume only through DB scope", async () => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    const list = await GET(new Request("https://example.invalid/api/abcd-assessments/recovery"));
    expect(list.status).toBe(200);
    expect(stubs.authorizeRoutineIntake).not.toHaveBeenCalled();
    const resumed = await POST(new Request("https://example.invalid/api/abcd-assessments/recovery",
      { method: "POST" }));
    expect(resumed.status).toBe(201);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith("resume_abcd_assessment_operation",
      expect.objectContaining({ p_reservation_id: reservationId }));
  });

  it("does not query when role permission is absent", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["clients.read", "abcd_assessments.read"] });
    expect((await GET(new Request("https://example.invalid/api/abcd-assessments/recovery"))).status)
      .toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("continues with original server-held body/key and does not create a replacement key", async () => {
    const request = new Request("https://example.invalid/api/abcd-assessments/recovery", {
      method: "POST", body: JSON.stringify({ reservation_id: reservationId }) });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("resume_abcd_assessment_operation", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_reservation_id: reservationId });
    expect((await response.json()).data).toMatchObject({ reservationId,
      idempotencyKey: key, assessmentState: "draft", persisted: true });
    stubs.rpc.mockResolvedValue({ data: { receipt: { ...receipt, replayed: true },
      request: { action: "save_assessment", payload, idempotency_key: key } }, error: null });
    const replay = await POST(request); expect(replay.status).toBe(200);
    expect((await replay.json()).data).toMatchObject({ reservationId, idempotencyKey: key,
      replayed: true });
  });

  it("rejects altered saved body, forged receipt and cross-scope DB denial", async () => {
    stubs.rpc.mockResolvedValueOnce({ data: { receipt, request: { action: "save_assessment",
      payload: { ...payload, manual_summary: "遭置換內容" }, idempotency_key: key } }, error: null });
    expect((await POST(new Request("https://example.invalid", { method: "POST" }))).status).toBe(502);
    stubs.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private" } });
    const denied = await POST(new Request("https://example.invalid", { method: "POST" }));
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toContain("private");
  });
});
