import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";
import { getAssessmentDefinition } from "@/lib/assessments/definitions";
import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ context: vi.fn(), recent: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
const configuration = vi.hoisted(() => ({ NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: configuration }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const key = uuid(5);
const stamp = "2026-09-26T04:00:00Z";
const actor: TenantContext = { organizationId: uuid(1), organizationName: "合成測試機構", branchId: uuid(2),
  branchName: "合成測試分支", userId: uuid(3), displayName: "合成規則管理員", roles: ["organization_manager"],
  scopes: ["forms.manage"], assuranceLevel: "aal2", recentAal2At: stamp, demo: false };
const candidate = () => buildQuestionnaireRuleCatalogEntry("bsrs5");
const input = () => ({ formKey: "bsrs5", catalogHash: candidate().catalogHash, action: "request",
  requestId: null, effectiveFrom: "2026-09-27", effectiveTo: null, reason: null });
const pending = (body = input()) => ({ requestId: uuid(6), formKey: body.formKey, catalogHash: body.catalogHash,
  effectiveFrom: body.effectiveFrom, effectiveTo: body.effectiveTo, requestedBy: actor.userId,
  byCurrentUser: true, requestedAt: stamp, status: "pending", decision: null, activation: null });
const history = () => ({ organizationId: actor.organizationId, branchId: actor.branchId,
  formKey: "bsrs5", catalogs: [], requests: [pending()], total: 1, nextCursor: null, generatedAt: stamp });
const receipt = (body = input()) => ({ organizationId: actor.organizationId, branchId: actor.branchId,
  formKey: body.formKey, catalogHash: body.catalogHash, operationId: key, actorId: actor.userId,
  committedAt: stamp, eventId: uuid(7), action: body.action, request: pending(body), replayed: false });
const request = (body: unknown = input(), options: { key?: string; query?: string; raw?: boolean; headers?: Record<string, string> } = {}) =>
  new Request(`https://daycare.example/api/questionnaire-rule-reviews${options.query ?? ""}`, {
    method: "POST", headers: { origin: "https://daycare.example", "sec-fetch-site": "same-origin",
      "content-type": "application/json", "idempotency-key": options.key ?? key, ...options.headers },
    body: options.raw ? String(body) : JSON.stringify(body),
  });
const get = (query = "?form_key=bsrs5") => new Request(`https://daycare.example/api/questionnaire-rule-reviews${query}`);

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(stamp)); vi.resetAllMocks();
  configuration.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example";
  mocks.context.mockResolvedValue(actor); mocks.recent.mockResolvedValue(true);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: history(), error: null });
});
afterEach(() => { vi.useRealTimers(); });

async function assertError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  const envelope = await response.json();
  expect(envelope.status).toBe("error"); expect(envelope.errors[0].code).toBe(code);
  expect(envelope.requestId).toMatch(/^[a-f0-9-]{36}$/u);
  expect(JSON.stringify(envelope)).not.toMatch(/SECRET|password|service_role|database stack/u);
  return envelope;
}

describe("rule-review authorization gates", () => {
  it.each(["get", "post"])("rejects unauthenticated %s without reading data", async (method) => {
    mocks.context.mockResolvedValue(null);
    await assertError(await (method === "get" ? GET(get()) : POST(request())), 401, "AUTH_REQUIRED");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { scopes: [] }])("rejects demo or missing governance permission", async (change) => {
    mocks.context.mockResolvedValue({ ...actor, ...change });
    await assertError(await POST(request()), 403, "RULE_REVIEW_NOT_AUTHORIZED");
    expect(mocks.recent).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a selected authoritative branch", async () => {
    mocks.context.mockResolvedValue({ ...actor, branchId: null });
    await assertError(await GET(get()), 409, "BRANCH_CONTEXT_REQUIRED");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["aal1", "expired"])("requires recent AAL2 before body read, even on %s malformed input", async (kind) => {
    if (kind === "aal1") mocks.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    else mocks.recent.mockResolvedValue(false);
    const value = request("NOT JSON SECRET", { raw: true, key: "bad", query: "?override=true" });
    const read = vi.spyOn(value, "text");
    await assertError(await POST(value), 403, "AAL2_REQUIRED");
    expect(read).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("allows scoped history reads without performing a signing action", async () => {
    mocks.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    expect((await GET(get())).status).toBe(200); expect(mocks.recent).not.toHaveBeenCalled();
  });
});

describe("same-origin JSON write defense-in-depth before body or database access", () => {
  async function blocked(value: Request, status: number, code: string) {
    const text = vi.spyOn(value, "text"); const json = vi.spyOn(value, "json");
    await assertError(await POST(value), status, code);
    expect(mocks.recent).toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
    expect(value.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  }
  it("rejects a sibling same-site origin", async () => {
    await blocked(request(input(), { headers: { origin: "https://finance.example", "sec-fetch-site": "same-site" } }), 403, "ORIGIN_NOT_ALLOWED");
  });
  it("rejects missing and null Origin even with an operation key", async () => {
    const missing = request(); missing.headers.delete("origin");
    await blocked(missing, 403, "ORIGIN_NOT_ALLOWED");
    await blocked(request(input(), { headers: { origin: "null" } }), 403, "ORIGIN_NOT_ALLOWED");
  });
  it("rejects an untrusted request URL despite forged proxy and origin headers", async () => {
    const value = new Request("https://evil.example/api/questionnaire-rule-reviews", {
      method: "POST", headers: { origin: "https://daycare.example", "sec-fetch-site": "same-origin",
        "content-type": "application/json", "idempotency-key": key,
        host: "daycare.example", "x-forwarded-host": "daycare.example", "x-forwarded-proto": "https" },
      body: JSON.stringify(input()),
    });
    await blocked(value, 403, "ORIGIN_NOT_ALLOWED");
  });
  it("rejects simple-request and prefixed non-JSON media types", async () => {
    await blocked(request(input(), { headers: { "content-type": "text/plain" } }), 415, "JSON_CONTENT_TYPE_REQUIRED");
    await blocked(request(input(), { headers: { "content-type": "application/jsonp" } }), 415, "JSON_CONTENT_TYPE_REQUIRED");
  });
  it("rejects misconfigured trusted origin rather than inferring it from the request", async () => {
    configuration.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example/config?token=SECRET";
    await blocked(request(), 503, "SERVICE_NOT_CONFIGURED");
  });
});

describe("strict client inputs and server-owned scope", () => {
  it.each(["manifest", "reviewerId", "actorId", "organizationId", "branchId", "activatedAt", "status", "canonicalJson"])(
    "rejects a client-supplied %s, not forwarding it into the database", async (field) => {
      await assertError(await POST(request({ ...input(), [field]: "SECRET override" })), 400, "RULE_REVIEW_INVALID");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["activate", "publish", "sign"])("does not expose direct %s", async (action) => {
    await assertError(await POST(request({ ...input(), action })), 400, "RULE_REVIEW_INVALID");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["2026-02-30", "2026-9-27", "2200-01-01"])("rejects malformed calendar date %s", async (effectiveFrom) => {
    await assertError(await POST(request({ ...input(), effectiveFrom })), 400, "RULE_REVIEW_INVALID");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects reversed dates, a malformed operation UUID and POST query injection", async () => {
    await assertError(await POST(request({ ...input(), effectiveTo: "2026-09-26" })), 400, "RULE_REVIEW_INVALID");
    await assertError(await POST(request(input(), { key: "not-a-uuid" })), 400, "RULE_REVIEW_INVALID");
    await assertError(await POST(request(input(), { query: "?reviewerId=SECRET" })), 400, "RULE_REVIEW_INVALID");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["null", "[]", "invalid json"])("rejects non-object JSON %s", async (raw) => {
    await assertError(await POST(request(raw, { raw: true })), 400, "INVALID_JSON");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an oversized body before reading it", async () => {
    const value = request(input(), { headers: { "content-length": "8193" } }); const read = vi.spyOn(value, "text");
    await assertError(await POST(value), 413, "REQUEST_TOO_LARGE"); expect(read).not.toHaveBeenCalled();
  });
  it("normalizes uppercase operation UUIDs and passes only authorized tenant scope", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request(input(), { key: key.toUpperCase() })); expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_review", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_key: key, p_input: input(),
    });
    const envelope = await response.json(); expect(envelope.data.request.activation).toBeNull();
    expect(envelope.data.request.status).toBe("pending");
  });
  it("lets the database replay an old candidate or past effective date without silently reauthoring it", async () => {
    const original = { ...input(), catalogHash: "c".repeat(64), effectiveFrom: "2026-09-01" };
    mocks.rpc.mockResolvedValue({ data: { ...receipt(original), replayed: true }, error: null });
    const response = await POST(request(original)); expect(response.status).toBe(201);
    expect((await response.json()).data.replayed).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_review", expect.objectContaining({ p_input: original }));
  });
  it.each([["42501", 403, "RULE_REVIEW_NOT_AUTHORIZED"], ["23514", 409, "RULE_REVIEW_CONFLICT"]] as const)(
    "leaves unknown candidate or expired new request validation to database authority (%s)", async (code, status, apiCode) => {
      const original = { ...input(), catalogHash: "c".repeat(64), effectiveFrom: "2026-09-01" };
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SECRET server registry rejected new request" } });
      await assertError(await POST(request(original)), status, apiCode);
      expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_review", expect.objectContaining({ p_input: original }));
    },
  );
  it("accepts only correlated independent approval evidence with uppercase request UUID normalized", async () => {
    const approvalInput = { ...input(), action: "approve", requestId: uuid(6).toUpperCase(), effectiveFrom: null };
    const value = receipt();
    mocks.rpc.mockResolvedValue({ data: { ...value, action: "approve", committedAt: "2026-09-26T04:01:00Z", eventId: uuid(8),
      request: { ...value.request, requestedBy: uuid(4), byCurrentUser: false, status: "approved",
        decision: { eventId: uuid(8), action: "approve", actorId: actor.userId, byCurrentUser: true, reason: null, createdAt: "2026-09-26T04:01:00Z" },
        activation: { activationId: uuid(9), catalogHash: value.catalogHash, effectiveFrom: value.request.effectiveFrom,
          effectiveTo: null, activatedAt: "2026-09-26T04:01:00Z" } } }, error: null });
    const response = await POST(request(approvalInput)); expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_review", expect.objectContaining({
      p_input: { ...approvalInput, requestId: uuid(6) },
    }));
    const envelope = await response.json(); expect(envelope.data.request.status).toBe("approved");
    expect(envelope.data.request.requestedBy).not.toBe(envelope.data.request.decision.actorId);
  });
});

describe("bounded history and unactivated server catalog", () => {
  it("reports an unregistered candidate without registering or activating it", async () => {
    const response = await GET(get()); expect(response.status).toBe(200);
    const envelope = await response.json(); expect(envelope.data.candidate.registered).toBe(false);
    expect(envelope.data.candidate.adoptionRequired).toBe(true);
    expect(envelope.data.candidate.catalogHash).toBe(candidate().catalogHash);
    expect(envelope.data.requests[0].activation).toBeNull();
    expect(getAssessmentDefinition(candidate().ruleVersion)?.activatedAt).toBeNull();
    expect(getAssessmentDefinition(candidate().ruleVersion)?.reviewRequired).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("read_questionnaire_rule_review", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_form_key: "bsrs5", p_before_created_at: null, p_before_id: null,
    });
  });
  it("marks registration by the exact immutable candidate hash, not by a supplied title", async () => {
    const value = candidate(); mocks.rpc.mockResolvedValue({ data: { ...history(), catalogs: [{ formKey: "bsrs5",
      formVersion: value.formVersion, ruleVersion: value.ruleVersion, ruleRevision: 2, catalogHash: value.catalogHash }] }, error: null });
    const response = await GET(get()); const envelope = await response.json();
    expect(envelope.data.candidate.registered).toBe(true); expect(envelope.data.candidate.adoptionRequired).toBe(true);
    expect(envelope.data.requests[0].status).toBe("pending");
  });
  it.each(["", "?form_key=unknown", "?form_key=bsrs5&form_key=gds_15", "?form_key=bsrs5&manifest=SECRET",
    `?form_key=bsrs5&before_id=${uuid(20)}`, "?form_key=bsrs5&before_created_at=invalid&before_id=bad"])(
    "rejects incomplete, repeated or untrusted GET query %s", async (query) => {
      await assertError(await GET(get(query)), 400, "RULE_REVIEW_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["2026-09-26T04:00:00.1234567Z", "2026-09-26T04:00:00.1234567890Z", "2026-09-26T12:00:00.1234567+08:00"])(
    "rejects a cursor finer than PostgreSQL microseconds before RPC: %s", async (timestamp) => {
      await assertError(await GET(get(`?form_key=bsrs5&before_created_at=${encodeURIComponent(timestamp)}&before_id=${uuid(20)}`)), 400, "RULE_REVIEW_INVALID");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("normalizes an uppercase cursor and verifies the returned page against it", async () => {
    expect((await GET(get(`?form_key=bsrs5&before_created_at=2026-09-26T04%3A01%3A00Z&before_id=${uuid(20).toUpperCase()}`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("read_questionnaire_rule_review", expect.objectContaining({ p_before_id: uuid(20), p_before_created_at: "2026-09-26T04:01:00Z" }));
  });

  it.each(["2026-09-26T04:01:00.123456Z", "2026-09-26T12:01:00.123456+08:00"])(
    "preserves valid six-digit PostgreSQL cursor precision: %s", async (timestamp) => {
      expect((await GET(get(`?form_key=bsrs5&before_created_at=${encodeURIComponent(timestamp)}&before_id=${uuid(20)}`))).status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith("read_questionnaire_rule_review", expect.objectContaining({ p_before_created_at: timestamp }));
    },
  );
  it.each(["scope", "extra", "21rows", "51catalogs"])("rejects invalid database history %s", async (kind) => {
    const value = history(); const summary = { formKey: "bsrs5", formVersion: "v1", ruleVersion: "v2", ruleRevision: 2, catalogHash: "b".repeat(64) };
    const malformed = kind === "scope" ? { ...value, branchId: uuid(99) }
      : kind === "extra" ? { ...value, password: "SECRET" }
      : kind === "21rows" ? { ...value, requests: Array.from({ length: 21 }, (_, index) => ({ ...pending(), requestId: uuid(50 - index) })), total: 21 }
      : { ...value, catalogs: Array.from({ length: 51 }, (_, index) => ({ ...summary, catalogHash: index.toString(16).padStart(64, "0") })) };
    mocks.rpc.mockResolvedValue({ data: malformed, error: null });
    await assertError(await GET(get()), 503, "RULE_REVIEW_HISTORY_INVALID");
  });
});

describe("database failure and receipt uncertainty remain private", () => {
  it.each(["get", "post"])("reports absent service for %s without database access", async (method) => {
    mocks.client.mockResolvedValue(null);
    await assertError(await (method === "get" ? GET(get()) : POST(request())), 503, "SERVICE_NOT_CONFIGURED");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", 403, "RULE_REVIEW_NOT_AUTHORIZED"], ["23505", 409, "RULE_REVIEW_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "RULE_REVIEW_CONFLICT"], ["40001", 409, "RULE_REVIEW_CONFLICT"],
    ["22023", 400, "RULE_REVIEW_INVALID"], ["22007", 400, "RULE_REVIEW_INVALID"],
    ["22008", 400, "RULE_REVIEW_INVALID"], ["23502", 400, "RULE_REVIEW_INVALID"],
    ["XX000", 503, "RULE_REVIEW_UNCONFIRMED"],
  ] as const)("maps database %s without revealing its message", async (code, status, apiCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SECRET service_role password database stack" } });
    await assertError(await POST(request()), status, apiCode);
    await assertError(await GET(get()), status, apiCode);
  });
  it("handles a null uncertain receipt and thrown backend error without exposing secrets", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await assertError(await POST(request()), 503, "RULE_REVIEW_UNCONFIRMED");
    mocks.rpc.mockRejectedValue(new Error("SECRET service_role database stack"));
    await assertError(await POST(request()), 500, "INTEGRATION_INTERNAL_ERROR");
  });
  it.each(["scope", "operation", "actor", "hash", "activation", "extra", "commit"])("returns 503 for an unverified %s receipt, never success", async (kind) => {
    const value = receipt();
    const malformed = kind === "scope" ? { ...value, organizationId: uuid(99) }
      : kind === "operation" ? { ...value, operationId: uuid(99) }
      : kind === "actor" ? { ...value, actorId: uuid(99) }
      : kind === "hash" ? { ...value, catalogHash: "c".repeat(64) }
      : kind === "activation" ? { ...value, request: { ...value.request, activation: { SECRET: "unapproved" } } }
      : kind === "commit" ? { ...value, committedAt: "2026-09-26T04:01:00Z" }
      : { ...value, password: "SECRET" };
    mocks.rpc.mockResolvedValue({ data: malformed, error: null });
    const envelope = await assertError(await POST(request()), 503, "RULE_REVIEW_RECEIPT_INVALID");
    expect(envelope.errors[0].message).toContain("相同操作識別碼"); expect(envelope.data).toBeNull();
  });
});
