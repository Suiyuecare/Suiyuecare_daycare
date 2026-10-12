import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));

import { POST } from "./route";

const organizationId = "bb140000-0000-4000-8000-000000000001";
const branchId = "bb150000-0000-4000-8000-000000000001";
const clientId = "bb240000-0000-4000-8000-000000000001";
const idempotencyKey = "bb290000-0000-4000-8000-000000000001";
const actor = {
  organizationId, branchId, userId: "bb100000-0000-4000-8000-000000000001",
  roles: ["branch_director"], scopes: ["clients.jubo_pending_source.read", "clients.intake_draft.manage"],
  assuranceLevel: "aal1", demo: false,
};
const exactReceipt = {
  found: true, clientId, expectedRevision: 0,
  payload: { contactPreference: "phone", visitPlanningNote: "合成規劃" },
  receipt: { draftId: "bb280000-0000-4000-8000-000000000001", revision: 1,
    kind: "local_supplement", formKey: "intake_local", replayed: true, formalRecord: false },
};
function post(body: unknown = { clientId, idempotency_key: idempotencyKey }, contentType = "application/json") {
  return new Request("https://daycare.example.invalid/api/jubo-pending-director/receipt", {
    method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(actor);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: exactReceipt, error: null });
});

describe("exact director draft receipt", () => {
  it("requires current director scope before any private lookup", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await POST(post())).status).toBe(401);
    mocks.context.mockResolvedValue({ ...actor, roles: ["branch_supervisor"] });
    expect((await POST(post())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reads only the original operation key and returns no-store without a write", async () => {
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).data).toEqual(exactReceipt);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("jubo_pending_director_exact_receipt", {
      p_org: organizationId, p_branch: branchId, p_client: clientId, p_idempotency_key: idempotencyKey,
    });
  });

  it("distinguishes absent receipt from confirmed original receipt", async () => {
    mocks.rpc.mockResolvedValue({ data: { found: false }, error: null });
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ found: false });
  });

  it("rejects malformed requests and a mismatched database client", async () => {
    expect((await POST(post({ clientId: "bad", idempotency_key: idempotencyKey }))).status).toBe(400);
    expect((await POST(post(undefined, "text/plain"))).status).toBe(415);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { ...exactReceipt, clientId: "bb240000-0000-4000-8000-000000000002" }, error: null });
    expect((await POST(post())).status).toBe(503);
  });
});
