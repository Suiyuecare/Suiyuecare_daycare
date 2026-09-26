import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
import { parseSocialWorkActionSuccess } from "@/lib/social-work-records/parser";
import { parsePsychosocialActionSuccess } from "@/lib/psychosocial-assessments/parser";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), client: vi.fn(), rpc: vi.fn(), single: vi.fn(), evidence: vi.fn(), generic: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: mocks.actor, requireRecentAal2: mocks.generic,
  readJsonObject: async (request: Request) => request.json(),
  databaseFailure: (code: string, message: string, status: number) => new IntegrationError(code, message, status),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => {
    const requestId = "29800000-0000-4000-8000-000000000099";
    try { return await fn(requestId); }
    catch (error) { const e = error as IntegrationError; return Response.json({ requestId, status: "error", data: null,
      errors: [{ code: e.code, message: e.message }] }, { status: e.httpStatus ?? 500 }); }
  },
}));
// Real API, scoped reauth adapter and frontend parsers; only Auth/DB transport
// are synthesized. This is not a hosted Auth/RLS acceptance test.
import { PATCH as socialPatch } from "./route";
import { PATCH as psychosocialPatch } from "../psychosocial-assessments/route";
const organizationId = "29100000-0000-4000-8000-000000000001";
const branchId = "29200000-0000-4000-8000-000000000001";
const userId = "29000000-0000-4000-8000-000000001001";
const clientId = "29400000-0000-4000-8000-000000000001";
const sourceKey = "29700000-0000-4000-8000-000000000001";
const previousVersionId = "29710000-0000-4000-8000-000000000001";
const key = "29900000-0000-4000-8000-000000000001";
const actor = { organizationId, branchId, userId, organizationName: "合成機構", branchName: "合成分支", displayName: "合成社工",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "social_work_records.read", "social_work_records.sign"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-26T12:00:00.000Z", demo: false };
const evidence = { organizationId, branchId, actorUserId: userId, verifiedAt: "2026-09-26T11:59:00Z" };
const input = { action: "sign", clientId, previousVersionId, expectedVersion: 1 };
const receipt = { operation_id: key, version_id: "29710000-0000-4000-8000-000000000002",
  committed_at: "2026-09-26T12:00:00Z", replayed: false, record_state: "signed" };
function fixture(module: "social" | "psychosocial") {
  if (module === "social") return {
    patch: socialPatch, path: "social-work-records", rpc: "sign_social_work_service_record",
    body: { ...input, recordKey: sourceKey },
    row: { ...receipt, record_key: sourceKey, record_version: 2 },
  };
  return {
    patch: psychosocialPatch, path: "psychosocial-assessments", rpc: "sign_psychosocial_assessment",
    body: { ...input, assessmentKey: sourceKey },
    row: { ...receipt, client_id: clientId, assessment_key: sourceKey, assessment_version: 2,
      assessed_on: "2026-09-26", responsible_user_id: userId, service_status_at_assessment: "active",
      reassessment_due_on: "2026-10-26", form_version_reference: "manual-psychosocial-v1" },
  };
}
function request(value: ReturnType<typeof fixture>) {
  return new Request(`https://example.invalid/api/${value.path}`, { method: "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(value.body) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  mocks.actor.mockResolvedValue(actor); mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.generic.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "generic rejected", 403));
  mocks.evidence.mockResolvedValue({ data: evidence, error: null });
  mocks.rpc.mockImplementation((name: string) => name === "social_work_recent_aal2_evidence" ? mocks.evidence() : { maybeSingle: mocks.single });
});
afterEach(() => { vi.useRealTimers(); });
describe.each(["social", "psychosocial"] as const)("%s signing with real scoped proof", module => {
  it("requires scoped proof on new signing and exact replay, preserving the real HTTP/client contract", async () => {
    const value = fixture(module);
    for (const replayed of [false, true]) {
      mocks.single.mockResolvedValue({ data: { ...value.row, replayed }, error: null });
      const response = await value.patch(request(value));
      const envelope = await response.json();
      expect(response.status).toBe(replayed ? 200 : 201);
      if (module === "social") expect(() => parseSocialWorkActionSuccess(envelope,
        { action: "sign", recordKey: sourceKey, expectedVersion: 1 }, response.status)).not.toThrow();
      else expect(() => parsePsychosocialActionSuccess(envelope,
        { action: "sign", clientId, assessmentKey: sourceKey, expectedVersion: 1 }, response.status)).not.toThrow();
    }
    expect(mocks.rpc.mock.calls.map(([name]) => name))
      .toEqual(["social_work_recent_aal2_evidence", value.rpc, "social_work_recent_aal2_evidence", value.rpc]);
    expect(mocks.evidence).toHaveBeenCalledTimes(2); expect(mocks.generic).not.toHaveBeenCalled();
  });
  it.each([null, { ...evidence, branchId: userId }, { ...evidence, actorUserId: branchId },
    { ...evidence, verifiedAt: "2026-09-26T11:44:59Z" }, { ...evidence, verifiedAt: "2026-09-26T12:00:01Z" },
    { ...evidence, patientContent: "not permitted" }])("rejects absent/wrong/stale proof without mutation %j", async data => {
    mocks.evidence.mockResolvedValue({ data, error: null });
    const response = await fixture(module).patch(request(fixture(module)));
    expect(response.status).toBe(403);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["social_work_recent_aal2_evidence"]);
    expect(mocks.single).not.toHaveBeenCalled(); expect(mocks.generic).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("not permitted");
  });
  it("never reuses the cached fresh context timestamp for a stale exact-key retry", async () => {
    const value = fixture(module); mocks.single.mockResolvedValue({ data: value.row, error: null });
    expect((await value.patch(request(value))).status).toBe(201);
    mocks.evidence.mockResolvedValue({ data: null, error: null });
    expect((await value.patch(request(value))).status).toBe(403);
    expect(mocks.evidence).toHaveBeenCalledTimes(2); expect(mocks.single).toHaveBeenCalledOnce();
    expect(mocks.generic).not.toHaveBeenCalled();
  });
});
