import { z } from "zod";
import type { QuestionnaireFormKey } from "./types";

export type QuestionnaireMutationAction = "create" | "revise" | "submit" | "sign" | "return" | "correct";

// These fields are the immutable receipt written by the mutation RPC, including
// operation replays. Do not accept an ID alone as confirmation of a saved write.
const receiptSchema = z.object({
  action: z.enum(["create", "revise", "submit", "sign", "return", "correct"]),
  clientId: z.uuid(), formKey: z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf", "full_mna"]),
  assessmentKey: z.uuid(), versionId: z.uuid(), version: z.number().int().positive().max(1_000_000),
  recordState: z.enum(["draft", "submitted", "signed"]), assessedOn: z.iso.date(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u), committedAt: z.iso.datetime({ offset: true }), replayed: z.boolean(),
}).strict();

export function readQuestionnaireMutationReceipt(value: unknown, expected: {
  action: QuestionnaireMutationAction; clientId: string; formKey: QuestionnaireFormKey;
  assessedOn?: string; assessmentKey?: string; previousVersionId?: string; expectedVersion?: number; contentHash?: string;
}) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) return null;
  const receipt = parsed.data;
  const state = expected.action === "sign" ? "signed" : expected.action === "submit" ? "submitted" : "draft";
  if (expected.action !== "create" && (expected.expectedVersion === undefined || !expected.assessmentKey || !expected.previousVersionId)) return null;
  if (receipt.action !== expected.action || receipt.clientId !== expected.clientId.toLowerCase() || receipt.formKey !== expected.formKey ||
    receipt.recordState !== state || receipt.version !== (expected.action === "create" ? 1 : (expected.expectedVersion ?? 0) + 1) ||
    expected.assessedOn !== undefined && receipt.assessedOn !== expected.assessedOn ||
    expected.assessmentKey !== undefined && receipt.assessmentKey !== expected.assessmentKey.toLowerCase() ||
    expected.previousVersionId !== undefined && receipt.versionId === expected.previousVersionId.toLowerCase() ||
    expected.contentHash !== undefined && receipt.contentHash !== expected.contentHash) return null;
  return receipt;
}

const publicationReceiptSchema = z.object({ publicationId: z.uuid(), status: z.enum(["pending", "approved"]), replayed: z.boolean() }).strict();
export function readQuestionnairePublicationReceipt(value: unknown, expected: { action: "request" } | { action: "approve"; publicationId: string }) {
  const parsed = publicationReceiptSchema.safeParse(value);
  if (!parsed.success || expected.action === "approve" &&
    (parsed.data.publicationId !== expected.publicationId.toLowerCase() || parsed.data.status !== "approved")) return null;
  // A request replay can already be approved by the independent second reviewer.
  return parsed.data;
}
