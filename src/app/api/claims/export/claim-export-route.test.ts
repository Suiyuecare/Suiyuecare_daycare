import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";
import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorize: vi.fn(),
  reauth: vi.fn(),
  client: vi.fn(),
  rpc: vi.fn(),
  single: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/http")>()),
  authorizeStaffRequest: stubs.authorize,
  requireRecentAal2: stubs.reauth,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.client,
}));

import { POST } from "./route";

const ORG = "49000000-0000-4000-8000-000000000001";
const BRANCH = "49000000-0000-4000-8000-000000000002";
const ACTOR = "49000000-0000-4000-8000-000000000003";
const BATCH = "49000000-0000-4000-8000-000000000004";
const KEY = "49000000-0000-4000-8000-000000000005";
const OTHER_KEY = "49000000-0000-4000-8000-000000000006";
const actor = {
  organizationId: ORG,
  branchId: BRANCH,
  userId: ACTOR,
  scopes: ["claims.manage", "claims.export"],
  assuranceLevel: "aal2",
  demo: false,
};
const body = { claim_batch_id: BATCH, expected_total_amount: "1200.1" };
const receipt = {
  claim_batch_id: BATCH,
  format_version: "ltc-claim-v1",
  status: "exported",
  snapshot_hash: "a".repeat(64),
  item_count: 2,
  total_amount: "1200.10",
  replayed: false,
};

function request(value: unknown = body, key: string | null = KEY) {
  return new Request("https://example.invalid/api/claims/export", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key === null ? {} : { "idempotency-key": key }),
    },
    body: JSON.stringify(value),
  });
}

describe("claim export route database receipt boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubs.authorize.mockResolvedValue(actor);
    stubs.reauth.mockResolvedValue(undefined);
    stubs.client.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single });
    stubs.single.mockResolvedValue({ data: receipt, error: null });
  });

  it.each([false, true])("returns a bound canonical receipt (replayed=%s)", async (replayed) => {
    stubs.single.mockResolvedValue({ data: { ...receipt, replayed }, error: null });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      claimBatchId: BATCH,
      snapshotHash: receipt.snapshot_hash,
      itemCount: 2,
      totalAmount: "1200.10",
      formatVersion: receipt.format_version,
      status: "exported",
      replayed,
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("export_claim_batch", {
      p_expected_organization_id: ORG,
      p_expected_branch_id: BRANCH,
      p_claim_batch_id: BATCH,
      p_expected_total_amount: "1200.10",
      p_idempotency_key: deterministicUuid(ORG, ACTOR, "claim-export", KEY),
    });
  });

  it.each([
    { item_count: "2", total_amount: 1200.1 },
    { item_count: 2, total_amount: "1200.1" },
    { item_count: String(Number.MAX_SAFE_INTEGER), total_amount: "1200.10" },
  ])("accepts PostgreSQL numeric and bigint wire forms %j", async (wire) => {
    stubs.single.mockResolvedValue({ data: { ...receipt, ...wire }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      itemCount: Number(wire.item_count), totalAmount: "1200.10", persisted: true,
    });
  });

  it("rejects stale MFA before consuming the body or reaching persistence", async () => {
    stubs.reauth.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "重新驗證必要。", 403));
    const input = request();
    const read = vi.spyOn(input, "text");
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe("AAL2_REQUIRED");
    expect(read).not.toHaveBeenCalled();
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it.each([{ scopes: [] }, { scopes: ["claims.manage"] }, { scopes: ["claims.export"] }])("requires both claim scopes: %j", async ({ scopes }) => {
    stubs.authorize.mockResolvedValue({ ...actor, scopes });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe("CLAIM_EXPORT_NOT_AUTHORIZED");
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

  it("validates demo input without claiming persistence or creating a client", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, demo: true, scopes: [] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      claimBatchId: BATCH, validated: true, amountVerified: false,
      snapshotCreated: false, persisted: false, demo: true,
    });
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it.each(["organization_id", "branch_id", "user_id", "scopes", "persisted"])(
    "rejects client-injected %s using the actual request parser", async (field) => {
      const response = await POST(request({ ...body, [field]: "SYNTH_PRIVATE_CONTENT" }));
      const result = await response.json();
      expect(response.status).toBe(400);
      expect(result.errors[0].code).toBe("INVALID_CLAIM_EXPORT");
      expect(JSON.stringify(result)).not.toContain("SYNTH_PRIVATE_CONTENT");
      expect(stubs.client).not.toHaveBeenCalled();
    },
  );

  it("derives the database retry key from server identity and the header key", async () => {
    await POST(request({ ...body, idempotency_key: OTHER_KEY }));
    const first = stubs.rpc.mock.calls[0][1].p_idempotency_key;
    await POST(request({ ...body, idempotency_key: OTHER_KEY }));
    expect(stubs.rpc.mock.calls[1][1].p_idempotency_key).toBe(first);
    expect(first).toBe(deterministicUuid(ORG, ACTOR, "claim-export", KEY));
    expect(first).not.toBe(KEY);
    await POST(request(body, OTHER_KEY));
    expect(stubs.rpc.mock.calls[2][1].p_idempotency_key).not.toBe(first);
  });

  it("rejects an absent retry key before persistence", async () => {
    const response = await POST(request(body, null));
    expect(response.status).toBe(400);
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON using the actual HTTP body reader", async () => {
    const input = new Request("https://example.invalid/api/claims/export", {
      method: "POST", headers: { "idempotency-key": KEY }, body: "{broken-json",
    });
    const response = await POST(input);
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("INVALID_JSON");
    expect(stubs.client).not.toHaveBeenCalled();
  });

  it("reuses the exact retry key after an unverified receipt and accepts the original replay", async () => {
    stubs.single.mockResolvedValueOnce({ data: { ...receipt, snapshot_hash: "invalid" }, error: null });
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
    { ...receipt, status: "draft" },
    { ...receipt, status: "reconciled" },
    { ...receipt, format_version: "" },
    { ...receipt, format_version: "x".repeat(1000) },
    { ...receipt, snapshot_hash: "A".repeat(64) },
    { ...receipt, snapshot_hash: "a".repeat(63) },
    { ...receipt, item_count: 0 },
    { ...receipt, item_count: -1 },
    { ...receipt, item_count: 1.5 },
    { ...receipt, item_count: "2.0" },
    { ...receipt, item_count: "9007199254740992" },
    { ...receipt, total_amount: "1200.11" },
    { ...receipt, total_amount: "-1200.10" },
    { ...receipt, total_amount: "1200.100" },
    { ...receipt, total_amount: "1000000000000.00" },
    { ...receipt, replayed: "true" },
    { ...receipt, private_detail: "SYNTH_PRIVATE_CONTENT" },
  ])("fails closed on malformed or unbound success %j", async (data) => {
    stubs.single.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_EXPORT_RECEIPT_INVALID");
    expect(JSON.stringify(result)).not.toContain("SYNTH_PRIVATE_CONTENT");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(Object.keys(receipt))("rejects a receipt missing %s", async (field) => {
    const data: Record<string, unknown> = { ...receipt };
    delete data[field];
    stubs.single.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("CLAIM_EXPORT_RECEIPT_INVALID");
  });

  it("keeps an unknown database failure uncertain and instructs reuse of the retry key", async () => {
    stubs.single.mockResolvedValue({ data: null,
      error: { code: "NETWORK", message: "SYNTH_PRIVATE_CONTENT", details: "SYNTH_PRIVATE_CONTENT" } });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(result.data).toBeNull();
    expect(result.errors[0].code).toBe("CLAIM_EXPORT_FAILED");
    expect(result.errors[0].message).toContain("尚未確認");
    expect(result.errors[0].message).toContain("相同冪等鍵");
    expect(JSON.stringify(result)).not.toMatch(/未建立快照|沒有.*寫入|SYNTH_PRIVATE_CONTENT/u);
  });
});
