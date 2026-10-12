import { z } from "zod";

export const qualityMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/u);
export const QUALITY_MONTHLY_RULE = "organization.quality-monthly-v1" as const;
const qualityNumeratorSources = {
  falls: "fall", infections: "infection", abnormal: "abnormal", weight_coverage: "weight",
} as const;
export const qualitySourceSchema = z.object({
  id: z.uuid(), clientId: z.uuid().nullable(), date: z.iso.date().regex(/^20\d{2}-\d{2}-\d{2}$/u),
  source: z.enum(["attendance", "fall", "infection", "abnormal", "weight"]),
}).strict();
const metricSchema = z.object({
  key: z.enum(["falls", "infections", "abnormal", "weight_coverage"]),
  numerator: z.number().int().nonnegative(), denominator: z.number().int().nonnegative(),
  // Missing denominator is not 0% and not 'not applicable'.
  rate: z.string().regex(/^\d+\.\d{6}$/u).nullable(),
  numeratorItems: z.array(qualitySourceSchema).max(25_000),
  denominatorItems: z.array(qualitySourceSchema).max(25_000),
}).strict().superRefine((value, ctx) => {
  if (value.numerator !== value.numeratorItems.length || value.denominator !== value.denominatorItems.length ||
    (value.denominator === 0) !== (value.rate === null) ||
    value.numeratorItems.some((item) => item.source !== qualityNumeratorSources[value.key]) ||
    value.denominatorItems.some((item) => item.source !== "attendance") ||
    new Set(value.numeratorItems.map((item) => item.id)).size !== value.numeratorItems.length ||
    new Set(value.denominatorItems.map((item) => item.id)).size !== value.denominatorItems.length ||
    (value.rate !== null && Math.abs(Number(value.rate) - value.numerator * 100 / value.denominator) > 0.00000051)) {
    ctx.addIssue({ code: "custom", message: "月報統計與明細不一致" });
  }
});
export const qualityMonthlySnapshotSchema = z.object({
  schemaVersion: z.literal(1), organizationId: z.uuid(), branchId: z.uuid(),
  month: qualityMonthSchema, ruleVersion: z.literal(QUALITY_MONTHLY_RULE),
  officialIndicator: z.literal(false), generatedAt: z.iso.datetime({ offset: true }),
  hash: z.string().regex(/^[a-f0-9]{64}$/u), snapshotId: z.uuid().nullable(),
  metrics: z.array(metricSchema).length(4), excludedVoidedWeights: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.metrics.map((metric) => metric.key)).size !== 4 || value.metrics.some((metric) =>
    [...metric.numeratorItems, ...metric.denominatorItems].some((item) => !item.date.startsWith(value.month)))) {
    ctx.addIssue({ code: "custom", message: "月報來源或月份不一致" });
  }
});
export const qualityFreezeRequestSchema = z.object({
  month: qualityMonthSchema, expectedHash: z.string().regex(/^[a-f0-9]{64}$/u), idempotency_key: z.uuid(),
}).strict();
export type QualityMonthlySnapshot = z.infer<typeof qualityMonthlySnapshotSchema>;
export const qualityFreezeReceiptSchema = qualityMonthlySnapshotSchema.safeExtend({
  actorUserId: z.uuid(), idempotencyKey: z.uuid(),
});

export const qualityMetricLabels = {
  falls: "跌倒事件", infections: "感染事件", abnormal: "個案異常事件", weight_coverage: "體重量測覆蓋",
} as const;

/** Export is a projection of the immutable payload, never a second database query. */
export function qualityMonthlyCsv(snapshot: QualityMonthlySnapshot) {
  const checked = qualityMonthlySnapshotSchema.parse(snapshot);
  const escape = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows: (string | number | null)[][] = [
    ["內部品質月報", checked.month, checked.ruleVersion, "非官方品質指標", checked.hash],
    ["指標", "分子", "分母", "每百人日／百分比", "明細類別", "來源", "紀錄ID", "個案ID", "日期"],
  ];
  for (const metric of checked.metrics) {
    rows.push([qualityMetricLabels[metric.key], metric.numerator, metric.denominator, metric.rate, "統計", null, null, null, null]);
    for (const [kind, items] of [["分子", metric.numeratorItems], ["分母", metric.denominatorItems]] as const) {
      for (const item of items) rows.push([qualityMetricLabels[metric.key], null, null, null, kind, item.source, item.id, item.clientId, item.date]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}
