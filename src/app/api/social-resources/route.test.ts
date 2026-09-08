import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "31000000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: typeof candidate.code === "string" ? candidate.code : "ERROR",
          message: typeof candidate.message === "string" ? candidate.message : "error",
        }],
      }, {
        status: typeof candidate.httpStatus === "number" ? candidate.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "31000000-0000-4000-8000-000000000001";
const branchId = "31000000-0000-4000-8000-000000000002";
const resourceId = "31000000-0000-4000-8000-000000000010";
const idempotency = "31000000-0000-4000-8000-000000000020";
const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: "31000000-0000-4000-8000-000000000003",
  displayName: "測試社工",
  roles: ["case_manager_social_worker"],
  scopes: ["social_resources.read", "social_resources.manage"],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};
const createBody = {
  action: "create",
  referenceYear: 2026,
  name: "社區窗口",
  resourceType: "社區支持",
  audienceState: "provided",
  audienceDetail: "主要照顧者",
  eligibilityState: "missing",
  eligibilityDetail: null,
  contactState: "not_applicable",
  contactDetail: null,
  validityState: "date_range",
  validFrom: "2026-01-01",
  validUntil: "2026-12-31",
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/social-resources", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotency,
    },
    body: "{}",
  });
}

describe("social resource API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    ["demo", { ...actor, demo: true }, "DEMO_READ_ONLY"],
    ["missing manage scope", { ...actor, scopes: ["social_resources.read"] }, "SOCIAL_RESOURCE_NOT_AUTHORIZED"],
  ])("rejects %s before reading the body", async (_label, deniedActor, expectedCode) => {
    stubs.authorizeStaffRequest.mockResolvedValue(deniedActor);
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe(expectedCode);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("returns an exact persisted create receipt and binds scope from the actor", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: {
        operation_id: "31000000-0000-4000-8000-000000000021",
        resource_id: resourceId,
        row_version: 1,
        status: "active",
        last_confirmed_on: null,
        replayed: false,
      },
      error: null,
    });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(body).toEqual({
      requestId: "31000000-0000-4000-8000-000000000099",
      status: "ok",
      data: {
        operationId: "31000000-0000-4000-8000-000000000021",
        resourceId,
        rowVersion: 1,
        status: "active",
        lastConfirmedOn: null,
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    });
    expect(stubs.rpc).toHaveBeenCalledWith("create_social_resource", expect.objectContaining({
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_idempotency_key: idempotency,
    }));
    expect(stubs.authorizeStaffRequest).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a database receipt contains an unexpected field", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: {
        operation_id: "31000000-0000-4000-8000-000000000021",
        resource_id: resourceId,
        row_version: 1,
        status: "active",
        last_confirmed_on: null,
        replayed: false,
        actor_user_id: actor.userId,
      },
      error: null,
    });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("SOCIAL_RESOURCE_RECEIPT_INVALID");
    expect(JSON.stringify(body)).not.toContain(actor.userId);
  });

  it("maps a PATCH version conflict without returning database details", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "confirm",
      resourceId,
      expectedRowVersion: 2,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "private conflicting row" },
    });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe("SOCIAL_RESOURCE_VERSION_CONFLICT");
    expect(JSON.stringify(body)).not.toContain("private conflicting row");
  });
});
