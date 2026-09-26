import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), client: vi.fn(), rpc: vi.fn(), single: vi.fn(), evidence: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: mocks.actor,
  readJsonObject: async (request: Request) => request.json(),
  databaseFailure: (code: string, message: string, status: number) => new IntegrationError(code, message, status),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => {
    const requestId = "39600000-0000-4000-8000-000000000099";
    try { return await fn(requestId); }
    catch (error) { const e = error as IntegrationError; return Response.json({ requestId, status: "error", data: null,
      errors: [{ code: e.code, message: e.message }] }, { status: e.httpStatus ?? 500 }); }
  },
}));
// Real referral reauth + parser + correlated receipt, not a stubbed success.
import { POST } from "./route";
const organizationId = "39100000-0000-4000-8000-000000000001";
const branchId = "39200000-0000-4000-8000-000000000001";
const userId = "39000000-0000-4000-8000-000000000013";
const actor = { organizationId, branchId, userId, organizationName: "合成機構", branchName: "合成分支", displayName: "合成社工",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "referral_management.read", "referral_management.create"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-26T12:00:00.000Z", demo: false };
const key = "39600000-0000-4000-8000-000000000001";
const input = { action: "create", clientId: "39400000-0000-4000-8000-000000000001", receivingUnitState: "missing",
  receivingUnitCode: null, receivingUnitName: null, referralDate: "2026-09-26T09:00:00+08:00", referralReason: "合成轉介原因" };
const evidence = { organizationId, branchId, actorUserId: userId, verifiedAt: "2026-09-26T11:59:00Z" };
const receipt = { organization_id: organizationId, branch_id: branchId, operation_id: key,
  operation_kind: "create", referral_key: "39600000-0000-4000-8000-000000000002", event_id: "39600000-0000-4000-8000-000000000003",
  event_sequence: 1, previous_event_id: null, event_kind: "created", referral_status: "draft", receiving_unit_state: "missing",
  notification_count: 1, notification_queue_status: "queued", notification_provider_status: "not_configured", external_delivery_status: "not_configured",
  delivery_claim: "no_external_delivery_claim", attachment_status: "not_configured", export_status: "not_configured", committed_at: "2026-09-26T12:00:00Z", replayed: false };
const request = () => new Request("https://example.invalid/api/referrals", { method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(input) });
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  mocks.actor.mockResolvedValue(actor); mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.evidence.mockResolvedValue({ data: evidence, error: null }); mocks.single.mockResolvedValue({ data: receipt, error: null });
  mocks.rpc.mockImplementation((name: string) => name === "referral_recent_aal2_evidence" ? mocks.evidence() : { maybeSingle: mocks.single });
});
afterEach(() => { vi.useRealTimers(); });
describe("referral API with real module evidence adapter", () => {
  it("allows approved social-worker action only after exact module evidence", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["referral_recent_aal2_evidence", "mutate_referral_management"]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "referral_recent_aal2_evidence", { p_expected_organization_id: organizationId, p_expected_branch_id: branchId });
  });
  it.each([null, { ...evidence, branchId: userId }, { ...evidence, actorUserId: branchId },
    { ...evidence, verifiedAt: "2026-09-26T11:44:59Z" }, { ...evidence, verifiedAt: "2026-09-26T12:00:01Z" },
    { ...evidence, privateContent: "not permitted" }])("denies malformed/current-scope evidence without any mutation %j", async data => {
    mocks.evidence.mockResolvedValue({ data, error: null });
    const response = await POST(request()); expect(response.status).toBe(403);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["referral_recent_aal2_evidence"]); expect(mocks.single).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("not permitted");
  });
  it("rechecks an exact retry and refuses stale evidence despite a cached fresh context stamp", async () => {
    expect((await POST(request())).status).toBe(201);
    mocks.evidence.mockResolvedValue({ data: null, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.evidence).toHaveBeenCalledTimes(2); expect(mocks.single).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalledWith("has_recent_aal2", expect.anything());
  });
});
