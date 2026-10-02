import { describe, expect, it } from "vitest";

import { parseRuleReviewHistory, parseRuleReviewReceipt, ruleReviewInputSchema, ruleReviewUuidSchema } from "./rule-review-contract";

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const otherUser = uuid(4);
const operationId = uuid(5);
const hash = "b".repeat(64);
const stamp = "2026-09-26T04:00:00Z";
const later = "2026-09-26T04:01:00Z";
const requestInput = () => ({ action: "request" as const, formKey: "bsrs5" as const, catalogHash: hash,
  requestId: null, effectiveFrom: "2026-09-27", effectiveTo: "2026-10-27", reason: null });
const decisionInput = (action: "approve" | "withdraw" | "return") => ({ action, formKey: "bsrs5" as const, catalogHash: hash,
  requestId: uuid(6), effectiveFrom: null, effectiveTo: null, reason: action === "approve" ? null : "資料內容需再次確認" });
const pending = (number = 6) => ({ requestId: uuid(number), formKey: "bsrs5" as const, catalogHash: hash,
  effectiveFrom: "2026-09-27", effectiveTo: "2026-10-27", requestedBy: scope.userId, byCurrentUser: true,
  requestedAt: stamp, status: "pending" as const, decision: null, activation: null });
const catalog = (number = 1) => ({ formKey: "bsrs5" as const, formVersion: "bsrs5-zh-tw-v1", ruleVersion: "bsrs5-zh-tw-v2",
  ruleRevision: 2, catalogHash: number.toString(16).padStart(64, "0") });
const history = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, formKey: "bsrs5",
  catalogs: [catalog()], requests: [pending()], total: 1, nextCursor: null, generatedAt: later });
const receipt = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, formKey: "bsrs5", catalogHash: hash,
  operationId, actorId: scope.userId, committedAt: stamp, eventId: uuid(7), action: "request", request: pending(), replayed: false });
const decided = (action: "approve" | "withdraw" | "return") => {
  const requestedBy = action === "withdraw" ? scope.userId : otherUser;
  const input = ruleReviewInputSchema.parse(decisionInput(action));
  const request = { ...pending(), requestedBy, byCurrentUser: requestedBy === scope.userId,
    status: action === "approve" ? "approved" : action === "withdraw" ? "withdrawn" : "returned",
    decision: { eventId: uuid(8), action, actorId: scope.userId, byCurrentUser: true, reason: input.reason, createdAt: later },
    activation: action === "approve" ? { activationId: uuid(9), catalogHash: hash, effectiveFrom: "2026-09-27",
      effectiveTo: "2026-10-27", activatedAt: later } : null };
  return { input, receipt: { ...receipt(), eventId: uuid(8), action, request, committedAt: later } };
};

describe("strict rule-review inputs, no client authority", () => {
  it.each(["manifest", "reviewerId", "actorId", "organizationId", "branchId", "activatedAt", "status", "ruleVersion", "requestHash"])(
    "rejects client-supplied %s", (field) => expect(ruleReviewInputSchema.safeParse({ ...requestInput(), [field]: "override" }).success).toBe(false),
  );
  it.each(["activate", "sign", "publish", ""])("rejects unsupported action %s", (action) => {
    expect(ruleReviewInputSchema.safeParse({ ...requestInput(), action }).success).toBe(false);
  });
  it.each(["2026-02-30", "2026-02-29", "1999-12-31", "2200-01-01", "2026-9-27", "2026-09-00"])("rejects invalid effective date %s", (effectiveFrom) => {
    expect(ruleReviewInputSchema.safeParse({ ...requestInput(), effectiveFrom }).success).toBe(false);
  });
  it("accepts leap dates and unbounded end, but never a reversed period", () => {
    expect(ruleReviewInputSchema.safeParse({ ...requestInput(), effectiveFrom: "2024-02-29", effectiveTo: null }).success).toBe(true);
    expect(ruleReviewInputSchema.safeParse({ ...requestInput(), effectiveTo: "2026-09-26" }).success).toBe(false);
  });
  it.each(["A".repeat(64), "b".repeat(63), "g".repeat(64), 123])("rejects malformed catalog hash %s", (catalogHash) => {
    expect(ruleReviewInputSchema.safeParse({ ...requestInput(), catalogHash }).success).toBe(false);
  });
  it.each(["短", " 有五字但前後空白 ", "<script>bad</script>", "理由有換行\n字", "a".repeat(1001)])("rejects invalid decision reason", (reason) => {
    expect(ruleReviewInputSchema.safeParse({ ...decisionInput("return"), reason }).success).toBe(false);
  });
  it.each(["approve", "withdraw", "return"] as const)("rejects fabricated request dates for %s", (action) => {
    expect(ruleReviewInputSchema.safeParse({ ...decisionInput(action), effectiveFrom: "2026-09-27" }).success).toBe(false);
  });
  it("requires null reason on approval and request, and a stable UUID on decisions", () => {
    expect(ruleReviewInputSchema.safeParse({ ...decisionInput("approve"), reason: "自行核准此規則" }).success).toBe(false);
    expect(ruleReviewInputSchema.safeParse({ ...requestInput(), requestId: uuid(6) }).success).toBe(false);
    expect(ruleReviewInputSchema.safeParse({ ...decisionInput("approve"), requestId: null }).success).toBe(false);
  });
  it("normalizes uppercase decision UUIDs, never the catalog hash", () => {
    expect(ruleReviewUuidSchema.parse(operationId.toUpperCase())).toBe(operationId);
    expect(ruleReviewInputSchema.parse({ ...decisionInput("approve"), requestId: uuid(6).toUpperCase() }).requestId).toBe(uuid(6));
  });
});

describe("scoped immutable rule-review receipts", () => {
  it("accepts a correlated request and exact replay with no activation", () => {
    expect(parseRuleReviewReceipt(receipt(), scope, requestInput(), operationId).request.activation).toBeNull();
    expect(parseRuleReviewReceipt({ ...receipt(), replayed: true }, scope, requestInput(), operationId).replayed).toBe(true);
  });
  it.each(["approve", "withdraw", "return"] as const)("accepts properly independent %s evidence", (action) => {
    const value = decided(action);
    const parsed = parseRuleReviewReceipt(value.receipt, scope, value.input, operationId);
    expect(parsed.request.status).toBe(action === "approve" ? "approved" : action === "withdraw" ? "withdrawn" : "returned");
    expect(parsed.request.activation !== null).toBe(action === "approve");
  });
  it("normalizes every UUID returned by the database before correlation", () => {
    const value = receipt();
    const uppercase = { ...value, organizationId: value.organizationId.toUpperCase(), branchId: value.branchId.toUpperCase(),
      actorId: value.actorId.toUpperCase(), operationId: value.operationId.toUpperCase(), eventId: value.eventId.toUpperCase(),
      request: { ...value.request, requestId: value.request.requestId.toUpperCase(), requestedBy: value.request.requestedBy.toUpperCase() } };
    expect(parseRuleReviewReceipt(uppercase, scope, requestInput(), operationId)).toEqual(value);
  });
  it("correlates equivalent timestamp offsets without losing PostgreSQL microseconds", () => {
    const value = receipt();
    const precise = { ...value, committedAt: "2026-09-26T12:00:00.123456+08:00",
      request: { ...value.request, requestedAt: "2026-09-26T04:00:00.123456Z" } };
    expect(parseRuleReviewReceipt(precise, scope, requestInput(), operationId).request.status).toBe("pending");
    expect(() => parseRuleReviewReceipt({ ...precise, committedAt: "2026-09-26T04:00:00.123457Z" }, scope, requestInput(), operationId)).toThrow();
  });
  it("requires exact activation and decision instants even within one millisecond", () => {
    const value = decided("approve"); const request = value.receipt.request;
    const precise = { ...value.receipt, committedAt: "2026-09-26T04:01:00.123456Z", request: { ...request,
      decision: { ...request.decision, createdAt: "2026-09-26T12:01:00.123456+08:00" },
      activation: { ...request.activation, activatedAt: "2026-09-26T04:01:00.123456Z" } } };
    expect(parseRuleReviewReceipt(precise, scope, value.input, operationId).request.status).toBe("approved");
    expect(() => parseRuleReviewReceipt({ ...precise, request: { ...precise.request,
      activation: { ...precise.request.activation, activatedAt: "2026-09-26T04:01:00.123457Z" } } }, scope, value.input, operationId)).toThrow();
    expect(() => parseRuleReviewReceipt({ ...precise, committedAt: "2026-09-26T04:01:00.123455Z" }, scope, value.input, operationId)).toThrow();
  });
  it("rejects a decision one microsecond earlier than its request", () => {
    const value = decided("approve"); const request = value.receipt.request;
    const precise = { ...value.receipt, committedAt: "2026-09-26T04:00:00.123455Z", request: { ...request,
      requestedAt: "2026-09-26T04:00:00.123456Z", decision: { ...request.decision, createdAt: "2026-09-26T04:00:00.123455Z" },
      activation: { ...request.activation, activatedAt: "2026-09-26T04:00:00.123455Z" } } };
    expect(() => parseRuleReviewReceipt(precise, scope, value.input, operationId)).toThrow();
  });
  it.each(["organizationId", "branchId", "actorId", "operationId"])("rejects incorrect authoritative %s", (field) => {
    expect(() => parseRuleReviewReceipt({ ...receipt(), [field]: uuid(99) }, scope, requestInput(), operationId)).toThrow();
  });
  it.each(["form", "hash", "action", "requestHash", "requestForm", "byUser", "requestedBy", "date", "end", "commit", "extra"])("rejects uncorrelated %s request receipt", (kind) => {
    const value = receipt();
    const malformed = kind === "form" ? { ...value, formKey: "spmsq" }
      : kind === "hash" ? { ...value, catalogHash: "c".repeat(64) }
      : kind === "action" ? { ...value, action: "approve" }
      : kind === "requestHash" ? { ...value, request: { ...value.request, catalogHash: "c".repeat(64) } }
      : kind === "requestForm" ? { ...value, request: { ...value.request, formKey: "spmsq" } }
      : kind === "byUser" ? { ...value, request: { ...value.request, byCurrentUser: false } }
      : kind === "requestedBy" ? { ...value, request: { ...value.request, requestedBy: otherUser, byCurrentUser: false } }
      : kind === "date" ? { ...value, request: { ...value.request, effectiveFrom: "2026-09-28" } }
      : kind === "end" ? { ...value, request: { ...value.request, effectiveTo: null } }
      : kind === "commit" ? { ...value, committedAt: later }
      : { ...value, secretToken: "not-a-valid-receipt" };
    expect(() => parseRuleReviewReceipt(malformed, scope, requestInput(), operationId)).toThrow();
  });
  it.each(["status", "pendingDecision", "pendingActivation"])("rejects inconsistent %s", (kind) => {
    const value = receipt(); const approved = decided("approve").receipt.request;
    const malformed = { ...value, request: { ...value.request,
      ...(kind === "status" ? { status: "unknown" } : kind === "pendingDecision" ? { decision: approved.decision } : { activation: approved.activation }) } };
    expect(() => parseRuleReviewReceipt(malformed, scope, requestInput(), operationId)).toThrow();
  });
  it.each(["selfApprove", "decisionFlag", "event", "action", "reason", "earlyDecision", "missingActivation", "hash", "date", "end", "activationStamp", "commit", "requestId"])(
    "rejects invalid independent approval %s", (kind) => {
      const value = decided("approve"); const request = value.receipt.request;
      const malformed = { ...value.receipt,
        ...(kind === "event" ? { eventId: uuid(99) } : {}),
        ...(kind === "commit" ? { committedAt: stamp } : {}),
        request: { ...request,
          ...(kind === "selfApprove" ? { requestedBy: scope.userId, byCurrentUser: true } : {}),
          ...(kind === "requestId" ? { requestId: uuid(99) } : {}),
          decision: { ...request.decision,
            ...(kind === "decisionFlag" ? { byCurrentUser: false } : {}),
            ...(kind === "action" ? { action: "return" } : {}),
            ...(kind === "reason" ? { reason: "不應攜帶核准理由" } : {}),
            ...(kind === "earlyDecision" ? { createdAt: "2026-09-26T03:59:59Z" } : {}) },
          activation: kind === "missingActivation" ? null : { ...request.activation,
            ...(kind === "hash" ? { catalogHash: "c".repeat(64) } : {}),
            ...(kind === "date" ? { effectiveFrom: "2026-09-28" } : {}),
            ...(kind === "end" ? { effectiveTo: null } : {}),
            ...(kind === "activationStamp" ? { activatedAt: stamp } : {}) },
        } };
      expect(() => parseRuleReviewReceipt(malformed, scope, value.input, operationId)).toThrow();
    },
  );
  it.each(["withdraw", "return"] as const)("rejects incorrect actor relationship and activation on %s", (action) => {
    const value = decided(action);
    const wrongAuthor = action === "withdraw" ? otherUser : scope.userId;
    expect(() => parseRuleReviewReceipt({ ...value.receipt, request: { ...value.receipt.request, requestedBy: wrongAuthor,
      byCurrentUser: wrongAuthor === scope.userId } }, scope, value.input, operationId)).toThrow();
    expect(() => parseRuleReviewReceipt({ ...value.receipt, request: { ...value.receipt.request,
      activation: decided("approve").receipt.request.activation } }, scope, value.input, operationId)).toThrow();
  });
});

describe("bounded scoped rule-review history", () => {
  it("accepts a valid history without altering pending state or installing an activation", () => {
    expect(parseRuleReviewHistory(history(), scope, "bsrs5", null).requests[0].activation).toBeNull();
  });
  it("supports exactly twenty rows and a cursor bound to the final row", () => {
    const requests = Array.from({ length: 20 }, (_, index) => pending(50 - index));
    const value = { ...history(), requests, total: 21, nextCursor: { createdAt: stamp, id: requests.at(-1)!.requestId } };
    expect(parseRuleReviewHistory(value, scope, "bsrs5", null).requests).toHaveLength(20);
  });
  it("allows fifty distinct server catalog entries but never fifty-one", () => {
    const value = { ...history(), catalogs: Array.from({ length: 50 }, (_, index) => catalog(index + 1)) };
    expect(parseRuleReviewHistory(value, scope, "bsrs5", null).catalogs).toHaveLength(50);
    expect(() => parseRuleReviewHistory({ ...value, catalogs: [...value.catalogs, catalog(51)] }, scope, "bsrs5", null)).toThrow();
  });
  it.each(["org", "branch", "form", "total", "duplicateRequest", "duplicateCatalog", "catalogForm", "unbounded", "ascending", "extra"])("rejects invalid history %s", (kind) => {
    const value = history();
    const malformed = kind === "org" ? { ...value, organizationId: uuid(99) }
      : kind === "branch" ? { ...value, branchId: uuid(99) }
      : kind === "form" ? { ...value, formKey: "spmsq" }
      : kind === "total" ? { ...value, total: 0 }
      : kind === "duplicateRequest" ? { ...value, requests: [pending(), pending()], total: 2 }
      : kind === "duplicateCatalog" ? { ...value, catalogs: [catalog(), catalog()] }
      : kind === "catalogForm" ? { ...value, catalogs: [{ ...catalog(), formKey: "spmsq" }] }
      : kind === "unbounded" ? { ...value, requests: Array.from({ length: 21 }, (_, index) => pending(50 - index)), total: 21 }
      : kind === "ascending" ? { ...value, requests: [pending(6), pending(7)], total: 2 }
      : { ...value, sourceManifest: {} };
    expect(() => parseRuleReviewHistory(malformed, scope, "bsrs5", null)).toThrow();
  });
  it.each(["short", "wrongTime", "wrongId", "noMore"])("rejects malformed continuation %s", (kind) => {
    const requests = Array.from({ length: 20 }, (_, index) => pending(50 - index));
    const value = { ...history(), requests: kind === "short" ? requests.slice(0, 19) : requests, total: kind === "noMore" ? 20 : 21,
      nextCursor: { createdAt: kind === "wrongTime" ? later : stamp, id: kind === "wrongId" ? uuid(99) : requests.at(-1)!.requestId } };
    expect(() => parseRuleReviewHistory(value, scope, "bsrs5", null)).toThrow();
  });
  it("enforces both timestamp and UUID ordering relative to the supplied cursor", () => {
    expect(parseRuleReviewHistory(history(), scope, "bsrs5", { createdAt: later, id: uuid(1) }).requests).toHaveLength(1);
    expect(parseRuleReviewHistory(history(), scope, "bsrs5", { createdAt: stamp, id: uuid(7) }).requests).toHaveLength(1);
    expect(() => parseRuleReviewHistory(history(), scope, "bsrs5", { createdAt: stamp, id: uuid(6) })).toThrow();
    expect(() => parseRuleReviewHistory(history(), scope, "bsrs5", { createdAt: "2026-09-26T03:59:59Z", id: uuid(99) })).toThrow();
  });
  it("orders different microseconds before UUIDs and rejects a true microsecond reversal", () => {
    const newer = { ...pending(6), requestedAt: "2026-09-26T04:00:00.123456Z" };
    const olderWithLargerUuid = { ...pending(7), requestedAt: "2026-09-26T12:00:00.123455+08:00" };
    const value = { ...history(), requests: [newer, olderWithLargerUuid], total: 2 };
    expect(parseRuleReviewHistory(value, scope, "bsrs5", null).requests).toHaveLength(2);
    expect(() => parseRuleReviewHistory({ ...value, requests: [olderWithLargerUuid, newer] }, scope, "bsrs5", null)).toThrow();
    expect(parseRuleReviewHistory({ ...history(), requests: [olderWithLargerUuid] }, scope, "bsrs5",
      { createdAt: newer.requestedAt, id: newer.requestId }).requests).toHaveLength(1);
  });
  it("requires an exact microsecond continuation timestamp", () => {
    const requests = Array.from({ length: 20 }, (_, index) => ({ ...pending(50 - index), requestedAt: "2026-09-26T04:00:00.123456Z" }));
    const value = { ...history(), requests, total: 21,
      nextCursor: { createdAt: "2026-09-26T12:00:00.123456+08:00", id: requests.at(-1)!.requestId } };
    expect(parseRuleReviewHistory(value, scope, "bsrs5", null).requests).toHaveLength(20);
    expect(() => parseRuleReviewHistory({ ...value, nextCursor: { ...value.nextCursor, createdAt: "2026-09-26T04:00:00.123457Z" } }, scope, "bsrs5", null)).toThrow();
  });
});
