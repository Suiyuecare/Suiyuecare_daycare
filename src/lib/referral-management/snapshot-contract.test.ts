import { describe, expect, it } from "vitest";
import { buildDemoReferralManagementSnapshot } from "./demo";
import { normalizeReferralSnapshot } from "./snapshot-contract";

const scope = { organizationId: "39000000-0000-4000-8000-000000abcdef", branchId: "39000000-0000-4000-8000-000000fedcba" };
function snapshot() {
  return buildDemoReferralManagementSnapshot({ ...scope, filters: { clientId: null, receivingUnitMode: "all",
    receivingUnitCode: null, status: "all", recentFrom: null, recentTo: null, query: "" } });
}
function objectAt(value: ReturnType<typeof snapshot>, kind: string): Record<string, unknown> {
  const item = value.items[0]!;
  return (kind === "top" ? value : kind === "metrics" ? value.metrics : kind === "item" ? item
    : kind === "history" ? item.history[0] : kind === "notification" ? item.notification
      : kind === "client" ? value.clientOptions[0] : value.receivingUnitOptions[0]) as unknown as Record<string, unknown>;
}
describe("pure exact projected referral snapshot contract", () => {
  it("preserves the current complete projection without mutation or side effects", () => {
    const input = snapshot(); const before = structuredClone(input);
    expect(normalizeReferralSnapshot(input, scope)).toEqual(input);
    expect(input).toEqual(before);
  });
  it("normalizes UUIDs/offset timestamps but never invents authority or recency", () => {
    const value = snapshot(); value.organizationId = value.organizationId.toUpperCase(); value.branchId = value.branchId.toUpperCase();
    const generated = new Date(value.generatedAt); const expires = new Date(value.staleAfter);
    value.generatedAt = generated.toISOString().replace("Z", "+00:00"); value.staleAfter = expires.toISOString().replace("Z", "+00:00");
    const result = normalizeReferralSnapshot(value, { organizationId: scope.organizationId.toUpperCase(), branchId: scope.branchId.toUpperCase() });
    expect(result.organizationId).toBe(scope.organizationId); expect(result.branchId).toBe(scope.branchId);
    expect(result.generatedAt).toBe(generated.toISOString()); expect(result.staleAfter).toBe(expires.toISOString());
    expect(result.demo).toBe(true); expect(result.canCreate).toBe(false);
  });
  it.each(["top", "metrics", "item", "history", "notification", "client", "unit"])("rejects unexpected %s fields before re-encoding", (kind) => {
    const value = snapshot(); objectAt(value, kind).unexpected = "must not disappear";
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
  });
  it.each(["top", "metrics", "item", "history", "notification", "client", "unit"])("rejects missing %s fields rather than filling defaults", (kind) => {
    const value = snapshot(); const target = objectAt(value, kind); delete target[Object.keys(target)[0]!];
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
  });
  it.each([null, "HTML response", [], {}, 42])("rejects malformed root %j", (value) => {
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow();
  });
  it.each(["organizationId", "branchId"] as const)("rejects foreign %s even if the source is structurally valid", (field) => {
    const value = snapshot(); value[field] = "39000000-0000-4000-8000-000000000999";
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow();
  });
  it.each(["metrics", "history", "unit", "state", "flag", "demo"])("retains existing domain rejection of malformed %s", (kind) => {
    const value = snapshot();
    if (kind === "metrics") value.metrics.matching += 1;
    else if (kind === "history") value.items[0]!.history[0]!.sequence += 1;
    else if (kind === "unit") value.items[0]!.receivingUnitName = "unexpected missing-unit name";
    else if (kind === "state") Object.assign(value.items[0]!, { status: "not_a_state" });
    else if (kind === "flag") Object.assign(value, { canCreate: "true" });
    else Object.assign(value, { demo: "false" });
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow();
  });
  it.each(["invalid", "2026-13-26T00:00:00Z", "2026-09-26T00:00:00", "2026-09-26T24:00:00Z"])("rejects non-finite/invalid offset timestamp %s", (time) => {
    const value = snapshot(); value.generatedAt = time; value.staleAfter = time;
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow();
  });
  it("requires exact derived60s deadline rather than trusting an extended freshness window", () => {
    const value = snapshot(); value.staleAfter = new Date(Date.parse(value.generatedAt) + 120_000).toISOString();
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow("INVALID_REFERRAL_SNAPSHOT_FRESHNESS");
  });
  it.each(["items", "clientOptions", "receivingUnitOptions"] as const)("rejects oversized %s before traversing the projection", (field) => {
    const value = snapshot(); Object.assign(value, { [field]: Array.from({ length: field === "receivingUnitOptions" ? 101 : 201 }, () => null) });
    expect(() => normalizeReferralSnapshot(value, scope)).toThrow("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
  });
  it("does not infer absence or commit from a valid empty or truncated snapshot", () => {
    const value = snapshot(); const empty = { ...value, items: [], metrics: { matching: 0, draft: 0, submitted: 0,
      received: 0, responded: 0, closed: 0, unitMissing: 0, unitNotApplicable: 0 } };
    expect(normalizeReferralSnapshot(empty, scope).items).toHaveLength(0);
    const partial = { ...value, items: value.items.slice(0, 1), itemsTruncated: true };
    expect(normalizeReferralSnapshot(partial, scope).itemsTruncated).toBe(true);
  });
});
