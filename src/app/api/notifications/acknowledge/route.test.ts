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
    const requestId = "67a00000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
      };
      return Response.json(
        {
          requestId,
          status: "error",
          data: null,
          errors: [
            {
              code:
                typeof candidate.code === "string" ? candidate.code : "ERROR",
              message:
                typeof candidate.message === "string"
                  ? candidate.message
                  : "error",
            },
          ],
        },
        {
          status:
            typeof candidate.httpStatus === "number"
              ? candidate.httpStatus
              : 500,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const actor = {
  organizationId: "67a00000-0000-4000-8000-000000000001",
  organizationName: "測試機構",
  branchId: "67a00000-0000-4000-8000-000000000002",
  branchName: "測試分支",
  userId: "67a00000-0000-4000-8000-000000000003",
  displayName: "測試人員",
  roles: ["care_worker"],
  scopes: ["notifications.read"],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};
const DELIVERY_ID = "67b00000-0000-4000-8000-000000000001";
const NOTIFICATION_ID = "67b00000-0000-4000-8000-000000000002";
const IDEMPOTENCY = "67b00000-0000-4000-8000-000000000003";

function request() {
  return new Request("https://example.invalid/api/notifications/acknowledge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": IDEMPOTENCY,
    },
    body: "{}",
  });
}

describe("notification acknowledgement route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue({
      delivery_id: DELIVERY_ID,
      target_status: "confirmed",
    });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects demo before reading the body and never returns a fake success", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(body.errors[0].code).toBe("DEMO_WRITE_DISABLED");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing read scope before parsing any body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: [] });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("returns only a strict persisted receipt correlated to the requested delivery", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: {
        acknowledgement_operation_id:
          "67b00000-0000-4000-8000-000000000004",
        notification_delivery_id: DELIVERY_ID,
        notification_id: NOTIFICATION_ID,
        status: "confirmed",
        read_at: "2026-09-01T10:00:00.000Z",
        confirmed_at: "2026-09-01T10:00:00.000Z",
        acknowledged_at: "2026-09-01T10:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(body.status).toBe("ok");
    expect(body.errors).toEqual([]);
    expect(body.data).toEqual({
      operationId: "67b00000-0000-4000-8000-000000000004",
      deliveryId: DELIVERY_ID,
      notificationId: NOTIFICATION_ID,
      status: "confirmed",
      readAt: "2026-09-01T10:00:00.000Z",
      confirmedAt: "2026-09-01T10:00:00.000Z",
      acknowledgedAt: "2026-09-01T10:00:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
    });
  });

  it("fails closed when a 2xx-shaped database receipt targets another delivery", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: {
        acknowledgement_operation_id:
          "67b00000-0000-4000-8000-000000000004",
        notification_delivery_id:
          "67b00000-0000-4000-8000-000000000099",
        notification_id: NOTIFICATION_ID,
        status: "confirmed",
        read_at: "2026-09-01T10:00:00.000Z",
        confirmed_at: "2026-09-01T10:00:00.000Z",
        acknowledged_at: "2026-09-01T10:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe(
      "NOTIFICATION_ACKNOWLEDGEMENT_RESULT_INVALID",
    );
  });

  it("maps idempotency conflicts without leaking database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "private row and hash" },
    });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe(
      "NOTIFICATION_ACKNOWLEDGEMENT_IDEMPOTENCY_CONFLICT",
    );
    expect(JSON.stringify(body)).not.toContain("private row and hash");
  });
});
