import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ allowed: vi.fn(), synthetic: vi.fn(), db: vi.fn(), rpc: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isSyntheticReadMode: mocks.synthetic }));
vi.mock("./access", () => ({ canReadStoreOverview: mocks.allowed }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));

import { calendarMonthDays } from "./attendance-month";
import { loadAttendanceMonth } from "./attendance-month-snapshot";

const context: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成機構", branchName: "合成店",
  displayName: "合成執行長", roles: ["organization_manager"], scopes: [], assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
const query = { month: "2026-09" };
function source(change: Record<string, unknown> = {}) {
  return {
    organization_id: context.organizationId, branch_id: context.branchId, month: query.month,
    generated_at: new Date().toISOString(),
    days: calendarMonthDays(query.month).map((date, index) => ({ date, present: index < 2 ? 1 : 0, leave: 0, absent: 0 })),
    totals: { present: 2, leave: 0, absent: 0 }, distinct_present_clients: 1, ...change,
  };
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.allowed.mockResolvedValue(true); mocks.synthetic.mockReturnValue(false);
  mocks.db.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data: source(), error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("monthly attendance loader authorization and source boundaries", () => {
  it("denies before inspecting synthetic mode or requesting business data", async () => {
    mocks.allowed.mockResolvedValue(false);
    expect(await loadAttendanceMonth(context, query)).toBeNull();
    expect(mocks.allowed).toHaveBeenCalledExactlyOnceWith(context);
    expect(mocks.synthetic).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { month: "2026-13" }, { month: "2026-9" }, { month: "1999-12" }, { month: "2201-01" },
    { month: ["2026-09", "2026-10"] }, { month: "" },
    { month: "2026-09", organization_id: "foreign" }, { month: "2026-09", branch_id: "foreign" },
    { month: "2026-09", date: "2026-09-01" }, { month: "2026-09", entity_id: "other-store" },
  ])("rejects invalid or scope-bearing query without reading records: %j", async (input) => {
    expect(await loadAttendanceMonth(context, input)).toMatchObject({ invalid: true, source: { status: "unavailable" } });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses server synthetic mode only, with no database or external data requests", async () => {
    mocks.synthetic.mockReturnValue(true);
    const result = await loadAttendanceMonth(context, query);
    expect(result).toMatchObject({ demo: true, invalid: false, source: { status: "ready", data: { month: query.month } } });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not let a caller demo flag bypass production source reads", async () => {
    const result = await loadAttendanceMonth({ ...context, demo: true }, query);
    expect(result).toMatchObject({ demo: false, source: { status: "ready" } });
    expect(mocks.db).toHaveBeenCalledOnce();
  });

  it("calls only the scoped aggregate RPC, with a five-second abort signal", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const result = await loadAttendanceMonth(context, query);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_store_attendance_month", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_month: query.month,
    });
    expect(mocks.abort).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(result).toMatchObject({ source: { status: "ready", data: { totals: { present: 2, leave: 0, absent: 0 }, distinctPresentClients: 1 } } });
    for (const identifier of [context.organizationId, context.branchId, context.userId, context.displayName]) {
      expect(JSON.stringify(result)).not.toContain(identifier);
    }
  });

  it.each([
    { organization_id: context.branchId }, { branch_id: context.organizationId }, { month: "2026-10" },
    { generated_at: new Date(Date.now() - 120_000).toISOString() },
    { generated_at: new Date(Date.now() + 120_000).toISOString() },
    { totals: { present: 3, leave: 0, absent: 0 } }, { distinct_present_clients: 3 },
    { distinct_present_clients: 0 }, { client_names: ["private-source-name"] },
  ])("withholds mismatched, stale or private aggregate fields: %j", async (change) => {
    mocks.abort.mockResolvedValue({ data: source(change), error: null });
    const result = await loadAttendanceMonth(context, query);
    expect(result?.source).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private-source-name");
  });

  it("withholds truncated and duplicate dates or unexpected individual-row details", async () => {
    const examples = [
      { days: source().days.slice(1) },
      { days: source().days.map((day, index, days) => index === 1 ? days[0] : day) },
      { days: source().days.map((day, index) => index === 0 ? { ...day, client_id: "private-id" } : day) },
    ];
    for (const change of examples) {
      mocks.abort.mockResolvedValue({ data: source(change), error: null });
      expect((await loadAttendanceMonth(context, query))?.source).toEqual({ status: "unavailable" });
    }
  });

  it("preserves genuine zero while keeping errors and absent payloads unavailable", async () => {
    mocks.abort.mockResolvedValue({ data: source({ days: source().days.map((day) => ({ ...day, present: 0 })),
      totals: { present: 0, leave: 0, absent: 0 }, distinct_present_clients: 0 }), error: null });
    expect(await loadAttendanceMonth(context, query)).toMatchObject({ source: { status: "ready", data: { totals: { present: 0, leave: 0, absent: 0 }, distinctPresentClients: 0 } } });
    for (const response of [{ data: null, error: null }, { data: source(), error: { code: "42501", details: "private-error" } }]) {
      mocks.abort.mockResolvedValue(response);
      const result = await loadAttendanceMonth(context, query);
      expect(result?.source).toEqual({ status: "unavailable" }); expect(JSON.stringify(result)).not.toContain("private-error");
    }
  });

  it("returns unavailable for absent database configuration without attempting an RPC", async () => {
    mocks.db.mockResolvedValue(null);
    expect((await loadAttendanceMonth(context, query))?.source).toEqual({ status: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("suppresses raw connection and RPC exceptions", async () => {
    mocks.db.mockRejectedValue(new Error("private-database-endpoint"));
    expect((await loadAttendanceMonth(context, query))?.source).toEqual({ status: "unavailable" });
    mocks.db.mockResolvedValue({ rpc: mocks.rpc }); mocks.abort.mockRejectedValue(new Error("private-db-record"));
    expect((await loadAttendanceMonth(context, query))?.source).toEqual({ status: "unavailable" });
  });

  it("distinguishes a deadline abort from a normal unavailable source", async () => {
    const controller = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    mocks.abort.mockImplementation(async () => { controller.abort(); throw new Error("private-timeout-detail"); });
    expect((await loadAttendanceMonth(context, query))?.source).toEqual({ status: "timeout" });
  });
});
