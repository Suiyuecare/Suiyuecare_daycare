import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
import { ClientMasterSnapshotError, loadClientMasterSnapshot } from "./master-snapshot";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const branchId = "b1111111-1111-4111-8111-111111111111";
const clientId = "c1111111-1111-4111-8111-111111111111";
const context = { organizationId, branchId, userId: clientId, demo: false, scopes: ["clients.read"] } as TenantContext;
const row = { client_id: clientId, organization_id: organizationId, branch_id: branchId,
  client_code: "SYN-001", display_name: "合成個案", date_of_birth: null, status: "active",
  admitted_on: "2026-09-01", ended_on: null, source_system: "local", source_updated_at: null,
  row_version: 1, updated_at: "2026-09-01T01:00:00Z", visible_count: 1 };
const response = { data: [row], error: null };
const db = { rpc: mocks.rpc } as unknown as NonNullable<NonNullable<Parameters<typeof loadClientMasterSnapshot>[2]>["supabase"]>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(db);
  mocks.rpc.mockReturnValue(Promise.resolve(response));
  mocks.abort.mockResolvedValue(response);
});

describe("client master optional read owner", () => {
  it("preserves existing callers, audited interaction and exact tenant inputs", async () => {
    expect(await loadClientMasterSnapshot(context, "search")).toMatchObject({ clients: [{ id: clientId, displayName: "合成個案", dateOfBirth: null }] });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("client_master_snapshot", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_interaction: "search",
    });
    expect(mocks.abort).not.toHaveBeenCalled();
  });
  it("reuses a supplied client and forwards the owner's signal without a new timer", async () => {
    const controller = new AbortController();
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
    const result = await loadClientMasterSnapshot(context, "view", { supabase: db, signal: controller.signal });
    expect(result.clients[0].displayName).toBe("合成個案");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(controller.signal.aborted).toBe(false);
  });
  it("keeps scope checks and synthetic preview ahead of all provider reads", async () => {
    await expect(loadClientMasterSnapshot({ ...context, scopes: [] }, "view", { supabase: db })).rejects.toBeInstanceOf(ClientMasterSnapshotError);
    expect((await loadClientMasterSnapshot({ ...context, demo: true })).demo).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not start a source for an already aborted owner", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadClientMasterSnapshot(context, "view", { supabase: db, signal: controller.signal })).rejects.toBeInstanceOf(ClientMasterSnapshotError);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not start a source after client creation outlives its owner", async () => {
    const controller = new AbortController(); let resolve!: (value: typeof db) => void;
    mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadClientMasterSnapshot(context, "view", { signal: controller.signal });
    controller.abort(); resolve(db);
    await expect(result).rejects.toBeInstanceOf(ClientMasterSnapshotError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects late provider data after owner cancellation and never retries", async () => {
    const controller = new AbortController(); let resolve!: (value: typeof response) => void;
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
    mocks.abort.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadClientMasterSnapshot(context, "view", { supabase: db, signal: controller.signal });
    controller.abort(); resolve(response);
    await expect(result).rejects.toBeInstanceOf(ClientMasterSnapshotError);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { data: [{ ...row, visible_count: 2 }], error: null },
    { data: [{ ...row, branch_id: organizationId }], error: null },
    { data: [{ ...row, date_of_birth: "1948-01-01" }], error: null },
    { data: null, error: { code: "42501", message: "private provider detail" } },
  ])("preserves completeness, tenant, demographic and provider fail-closed checks", async (bad) => {
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockResolvedValue(bad);
    await expect(loadClientMasterSnapshot(context, "view", { supabase: db, signal: new AbortController().signal })).rejects.toBeInstanceOf(ClientMasterSnapshotError);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
