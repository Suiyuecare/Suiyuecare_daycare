import { z } from "zod";

import { ruleReviewFormKeySchema, ruleReviewUuidSchema } from "./rule-review-contract";

export const ruleRetirementFormKeySchema = ruleReviewFormKeySchema;
export const ruleRetirementUuidSchema = ruleReviewUuidSchema;
const inputIdentity = ruleRetirementUuidSchema.refine((value) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.iso.date().refine((value) => value >= "2000-01-01" && value <= "2199-12-31");
const timestamp = z.iso.datetime({ offset: true }).refine((value) =>
  Number.isFinite(Date.parse(value)) && (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(value)?.[1].length ?? 0) <= 6,
);
// PostgreSQL length(text) counts Unicode code points, and btrim(text) trims
// ordinary spaces. Preserve that contract rather than silently altering reasons.
const reason = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 5 && length <= 1000 && value === value.replace(/^ +| +$/gu, "") && !/[<>\u0000-\u001f\u007f]/u.test(value);
});
const action = z.enum(["request", "approve", "withdraw", "return"]);
const commonInput = { formKey: ruleRetirementFormKeySchema, catalogHash: hash, activationId: inputIdentity };

// Exactly the seven keys accepted by the frozen retirement SQL. Retirement is
// a separate immutable cutoff, never an update to an original rule activation.
export const ruleRetirementInputSchema = z.discriminatedUnion("action", [
  z.object({ ...commonInput, action: z.literal("request"), requestId: z.null(), effectiveThrough: date, reason }).strict(),
  z.object({ ...commonInput, action: z.literal("approve"), requestId: inputIdentity,
    effectiveThrough: z.null(), reason: z.null() }).strict(),
  z.object({ ...commonInput, action: z.enum(["withdraw", "return"]), requestId: inputIdentity,
    effectiveThrough: z.null(), reason }).strict(),
]);

const decisionSchema = z.object({ eventId: ruleRetirementUuidSchema, action: z.enum(["approve", "withdraw", "return"]),
  actorId: ruleRetirementUuidSchema, byCurrentUser: z.boolean(), reason: reason.nullable(), createdAt: timestamp }).strict();
const retirementSchema = z.object({ retirementId: ruleRetirementUuidSchema, effectiveThrough: date, retiredAt: timestamp }).strict();
const requestSchema = z.object({ requestId: ruleRetirementUuidSchema, activationId: ruleRetirementUuidSchema,
  formKey: ruleRetirementFormKeySchema, catalogHash: hash, effectiveThrough: date, reason,
  requestedBy: ruleRetirementUuidSchema, byCurrentUser: z.boolean(), requestedAt: timestamp,
  status: z.enum(["pending", "approved", "withdrawn", "returned"]),
  decision: decisionSchema.nullable(), retirement: retirementSchema.nullable() }).strict();
const receiptSchema = z.object({ organizationId: ruleRetirementUuidSchema, branchId: ruleRetirementUuidSchema,
  formKey: ruleRetirementFormKeySchema, catalogHash: hash, activationId: ruleRetirementUuidSchema,
  eventId: ruleRetirementUuidSchema, operationId: ruleRetirementUuidSchema, actorId: ruleRetirementUuidSchema,
  committedAt: timestamp, action, request: requestSchema, replayed: z.boolean() }).strict();
const cursorSchema = z.object({ createdAt: timestamp, id: ruleRetirementUuidSchema }).strict();
const historySchema = z.object({ organizationId: ruleRetirementUuidSchema, branchId: ruleRetirementUuidSchema,
  activationId: ruleRetirementUuidSchema, formKey: ruleRetirementFormKeySchema, catalogHash: hash,
  originalEffectiveTo: date.nullable(), effectiveThrough: date.nullable(), requests: z.array(requestSchema).max(20),
  total: z.number().int().min(0).max(2147483647), nextCursor: cursorSchema.nullable(), generatedAt: timestamp }).strict();

export type RuleRetirementInput = z.infer<typeof ruleRetirementInputSchema>;
export type RuleRetirementRequest = z.infer<typeof requestSchema>;
export type RuleRetirementReceipt = z.infer<typeof receiptSchema>;
export type RuleRetirementHistory = z.infer<typeof historySchema>;
export type RuleRetirementCursor = z.infer<typeof cursorSchema>;
type Scope = { organizationId: string; branchId: string; userId: string };
type Binding = { activationId: string; formKey: string; catalogHash: string };

function canonicalScope(scope: Scope): Scope {
  return { organizationId: ruleRetirementUuidSchema.parse(scope.organizationId),
    branchId: ruleRetirementUuidSchema.parse(scope.branchId), userId: ruleRetirementUuidSchema.parse(scope.userId) };
}

function instant(value: string): bigint {
  // Native PostgreSQL timestamps have microsecond precision. Millisecond-only
  // comparisons can accept the wrong receipt or invert cursor UUID tie breakers.
  const checked = timestamp.parse(value);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(checked)?.[1] ?? "";
  return BigInt(Date.parse(checked)) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3));
}

function assertRequest(request: RuleRetirementRequest, binding: Binding, userId: string) {
  if (request.activationId !== binding.activationId || request.formKey !== binding.formKey || request.catalogHash !== binding.catalogHash ||
    request.byCurrentUser !== (request.requestedBy === userId)) throw new Error("Invalid retirement request binding");
  const { decision, retirement } = request;
  if (request.status === "pending") {
    if (decision !== null || retirement !== null) throw new Error("Invalid pending retirement evidence");
    return;
  }
  if (!decision || decision.byCurrentUser !== (decision.actorId === userId) ||
    instant(decision.createdAt) < instant(request.requestedAt)) throw new Error("Invalid retirement decision evidence");
  if (request.status === "approved") {
    if (decision.action !== "approve" || decision.reason !== null || decision.actorId === request.requestedBy ||
      !retirement || retirement.effectiveThrough !== request.effectiveThrough ||
      instant(retirement.retiredAt) !== instant(decision.createdAt)) throw new Error("Invalid independent retirement evidence");
  } else if (retirement !== null || decision.action !== (request.status === "withdrawn" ? "withdraw" : "return") ||
    decision.reason === null || (decision.action === "withdraw" ? decision.actorId !== request.requestedBy : decision.actorId === request.requestedBy)) {
    throw new Error("Invalid retirement withdrawal or return evidence");
  }
}

export function parseRuleRetirementReceipt(value: unknown, scope: Scope, input: RuleRetirementInput, operationId: string): RuleRetirementReceipt {
  const authoritative = canonicalScope(scope);
  const submitted = ruleRetirementInputSchema.parse(input);
  const receipt = receiptSchema.parse(value);
  if (receipt.organizationId !== authoritative.organizationId || receipt.branchId !== authoritative.branchId ||
    receipt.actorId !== authoritative.userId || receipt.operationId !== ruleRetirementUuidSchema.parse(operationId) ||
    receipt.formKey !== submitted.formKey || receipt.catalogHash !== submitted.catalogHash || receipt.activationId !== submitted.activationId ||
    receipt.action !== submitted.action || (submitted.action !== "request" && receipt.request.requestId !== submitted.requestId)) {
    throw new Error("Uncorrelated retirement receipt");
  }
  assertRequest(receipt.request, submitted, authoritative.userId);
  if (submitted.action === "request") {
    if (receipt.request.requestedBy !== authoritative.userId || receipt.request.status !== "pending" ||
      receipt.request.effectiveThrough !== submitted.effectiveThrough || receipt.request.reason !== submitted.reason ||
      instant(receipt.committedAt) !== instant(receipt.request.requestedAt)) throw new Error("Uncorrelated retirement request");
  } else if (receipt.request.decision?.eventId !== receipt.eventId || receipt.request.decision.actorId !== authoritative.userId ||
    receipt.request.decision.action !== submitted.action || receipt.request.decision.reason !== submitted.reason ||
    instant(receipt.committedAt) !== instant(receipt.request.decision.createdAt)) throw new Error("Uncorrelated retirement decision");
  // A replay is the original immutable operation receipt, not today's history.
  // Do not use wall-clock time to rewrite it or infer currently active rules.
  return receipt;
}

export function parseRuleRetirementHistory(value: unknown, scope: Scope, activationId: string, before: RuleRetirementCursor | null): RuleRetirementHistory {
  const authoritative = canonicalScope(scope);
  const history = historySchema.parse(value);
  if (history.organizationId !== authoritative.organizationId || history.branchId !== authoritative.branchId ||
    history.activationId !== ruleRetirementUuidSchema.parse(activationId) || history.total < history.requests.length ||
    new Set(history.requests.map((entry) => entry.requestId)).size !== history.requests.length ||
    (history.originalEffectiveTo !== null && (history.effectiveThrough === null || history.effectiveThrough > history.originalEffectiveTo))) {
    throw new Error("Invalid retirement history scope or range");
  }
  let previous = before === null ? null : cursorSchema.parse(before);
  let approved: RuleRetirementRequest | null = null;
  let pendingCount = 0;
  for (const entry of history.requests) {
    assertRequest(entry, history, authoritative.userId);
    if (history.originalEffectiveTo !== null && entry.effectiveThrough >= history.originalEffectiveTo) throw new Error("Invalid retirement shortening");
    if (entry.status === "approved") {
      if (approved !== null) throw new Error("Duplicate approved retirement");
      approved = entry;
    }
    if (entry.status === "pending" && ++pendingCount > 1) throw new Error("Duplicate pending retirement");
    const current = { createdAt: entry.requestedAt, id: entry.requestId };
    if (previous && (instant(current.createdAt) > instant(previous.createdAt) ||
      (instant(current.createdAt) === instant(previous.createdAt) && current.id >= previous.id))) throw new Error("Invalid retirement history ordering");
    previous = current;
  }
  if (approved && pendingCount !== 0) throw new Error("Pending proposal after approved retirement");
  if (approved && history.effectiveThrough !== approved.effectiveThrough) throw new Error("Uncorrelated derived retirement cutoff");
  if (!approved && history.total === history.requests.length && history.effectiveThrough !== history.originalEffectiveTo) {
    throw new Error("Derived cutoff without an approved retirement");
  }
  if (history.nextCursor !== null && (history.requests.length !== 20 || !previous ||
    instant(history.nextCursor.createdAt) !== instant(previous.createdAt) || history.nextCursor.id !== previous.id ||
    history.total <= history.requests.length)) throw new Error("Invalid retirement history continuation");
  // An approved retirement can be outside this page. A nullable original end is
  // not evidence of no retirement, and a pending proposal never becomes a cutoff.
  return history;
}
