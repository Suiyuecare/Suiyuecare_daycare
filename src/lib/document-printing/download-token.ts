import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const DOCUMENT_ACCESS_TOKEN_TTL_SECONDS = 5 * 60;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const payloadSchema = z.object({
  version: z.literal(1),
  jobId: uuid,
  userId: uuid,
  mode: z.enum(["preview", "download"]),
  issuedAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();

type TokenPayload = z.output<typeof payloadSchema>;

function signingSecret() {
  const value = process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET?.trim() ?? "";
  return value.length >= 32 ? value : null;
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function documentAccessTokenConfigured() {
  return signingSecret() !== null;
}

export function issueDocumentAccessToken(input: {
  jobId: string;
  userId: string;
  mode: "preview" | "download";
  now?: Date;
}) {
  const secret = signingSecret();
  if (!secret) throw new Error("DOCUMENT_DOWNLOAD_SIGNING_NOT_CONFIGURED");
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const payload = payloadSchema.parse({
    version: 1,
    jobId: input.jobId,
    userId: input.userId,
    mode: input.mode,
    issuedAt,
    expiresAt: issuedAt + DOCUMENT_ACCESS_TOKEN_TTL_SECONDS,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyDocumentAccessToken(input: {
  token: string;
  expectedJobId: string;
  expectedUserId: string;
  expectedMode: "preview" | "download";
  now?: Date;
}): TokenPayload {
  const secret = signingSecret();
  if (!secret) throw new Error("DOCUMENT_DOWNLOAD_SIGNING_NOT_CONFIGURED");
  const [encoded, suppliedSignature, extra] = input.token.split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) {
    throw new Error("DOCUMENT_ACCESS_TOKEN_INVALID");
  }
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.byteLength !== expected.byteLength ||
    !timingSafeEqual(supplied, expected)) {
    throw new Error("DOCUMENT_ACCESS_TOKEN_INVALID");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("DOCUMENT_ACCESS_TOKEN_INVALID");
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("DOCUMENT_ACCESS_TOKEN_INVALID");
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const payload = parsed.data;
  if (payload.jobId !== input.expectedJobId.toLowerCase() ||
    payload.userId !== input.expectedUserId.toLowerCase() ||
    payload.mode !== input.expectedMode ||
    payload.expiresAt <= now || payload.issuedAt > now + 30 ||
    payload.expiresAt - payload.issuedAt !== DOCUMENT_ACCESS_TOKEN_TTL_SECONDS) {
    throw new Error("DOCUMENT_ACCESS_TOKEN_INVALID");
  }
  return payload;
}
