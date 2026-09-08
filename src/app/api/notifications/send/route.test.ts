import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

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
    const requestId = "45a00000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
        field?: unknown;
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
              ...(typeof candidate.field === "string"
                ? { field: candidate.field }
                : {}),
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
  organizationId: "45a00000-0000-4000-8000-000000000001",
  organizationName: "測試機構",
  branchId: "45a00000-0000-4000-8000-000000000002",
  branchName: "測試分支",
  userId: "45a00000-0000-4000-8000-000000000003",
  displayName: "通知管理員",
  roles: ["branch_supervisor"],
  scopes: ["notifications.manage"],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};
const RECIPIENT_ID = "45a00000-0000-4000-8000-000000000004";
const DEMO_RECIPIENT_ID = "45111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = "45a00000-0000-4000-8000-000000000005";

function body(mode: "preview" | "queue", recipient = RECIPIENT_ID) {
  return {
    mode,
    category: "工作提醒",
    priority: 2,
    title: "工作安排已更新",
    body: "請登入系統查看最新內容。",
    recipient_user_ids: [recipient],
    channels: ["in_app"],
    scheduled_for: null,
  };
}

function request() {
  return new Request("https://example.invalid/api/notifications/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": IDEMPOTENCY_KEY,
    },
    body: "{}",
  });
}

describe("page-45 notification send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body("preview"));
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects a missing manage scope before reading the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: [] });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(payload.errors[0].code).toBe("PUSH_NOTIFICATION_NOT_AUTHORIZED");
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before parsing any production body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(
      Object.assign(new Error("需要重新驗證"), {
        code: "AAL2_REQUIRED",
        httpStatus: 403,
      }),
    );
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("returns a real audited recipient preview without persistence claims", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: {
        organization_id: actor.organizationId,
        branch_id: actor.branchId,
        generated_at: "2026-09-01T02:00:00.000Z",
        recipients: [
          {
            user_id: RECIPIENT_ID,
            display_name: "測試員工",
            profile_kind: "staff",
          },
        ],
        recipient_count: 1,
        channel: "in_app",
        persisted: false,
      },
      error: null,
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      mode: "preview",
      queued: false,
      persisted: false,
      demo: false,
      preview: {
        recipientCount: 1,
        deliveryCount: 1,
        channel: "in_app",
        persisted: false,
      },
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "preview_in_app_staff_notification_recipients",
      expect.objectContaining({ p_recipient_user_ids: [RECIPIENT_ID] }),
    );
  });

  it("lets demo preview only its synthetic allowlist without calling the database", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true, scopes: [] });
    stubs.readJsonObject.mockResolvedValue(body("preview", DEMO_RECIPIENT_ID));
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      mode: "preview",
      queued: false,
      persisted: false,
      demo: true,
      preview: { recipientCount: 1, demo: true },
    });
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects demo queue and never returns a fake persisted receipt", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true, scopes: [] });
    stubs.readJsonObject.mockResolvedValue(body("queue", DEMO_RECIPIENT_ID));
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload.errors[0].code).toBe("DEMO_WRITE_DISABLED");
    expect(JSON.stringify(payload)).not.toContain('"persisted":true');
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("queues through the in-app-only RPC and returns a strict persisted receipt", async () => {
    stubs.readJsonObject.mockResolvedValue(body("queue"));
    stubs.maybeSingle.mockResolvedValue({
      data: {
        notification_id: "45a00000-0000-4000-8000-000000000006",
        delivery_count: 1,
        notification_status: "scheduled",
        scheduled_for: "2026-09-01T02:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(payload.data).toEqual({
      mode: "queue",
      receipt: {
        notificationId: "45a00000-0000-4000-8000-000000000006",
        deliveryCount: 1,
        notificationStatus: "scheduled",
        deliveryStatus: "queued",
        channel: "in_app",
        scheduledFor: "2026-09-01T02:00:00.000Z",
        replayed: false,
        persisted: true,
        demo: false,
      },
      queued: true,
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "enqueue_in_app_staff_notification",
      {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_category: "工作提醒",
        p_priority: 2,
        p_title: "工作安排已更新",
        p_body: "請登入系統查看最新內容。",
        p_recipient_user_ids: [RECIPIENT_ID],
        p_scheduled_for: null,
        p_idempotency_key: deterministicUuid(
          "page45-in-app-staff-notification",
          actor.organizationId,
          actor.userId,
          IDEMPOTENCY_KEY,
        ),
      },
    );
  });

  it("returns exact replay as 200 and does not claim a new row", async () => {
    stubs.readJsonObject.mockResolvedValue(body("queue"));
    stubs.maybeSingle.mockResolvedValue({
      data: {
        notification_id: "45a00000-0000-4000-8000-000000000006",
        delivery_count: 1,
        notification_status: "scheduled",
        scheduled_for: "2026-09-01T02:00:00.000Z",
        replayed: true,
      },
      error: null,
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.receipt.replayed).toBe(true);
  });

  it("fails closed on a malformed 2xx-shaped receipt", async () => {
    stubs.readJsonObject.mockResolvedValue(body("queue"));
    stubs.maybeSingle.mockResolvedValue({
      data: {
        notification_id: "45a00000-0000-4000-8000-000000000006",
        delivery_count: 2,
        notification_status: "scheduled",
        scheduled_for: "2026-09-01T02:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.errors[0].code).toBe("PUSH_NOTIFICATION_RESULT_INVALID");
  });

  it("maps recipient scope denial without leaking database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private family row" },
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload.errors[0].code).toBe("PUSH_NOTIFICATION_NOT_AUTHORIZED");
    expect(JSON.stringify(payload)).not.toContain("private family row");
  });
});
