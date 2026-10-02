import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { getNursingRecentAal2At, requireRecentNursingAal2 } from "./reauth";

const actor: TenantContext = { organizationId: "51100000-0000-4000-8000-000000000001", branchId: "51200000-0000-4000-8000-000000000001",
  userId: "51000000-0000-4000-8000-000000000013", organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理員",
  roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.sign"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const now = "2026-09-26T12:00:00.000Z";
const evidence = { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, verifiedAt: "2026-09-26T19:59:00+08:00" };
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
  mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: evidence, error: null }); });
afterEach(() => { vi.useRealTimers(); });
describe("nursing-only current session evidence", () => {
  it("reads the exact current nursing scope and retains the original verified time", async () => {
    expect(await getNursingRecentAal2At(actor)).toBe("2026-09-26T11:59:00.000Z");
    expect(mocks.rpc).toHaveBeenCalledWith("nursing_recent_aal2_evidence", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId });
  });
  it("uses supplied request-scoped client without recursively loading auth or another client", async () => {
    expect(await getNursingRecentAal2At(actor, { rpc: mocks.rpc })).not.toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" }, { roles: ["organization_manager"] },
    { scopes: ["clients.read", "nursing_assessments.read"] }, { scopes: ["nursing_assessments.read", "nursing_assessments.sign"] },
    { scopes: ["clients.read", "nursing_assessments.sign"] }])("does not fetch evidence without exact nursing authority %j", async (change) => {
    expect(await getNursingRecentAal2At({ ...actor, ...change } as TenantContext)).toBeNull(); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId"])("rejects another %s without adopting their verified time", async (field) => {
    mocks.rpc.mockResolvedValue({ data: { ...evidence, [field]: "51900000-0000-4000-8000-000000000099" }, error: null });
    expect(await getNursingRecentAal2At(actor)).toBeNull();
  });
  it.each([null, true, {}, { ...evidence, forged: true }, { ...evidence, verifiedAt: "2026-09-26T11:59:00" },
    { ...evidence, verifiedAt: "2026-09-26T11:44:59Z" }, { ...evidence, verifiedAt: "2026-09-26T12:00:01Z" }])("fails closed on missing, malformed or stale evidence %j", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null }); expect(await getNursingRecentAal2At({ ...actor, recentAal2At: now })).toBeNull();
  });
  it("accepts the exact fifteen-minute boundary but not a later retry", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...evidence, verifiedAt: "2026-09-26T11:45:00Z" }, error: null });
    expect(await getNursingRecentAal2At(actor)).toBe("2026-09-26T11:45:00.000Z");
    vi.setSystemTime(new Date(Date.parse(now) + 1)); expect(await getNursingRecentAal2At(actor)).toBeNull();
  });
  it("never uses cached context time to authorize an unavailable or rejected fresh read", async () => {
    mocks.rpc.mockResolvedValue({ data: evidence, error: { code: "42501" } });
    await expect(requireRecentNursingAal2({ ...actor, recentAal2At: now })).rejects.toMatchObject({ code: "AAL2_REQUIRED", httpStatus: 403 });
    mocks.rpc.mockRejectedValue(new Error("unavailable")); expect(await getNursingRecentAal2At(actor)).toBeNull();
    mocks.client.mockResolvedValue(null); expect(await getNursingRecentAal2At(actor)).toBeNull();
  });
  it("requires a fresh exact DB response on every high-risk attempt", async () => {
    await expect(requireRecentNursingAal2(actor)).resolves.toBeUndefined();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requireRecentNursingAal2(actor)).rejects.toMatchObject({ code: "AAL2_REQUIRED" }); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
