import "server-only";

import { createHash } from "node:crypto";

import { planJuboImport, type JuboImportPlan } from "./planner";
import {
  readApprovedJuboXlsx, type JuboXlsxInput, type JuboWorkbookKind,
} from "./xlsx-reader";

/** Preparation is deliberately not an approval, transaction, or client write. */
export const JUBO_PAIR_PARSER_VERSION = "jubo-xlsx-reader-202610-v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class JuboPairPreparationError extends Error {
  constructor(public readonly code: "INVALID_REQUEST" | "INVALID_SOURCE_SHAPE") {
    super(`Jubo pair preparation failed: ${code}`);
    this.name = "JuboPairPreparationError";
  }
}

export type JuboPreparedRow = {
  readonly sheetRow: number;
  readonly rawValues: readonly unknown[];
  readonly normalizedValues: readonly unknown[];
  readonly rawCellTypes: readonly (string | null)[];
};

export type JuboPreparedBatch = {
  readonly kind: JuboWorkbookKind;
  readonly fileName: string;
  readonly sheetName: string;
  readonly sha256: string;
  readonly byteLength: number;
  /** Exact bytes, encoded as an immutable string. Never log or send to a browser. */
  readonly sourceBytesHex: string;
  readonly columnLabels: readonly string[];
  readonly rows: readonly JuboPreparedRow[];
};

export type JuboPreparedPair = {
  readonly organizationId: string;
  readonly branchId: string;
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly parserVersion: typeof JUBO_PAIR_PARSER_VERSION;
  readonly master: JuboPreparedBatch;
  readonly monthlySummary: JuboPreparedBatch;
  readonly masterNonRecordRows: readonly JuboPreparedRow[];
  readonly plan: JuboImportPlan;
  /** No operational or pending registry rows have been written. */
  readonly formallyImported: false;
};

export type JuboPrepareInput = {
  readonly organizationId: string;
  readonly branchId: string;
  /** Must originate from a verified server session; DB must independently recheck. */
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  /** Server-managed secret, never request JSON or NEXT_PUBLIC configuration. */
  readonly hmacSecret: string | Uint8Array;
  readonly master: JuboXlsxInput;
  readonly monthlySummary: JuboXlsxInput;
};

function invalidRequest(): never { throw new JuboPairPreparationError("INVALID_REQUEST"); }
function invalidSource(): never { throw new JuboPairPreparationError("INVALID_SOURCE_SHAPE"); }

function ownFile(input: JuboXlsxInput, kind: JuboWorkbookKind): JuboXlsxInput {
  if (!input || input.kind !== kind || typeof input.fileName !== "string" ||
      typeof input.mimeType !== "string" || !(input.bytes instanceof Uint8Array)) invalidRequest();
  return { kind, fileName: input.fileName, mimeType: input.mimeType, bytes: Uint8Array.from(input.bytes) };
}

function preparedRows(sheet: ReturnType<typeof readApprovedJuboXlsx>["sheet"], firstRow: number): JuboPreparedRow[] {
  if (!sheet.rawRows || !sheet.rawCellTypes || sheet.rawRows.length !== sheet.rows.length ||
      sheet.rawCellTypes.length !== sheet.rows.length) invalidSource();
  return sheet.rows.map((normalizedValues, index) => {
    const rawValues = sheet.rawRows?.[index];
    const rawCellTypes = sheet.rawCellTypes?.[index];
    if (!rawValues || !rawCellTypes || rawValues.length !== sheet.headers.length ||
        rawCellTypes.length !== sheet.headers.length || normalizedValues.length !== sheet.headers.length) invalidSource();
    return { sheetRow: firstRow + index, rawValues, normalizedValues, rawCellTypes };
  });
}

/**
 * Own both buffers before parsing, then bind all staged row material to those
 * same allowlisted bytes. The caller must supply a real serializable database
 * transaction adapter and live actor verification before persisting anything.
 */
export function prepareApprovedJuboPair(input: JuboPrepareInput): JuboPreparedPair {
  if (!input || !UUID.test(input.organizationId) || !UUID.test(input.branchId) ||
      !UUID.test(input.actorUserId) || !UUID.test(input.idempotencyKey)) invalidRequest();
  const masterFile = ownFile(input.master, "master");
  const monthlyFile = ownFile(input.monthlySummary, "monthlySummary");
  const master = readApprovedJuboXlsx(masterFile);
  const monthly = readApprovedJuboXlsx(monthlyFile);
  const plan = planJuboImport({
    organizationId: input.organizationId, branchId: input.branchId,
    hmacSecret: input.hmacSecret, master: master.sheet, monthlySummary: monthly.sheet,
    expectedCounts: { master: 23, monthlySummary: 17 },
  });
  const masterRows = preparedRows(master.sheet, 6);
  const monthlyRows = preparedRows(monthly.sheet, 5);
  const footer = master.sheet.nonRecordRows ?? [];
  if (masterRows.length !== 23 || monthlyRows.length !== 17 ||
      footer.length !== 1 || plan.matchedSummaryRowCount !== 17 ||
      footer[0].sheetRow <= masterRows[masterRows.length - 1].sheetRow ||
      footer[0].rawValues.length !== 95 || footer[0].rawCellTypes.length !== 95 ||
      plan.clients.filter((client) => client.serviceStatus === "active").length !== 17 ||
      plan.clients.filter((client) => client.serviceStatus === "suspended").length !== 1 ||
      plan.clients.filter((client) => client.serviceStatus === "closed").length !== 5) invalidSource();

  const organizationId = input.organizationId.toLowerCase();
  const branchId = input.branchId.toLowerCase();
  const actorUserId = input.actorUserId.toLowerCase();
  const idempotencyKey = input.idempotencyKey.toLowerCase();
  const requestSha256 = createHash("sha256").update(JSON.stringify([
    JUBO_PAIR_PARSER_VERSION, organizationId, branchId, actorUserId,
    idempotencyKey, master.sha256, monthly.sha256,
  ]), "utf8").digest("hex");
  const batch = (kind: JuboWorkbookKind, file: JuboXlsxInput,
    result: ReturnType<typeof readApprovedJuboXlsx>, rows: JuboPreparedRow[]): JuboPreparedBatch => ({
    kind, fileName: file.fileName, sheetName: result.sheet.sheetName,
    sha256: result.sha256, byteLength: file.bytes.byteLength,
    sourceBytesHex: Buffer.from(file.bytes).toString("hex"),
    columnLabels: result.sheet.headers, rows,
  });
  return {
    organizationId, branchId, actorUserId, idempotencyKey, requestSha256,
    parserVersion: JUBO_PAIR_PARSER_VERSION,
    master: batch("master", masterFile, master, masterRows),
    monthlySummary: batch("monthlySummary", monthlyFile, monthly, monthlyRows),
    masterNonRecordRows: footer.map((row) => ({ sheetRow: row.sheetRow,
      rawValues: row.rawValues, normalizedValues: row.normalizedValues,
      rawCellTypes: row.rawCellTypes })),
    plan, formallyImported: false,
  };
}
