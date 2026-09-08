import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "66000000-0000-4000-8000-000000000099";
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

const ORG = "66000000-0000-4000-8000-000000000001";
const BRANCH = "66000000-0000-4000-8000-000000000002";
const ACTOR = "66000000-0000-4000-8000-000000000003";
const EVENT = "66000000-0000-4000-8000-000000000004";
const STAFF = "66000000-0000-4000-8000-000000000005";
const KEY = "66000000-0000-4000-8000-000000000006";
const OPERATION = "66000000-0000-4000-8000-000000000007";
const CORRECTION = "66000000-0000-4000-8000-000000000008";
const actor = { organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["hand_hygiene.read", "hand_hygiene.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const body = { action: "correct_match", eventId: EVENT,
  expectedCorrectionSequence: 0, matchStatus: "matched",
  staffMembershipId: STAFF, reason: "確認事件發生時的當班員工" };
const receipt = { organization_id: ORG, branch_id: BRANCH,
  operation_id: OPERATION, event_id: EVENT, correction_id: CORRECTION,
  correction_sequence: 1, match_status: "matched", staff_membership_id: STAFF,
  corrected_at: "2026-09-02T04:00:00.000Z", replayed: false };

function request() {
  return new Request("https://example.invalid/api/hand-hygiene/corrections", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": KEY }, body: "{}",
  });
}

describe("page-66 hand hygiene correction API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
  });

  it("rejects missing scope before reading the sensitive body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["hand_hygiene.read"] });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects demo writes before parsing the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, event, sequence and actor-scoped idempotency", async () => {
    let response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ eventId: EVENT,
      correctionSequence: 1, replayed: false, persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith("correct_hand_hygiene_match",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_event_id: EVENT,
        p_expected_correction_sequence: 0, p_staff_membership_id: STAFF,
        p_idempotency_key: deterministicUuid(
          "page66-hand-hygiene-correction", ORG, ACTOR, KEY,
        ) }));
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, replayed: true },
      error: null });
    response = await POST(request());
    expect(response.status).toBe(200);
  });

  it.each([
    { ...receipt, branch_id: ACTOR },
    { ...receipt, event_id: ACTOR },
    { ...receipt, correction_sequence: 2 },
    { ...receipt, match_status: "unmatched" },
    { ...receipt, staff_membership_id: null },
    { organization_id: ORG, branch_id: BRANCH, private_detail: "secret" },
  ])("fails closed on an uncorrelated database receipt %#", async (data) => {
    stubs.maybeSingle.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("maps database authorization and never returns private error detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private staff data" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private staff data");
  });

  it("returns uncertain for an unclassified write failure", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "57014", message: "private timeout detail" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.errors[0].code).toBe("HAND_HYGIENE_SAVE_UNCERTAIN");
    expect(JSON.stringify(payload)).not.toContain("private timeout detail");
  });
});
