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
const workspace = { clientId: client.client_id, scopes: ["care.read"], publications: [], messages: [], preferences: { version: 0, pushEnabled: false, categories: ["messages"], quietStart: "21:00", quietEnd: "08:00", contactPhone: null }, unreadCount: 0, updatedAt: "2026-10-11T01:00:00Z" };
function queueWorkspace(payload: unknown) { mocks.rpc.mockReturnValueOnce({ maybeSingle: async () => ({ data: { payload }, error: null }) }); }
describe("family loader does not promote identity or legacy care metadata to published data", () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.demo.mockReturnValue(false); });
  it("keeps unknown counts/timestamps null, not zero or the identity update time", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client], error: null }); queueWorkspace(workspace);
    expect(await loadFamilyPortalSnapshot(org, branch)).toMatchObject({ state: "ready", publicationStatus: "configured",
      todayCompletedServices: null, latestCareSummary: null, updatedAt: null, workspace });
    expect(mocks.rpc.mock.calls[1]).toEqual(["family_workspace", { p_org: org, p_branch: branch, p_client: client.client_id }]);
  });
  it("fails closed if an older deployment still returns unapproved care metadata", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client], error: null }); queueWorkspace([{
      record_id: "84300000-0000-4000-8000-000000000001", category: "internal_only", occurred_at: "2026-09-08T01:00:00Z",
      effective_from: null, effective_to: null, signed_at: "2026-09-08T01:02:00Z", updated_at: "2026-09-08T01:02:00Z",
    }]);
    await expect(loadFamilyPortalSnapshot(org, branch)).rejects.toThrow();
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
  it("rejects a validly shaped workspace returned for a different client", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client], error: null }); queueWorkspace({ ...workspace, clientId: "84200000-0000-4000-8000-000000000009" });
    await expect(loadFamilyPortalSnapshot(org, branch)).rejects.toThrow("FAMILY_CLIENT_SCOPE_MISMATCH");
  });
  it("does not accept a published category missing its explicit consent scope", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [client], error: null }); queueWorkspace({ ...workspace, publications: [{ id: org, category: "health", title: "未授權健康摘要", summary: "不可顯示", occurredAt: workspace.updatedAt, publishedAt: workspace.updatedAt, sourceId: org, bill: null }] });
    await expect(loadFamilyPortalSnapshot(org, branch)).rejects.toThrow("FAMILY_CATEGORY_SCOPE_MISMATCH");
  });
});
