import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  canUseToccDraft: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/tocc-draft", () => ({ canUseToccDraft: stubs.canUseToccDraft }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => {
    try { return await fn("e0a00000-0000-4000-8000-000000000099"); }
    catch (error) {
      const value = error as { code?: string; httpStatus?: number };
      return Response.json({ status: "error", data: null,
        errors: [{ code: value.code ?? "UNEXPECTED" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST as save } from "./route";
import { POST as sign } from "./sign/route";

const key = "e0a00000-0000-4000-8000-000000000001";
const draftKey = "e0900000-0000-4000-8000-000000000001";
const versionId = "e0900000-0000-4000-8000-000000000002";
const clientId = "e0800000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const actor = {
  organizationId: "e0500000-0000-4000-8000-000000000001",
  branchId: "e0600000-0000-4000-8000-000000000001",
  assuranceLevel: "aal1", demo: false,
  scopes: ["clients.read", "health.read", "health.write"],
};
const body = {
  action: "create", draft_key: draftKey, previous_version_id: null,
  expected_version: 0, expected_content_hash: null,
  client_id: clientId, assessment_date: "2026-01-01", result_status: "clear",
  symptom_summary: null, risk_summary: null,
  evidence_status: "not_required", action_status: "none_required",
};
const receipt = { draftKey, versionId, clientId, version: 1, contentHash: hash, replayed: false };
const signBody = { draft_key: draftKey, expected_version_id: versionId,
  expected_version: 1, expected_content_hash: hash };

function request(path: string) {
  return new Request(`https://example.invalid${path}`, { method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key }, body: "{}" });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.authorizeStaffRequest.mockResolvedValue(actor);
  stubs.canUseToccDraft.mockResolvedValue(true);
  stubs.readJsonObject.mockResolvedValue(body);
  stubs.requireRecentAal2.mockResolvedValue(undefined);
  stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockResolvedValue({ data: receipt, error: null });
});

describe("TOCC unsigned draft API", () => {
  it("accepts a scoped AAL1 save and sends only server-validated fields to the draft RPC", async () => {
    const response = await save(request("/api/client-tocc/drafts"));
    expect(response.status).toBe(201);
    expect(stubs.authorizeStaffRequest).toHaveBeenCalledWith({ routinePermission: "health.write" });
    expect(stubs.canUseToccDraft).toHaveBeenCalledWith(actor, null, true);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith("save_client_tocc_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: "create", p_idempotency_key: key,
      p_payload: { client_id: clientId, draft_key: draftKey,
        previous_version_id: null, expected_version: 0, expected_content_hash: null,
        assessment_date: "2026-01-01", result_status: "clear",
        symptom_summary: null, risk_summary: null,
        evidence_status: "not_required", action_status: "none_required" },
    });
  });

  it("denies absent scope before reading clinical content", async () => {
    stubs.canUseToccDraft.mockResolvedValue(false);
    expect((await save(request("/api/client-tocc/drafts"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale and malformed revisions before reaching the database", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...body, action: "revise", expected_version: 1 });
    expect((await save(request("/api/client-tocc/drafts"))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects mismatched receipts and maps database conflict without leaking SQL text", async () => {
    stubs.rpc.mockResolvedValueOnce({ data: { ...receipt, clientId: draftKey }, error: null });
    expect((await save(request("/api/client-tocc/drafts"))).status).toBe(409);
    stubs.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409", message: "secret clinical text" } });
    const response = await save(request("/api/client-tocc/drafts"));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret clinical text");
  });

  it("requires actual AAL2 authorization before reading a signing request", async () => {
    stubs.authorizeStaffRequest.mockRejectedValue(Object.assign(new Error("AAL2"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await sign(request("/api/client-tocc/drafts/sign"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before parsing draft content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, assuranceLevel: "aal2" });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("stale"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await sign(request("/api/client-tocc/drafts/sign"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("signs exactly the submitted immutable draft version through its AAL2 RPC", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, assuranceLevel: "aal2" });
    stubs.readJsonObject.mockResolvedValue(signBody);
    stubs.rpc.mockResolvedValue({ data: { draftKey, versionId,
      assessmentId: "e0800000-0000-4000-8000-000000000009", replayed: false }, error: null });
    expect((await sign(request("/api/client-tocc/drafts/sign"))).status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
    expect(stubs.rpc).toHaveBeenCalledWith("sign_client_tocc_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_draft_key: draftKey, p_expected_version_id: versionId,
      p_expected_version: 1, p_expected_content_hash: hash,
      p_idempotency_key: key,
    });
  });

  it("maps a stale sign request to a non-retryable conflict without leaking clinical SQL text", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, assuranceLevel: "aal2" });
    stubs.readJsonObject.mockResolvedValue(signBody);
    stubs.rpc.mockResolvedValue({ data: null,
      error: { code: "PT409", message: "secret clinical text" } });
    const response = await sign(request("/api/client-tocc/drafts/sign"));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret clinical text");
  });
});
