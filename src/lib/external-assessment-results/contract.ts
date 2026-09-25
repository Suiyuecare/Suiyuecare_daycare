import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

export const externalAssessmentInstruments = {
  spmsq: "SPMSQ",
  gds: "GDS 老人憂鬱量表",
  fall_risk: "跌倒風險評估",
  nsi: "NSI 營養篩檢",
  barthel_adl: "Barthel ADL",
  iadl: "IADL",
  swallowing: "吞嚥評估",
  bsrs: "BSRS 情緒量表",
  chewing: "咀嚼能力評估",
  mna: "MNA 營養評估",
} as const;

export type ExternalAssessmentInstrument = keyof typeof externalAssessmentInstruments;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    && value >= "1900-01-01" && value <= "2200-12-31";
}, "日期無效");
const shortText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[<>\u0000-\u001f\u007f]/u.test(value));

export const externalAssessmentResultInputSchema = z.object({
  instrumentKey: z.enum(Object.keys(externalAssessmentInstruments) as [ExternalAssessmentInstrument, ...ExternalAssessmentInstrument[]]),
  externalVersion: shortText(80),
  assessedOn: date,
  score: z.number().finite().min(0).max(100000).multipleOf(0.01).nullable(),
  maximumScore: z.number().finite().min(0.01).max(100000).multipleOf(0.01).nullable(),
  externalResult: shortText(500),
  performedBy: shortText(120),
  source: shortText(120),
  followUpDueOn: date.nullable(),
  followUpNote: z.string().trim().max(500).refine((value) => !/[<>\u0000-\u001f\u007f]/u.test(value))
    .nullable().transform((value) => value === "" ? null : value),
}).strict().superRefine((value, context) => {
  if ((value.score === null) !== (value.maximumScore === null)) {
    context.addIssue({ code: "custom", path: ["score"], message: "分數與滿分需同時填寫" });
  }
  if (value.score !== null && value.maximumScore !== null && value.score > value.maximumScore) {
    context.addIssue({ code: "custom", path: ["score"], message: "分數不可大於滿分" });
  }
});

export type ExternalAssessmentResultInput = z.infer<typeof externalAssessmentResultInputSchema>;

export const externalAssessmentResultRecordSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  instrumentKey: z.enum(Object.keys(externalAssessmentInstruments) as [ExternalAssessmentInstrument, ...ExternalAssessmentInstrument[]]),
  externalVersion: z.string().min(1).max(80),
  assessedOn: date,
  score: z.number().nullable(),
  maximumScore: z.number().nullable(),
  externalResult: z.string().min(1).max(500),
  performedBy: z.string().min(1).max(120),
  source: z.string().min(1).max(120),
  followUpDueOn: date.nullable(),
  followUpNote: z.string().nullable(),
  actorId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

export type ExternalAssessmentResultRecord = z.infer<typeof externalAssessmentResultRecordSchema>;

export const externalAssessmentResultsSnapshotSchema = z.object({
  clientId: z.uuid(),
  records: z.array(externalAssessmentResultRecordSchema).max(50),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  generatedAt: z.iso.datetime({ offset: true }),
}).strict();

export function parseExternalAssessmentResultsSnapshot(value: unknown, clientId: string) {
  const parsed = externalAssessmentResultsSnapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.clientId !== clientId
      || parsed.data.records.some((record) => record.clientId !== clientId)
      || new Set(parsed.data.records.map((record) => record.id)).size !== parsed.data.records.length
      || parsed.data.total < parsed.data.records.length) {
    throw new IntegrationError("EXTERNAL_ASSESSMENT_RESULT_INVALID", "結果清單未完整確認，請重新載入。", 503);
  }
  return parsed.data;
}

export function parseExternalAssessmentResultReceipt(value: unknown, input: ExternalAssessmentResultInput, clientId: string, actorId: string) {
  const parsed = z.object({ record: externalAssessmentResultRecordSchema, replayed: z.boolean() }).strict().safeParse(value);
  if (!parsed.success) throw new IntegrationError("EXTERNAL_ASSESSMENT_RESULT_UNCERTAIN", "儲存結果尚未確認，請以相同操作重試。", 409);
  const { record } = parsed.data;
  const matches = record.clientId === clientId && record.actorId === actorId
    && record.instrumentKey === input.instrumentKey && record.externalVersion === input.externalVersion
    && record.assessedOn === input.assessedOn && record.score === input.score
    && record.maximumScore === input.maximumScore && record.externalResult === input.externalResult
    && record.performedBy === input.performedBy && record.source === input.source
    && record.followUpDueOn === input.followUpDueOn && record.followUpNote === input.followUpNote;
  if (!matches) throw new IntegrationError("EXTERNAL_ASSESSMENT_RESULT_UNCERTAIN", "資料庫回條與這筆登錄不一致，請重新載入並核對。", 409);
  return parsed.data;
}
