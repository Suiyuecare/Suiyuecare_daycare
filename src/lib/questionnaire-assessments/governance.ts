import { z } from "zod";

export const questionnaireGovernanceSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  catalogue: z.array(z.object({ formKey: z.string(), formVersion: z.string(), catalogHash: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string(), questionCount: z.number().int().positive(), sources: z.array(z.unknown()), rule: z.record(z.string(), z.unknown()),
  }).strict()).max(9),
  publications: z.array(z.object({ publicationId: z.string().uuid(), formKey: z.string(), formVersion: z.string(),
    effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().nullable(), evidenceReference: z.string(),
    requestedAt: z.iso.datetime({ offset: true }), requestedBy: z.string().uuid(), requestedName: z.string(),
    approvedAt: z.iso.datetime({ offset: true }).nullable(), approvedName: z.string().nullable(),
    canApprove: z.boolean(), status: z.enum(["pending", "approved"]),
  }).strict()).max(100),
}).strict();
export type QuestionnaireGovernanceSnapshot = z.infer<typeof questionnaireGovernanceSchema>;
