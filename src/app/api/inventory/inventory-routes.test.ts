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
    const requestId = "77000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST as saveItem } from "./items/route";
import { POST as saveMovement } from "./movements/route";

const ORG = "77000000-0000-4000-8000-000000000001";
const BRANCH = "77000000-0000-4000-8000-000000000002";
const ACTOR = "77000000-0000-4000-8000-000000000003";
const ITEM = "77000000-0000-4000-8000-000000000004";
const BATCH = "77000000-0000-4000-8000-000000000005";
const MOVEMENT = "77000000-0000-4000-8000-000000000006";
const KEY = "77000000-0000-4000-8000-000000000007";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH, branchName: "分支",
  userId: ACTOR, displayName: "主管", roles: ["branch_supervisor"],
  scopes: ["inventory.read", "inventory.manage", "inventory.adjust"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const movementBody = {
  item_id: ITEM, batch_id: BATCH, new_batch_number: null, new_expiry_date: null,
  new_unit: null, movement_type: "issue", quantity: "2.0000",
  adjustment_delta: null, counted_quantity: null, original_movement_id: null,
  client_id: null, instruction_reference: null, issued_to_user_id: null,
  purpose: "照顧使用", destination_unit: "日照區", reason: null,
  occurred_at: "2026-09-01T09:00:00+08:00", expected_ledger_version: 1,
};
function request(path: string) {
  return new Request(`https://example.invalid${path}`, { method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "{}" });
}

describe("page-77 inventory API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects item writes without manage scope before body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: ["inventory.read"] });
    const response = await saveItem(request("/api/inventory/items"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects demo movement writes before body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await saveMovement(request("/api/inventory/movements"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds item creation to actor-scoped idempotency and strict receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "create", item_code: "GLOVE",
      item_name: "手套", unit: "盒" });
    stubs.maybeSingle.mockResolvedValue({ data: { item_id: ITEM,
      organization_id: ORG, branch_id: BRANCH, item_code: "GLOVE", unit: "盒",
      status: "active", status_ledger_version: 1,
      committed_at: "2026-09-01T09:00:00+08:00", replayed: false }, error: null });
    const response = await saveItem(request("/api/inventory/items"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      itemId: ITEM, organizationId: ORG, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("create_inventory_item", expect.objectContaining({
      p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
      p_idempotency_key: deterministicUuid("page77-inventory-item", ORG, ACTOR, KEY),
    }));
  });

  it("sanitizes DB detail and fails closed for cross-branch item receipts", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "create", item_code: "GLOVE",
      item_name: "手套", unit: "盒" });
    stubs.maybeSingle.mockResolvedValue({ data: { item_id: ITEM,
      organization_id: ORG, branch_id: ITEM, item_code: "GLOVE", unit: "盒",
      status: "active", status_ledger_version: 1,
      committed_at: "2026-09-01T09:00:00+08:00", replayed: false }, error: null });
    let response = await saveItem(request("/api/inventory/items"));
    expect(response.status).toBe(409);
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private tenant row" } });
    response = await saveItem(request("/api/inventory/items"));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private tenant row");
  });

  it("writes a routine movement without a recent-reauth check and correlates every RPC field", async () => {
    stubs.readJsonObject.mockResolvedValue(movementBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG, branch_id: BRANCH,
      item_id: ITEM, batch_id: BATCH, movement_id: MOVEMENT, movement_type: "issue",
      ledger_version: 2, quantity: "2.0000", quantity_delta: "-2.0000",
      balance_after: "3.0000", occurred_at: "2026-09-01T09:00:00+08:00",
      replayed: false }, error: null });
    const response = await saveMovement(request("/api/inventory/movements"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith("record_inventory_movement", expect.objectContaining({
      p_item_id: ITEM, p_batch_id: BATCH, p_movement_type: "issue",
      p_expected_ledger_version: 1,
      p_idempotency_key: deterministicUuid("page77-inventory-movement", ORG, ACTOR, KEY),
    }));
  });

  it("requires adjust scope and recent AAL2 before a high-risk RPC", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...movementBody, movement_type: "adjustment",
      quantity: null, adjustment_delta: "-1.0000", purpose: null,
      destination_unit: null, reason: "盤差" });
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["inventory.read", "inventory.manage"] });
    let response = await saveMovement(request("/api/inventory/movements"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    response = await saveMovement(request("/api/inventory/movements"));
    expect(response.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { organization_id: ORG, branch_id: ITEM, item_id: ITEM, batch_id: BATCH,
      movement_id: MOVEMENT, movement_type: "issue", ledger_version: 2,
      quantity: "2.0000", quantity_delta: "-2.0000", balance_after: "3.0000",
      occurred_at: "2026-09-01T09:00:00+08:00", replayed: false },
    { organization_id: ORG, branch_id: BRANCH, item_id: ITEM, batch_id: BATCH,
      movement_id: MOVEMENT, movement_type: "issue", ledger_version: 2,
      quantity: "2.0001", quantity_delta: "-2.0001", balance_after: "3.0000",
      occurred_at: "2026-09-01T09:00:00+08:00", replayed: false },
  ])("fails closed on a malicious movement receipt %#", async (data) => {
    stubs.readJsonObject.mockResolvedValue(movementBody);
    stubs.maybeSingle.mockResolvedValue({ data, error: null });
    const response = await saveMovement(request("/api/inventory/movements"));
    expect(response.status).toBe(409);
  });
});
