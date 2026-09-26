import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { parseRuleRetirementHistory, parseRuleRetirementReceipt, ruleRetirementInputSchema,
  ruleRetirementUuidSchema } from "./rule-retirement-contract";

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const other = uuid(4);
const operation = uuid(5);
const activation = uuid(9);
const hash = "b".repeat(64);
const stamp = "2026-09-26T04:00:00Z";
const later = "2026-09-26T04:01:00Z";
const requestInput = () => ({ action: "request" as const, formKey: "bsrs5" as const, catalogHash: hash,
  activationId: activation, requestId: null, effectiveThrough: "2026-10-01", reason: "停止使用舊版規則" });
const decisionInput = (action: "approve" | "withdraw" | "return") => ({ action, formKey: "bsrs5" as const,
  catalogHash: hash, activationId: activation, requestId: uuid(6), effectiveThrough: null,
  reason: action === "approve" ? null : "這筆申請需重新確認" });
const pending = (number = 6) => ({ requestId: uuid(number), activationId: activation, formKey: "bsrs5" as const,
  catalogHash: hash, effectiveThrough: "2026-10-01", reason: "停止使用舊版規則", requestedBy: scope.userId,
  byCurrentUser: true, requestedAt: stamp, status: "pending" as const, decision: null, retirement: null });
const receipt = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, formKey: "bsrs5" as const,
  catalogHash: hash, activationId: activation, eventId: uuid(7), operationId: operation, actorId: scope.userId,
  committedAt: stamp, action: "request", request: pending(), replayed: false });
const history = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, activationId: activation,
  formKey: "bsrs5" as const, catalogHash: hash, originalEffectiveTo: "2026-10-31", effectiveThrough: "2026-10-31",
  requests: [pending()], total: 1, nextCursor: null, generatedAt: later });
const decided = (action: "approve" | "withdraw" | "return") => {
  const author = action === "withdraw" ? scope.userId : other;
  const input = ruleRetirementInputSchema.parse(decisionInput(action));
  const request = { ...pending(), requestedBy: author, byCurrentUser: author === scope.userId,
    status: action === "approve" ? "approved" : action === "withdraw" ? "withdrawn" : "returned",
    decision: { eventId: uuid(8), action, actorId: scope.userId, byCurrentUser: true, reason: input.reason, createdAt: later },
    retirement: action === "approve" ? { retirementId: uuid(10), effectiveThrough: "2026-10-01", retiredAt: later } : null };
  return { input, receipt: { ...receipt(), eventId: uuid(8), committedAt: later, action, request } };
};
const historicalReturned = (number: number) => ({ ...decided("return").receipt.request, requestId: uuid(number) });

describe("strict seven-key retirement input, without client authority", () => {
  it("accepts exactly the frozen SQL seven keys", () => {
    expect(ruleRetirementInputSchema.parse(requestInput())).toEqual(requestInput());
    expect(Object.keys(ruleRetirementInputSchema.parse(requestInput()))).toHaveLength(7);
  });
  it.each(["action", "formKey", "catalogHash", "activationId", "requestId", "effectiveThrough", "reason"])(
    "requires key %s even when its value must be null", (field) => {
      const value: Record<string, unknown> = requestInput(); delete value[field];
      expect(ruleRetirementInputSchema.safeParse(value).success).toBe(false);
    },
  );
  it.each(["organizationId", "branchId", "actorId", "reviewerId", "challengeId", "manifest", "retirementId", "retiredAt",
    "status", "effectiveTo", "originalEffectiveTo", "requestHash", "activatedAt"])("rejects invented authority key %s", (field) => {
    expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), [field]: "override" }).success).toBe(false);
  });
  it.each(["activate", "retire", "publish", "delete", ""])("rejects unsupported action %s", (action) => {
    expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), action }).success).toBe(false);
  });
  it.each(["2026-02-30", "2026-02-29", "1999-12-31", "2200-01-01", "2026-1-02", "2026-10-01T00:00:00Z", null])(
    "rejects invalid proposed cutoff %s", (effectiveThrough) => {
      expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), effectiveThrough }).success).toBe(false);
    },
  );
  it("accepts leap dates and past dates without pretending to enforce current SQL authority", () => {
    expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), effectiveThrough: "2024-02-29" }).success).toBe(true);
  });
  it.each(["A".repeat(64), "b".repeat(63), "g".repeat(64), 123])("rejects malformed hash %s", (catalogHash) => {
    expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), catalogHash }).success).toBe(false);
  });
  it.each(["bad", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "a0000000-0000-9000-8000-000000000009", "a0000000-0000-4000-0000-000000000009", null])(
    "rejects activation and decision identities outside SQL UUID pattern %s", (identity) => {
      expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), activationId: identity }).success).toBe(false);
      expect(ruleRetirementInputSchema.safeParse({ ...decisionInput("approve"), requestId: identity }).success).toBe(false);
    },
  );
  it("normalizes UUID case, not hashes, reasons or dates", () => {
    expect(ruleRetirementUuidSchema.parse(operation.toUpperCase())).toBe(operation);
    expect(ruleRetirementInputSchema.parse({ ...decisionInput("return"), requestId: uuid(6).toUpperCase(),
      activationId: activation.toUpperCase() }).requestId).toBe(uuid(6));
  });
  it.each([null, "短", " 前後不留空白 ", "<script>bad</script>", "理由有換行\n字", "理由有\u007f控制字", "a".repeat(1001)])(
    "requires bounded, nonmarkup reason for request and nonapproval decisions", (reason) => {
      for (const input of [requestInput(), decisionInput("withdraw"), decisionInput("return")]) {
        expect(ruleRetirementInputSchema.safeParse({ ...input, reason }).success).toBe(false);
      }
    },
  );
  it("counts PostgreSQL text length by Unicode code points without changing the reason", () => {
    const reason = "😀".repeat(1000);
    expect(ruleRetirementInputSchema.parse({ ...requestInput(), reason }).reason).toBe(reason);
    expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), reason: `${reason}😀` }).success).toBe(false);
  });
  it.each(["approve", "withdraw", "return"] as const)("requires null proposed cutoff on %s", (action) => {
    expect(ruleRetirementInputSchema.safeParse({ ...decisionInput(action), effectiveThrough: "2026-10-01" }).success).toBe(false);
  });
  it("requires approval null reason and request null requestId", () => {
    expect(ruleRetirementInputSchema.safeParse({ ...decisionInput("approve"), reason: "不應有核准理由" }).success).toBe(false);
    expect(ruleRetirementInputSchema.safeParse({ ...requestInput(), requestId: uuid(6) }).success).toBe(false);
  });
});

describe("correlated immutable retirement operation receipts", () => {
  it("accepts a request and its original replay snapshot, never fabricating a cutoff", () => {
    expect(parseRuleRetirementReceipt(receipt(), scope, requestInput(), operation).request.retirement).toBeNull();
    expect(parseRuleRetirementReceipt({ ...receipt(), replayed: true }, scope, requestInput(), operation).replayed).toBe(true);
    const originalInput = { ...requestInput(), effectiveThrough: "2024-02-29" };
    const original = { ...receipt(), replayed: true, committedAt: "2024-02-01T00:00:00Z",
      request: { ...pending(), effectiveThrough: originalInput.effectiveThrough, requestedAt: "2024-02-01T00:00:00Z" } };
    expect(parseRuleRetirementReceipt(original, scope, originalInput, operation).request.status).toBe("pending");
  });
  it.each(["approve", "withdraw", "return"] as const)("accepts faithful %s and replay evidence", (action) => {
    const value = decided(action);
    expect(parseRuleRetirementReceipt(value.receipt, scope, value.input, operation).request.retirement !== null).toBe(action === "approve");
    expect(parseRuleRetirementReceipt({ ...value.receipt, replayed: true }, scope, value.input, operation).replayed).toBe(true);
  });
  it("normalizes database UUIDs and authoritative UUID inputs before binding", () => {
    const value = receipt();
    const upper = { ...value, organizationId: value.organizationId.toUpperCase(), branchId: value.branchId.toUpperCase(),
      actorId: value.actorId.toUpperCase(), operationId: value.operationId.toUpperCase(), eventId: value.eventId.toUpperCase(),
      activationId: activation.toUpperCase(), request: { ...value.request, requestId: value.request.requestId.toUpperCase(),
        activationId: activation.toUpperCase(), requestedBy: value.request.requestedBy.toUpperCase() } };
    const upperScope = { organizationId: scope.organizationId.toUpperCase(), branchId: scope.branchId.toUpperCase(), userId: scope.userId.toUpperCase() };
    expect(parseRuleRetirementReceipt(upper, upperScope, { ...requestInput(), activationId: activation.toUpperCase() }, operation.toUpperCase())).toEqual(value);
  });
  it.each(["organizationId", "branchId", "actorId", "operationId", "activationId"])("rejects wrong receipt %s", (field) => {
    expect(() => parseRuleRetirementReceipt({ ...receipt(), [field]: uuid(99) }, scope, requestInput(), operation)).toThrow();
  });
  it.each(["form", "hash", "action", "requestActivation", "requestForm", "requestHash", "author", "flag", "cutoff", "reason", "commit"])(
    "rejects uncorrelated request receipt %s", (kind) => {
      const value = receipt();
      const malformed = kind === "form" ? { ...value, formKey: "spmsq" }
        : kind === "hash" ? { ...value, catalogHash: "c".repeat(64) }
        : kind === "action" ? { ...value, action: "approve" }
        : kind === "commit" ? { ...value, committedAt: later }
        : { ...value, request: { ...value.request,
          ...(kind === "requestActivation" ? { activationId: uuid(99) } : {}),
          ...(kind === "requestForm" ? { formKey: "spmsq" } : {}),
          ...(kind === "requestHash" ? { catalogHash: "c".repeat(64) } : {}),
          ...(kind === "author" ? { requestedBy: other, byCurrentUser: false } : {}),
          ...(kind === "flag" ? { byCurrentUser: false } : {}),
          ...(kind === "cutoff" ? { effectiveThrough: "2026-10-02" } : {}),
          ...(kind === "reason" ? { reason: "不同的申請理由" } : {}),
        } };
      expect(() => parseRuleRetirementReceipt(malformed, scope, requestInput(), operation)).toThrow();
    },
  );
  it.each(["receipt", "request", "decision", "retirement"])("rejects unknown fields in %s", (kind) => {
    const value = decided("approve");
    const malformed = kind === "receipt" ? { ...value.receipt, secretToken: "SYNTHETIC" }
      : { ...value.receipt, request: kind === "request" ? { ...value.receipt.request, originalEffectiveTo: null }
        : { ...value.receipt.request, [kind]: { ...value.receipt.request[kind as "decision" | "retirement"], secretToken: "SYNTHETIC" } } };
    expect(() => parseRuleRetirementReceipt(malformed, scope, value.input, operation)).toThrow();
  });
  it.each(["status", "pendingDecision", "pendingRetirement"])("rejects contradictory pending evidence %s", (kind) => {
    const value = receipt(); const approved = decided("approve").receipt.request;
    const malformed = { ...value, request: { ...value.request,
      ...(kind === "status" ? { status: "unknown" } : kind === "pendingDecision" ? { decision: approved.decision } : { retirement: approved.retirement }) } };
    expect(() => parseRuleRetirementReceipt(malformed, scope, requestInput(), operation)).toThrow();
  });
  it.each(["selfApproval", "decisionActor", "decisionFlag", "event", "requestId", "action", "reason", "early",
    "missingRetirement", "cutoff", "retiredAt", "commit"])("rejects malformed independent approval %s", (kind) => {
    const value = decided("approve"); const q = value.receipt.request;
    const malformed = { ...value.receipt, ...(kind === "event" ? { eventId: uuid(99) } : {}),
      ...(kind === "commit" ? { committedAt: stamp } : {}), request: { ...q,
        ...(kind === "selfApproval" ? { requestedBy: scope.userId, byCurrentUser: true } : {}),
        ...(kind === "requestId" ? { requestId: uuid(99) } : {}),
        decision: { ...q.decision,
          ...(kind === "decisionActor" ? { actorId: uuid(99), byCurrentUser: false } : {}),
          ...(kind === "decisionFlag" ? { byCurrentUser: false } : {}),
          ...(kind === "action" ? { action: "return" } : {}),
          ...(kind === "reason" ? { reason: "核准不應附帶理由" } : {}),
          ...(kind === "early" ? { createdAt: "2026-09-26T03:59:59Z" } : {}) },
        retirement: kind === "missingRetirement" ? null : { ...q.retirement,
          ...(kind === "cutoff" ? { effectiveThrough: "2026-10-02" } : {}),
          ...(kind === "retiredAt" ? { retiredAt: stamp } : {}) },
      } };
    expect(() => parseRuleRetirementReceipt(malformed, scope, value.input, operation)).toThrow();
  });
  it.each(["withdraw", "return"] as const)("requires correct actor relationship and no retirement for %s", (action) => {
    const value = decided(action); const q = value.receipt.request;
    const author = action === "withdraw" ? other : scope.userId;
    expect(() => parseRuleRetirementReceipt({ ...value.receipt, request: { ...q, requestedBy: author, byCurrentUser: author === scope.userId } }, scope, value.input, operation)).toThrow();
    expect(() => parseRuleRetirementReceipt({ ...value.receipt, request: { ...q, retirement: decided("approve").receipt.request.retirement } }, scope, value.input, operation)).toThrow();
    expect(() => parseRuleRetirementReceipt({ ...value.receipt, request: { ...q, decision: { ...q.decision, reason: "與送出內容不同" } } }, scope, value.input, operation)).toThrow();
  });
  it("matches equivalent offsets at exact PostgreSQL microsecond precision", () => {
    const value = receipt();
    const precise = { ...value, committedAt: "2026-09-26T12:00:00.123456+08:00",
      request: { ...value.request, requestedAt: "2026-09-26T04:00:00.123456Z" } };
    expect(parseRuleRetirementReceipt(precise, scope, requestInput(), operation).request.status).toBe("pending");
    expect(() => parseRuleRetirementReceipt({ ...precise, committedAt: "2026-09-26T04:00:00.123457Z" }, scope, requestInput(), operation)).toThrow();
  });
  it("does not collapse retirement, decision or request instants within one millisecond", () => {
    const value = decided("approve"); const q = value.receipt.request;
    const precise = { ...value.receipt, committedAt: "2026-09-26T04:01:00.123456Z", request: { ...q,
      decision: { ...q.decision, createdAt: "2026-09-26T12:01:00.123456+08:00" },
      retirement: { ...q.retirement, retiredAt: "2026-09-26T04:01:00.123456Z" } } };
    expect(parseRuleRetirementReceipt(precise, scope, value.input, operation).request.status).toBe("approved");
    expect(() => parseRuleRetirementReceipt({ ...precise, request: { ...precise.request,
      retirement: { ...precise.request.retirement, retiredAt: "2026-09-26T04:01:00.123455Z" } } }, scope, value.input, operation)).toThrow();
    const earlier = { ...precise, request: { ...precise.request, requestedAt: "2026-09-26T04:01:00.123457Z" } };
    expect(() => parseRuleRetirementReceipt(earlier, scope, value.input, operation)).toThrow();
  });
  it.each(["invalid", "infinity", "2026-09-26T04:00:00.1234567Z", "2026-09-26T04:00:00Z extra"])(
    "rejects timestamps not representable in returned native SQL JSON %s", (committedAt) => {
      expect(() => parseRuleRetirementReceipt({ ...receipt(), committedAt }, scope, requestInput(), operation)).toThrow();
    },
  );
});

describe("bounded scoped retirement history and original-versus-derived cutoff", () => {
  it("preserves the original end and does not promote a pending proposal to a cutoff", () => {
    const parsed = parseRuleRetirementHistory(history(), scope, activation, null);
    expect(parsed.originalEffectiveTo).toBe("2026-10-31"); expect(parsed.effectiveThrough).toBe("2026-10-31");
    expect(parsed.requests[0].effectiveThrough).toBe("2026-10-01"); expect(parsed.requests[0].retirement).toBeNull();
  });
  it("distinguishes an unbounded original end from an approved derived cap", () => {
    expect(parseRuleRetirementHistory({ ...history(), originalEffectiveTo: null, effectiveThrough: null }, scope, activation, null).effectiveThrough).toBeNull();
    const approved = decided("approve").receipt.request;
    expect(parseRuleRetirementHistory({ ...history(), originalEffectiveTo: null, effectiveThrough: approved.effectiveThrough,
      requests: [approved] }, scope, activation, null).originalEffectiveTo).toBeNull();
  });
  it("does not invent a missing approval on a bounded page", () => {
    const value = { ...history(), originalEffectiveTo: null, effectiveThrough: "2026-10-02", requests: [], total: 21 };
    expect(parseRuleRetirementHistory(value, scope, activation, null).requests).toEqual([]);
  });
  it("requires a visible approval to match the derived cap", () => {
    const approved = decided("approve").receipt.request;
    expect(parseRuleRetirementHistory({ ...history(), effectiveThrough: approved.effectiveThrough, requests: [approved] }, scope, activation, null).requests[0].status).toBe("approved");
    expect(() => parseRuleRetirementHistory({ ...history(), requests: [approved] }, scope, activation, null)).toThrow();
  });
  it("rejects a fabricated cutoff when all history is visible without approval", () => {
    expect(() => parseRuleRetirementHistory({ ...history(), effectiveThrough: pending().effectiveThrough }, scope, activation, null)).toThrow();
    expect(() => parseRuleRetirementHistory({ ...history(), originalEffectiveTo: null, effectiveThrough: "2026-10-01", requests: [], total: 0 }, scope, activation, null)).toThrow();
  });
  it("rejects multiple pending proposals or a pending proposal after approval", () => {
    expect(() => parseRuleRetirementHistory({ ...history(), requests: [pending(7), pending(6)], total: 2 }, scope, activation, null)).toThrow();
    const approved = decided("approve").receipt.request;
    expect(() => parseRuleRetirementHistory({ ...history(), requests: [{ ...approved, requestId: uuid(7) }, pending(6)],
      total: 2, effectiveThrough: approved.effectiveThrough }, scope, activation, null)).toThrow();
  });
  it.each(["nullDerived", "extendedDerived", "equalProposal", "laterProposal", "duplicateApproval"])(
    "rejects impossible original-versus-derived evidence %s", (kind) => {
      const approved = decided("approve").receipt.request;
      const malformed = kind === "nullDerived" ? { ...history(), effectiveThrough: null }
        : kind === "extendedDerived" ? { ...history(), effectiveThrough: "2026-11-01" }
        : kind === "equalProposal" ? { ...history(), requests: [{ ...pending(), effectiveThrough: "2026-10-31" }] }
        : kind === "laterProposal" ? { ...history(), requests: [{ ...pending(), effectiveThrough: "2026-11-01" }] }
        : { ...history(), requests: [{ ...approved, requestId: uuid(8) }, { ...approved, requestId: uuid(7) }], effectiveThrough: approved.effectiveThrough, total: 2 };
      expect(() => parseRuleRetirementHistory(malformed, scope, activation, null)).toThrow();
    },
  );
  it("supports twenty rows and a cursor bound to the final row", () => {
    const requests = Array.from({ length: 20 }, (_, index) => historicalReturned(50 - index));
    const value = { ...history(), requests, total: 21, nextCursor: { createdAt: stamp, id: requests.at(-1)!.requestId } };
    expect(parseRuleRetirementHistory(value, scope, activation, null).requests).toHaveLength(20);
    expect(parseRuleRetirementHistory({ ...value, nextCursor: null }, scope, activation, null).nextCursor).toBeNull();
  });
  it.each(["org", "branch", "activation", "form", "hash", "requestActivation", "requestForm", "requestHash", "duplicate", "total", "unbounded", "ascending", "extra"])(
    "rejects invalid history binding/count/order %s", (kind) => {
      const value = history();
      const malformed = kind === "org" ? { ...value, organizationId: uuid(99) }
        : kind === "branch" ? { ...value, branchId: uuid(99) }
        : kind === "activation" ? { ...value, activationId: uuid(99) }
        : kind === "form" ? { ...value, formKey: "spmsq" }
        : kind === "hash" ? { ...value, catalogHash: "c".repeat(64) }
        : kind === "requestActivation" ? { ...value, requests: [{ ...pending(), activationId: uuid(99) }] }
        : kind === "requestForm" ? { ...value, requests: [{ ...pending(), formKey: "spmsq" }] }
        : kind === "requestHash" ? { ...value, requests: [{ ...pending(), catalogHash: "c".repeat(64) }] }
        : kind === "duplicate" ? { ...value, requests: [pending(), pending()], total: 2 }
        : kind === "total" ? { ...value, total: 0 }
        : kind === "unbounded" ? { ...value, requests: Array.from({ length: 21 }, (_, index) => historicalReturned(50 - index)), total: 21 }
        : kind === "ascending" ? { ...value, requests: [historicalReturned(6), historicalReturned(7)], total: 2 }
        : { ...value, catalogManifest: {} };
      expect(() => parseRuleRetirementHistory(malformed, scope, activation, null)).toThrow();
    },
  );
  it.each([-1, 1.5, 2147483648, Number.NaN, "1"])("rejects non-SQL integer total %s", (total) => {
    expect(() => parseRuleRetirementHistory({ ...history(), total }, scope, activation, null)).toThrow();
  });
  it.each(["short", "time", "id", "noMore", "extra"])("rejects malformed continuation %s", (kind) => {
    const requests = Array.from({ length: 20 }, (_, index) => historicalReturned(50 - index));
    const value = { ...history(), requests: kind === "short" ? requests.slice(0, 19) : requests,
      total: kind === "noMore" ? 20 : 21, nextCursor: { createdAt: kind === "time" ? later : stamp,
        id: kind === "id" ? uuid(99) : requests.at(-1)!.requestId, ...(kind === "extra" ? { offset: 20 } : {}) } };
    expect(() => parseRuleRetirementHistory(value, scope, activation, null)).toThrow();
  });
  it("checks and normalizes supplied cursors independently of database output", () => {
    expect(parseRuleRetirementHistory(history(), scope, activation.toUpperCase(), { createdAt: stamp, id: uuid(7).toUpperCase() }).requests).toHaveLength(1);
    expect(() => parseRuleRetirementHistory(history(), scope, activation, { createdAt: stamp, id: uuid(6) })).toThrow();
    expect(() => parseRuleRetirementHistory(history(), scope, activation, { createdAt: "invalid", id: uuid(7) })).toThrow();
    expect(() => parseRuleRetirementHistory(history(), scope, activation, { createdAt: later, id: "invalid" })).toThrow();
  });
  it("orders different microseconds before UUIDs and respects equivalent offsets", () => {
    const newer = { ...historicalReturned(6), requestedAt: "2026-09-26T04:00:00.123456Z" };
    const older = { ...historicalReturned(7), requestedAt: "2026-09-26T12:00:00.123455+08:00" };
    const value = { ...history(), requests: [newer, older], total: 2 };
    expect(parseRuleRetirementHistory(value, scope, activation, null).requests).toHaveLength(2);
    expect(() => parseRuleRetirementHistory({ ...value, requests: [older, newer] }, scope, activation, null)).toThrow();
    expect(parseRuleRetirementHistory({ ...history(), requests: [older] }, scope, activation,
      { createdAt: newer.requestedAt, id: newer.requestId }).requests).toHaveLength(1);
  });
  it("requires continuation to match the exact final microsecond", () => {
    const requests = Array.from({ length: 20 }, (_, index) => ({ ...historicalReturned(50 - index), requestedAt: "2026-09-26T04:00:00.123456Z" }));
    const value = { ...history(), requests, total: 21,
      nextCursor: { createdAt: "2026-09-26T12:00:00.123456+08:00", id: requests.at(-1)!.requestId } };
    expect(parseRuleRetirementHistory(value, scope, activation, null).requests).toHaveLength(20);
    expect(() => parseRuleRetirementHistory({ ...value, nextCursor: { ...value.nextCursor, createdAt: "2026-09-26T04:00:00.123457Z" } }, scope, activation, null)).toThrow();
  });
});
