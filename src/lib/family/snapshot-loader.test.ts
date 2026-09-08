import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), demo: vi.fn(() => false) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
import { loadFamilyPortalSnapshot } from "./snapshot";

const org = "84000000-0000-4000-8000-000000000001";
const branch = "84100000-0000-4000-8000-000000000001";
const client = { client_id: "84200000-0000-4000-8000-000000000001", branch_id: branch,
  display_name: "合成個案", client_status: "active", admitted_on: "2026-09-01", updated_at: "2026-09-08T01:23:45Z" };
describe("family loader does not promote identity or legacy care metadata to published data", () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.demo.mockReturnValue(false); });
  it("keeps unknown counts/timestamps null, not zero or the identity update time", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await loadFamilyPortalSnapshot(org, branch)).toMatchObject({ state: "ready", publicationStatus: "not_configured",
      todayCompletedServices: null, latestCareSummary: null, updatedAt: null });
  });
  it("fails closed if an older deployment still returns unapproved care metadata", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client], error: null }).mockResolvedValueOnce({ error: null, data: [{
      record_id: "84300000-0000-4000-8000-000000000001", category: "internal_only", occurred_at: "2026-09-08T01:00:00Z",
      effective_from: null, effective_to: null, signed_at: "2026-09-08T01:02:00Z", updated_at: "2026-09-08T01:02:00Z",
    }] });
    await expect(loadFamilyPortalSnapshot(org, branch)).rejects.toThrow("FAMILY_PUBLICATION_NOT_CONFIGURED");
  });
  it("does not load a different branch client's care", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...client, branch_id: "84100000-0000-4000-8000-000000000002" }], error: null });
    expect(await loadFamilyPortalSnapshot(org, branch)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not choose or query care automatically when multiple clients are available", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client, { ...client, client_id: "84200000-0000-4000-8000-000000000002" }], error: null });
    expect(await loadFamilyPortalSnapshot(org, branch)).toMatchObject({ state: "selection_required" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
