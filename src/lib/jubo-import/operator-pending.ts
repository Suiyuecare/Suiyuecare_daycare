import "server-only";

import { planJuboImport } from "./planner";
import { readApprovedJuboXlsx, type JuboXlsxInput } from "./xlsx-reader";

export const JUBO_OPERATOR_AUTHORIZATION = "direct-owner-authorization:20261011:23-master-17-reconcile" as const;
export const JUBO_OPERATOR_SQL = "select private.import_jubo_operator_pending($1::uuid,$2::uuid,$3::uuid,$4::text,$5::bytea,$6::bytea,$7::jsonb) as receipt";
export type JuboOperatorDataset = {
  parserVersion: "jubo-xlsx-reader-202610-v1";
  mappingVersion: "jubo-master-monthly-202610-v2";
  master: { columnLabels: readonly string[]; rows: readonly unknown[] };
  monthly: { columnLabels: readonly string[]; rows: readonly unknown[] };
  nonRecordRows: readonly unknown[];
};

/** No Auth principal, Google subject, clinical approval or reauth is invented.
 * This produces bound parameters for an explicit postgres operator only.
 * It never opens a database, persists source bytes or prints patient values.
 */
export function prepareJuboOperatorPending(input: {
  organizationId: string; branchId: string; idempotencyKey: string;
  authorizationReference: typeof JUBO_OPERATOR_AUTHORIZATION;
  hmacSecret: string | Uint8Array;
  master: JuboXlsxInput; monthly: JuboXlsxInput;
}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (!uuid.test(input.organizationId) || !uuid.test(input.branchId) || !uuid.test(input.idempotencyKey) ||
      input.authorizationReference !== JUBO_OPERATOR_AUTHORIZATION ||
      input.master.kind !== "master" || input.monthly.kind !== "monthlySummary") throw new Error("JUBO_OPERATOR_INVALID_INPUT");
  const masterBytes = Buffer.from(input.master.bytes);
  const monthlyBytes = Buffer.from(input.monthly.bytes);
  const master = readApprovedJuboXlsx({ ...input.master, bytes: masterBytes });
  const monthly = readApprovedJuboXlsx({ ...input.monthly, bytes: monthlyBytes });
  const plan = planJuboImport({ organizationId: input.organizationId, branchId: input.branchId,
    hmacSecret: input.hmacSecret, master: master.sheet, monthlySummary: monthly.sheet,
    expectedCounts: { master: 23, monthlySummary: 17 } });
  if (plan.matchedSummaryRowCount !== 17 || master.sheet.nonRecordRows?.length !== 1 ||
      plan.clients.filter(client => client.serviceStatus === "active").length !== 17 ||
      plan.clients.filter(client => client.serviceStatus === "suspended").length !== 1 ||
      plan.clients.filter(client => client.serviceStatus === "closed").length !== 5) throw new Error("JUBO_OPERATOR_SOURCE_MISMATCH");
  const rows = (sheet: typeof master.sheet, firstRow: number) => sheet.rows.map((normalizedValues, index) => ({
    sheetRow: firstRow + index, rawValues: sheet.rawRows![index],
    normalizedValues, rawCellTypes: sheet.rawCellTypes![index],
  }));
  const dataset: JuboOperatorDataset = {
    parserVersion: "jubo-xlsx-reader-202610-v1", mappingVersion: "jubo-master-monthly-202610-v2",
    master: { columnLabels: master.sheet.headers, rows: rows(master.sheet, 6) },
    monthly: { columnLabels: monthly.sheet.headers, rows: rows(monthly.sheet, 5) },
    nonRecordRows: master.sheet.nonRecordRows,
  };
  return {
    sql: JUBO_OPERATOR_SQL,
    parameters: [input.organizationId.toLowerCase(), input.branchId.toLowerCase(), input.idempotencyKey.toLowerCase(),
      input.authorizationReference, masterBytes, monthlyBytes, JSON.stringify(dataset)] as const,
    counts: { master: 23, monthly: 17, newAttendance: 0, admitted: 0 },
  };
}
