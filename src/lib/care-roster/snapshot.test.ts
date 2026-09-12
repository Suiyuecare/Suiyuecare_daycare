import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
import { loadCareRosterSnapshot } from "./snapshot";
const id = "a1111111-1111-4111-8111-111111111111";
const actor: TenantContext = { organizationId: id, branchId: id, userId: id, organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員", roles: ["care_worker"], scopes: ["clients.read"], demo: false, assuranceLevel: "aal2", recentAal2At: null };
const assignment = { id, clientId: id, staffUserId: id, staffName: "合成人員", serviceDate: "2026-09-12", shift: "morning", version: 1, state: "scheduled", sourceNote: "合成計畫", tasks: [{ kind: "temperature", status: "recorded", evidenceAt: "2026-09-12T01:00:00+00:00" }] };
const payload = { manager: false, assignments: [assignment], staffOptions: [] };
describe("roster snapshot fail closed projection", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ maybeSingle: mocks.single }); mocks.single.mockResolvedValue({ data: { payload }, error: null }); });
  it("returns only validated assigned roster", async () => { expect((await loadCareRosterSnapshot(actor, "2026-09-12")).status).toBe("ready"); });
  it.each([
    { ...payload, assignments: [{ ...assignment, serviceDate: "2026-09-13" }] },
    { ...payload, assignments: [assignment, assignment] },
    { ...payload, assignments: [{ ...assignment, staffUserId: "b1111111-1111-4111-8111-111111111111" }] },
    { ...payload, assignments: [{ ...assignment, tasks: [{ kind: "temperature", status: "recorded", evidenceAt: null }] }] },
    { ...payload, staffOptions: [{ userId: id, name: "不應可見" }] },
  ])("rejects wrong-scope or inconsistent payload", async (bad) => { mocks.single.mockResolvedValue({ data: { payload: bad }, error: null }); expect((await loadCareRosterSnapshot(actor, "2026-09-12")).status).toBe("unavailable"); });
  it("network failure is not a zero-work result", async () => { mocks.single.mockRejectedValue(new Error("network")); expect((await loadCareRosterSnapshot(actor, "2026-09-12")).status).toBe("unavailable"); });
  it("synthetic preview never calls live services", async () => { const data = await loadCareRosterSnapshot({ ...actor, demo: true }, "2026-09-12"); expect(data.demo).toBe(true); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
