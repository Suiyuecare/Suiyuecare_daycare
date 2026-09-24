import { z } from "zod";
import type { RosterInput } from "./parser";

export const rosterReceiptSchema = z.object({
  id: z.uuid(), clientId: z.uuid(), serviceDate: z.iso.date(), shift: z.enum(["morning", "afternoon"]),
  version: z.number().int().positive().safe(), replayed: z.boolean(),
}).strict();
const successSchema = z.object({
  requestId: z.uuid(), status: z.literal("ok"), errors: z.array(z.never()).length(0),
  data: z.object({ receipt: rosterReceiptSchema, persisted: z.literal(true), demo: z.literal(false) }).strict(),
}).strict();
const errorSchema = z.object({
  requestId: z.uuid(), status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string(), message: z.string().trim().min(1).max(500)
    .regex(/^[^\u0000-\u001f\u007f]*$/), field: z.string().max(120).optional() }).strict()).min(1).max(20),
}).strict();
const definiteErrors: Record<number, readonly string[]> = {
  400: ["INVALID_ROSTER_ACTION", "INVALID_ROSTER", "INVALID_JSON", "ROSTER_REJECTED"],
  401: ["AUTH_REQUIRED"],
  403: ["ROSTER_FORBIDDEN", "DEMO_READ_ONLY", "AAL2_REQUIRED"],
  409: ["ROSTER_CONFLICT", "BRANCH_CONTEXT_REQUIRED"],
  413: ["REQUEST_TOO_LARGE"],
};
export function rosterReceiptMatches(value: unknown, input: RosterInput) {
  const parsed = rosterReceiptSchema.safeParse(value);
  return parsed.success && parsed.data.clientId === input.clientId && parsed.data.serviceDate === input.serviceDate
    && parsed.data.shift === input.shift && parsed.data.version === input.expectedVersion + 1 ? parsed.data : null;
}
export function parseRosterWriteOutcome(raw: unknown, status: number, input: RosterInput):
  { kind: "success"; replayed: boolean } | { kind: "rejected"; message: string; needsReload: boolean; needsReauth: boolean }
  | { kind: "unknown" } {
  const success = successSchema.safeParse(raw);
  if (success.success && rosterReceiptMatches(success.data.data.receipt, input)
    && status === (success.data.data.receipt.replayed ? 200 : 201)) {
    return { kind: "success", replayed: success.data.data.receipt.replayed };
  }
  const failure = errorSchema.safeParse(raw);
  if (failure.success && definiteErrors[status]?.includes(failure.data.errors[0].code)) {
    return { kind: "rejected", message: failure.data.errors[0].message, needsReload: status === 409,
      needsReauth: failure.data.errors[0].code === "AAL2_REQUIRED" };
  }
  return { kind: "unknown" };
}

export const ROSTER_RPC_TIMEOUT_MS = 10_000;
export async function boundedRosterRpc<T>(operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("ROSTER_RPC_TIMEOUT")); }, ROSTER_RPC_TIMEOUT_MS);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
