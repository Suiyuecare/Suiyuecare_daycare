import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";
import { responseRecordSchema, type ResponseRecord } from "./contract";

const label = z.string().min(1).max(500).refine((v) => !/[\u0000-\u001f\u007f]/u.test(v));
export const printSnapshotSchema = z.object({
  response: responseRecordSchema,
  organizationName: label, branchName: label, clientCode: label, clientName: label,
  formName: label, formKey: z.string().regex(/^tenant\.custom\.[a-z][a-z0-9_]{1,59}$/u),
  formVersion: z.number().int().positive(), preparedByName: label,
}).strict();
export type CustomResponsePrintSnapshot = z.infer<typeof printSnapshotSchema>;
export const printJobSchema = z.object({
  jobId: z.uuid(), responseId: z.uuid(), clientId: z.uuid(), actorId: z.uuid(),
  organizationId: z.uuid(), branchId: z.uuid(), createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  snapshot: printSnapshotSchema, replayed: z.boolean(),
}).strict().refine((job) => job.clientId === job.snapshot.response.clientId && job.responseId === job.snapshot.response.id)
  .refine((job) => Date.parse(job.expiresAt) - Date.parse(job.createdAt) === 300_000);
export type CustomResponsePrintJob = z.infer<typeof printJobSchema>;
export const printRequestSchema = z.object({ clientId: z.uuid(), responseId: z.uuid() }).strict();
export type PrintRequest = z.infer<typeof printRequestSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") return JSON.stringify(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return JSON.stringify(value);
}
export function parsePrintJob(value: unknown, expected: Partial<Pick<CustomResponsePrintJob, "jobId" | "organizationId" | "branchId" | "clientId" | "responseId" | "actorId" | "snapshotHash">>, record?: ResponseRecord) {
  const result = printJobSchema.safeParse(value);
  if (!result.success || Object.entries(expected).some(([key, expectedValue]) => result.data[key as keyof typeof expected] !== expectedValue)
    || (record && canonical(result.data.snapshot.response) !== canonical(record))) {
    throw new IntegrationError("CUSTOM_PRINT_UNCERTAIN", "列印快照與所選紀錄版本不一致，請以原操作重新核對。", 409);
  }
  return result.data;
}
