import { describe, expect, it, vi } from "vitest";
import type { StoreOverview } from "@/lib/store-overview/types";
import { financeRefreshTimestamp, formatStoreTimestamp, freshFinanceAfterRefresh, storeRefreshIdentity } from "./store-overview-refresh";

const now = Date.parse("2026-09-26T09:00:00Z");
const overview: StoreOverview = {
  organizationName: "合成機構", branchName: "合成分支", invalid: false, demo: false,
  periods: { date: "2026-09-26", month: "2026-09" }, attendance: { status: "unavailable" },
  finance: { status: "ready", data: { income: "10.00", expenses: "5.00", entryCount: 2,
    generatedAt: new Date(now).toISOString() } },
};
const at = (timestamp: string): StoreOverview => ({ ...overview,
  finance: { status: "ready", data: { ...(overview.finance.status === "ready" ? overview.finance.data : {}),
    income: "10.00", expenses: "5.00", entryCount: 2, generatedAt: timestamp } } });

describe("Finance refresh confirmation, not a router acknowledgement", () => {
  it("joins canonical Taipei parts rather than environment-dependent ICU literals", () => {
    const native = Intl.DateTimeFormat.prototype.formatToParts;
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function(this: Intl.DateTimeFormat, date) {
      return native.call(this, date).map((part) => part.type === "literal"
        ? { ...part, value: "\u2009SSR-only-spacing" } : part);
    });
    try {
      expect(formatStoreTimestamp("2026-09-26T09:00:01Z")).toBe("09/26 17:00:01");
      expect(formatStoreTimestamp("2026-09-26T16:00:00Z")).toBe("09/27 00:00:00");
      expect(formatStoreTimestamp("invalid")).toBe("時間尚未確認");
    } finally { format.mockRestore(); }
  });
  it("requires a strictly newer, fresh timestamp in the same displayed scope", () => {
    expect(freshFinanceAfterRefresh(overview, storeRefreshIdentity(overview), now - 1, now)).toBe(true);
    expect(freshFinanceAfterRefresh(overview, storeRefreshIdentity(overview), now, now)).toBe(false);
    expect(freshFinanceAfterRefresh(overview, storeRefreshIdentity(overview), now + 1, now)).toBe(false);
    expect(freshFinanceAfterRefresh({ ...overview, branchName: "另一分支" }, storeRefreshIdentity(overview), now - 1, now)).toBe(false);
    expect(freshFinanceAfterRefresh({ ...overview, periods: { ...overview.periods, month: "2026-08" } }, storeRefreshIdentity(overview), now - 1, now)).toBe(false);
  });
  it.each(["", "invalid", "2026-09-26", "2026-09-26T09:00:00", "Infinity"])("rejects malformed timestamp %s", (value) => {
    expect(financeRefreshTimestamp(at(value), now)).toBeNull();
  });
  it("does not accept stale or excessively future timestamps", () => {
    expect(financeRefreshTimestamp(at(new Date(now - 60_001).toISOString()), now)).toBeNull();
    expect(financeRefreshTimestamp(at(new Date(now + 30_001).toISOString()), now)).toBeNull();
    expect(financeRefreshTimestamp(at(new Date(now - 60_000).toISOString()), now)).toBe(now - 60_000);
  });
  it.each(["not_connected", "unavailable", "timeout"] as const)("keeps %s distinct from actual zero", (status) => {
    expect(financeRefreshTimestamp({ ...overview, finance: { status } }, now)).toBeNull();
  });
  it("never treats invalid queries or synthetic mode as real Finance freshness", () => {
    expect(financeRefreshTimestamp({ ...overview, invalid: true }, now)).toBeNull();
    expect(financeRefreshTimestamp({ ...overview, demo: true }, now)).toBeNull();
  });
});
