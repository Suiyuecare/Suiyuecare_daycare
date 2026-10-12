import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.string().trim().min(8).max(240).regex(/^[^\u0000-\u001f\u007f]+$/u);
const reason = z.string().trim().min(10).max(1000).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const admissionProposalInputSchema = z.object({
  action: z.literal("propose"), clientId: z.uuid(), clientRowVersion: z.number().int().positive(),
  admittedOn: z.iso.date(), eligibilityFrom: z.iso.date(), eligibilityTo: z.iso.date(),
  eligibilityReference: reference, eligibilitySha256: sha,
  agreementReference: reference, agreementSha256: sha, reason,
}).strict().refine(value => value.eligibilityFrom <= value.admittedOn && value.admittedOn <= value.eligibilityTo,
  { message: "收案日須在資格有效期間內。", path: ["admittedOn"] });
export const admissionReviewInputSchema = z.object({
  action: z.literal("review"), clientId: z.uuid(), proposalId: z.uuid(), expectedSha256: sha,
  decision: z.enum(["approved", "held", "rejected"]), reason,
}).strict();
export const admissionPreparationInputSchema = z.discriminatedUnion("action", [admissionProposalInputSchema, admissionReviewInputSchema]);
export type AdmissionPreparationInput = z.infer<typeof admissionPreparationInputSchema>;

export const admissionPreparationSnapshotSchema = z.object({
  clientId: z.uuid(), clientRowVersion: z.number().int().positive(), intakeVersion: z.number().int().nonnegative(),
  sourceKind: z.enum(["reviewed_export", "operator_master"]),
  sourceStatus: z.enum(["服務中", "暫停服務", "結案"]), canSubmit: z.boolean(),
  admissionEnabled: z.literal(false), sourceVerified: z.literal(false),
  proposals: z.array(z.object({
    id: z.uuid(), version: z.number().int().positive(), sha256: sha,
    clientRowVersion: z.number().int().positive(), admittedOn: z.iso.date(),
    eligibilityReference: reference, eligibilitySha256: sha, eligibilityFrom: z.iso.date(), eligibilityTo: z.iso.date(),
    agreementReference: reference, agreementSha256: sha, reason,
    proposedAt: z.iso.datetime({ offset: true }), ownProposal: z.boolean(),
    reviewDecision: z.enum(["approved", "held", "rejected"]).nullable(), reviewReason: reason.nullable(), canReview: z.boolean(),
  }).strict()).max(20),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.proposals.map(proposal => proposal.id)).size !== value.proposals.length ||
    value.canSubmit && value.sourceStatus !== "服務中" ||
    value.proposals.some(proposal => proposal.canReview && (proposal.ownProposal || proposal.reviewDecision !== null))) {
    ctx.addIssue({ code: "custom", message: "收案核對狀態不一致。" });
  }
});
export type AdmissionPreparationSnapshot = z.infer<typeof admissionPreparationSnapshotSchema>;
export const admissionPreparationReceiptSchema = z.union([
  z.object({ proposalId: z.uuid(), proposalSha256: sha, version: z.number().int().positive(),
    status: z.literal("awaiting_second_review"), sourceVerified: z.literal(false), admissionEnabled: z.literal(false), replayed: z.boolean() }).strict(),
  z.object({ reviewId: z.uuid(), decision: z.enum(["approved", "held", "rejected"]),
    status: z.literal("source_verification_required"), admissionEnabled: z.literal(false), replayed: z.boolean() }).strict(),
]);

/** Confirm only the intent fields present in the canonical RPC receipt. */
export function readAdmissionPreparationReceipt(value: unknown, input: AdmissionPreparationInput) {
  const parsed = admissionPreparationReceiptSchema.safeParse(value);
  if (!parsed.success || (input.action === "propose" ? !("proposalId" in parsed.data)
    : !("reviewId" in parsed.data) || parsed.data.decision !== input.decision)) return null;
  return parsed.data;
}
