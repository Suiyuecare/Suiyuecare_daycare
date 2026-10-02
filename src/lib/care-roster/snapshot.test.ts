import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), single: vi.fn(), directory: vi.fn(), abort: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
vi.mock("@/lib/clients/directory", () => ({ loadAllClientDirectoryRows: mocks.directory }));
import { loadCareRosterSnapshot } from "./snapshot";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";
const id = "a1111111-1111-4111-8111-111111111111";
const actor: TenantContext = { organizationId: id, branchId: id, userId: id, organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員", roles: ["care_worker"], scopes: ["clients.read"], demo: false, assuranceLevel: "aal2", recentAal2At: null };
const assignment = { id, clientId: id, staffUserId: id, staffName: "合成人員", serviceDate: "2026-09-12", shift: "morning", version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成計畫", tasks: [{ kind: "temperature", status: "recorded", evidenceAt: "2026-09-12T01:00:00+00:00" }] };
const payload = { manager: false, assignments: [assignment], staffOptions: [] };
const blockedPayload = { ...payload, manager: true, assignments: [{ ...assignment, isServiceEligible: false,
  serviceEligibility: "not_admitted", tasks: [] }] };
describe("roster snapshot fail closed projection", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.directory.mockResolvedValue([]); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockReturnValue({ maybeSingle: mocks.single }); mocks.single.mockResolvedValue({ data: { payload }, error: null }); });
  afterEach(() => vi.useRealTimers());
  it("returns only validated assigned roster", async () => { expect((await loadCareRosterSnapshot(actor, "2026-09-12")).status).toBe("ready"); });
  it.each([
    { ...payload, assignments: [{ ...assignment, serviceDate: "2026-09-13" }] },
    { ...payload, assignments: [assignment, assignment] },
    { ...payload, assignments: [{ ...assignment, staffUserId: "b1111111-1111-4111-8111-111111111111" }] },
    { ...payload, assignments: [{ ...assignment, tasks: [{ kind: "temperature", status: "recorded", evidenceAt: null }] }] },
    { ...payload, staffOptions: [{ userId: id, name: "不應可見" }] },
    { ...payload, assignments: [{ ...assignment, isServiceEligible: undefined }] },
    { ...payload, assignments: [{ ...assignment, serviceEligibility: undefined }] },
    { ...payload, assignments: [{ ...assignment, isServiceEligible: false }] },
    { ...payload, assignments: [{ ...assignment, serviceEligibility: "not_admitted" }] },
    { manager: true, assignments: [{ ...assignment, isServiceEligible: false, serviceEligibility: "not_admitted" }], staffOptions: [] },
    { ...payload, assignments: [{ ...assignment, isServiceEligible: false, serviceEligibility: "inactive", tasks: [{ kind: "temperature", status: "restricted", evidenceAt: null }] }] },
  ])("rejects wrong-scope or inconsistent payload", async (bad) => { mocks.single.mockResolvedValue({ data: { payload: bad }, error: null }); expect((await loadCareRosterSnapshot(actor, "2026-09-12")).status).toBe("unavailable"); });
  it("network failure is not a zero-work result", async () => { mocks.single.mockRejectedValue(new Error("network")); expect((await loadCareRosterSnapshot(actor, "2026-09-12")).status).toBe("unavailable"); });
  it.each(["not_admitted", "inactive"])("keeps manager-only %s allocation as scheduled without care evidence", async (serviceEligibility) => {
    mocks.single.mockResolvedValue({ data: { payload: { manager: true, assignments: [{ ...assignment, isServiceEligible: false, serviceEligibility,
      tasks: [{ kind: "temperature", status: "restricted", evidenceAt: null }] }], staffOptions: [] } }, error: null });
    const result = await loadCareRosterSnapshot(actor, "2026-09-12");
    expect(result.status).toBe("ready");
    expect(result.assignments[0]).toMatchObject({ state: "scheduled", isServiceEligible: false, serviceEligibility });
    expect(result.assignments[0].tasks).toEqual([{ kind: "temperature", status: "restricted", evidenceAt: null }]);
  });
  it("synthetic preview never calls live services", async () => { const data = await loadCareRosterSnapshot({ ...actor, demo: true }, "2026-09-12"); expect(data.demo).toBe(true); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("joins blocked identities only from the audited directory and exact client ID", async () => {
    mocks.single.mockResolvedValue({ data: { payload: { ...payload, manager: true, assignments: [{ ...assignment, isServiceEligible: false, serviceEligibility: "not_admitted",
      clientIdentity: { displayName: "不可信RPC姓名", clientCode: "WRONG" }, tasks: [] }] } }, error: null });
    mocks.directory.mockResolvedValue([{ id, display_name: "已授權合成個案", client_code: "SYN-001" },
      { id: "b1111111-1111-4111-8111-111111111111", display_name: "其他合成個案", client_code: "SYN-002" }]);
    const result = await loadCareRosterSnapshot(actor, "2026-09-12");
    expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), actor, "client_lifecycle", undefined, expect.any(AbortSignal));
    expect(result.assignments[0].clientIdentity).toEqual({ displayName: "已授權合成個案", clientCode: "SYN-001" });
    expect(JSON.stringify(result)).not.toContain("其他合成個案");
    mocks.directory.mockRejectedValue(new Error("no identity access"));
    expect((await loadCareRosterSnapshot(actor, "2026-09-12")).assignments[0].clientIdentity).toBeNull();
  });
  it("does not request manager identities for frontline or already eligible rows", async () => {
    await loadCareRosterSnapshot(actor, "2026-09-12");
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("does not create a provider without read scope and suppresses creation failures", async () => {
    expect((await loadCareRosterSnapshot({ ...actor, scopes: [] }, "2026-09-12")).status).toBe("unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.create.mockRejectedValue(new Error("private initialization details"));
    const result = await loadCareRosterSnapshot(actor, "2026-09-12");
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("bounds a non-cooperative roster read without reporting empty assignments", async () => {
    vi.useFakeTimers(); mocks.single.mockReturnValue(new Promise(() => {}));
    const result = loadCareRosterSnapshot(actor, "2026-09-12");
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect((await result).status).toBe("unavailable");
    expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not begin identity followups after a late roster reply", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.single.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadCareRosterSnapshot(actor, "2026-09-12");
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect((await result).status).toBe("unavailable");
    resolve({ data: { payload: blockedPayload }, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("shares the original remaining budget with a non-cooperative identity lookup", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.single.mockReturnValue(new Promise((done) => { resolve = done; }));
    mocks.directory.mockReturnValue(new Promise(() => {}));
    const result = loadCareRosterSnapshot(actor, "2026-09-12");
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS - 1);
    resolve({ data: { payload: blockedPayload }, error: null });
    await vi.advanceTimersByTimeAsync(0);
    const signal = mocks.abort.mock.calls[0][0];
    expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), actor, "client_lifecycle", undefined, signal);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe("unavailable");
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores late identity data and does not retry after the owner times out", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown[]) => void;
    mocks.single.mockResolvedValue({ data: { payload: blockedPayload }, error: null });
    mocks.directory.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadCareRosterSnapshot(actor, "2026-09-12");
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect((await result).status).toBe("unavailable");
    resolve([{ id, display_name: "late private name", client_code: "late" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.directory).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not start a roster source after late client initialization", async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = loadCareRosterSnapshot(actor, "2026-09-12");
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    expect((await result).status).toBe("unavailable");
    resolve({ rpc: mocks.rpc }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.directory).not.toHaveBeenCalled();
  });
});
