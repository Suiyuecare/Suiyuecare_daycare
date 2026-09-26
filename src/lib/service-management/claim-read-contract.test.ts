import { describe, expect, it } from "vitest";
import { parseClaimReadRows } from "./claim-read-contract";

const valid = {
  id: "ABCDEFAB-1234-4567-8901-ABCDEFABCDEF", claim_period_start: "2026-09-01", claim_period_end: "2026-09-30",
  format_version: "fixture-v1", status: "draft", item_count: 3, total_amount: "1200.10",
  responded_item_count: 2, rejected_item_count: 1, legacy_response_unknown: false,
  has_immutable_snapshot: false, exported_at: null, submitted_at: null, reconciled_at: null,
  updated_at: "2026-09-26T10:10:10.123456+08:00",
};
describe("bounded claim read contract", () => {
  it("normalizes exact money, UUID and PostgREST bigint text without exposing source fields", () => {
    const [value] = parseClaimReadRows([{ ...valid, item_count: "3", total_amount: 1200.1 }]);
    expect(value).toMatchObject({ id: valid.id.toLowerCase(), itemCount: 3, totalAmount: "1200.10" });
    expect(value).not.toHaveProperty("claim_period_start");
  });
  it.each(["999999999999.99", "0", "0.05", "12.30"])("preserves valid read-only amount %s", (total_amount) => {
    const [value] = parseClaimReadRows([{ ...valid, total_amount }]);
    expect(value.totalAmount).toBe(total_amount === "0" ? "0.00" : total_amount);
  });
  it("accepts a real empty list, not null or an absent successful RPC response", () => {
    expect(parseClaimReadRows([])).toEqual([]);
    for (const value of [null, undefined, {}, "[]"]) expect(() => parseClaimReadRows(value)).toThrow();
  });
  it.each([121, 4096])("preserves a database-valid legacy version of %i characters without truncation", (length) => {
    const format_version = "v".repeat(length);
    const values = parseClaimReadRows([valid, { ...valid,
      id: "a0000000-0000-4000-8000-000000000002", format_version }]);
    expect(values).toHaveLength(2);
    expect(values[1].formatVersion).toBe(format_version);
  });
  it.each([
    { total_amount: "NaN" }, { total_amount: Infinity }, { total_amount: "1.001" }, { total_amount: "-1.25" },
    { total_amount: "1000000000000.00" }, { total_amount: null }, { item_count: -1 },
    { item_count: 1.5 }, { item_count: "9007199254740992" }, { item_count: "03" },
    { responded_item_count: 4 }, { rejected_item_count: 3 }, { status: "unknown" },
    { claim_period_start: "2026-09-31" }, { claim_period_end: "2026-08-31" },
    { updated_at: "yesterday" }, { exported_at: "2026-09-26" },
    { format_version: " " }, { format_version: "v1\n" }, { id: "client-name" },
    { legacy_response_unknown: "false" }, { has_immutable_snapshot: null }, { extra: "not part of contract" },
  ])("rejects malformed or contradictory row %j", (patch) => {
    expect(() => parseClaimReadRows([{ ...valid, ...patch }])).toThrow();
  });
  it("rejects duplicate canonical IDs and over-limit lists rather than silently truncating", () => {
    expect(() => parseClaimReadRows([valid, { ...valid, id: valid.id.toLowerCase() }])).toThrow();
    expect(() => parseClaimReadRows(Array.from({ length: 201 }, (_, index) => ({ ...valid,
      id: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}` })))).toThrow();
  });
});
