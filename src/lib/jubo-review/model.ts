import { z } from "zod";

export const JUBO_PROFILE_REVIEW_PURPOSE = "jubo_intake_profile_mapping_v2" as const;
export const JUBO_PROFILE_MAPPING_VERSION = "jubo-master-monthly-202610-v2" as const;
export const JUBO_PROFILE_REVIEW_PATH = "/app/governance/jubo-profile-review";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const originalCell = z.object({
  index: z.number().int().min(0).max(94),
  value: z.union([z.string(), z.number(), z.null()]),
}).strict();
const contact = z.object({
  name: z.string(), relationship: z.string(), phone: z.string(), address: z.string(),
  isPrimary: z.boolean(), isEmergency: z.boolean(),
}).strict();

export const juboReviewQueueSchema = z.object({
  reviewPurpose: z.literal(JUBO_PROFILE_REVIEW_PURPOSE),
  eligiblePairCount: z.number().int().nonnegative(),
  pairs: z.array(z.object({
    pairId: z.uuid(), verifiedAt: z.iso.datetime({ offset: true }),
    sourceRows: z.array(z.object({
      sourceRowId: z.uuid(), sourceSheetRow: z.number().int().positive(),
      reviewVersion: z.number().int().nonnegative(),
      decision: z.enum(["unreviewed", "approved", "held", "rejected", "stale"]),
    }).strict()).length(23),
  }).strict()).max(20),
}).strict().superRefine((queue, ctx) => {
  if (queue.eligiblePairCount < queue.pairs.length ||
    new Set(queue.pairs.map((pair) => pair.pairId)).size !== queue.pairs.length ||
    queue.pairs.some((pair) =>
      new Set(pair.sourceRows.map((row) => row.sourceRowId)).size !== 23 ||
      new Set(pair.sourceRows.map((row) => row.sourceSheetRow)).size !== 23 ||
      pair.sourceRows.some((row) => row.decision === "unreviewed" && row.reviewVersion !== 0 ||
        row.decision !== "unreviewed" && row.reviewVersion === 0))) {
    ctx.addIssue({ code: "custom", message: "JUBO 覆核清單未通過一致性核對" });
  }
});
export type JuboReviewQueue = z.infer<typeof juboReviewQueueSchema>;

export const juboReviewPreviewSchema = z.object({
  reviewPurpose: z.literal(JUBO_PROFILE_REVIEW_PURPOSE),
  mappingVersion: z.literal(JUBO_PROFILE_MAPPING_VERSION),
  pairId: z.uuid(), sourceRowId: z.uuid(), sourceSheetRow: z.number().int().positive(),
  sourceRowSha256: digest, mappingReviewSha256: digest,
  monthlySourceRowId: z.uuid().nullable(),
  originalMappedValues: z.object({
    displayName: originalCell, sex: originalCell, dateOfBirth: originalCell,
    identityNumber: originalCell, registeredAddress: originalCell,
    residentialAddress: originalCell, cmsLevel: originalCell, disability: originalCell,
    primaryContactName: originalCell, primaryContactPhone: originalCell,
    proxyName: originalCell, proxyPhone: originalCell,
  }).strict(),
  displayProfile: z.object({
    displayName: z.string(), sex: z.enum(["male", "female", "other", "unknown"]),
    dateOfBirth: z.string().nullable(), identityNumber: z.string().nullable(),
    phone: z.string().nullable(), registeredAddress: z.string().nullable(),
    residentialAddress: z.string().nullable(), cmsLevel: z.number().int().min(1).max(8).nullable(),
    disability: z.string().nullable(), contacts: z.array(contact).max(2),
    consent: z.object({ status: z.literal("pending"), confirmedOn: z.null() }).strict(),
    notes: z.string(),
  }).strict(),
  normalizationFieldIndices: z.object({
    nfkc: z.array(z.number().int().min(0).max(94)).max(12),
    contactSeparator: z.array(z.number().int().min(0).max(94)).max(4),
  }).strict(),
  normalizationRequiresConfirmation: z.boolean(),
  previewId: z.uuid(), previewSha256: digest,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((preview, ctx) => {
  const expected = {
    displayName: 2, sex: 3, dateOfBirth: 23, identityNumber: 25,
    registeredAddress: 32, residentialAddress: 35, cmsLevel: 48, disability: 54,
    primaryContactName: 78, primaryContactPhone: 79, proxyName: 80, proxyPhone: 81,
  };
  if (Object.entries(expected).some(([key, index]) =>
    preview.originalMappedValues[key as keyof typeof expected].index !== index) ||
    preview.normalizationRequiresConfirmation !==
      (preview.normalizationFieldIndices.nfkc.length > 0 ||
        preview.normalizationFieldIndices.contactSeparator.length > 0) ||
    Date.parse(preview.expiresAt) <= Date.now()) {
    ctx.addIssue({ code: "custom", message: "JUBO 預覽欄位、版本或有效期限不一致" });
  }
});
export type JuboReviewPreview = z.infer<typeof juboReviewPreviewSchema>;

export const juboReviewRequestSchema = z.object({
  pairId: z.uuid(), sourceRowId: z.uuid(), previewId: z.uuid(),
  sourceRowSha256: digest, mappingReviewSha256: digest, previewSha256: digest,
  decision: z.enum(["approved", "held", "rejected"]),
  reason: z.string().trim().min(10).max(1000)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  idempotencyKey: z.uuid(),
}).strict();
export type JuboReviewRequest = z.infer<typeof juboReviewRequestSchema>;

export const juboReviewReceiptSchema = z.object({
  reviewId: z.uuid(), reviewVersion: z.number().int().positive(),
  decision: z.enum(["approved", "held", "rejected"]), replayed: z.boolean(),
}).strict();
