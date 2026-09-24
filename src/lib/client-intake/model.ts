import { z } from "zod";

export const INTAKE_PATH = "/app/client-intake";
// The static parser supports 25 MB. This mediated web upload stays below the
// hosting request-body ceiling; larger files need a separate trusted upload path.
export const MAX_INTAKE_WEB_UPLOAD_BYTES = 4 * 1024 * 1024;
export const INTAKE_STEPS = ["匯入與建檔", "基本資料", "每週到站與接送", "A／B／C 表", "應備文件"] as const;

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const text = (max: number) => z.string().trim().max(max).refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const date = z.string().refine(isCalendarDate, "請填寫有效日期");
const optionalText = (max: number) => text(max).nullable();

export const intakeProfileSchema = z.object({
  displayName: text(120).min(1), clientCode: text(64).min(1),
  dateOfBirth: date.nullable(), identityNumber: optionalText(32),
  sex: z.enum(["male", "female", "other", "unknown"]),
  phone: optionalText(80), registeredAddress: optionalText(500), residentialAddress: optionalText(500),
  cmsLevel: z.number().int().min(1).max(8).nullable(), disability: optionalText(500),
  contacts: z.array(z.object({
    name: text(120).min(1), relationship: text(120).nullish().transform((v) => v ?? ""), phone: text(80).nullish().transform((v) => v ?? ""), address: text(500).nullish().transform((v) => v ?? ""),
    isPrimary: z.boolean(), isEmergency: z.boolean(),
  }).strict()).max(10),
  consent: z.object({ status: z.enum(["pending", "confirmed", "declined"]), confirmedOn: date.nullable() }).strict(),
  notes: text(4000).nullable().transform((v) => v ?? ""),
}).strict().superRefine((profile, ctx) => {
  if (profile.consent.status === "confirmed" && !profile.consent.confirmedOn) ctx.addIssue({ code: "custom", path: ["consent", "confirmedOn"], message: "請填寫確認日期" });
  if (profile.consent.status !== "confirmed" && profile.consent.confirmedOn) ctx.addIssue({ code: "custom", path: ["consent", "confirmedOn"], message: "未確認同意時不得填寫確認日期" });
  if (profile.contacts.filter((c) => c.isPrimary).length > 1) ctx.addIssue({ code: "custom", path: ["contacts"], message: "主要聯絡人只能一位" });
});
export type IntakeProfile = z.infer<typeof intakeProfileSchema>;
export const emptyIntakeProfile: IntakeProfile = {
  displayName: "", clientCode: "", dateOfBirth: null, identityNumber: null, sex: "unknown", phone: null,
  registeredAddress: null, residentialAddress: null, cmsLevel: null, disability: null,
  contacts: [], consent: { status: "pending", confirmedOn: null }, notes: "",
};
export const intakeSnapshotSchema = z.object({
  clientId: z.uuid(), profileVersion: z.number().int().nonnegative(), clientRowVersion: z.number().int().positive(),
  pending: z.boolean(), profile: intakeProfileSchema,
  fieldAuthority: z.record(z.string(), z.string()), sourceBatchId: z.uuid().nullable(),
}).passthrough();
export type IntakeSnapshot = z.infer<typeof intakeSnapshotSchema>;
export const intakeReceiptSchema = z.object({ clientId: z.uuid(), profileVersion: z.number().int().positive(), clientRowVersion: z.number().int().positive(), pending: z.boolean(), replayed: z.boolean(), operationId: z.uuid() }).passthrough();
export const cmsPreviewSchema = z.object({
  batchId: z.uuid(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u), mappingVersion: z.string(),
  fields: z.array(z.object({
    id: z.string(), intakeTarget: z.string().nullable(), intakeValue: z.unknown().optional(), intakeWarning: z.string().nullable().optional(),
    normalizedValue: z.string(), rawValue: z.string(), warnings: z.array(z.string()),
    source: z.object({ sectionCode: z.string(), sectionTitle: z.string(), label: z.string(), parentPath: z.string() }),
  }).passthrough()),
  sections: z.array(z.object({ code: z.string(), title: z.string() }).passthrough()),
  warnings: z.array(z.object({ message: z.string() }).passthrough()),
  conflicts: z.array(z.unknown()), current: intakeSnapshotSchema.nullable(), imported: z.boolean(),
  importReceipt: z.object({ clientId: z.uuid() }).passthrough().nullable(),
  sourceOfficialDate: date.nullable().optional(), currentSourceOfficialDate: date.nullable().optional(),
  sourceReviewRequired: z.boolean().optional(), sourceIsOlder: z.boolean().optional(),
}).passthrough();
export type CmsIntakePreview = z.infer<typeof cmsPreviewSchema>;
export const intakeTargetLabels: Record<string, string> = {
  displayName: "姓名", identityNumber: "身分識別", dateOfBirth: "出生日期", sex: "性別", phone: "個案電話",
  registeredAddress: "戶籍地址", residentialAddress: "居住地址", cmsLevel: "CMS 等級", disability: "身障資格／程度",
  primaryContactName: "主要聯絡人", primaryContactRelationship: "與個案關係", primaryContactPhone: "聯絡人電話", primaryContactAddress: "聯絡人地址",
};
export const profileMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), idempotency_key: z.uuid(), profile: intakeProfileSchema }).strict(),
  z.object({ action: z.literal("update"), idempotency_key: z.uuid(), clientId: z.uuid(), expectedVersion: z.number().int().nonnegative(), expectedClientVersion: z.number().int().positive(), profile: intakeProfileSchema }).strict(),
]);
export const cmsCommitSchema = z.object({
  batchId: z.uuid(), idempotency_key: z.uuid(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  clientId: z.uuid().nullable(), expectedVersion: z.number().int().nonnegative(), expectedClientVersion: z.number().int().nonnegative(),
  clientCode: text(64).min(1),
  sourceReviewReason: text(1000).nullable(),
  decisions: z.array(z.object({ fieldId: text(128).min(1), target: text(120).min(1), choice: z.enum(["use_source", "keep_current"]) }).strict()).max(100),
}).strict();

export function intakeMissingItems(profile: IntakeProfile) {
  return [
    !profile.identityNumber && "身分識別資料", !profile.dateOfBirth && "出生日期",
    !profile.residentialAddress && "居住地址",
    !profile.contacts.some((c) => c.name && c.phone) && "可聯繫的關係人",
    profile.consent.status !== "confirmed" && "告知同意確認",
  ].filter((value): value is string => Boolean(value));
}
