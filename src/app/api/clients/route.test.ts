import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    try {
      return await operation("60000000-0000-4000-8000-000000000099");
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
      };
      return Response.json(
        {
          requestId: "60000000-0000-4000-8000-000000000099",
          status: "error",
          data: null,
          errors: [{
            code: typeof candidate.code === "string" ? candidate.code : "ERROR",
            message:
              typeof candidate.message === "string"
                ? candidate.message
                : "error",
          }],
        },
        {
          status:
            typeof candidate.httpStatus === "number"
              ? candidate.httpStatus
              : 500,
        },
      );
    }
  },
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

describe("client master API field authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue({
      organizationId: "60000000-0000-4000-8000-000000000001",
      organizationName: "測試機構",
      branchId: "60000000-0000-4000-8000-000000000002",
      branchName: "測試分支",
      userId: "60000000-0000-4000-8000-000000000003",
      displayName: "受限管理者",
      roles: ["branch_supervisor"],
      scopes: ["clients.read", "clients.manage", "clients.view_all"],
      assuranceLevel: "aal2",
      recentAal2At: new Date().toISOString(),
      demo: false,
    });
  });

  it.each([
    ["POST", POST],
    ["PATCH", PATCH],
  ])("rejects %s before parsing or database access without demographic read", async (method, handler) => {
    const response = await handler(
      new Request("https://example.invalid/api/clients", {
        method,
        body: "{}",
      }),
    );
    const body = (await response.json()) as {
      errors: Array<{ code: string; message: string }>;
    };

    expect(response.status).toBe(403);
    expect(body.errors[0]?.code).toBe("CLIENT_MASTER_NOT_AUTHORIZED");
    expect(body.errors[0]?.message).toMatch(/出生日期/u);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
