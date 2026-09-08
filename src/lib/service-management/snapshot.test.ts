import { describe, expect, it } from "vitest";

import {
  buildDemoClaimReadSnapshot,
  buildDemoServiceUsageSnapshot,
} from "./demo";

describe("service management read projections", () => {
  it("keeps signed completion and plan linkage as separate evidence", () => {
    const snapshot = buildDemoServiceUsageSnapshot("2026-09-01");
    expect(snapshot.clients).toHaveLength(4);
    expect(snapshot.clients.every((client) => client.status === "active")).toBe(true);
    const completed = snapshot.items.filter((item) => item.status === "completed");
    expect(completed).toHaveLength(2);
    expect(completed.every((item) => item.hasEffectivePlanLink)).toBe(true);
    expect(completed.every((item) => item.signedAt)).toBe(true);
    expect(snapshot.items.some((item) => item.status === "planned" && !item.hasEffectivePlanLink)).toBe(true);
  });

  it("does not include service evidence contents in list DTOs", () => {
    const item = buildDemoServiceUsageSnapshot("2026-09-01").items[0]!;
    expect("evidence" in item).toBe(false);
    expect("contentHash" in item).toBe(false);
  });

  it("separates claim snapshot state from reconciliation state", () => {
    const batches = buildDemoClaimReadSnapshot().batches;
    expect(batches.find((batch) => batch.status === "draft")?.hasImmutableSnapshot).toBe(false);
    expect(batches.find((batch) => batch.status === "reconciled")?.hasImmutableSnapshot).toBe(true);
  });
});
