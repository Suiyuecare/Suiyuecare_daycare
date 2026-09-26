import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { getReferralRecentAal2At, requireRecentReferralAal2 } from "./reauth";

const actor: TenantContext = { organizationId: "39100000-0000-4000-8000-000000000001", branchId: "39200000-0000-4000-8000-000000000001",
  userId: "39000000-0000-4000-8000-000000000013", organizationName: "合成機構", branchName: "合成分支", displayName: "合成社工",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "referral_management.read", "referral_management.create"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const now = "2026-09-26T12:00:00.000Z";
const evidence = { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, verifiedAt: "2026-09-26T19:59:00+08:00" };
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
  mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: evidence, error: null }); });
afterEach(() => { vi.useRealTimers(); });
describe("referral-only current session evidence", () => {
  it("uses the approved nonCEO actor scope and retains the original verified time", async () => {
    expect(await getReferralRecentAal2At(actor)).toBe("2026-09-26T11:59:00.000Z");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("referral_recent_aal2_evidence", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId });
    expect(actor.recentAal2At).toBeNull();
  });
  it.each(["create", "submit", "receive", "respond", "close", "correct"])("allows exact %s capability to request DB proof, not a role-name bypass", async action => {
    expect(await getReferralRecentAal2At({ ...actor, roles: ["organization_manager"],
      scopes: ["clients.read", "referral_management.read", `referral_management.${action}`] })).not.toBeNull();
  });
  it("uses an existing request client without recursively loading auth or another client", async () => {
    expect(await getReferralRecentAal2At(actor, { rpc: mocks.rpc })).not.toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" },
    { scopes: ["clients.read", "referral_management.read"] },
    { scopes: ["referral_management.read", "referral_management.create"] },
    { scopes: ["clients.read", "referral_management.create"] },
    { scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.sign"] }])("does not fetch evidence without exact module capabilities %j", async change => {
    expect(await getReferralRecentAal2At({ ...actor, ...change } as TenantContext)).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId"])("rejects another %s without adopting their time", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...evidence, [field]: "39900000-0000-4000-8000-000000000099" }, error: null });
    expect(await getReferralRecentAal2At(actor)).toBeNull();
  });
  it.each([null, true, {}, [], { ...evidence, sessionId: "forged" }, { ...evidence, actorUserId: "not-uuid" },
    { ...evidence, verifiedAt: "2026-09-26T11:59:00" }, { ...evidence, verifiedAt: "2026-02-30T11:59:00Z" },
    { ...evidence, verifiedAt: "2026-09-26T11:44:59.999Z" }, { ...evidence, verifiedAt: "2026-09-26T12:00:00.001Z" }])("fails closed on missing/malformed/stale/future evidence %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await getReferralRecentAal2At({ ...actor, recentAal2At: now })).toBeNull();
  });
  it("accepts the exact fifteen-minute boundary but not a later retry", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...evidence, verifiedAt: "2026-09-26T11:45:00Z" }, error: null });
    expect(await getReferralRecentAal2At(actor)).toBe("2026-09-26T11:45:00.000Z");
    vi.setSystemTime(new Date(Date.parse(now) + 1)); expect(await getReferralRecentAal2At(actor)).toBeNull();
  });
  it("never substitutes cached nursing/global context time for a rejected fresh lookup", async () => {
    mocks.rpc.mockResolvedValue({ data: evidence, error: { code: "42501" } });
    await expect(requireRecentReferralAal2({ ...actor, recentAal2At: now })).rejects.toMatchObject({ code: "AAL2_REQUIRED", httpStatus: 403 });
    mocks.rpc.mockRejectedValue(new Error("private DB failure")); expect(await getReferralRecentAal2At(actor)).toBeNull();
    mocks.client.mockResolvedValue(null); expect(await getReferralRecentAal2At(actor)).toBeNull();
  });
  it("requires a new current RPC proof on every write attempt", async () => {
    await expect(requireRecentReferralAal2(actor)).resolves.toBeUndefined();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requireRecentReferralAal2(actor)).rejects.toMatchObject({ code: "AAL2_REQUIRED" }); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("wires only the referral page to module proof and leaves global/nursing context unchanged", () => {
    const page = readFileSync(new URL("../../app/app/[...slug]/page.tsx", import.meta.url), "utf8");
    const referral = page.split("if (page.number === 39) {")[1]?.split("if (page.number === 43) {")[0];
    expect(referral).toContain("getReferralRecentAal2At(context)"); expect(referral).not.toContain("hasRecentAal2()");
    expect(referral).not.toContain("recentAal2At =");
    const context = readFileSync(new URL("../auth/context.ts", import.meta.url), "utf8");
    expect(context).not.toContain("getReferralRecentAal2At"); expect(context).toContain("getNursingRecentAal2At(context, db)");
  });
});
