import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import { readRuleRetirement, readRuleReview, RuleGovernanceClientError, writeRuleGovernance } from "./rule-governance-client";
import { ruleReviewInputSchema } from "./rule-review-contract";
import { ruleRetirementInputSchema } from "./rule-retirement-shared";
import type { QuestionnaireFormKey } from "./types";

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const key = uuid(5);
const activation = uuid(9);
const stamp = "2026-09-26T04:00:00.123456Z";
const later = "2026-09-26T04:01:00.123456Z";
const fetchMock = vi.fn<typeof fetch>();
const proposal = (formKey: QuestionnaireFormKey = "bsrs5") => ({ ...buildQuestionnaireRuleCatalogEntry(formKey), registered: true, adoptionRequired: true });
const reviewInput = () => ({ formKey: "bsrs5" as const, catalogHash: proposal().catalogHash, action: "request" as const,
  requestId: null, effectiveFrom: "2026-10-01", effectiveTo: null, reason: null });
const reviewRequest = () => ({ requestId: uuid(6), formKey: "bsrs5", catalogHash: proposal().catalogHash,
  effectiveFrom: "2026-10-01", effectiveTo: null, requestedBy: scope.userId, byCurrentUser: true,
  requestedAt: stamp, status: "pending", decision: null, activation: null });
const reviewHistory = (formKey: QuestionnaireFormKey = "bsrs5") => {
  const candidate = proposal(formKey);
  return { organizationId: scope.organizationId, branchId: scope.branchId, formKey,
    catalogs: [{ formKey, formVersion: candidate.formVersion, ruleVersion: candidate.ruleVersion,
      ruleRevision: candidate.manifest.ruleRevision, catalogHash: candidate.catalogHash }], requests: [], total: 0, nextCursor: null,
    generatedAt: later, candidate };
};
const reviewReceipt = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, formKey: "bsrs5",
  catalogHash: proposal().catalogHash, operationId: key, actorId: scope.userId, committedAt: stamp, eventId: uuid(7),
  action: "request", request: reviewRequest(), replayed: false });
const retirementInput = () => ({ formKey: "bsrs5" as const, catalogHash: proposal().catalogHash, activationId: activation,
  action: "request" as const, requestId: null, effectiveThrough: "2026-10-01", reason: "停止使用舊版規則" });
const retirementRequest = () => ({ requestId: uuid(6), formKey: "bsrs5", catalogHash: proposal().catalogHash,
  activationId: activation, effectiveThrough: "2026-10-01", reason: "停止使用舊版規則", requestedBy: scope.userId,
  byCurrentUser: true, requestedAt: stamp, status: "pending", decision: null, retirement: null });
const retirementHistory = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, activationId: activation,
  formKey: "bsrs5", catalogHash: proposal().catalogHash, originalEffectiveTo: null, effectiveThrough: null,
  requests: [retirementRequest()], total: 1, nextCursor: null, generatedAt: later });
const retirementReceipt = () => ({ organizationId: scope.organizationId, branchId: scope.branchId, activationId: activation,
  formKey: "bsrs5", catalogHash: proposal().catalogHash, operationId: key, actorId: scope.userId, committedAt: stamp,
  eventId: uuid(7), action: "request", request: retirementRequest(), replayed: false });
function governanceDecision(kind: "review" | "retirement", action: "approve" | "withdraw" | "return") {
  const requestedBy = action === "withdraw" ? scope.userId : uuid(4);
  const reason = action === "approve" ? null : "這筆申請需要再次確認";
  const evidence = { eventId: uuid(8), action, actorId: scope.userId, byCurrentUser: true, reason, createdAt: later };
  const status = action === "approve" ? "approved" : action === "withdraw" ? "withdrawn" : "returned";
  if (kind === "review") {
    const input = ruleReviewInputSchema.parse({ ...reviewInput(), action, requestId: uuid(6), effectiveFrom: null, effectiveTo: null, reason });
    const receipt = { ...reviewReceipt(), action, eventId: uuid(8), committedAt: later, request: { ...reviewRequest(),
      requestedBy, byCurrentUser: requestedBy === scope.userId, status, decision: evidence,
      activation: action === "approve" ? { activationId: activation, catalogHash: proposal().catalogHash,
        effectiveFrom: "2026-10-01", effectiveTo: null, activatedAt: later } : null } };
    return { input, receipt };
  }
  const input = ruleRetirementInputSchema.parse({ ...retirementInput(), action, requestId: uuid(6), effectiveThrough: null, reason });
  const receipt = { ...retirementReceipt(), action, eventId: uuid(8), committedAt: later, request: { ...retirementRequest(),
    requestedBy, byCurrentUser: requestedBy === scope.userId, status, decision: evidence,
    retirement: action === "approve" ? { retirementId: uuid(10), effectiveThrough: "2026-10-01", retiredAt: later } : null } };
  return { input, receipt };
}
function response(data: unknown, status = 200) {
  return Response.json({ requestId: uuid(11), status: "ok", data, errors: [] }, { status, headers: { "cache-control": "private, no-store, max-age=0" } });
}
function denial(status: number, code = "SYNTHETIC", message = "SECRET service_role password") {
  return Response.json({ requestId: uuid(11), status: "error", data: null, errors: [{ code, message }] }, {
    status, headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
async function expectError(operation: Promise<unknown>, kind: string, retry = false) {
  const error = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(RuleGovernanceClientError);
  expect(error).toMatchObject({ kind });
  expect((error as Error).message).not.toMatch(/SECRET|service_role|password|synthetic backend/u);
  if (retry) expect((error as Error).message).toContain("相同操作識別碼");
  return error;
}
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("browser-safe contract sharing without server dependencies", () => {
  it("preserves the server-only entry and moves parser implementation to pure shared code", () => {
    const server = readFileSync("src/lib/questionnaire-assessments/rule-retirement-contract.ts", "utf8");
    expect(server).toBe('import "server-only";\n\nexport * from "./rule-retirement-shared";\n');
    const shared = readFileSync("src/lib/questionnaire-assessments/rule-retirement-shared.ts", "utf8");
    expect(shared).not.toMatch(/server-only|node:|process\.env|createHash/u);
    expect(shared).toContain("export function parseRuleRetirementReceipt");
  });
  it("keeps the complete browser runtime import graph free of server-only and Node modules", () => {
    const visited = new Set<string>();
    function visit(path: string) {
      if (visited.has(path)) return; visited.add(path);
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/import\s+["']server-only|from\s+["']node:|require\(/u);
      for (const match of source.matchAll(/import\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];/gu)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) visit(resolve(path, "..", `${specifier}.ts`));
        else if (specifier.startsWith("@/")) visit(resolve("src", `${specifier.slice(2)}.ts`));
      }
    }
    visit(resolve("src/lib/questionnaire-assessments/rule-governance-client.ts"));
    expect(visited.size).toBeGreaterThan(4);
  });
});

describe("strict browser review reads and SHA-256 catalog evidence", () => {
  it.each(Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[])("verifies the real checked-in %s manifest with browser SHA-256", async (formKey) => {
    const value = reviewHistory(formKey); fetchMock.mockResolvedValue(response(value));
    const parsed = await readRuleReview(scope, formKey);
    expect(parsed.candidate.catalogHash).toBe(value.candidate.catalogHash);
    expect(parsed.candidate.metadata).toEqual({ title: QUESTIONNAIRE_FORMS[formKey].title,
      sourceLabel: QUESTIONNAIRE_FORMS[formKey].sourceLabel, sourceUrl: QUESTIONNAIRE_FORMS[formKey].sourceUrl ?? null,
      questionCount: QUESTIONNAIRE_FORMS[formKey].questions.length });
    expect(parsed.candidate.registered).toBe(true); expect(parsed.candidate.adoptionRequired).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`/api/questionnaire-rule-reviews?form_key=${formKey}`,
      expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("reports an actually unregistered candidate without inventing adoption", async () => {
    const value = reviewHistory(); fetchMock.mockResolvedValue(response({ ...value, catalogs: [], candidate: { ...value.candidate, registered: false } }));
    const parsed = await readRuleReview(scope, "bsrs5"); expect(parsed.candidate.registered).toBe(false); expect(parsed.candidate.adoptionRequired).toBe(true);
  });
  it.each(["organization", "branch", "userFlag", "historyExtra", "candidateExtra", "hash", "form", "version", "ruleVersion",
    "registrationLie", "registrationType", "catalogVersion", "adoption", "canonicalSpacing", "canonicalMismatch", "unknownManifest"])(
    "rejects unverified candidate/history %s", async (kind) => {
      const value = reviewHistory();
      const malformed = kind === "organization" ? { ...value, organizationId: uuid(99) }
        : kind === "branch" ? { ...value, branchId: uuid(99) }
        : kind === "userFlag" ? { ...value, requests: [{ ...reviewRequest(), byCurrentUser: false }], total: 1 }
        : kind === "historyExtra" ? { ...value, actorId: uuid(99) }
        : kind === "catalogVersion" ? { ...value, catalogs: [{ ...value.catalogs[0], ruleVersion: "incorrect-v1" }] }
        : { ...value, candidate: { ...value.candidate,
          ...(kind === "candidateExtra" ? { token: "SECRET" } : {}),
          ...(kind === "hash" ? { catalogHash: "c".repeat(64) } : {}),
          ...(kind === "form" ? { formKey: "spmsq" } : {}),
          ...(kind === "version" ? { formVersion: "incorrect-v1" } : {}),
          ...(kind === "ruleVersion" ? { ruleVersion: "incorrect-v1" } : {}),
          ...(kind === "registrationLie" ? { registered: false } : {}),
          ...(kind === "registrationType" ? { registered: "true" } : {}),
          ...(kind === "adoption" ? { adoptionRequired: false } : {}),
          ...(kind === "canonicalSpacing" ? { canonicalJson: ` ${value.candidate.canonicalJson}` } : {}),
          ...(kind === "canonicalMismatch" ? { manifest: { ...value.candidate.manifest, ruleRevision: 999 } } : {}),
          ...(kind === "unknownManifest" ? { manifest: { ...value.candidate.manifest, approvedBy: uuid(99) } } : {}),
        } };
      fetchMock.mockResolvedValue(response(malformed)); await expectError(readRuleReview(scope, "bsrs5"), "unconfirmed");
    },
  );
  it("rejects a self-rehashed change to local questions or source even if all byte hashes are consistent", async () => {
    const value = reviewHistory(); const manifest = { ...value.candidate.manifest, form: { ...value.candidate.manifest.form, title: "SECRET forged title" } };
    const canonicalJson = canonicalRuleJson(manifest); const catalogHash = createHash("sha256").update(canonicalJson).digest("hex");
    const candidate = { ...value.candidate, manifest: JSON.parse(canonicalJson), canonicalJson, catalogHash, registered: false };
    fetchMock.mockResolvedValue(response({ ...value, catalogs: [], candidate }));
    await expectError(readRuleReview(scope, "bsrs5"), "unconfirmed");
  });
  it("detects a genuinely incorrect SHA-256 even when the canonical manifest is internally consistent", async () => {
    const value = reviewHistory(); fetchMock.mockResolvedValue(response({ ...value, catalogs: [], candidate: { ...value.candidate, registered: false, catalogHash: "0".repeat(64) } }));
    await expectError(readRuleReview(scope, "bsrs5"), "unconfirmed");
  });
  it("does not replace missing browser WebCrypto with a server-only hash implementation", async () => {
    vi.stubGlobal("crypto", undefined); fetchMock.mockResolvedValue(response(reviewHistory()));
    await expectError(readRuleReview(scope, "bsrs5"), "unconfirmed");
  });
});

describe("native precision cursors and retirement scope", () => {
  it("preserves microseconds, timezone offsets and canonical cursor UUIDs", async () => {
    fetchMock.mockResolvedValue(response(reviewHistory()));
    const before = { createdAt: "2026-09-26T12:00:30.123456+08:00", id: uuid(20).toUpperCase() };
    await readRuleReview(scope, "bsrs5", before);
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "https://daycare.example");
    expect(url.searchParams.get("before_created_at")).toBe(before.createdAt); expect(url.searchParams.get("before_id")).toBe(uuid(20));
    fetchMock.mockResolvedValue(response(retirementHistory()));
    const parsed = await readRuleRetirement(scope, activation.toUpperCase(), before);
    expect(parsed.originalEffectiveTo).toBeNull(); expect(parsed.effectiveThrough).toBeNull(); expect(parsed.requests[0]!.status).toBe("pending");
    const next = new URL(String(fetchMock.mock.calls[1]![0]), "https://daycare.example");
    expect(next.searchParams.get("activation_id")).toBe(activation); expect(next.searchParams.get("before_created_at")).toBe(before.createdAt);
  });
  it.each(["2026-09-26T04:00:30.1234567Z", "2026-09-26T04:00:30", "invalid"])("rejects unrepresentable client cursor %s before fetch", async (createdAt) => {
    await expectError(readRuleReview(scope, "bsrs5", { createdAt, id: uuid(20) }), "invalid");
    await expectError(readRuleRetirement(scope, activation, { createdAt, id: uuid(20) }), "invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["organization", "branch", "activation", "userFlag", "cutoff", "extra", "precision"])("rejects invalid retirement history %s", async (kind) => {
    const value = retirementHistory();
    const malformed = kind === "organization" ? { ...value, organizationId: uuid(99) }
      : kind === "branch" ? { ...value, branchId: uuid(99) }
      : kind === "activation" ? { ...value, activationId: uuid(99) }
      : kind === "userFlag" ? { ...value, requests: [{ ...value.requests[0], byCurrentUser: false }] }
      : kind === "cutoff" ? { ...value, effectiveThrough: "2026-10-01" }
      : kind === "precision" ? { ...value, generatedAt: "2026-09-26T04:01:00.1234567Z" }
      : { ...value, secret: "SECRET" };
    fetchMock.mockResolvedValue(response(malformed)); await expectError(readRuleRetirement(scope, activation), "unconfirmed");
  });
  it("reuses bounded history parsers for twenty reachable rows and exact continuation", async () => {
    for (const kind of ["review", "retirement"] as const) {
      const decided = governanceDecision(kind, "return").receipt.request;
      const requests = Array.from({ length: 20 }, (_, index) => ({ ...decided, requestId: uuid(50 - index) }));
      const nextCursor = { createdAt: "2026-09-26T12:00:00.123456+08:00", id: requests.at(-1)!.requestId };
      const value = { ...(kind === "review" ? reviewHistory() : retirementHistory()), requests, total: 21, nextCursor };
      fetchMock.mockResolvedValue(response(value));
      const result = kind === "review" ? await readRuleReview(scope, "bsrs5") : await readRuleRetirement(scope, activation);
      expect(result.requests).toHaveLength(20); expect(result.nextCursor?.createdAt).toBe(nextCursor.createdAt);
      fetchMock.mockResolvedValue(response({ ...value, requests: [...requests, { ...decided, requestId: uuid(30) }] }));
      await expectError(kind === "review" ? readRuleReview(scope, "bsrs5") : readRuleRetirement(scope, activation), "unconfirmed");
    }
  });
  it("does not accept a review history timestamp finer than native PostgreSQL", async () => {
    fetchMock.mockResolvedValue(response({ ...reviewHistory(), generatedAt: "2026-09-26T04:01:00.1234567Z" }));
    await expectError(readRuleReview(scope, "bsrs5"), "unconfirmed");
  });
});

describe("fixed-endpoint seven-key writes and correlated replay receipts", () => {
  it.each(["review", "retirement"] as const)("writes %s with exact original key/body and no scope payload", async (kind) => {
    const body = kind === "review" ? reviewInput() : retirementInput();
    const value = kind === "review" ? reviewReceipt() : retirementReceipt();
    fetchMock.mockResolvedValue(response({ ...value, replayed: true }, 201));
    const parsed = await writeRuleGovernance(scope, kind, body, key.toUpperCase()); expect(parsed.replayed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`/api/questionnaire-rule-${kind === "review" ? "reviews" : "retirements"}`,
      expect.objectContaining({ method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }));
    expect(Object.keys(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)))).toHaveLength(7);
    expect(String(fetchMock.mock.calls[0]![1]!.body)).not.toMatch(/organizationId|branchId|userId/u);
  });
  it.each(["approve", "withdraw", "return"] as const)("accepts independent/same-author %s receipt evidence for both workflows", async (action) => {
    for (const kind of ["review", "retirement"] as const) {
      const value = governanceDecision(kind, action); fetchMock.mockResolvedValue(response({ ...value.receipt, replayed: true }, 201));
      const result = await writeRuleGovernance(scope, kind, value.input, key);
      expect(result.request.status).toBe(action === "approve" ? "approved" : action === "withdraw" ? "withdrawn" : "returned");
      expect(result.replayed).toBe(true); expect(result.request.decision?.actorId).toBe(scope.userId);
    }
  });
  it("rejects overprecision or self-approved write receipts instead of inferring approval", async () => {
    const value = governanceDecision("review", "approve");
    fetchMock.mockResolvedValue(response({ ...value.receipt, request: { ...value.receipt.request, requestedBy: scope.userId, byCurrentUser: true } }, 201));
    await expectError(writeRuleGovernance(scope, "review", value.input as Parameters<typeof writeRuleGovernance>[2], key), "unconfirmed", true);
    fetchMock.mockResolvedValue(response({ ...reviewReceipt(), committedAt: "2026-09-26T04:00:00.1234567Z",
      request: { ...reviewRequest(), requestedAt: "2026-09-26T04:00:00.1234567Z" } }, 201));
    await expectError(writeRuleGovernance(scope, "review", reviewInput(), key), "unconfirmed", true);
  });
  it.each(["organizationId", "branchId", "actorId", "operationId", "formKey", "action"])("rejects uncorrelated write %s for both workflows", async (field) => {
    for (const kind of ["review", "retirement"] as const) {
      const receipt = kind === "review" ? reviewReceipt() : retirementReceipt();
      fetchMock.mockResolvedValue(response({ ...receipt, [field]: field === "formKey" ? "spmsq" : field === "action" ? "approve" : uuid(99) }, 201));
      await expectError(writeRuleGovernance(scope, kind, kind === "review" ? reviewInput() : retirementInput(), key), "unconfirmed", true);
    }
  });
  it("rejects unknown input keys, invalid scope/key and a malformed operation kind before fetch", async () => {
    await expectError(writeRuleGovernance(scope, "review", { ...reviewInput(), actorId: uuid(99) } as ReturnType<typeof reviewInput>, key), "invalid");
    await expectError(writeRuleGovernance(scope, "retirement", { ...retirementInput(), effectiveTo: null } as ReturnType<typeof retirementInput>, key), "invalid");
    await expectError(writeRuleGovernance({ ...scope, branchId: "invalid" }, "review", reviewInput(), key), "invalid");
    await expectError(writeRuleGovernance(scope, "review", reviewInput(), "invalid"), "invalid");
    await expectError(writeRuleGovernance(scope, "wrong" as "review", reviewInput(), key), "invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects corrupt or unexpected success envelopes without reflecting content", async () => {
    for (const mutate of [
      { requestId: "invalid", status: "ok", data: reviewReceipt(), errors: [] },
      { requestId: uuid(11), status: "partial", data: reviewReceipt(), errors: [] },
      { requestId: uuid(11), status: "ok", data: reviewReceipt(), errors: [], secret: "SECRET" },
      { requestId: uuid(11), status: "ok", data: reviewReceipt(), errors: [{ code: "SECRET", message: "SECRET" }] },
    ]) {
      fetchMock.mockResolvedValue(Response.json(mutate, { status: 201, headers: { "cache-control": "no-store" } }));
      await expectError(writeRuleGovernance(scope, "review", reviewInput(), key), "unconfirmed", true);
    }
    fetchMock.mockResolvedValue(response(reviewReceipt(), 200));
    await expectError(writeRuleGovernance(scope, "review", reviewInput(), key), "unconfirmed", true);
    fetchMock.mockResolvedValue(Response.json({ requestId: uuid(11), status: "ok", data: reviewReceipt(), errors: [] }, { status: 201 }));
    await expectError(writeRuleGovernance(scope, "review", reviewInput(), key), "unconfirmed", true);
  });
});

describe("known denials versus unknown write outcomes", () => {
  it.each([[401, "AUTH_REQUIRED", "auth"], [403, "RULE_REVIEW_NOT_AUTHORIZED", "forbidden"], [403, "AAL2_REQUIRED", "reauth"],
    [409, "RULE_REVIEW_CONFLICT", "conflict"], [400, "RULE_REVIEW_INVALID", "invalid"], [413, "REQUEST_TOO_LARGE", "invalid"],
    [415, "JSON_CONTENT_TYPE_REQUIRED", "invalid"], [503, "RULE_REVIEW_UNCONFIRMED", "unconfirmed"]] as const)(
    "classifies HTTP %s/%s as %s without copying server messages", async (status, code, kind) => {
      fetchMock.mockResolvedValue(denial(status, code));
      await expectError(writeRuleGovernance(scope, "review", reviewInput(), key), kind, kind === "unconfirmed");
    },
  );
  it.each([[400, "invalid"], [403, "forbidden"], [409, "conflict"]] as const)("keeps HTTP %s a known denial even with a malformed body", async (status, kind) => {
    fetchMock.mockResolvedValue(new Response("SECRET non-json", { status, headers: { "content-type": "application/json" } }));
    await expectError(writeRuleGovernance(scope, "retirement", retirementInput(), key), kind);
  });
  it("preserves the exact same operation key/body for a 503 retry", async () => {
    fetchMock.mockResolvedValueOnce(denial(503)).mockResolvedValueOnce(response({ ...retirementReceipt(), replayed: true }, 201));
    await expectError(writeRuleGovernance(scope, "retirement", retirementInput(), key), "unconfirmed", true);
    expect((await writeRuleGovernance(scope, "retirement", retirementInput(), key)).replayed).toBe(true);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(fetchMock.mock.calls[1]![1]!.body);
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(fetchMock.mock.calls[1]![1]!.headers);
  });
  it("uses the real timeout adapter and retains the same key after an unknown timeout", async () => {
    const timeout = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    fetchMock.mockImplementationOnce(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("synthetic backend timeout", "TimeoutError")), { once: true });
    }));
    const result = writeRuleGovernance(scope, "review", reviewInput(), key);
    timeout.abort(new DOMException("synthetic timeout", "TimeoutError"));
    await expectError(result, "unconfirmed", true);
    vi.restoreAllMocks(); fetchMock.mockResolvedValueOnce(response({ ...reviewReceipt(), replayed: true }, 201));
    expect((await writeRuleGovernance(scope, "review", reviewInput(), key)).replayed).toBe(true);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(fetchMock.mock.calls[1]![1]!.body);
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(fetchMock.mock.calls[1]![1]!.headers);
  });
  it("propagates a caller abort to fetch without claiming a write was canceled on the server", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("SECRET cancellation", "AbortError")), { once: true });
    }));
    const result = writeRuleGovernance(scope, "retirement", retirementInput(), key, controller.signal);
    controller.abort(); await expectError(result, "unconfirmed", true);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(String(fetchMock.mock.calls[0]![1]!.body)).toBe(JSON.stringify(retirementInput()));
  });
  it("honors a read cancellation and does not return stale already-aborted data", async () => {
    const controller = new AbortController(); fetchMock.mockImplementationOnce(async () => { controller.abort(); return response(reviewHistory()); });
    await expectError(readRuleReview(scope, "bsrs5", null, controller.signal), "unconfirmed");
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it("does not start a request with an already-aborted signal", async () => {
    const controller = new AbortController(); controller.abort();
    await expectError(readRuleRetirement(scope, activation, null, controller.signal), "unconfirmed");
    await expectError(writeRuleGovernance(scope, "retirement", retirementInput(), key, controller.signal), "unconfirmed", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
