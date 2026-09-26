import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";
import { deterministicUuid } from "@/lib/integrations/security";
import { parseClaimReconciliationRequest } from "@/lib/integrations/claims";
import { hashClaimReconciliationRequest } from "@/lib/service-management/claim-request-hash";

const stubs = vi.hoisted(() => ({
  authorize: vi.fn(), reauth: vi.fn(), client: vi.fn(), rpc: vi.fn(), single: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/http")>()),
  authorizeStaffRequest: stubs.authorize,
  requireRecentAal2: stubs.reauth,
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));

import { POST } from "./route";

const ORG = "49000000-0000-4000-8000-000000000001";
const BRANCH = "49000000-0000-4000-8000-000000000002";
const ACTOR = "49000000-0000-4000-8000-000000000003";
const BATCH = "49000000-0000-4000-8000-000000000004";
const KEY = "49000000-0000-4000-8000-000000000005";
const ITEM_A = "49000000-0000-4000-8000-000000000006";
const ITEM_B = "49000000-0000-4000-8000-000000000007";
const ITEM_C = "49000000-0000-4000-8000-000000000008";
const actor = {
  organizationId: ORG, branchId: BRANCH, userId: ACTOR,
  scopes: ["claims.manage"], assuranceLevel: "aal2", demo: false,
};
const body = {
  claim_batch_id: BATCH,
  expected_total_amount: "1200.1",
  results: [
    { claim_item_id: ITEM_A, outcome: "accepted", response_code: " OK ", response_message: " 核定 " },
    { claim_item_id: ITEM_B, outcome: "accepted", response_code: "OK" },
    { claim_item_id: ITEM_C, outcome: "rejected", response_code: "R01", response_message: null },
  ],
};
const receipt = {
  claim_batch_id: BATCH, status: "reconciled", item_count: 3,
  accepted_count: 2, rejected_count: 1, total_amount: "1200.10", replayed: false,
  organization_id: ORG, branch_id: BRANCH,
  idempotency_key: deterministicUuid(ORG, ACTOR, "claim-reconcile", KEY),
  request_hash: hashClaimReconciliationRequest(parseClaimReconciliationRequest(body, KEY),
    { organizationId: ORG, branchId: BRANCH }),
  snapshot_hash_version: "postgres-jsonb-v1", committed_at: "2026-09-26T04:00:00.654321+00:00",
};

function request(value: unknown = body, key: string | null = KEY) {
  return new Request("https://example.invalid/api/claims/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key === null ? {} : { "idempotency-key": key }) },
    body: JSON.stringify(value),
  });
}

describe("claim reconciliation route database receipt boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubs.authorize.mockResolvedValue(actor);
    stubs.reauth.mockResolvedValue(undefined);
    stubs.client.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single });
    stubs.single.mockResolvedValue({ data: receipt, error: null });
  });

  it.each([false, true])("returns an exact bound receipt (replayed=%s)", async (replayed) => {
    stubs.single.mockResolvedValue({ data: { ...receipt, replayed }, error: null });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({ claimBatchId: BATCH, status: "reconciled", itemCount: 3,
      acceptedCount: 2, rejectedCount: 1, totalAmount: "1200.10", replayed, persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith("reconcile_claim_batch_receipt", {
      p_expected_organization_id: ORG,
      p_expected_branch_id: BRANCH,
      p_claim_batch_id: BATCH,
      p_expected_total_amount: "1200.10",
      p_idempotency_key: deterministicUuid(ORG, ACTOR, "claim-reconcile", KEY),
      p_results: [
        { claim_item_id: ITEM_A, outcome: "accepted", response_code: "OK", response_message: "核定" },
        { claim_item_id: ITEM_B, outcome: "accepted", response_code: "OK", response_message: null },
        { claim_item_id: ITEM_C, outcome: "rejected", response_code: "R01", response_message: null },
      ],
    });
  });

  it("normalizes PostgreSQL bigint strings and numeric amount", async () => {
    stubs.single.mockResolvedValue({ data: { ...receipt, item_count: "3", accepted_count: "2",
      rejected_count: "1", total_amount: 1200.1 }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ itemCount: 3,
      acceptedCount: 2, rejectedCount: 1, totalAmount: "1200.10", persisted: true });
  });

  it.each(["accepted", "rejected"])("accepts a legitimate zero %s count", async (outcome) => {
    const input = { ...body, results: body.results.map((item) => ({ ...item, outcome })) };
    stubs.single.mockResolvedValue({ data: { ...receipt,
      accepted_count: outcome === "accepted" ? 3 : 0,
      rejected_count: outcome === "rejected" ? 3 : 0,
      request_hash: hashClaimReconciliationRequest(parseClaimReconciliationRequest(input, KEY),
        { organizationId: ORG, branchId: BRANCH }) }, error: null });
    expect((await POST(request(input))).status).toBe(200);
  });

  it("rejects stale MFA before consuming request data or reaching persistence", async () => {
    stubs.reauth.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "重新驗證必要。", 403));
    const input = request();
    const read = vi.spyOn(input, "text");
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe("AAL2_REQUIRED");
    expect(read).not.toHaveBeenCalled();
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("requires the claim management scope", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, scopes: ["claims.export"] });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe("CLAIM_RECONCILIATION_NOT_AUTHORIZED");
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("preserves the required branch-context authorization failure", async () => {
    stubs.authorize.mockRejectedValue(new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇作業分支。", 409));
    const input = request();
    const read = vi.spyOn(input, "text");
    const response = await POST(input);
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("BRANCH_CONTEXT_REQUIRED");
    expect(stubs.reauth).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("validates demo input without claiming reconciliation or creating a client", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, scopes: [], demo: true });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ claimBatchId: BATCH, resultCount: 3,
      validated: true, amountVerified: false, reconciled: false, persisted: false, demo: true });
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it.each(["organization_id", "branch_id", "user_id", "scopes", "persisted"])(
    "rejects client-injected %s using the actual request parser", async (field) => {
      const response = await POST(request({ ...body, [field]: "SYNTH_PRIVATE_CONTENT" }));
      const result = await response.json();
      expect(response.status).toBe(400);
      expect(result.errors[0].code).toBe("INVALID_CLAIM_RECONCILIATION");
      expect(JSON.stringify(result)).not.toContain("SYNTH_PRIVATE_CONTENT");
      expect(stubs.client).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate result identifiers before constructing a client", async () => {
    const response = await POST(request({ ...body, results: [body.results[0], body.results[0]] }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("DUPLICATE_CLAIM_RESULT");
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("derives a stable retry key from server identity and header key", async () => {
    await POST(request({ ...body, idempotency_key: ITEM_A }));
    const first = stubs.rpc.mock.calls[0][1].p_idempotency_key;
    await POST(request({ ...body, idempotency_key: ITEM_A }));
    expect(stubs.rpc.mock.calls[1][1].p_idempotency_key).toBe(first);
    expect(first).toBe(deterministicUuid(ORG, ACTOR, "claim-reconcile", KEY));
    expect(first).not.toBe(KEY);
    await POST(request(body, ITEM_A));
    expect(stubs.rpc.mock.calls[2][1].p_idempotency_key).not.toBe(first);
  });

  it("rejects an absent retry key before persistence", async () => {
    expect((await POST(request(body, null))).status).toBe(400);
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON using the actual HTTP body reader", async () => {
    const input = new Request("https://example.invalid/api/claims/reconcile", {
      method: "POST", headers: { "idempotency-key": KEY }, body: "{broken-json",
    });
    const response = await POST(input);
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("INVALID_JSON");
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("reuses the exact retry key after an unverified receipt and accepts the original replay", async () => {
    stubs.single.mockResolvedValueOnce({ data: { ...receipt, accepted_count: 1, rejected_count: 2 }, error: null });
    const first = await POST(request());
    expect(first.status).toBe(502);
    expect((await first.json()).data).toBeNull();
    stubs.single.mockResolvedValueOnce({ data: { ...receipt, replayed: true }, error: null });
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect((await retry.json()).data).toMatchObject({ replayed: true, persisted: true });
    expect(stubs.rpc.mock.calls[1]).toEqual(stubs.rpc.mock.calls[0]);
  });

  it.each([
    null, {}, [], "SYNTH_PRIVATE_CONTENT",
    { ...receipt, claim_batch_id: KEY },
    { ...receipt, claim_batch_id: "not-a-uuid" },
    { ...receipt, status: "exported" },
    { ...receipt, item_count: 0 },
    { ...receipt, item_count: 4 },
    { ...receipt, item_count: 5001 },
    { ...receipt, item_count: "3.0" },
    { ...receipt, accepted_count: 1, rejected_count: 2 },
    { ...receipt, accepted_count: 2, rejected_count: 2 },
    { ...receipt, accepted_count: -1 },
    { ...receipt, accepted_count: "2.0" },
    { ...receipt, rejected_count: 0.5 },
    { ...receipt, rejected_count: "-1" },
    { ...receipt, total_amount: "1200.11" },
    { ...receipt, total_amount: "-1200.10" },
    { ...receipt, total_amount: "1200.100" },
    { ...receipt, total_amount: "1000000000000.00" },
    { ...receipt, replayed: "true" },
    { ...receipt, organization_id: BATCH },
    { ...receipt, branch_id: BATCH },
    { ...receipt, idempotency_key: ITEM_A },
    { ...receipt, request_hash: "b".repeat(64) },
    { ...receipt, snapshot_hash_version: "legacy-js-v1" },
    { ...receipt, committed_at: "not-a-time" },
    { ...receipt, private_detail: "SYNTH_PRIVATE_CONTENT" },
  ])("fails closed on malformed, unbound, or wrong-outcome receipt %j", async (data) => {
    stubs.single.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_RECONCILIATION_RECEIPT_INVALID");
    expect(JSON.stringify(result)).not.toContain("SYNTH_PRIVATE_CONTENT");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(Object.keys(receipt))("rejects a receipt missing %s", async (field) => {
    const data: Record<string, unknown> = { ...receipt };
    delete data[field];
    stubs.single.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("CLAIM_RECONCILIATION_RECEIPT_INVALID");
  });

  it("keeps an unknown database failure uncertain and instructs reuse of the retry key", async () => {
    stubs.single.mockResolvedValue({ data: null,
      error: { code: "NETWORK", message: "SYNTH_PRIVATE_CONTENT", details: "SYNTH_PRIVATE_CONTENT" } });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(503);
    expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_RECONCILIATION_FAILED");
    expect(result.errors[0].message).toContain("尚未確認");
    expect(result.errors[0].message).toContain("相同冪等鍵");
    expect(JSON.stringify(result)).not.toMatch(/未完成對帳|沒有.*寫入|SYNTH_PRIVATE_CONTENT/u);
  });

  it("does not confuse swapped per-item outcomes with an equal accepted/rejected total", async () => {
    const changed = { ...body, results: [
      { ...body.results[0], outcome: "rejected" }, body.results[1],
      { ...body.results[2], outcome: "accepted" },
    ] };
    expect((await POST(request(changed))).status).toBe(502);
  });

  it.each(["response_code", "response_message"])("binds each result's %s, not only its count", async (field) => {
    const changed = { ...body, results: body.results.map((item, index) => index === 0
      ? { ...item, [field]: "CHANGED" } : item) };
    expect((await POST(request(changed))).status).toBe(502);
  });

  it("rejects differently cased duplicate UUIDs before any database call", async () => {
    const id = "490abc00-0000-4000-8000-000000000009";
    const response = await POST(request({ ...body, results: [
      { ...body.results[0], claim_item_id: id }, { ...body.results[0], claim_item_id: id.toUpperCase() },
    ] }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("DUPLICATE_CLAIM_RESULT");
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403, "CLAIM_RECONCILIATION_NOT_AUTHORIZED"],
    ["23505", 409, "CLAIM_RECONCILIATION_IDEMPOTENCY_CONFLICT"],
    ["P2001", 409, "CLAIM_RECONCILIATION_ALREADY_COMPLETED"],
    ["23514", 422, "CLAIM_RECONCILIATION_REJECTED"],
    ["22023", 422, "CLAIM_RECONCILIATION_REJECTED"],
    ["55000", 422, "CLAIM_RECONCILIATION_REJECTED"],
    ["57014", 503, "CLAIM_RECONCILIATION_FAILED"],
    [undefined, 503, "CLAIM_RECONCILIATION_FAILED"],
  ])("classifies database %s without exposing its payload", async (code, status, expectedCode) => {
    stubs.single.mockResolvedValue({ data: null, error: { code, message: "SYNTH_PRIVATE_CONTENT" } });
    const response = await POST(request()); const payload = await response.json();
    expect(response.status).toBe(status); expect(payload.errors[0].code).toBe(expectedCode);
    expect(payload.data).toBeNull(); expect(JSON.stringify(payload)).not.toContain("SYNTH_PRIVATE_CONTENT");
  });
});
