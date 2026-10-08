import { z } from "zod";

import type { QuestionnaireFormKey } from "./types";

const receiptSchema = z.object({
  action: z.enum(["create", "revise"]),
  clientId: z.uuid(),
  formKey: z.string(),
  assessmentKey: z.uuid(),
  versionId: z.uuid(),
  version: z.number().int().positive(),
  recordState: z.literal("draft"),
  assessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  committedAt: z.iso.datetime({ offset: true }),
  replayed: z.boolean(),
}).strict();

export function parseQuestionnaireMutationReceipt(
  value: unknown,
  expected: {
    action: "create" | "revise";
    clientId: string;
    formKey: QuestionnaireFormKey;
    assessedOn: string;
    assessmentKey?: string;
    previousVersion?: number;
  },
) {
  const envelope = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const receipt = receiptSchema.safeParse(envelope?.data);
  if (!receipt.success || receipt.data.action !== expected.action ||
    receipt.data.clientId !== expected.clientId || receipt.data.formKey !== expected.formKey ||
    receipt.data.assessedOn !== expected.assessedOn ||
    receipt.data.version !== (expected.action === "create" ? 1 : (expected.previousVersion ?? 0) + 1) ||
    (expected.action === "revise" && receipt.data.assessmentKey !== expected.assessmentKey)) return null;
  return receipt.data;
}
