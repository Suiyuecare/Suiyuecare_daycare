import { z } from "zod";

const dateOnly = z.string().regex(/^(20\d{2}|2100)-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "請填寫有效日期");

export const evaluationPreparationRequestSchema = z.object({
  itemCode: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,23}$/),
  expectedVersion: z.number().int().min(0).max(999_999),
  ownerUserId: z.uuid().nullable(),
  dueOn: dateOnly.nullable(),
  evidenceReference: z.uuid().nullable(),
  progress: z.enum(["collecting", "internal_review_requested"]),
  changeReason: z.enum(["initial", "evidence_added", "owner_changed", "due_date_changed", "progress_changed", "correction"]),
}).strict().superRefine((value, ctx) => {
  if ((value.expectedVersion === 0) !== (value.changeReason === "initial")) {
    ctx.addIssue({ code: "custom", message: "初建與修訂原因不一致", path: ["changeReason"] });
  }
  if (value.progress === "internal_review_requested" &&
    (!value.ownerUserId || !value.dueOn || !value.evidenceReference)) {
    ctx.addIssue({ code: "custom", message: "待內部覆核須有負責人、期限及證據參照碼", path: ["progress"] });
  }
});

export type EvaluationPreparationRequest = z.infer<typeof evaluationPreparationRequestSchema>;

export const evaluationPreparationVersionSchema = z.object({
  versionId: z.uuid(), itemCode: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,23}$/),
  version: z.number().int().positive(), previousVersionId: z.uuid().nullable(),
  ownerUserId: z.uuid().nullable(), dueOn: dateOnly.nullable(), evidenceReference: z.uuid().nullable(),
  progress: z.enum(["collecting", "internal_review_requested"]),
  changeReason: z.enum(["initial", "evidence_added", "owner_changed", "due_date_changed", "progress_changed", "correction"]),
  recordedBy: z.uuid(), recordedAt: z.iso.datetime({ offset: true }), contentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const evaluationPreparationSnapshotSchema = z.object({
  organizationId: z.uuid(), branchId: z.uuid(), generatedAt: z.iso.datetime({ offset: true }),
  staleAfter: z.iso.datetime({ offset: true }), page: z.number().int().min(1).max(100),
  pageSize: z.literal(25), total: z.number().int().nonnegative(),
  items: z.array(evaluationPreparationVersionSchema).max(25),
  owners: z.array(z.object({ userId: z.uuid(), name: z.string().min(1).max(120) }).strict()).max(200),
  sourceStatus: z.literal("applicability_unapproved"), formalSubmissionEnabled: z.literal(false),
  demo: z.boolean(),
}).strict();

export const evaluationPreparationReceiptSchema = z.object({
  operationId: z.uuid(), organizationId: z.uuid(), branchId: z.uuid(), actorUserId: z.uuid(),
  idempotencyKey: z.uuid(), result: evaluationPreparationVersionSchema,
  replayed: z.boolean(), formalSubmissionEnabled: z.literal(false),
}).strict();

export type EvaluationPreparationSnapshot = z.infer<typeof evaluationPreparationSnapshotSchema>;
export type EvaluationPreparationVersion = z.infer<typeof evaluationPreparationVersionSchema>;
export type EvaluationPreparationReceipt = z.infer<typeof evaluationPreparationReceiptSchema>;
