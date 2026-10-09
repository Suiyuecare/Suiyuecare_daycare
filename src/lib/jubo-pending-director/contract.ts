import { z } from "zod";

const uuid = z.uuid();
const sourceStatus = z.enum(["服務中", "暫停服務", "結案"]);
const formKey = z.enum(["spmsq", "gds", "fall_risk", "nsi", "barthel", "iadl", "swallowing", "bsrs", "body", "abcd"]);

export const directorDirectorySchema = z.object({
  clients: z.array(z.object({ clientId: uuid, displayName: z.string().min(1), clientCode: z.string().min(1), sourceStatus }).strict()).max(500),
  total: z.number().int().min(0).max(500),
}).strict().superRefine((value, context) => {
  if (value.clients.length !== value.total || new Set(value.clients.map((entry) => entry.clientId)).size !== value.total) {
    context.addIssue({ code: "custom", message: "directory count mismatch" });
  }
});

const localPayload = z.object({
  contactPreference: z.enum(["phone", "in_person", "written", "unknown"]).optional(),
  visitPlanningNote: z.string().max(1000).optional(),
  followUpNote: z.string().max(1000).optional(),
}).strict();
const preparationPayload = z.object({
  formVersion: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u),
  assessmentDate: z.iso.date(),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), z.union([
    z.string().max(1000), z.number(), z.boolean(),
    z.array(z.union([z.string().max(1000), z.number(), z.boolean()])).max(12),
  ])).refine((value) => Object.keys(value).length <= 50),
  qualitativeNote: z.string().max(2000).optional(),
}).strict();

export const directorDraftInputSchema = z.discriminatedUnion("kind", [
  z.object({ clientId: uuid, kind: z.literal("local_supplement"), formKey: z.literal("intake_local"), expectedRevision: z.number().int().min(0), payload: localPayload, idempotency_key: uuid }).strict(),
  z.object({ clientId: uuid, kind: z.literal("assessment_preparation"), formKey, expectedRevision: z.number().int().min(0), payload: preparationPayload, idempotency_key: uuid }).strict(),
]);

export const directorDraftReceiptSchema = z.object({
  draftId: uuid, revision: z.number().int().positive(), kind: z.enum(["local_supplement", "assessment_preparation"]),
  formKey: z.string(), replayed: z.boolean(), formalRecord: z.literal(false),
}).strict();

const sourceFieldKeys = [
  "displayName", "sex", "dateOfBirth", "identityNumber", "registeredAddress", "residentialAddress",
  "cmsLevel", "disability", "primaryContactName", "primaryContactPhone", "proxyName", "proxyPhone",
] as const;
const fieldSchema = z.object({
  key: z.enum(sourceFieldKeys), label: z.string(), original: z.string().nullable(), display: z.string().nullable(),
}).strict();
const sourceFieldsSchema = z.array(fieldSchema).length(sourceFieldKeys.length).superRefine((fields, context) => {
  for (const [index, expected] of sourceFieldKeys.entries()) {
    if (fields[index]?.key !== expected) {
      context.addIssue({ code: "custom", path: [index, "key"], message: "source field order mismatch" });
    }
  }
  // The SQL RPC masks both source and mapped identity. Validate this again at
  // the API boundary so a regressed RPC cannot emit an unmasked identifier.
  const identity = fields[3];
  for (const column of ["original", "display"] as const) {
    const value = identity?.[column];
    if (value !== null && value !== undefined && !/^••••.{4}$/u.test(value)) {
      context.addIssue({ code: "custom", path: [3, column], message: "identity must be masked" });
    }
  }
});
export const directorWorkspaceSchema = z.object({
  clientId: uuid, clientCode: z.string(), displayName: z.string(), status: z.literal("pending"),
  sourceSystem: z.literal("jubo"), sourceStatus, sourceFirstServiceOn: z.string().nullable(),
  profileVersion: z.number().int().positive(),
  humanReview: z.object({ decision: z.literal("approved"), version: z.number().int().positive(), reviewedAt: z.string() }).strict(),
  normalizationFieldIndices: z.object({ nfkc: z.array(z.number().int()), contactSeparator: z.array(z.number().int()) }).strict(),
  fields: sourceFieldsSchema,
  localSupplement: z.object({ revision: z.number().int().positive(), payload: localPayload }).strict().nullable(),
  assessmentPreparations: z.array(z.object({ formKey, revision: z.number().int().positive(), payload: preparationPayload }).strict()).max(10),
  formalRecord: z.literal(false), formalOperationsAllowed: z.literal(false),
}).strict();

export type DirectorDirectory = z.infer<typeof directorDirectorySchema>;
export type DirectorWorkspace = z.infer<typeof directorWorkspaceSchema>;
export type DirectorDraftInput = z.infer<typeof directorDraftInputSchema>;
