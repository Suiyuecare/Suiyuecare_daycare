import { z } from "zod";
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const timestamp = z.iso.datetime({ offset: true });
export const familyCategorySchema = z.enum(["care", "health", "attendance", "schedule", "billing", "document", "notice"]);
export const familyPublicationSchema = z.object({ id: z.uuid(), category: familyCategorySchema, title: text(120), summary: text(1000), occurredAt: timestamp, publishedAt: timestamp, sourceId: z.uuid(), bill: z.object({ total: z.number().positive(), currency: z.string().regex(/^[A-Z]{3}$/), periodFrom: z.iso.date(), periodTo: z.iso.date(), balance: z.number().nonnegative(), lines: z.array(z.object({ name: text(120), quantity: z.number().positive(), amount: z.number().nonnegative() }).strict()).max(50), receipts: z.array(z.object({ number: text(80), amount: z.number().positive(), at: timestamp }).strict()).max(1000) }).strict().nullable() }).strict();
const preferences = z.object({ version: z.number().int().nonnegative(), pushEnabled: z.boolean(), categories: z.array(z.enum(["messages", "care", "schedule", "billing"])).max(4), quietStart: z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/), quietEnd: z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/), contactPhone: z.string().regex(/^09\d{8}$/).nullable() }).strict();
export const familyWorkspaceSchema = z.object({ clientId: z.uuid(), scopes: z.array(z.enum(["care.read", "health.summary", "schedule.read", "billing.read", "documents.read", "messages.read"])).max(6), publications: z.array(familyPublicationSchema).max(100), messages: z.array(z.object({ id: z.uuid(), body: text(2000), direction: z.enum(["family_to_institution", "institution_to_family"]), at: timestamp, read: z.boolean() }).strict()).max(100), messageVersion: z.number().int().nonnegative().default(0), actorScope: z.object({ organizationId: z.uuid(), branchId: z.uuid(), userId: z.uuid() }).strict().optional(), preferences, unreadCount: z.number().int().nonnegative(), updatedAt: timestamp }).strict().superRefine((value, ctx) => {
  const scope = { care: "care.read", health: "health.summary", attendance: "care.read", schedule: "schedule.read", billing: "billing.read", document: "documents.read", notice: "messages.read" } as const;
  if (value.publications.some(row => !value.scopes.includes(scope[row.category])) || (value.messages.length > 0 && !value.scopes.includes("messages.read"))) ctx.addIssue({ code: "custom", message: "FAMILY_CATEGORY_SCOPE_MISMATCH" });
  if (new Set(value.publications.map(row => row.id)).size !== value.publications.length || new Set(value.messages.map(row => row.id)).size !== value.messages.length) ctx.addIssue({ code: "custom", message: "FAMILY_DUPLICATE_RECORD" });
});
export type FamilyWorkspaceSnapshot = z.infer<typeof familyWorkspaceSchema>;
const mutationBase = z.object({ clientId: z.uuid(), idempotency_key: z.uuid() });
export const familyMutationSchema = z.discriminatedUnion("action", [
  mutationBase.extend({ action: z.literal("message"), body: text(2000), expectedVersion: z.number().int().nonnegative().max(999_999_999).default(0) }).strict(),
  mutationBase.extend({ action: z.literal("preferences"), expectedVersion: z.number().int().nonnegative(), pushEnabled: z.boolean(), categories: preferences.shape.categories, quietStart: preferences.shape.quietStart, quietEnd: preferences.shape.quietEnd, contactPhone: preferences.shape.contactPhone }).strict(),
  mutationBase.extend({ action: z.literal("read"), messageId: z.uuid() }).strict(),
  mutationBase.extend({ action: z.literal("download"), publicationId: z.uuid() }).strict(),
]);
export const familyPublishSchema = mutationBase.extend({ category: familyCategorySchema, sourceId: z.uuid(), title: text(120), summary: text(1000), occurredAt: timestamp }).strict();
export const familyStaffWriteSchema = z.discriminatedUnion("action", [
  mutationBase.extend({ action: z.literal("message"), recipientUserId: z.uuid(), body: text(2000), expectedVersion: z.number().int().nonnegative().max(999_999_999).default(0) }).strict(),
  mutationBase.extend({ action: z.literal("withdraw"), publicationId: z.uuid(), reason: text(1000) }).strict(),
  mutationBase.extend({ action: z.literal("reviewConflict"), conflictId: z.uuid(), note: text(1000) }).strict(),
]);
export const familyStaffWorkspaceSchema = z.object({
  clientId: z.uuid(), recipientId: z.uuid().nullable(),
  recipients: z.array(z.object({ id: z.uuid(), name: text(120) }).strict()).max(200),
  messages: familyWorkspaceSchema.shape.messages,
  messageVersion: z.number().int().nonnegative().default(0),
  conflicts: z.array(z.object({ id: z.uuid(), body: text(2000), expectedVersion: z.number().int().nonnegative(), observedVersion: z.number().int().nonnegative(), at: timestamp }).strict()).max(100).default([]),
  publications: z.array(familyPublicationSchema.omit({ bill: true }).extend({ withdrawn: z.boolean(), sourceCurrent: z.boolean() }).strict()).max(100),
  sources: z.array(z.object({ id: z.uuid(), category: familyCategorySchema, at: timestamp, label: text(120) }).strict()).max(100),
  canPublish: z.boolean(), updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.recipientId && !value.recipients.some(person => person.id === value.recipientId)) ctx.addIssue({ code: "custom", message: "FAMILY_STAFF_RECIPIENT_MISMATCH" });
  if (!value.recipientId && value.messages.length) ctx.addIssue({ code: "custom", message: "FAMILY_STAFF_MESSAGES_REQUIRE_RECIPIENT" });
});
export type FamilyStaffWorkspaceSnapshot = z.infer<typeof familyStaffWorkspaceSchema>;

export const familyMessageReceiptSchema = z.object({ id: z.uuid(), replayed: z.boolean(), version: z.number().int().positive().optional(), status: z.enum(["saved", "conflict"]).optional() }).strict();
export const familyScheduleSchema = z.object({
  clientId: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  items: z.array(z.object({ id: z.uuid(), kind: z.enum(["transport", "activity"]), version: z.number().int().positive(), date: z.iso.date(), startsAt: timestamp, endsAt: timestamp, direction: z.enum(["pickup", "dropoff"]).nullable(), title: text(120), status: z.enum(["scheduled", "cancelled", "completed", "boarded", "alighted", "attention"]), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(1000),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.items.some(item => !item.date.startsWith(`${value.month}-`) || Date.parse(item.endsAt) <= Date.parse(item.startsAt) || (item.kind === "transport") !== (item.direction !== null)) || new Set(value.items.map(item => item.id)).size !== value.items.length) ctx.addIssue({ code: "custom", message: "FAMILY_SCHEDULE_SCOPE_INVALID" });
});
export type FamilyScheduleSnapshot = z.infer<typeof familyScheduleSchema>;
