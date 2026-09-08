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
        errors: [{ code: known.code ?? "INTERNAL", message: known.message ?? "failed" }],
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

const requestId = "81000000-0000-4000-8000-000000000011";
const actor = {
  organizationId: "81000000-0000-4000-8000-000000000001",
  branchId: "81000000-0000-4000-8000-000000000002",
  userId: "81000000-0000-4000-8000-000000000003",
  scopes: ["roles.manage"],
  assuranceLevel: "aal2",
  demo: false,
};

function request() {
  return new Request("https://example.invalid/api/role-governance/approve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "81000000-0000-4000-8000-000000000010",
    },
    body: "{}",
  });
}

describe("role governance approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue({ request_id: requestId });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects demo before reading the body or touching the database", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns a complete persisted receipt without governance evidence", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: {
        request_id: requestId,
        status: "approved",
        applied_at: "2026-09-01T10:00:00+08:00",
        replayed: false,
      },
      error: null,
    });
    const response = await POST(request());
    const receipt = await response.json();

    expect(response.status).toBe(200);
    expect(receipt.status).toBe("ok");
    expect(receipt.errors).toEqual([]);
    expect(receipt.data).toMatchObject({
      replayed: false,
      persisted: true,
      demo: false,
      governanceRequest: {
        id: requestId,
        status: "approved",
        appliedAt: "2026-09-01T02:00:00.000Z",
      },
    });
    expect(JSON.stringify(receipt)).not.toMatch(/challenge|hash|idempotency/iu);
  });

  it("maps self-approval or stale authority to a private 403", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "sensitive database detail" },
    });
    const response = await POST(request());
    const receipt = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(receipt.errors[0].code).toBe(
      "ROLE_GOVERNANCE_APPROVAL_NOT_AUTHORIZED",
    );
    expect(JSON.stringify(receipt)).not.toContain("sensitive database detail");
  });
});
