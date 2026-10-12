import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
import { GET } from "./route";
const actor = { organizationId: "e9100000-0000-4000-8000-000000000001", branchId: "e9200000-0000-4000-8000-000000000001", userId: "e9000000-0000-4000-8000-000000000002", demo: false }, client = "e9300000-0000-4000-8000-000000000001";
const snapshot = { clientId: client, month: "2026-10", items: [], snapshotHash: "a".repeat(64), updatedAt: "2026-10-12T00:00:00Z" };
beforeEach(() => { mocks.actor.mockReset().mockResolvedValue(actor); mocks.rpc.mockReset().mockReturnValue({ maybeSingle: async () => ({ data: { payload: snapshot }, error: null }) }); });
describe("family calendar endpoint envelope", () => {
  it("uses only authenticated tenant and explicit validated client/month", async () => { expect((await GET(new Request(`https://local.invalid/api/family-schedule?client=${client}&month=2026-10`))).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("family_schedule_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: client, p_month: "2026-10-01", p_staff: false }); expect(mocks.actor).toHaveBeenCalledWith("family"); });
  it("staff mode requires a separate staff context, not family admission", async () => { await GET(new Request(`https://local.invalid/api/family-schedule?client=${client}&month=2026-10&audience=staff`)); expect(mocks.actor).toHaveBeenCalledWith("staff"); expect(mocks.rpc.mock.calls[0][1].p_staff).toBe(true); });
  it.each([null, { ...actor, demo: true }, { ...actor, branchId: null }])("rejects unauthenticated/demo/missing branch before RPC", async value => { mocks.actor.mockResolvedValue(value); expect([401,403]).toContain((await GET(new Request(`https://local.invalid/api/family-schedule?client=${client}&month=2026-10`))).status); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("propagates SQL consent denial and rejects mismatched snapshot", async () => { mocks.rpc.mockReturnValueOnce({ maybeSingle: async () => ({ data: null, error: { code: "42501" } }) }); expect((await GET(new Request(`https://local.invalid/api/family-schedule?client=${client}&month=2026-10`))).status).toBe(403); mocks.rpc.mockReturnValueOnce({ maybeSingle: async () => ({ data: { payload: { ...snapshot, clientId: actor.userId } }, error: null }) }); expect((await GET(new Request(`https://local.invalid/api/family-schedule?client=${client}&month=2026-10`))).status).toBe(502); });
});
