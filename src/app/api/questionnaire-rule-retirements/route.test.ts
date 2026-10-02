import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ context: vi.fn(), recent: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
const configuration = vi.hoisted(() => ({ NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: configuration }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const key = uuid(5);
const activation = uuid(9);
const hash = "b".repeat(64);
const stamp = "2026-09-26T04:00:00Z";
const later = "2026-09-26T04:01:00Z";
const actor: TenantContext = { organizationId: uuid(1), organizationName: "合成測試機構", branchId: uuid(2),
  branchName: "合成測試分支", userId: uuid(3), displayName: "合成規則管理員", roles: ["organization_manager"],
  scopes: ["forms.manage"], assuranceLevel: "aal2", recentAal2At: stamp, demo: false };
const input = () => ({ action: "request" as const, formKey: "bsrs5" as const, catalogHash: hash, activationId: activation,
  requestId: null, effectiveThrough: "2026-10-01", reason: "停止使用舊版規則" });
const pending = () => ({ requestId: uuid(6), activationId: activation, formKey: "bsrs5" as const, catalogHash: hash,
  effectiveThrough: "2026-10-01", reason: "停止使用舊版規則", requestedBy: actor.userId, byCurrentUser: true,
  requestedAt: stamp, status: "pending", decision: null, retirement: null });
const history = () => ({ organizationId: actor.organizationId, branchId: actor.branchId, activationId: activation,
  formKey: "bsrs5", catalogHash: hash, originalEffectiveTo: "2026-10-31", effectiveThrough: "2026-10-31",
  requests: [pending()], total: 1, nextCursor: null, generatedAt: later });
const receipt = () => ({ organizationId: actor.organizationId, branchId: actor.branchId, formKey: "bsrs5", catalogHash: hash,
  activationId: activation, eventId: uuid(7), operationId: key, actorId: actor.userId, committedAt: stamp,
  action: "request", request: pending(), replayed: false });
const decision = (action: "approve" | "withdraw" | "return") => {
  const reason = action === "approve" ? null : "這筆申請需再次確認";
  const requestedBy = action === "withdraw" ? actor.userId : uuid(4);
  const body = { ...input(), action, requestId: uuid(6), effectiveThrough: null, reason };
  const value = { ...receipt(), action, eventId: uuid(8), committedAt: later, request: { ...pending(), requestedBy,
    byCurrentUser: requestedBy === actor.userId, status: action === "approve" ? "approved" : action === "withdraw" ? "withdrawn" : "returned",
    decision: { eventId: uuid(8), action, actorId: actor.userId, byCurrentUser: true, reason, createdAt: later },
    retirement: action === "approve" ? { retirementId: uuid(10), effectiveThrough: "2026-10-01", retiredAt: later } : null } };
  return { body, value };
};
const post = (body: unknown = input(), options: { key?: string | null; query?: string; raw?: boolean; headers?: Record<string, string> } = {}) => {
  const headers = new Headers({ origin: "https://daycare.example", "sec-fetch-site": "same-origin", "content-type": "application/json",
    "idempotency-key": options.key ?? key, ...options.headers });
  if (options.key === null) headers.delete("idempotency-key");
  return new Request(`https://daycare.example/api/questionnaire-rule-retirements${options.query ?? ""}`, {
    method: "POST", headers, body: options.raw ? String(body) : JSON.stringify(body),
  });
};
const get = (query = `?activation_id=${activation}`) => new Request(`https://daycare.example/api/questionnaire-rule-retirements${query}`);

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
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  const envelope = await response.json();
  expect(envelope.status).toBe("error"); expect(envelope.errors[0].code).toBe(code);
  expect(envelope.requestId).toMatch(/^[a-f0-9-]{36}$/u);
  expect(envelope.data).toBeNull();
  expect(JSON.stringify(envelope)).not.toMatch(/SECRET|password|service_role|database stack/u);
  return envelope;
}
async function blockedBeforeRead(value: Request, status: number, code: string) {
  const text = vi.spyOn(value, "text"); const json = vi.spyOn(value, "json");
  await assertError(await POST(value), status, code);
  expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled(); expect(value.bodyUsed).toBe(false);
  expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
}

describe("fixed authoritative context and real-recent AAL2 write gates", () => {
  it.each(["get", "post"])("rejects unauthenticated %s before data access", async (method) => {
    mocks.context.mockResolvedValue(null);
    if (method === "get") await assertError(await GET(get()), 401, "AUTH_REQUIRED");
    else await blockedBeforeRead(post("NOT JSON SECRET", { raw: true }), 401, "AUTH_REQUIRED");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { scopes: [] }])("rejects demo or missing governance authority", async (change) => {
    mocks.context.mockResolvedValue({ ...actor, ...change });
    await blockedBeforeRead(post(), 403, "RULE_RETIREMENT_NOT_AUTHORIZED");
    await assertError(await GET(get()), 403, "RULE_RETIREMENT_NOT_AUTHORIZED");
    expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("requires an authoritative selected branch before reading inputs", async () => {
    mocks.context.mockResolvedValue({ ...actor, branchId: null });
    await blockedBeforeRead(post(), 409, "BRANCH_CONTEXT_REQUIRED");
    await assertError(await GET(get()), 409, "BRANCH_CONTEXT_REQUIRED");
  });
  it.each(["aal1", "expired"])("rejects %s before inspecting malformed body, origin or query", async (kind) => {
    if (kind === "aal1") mocks.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    else mocks.recent.mockResolvedValue(false);
    await blockedBeforeRead(post("NOT JSON SECRET", { raw: true, key: "bad", query: "?override=SECRET", headers: { origin: "https://evil.example" } }), 403, "AAL2_REQUIRED");
  });
  it("allows normal scoped Google history reads without a high-risk reauthentication action", async () => {
    mocks.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    const response = await GET(get()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.context).toHaveBeenCalledWith("staff"); expect(mocks.recent).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("same-origin JSON POST defense-in-depth before body or RPC", () => {
  it.each(["https://finance.example", "null", "https://daycare.example.evil.test"])("rejects Origin %s", async (origin) => {
    await blockedBeforeRead(post(input(), { headers: { origin } }), 403, "ORIGIN_NOT_ALLOWED");
  });
  it("rejects missing Origin and same-site metadata", async () => {
    const missing = post(); missing.headers.delete("origin");
    await blockedBeforeRead(missing, 403, "ORIGIN_NOT_ALLOWED");
    await blockedBeforeRead(post(input(), { headers: { "sec-fetch-site": "same-site" } }), 403, "ORIGIN_NOT_ALLOWED");
  });
  it("does not trust a forged Host or forwarded host for an untrusted request URL", async () => {
    const source = post(); source.headers.set("host", "daycare.example"); source.headers.set("x-forwarded-host", "daycare.example");
    const value = new Request("https://evil.example/api/questionnaire-rule-retirements", { method: "POST", headers: source.headers, body: JSON.stringify(input()) });
    await blockedBeforeRead(value, 403, "ORIGIN_NOT_ALLOWED");
  });
  it.each(["text/plain", "application/x-www-form-urlencoded", "application/problem+json", "application/jsonp"])(
    "rejects non-JSON MIME %s", async (contentType) => {
      await blockedBeforeRead(post(input(), { headers: { "content-type": contentType } }), 415, "JSON_CONTENT_TYPE_REQUIRED");
    },
  );
  it("rejects missing JSON MIME and invalid trusted configuration", async () => {
    const noType = post(); noType.headers.delete("content-type");
    await blockedBeforeRead(noType, 415, "JSON_CONTENT_TYPE_REQUIRED");
    configuration.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example/path?token=SECRET";
    await blockedBeforeRead(post(), 503, "SERVICE_NOT_CONFIGURED");
  });
  it("accepts normalized root-slash configuration and valid JSON charset parameters", async () => {
    configuration.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example/";
    mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
    expect((await POST(post(input(), { headers: { "content-type": "Application/JSON; Charset=\"utf-8\"" } }))).status).toBe(201);
  });
});

describe("strict GET cursor inputs and immutable scoped history", () => {
  it("passes only the fixed tenant and canonical activation into the exact SQL signature", async () => {
    const response = await GET(get(`?activation_id=${activation.toUpperCase()}`)); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("read_questionnaire_rule_retirement", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_activation: activation,
      p_before_created_at: null, p_before_id: null,
    });
    const envelope = await response.json();
    expect(envelope.data.originalEffectiveTo).toBe("2026-10-31"); expect(envelope.data.effectiveThrough).toBe("2026-10-31");
    expect(envelope.data.requests[0].effectiveThrough).toBe("2026-10-01"); expect(envelope.data.requests[0].retirement).toBeNull();
  });
  it.each(["", "?activation_id=", "?activation_id=invalid", `?activation_id=${activation}&activation_id=${activation}`,
    `?activation_id=${activation}&organizationId=SECRET`, `?activation_id=${activation}&form_key=bsrs5`,
    `?activation_id=${activation}&before_id=${uuid(20)}`, `?activation_id=${activation}&before_created_at=${stamp}`,
    `?activation_id=${activation}&before_created_at=invalid&before_id=bad`,
    `?activation_id=${activation}&before_created_at=2026-09-26T04:01:00&before_id=${uuid(20)}`,
    `?activation_id=${activation}&before_created_at=2026-09-26T04:01:00.1234567Z&before_id=${uuid(20)}`,
    `?activation_id=${activation}&before_created_at=${stamp}&before_id=${uuid(20)}&before_id=${uuid(20)}`])(
    "rejects missing, extra, repeated, incomplete or unrepresentable GET query %s", async (query) => {
      await assertError(await GET(get(query)), 400, "RULE_RETIREMENT_INVALID"); expect(mocks.client).not.toHaveBeenCalled();
    },
  );
  it.each(["2026-09-26T04:00:30.123456Z", "2026-09-26T12:00:30.123456+08:00"])(
    "preserves the six-fraction SQL cursor and timezone %s", async (beforeAt) => {
      const query = new URLSearchParams({ activation_id: activation, before_created_at: beforeAt, before_id: uuid(20).toUpperCase() });
      expect((await GET(get(`?${query}`))).status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith("read_questionnaire_rule_retirement", expect.objectContaining({ p_before_created_at: beforeAt, p_before_id: uuid(20) }));
    },
  );
  it.each(["scope", "activation", "requestHash", "extra", "21rows", "inventedCutoff", "order"])(
    "rejects unverified database history %s", async (kind) => {
      const value = history();
      const malformed = kind === "scope" ? { ...value, branchId: uuid(99) }
        : kind === "activation" ? { ...value, activationId: uuid(99) }
        : kind === "requestHash" ? { ...value, requests: [{ ...pending(), catalogHash: "c".repeat(64) }] }
        : kind === "extra" ? { ...value, password: "SECRET" }
        : kind === "21rows" ? { ...value, requests: Array.from({ length: 21 }, (_, index) => ({ ...pending(), requestId: uuid(50 - index) })), total: 21 }
        : kind === "inventedCutoff" ? { ...value, effectiveThrough: pending().effectiveThrough }
        : { ...value, requests: [{ ...decision("return").value.request, requestId: uuid(6) }, { ...decision("return").value.request, requestId: uuid(7) }], total: 2 };
      mocks.rpc.mockResolvedValue({ data: malformed, error: null });
      await assertError(await GET(get()), 503, "RULE_RETIREMENT_HISTORY_INVALID");
    },
  );
  it("accepts twenty reachable returned rows with exact microsecond continuation", async () => {
    const requests = Array.from({ length: 20 }, (_, index) => ({ ...decision("return").value.request, requestId: uuid(50 - index), requestedAt: "2026-09-26T04:00:00.123456Z" }));
    const value = { ...history(), requests, total: 21, nextCursor: { createdAt: "2026-09-26T12:00:00.123456+08:00", id: requests.at(-1)!.requestId } };
    mocks.rpc.mockResolvedValue({ data: value, error: null });
    const response = await GET(get()); expect(response.status).toBe(200); expect((await response.json()).data.requests).toHaveLength(20);
    mocks.rpc.mockResolvedValue({ data: { ...value, nextCursor: { ...value.nextCursor, createdAt: "2026-09-26T04:00:00.123457Z" } }, error: null });
    await assertError(await GET(get()), 503, "RULE_RETIREMENT_HISTORY_INVALID");
  });
});

describe("strict seven-key writes and immutable SQL replay", () => {
  it.each([null, "not-a-uuid"])("rejects invalid key %s before body read", async (key) => {
    await blockedBeforeRead(post("NOT JSON SECRET", { raw: true, key }), 400, "RULE_RETIREMENT_INVALID");
  });
  it("rejects POST query overrides before body read", async () => {
    await blockedBeforeRead(post("NOT JSON SECRET", { raw: true, query: "?reviewer=SECRET" }), 400, "RULE_RETIREMENT_INVALID");
  });
  it.each(["organizationId", "branchId", "actorId", "manifest", "retirementId", "originalEffectiveTo", "effectiveTo", "status", "challengeId"])(
    "rejects extra authority key %s without forwarding it", async (field) => {
      await assertError(await POST(post({ ...input(), [field]: "SECRET" })), 400, "RULE_RETIREMENT_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["effectiveThrough", "reason", "requestId"])("requires field %s", async (field) => {
    const body: Record<string, unknown> = input(); delete body[field];
    await assertError(await POST(post(body)), 400, "RULE_RETIREMENT_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["retire", "activate", "delete"])("does not expose direct %s", async (action) => {
    await assertError(await POST(post({ ...input(), action })), 400, "RULE_RETIREMENT_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["2026-02-30", "2026-10-1", "2200-01-01"])("rejects malformed cutoff %s", async (effectiveThrough) => {
    await assertError(await POST(post({ ...input(), effectiveThrough })), 400, "RULE_RETIREMENT_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["null", "[]", "invalid json"])("rejects non-object JSON %s", async (body) => {
    await assertError(await POST(post(body, { raw: true })), 400, "INVALID_JSON"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects stated body oversize before reading and actual UTF-8 oversize after reading", async () => {
    await blockedBeforeRead(post(input(), { headers: { "content-length": "8193" } }), 413, "REQUEST_TOO_LARGE");
    await assertError(await POST(post("字".repeat(3000), { raw: true })), 413, "REQUEST_TOO_LARGE"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("normalizes operation and activation IDs and writes only fixed-context scope", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(post({ ...input(), activationId: activation.toUpperCase() }, { key: key.toUpperCase() }));
    expect(response.status).toBe(201); expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_retirement", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_key: key, p_input: input(),
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect((await response.json()).data.request.retirement).toBeNull();
  });
  it("leaves exact past-cutoff old-key replay to SQL without today's history/catalog preflight", async () => {
    const body = { ...input(), catalogHash: "c".repeat(64), effectiveThrough: "2024-02-29" };
    const value = { ...receipt(), catalogHash: body.catalogHash, replayed: true, committedAt: "2024-02-01T00:00:00Z",
      request: { ...pending(), catalogHash: body.catalogHash, effectiveThrough: body.effectiveThrough, requestedAt: "2024-02-01T00:00:00Z" } };
    mocks.rpc.mockResolvedValue({ data: value, error: null });
    const response = await POST(post(body)); expect(response.status).toBe(201); expect((await response.json()).data.replayed).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_retirement", expect.objectContaining({ p_input: body }));
  });
  it.each(["approve", "withdraw", "return"] as const)("accepts only correlated %s operation evidence", async (action) => {
    const value = decision(action); mocks.rpc.mockResolvedValue({ data: value.value, error: null });
    const response = await POST(post({ ...value.body, requestId: uuid(6).toUpperCase() })); expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("write_questionnaire_rule_retirement", expect.objectContaining({ p_input: value.body }));
    const envelope = await response.json(); expect(envelope.data.request.retirement !== null).toBe(action === "approve");
  });
});

describe("sanitized uncertainty and unverified receipts never become success", () => {
  it.each(["get", "post"])("reports absent service for %s without RPC", async (method) => {
    mocks.client.mockResolvedValue(null);
    await assertError(await (method === "get" ? GET(get()) : POST(post())), 503, "SERVICE_NOT_CONFIGURED"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", 403, "RULE_RETIREMENT_NOT_AUTHORIZED"], ["23505", 409, "RULE_RETIREMENT_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "RULE_RETIREMENT_CONFLICT"], ["40001", 409, "RULE_RETIREMENT_CONFLICT"],
    ["22023", 400, "RULE_RETIREMENT_INVALID"], ["22007", 400, "RULE_RETIREMENT_INVALID"],
    ["22008", 400, "RULE_RETIREMENT_INVALID"], ["23502", 400, "RULE_RETIREMENT_INVALID"],
    ["XX000", 503, "RULE_RETIREMENT_UNCONFIRMED"],
  ] as const)("maps SQL %s without reflecting sensitive messages", async (code, status, apiCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SECRET service_role password database stack" } });
    await assertError(await POST(post()), status, apiCode); await assertError(await GET(get()), status, apiCode);
  });
  it("keeps null receipts and thrown failures uncertain and private", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const error = await assertError(await POST(post()), 503, "RULE_RETIREMENT_UNCONFIRMED"); expect(error.errors[0].message).toContain("相同操作識別碼");
    await assertError(await GET(get()), 503, "RULE_RETIREMENT_UNCONFIRMED");
    mocks.rpc.mockRejectedValue(new Error("SECRET service_role database stack"));
    await assertError(await POST(post()), 500, "INTEGRATION_INTERNAL_ERROR");
  });
  it.each(["org", "branch", "activation", "operation", "actor", "hash", "reason", "extra", "commit"])(
    "rejects uncorrelated request receipt %s with no success payload", async (kind) => {
      const value = receipt();
      const malformed = kind === "org" ? { ...value, organizationId: uuid(99) }
        : kind === "branch" ? { ...value, branchId: uuid(99) }
        : kind === "activation" ? { ...value, activationId: uuid(99) }
        : kind === "operation" ? { ...value, operationId: uuid(99) }
        : kind === "actor" ? { ...value, actorId: uuid(99) }
        : kind === "hash" ? { ...value, catalogHash: "c".repeat(64) }
        : kind === "reason" ? { ...value, request: { ...value.request, reason: "不同的申請理由" } }
        : kind === "commit" ? { ...value, committedAt: later }
        : { ...value, password: "SECRET" };
      mocks.rpc.mockResolvedValue({ data: malformed, error: null });
      const error = await assertError(await POST(post()), 503, "RULE_RETIREMENT_RECEIPT_INVALID"); expect(error.errors[0].message).toContain("相同操作識別碼");
    },
  );
  it.each(["selfApproval", "event", "cutoff", "precision"])("rejects invalid approval evidence %s", async (kind) => {
    const value = decision("approve"); const q = value.value.request;
    const malformed = kind === "event" ? { ...value.value, eventId: uuid(99) }
      : { ...value.value, request: { ...q,
        ...(kind === "selfApproval" ? { requestedBy: actor.userId, byCurrentUser: true } : {}),
        retirement: { ...q.retirement,
          ...(kind === "cutoff" ? { effectiveThrough: "2026-10-02" } : {}),
          ...(kind === "precision" ? { retiredAt: "2026-09-26T04:01:00.000001Z" } : {}) } } };
    mocks.rpc.mockResolvedValue({ data: malformed, error: null });
    await assertError(await POST(post(value.body)), 503, "RULE_RETIREMENT_RECEIPT_INVALID");
  });
});
