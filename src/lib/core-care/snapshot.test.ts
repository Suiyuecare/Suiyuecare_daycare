import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), single: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
import { loadDailyCareSnapshot, CoreCareSnapshotError } from "./snapshot";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";
const organizationId = "d7300000-0000-4000-8000-000000000001";
const branchId = "d7400000-0000-4000-8000-000000000001";
const context = { demo: false, organizationId, branchId, scopes: ["clients.read", "attendance.read"] } as TenantContext;
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockReturnValue({ maybeSingle: mocks.single }); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.single.mockResolvedValue({ error: null, data: { payload: { organizationId, branchId, serviceDate: "2026-09-15", generatedAt: "2026-09-15T02:00:00Z", clients: [], attendance: [], measurements: [], careDiaries: [], serviceEvents: [] } } }); });
afterEach(() => vi.useRealTimers());
it("loads all authorized sources with one RPC and no separate directory or table reads", async () => {
  const result = await loadDailyCareSnapshot(context, "2026-09-15");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("core_daily_snapshot", { p_organization_id: organizationId, p_branch_id: branchId, p_date: "2026-09-15" });
  expect(result.clients).toEqual([]); expect(result.sourceAccess.measurements).toBe(false);
  expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("does not fall back to inconsistent reads when migration is absent", async () => {
  mocks.single.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  await expect(loadDailyCareSnapshot(context, "2026-09-15")).rejects.toBeInstanceOf(CoreCareSnapshotError);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("rejects missing context before RPC", async () => {
  await expect(loadDailyCareSnapshot({ ...context, branchId: "" }, "2026-09-15")).rejects.toBeInstanceOf(CoreCareSnapshotError);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects mismatched source date rather than showing an empty day", async () => {
  await expect(loadDailyCareSnapshot(context, "2026-09-16")).rejects.toBeInstanceOf(CoreCareSnapshotError);
});
it("bounds a non-cooperative source instead of indefinitely waiting or returning an empty day", async () => {
  vi.useFakeTimers(); mocks.single.mockReturnValue(new Promise(() => {}));
  const result = loadDailyCareSnapshot(context, "2026-09-15");
  const assertion = expect(result).rejects.toBeInstanceOf(CoreCareSnapshotError);
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
  await assertion;
  expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not start the source after late client creation has already timed out", async () => {
  vi.useFakeTimers(); let resolve!: (value: unknown) => void;
  mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
  const assertion = expect(loadDailyCareSnapshot(context, "2026-09-15")).rejects.toBeInstanceOf(CoreCareSnapshotError);
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
  resolve({ rpc: mocks.rpc }); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
