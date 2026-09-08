import { z } from "zod";

const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u);
const base = {
  requestId: z.string().uuid(),
  status: z.literal("ok"),
  errors: z.array(z.never()).length(0),
};
const challenge = z.object({
  ...base,
  data: z.discriminatedUnion("demo", [
    z.object({ challengeId: z.string().uuid(), nonce: z.literal("demo"), expiresAt: timestamp, demo: z.literal(true) }).strict(),
    z.object({ challengeId: z.string().uuid(), nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u), expiresAt: timestamp, demo: z.literal(false) }).strict(),
  ]),
}).strict();
const completion = z.object({
  ...base,
  data: z.object({ recorded: z.literal(true), demo: z.boolean() }).strict(),
}).strict();

export class ReauthClientContractError extends Error {
  constructor() {
    super("安全驗證回覆不完整；請重新登入後再試。");
    this.name = "ReauthClientContractError";
  }
}

export function parseReauthChallengeEnvelope(raw: unknown, httpStatus: number) {
  const parsed = challenge.safeParse(raw);
  if (!parsed.success || httpStatus !== 200) throw new ReauthClientContractError();
  return parsed.data;
}

export function parseReauthCompletionEnvelope(raw: unknown, httpStatus: number) {
  const parsed = completion.safeParse(raw);
  if (!parsed.success || httpStatus !== 200) throw new ReauthClientContractError();
  return parsed.data;
}
