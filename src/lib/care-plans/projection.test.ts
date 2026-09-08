import { describe, expect, it } from "vitest";

import { buildDemoCarePlanSnapshot } from "./demo";
import { filterCarePlanSnapshot, isPlanEffective } from "./projection";

describe("care plan read projection", () => {
  it("only treats signed versions inside their inclusive period as effective", () => {
    expect(isPlanEffective({ status: "signed", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }, "2026-01-01")).toBe(true);
    expect(isPlanEffective({ status: "approved", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }, "2026-09-01")).toBe(false);
    expect(isPlanEffective({ status: "signed", effectiveFrom: "2026-01-01", effectiveTo: "2026-08-31" }, "2026-09-01")).toBe(false);
    expect(isPlanEffective({ status: "voided", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }, "2026-09-01")).toBe(false);
  });

  it("filters by stable client code and plan status without mutating the snapshot", () => {
    const snapshot = buildDemoCarePlanSnapshot();
    const plans = filterCarePlanSnapshot(snapshot, {
      kind: "authorized",
      query: "HX-023",
      status: "signed",
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ clientCode: "HX-023", version: 2 });
    expect(snapshot.authorizedPlans).toHaveLength(4);
  });

  it("keeps source contents and authorization references out of list DTOs", () => {
    const snapshot = buildDemoCarePlanSnapshot();
    expect(snapshot.authorizedPlans.every((plan) => !("planData" in plan))).toBe(true);
    expect(snapshot.authorizedPlans.every((plan) => !("authorizationReference" in plan))).toBe(true);
    expect(snapshot.servicePlans.every((plan) => !("goals" in plan))).toBe(true);
  });
});

