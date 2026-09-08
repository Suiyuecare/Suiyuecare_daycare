import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(), requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "23100000-0000-4000-8000-000000000099";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const ORG = "23100000-0000-4000-8000-000000000001";
const BRANCH = "23100000-0000-4000-8000-000000000002";
const ACTOR = "23100000-0000-4000-8000-000000000003";
const OUTER = "23100000-0000-4000-8000-000000000004";
const ITEM = "23100000-0000-4000-8000-000000000005";
const VACCINATION = "23100000-0000-4000-8000-000000000006";
const VERSION = "23100000-0000-4000-8000-000000000007";
const CLIENT = "23100000-0000-4000-8000-000000000008";
const BATCH = "23100000-0000-4000-8000-000000000009";
const actor = { organizationId: ORG, organizationName: "合成機構",
  branchId: BRANCH, branchName: "合成分支", userId: ACTOR,
  displayName: "合成主管", roles: ["branch_supervisor"],
  scopes: ["clients.read", "client_vaccinations.read", "client_vaccinations.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const record = { action: "create", vaccination_key: VACCINATION,
  previous_version_id: null, expected_base_version: 0, client_id: CLIENT,
  vaccine_name: "合成疫苗", dose_number: "第 1 劑", vaccinated_on: "2026-09-07",
  lot_number: null, provider_name: "合成院所", evidence_status: "missing",
  evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
  source_system: "manual_entry", source_record_id: null, correction_reason: null };
const body = { items: [{ idempotency_key: ITEM, record }] };
const scopedItem = deterministicUuid(
  "page23-client-vaccination-record", ORG, ACTOR, ITEM,
);
const scopedBatch = deterministicUuid(
  "page23-client-vaccination-batch", ORG, ACTOR, OUTER,
);

function request() {
  return new Request("https://example.invalid/api/client-vaccinations/batch", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": OUTER }, body: "{}",
  });
}

function databaseReceipt(overrides: Record<string, unknown> = {}) {
  return { batch_id: BATCH, batch_idempotency_key: scopedBatch,
    request_hash: "a".repeat(64), item_total: 1, succeeded_total: 1,
    rejected_total: 0, replayed: false, results: [{ index: 0,
      idempotency_key: scopedItem, status: "created", error: null,
      receipt: { record_payload: Object.fromEntries(Object.entries(record).filter(([key]) =>
        !["action", "vaccination_key", "previous_version_id", "expected_base_version", "correction_reason"].includes(key))),
        organization_id: ORG, branch_id: BRANCH,
        vaccination_key: VACCINATION, record_version_id: VERSION, version: 1,
        previous_version_id: null, record_status: "active", client_id: CLIENT,
        content_hash: "b".repeat(64), duplicate_warning: false, duplicate_count: 0,
        duplicate_basis: "same_client_normalized_vaccine_and_dose",
        recorded_at: "2026-09-08T00:00:00.000Z", replayed: false } }],
    ...overrides };
}

describe("Page 23 atomic client vaccination batch API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockReset(); stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: databaseReceipt(), error: null });
  });

  it("requires recent verification before parsing the bulk request or calling SQL", async () => {
    stubs.requireRecentAal2.mockRejectedValueOnce(Object.assign(new Error("請重新驗證"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it.each([{ ...actor, assuranceLevel: "aal1" },
    { ...actor, scopes: ["clients.read", "client_vaccinations.read"] },
    { ...actor, demo: true }])(
    "rejects unauthorized batches before parsing body %#", async (unauthorized) => {
      stubs.authorizeStaffRequest.mockResolvedValue(unauthorized);
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    },
  );

  it("uses one atomic RPC and correlates outer and item replay keys", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toMatchObject({ batchId: BATCH,
      batchIdempotencyKey: OUTER, requestHash: "a".repeat(64), replayed: false,
      itemTotal: 1, succeededTotal: 1, rejectedTotal: 0,
      results: [{ index: 0, idempotencyKey: ITEM, status: "created" }] });
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
    expect(stubs.rpc).toHaveBeenCalledWith("append_client_vaccination_batch", {
      p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
      p_batch_idempotency_key: scopedBatch,
      p_items: [{ idempotency_key: scopedItem, record }],
    });
  });

  it.each([
    { batch_idempotency_key: ITEM },
    { succeeded_total: 0, rejected_total: 1 },
    { request_hash: "not-a-hash" },
  ])("fails closed on a malformed atomic receipt %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue({ data: databaseReceipt(override), error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
  });

  it("sanitizes batch database errors without falling back to per-item calls", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private batch detail" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await response.json())).not.toContain("private batch detail");
  });
});
