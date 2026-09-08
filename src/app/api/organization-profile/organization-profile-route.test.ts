import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "58000000-0000-4000-8000-000000000099";
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

import { PATCH, POST } from "./route";

const ORG = "58000000-0000-4000-8000-000000000001";
const BRANCH = "58000000-0000-4000-8000-000000000002";
const ACTOR = "58000000-0000-4000-8000-000000000003";
const KEY = "58000000-0000-4000-8000-000000000004";
const PROFILE = "58000000-0000-4000-8000-000000000005";
const PROPOSAL = "58000000-0000-4000-8000-000000000006";
const PROPOSAL_KEY = "58000000-0000-4000-8000-000000000007";
const VERSION = "58000000-0000-4000-8000-000000000008";
const DECISION = "58000000-0000-4000-8000-000000000009";
const SERVICE = "58000000-0000-4000-8000-000000000010";
const RATE = "58000000-0000-4000-8000-000000000011";
const HASH = "a".repeat(64);
const scopes = ["organization_profile.read", "organization_profile.manage",
  "organization_profile.approve", "organization_profile.permit.manage",
  "organization_profile.services.manage", "organization_profile.rates.manage",
  "organization_profile.capacity.manage", "organization_profile.contact.manage"];
const actor = { organizationId: ORG, organizationName: "合成機構",
  branchId: BRANCH, branchName: "合成分支", userId: ACTOR,
  displayName: "合成主管", roles: ["branch_supervisor"], scopes,
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const proposalBody = { action: "propose", proposal_action: "create",
  proposal_key: PROPOSAL_KEY, profile_key: PROFILE, base_version_id: null,
  expected_base_version: 0, effective_from: "2026-01-01",
  effective_to: "2026-12-31", permit_number: "合成許可",
  permit_issuing_authority: "合成發證單位", permit_issued_on: "2025-12-01",
  permit_valid_through: "2026-12-31", permit_status_text: "人工有效",
  organization_type_text: "合成類型", service_items: [{ service_key: SERVICE,
    name: "合成服務", description: null,
    taxonomy_status: "manual_unstandardized" }],
  rate_items: [{ rate_key: RATE, label: "合成費目",
    amount_decimal_text: "001200.00", currency_code: "TWD",
    effective_from: "2026-01-01", effective_to: "2026-12-31",
    taxonomy_status: "manual_unstandardized" }],
  approved_capacity: 30, capacity_unit_text: "合成人數單位",
  capacity_basis_text: "合成依據", contact_name: "合成窗口",
  contact_phone: "02-0000-0000", contact_email: "synthetic@example.invalid",
  contact_address: "合成地址", change_reason: "建立合成版本" };
const decisionBody = { action: "decide", proposal_id: PROPOSAL,
  expected_proposal_number: 1, expected_base_version: 0,
  expected_profile_key: PROFILE, expected_content_hash: HASH,
  expected_effective_from: "2026-01-01", expected_effective_to: "2026-12-31",
  decision: "approve", decision_reason: "獨立核准" };

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/organization-profile", {
    method, headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "{}",
  });
}
function proposalResult(override: Record<string, unknown> = {}) {
  return { data: { organization_id: ORG, branch_id: BRANCH,
    proposal_id: PROPOSAL, proposal_key: PROPOSAL_KEY, proposal_number: 1,
    proposal_status: "pending", action: "create", profile_key: PROFILE,
    expected_base_version: 0, content_hash: HASH,
    proposed_at: "2026-09-02T04:00:00.000Z", replayed: false, ...override },
    error: null };
}
function decisionResult(override: Record<string, unknown> = {}) {
  return { data: { organization_id: ORG, branch_id: BRANCH,
    proposal_id: PROPOSAL, decision_id: DECISION, decision: "approve",
    proposal_status: "approved", result_version_id: VERSION,
    profile_key: PROFILE, result_version: 1, effective_from: "2026-01-01",
    effective_to: "2026-12-31", content_hash: HASH,
    decided_at: "2026-09-02T04:00:00.000Z", replayed: false, ...override },
    error: null };
}

describe("Page-58 organization profile API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    { ...actor, scopes: scopes.filter((scope) => scope !== "organization_profile.manage") },
    { ...actor, scopes: scopes.filter((scope) => scope !== "organization_profile.rates.manage") },
    { ...actor, assuranceLevel: "aal1" }, { ...actor, demo: true },
  ])("rejects proposal writes before parsing business content %#", async (value) => {
    stubs.authorizeStaffRequest.mockResolvedValue(value);
    expect((await POST(request("POST"))).status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects decision writes without approve scope before parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: scopes.filter((scope) => scope !== "organization_profile.approve") });
    expect((await PATCH(request("PATCH"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before parsing either body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("請重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    expect((await POST(request("POST"))).status).toBe(403);
    expect((await PATCH(request("PATCH"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds proposal tenant, exact rate text, field content, and actor key", async () => {
    stubs.readJsonObject.mockResolvedValue(proposalBody);
    stubs.maybeSingle.mockResolvedValue(proposalResult());
    const response = await POST(request("POST"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("submit_organization_profile_proposal",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_rate_items: [expect.objectContaining({
          amount_decimal_text: "001200.00", taxonomy_status: "manual_unstandardized",
        })], p_contact_email: "synthetic@example.invalid",
        p_idempotency_key: deterministicUuid(
          "page58-organization-profile-proposal", ORG, ACTOR, KEY,
        ) }));
  });

  it("rejects unknown attachment and sync fields before persistence", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...proposalBody,
      attachment_reference: "browser://fake", regulator_sync: true });
    expect((await POST(request("POST"))).status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("fails closed on mismatched proposal receipts", async () => {
    stubs.readJsonObject.mockResolvedValue(proposalBody);
    for (const override of [{ branch_id: ACTOR }, { action: "correct" },
      { expected_base_version: 1 }, { profile_key: ACTOR }]) {
      stubs.maybeSingle.mockResolvedValue(proposalResult(override));
      expect((await POST(request("POST"))).status).toBe(409);
    }
  });

  it("binds decision tenant and exact expected proposal version", async () => {
    stubs.readJsonObject.mockResolvedValue(decisionBody);
    stubs.maybeSingle.mockResolvedValue(decisionResult());
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("decide_organization_profile_proposal",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_proposal_id: PROPOSAL,
        p_expected_proposal_number: 1, p_expected_base_version: 0,
        p_idempotency_key: deterministicUuid(
          "page58-organization-profile-decision", ORG, ACTOR, KEY,
        ) }));
  });

  it("accepts a strict nullable reject receipt and uses 200 only for replay", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...decisionBody,
      decision: "reject", decision_reason: "資料仍需確認" });
    stubs.maybeSingle.mockResolvedValue(decisionResult({ decision: "reject",
      proposal_status: "rejected", result_version_id: null, result_version: null,
      effective_from: null, effective_to: null, replayed: true }));
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.receipt).toMatchObject({
      proposalStatus: "rejected", resultVersionId: null, replayed: true,
    });
  });

  it("does not expose private database content on failure", async () => {
    stubs.readJsonObject.mockResolvedValue(proposalBody);
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "合成許可與地址不應洩漏" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("合成許可與地址");
  });
});
