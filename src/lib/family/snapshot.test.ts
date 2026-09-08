import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { familySnapshotInternals } from "./snapshot";

const clientRow = {
  client_id: "84000000-0000-4000-8000-000000000001",
  branch_id: "84100000-0000-4000-8000-000000000001",
  display_name: "合成個案",
  client_status: "active",
  admitted_on: "2026-09-01",
  updated_at: "2026-09-08T01:23:45+00:00",
};

const careRow = {
  record_id: "84200000-0000-4000-8000-000000000001",
  category: "family_visible_summary",
  occurred_at: "2026-09-08T01:00:00+00:00",
  effective_from: null,
  effective_to: null,
  signed_at: "2026-09-08T01:05:00+00:00",
  updated_at: "2026-09-08T01:05:00+00:00",
};

describe("family snapshot live boundary", () => {
  it("accepts only the exact client-summary wire shape", () => {
    expect(familySnapshotInternals.parseClientSummaryRows([clientRow])).toEqual([
      { ...clientRow, updated_at: "2026-09-08T01:23:45.000Z" },
    ]);
  });

  it("rejects unknown client fields instead of silently accepting a widened RPC", () => {
    expect(() => familySnapshotInternals.parseClientSummaryRows([
      { ...clientRow, national_id_ciphertext: "synthetic-never-render" },
    ])).toThrowError("FAMILY_CLIENT_SUMMARY_INVALID");
  });

  it("rejects malformed, duplicate, or oversized client projections", () => {
    expect(() => familySnapshotInternals.parseClientSummaryRows([
      { ...clientRow, branch_id: "not-a-uuid" },
    ])).toThrowError("FAMILY_CLIENT_SUMMARY_INVALID");
    expect(() => familySnapshotInternals.parseClientSummaryRows([
      clientRow,
      clientRow,
    ])).toThrowError("FAMILY_CLIENT_SUMMARY_INVALID");
    expect(() => familySnapshotInternals.parseClientSummaryRows(
      Array.from({ length: 501 }, (_, index) => ({
        ...clientRow,
        client_id: `84000000-0000-4000-8${String(index).padStart(3, "0")}-000000000001`,
      })),
    )).toThrowError("FAMILY_CLIENT_SUMMARY_INVALID");
    expect(() => familySnapshotInternals.parseClientSummaryRows([
      { ...clientRow, updated_at: "2026-02-30T01:23:45+00:00" },
    ])).toThrowError("FAMILY_CLIENT_SUMMARY_INVALID");
    expect(() => familySnapshotInternals.parseClientSummaryRows([
      { ...clientRow, admitted_on: "2026-02-30" },
    ])).toThrowError("FAMILY_CLIENT_SUMMARY_INVALID");
  });

  it("accepts the exact care metadata wire shape but rejects unknown payload fields", () => {
    expect(familySnapshotInternals.parseCareSummaryRows([careRow])).toEqual([{
      ...careRow,
      occurred_at: "2026-09-08T01:00:00.000Z",
      signed_at: "2026-09-08T01:05:00.000Z",
      updated_at: "2026-09-08T01:05:00.000Z",
    }]);
    expect(() => familySnapshotInternals.parseCareSummaryRows([
      { ...careRow, data: { private_note: "synthetic-never-render" } },
    ])).toThrowError("FAMILY_CARE_SUMMARY_INVALID");
  });
});
