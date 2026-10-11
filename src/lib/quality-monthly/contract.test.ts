import { describe, expect, it } from "vitest";
import { qualityMonthlyCsv, qualityMonthlySnapshotSchema, type QualityMonthlySnapshot } from "./contract";

export function qualityFixture(): QualityMonthlySnapshot {
  const attendance = { id: "d1800000-0000-4000-8000-000000000001", clientId: "d1600000-0000-4000-8000-000000000001", date: "2026-10-01", source: "attendance" as const };
  return { schemaVersion: 1, organizationId: "d1300000-0000-4000-8000-000000000001", branchId: "d1400000-0000-4000-8000-000000000001",
    month: "2026-10", ruleVersion: "organization.quality-monthly-v1", officialIndicator: false, generatedAt: "2026-10-11T08:00:00Z", hash: "a".repeat(64),
    snapshotId: "d1900000-0000-4000-8000-000000000001", excludedVoidedWeights: 1,
    metrics: ["falls", "infections", "abnormal", "weight_coverage"].map((key) => ({ key: key as QualityMonthlySnapshot["metrics"][number]["key"], numerator: 0, denominator: 1, rate: "0.000000", numeratorItems: [], denominatorItems: [attendance] })),
  };
}
describe("Immutable quality monthly contract", () => {
  it("retains exact source identities and represents zero denominator as unknown", () => {
    const snapshot = qualityFixture();
    snapshot.metrics[0] = { ...snapshot.metrics[0]!, denominator: 0, denominatorItems: [], rate: null };
    expect(qualityMonthlySnapshotSchema.safeParse(snapshot).success).toBe(true);
    snapshot.metrics[0].rate = "0.000000";
    expect(qualityMonthlySnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it.each(["count", "rate", "month", "duplicate", "official"])("rejects %s mismatch", (kind) => {
    const snapshot = qualityFixture();
    if (kind === "count") snapshot.metrics[0]!.numerator = 1;
    if (kind === "rate") snapshot.metrics[0]!.rate = "1.000000";
    if (kind === "month") snapshot.metrics[0]!.denominatorItems[0]!.date = "2026-09-30";
    if (kind === "duplicate") snapshot.metrics[1]!.key = "falls";
    if (kind === "official") (snapshot as unknown as { officialIndicator: boolean }).officialIndicator = true;
    expect(qualityMonthlySnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it("CSV uses the same frozen totals, rule, hash and source IDs", () => {
    const snapshot = qualityFixture();
    const csv = qualityMonthlyCsv(snapshot);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"跌倒事件","0","1","0.000000"');
    expect(csv).toContain(snapshot.hash);
    expect(csv).toContain(snapshot.metrics[0]!.denominatorItems[0]!.id);
    expect(csv).toContain("非官方品質指標");
    expect(csv).not.toContain("undefined");
  });
});
