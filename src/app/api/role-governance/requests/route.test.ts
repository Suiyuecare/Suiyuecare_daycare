import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "81000000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const known = error as {
        code?: string;
        message?: string;
        httpStatus?: number;
      };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: known.code ?? "INTERNAL",
          message: known.message ?? "failed",
        }],
      }, {
        status: known.httpStatus ?? 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const actor = {
  organizationId: "81000000-0000-4000-8000-000000000001",
  organizationName: "測試機構",
  branchId: "81000000-0000-4000-8000-000000000002",
  branchName: "測試分支",
  userId: "81000000-0000-4000-8000-000000000003",
  displayName: "測試人員",
  roles: ["organization_manager"],
  scopes: ["roles.manage"],
  assuranceLevel: "aal2",
  recentAal2At: new Date().toISOString(),
  demo: false,
};

function request(key: string) {
  return new Request("https://example.invalid/api/role-governance/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: "{}",
  });
}

describe("role governance request route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue({
      operation: "create_role",
      role_key: "new_role",
      role_name: "新角色",
      role_description: "最小正式角色",
    });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects demo before reading the body and returns private no-store", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await POST(request("81000000-0000-4000-8000-000000000010"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects an AAL1 staff session before reading the body", async () => {
    stubs.authorizeStaffRequest.mockRejectedValue(
      Object.assign(new Error("所有員工作業都必須先完成雙因素驗證。"), {
        code: "AAL2_REQUIRED",
        httpStatus: 403,
      }),
    );
    const response = await POST(request("81000000-0000-4000-8000-000000000013"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects expired step-up evidence before reading the body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(
      Object.assign(new Error("這項操作需要最近 15 分鐘內重新完成雙因素驗證。"), {
        code: "AAL2_REQUIRED",
        httpStatus: 403,
      }),
    );
    const response = await POST(request("81000000-0000-4000-8000-000000000014"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("derives one server-owned role id for exact network retries", async () => {
    stubs.maybeSingle
      .mockResolvedValueOnce({
        data: {
          request_id: "81000000-0000-4000-8000-000000000020",
          status: "pending",
          replayed: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          request_id: "81000000-0000-4000-8000-000000000020",
          status: "pending",
          replayed: true,
        },
        error: null,
      });
    const key = "81000000-0000-4000-8000-000000000011";
    const first = await POST(request(key));
    const second = await POST(request(key));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstArgs = stubs.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const secondArgs = stubs.rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(firstArgs.p_target_role_id).toBe(secondArgs.p_target_role_id);
    expect(firstArgs.p_target_role_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(firstArgs.p_role_description).toBe("最小正式角色");
    const receipt = await first.json();
    expect(receipt).not.toHaveProperty("request_hash");
    expect(JSON.stringify(receipt)).not.toContain("challenge");
    expect(receipt.data.governanceRequest).toMatchObject({
      roleKey: "new_role",
      roleName: "新角色",
      roleDescription: "最小正式角色",
    });
  });

  it("maps a changed-content same-key conflict without leaking database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "sensitive database detail" },
    });
    const response = await POST(request("81000000-0000-4000-8000-000000000012"));
    const receipt = await response.json();
    expect(response.status).toBe(409);
    expect(receipt.errors[0].code).toBe("ROLE_GOVERNANCE_IDEMPOTENCY_CONFLICT");
    expect(JSON.stringify(receipt)).not.toContain("sensitive database detail");
  });
});
