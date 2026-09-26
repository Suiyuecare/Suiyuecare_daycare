import { z } from "zod";

export const ruleReviewFormKeySchema = z.enum([
  "spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing",
  "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf",
]);
export const ruleReviewUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.iso.date().refine((value) => value >= "2000-01-01" && value <= "2199-12-31");
const timestamp = z.iso.datetime({ offset: true });
const reason = z.string().min(5).max(1000).refine((value) => value === value.trim() && !/[<>\u0000-\u001f\u007f]/u.test(value));
const action = z.enum(["request", "approve", "withdraw", "return"]);

const commonInput = {
  formKey: ruleReviewFormKeySchema,
  catalogHash: hash,
};
export const ruleReviewInputSchema = z.discriminatedUnion("action", [
  z.object({ ...commonInput, action: z.literal("request"), requestId: z.null(),
    effectiveFrom: date, effectiveTo: date.nullable(), reason: z.null() }).strict(),
  z.object({ ...commonInput, action: z.literal("approve"), requestId: ruleReviewUuidSchema,
    effectiveFrom: z.null(), effectiveTo: z.null(), reason: z.null() }).strict(),
  z.object({ ...commonInput, action: z.enum(["withdraw", "return"]), requestId: ruleReviewUuidSchema,
    effectiveFrom: z.null(), effectiveTo: z.null(), reason }).strict(),
]).superRefine((value, context) => {
  if (value.action === "request" && value.effectiveTo !== null && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", message: "Invalid effective period", path: ["effectiveTo"] });
  }
});

const decisionSchema = z.object({ eventId: ruleReviewUuidSchema,
  action: z.enum(["approve", "withdraw", "return"]), actorId: ruleReviewUuidSchema,
  byCurrentUser: z.boolean(), reason: reason.nullable(), createdAt: timestamp }).strict();
const activationSchema = z.object({ activationId: ruleReviewUuidSchema, catalogHash: hash,
  effectiveFrom: date, effectiveTo: date.nullable(), activatedAt: timestamp }).strict();
const requestSchema = z.object({ requestId: ruleReviewUuidSchema, formKey: ruleReviewFormKeySchema,
  catalogHash: hash, effectiveFrom: date, effectiveTo: date.nullable(), requestedBy: ruleReviewUuidSchema,
  byCurrentUser: z.boolean(), requestedAt: timestamp,
  status: z.enum(["pending", "approved", "withdrawn", "returned"]),
  decision: decisionSchema.nullable(), activation: activationSchema.nullable(),
}).strict();
const receiptSchema = z.object({ organizationId: ruleReviewUuidSchema, branchId: ruleReviewUuidSchema,
  formKey: ruleReviewFormKeySchema, catalogHash: hash, operationId: ruleReviewUuidSchema,
  actorId: ruleReviewUuidSchema, committedAt: timestamp, eventId: ruleReviewUuidSchema,
  action, request: requestSchema, replayed: z.boolean() }).strict();
const catalogSummarySchema = z.object({ formKey: ruleReviewFormKeySchema,
  formVersion: z.string().min(1).max(160), ruleVersion: z.string().min(1).max(160),
  ruleRevision: z.number().int().min(1).max(1000000), catalogHash: hash }).strict();
const cursorSchema = z.object({ createdAt: timestamp, id: ruleReviewUuidSchema }).strict();
const historySchema = z.object({ organizationId: ruleReviewUuidSchema, branchId: ruleReviewUuidSchema,
  formKey: ruleReviewFormKeySchema, catalogs: z.array(catalogSummarySchema).max(50),
  requests: z.array(requestSchema).max(20), total: z.number().int().nonnegative(),
  nextCursor: cursorSchema.nullable(), generatedAt: timestamp }).strict();

export type RuleReviewInput = z.infer<typeof ruleReviewInputSchema>;
export type RuleReviewRequest = z.infer<typeof requestSchema>;
export type RuleReviewReceipt = z.infer<typeof receiptSchema>;
export type RuleReviewHistory = z.infer<typeof historySchema>;
type Scope = { organizationId: string; branchId: string; userId: string };

function instant(value: string): bigint {
  // PostgreSQL cursors have microsecond precision. Date.parse alone truncates
  // them to milliseconds and can invert same-millisecond UUID tie breakers.
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(value)?.[1] ?? "";
  if (fraction.length > 9) throw new Error("Unsupported timestamp precision");
  const remainder = fraction.padEnd(9, "0").slice(3);
  return BigInt(Date.parse(value)) * BigInt(1000000) + BigInt(remainder);
}

function assertRequest(request: RuleReviewRequest, formKey: string, userId: string) {
  if (request.formKey !== formKey || request.byCurrentUser !== (request.requestedBy === userId) ||
    (request.effectiveTo !== null && request.effectiveTo < request.effectiveFrom)) throw new Error("Invalid request scope");
  const { decision, activation } = request;
  if (request.status === "pending") {
    if (decision !== null || activation !== null) throw new Error("Invalid pending decision");
    return;
  }
  if (!decision || decision.byCurrentUser !== (decision.actorId === userId) ||
    instant(decision.createdAt) < instant(request.requestedAt)) throw new Error("Invalid decision evidence");
  if (request.status === "approved") {
    if (decision.action !== "approve" || decision.reason !== null || decision.actorId === request.requestedBy ||
      !activation || activation.catalogHash !== request.catalogHash || activation.effectiveFrom !== request.effectiveFrom ||
      activation.effectiveTo !== request.effectiveTo || instant(activation.activatedAt) !== instant(decision.createdAt)) {
      throw new Error("Invalid independent activation evidence");
    }
  } else if (activation !== null || decision.action !== (request.status === "withdrawn" ? "withdraw" : "return") ||
    decision.reason === null || (decision.action === "withdraw" ? decision.actorId !== request.requestedBy : decision.actorId === request.requestedBy)) {
    throw new Error("Invalid withdrawal or return evidence");
  }
}

export function parseRuleReviewReceipt(value: unknown, scope: Scope, input: RuleReviewInput, operationId: string) {
  const receipt = receiptSchema.parse(value);
  if (receipt.organizationId !== scope.organizationId || receipt.branchId !== scope.branchId ||
    receipt.actorId !== scope.userId || receipt.operationId !== operationId || receipt.formKey !== input.formKey ||
    receipt.catalogHash !== input.catalogHash || receipt.action !== input.action || receipt.request.catalogHash !== input.catalogHash ||
    (input.action !== "request" && receipt.request.requestId !== input.requestId)) throw new Error("Uncorrelated rule receipt");
  assertRequest(receipt.request, input.formKey, scope.userId);
  if (input.action === "request") {
    if (receipt.request.requestedBy !== scope.userId || receipt.request.status !== "pending" ||
      receipt.request.effectiveFrom !== input.effectiveFrom || receipt.request.effectiveTo !== input.effectiveTo ||
      instant(receipt.committedAt) !== instant(receipt.request.requestedAt)) throw new Error("Uncorrelated rule request");
  } else if (receipt.request.decision?.eventId !== receipt.eventId || receipt.request.decision.actorId !== scope.userId ||
    receipt.request.decision.action !== input.action || receipt.request.decision.reason !== input.reason ||
    instant(receipt.committedAt) !== instant(receipt.request.decision.createdAt)) throw new Error("Uncorrelated rule decision");
  return receipt;
}

export function parseRuleReviewHistory(value: unknown, scope: Scope, formKey: string, before: z.infer<typeof cursorSchema> | null) {
  const history = historySchema.parse(value);
  if (history.organizationId !== scope.organizationId || history.branchId !== scope.branchId || history.formKey !== formKey ||
    history.total < history.requests.length || new Set(history.requests.map((entry) => entry.requestId)).size !== history.requests.length ||
    new Set(history.catalogs.map((entry) => entry.catalogHash)).size !== history.catalogs.length ||
    history.catalogs.some((entry) => entry.formKey !== formKey)) throw new Error("Invalid rule history scope or count");
  let previous = before;
  for (const entry of history.requests) {
    assertRequest(entry, formKey, scope.userId);
    const current = { createdAt: entry.requestedAt, id: entry.requestId };
    if (previous && (instant(current.createdAt) > instant(previous.createdAt) ||
      (instant(current.createdAt) === instant(previous.createdAt) && current.id >= previous.id))) throw new Error("Invalid history ordering");
    previous = current;
  }
  if (history.nextCursor !== null && (history.requests.length !== 20 || !previous ||
    instant(history.nextCursor.createdAt) !== instant(previous.createdAt) || history.nextCursor.id !== previous.id ||
    history.total <= history.requests.length)) throw new Error("Invalid history continuation");
  return history;
}
