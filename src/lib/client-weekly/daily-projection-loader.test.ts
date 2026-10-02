import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), single: vi.fn(), master: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/clients/master-snapshot", () => ({ loadClientMasterSnapshot: mocks.master }));
import { loadDailyExpectedClients } from "./daily-projection-loader";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";
const date = "2026-09-14";
const id = "b0000000-0000-4000-8000-000000000001";
const context: TenantContext = { organizationId: "c0000000-0000-4000-8000-000000000001", branchId: "d0000000-0000-4000-8000-000000000001", organizationName: "合成機構", branchName: "合成分支", userId: "a0000000-0000-4000-8000-000000000001", displayName: "合成使用者", roles: ["care_worker"], scopes: ["clients.read"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const payload = { organizationId: context.organizationId, branchId: context.branchId, serviceDate: date,
  generatedAt: `${date}T00:00:00Z`, evidenceKind: "planned_not_attended",
  clients: [{ clientId: id, startsAt: "09:00", endsAt: "16:00", outbound: false, inbound: false }],
  dispatch: { status: "forbidden" } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockReturnValue({ maybeSingle: mocks.single });
  mocks.single.mockResolvedValue({ data: { payload }, error: null }); mocks.master.mockResolvedValue({ clients: [{ id, displayName: "合成甲" }] });
});
afterEach(() => vi.useRealTimers());
describe("authorized daily projection loader", () => {
  it("uses the server tenant scope and only read RPCs", async () => {
    const result = await loadDailyExpectedClients(context, date);
    expect(result).toMatchObject({ status: "ready", expectedCount: 1, clients: [{ displayName: "合成甲" }] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("daily_transport_reconciliation", { p_organization_id: context.organizationId, p_branch_id: context.branchId, p_date: date });
    expect(mocks.master).toHaveBeenCalledWith(context, "view", { supabase: { rpc: mocks.rpc }, signal: mocks.abort.mock.calls[0][0] });
    expect(mocks.client).toHaveBeenCalledTimes(1);
  });
  it("does not connect for absent scope, demo or invalid dates", async () => {
    expect((await loadDailyExpectedClients({ ...context, scopes: [] }, date)).status).toBe("forbidden");
    expect((await loadDailyExpectedClients({ ...context, demo: true }, date)).status).toBe("demo");
    expect((await loadDailyExpectedClients(context, "2026-02-30")).status).toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves no-data uncertainty rather than reporting false zero", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "08006", message: "private debug details" } });
    const result = await loadDailyExpectedClients(context, date); expect(result).toEqual({ status: "unavailable", serviceDate: date });
    expect(JSON.stringify(result)).not.toContain("private debug");
  });
  it("reports access denied distinctly from empty success", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await loadDailyExpectedClients(context, date)).status).toBe("forbidden");
  });
  it("uses opaque fallback when the authorized name directory is unavailable", async () => {
    mocks.master.mockRejectedValue(new Error("not entitled"));
    expect(await loadDailyExpectedClients(context, date)).toMatchObject({ status: "ready", clients: [{ displayName: "個案（編號末 0001）" }] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed payload and transport data without disclosing content", async () => {
    mocks.single.mockResolvedValue({ data: { payload: { ...payload, clients: [] } }, error: null });
    expect(await loadDailyExpectedClients(context, date)).toMatchObject({ status: "ready", expectedCount: 0 });
    mocks.single.mockResolvedValue({ data: { payload: { arbitrary: "private source" } }, error: null });
    expect(await loadDailyExpectedClients(context, date)).toEqual({ status: "unavailable", serviceDate: date });
  });
  it("keeps transport denial separate from a successful weekly projection", async () => {
    expect(await loadDailyExpectedClients(context, date)).toMatchObject({ status: "ready", expectedCount: 1, dispatch: { status: "forbidden" } });
  });
  it("does not fall back to two independently timed RPCs after a missing combined deployment", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await loadDailyExpectedClients(context, date)).toEqual({ status: "unavailable", serviceDate: date });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["57014", "08006", "XX000"])("keeps %s unknown, with no false zero", async (code) => {
    mocks.single.mockResolvedValue({ data: null, error: { code } });
    expect(await loadDailyExpectedClients(context, date)).toEqual({ status: "unavailable", serviceDate: date });
  });
  it("suppresses thrown transport and foreign-scope responses", async () => {
    mocks.single.mockRejectedValueOnce(new Error("private transport details"));
    expect(await loadDailyExpectedClients(context, date)).toEqual({ status: "unavailable", serviceDate: date });
    mocks.single.mockResolvedValueOnce({ data: { payload: { ...payload, branchId: id } }, error: null });
    expect(await loadDailyExpectedClients(context, date)).toEqual({ status: "unavailable", serviceDate: date });
  });
  it("bounds a non-cooperative combined projection without reporting false zero", async () => {
    vi.useFakeTimers(); mocks.single.mockReturnValue(new Promise(() => {}));
    const result = loadDailyExpectedClients(context, date);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect(await result).toEqual({ status: "unavailable", serviceDate: date });
    expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.master).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a non-cooperative name source using the same owner and signal", async () => {
    vi.useFakeTimers(); mocks.master.mockReturnValue(new Promise(() => {}));
    const result = loadDailyExpectedClients(context, date);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS - 1);
    const signal = mocks.abort.mock.calls[0][0];
    expect(signal.aborted).toBe(false);
    expect(mocks.master).toHaveBeenCalledWith(context, "view", { supabase: { rpc: mocks.rpc }, signal });
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: "unavailable", serviceDate: date });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores a late combined projection and never starts another read", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.single.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadDailyExpectedClients(context, date);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect(await result).toEqual({ status: "unavailable", serviceDate: date });
    resolve({ data: { payload }, error: null }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.master).toHaveBeenCalledTimes(1);
  });
  it("ignores late names without exposing them or retrying", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.master.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadDailyExpectedClients(context, date);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect(await result).toEqual({ status: "unavailable", serviceDate: date });
    resolve({ clients: [{ id, displayName: "late private identity" }] }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.master).toHaveBeenCalledTimes(1);
  });
  it("does not begin projection or identity reads after late client creation", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.client.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadDailyExpectedClients(context, date);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect(await result).toEqual({ status: "unavailable", serviceDate: date });
    resolve({ rpc: mocks.rpc }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.master).not.toHaveBeenCalled();
  });
  it("includes client initialization in the shared original budget", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.client.mockReturnValue(new Promise((done) => { resolve = done; }));
    mocks.single.mockReturnValue(new Promise(() => {}));
    const result = loadDailyExpectedClients(context, date);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS - 1);
    resolve({ rpc: mocks.rpc }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: "unavailable", serviceDate: date });
    expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
  });
});
