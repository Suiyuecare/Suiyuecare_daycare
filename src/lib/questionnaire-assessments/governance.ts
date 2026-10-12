import { z } from "zod";

export const questionnairePublicationInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), formKey: z.string(), formVersion: z.string().max(80),
    effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), evidenceReference: z.string().trim().min(1).max(300) }).strict()
    .refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
      { path: ["effectiveTo"], message: "終止日不可早於生效日。" }),
  z.object({ action: z.literal("approve"), publicationId: z.uuid() }).strict(),
]);

export const questionnaireGovernanceSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  catalogue: z.array(z.object({ formKey: z.string(), formVersion: z.string(), catalogHash: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string(), questionCount: z.number().int().positive(), sources: z.array(z.unknown()), rule: z.record(z.string(), z.unknown()),
  }).strict()).max(10),
  publications: z.array(z.object({ publicationId: z.string().uuid(), formKey: z.string(), formVersion: z.string(),
    effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().nullable(), evidenceReference: z.string(),
    requestedAt: z.iso.datetime({ offset: true }), requestedBy: z.string().uuid(), requestedName: z.string(),
    approvedAt: z.iso.datetime({ offset: true }).nullable(), approvedName: z.string().nullable(),
    canApprove: z.boolean(), status: z.enum(["pending", "approved"]),
  }).strict()).max(100),
}).strict();
export type QuestionnaireGovernanceSnapshot = z.infer<typeof questionnaireGovernanceSchema>;
