import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { DailyExpectedState } from "@/lib/client-weekly/daily-projection";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/client-weekly/daily-projection-loader", () => ({ loadDailyExpectedClients: mocks.load }));
import { DailyExpectedClients } from "./daily-expected-clients";

const date = "2026-09-28";
const actor = { scopes: ["clients.read", "clients.demographics.read", "transport_plans.read"], demo: false } as TenantContext;
const state: DailyExpectedState = { status: "unavailable", serviceDate: date };
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(state); });

describe("daily expected server promise consumption (unit proof, not Next streaming proof)", () => {
  it("preserves existing direct callers and transport mode", async () => {
    const panel = await DailyExpectedClients({ context: actor, serviceDate: date, mode: "transport" });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(actor, date);
    expect(panel.props).toMatchObject({ state, mode: "transport", canOpenIntake: true, canOpenTransport: true });
    expect(panel.key).toBe("unavailable");
  });
  it("awaits the already-started server promise without a duplicate loader call", async () => {
    let resolve!: (value: DailyExpectedState) => void;
    const statePromise = new Promise<DailyExpectedState>((done) => { resolve = done; });
    let completed = false;
    const panel = DailyExpectedClients({ context: actor, serviceDate: date, statePromise }).then((element) => { completed = true; return element; });
    await Promise.resolve();
    expect(completed).toBe(false); expect(mocks.load).not.toHaveBeenCalled();
    resolve(state);
    expect((await panel).props).toMatchObject({ state, mode: "all", canOpenIntake: true, canOpenTransport: true });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each(["forbidden", "demo", "unavailable"] as const)("keeps the exact %s result and scoped links", async (status) => {
    const projection: DailyExpectedState = { status, serviceDate: date };
    const panel = await DailyExpectedClients({ context: { ...actor, scopes: ["clients.read"] }, serviceDate: date,
      statePromise: Promise.resolve(projection) });
    expect(panel.props).toMatchObject({ state: projection, canOpenIntake: false, canOpenTransport: false });
    expect(panel.key).toBe(status); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("preserves the original rejection without silently retrying another source", async () => {
    const error = new Error("SYNTHETIC_PROGRAMMER_FAILURE");
    await expect(DailyExpectedClients({ context: actor, serviceDate: date, statePromise: Promise.reject(error) })).rejects.toBe(error);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
