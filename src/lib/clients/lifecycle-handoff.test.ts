import { describe, expect, it } from "vitest";
import { buildDemoClientLifecycle } from "./demo";
import { filterClientLifecycleTransitions } from "./lifecycle";
const filters = { query: "", status: "all" as const, eventKind: "all" as const, effectiveOn: null };
describe("lifecycle stable client selection", () => {
  it("filters by UUID and keeps historical entries for only that case", () => {
    const snapshot = buildDemoClientLifecycle();
    const id = snapshot.transitions[0]!.clientId;
    const result = filterClientLifecycleTransitions(snapshot, { ...filters, clientId: id });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.clientId === id)).toBe(true);
    expect(result.length).toBeLessThan(snapshot.transitions.length);
  });
  it("never falls back to another client for invalid or missing selectors", () => {
    for (const clientId of ["invalid", "ffffffff-ffff-4fff-8fff-ffffffffffff"]) expect(filterClientLifecycleTransitions(buildDemoClientLifecycle(), { ...filters, clientId })).toEqual([]);
  });
});
