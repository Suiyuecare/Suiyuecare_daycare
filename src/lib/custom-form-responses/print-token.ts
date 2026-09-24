import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CustomResponsePrintJob } from "./print-contract";

const tokenSchema = z.object({
  purpose: z.literal("custom_response_pdf.v1"), jobId: z.uuid(), actorId: z.uuid(), organizationId: z.uuid(), branchId: z.uuid(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u), issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
}).strict();
const purpose = "custom_response_pdf.v1";
function secret() {
  const value = process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("CUSTOM_PRINT_SIGNING_NOT_CONFIGURED");
  return value;
}
export function printTokenConfigured() { try { secret(); return true; } catch { return false; } }
function mac(encoded: string) { return createHmac("sha256", secret()).update(`${purpose}:${encoded}`).digest("base64url"); }
export function issuePrintToken(job: CustomResponsePrintJob, now = Date.now()) {
  const payload = tokenSchema.parse({ purpose, jobId: job.jobId, actorId: job.actorId, organizationId: job.organizationId, branchId: job.branchId,
    snapshotHash: job.snapshotHash, issuedAt: Math.floor(Date.parse(job.createdAt) / 1000), expiresAt: Math.floor(Date.parse(job.expiresAt) / 1000) });
  if (payload.expiresAt * 1000 <= now || payload.issuedAt * 1000 > now + 30_000 || payload.expiresAt - payload.issuedAt !== 300) throw new Error("CUSTOM_PRINT_EXPIRED");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${mac(encoded)}`;
}
export function verifyPrintToken(token: string, expected: Pick<CustomResponsePrintJob, "jobId" | "actorId" | "organizationId" | "branchId">, now = Date.now()) {
  secret();
  if (token.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) throw new Error("CUSTOM_PRINT_TOKEN_INVALID");
  const [encoded, supplied] = token.split(".");
  const signature = Buffer.from(mac(encoded)); const received = Buffer.from(supplied);
  if (signature.length !== received.length || !timingSafeEqual(signature, received)) throw new Error("CUSTOM_PRINT_TOKEN_INVALID");
  const parsed = tokenSchema.safeParse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  if (!parsed.success) throw new Error("CUSTOM_PRINT_TOKEN_INVALID");
  const value = parsed.data;
  if (Object.entries(expected).some(([key, expectedValue]) => value[key as keyof typeof expected] !== expectedValue)
    || value.expiresAt - value.issuedAt !== 300 || value.expiresAt * 1000 <= now || value.issuedAt * 1000 > now + 30_000) throw new Error("CUSTOM_PRINT_TOKEN_INVALID");
  return value;
}
