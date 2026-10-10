import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareApprovedJuboPair, JuboPairPreparationError } from "./trusted-pair-preparation";
import { APPROVED_JUBO_SOURCE_SHA256 } from "./xlsx-reader";

const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";
const ACTOR = "30000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-000000000001";
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sourceDir = process.env.JUBO_APPROVED_SOURCE_DIR;

/** No real patient values or source file contents are ever printed by this test. */
const realSources = sourceDir ? it : it.skip;

describe("approved JUBO source-pair preparation", () => {
  it("rejects untrusted scope or kind before parsing", () => {
    const badFile = { kind: "master" as const, fileName: "synthetic.xlsx", mimeType: MIME, bytes: new Uint8Array([1, 2, 3]) };
    const input = { organizationId: ORG, branchId: BRANCH, actorUserId: ACTOR,
      idempotencyKey: KEY, hmacSecret: "synthetic test-only secret longer than 32 bytes",
      master: badFile, monthlySummary: { ...badFile, kind: "monthlySummary" as const } };
    expect(() => prepareApprovedJuboPair({ ...input, organizationId: "not-a-uuid" }))
      .toThrowError(JuboPairPreparationError);
    expect(() => prepareApprovedJuboPair({ ...input, master: { ...badFile, kind: "monthlySummary" } }))
      .toThrowError(JuboPairPreparationError);
  });

  realSources("binds exact approved bytes to 23 distinct master records, one source footer and 17 reconciled monthly rows", () => {
    const masterBytes = Uint8Array.from(readFileSync(path.join(sourceDir!, "jubo-all-status-client-master-20261003.xlsx")));
    const monthlyBytes = Uint8Array.from(readFileSync(path.join(sourceDir!, "jubo-daycare-summary-20261003.xlsx")));
    const input = { organizationId: ORG, branchId: BRANCH, actorUserId: ACTOR,
      idempotencyKey: KEY, hmacSecret: "synthetic test-only secret longer than 32 bytes",
      master: { kind: "master" as const, fileName: "jubo-all-status-client-master-20261003.xlsx", mimeType: MIME, bytes: masterBytes },
      monthlySummary: { kind: "monthlySummary" as const, fileName: "jubo-daycare-summary-20261003.xlsx", mimeType: MIME, bytes: monthlyBytes } };
    const prepared = prepareApprovedJuboPair(input);
    masterBytes.fill(0);
    monthlyBytes.fill(0);
    expect(prepared.master.sha256).toBe(APPROVED_JUBO_SOURCE_SHA256.master);
    expect(prepared.monthlySummary.sha256).toBe(APPROVED_JUBO_SOURCE_SHA256.monthlySummary);
    expect(createHash("sha256").update(Buffer.from(prepared.master.sourceBytesHex, "hex")).digest("hex"))
      .toBe(APPROVED_JUBO_SOURCE_SHA256.master);
    expect(createHash("sha256").update(Buffer.from(prepared.monthlySummary.sourceBytesHex, "hex")).digest("hex"))
      .toBe(APPROVED_JUBO_SOURCE_SHA256.monthlySummary);
    expect(prepared.plan.masterRowCount).toBe(23);
    expect(prepared.plan.monthlySummaryRowCount).toBe(17);
    expect(prepared.plan.matchedSummaryRowCount).toBe(17);
    expect(prepared.master.rows).toHaveLength(23);
    expect(prepared.monthlySummary.rows).toHaveLength(17);
    expect(prepared.masterNonRecordRows).toHaveLength(1);
    expect(prepared.master.rows.map((row) => row.sheetRow)).toEqual(Array.from({ length: 23 }, (_, index) => index + 6));
    expect(prepared.monthlySummary.rows.map((row) => row.sheetRow)).toEqual(Array.from({ length: 17 }, (_, index) => index + 5));
    expect(prepared.master.rows.every((row) => row.rawValues.length === 95 && row.rawCellTypes.length === 95)).toBe(true);
    expect(prepared.monthlySummary.rows.every((row) => row.rawValues.length === 191 && row.rawCellTypes.length === 191)).toBe(true);
    expect(prepared.formallyImported).toBe(false);
    expect(prepared.plan.clients.filter((client) => client.serviceStatus === "active")).toHaveLength(17);
    expect(prepared.plan.clients.filter((client) => client.serviceStatus === "suspended")).toHaveLength(1);
    expect(prepared.plan.clients.filter((client) => client.serviceStatus === "closed")).toHaveLength(5);
    expect(prepared.plan.clients.every((client) => client.dates.admittedOn === null)).toBe(true);

    const originalRawCell = prepared.master.rows[0].rawValues[0];
    const originalHeader = prepared.master.columnLabels[0];
    const originalFooterCell = prepared.masterNonRecordRows[0].rawValues[0];
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.master.rows[0].rawValues)).toBe(true);
    expect(Object.isFrozen(prepared.master.columnLabels)).toBe(true);
    expect(Object.isFrozen(prepared.masterNonRecordRows[0].rawValues)).toBe(true);
    expect(Object.isFrozen(prepared.plan.clients[0].master.columns[0])).toBe(true);
    expect(Reflect.set(prepared.master.rows[0].rawValues, "0", "synthetic-tamper")).toBe(false);
    expect(Reflect.set(prepared.master.columnLabels, "0", "synthetic-tamper")).toBe(false);
    expect(Reflect.set(prepared.masterNonRecordRows[0].rawValues, "0", "synthetic-tamper")).toBe(false);
    expect(prepared.master.rows[0].rawValues[0]).toBe(originalRawCell);
    expect(prepared.master.columnLabels[0]).toBe(originalHeader);
    expect(prepared.masterNonRecordRows[0].rawValues[0]).toBe(originalFooterCell);

    expect(prepared.requestSha256).toBe(createHash("sha256").update(JSON.stringify([
      prepared.parserVersion, ORG, BRANCH, ACTOR, KEY,
      APPROVED_JUBO_SOURCE_SHA256.master, APPROVED_JUBO_SOURCE_SHA256.monthlySummary,
    ])).digest("hex"));
  }, 120_000);
});
