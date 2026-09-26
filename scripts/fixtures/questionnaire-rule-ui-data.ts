// In-memory fake HTTP response factory. Its catalog is the real checked-in
// source, but no fixture receipt represents a database or human approval.
import { createHash } from "node:crypto";
import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import {
  parseRuleReviewHistory, parseRuleReviewReceipt, ruleReviewFormKeySchema,
  ruleReviewInputSchema, ruleReviewUuidSchema,
  type RuleReviewRequest,
} from "@/lib/questionnaire-assessments/rule-review-contract";
import {
  parseRuleRetirementHistory, parseRuleRetirementReceipt, ruleRetirementInputSchema,
  type RuleRetirementRequest,
} from "@/lib/questionnaire-assessments/rule-retirement-shared";

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const otherActor = uuid(4);
type Mode = "normal" | "lost-ack" | "invalid-receipt" | "read-fail" | "timeout";
type Seed = "empty" | "self" | "other" | "approved";
const clone = <T,>(value: T): T => structuredClone(value);

export function createSyntheticRuleFixture(modeValue: string | null, seedValue: string | null) {
  const mode: Mode = ["lost-ack", "invalid-receipt", "read-fail", "timeout"].includes(modeValue ?? "") ? modeValue as Mode : "normal";
  const seed: Seed = ["self", "other", "approved"].includes(seedValue ?? "") ? seedValue as Seed : "empty";
  const reviewRows = new Map<string, RuleReviewRequest[]>();
  const retirementRows = new Map<string, RuleRetirementRequest[]>();
  const operations = new Map<string, { body: string; kind: string; receipt: unknown }>();
  let sequence = 100;
  let time = 0;
  let firstWrite = true;
  let failNextRead = false;
  const events: Record<string, unknown>[] = [];
  const stamp = () => new Date(Date.UTC(2026, 8, 26, 4, 0, time++)).toISOString().replace(".000Z", ".123456Z");
  const id = () => uuid(sequence++);
  const catalog = (formKey: string) => {
    const value = buildQuestionnaireRuleCatalogEntry(ruleReviewFormKeySchema.parse(formKey));
    return { ...value, registered: true, adoptionRequired: true as const };
  };

  for (const formKey of ruleReviewFormKeySchema.options) {
    const candidate = catalog(formKey);
    const requestedAt = stamp();
    const decisionAt = stamp();
    const request: RuleReviewRequest = {
      requestId: id(), formKey, catalogHash: candidate.catalogHash, effectiveFrom: "2026-09-26", effectiveTo: null,
      requestedBy: seed === "self" ? scope.userId : otherActor, byCurrentUser: seed === "self",
      requestedAt, status: seed === "approved" ? "approved" : "pending",
      decision: seed === "approved" ? { eventId: id(), action: "approve", actorId: scope.userId,
        byCurrentUser: true, reason: null, createdAt: decisionAt } : null,
      activation: seed === "approved" ? { activationId: id(), catalogHash: candidate.catalogHash,
        effectiveFrom: "2026-09-26", effectiveTo: null, activatedAt: decisionAt } : null,
    };
    reviewRows.set(formKey, seed === "empty" ? [] : [request]);
    if (request.activation) retirementRows.set(request.activation.activationId, []);
  }

  function envelope(data: unknown, status = 200) {
    return { status, body: { requestId: id(), status: "ok", data, errors: [] }, delayMs: 0 };
  }
  function denial(status: number, code: string) {
    return { status, body: { requestId: id(), status: "error", data: null,
      errors: [{ code, message: "Synthetic fixture failure; no real service was called." }] }, delayMs: 0 };
  }
  const findActivation = (activationId: string) => [...reviewRows.values()].flat()
    .find((request) => request.activation?.activationId === activationId);

  function read(kind: string, url: URL) {
    events.push({ type: "read", kind });
    if (failNextRead) { failNextRead = false; return denial(503, "FIXTURE_UNCONFIRMED"); }
    if (kind === "review") {
      const formKey = ruleReviewFormKeySchema.parse(url.searchParams.get("form_key"));
      const candidate = catalog(formKey);
      const requests = clone(reviewRows.get(formKey)!);
      const value = { organizationId: scope.organizationId, branchId: scope.branchId, formKey,
        catalogs: [{ formKey, formVersion: candidate.formVersion, ruleVersion: candidate.ruleVersion,
          ruleRevision: candidate.manifest.ruleRevision, catalogHash: candidate.catalogHash }],
        requests, total: requests.length, nextCursor: null, generatedAt: stamp() };
      parseRuleReviewHistory(value, scope, formKey, null);
      return envelope({ ...value, candidate });
    }
    const activationId = ruleReviewUuidSchema.parse(url.searchParams.get("activation_id"));
    const source = findActivation(activationId);
    if (!source?.activation) return denial(400, "FIXTURE_INVALID_ACTIVATION");
    const requests = clone(retirementRows.get(activationId)!);
    const approved = requests.find((request) => request.retirement)?.retirement;
    const value = { organizationId: scope.organizationId, branchId: scope.branchId,
      activationId, formKey: source.formKey, catalogHash: source.catalogHash,
      originalEffectiveTo: source.effectiveTo, effectiveThrough: approved?.effectiveThrough ?? source.effectiveTo,
      requests, total: requests.length, nextCursor: null, generatedAt: stamp() };
    parseRuleRetirementHistory(value, scope, activationId, null);
    return envelope(value);
  }

  function write(kind: string, raw: unknown, rawKey: string | undefined) {
    const operationId = ruleReviewUuidSchema.parse(rawKey);
    const input = kind === "review" ? ruleReviewInputSchema.parse(raw) : ruleRetirementInputSchema.parse(raw);
    const body = JSON.stringify(input);
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const previous = operations.get(operationId);
    if (previous) {
      if (previous.kind !== kind || previous.body !== body) return denial(409, "IDEMPOTENCY_CONFLICT");
      const receipt = { ...clone(previous.receipt) as Record<string, unknown>, replayed: true };
      events.push({ type: "write", kind, operationId, bodyHash, replayed: true, status: 201 });
      return envelope(receipt, 201);
    }
    if (catalog(input.formKey).catalogHash !== input.catalogHash) return denial(409, "FIXTURE_CATALOG_CONFLICT");
    const committedAt = stamp();
    const eventId = id();
    let request: RuleReviewRequest | RuleRetirementRequest;
    if (kind === "review") {
      const checked = ruleReviewInputSchema.parse(input);
      const rows = reviewRows.get(checked.formKey)!;
      if (checked.action === "request") {
        if (rows.some((row) => row.status === "pending")) return denial(409, "FIXTURE_PENDING_CONFLICT");
        request = { requestId: id(), formKey: checked.formKey, catalogHash: checked.catalogHash,
          effectiveFrom: checked.effectiveFrom, effectiveTo: checked.effectiveTo,
          requestedBy: scope.userId, byCurrentUser: true, requestedAt: committedAt,
          status: "pending", decision: null, activation: null };
        rows.unshift(request);
      } else {
        const existing = rows.find((row) => row.requestId === checked.requestId);
        if (!existing || existing.status !== "pending") return denial(409, "FIXTURE_DECISION_CONFLICT");
        if (checked.action === "withdraw" ? !existing.byCurrentUser : existing.byCurrentUser) return denial(403, "FIXTURE_INDEPENDENT_ACTOR_REQUIRED");
        existing.status = checked.action === "approve" ? "approved" : checked.action === "withdraw" ? "withdrawn" : "returned";
        existing.decision = { eventId, action: checked.action, actorId: scope.userId,
          byCurrentUser: true, reason: checked.reason, createdAt: committedAt };
        if (checked.action === "approve") {
          existing.activation = { activationId: id(), catalogHash: existing.catalogHash,
            effectiveFrom: existing.effectiveFrom, effectiveTo: existing.effectiveTo, activatedAt: committedAt };
          retirementRows.set(existing.activation.activationId, []);
        }
        request = existing;
      }
    } else {
      const checked = ruleRetirementInputSchema.parse(input);
      const source = findActivation(checked.activationId);
      if (!source?.activation || source.formKey !== checked.formKey || source.catalogHash !== checked.catalogHash) return denial(409, "FIXTURE_ACTIVATION_CONFLICT");
      const rows = retirementRows.get(checked.activationId)!;
      if (checked.action === "request") {
        if (rows.some((row) => row.status === "pending" || row.status === "approved")) return denial(409, "FIXTURE_RETIREMENT_CONFLICT");
        request = { requestId: id(), activationId: checked.activationId, formKey: checked.formKey,
          catalogHash: checked.catalogHash, effectiveThrough: checked.effectiveThrough, reason: checked.reason,
          requestedBy: scope.userId, byCurrentUser: true, requestedAt: committedAt,
          status: "pending", decision: null, retirement: null };
        rows.unshift(request);
      } else {
        const existing = rows.find((row) => row.requestId === checked.requestId);
        if (!existing || existing.status !== "pending") return denial(409, "FIXTURE_DECISION_CONFLICT");
        if (checked.action === "withdraw" ? !existing.byCurrentUser : existing.byCurrentUser) return denial(403, "FIXTURE_INDEPENDENT_ACTOR_REQUIRED");
        existing.status = checked.action === "approve" ? "approved" : checked.action === "withdraw" ? "withdrawn" : "returned";
        existing.decision = { eventId, action: checked.action, actorId: scope.userId,
          byCurrentUser: true, reason: checked.reason, createdAt: committedAt };
        if (checked.action === "approve") existing.retirement = {
          retirementId: id(), effectiveThrough: existing.effectiveThrough, retiredAt: committedAt,
        };
        request = existing;
      }
    }
    const receipt = { organizationId: scope.organizationId, branchId: scope.branchId,
      formKey: input.formKey, catalogHash: input.catalogHash, operationId, eventId,
      actorId: scope.userId, committedAt, action: input.action, request: clone(request), replayed: false,
      ...(kind === "retirement" ? { activationId: ruleRetirementInputSchema.parse(input).activationId } : {}) };
    if (kind === "review") parseRuleReviewReceipt(receipt, scope, ruleReviewInputSchema.parse(input), operationId);
    else parseRuleRetirementReceipt(receipt, scope, ruleRetirementInputSchema.parse(input), operationId);
    operations.set(operationId, { body, kind, receipt: clone(receipt) });
    const isFirst = firstWrite; firstWrite = false;
    if (isFirst && mode === "read-fail") failNextRead = true;
    const result = isFirst && mode === "lost-ack" ? denial(503, "FIXTURE_LOST_ACK")
      : envelope(isFirst && mode === "invalid-receipt" ? { ...receipt, actorId: otherActor } : receipt, 201);
    if (isFirst && mode === "timeout") result.delayMs = 22_000;
    events.push({ type: "write", kind, operationId, bodyHash, replayed: false, status: result.status,
      syntheticCommit: true, delayMs: result.delayMs });
    return result;
  }

  return { read, write, evidence: () => ({ syntheticOnly: true, mode, seed, scope,
    operations: operations.size, events: clone(events), provenance: "Real browser components and parsers; fake in-memory HTTP API, not real Auth/RLS/SQL." }) };
}

/** Contract checks, not browser, SQL, timeout, or independent-actor proof. */
export function verifySyntheticRuleFixtureContracts() {
  const assert = (valid: boolean) => { if (!valid) throw new Error("Synthetic fixture contract check failed"); };
  let scenarios = 0;
  let operation = 7000;
  const bodyData = (result: ReturnType<ReturnType<typeof createSyntheticRuleFixture>["read"]>) =>
    result.body.data as Record<string, unknown>;
  for (const formKey of ruleReviewFormKeySchema.options) {
    const candidate = buildQuestionnaireRuleCatalogEntry(formKey);
    const url = new URL(`http://127.0.0.1/api/questionnaire-rule-reviews?form_key=${formKey}`);
    const proposal = { action: "request", formKey, catalogHash: candidate.catalogHash, requestId: null,
      effectiveFrom: "2026-10-01", effectiveTo: null, reason: null };
    for (const mode of ["normal", "lost-ack", "invalid-receipt", "read-fail", "timeout"]) {
      const fixture = createSyntheticRuleFixture(mode, "empty");
      assert(fixture.read("review", url).status === 200);
      const key = uuid(operation++);
      const first = fixture.write("review", proposal, key);
      assert(first.status === (mode === "lost-ack" ? 503 : 201));
      assert(first.delayMs === (mode === "timeout" ? 22_000 : 0));
      if (mode === "invalid-receipt") {
        let denied = false;
        try { parseRuleReviewReceipt(first.body.data, scope, ruleReviewInputSchema.parse(proposal), key); }
        catch { denied = true; }
        assert(denied);
      }
      const replay = fixture.write("review", proposal, key);
      assert(replay.status === 201 && (replay.body.data as { replayed: boolean }).replayed);
      parseRuleReviewReceipt(replay.body.data, scope, ruleReviewInputSchema.parse(proposal), key);
      assert(fixture.evidence().operations === 1);
      assert(fixture.write("review", { ...proposal, effectiveTo: "2026-12-31" }, key).status === 409);
      if (mode === "read-fail") assert(fixture.read("review", url).status === 503);
      assert((bodyData(fixture.read("review", url)).requests as unknown[]).length === 1);
      scenarios++;
    }
    for (const action of ["approve", "withdraw", "return"] as const) {
      const fixture = createSyntheticRuleFixture("normal", action === "withdraw" ? "self" : "other");
      const request = (bodyData(fixture.read("review", url)).requests as RuleReviewRequest[])[0]!;
      const input = ruleReviewInputSchema.parse({ action, formKey, catalogHash: candidate.catalogHash,
        requestId: request.requestId, effectiveFrom: null, effectiveTo: null,
        reason: action === "approve" ? null : "本機合成資料測試理由" });
      const key = uuid(operation++);
      const result = fixture.write("review", input, key);
      assert(result.status === 201);
      parseRuleReviewReceipt(result.body.data, scope, input, key);
      assert(fixture.read("review", url).status === 200);
      scenarios++;
    }
    const fixture = createSyntheticRuleFixture("normal", "approved");
    const approved = (bodyData(fixture.read("review", url)).requests as RuleReviewRequest[])[0]!;
    const activationId = approved.activation!.activationId;
    const retireUrl = new URL(`http://127.0.0.1/api/questionnaire-rule-retirements?activation_id=${activationId}`);
    assert(fixture.read("retirement", retireUrl).status === 200);
    const input = ruleRetirementInputSchema.parse({ action: "request", formKey, catalogHash: candidate.catalogHash,
      activationId, requestId: null, effectiveThrough: "2026-10-01", reason: "本機合成退休測試理由" });
    const key = uuid(operation++);
    const result = fixture.write("retirement", input, key);
    assert(result.status === 201);
    const receipt = parseRuleRetirementReceipt(result.body.data, scope, input, key);
    assert(fixture.read("retirement", retireUrl).status === 200);
    const withdraw = ruleRetirementInputSchema.parse({ ...input, action: "withdraw", effectiveThrough: null,
      requestId: receipt.request.requestId, reason: "本機合成撤回測試理由" });
    const withdrawalKey = uuid(operation++);
    const withdrawal = fixture.write("retirement", withdraw, withdrawalKey);
    parseRuleRetirementReceipt(withdrawal.body.data, scope, withdraw, withdrawalKey);
    assert(fixture.read("retirement", retireUrl).status === 200);
    scenarios++;
  }
  return { syntheticContractScenarios: scenarios, formCount: ruleReviewFormKeySchema.options.length,
    notProofOf: ["browser rendering", "actual 20-second timeout", "Auth", "RLS", "native SQL", "human approval", "production"] };
}
