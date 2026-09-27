import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { CaseCenterFilters } from "./types";
const mocks = vi.hoisted(() => ({ create: vi.fn(), directory: vi.fn(), from: vi.fn(), result: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
vi.mock("@/lib/clients/directory", () => ({ loadAllClientDirectoryRows: mocks.directory }));
import { loadCaseCenterSnapshot, CaseCenterRegistryError } from "./registry";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";
const context = { organizationId: "d7300000-0000-4000-8000-000000000001", branchId: "d7400000-0000-4000-8000-000000000001",
  userId: "11111111-1111-4111-8111-111111111111", displayName: "合成人員", demo: false, scopes: ["clients.read"] } as TenantContext;
const filters: CaseCenterFilters = { date: "2026-09-28", query: "", lifecycle: "all", service: "all", responsible: "all", page: 1 };
let query: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  query = Object.fromEntries(["select", "eq", "lte", "order", "range", "in"].map((method) => [method, vi.fn(() => query)]));
  query.abortSignal = mocks.abort.mockImplementation(() => query);
  query.returns = mocks.result.mockResolvedValue({ data: [], error: null, count: 0 });
  mocks.from.mockReturnValue(query); mocks.create.mockResolvedValue({ from: mocks.from }); mocks.directory.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

it("keeps authorized empty data distinct from source failure and propagates one shared read signal", async () => {
  const result = await loadCaseCenterSnapshot(context, filters);
  expect(result).toBeDefined();
  expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), context, "case_center", undefined, expect.any(AbortSignal));
  expect(mocks.abort.mock.calls[0][0]).toBe(mocks.directory.mock.calls[0][4]);
});
it("rejects unavailable directory reads without filling synthetic cases", async () => {
  mocks.directory.mockRejectedValue(new Error("unavailable"));
  await expect(loadCaseCenterSnapshot(context, filters)).rejects.toBeInstanceOf(CaseCenterRegistryError);
});
it("does not read providers without client access", async () => {
  await expect(loadCaseCenterSnapshot({ ...context, scopes: [] }, filters)).rejects.toBeInstanceOf(CaseCenterRegistryError);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("bounds the complete non-cooperative case-center attempt", async () => {
  vi.useFakeTimers(); mocks.directory.mockReturnValue(new Promise(() => {}));
  const assertion = expect(loadCaseCenterSnapshot(context, filters)).rejects.toBeInstanceOf(CaseCenterRegistryError);
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
  expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
  expect(mocks.directory).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("does not start reads after client creation resolves beyond the deadline", async () => {
  vi.useFakeTimers(); let resolve!: (value: unknown) => void;
  mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
  const assertion = expect(loadCaseCenterSnapshot(context, filters)).rejects.toBeInstanceOf(CaseCenterRegistryError);
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
  resolve({ from: mocks.from }); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.directory).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
});
it("does not start more assignment pages after a late first-page result", async () => {
  vi.useFakeTimers(); let resolve!: (value: unknown) => void;
  mocks.result.mockReturnValue(new Promise((done) => { resolve = done; }));
  const assertion = expect(loadCaseCenterSnapshot(context, filters)).rejects.toBeInstanceOf(CaseCenterRegistryError);
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
  resolve({ data: [], error: null, count: 2000 }); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.result).toHaveBeenCalledTimes(1); expect(mocks.from).toHaveBeenCalledTimes(1);
});
