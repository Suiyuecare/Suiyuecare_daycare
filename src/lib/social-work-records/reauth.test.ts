import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { getSocialWorkRecentAal2At, requireRecentSocialWorkAal2 } from "./reauth";
const actor: TenantContext = {
  organizationId: "29100000-0000-4000-8000-000000000001", branchId: "29200000-0000-4000-8000-000000000001",
  userId: "29000000-0000-4000-8000-000000001001", organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成社工", roles: ["case_manager_social_worker"], assuranceLevel: "aal2", demo: false,
  scopes: ["clients.read", "social_work_records.read", "social_work_records.sign"], recentAal2At: null,
};
const now = "2026-09-26T12:00:00.000Z";
const evidence = { organizationId: actor.organizationId, branchId: actor.branchId,
  actorUserId: actor.userId, verifiedAt: "2026-09-26T19:59:00+08:00" };
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
  mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: evidence, error: null }); });
afterEach(() => { vi.useRealTimers(); });
describe("social-work-only current-session evidence", () => {
  it("retains the actual scoped verified time without changing global context", async () => {
    expect(await getSocialWorkRecentAal2At(actor)).toBe("2026-09-26T11:59:00.000Z");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("social_work_recent_aal2_evidence", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId });
    expect(actor.recentAal2At).toBeNull();
  });
  it("requires capability proof rather than a role-name allowlist", async () => {
    expect(await getSocialWorkRecentAal2At({ ...actor, roles: ["organization_manager"] })).not.toBeNull();
    expect(await getSocialWorkRecentAal2At({ ...actor, scopes: ["clients.read", "social_work_records.read"] })).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("uses a supplied request client without recursive auth/client creation", async () => {
    expect(await getSocialWorkRecentAal2At(actor, { rpc: mocks.rpc })).not.toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" },
    { scopes: ["clients.read", "social_work_records.read", "social_work_records.manage"] },
    { scopes: ["clients.read", "social_work_records.sign"] },
    { scopes: ["social_work_records.read", "social_work_records.sign"] },
    { scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.sign"] },
    { scopes: ["clients.read", "referral_management.read", "referral_management.respond"] }])("does not query without exact module/AAL2 capabilities %j", async changes => {
    expect(await getSocialWorkRecentAal2At({ ...actor, ...changes } as TenantContext)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "actorUserId"])("rejects wrong %s evidence", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...evidence, [field]: "29900000-0000-4000-8000-000000000099" }, error: null });
    expect(await getSocialWorkRecentAal2At(actor)).toBeNull();
  });
  it.each([null, true, [], {}, { ...evidence, extra: "forged" }, { ...evidence, actorUserId: "invalid" },
    { ...evidence, verifiedAt: "2026-09-26T11:59:00" }, { ...evidence, verifiedAt: "2026-02-30T11:59:00Z" },
    { ...evidence, verifiedAt: "2026-09-26T11:44:59.999Z" }, { ...evidence, verifiedAt: "2026-09-26T12:00:00.001Z" }])("fails closed on incomplete/malformed/stale/future proof %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await getSocialWorkRecentAal2At({ ...actor, recentAal2At: now })).toBeNull();
  });
  it("accepts the exact fifteen-minute boundary but requires a fresh check on retry", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...evidence, verifiedAt: "2026-09-26T11:45:00Z" }, error: null });
    await expect(requireRecentSocialWorkAal2(actor)).resolves.toBeUndefined();
    vi.setSystemTime(new Date(Date.parse(now) + 1));
    await expect(requireRecentSocialWorkAal2(actor)).rejects.toMatchObject({ code: "AAL2_REQUIRED", httpStatus: 403 });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("never falls back to cached nursing/referral/global timestamps or infrastructure failures", async () => {
    mocks.rpc.mockResolvedValue({ data: evidence, error: { code: "42501" } });
    await expect(requireRecentSocialWorkAal2({ ...actor, recentAal2At: now })).rejects.toMatchObject({ code: "AAL2_REQUIRED" });
    mocks.rpc.mockRejectedValue(new Error("private failure")); expect(await getSocialWorkRecentAal2At(actor)).toBeNull();
    mocks.client.mockResolvedValue(null); expect(await getSocialWorkRecentAal2At(actor)).toBeNull();
  });
  it("queries original proof on each individual write and does not mutate context", async () => {
    await requireRecentSocialWorkAal2(actor);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requireRecentSocialWorkAal2(actor)).rejects.toMatchObject({ code: "AAL2_REQUIRED" });
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(actor.recentAal2At).toBeNull();
  });
  it("wires only pages28/29 to module proof while global/nursing/referral context stays separate", () => {
    const page = readFileSync(new URL("../../app/app/[...slug]/page.tsx", import.meta.url), "utf8");
    for (const number of [28, 29]) {
      const section = page.split(`if (page.number === ${number}) {`)[1]?.split(`if (page.number === ${number + 1}) {`)[0];
      expect(section).toContain("getSocialWorkRecentAal2At(context)");
      expect(section).not.toContain("hasRecentAal2()"); expect(section).not.toContain("recentAal2At =");
    }
    const context = readFileSync(new URL("../auth/context.ts", import.meta.url), "utf8");
    expect(context).not.toContain("getSocialWorkRecentAal2At"); expect(context).toContain("getNursingRecentAal2At(context, db)");
  });
});
