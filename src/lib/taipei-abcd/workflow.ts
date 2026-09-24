import { z } from "zod";
import { TAIPEI_SECTIONS, type TaipeiForm } from "./catalog";
import type { TaipeiAnswers } from "./types";
export const TAIPEI_WORKFLOW_LABELS = { draft: "草稿", submitted: "行政審核中", returned: "已退回待補", approved: "行政核准（非正式簽署）" } as const;
export const workflowEventSchema = z.object({ id: z.uuid(), sequence: z.number().int().positive(), action: z.enum(["submit", "return", "approve", "correct"]),
  state: z.enum(["draft", "submitted", "returned", "approved"]), actorId: z.uuid(), actorName: z.string(), createdAt: z.iso.datetime({ offset: true }), reason: z.string(),
  checklist: z.record(z.string(), z.object({ confirmed: z.literal(true), pendingReason: z.string().nullable() })), correctionOf: z.uuid().nullable() });
export const workflowSchema = z.object({ state: z.enum(["draft", "submitted", "returned", "approved"]), sequence: z.number().int().min(0), events: z.array(workflowEventSchema),
  isElectronicSignature: z.literal(false), isOfficialComplete: z.literal(false) });
export type TaipeiWorkflow = z.infer<typeof workflowSchema>;
export type TaipeiChecklist = Record<string, { confirmed: boolean; pendingReason: string | null }>;
export const emptyWorkflow: TaipeiWorkflow = { state: "draft", sequence: 0, events: [], isElectronicSignature: false, isOfficialComplete: false };
export function sectionReviewItems(form: TaipeiForm, answers: TaipeiAnswers) {
  return TAIPEI_SECTIONS[form].map(section => ({ code: section.code, title: section.title,
    missing: section.fields.filter(field => !answers[field.key] || answers[field.key].state === "missing").length,
    unconfirmed: section.fields.filter(field => answers[field.key]?.state === "unconfirmed").length }));
}
export const transitionSchema = z.object({ clientId: z.uuid(), draftId: z.uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), expectedSequence: z.number().int().min(0),
  action: z.enum(["submit", "return", "approve", "correct"]), reason: z.string().trim().min(3).max(1000).regex(/^[^\u0000-\u001f\u007f]*$/),
  checklist: z.record(z.string(), z.object({ confirmed: z.literal(true), pendingReason: z.string().trim().min(3).max(1000).regex(/^[^\u0000-\u001f\u007f]*$/).nullable() }).strict()), idempotency_key: z.uuid() }).strict();
export const transitionReceiptSchema = z.object({ eventId: z.uuid(), draftId: z.uuid(), state: z.enum(["draft", "submitted", "returned", "approved"]), sequence: z.number().int().positive(),
  idempotencyKey: z.uuid(), replayed: z.boolean(), isElectronicSignature: z.literal(false) });
