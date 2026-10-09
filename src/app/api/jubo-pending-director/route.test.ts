import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));

import { GET, POST } from "./route";

const organizationId = "bb140000-0000-4000-8000-000000000001";
const branchId = "bb150000-0000-4000-8000-000000000001";
const otherBranchId = "bb150000-0000-4000-8000-000000000002";
const clientId = "bb240000-0000-4000-8000-000000000001";
const idempotencyKey = "bb290000-0000-4000-8000-000000000001";
const actor = {
  organizationId, branchId, branchName: "合成分支", userId: "bb100000-0000-4000-8000-000000000001",
  roles: ["branch_director"], scopes: ["clients.jubo_pending_source.read", "clients.intake_draft.manage"],
  assuranceLevel: "aal1", demo: false,
};
const directory = {
  clients: [{ clientId, displayName: "合成個案甲", clientCode: "SYNTHETIC-JUBO-1", sourceStatus: "服務中" }],
  total: 1,
};
const fieldKeys = [
  "displayName", "sex", "dateOfBirth", "identityNumber", "registeredAddress", "residentialAddress",
  "cmsLevel", "disability", "primaryContactName", "primaryContactPhone", "proxyName", "proxyPhone",
];
const workspace = {
  clientId, clientCode: "SYNTHETIC-JUBO-1", displayName: "合成個案甲", status: "pending",
  sourceSystem: "jubo", sourceStatus: "服務中", sourceFirstServiceOn: null, profileVersion: 1,
  humanReview: { decision: "approved", version: 1, reviewedAt: "2026-10-09T00:00:00Z" },
  normalizationFieldIndices: { nfkc: [], contactSeparator: [] },
  fields: fieldKeys.map((key) => ({ key, label: key,
    original: key === "identityNumber" ? "••••0001" : null,
    display: key === "identityNumber" ? "••••0001" : null })),
  localSupplement: null, assessmentPreparations: [], formalRecord: false, formalOperationsAllowed: false,
};
const draft = {
  clientId, kind: "local_supplement", formKey: "intake_local", expectedRevision: 0,
  payload: { contactPreference: "phone", visitPlanningNote: "合成到站討論", followUpNote: "" },
  idempotency_key: idempotencyKey,
};
const receipt = {
  draftId: "bb280000-0000-4000-8000-000000000001", revision: 1,
  kind: "local_supplement", formKey: "intake_local", replayed: false, formalRecord: false,
};

function get(query = "") {
  return new Request(`https://daycare.example.invalid/api/jubo-pending-director${query}`);
}
function post(body: unknown = draft, contentType = "application/json") {
  return new Request("https://daycare.example.invalid/api/jubo-pending-director", {
    method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body),
  });
}
function mockSave(replayed = false) {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "save_jubo_pending_director_draft" ? { ...receipt, replayed }
      : { ...workspace, localSupplement: { revision: 1, payload: draft.payload } },
    error: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(actor);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "jubo_pending_director_directory" ? directory : workspace,
    error: null,
  }));
});

describe("director pending JUBO API boundary", () => {
  it.each(["GET", "POST"])("rejects unauthenticated %s before database access", async (method) => {
    mocks.context.mockResolvedValue(null);
    const response = method === "GET" ? await GET(get()) : await POST(post());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    { ...actor, demo: true },
    { ...actor, roles: ["branch_supervisor"] },
    { ...actor, scopes: ["clients.jubo_pending_source.read"] },
    { ...actor, scopes: ["clients.intake_draft.manage"] },
    { ...actor, branchId: null },
  ])("rejects non-director, unscoped, demo or missing-branch context", async (context) => {
    mocks.context.mockResolvedValue(context);
    expect((await GET(get())).status).toBe(403);
    expect((await POST(post())).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("reads only the actor's branch directory with a no-store envelope", async () => {
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect((await response.json()).data).toEqual(directory);
    expect(mocks.rpc).toHaveBeenCalledWith("jubo_pending_director_directory", {
      p_org: organizationId, p_branch: branchId,
    });
  });

  it("reads one exact client without returning a full identity or formal operation", async () => {
    const response = await GET(get(`?client=${clientId}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ clientId, status: "pending", formalOperationsAllowed: false });
    expect(JSON.stringify(body)).not.toContain("SYNTH0001");
    expect(mocks.rpc).toHaveBeenCalledWith("jubo_pending_director_source_workspace", {
      p_org: organizationId, p_branch: branchId, p_client: clientId,
    });
  });

  it("rejects invalid query shape and client before a workspace RPC", async () => {
    expect((await GET(get("?client=bad&extra=1"))).status).toBe(400);
    expect((await GET(get("?client=bad"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the database denies the actor's selected branch", async () => {
    mocks.context.mockResolvedValue({ ...actor, branchId: otherBranchId });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private source detail" } });
    const response = await GET(get(`?client=${clientId}`));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private source detail");
    expect(mocks.rpc).toHaveBeenCalledWith("jubo_pending_director_source_workspace", {
      p_org: organizationId, p_branch: otherBranchId, p_client: clientId,
    });
  });

  it("denies a cross-branch draft write without exposing database details", async () => {
    mocks.context.mockResolvedValue({ ...actor, branchId: otherBranchId });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private draft detail" } });
    const response = await POST(post());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private draft detail");
    expect(mocks.rpc).toHaveBeenCalledWith("save_jubo_pending_director_draft", expect.objectContaining({
      p_org: organizationId, p_branch: otherBranchId, p_client: clientId,
    }));
  });

  it.each(["original", "display"] as const)("rejects an unmasked %s identity in the RPC reply", async (column) => {
    const fields = workspace.fields.map((field) => field.key === "identityNumber"
      ? { ...field, [column]: "SYNTH0001" } : field);
    mocks.rpc.mockResolvedValue({ data: { ...workspace, fields }, error: null });
    const response = await GET(get(`?client=${clientId}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SYNTH0001");
  });

  it("rejects a replaced or reordered source field before any data is returned", async () => {
    const fields = workspace.fields.map((field, index) => index === 3
      ? { ...field, key: "fullIdentity", original: "SYNTH0001" } : field);
    mocks.rpc.mockResolvedValue({ data: { ...workspace, fields }, error: null });
    const response = await GET(get(`?client=${clientId}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SYNTH0001");

    const reordered = [...workspace.fields];
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    mocks.rpc.mockResolvedValue({ data: { ...workspace, fields: reordered }, error: null });
    expect((await GET(get(`?client=${clientId}`))).status).toBe(503);
  });

  it("rejects non-JSON, oversized and malformed draft input before the database", async () => {
    expect((await POST(post(draft, "text/plain"))).status).toBe(415);
    expect((await POST(post({ ...draft, payload: { followUpNote: "x".repeat(17000) } }))).status).toBe(413);
    expect((await POST(post({ ...draft, payload: { admittedOn: "2026-10-09" } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("saves a scoped draft and requires a matching readback, never a formal receipt", async () => {
    mockSave();
    const response = await POST(post());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.data.receipt).toEqual(receipt);
    expect(body.data.workspace).toMatchObject({ clientId, formalOperationsAllowed: false });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "save_jubo_pending_director_draft", {
      p_org: organizationId, p_branch: branchId, p_client: clientId,
      p_kind: draft.kind, p_form_key: draft.formKey, p_expected_revision: draft.expectedRevision,
      p_payload: draft.payload, p_idempotency_key: idempotencyKey,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "jubo_pending_director_source_workspace", {
      p_org: organizationId, p_branch: branchId, p_client: clientId,
    });
  });

  it("retries the same key without changing request content", async () => {
    mockSave();
    expect((await POST(post())).status).toBe(200);
    mockSave(true);
    const replay = await POST(post());
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.receipt.replayed).toBe(true);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "save_jubo_pending_director_draft")
      .map(([, args]) => args.p_idempotency_key)).toEqual([idempotencyKey, idempotencyKey]);
  });

  it("treats a mismatched, formal or extra-field readback as unconfirmed", async () => {
    mockSave();
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "save_jubo_pending_director_draft" ? receipt
        : { ...workspace, localSupplement: { revision: 1, payload: draft.payload }, formalRecord: true },
      error: null,
    }));
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect((await response.json()).errors[0].code).toBe("JUBO_DIRECTOR_UNAVAILABLE");
  });
});
