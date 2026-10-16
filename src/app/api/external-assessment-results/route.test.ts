import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), db: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async (original) => ({
  ...await original<typeof import("@/lib/integrations/http")>(),
  authorizeStaffRequest: mocks.authorize,
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));

import { GET, POST } from "./route";

const clientId = "d9500000-0000-4000-8000-000000000001";
const key = "d9600000-0000-4000-8000-000000000001";
const record = {
  id: "d9700000-0000-4000-8000-000000000001", clientId, instrumentKey: "barthel_adl",
  externalVersion: "機構核准紙本 v1", assessedOn: "2026-09-24", score: 45, maximumScore: 100,
  externalResult: "外部報告結果", performedBy: "合成評估人員", source: "合成機構",
  followUpDueOn: null, followUpNote: null, actorId: "d8100000-0000-4000-8000-000000000001",
  createdAt: "2026-09-25T00:00:00Z",
};
const input = {
  instrumentKey: "barthel_adl", externalVersion: "機構核准紙本 v1", assessedOn: "2026-09-24",
  score: 45, maximumScore: 100, externalResult: "外部報告結果", performedBy: "合成評估人員",
  source: "合成機構", followUpDueOn: null, followUpNote: null,
};
const actor = {
  userId: record.actorId, organizationId: "d8500000-0000-4000-8000-000000000001",
  branchId: "d8600000-0000-4000-8000-000000000001",
  scopes: ["clients.read", "care_records.read", "care_records.write",
    "questionnaire_adl.read", "questionnaire_adl.manage"], demo: false, assuranceLevel: "aal1",
};
const read = (instrumentKey = "barthel_adl", selectedClientId = clientId) => new Request(
  `https://example.invalid/api/external-assessment-results?clientId=${selectedClientId}&instrumentKey=${instrumentKey}`,
);
const post = (body: unknown = { clientId, input }, idempotencyKey = key) => new Request(
  "https://example.invalid/api/external-assessment-results", {
    method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(body),
  },
);

describe("external assessment result API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue(actor);
    mocks.db.mockResolvedValue({ rpc: (...args: unknown[]) => mocks.rpc(...args) });
    mocks.rpc.mockResolvedValue({ data: { record, replayed: false }, error: null });
  });

  it("stores a result-only record under server tenant and AAL1 routine write authority", async () => {
    const response = await POST(post());
    expect(response.status).toBe(201);
    expect(mocks.authorize).toHaveBeenNthCalledWith(1, { routinePermission: "care_records.read" });
    expect(mocks.authorize).toHaveBeenNthCalledWith(2, { routinePermission: "care_records.write" });
    expect(mocks.rpc).toHaveBeenCalledWith("write_external_assessment_result", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId, p_key: key, p_payload: input,
    });
    expect(await response.json()).toMatchObject({ data: { persisted: true, demo: false, record } });
  });

  it("rejects anonymous requests before reading the body", async () => {
    mocks.authorize.mockRejectedValue(new IntegrationError("AUTH_REQUIRED", "請先登入。", 401));
    const request = post("not-json");
    const read = vi.spyOn(request, "text");
    expect((await POST(request)).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it.each([
    [{ clientId, input: { ...input, score: 101, maximumScore: 100 } }, key],
    [{ clientId, input: { ...input, instrumentKey: "custom" } }, key],
    [{ clientId, input, organizationId: actor.organizationId }, key],
    [{ clientId, input }, "not-a-uuid"],
  ])("rejects malformed or spoofed input", async (body, operationKey) => {
    expect((await POST(post(body, operationKey))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { ...actor, demo: true },
    { ...actor, scopes: ["clients.read", "care_records.read", "questionnaire_adl.read"] },
    { ...actor, scopes: ["clients.read", "care_records.read", "care_records.write"] },
  ])("denies read-only, instrument-unentitled, or demo actors", async (context) => {
    mocks.authorize.mockResolvedValue(context);
    expect((await POST(post())).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("requires exactly one client and instrument in read queries", async () => {
    expect((await GET(new Request(`https://example.invalid/api/external-assessment-results?clientId=${clientId}`))).status).toBe(400);
    expect((await GET(new Request(`https://example.invalid/api/external-assessment-results?clientId=${clientId}&instrumentKey=barthel_adl&other=x`))).status).toBe(400);
    expect((await GET(new Request(`https://example.invalid/api/external-assessment-results?clientId=${clientId}&instrumentKey=barthel_adl&instrumentKey=iadl`))).status).toBe(400);
    expect((await GET(read("unknown"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reads only the requested instrument and denies a different instrument before database access", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: {
      clientId, records: [record], total: 1, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
    }, error: null });
    expect((await GET(read())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("read_external_assessment_results", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId, p_instrument: "barthel_adl",
    });
    mocks.rpc.mockClear();
    expect((await GET(read("gds"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when a malformed database snapshot includes another instrument", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: {
      clientId, records: [{ ...record, instrumentKey: "gds" }], total: 1,
      hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
    }, error: null });
    const response = await GET(read());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("外部報告結果");
  });

  it("does not claim persistence when the database receipt is malformed", async () => {
    mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
    expect((await POST(post())).status).toBe(409);
  });

  it("sanitizes SQL errors and preserves a retry path", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "SECRET" } });
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET");
  });
});
