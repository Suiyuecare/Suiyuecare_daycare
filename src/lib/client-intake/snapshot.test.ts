import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc }) }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: vi.fn() }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: vi.fn() }));
import { readIntakeSnapshot } from "./server";
import { emptyIntakeProfile } from "./model";
import type { TenantContext } from "@/lib/domain/types";
const id = "fbf50000-0000-4000-8000-000000000001";
const actor = { organizationId: "fbf60000-0000-4000-8000-000000000001", branchId: "fbf70000-0000-4000-8000-000000000001" } as TenantContext;
const snapshot = { clientId: id, profileVersion: 0, clientRowVersion: 1, pending: true,
  profile: { ...emptyIntakeProfile, displayName: "合成來源個案", clientCode: "SOURCE-001" }, fieldAuthority: {}, sourceBatchId: null };
describe("intake snapshot protected-field contract", () => {
  beforeEach(() => rpc.mockReset());
  it("retains server-derived lock metadata and binds the scoped client", async () => {
    rpc.mockResolvedValue({ data: { ...snapshot, protectedFieldKeys: ["clientCode", "displayName"] }, error: null });
    expect((await readIntakeSnapshot(actor, id)).protectedFieldKeys).toEqual(["clientCode", "displayName"]);
    expect(rpc).toHaveBeenCalledWith("client_intake_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: id });
  });
  it("accepts legacy snapshots without inventing a source lock", async () => {
    rpc.mockResolvedValue({ data: snapshot, error: null });
    expect((await readIntakeSnapshot(actor, id)).protectedFieldKeys).toBeUndefined();
  });
  it.each([{ protectedFieldKeys: ["admitted_on"] }, { protectedFieldKeys: ["clientCode", "clientCode"] }, { protectedFieldKeys: "displayName" }, { protectedFieldKeys: null }])("fails closed on malformed lock metadata", async ({ protectedFieldKeys }) => {
    rpc.mockResolvedValue({ data: { ...snapshot, protectedFieldKeys }, error: null });
    await expect(readIntakeSnapshot(actor, id)).rejects.toMatchObject({ code: "INTAKE_UNAVAILABLE" });
  });
  it("rejects another client's otherwise valid lock metadata", async () => {
    rpc.mockResolvedValue({ data: { ...snapshot, clientId: "fbf50000-0000-4000-8000-000000000002", protectedFieldKeys: ["clientCode"] }, error: null });
    await expect(readIntakeSnapshot(actor, id)).rejects.toMatchObject({ code: "INTAKE_UNAVAILABLE" });
  });
});
