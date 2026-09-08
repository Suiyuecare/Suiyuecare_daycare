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
    const requestId = "76000000-0000-4000-8000-000000000090";
    try {
      return await operation(requestId);
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
      };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: typeof candidate.code === "string" ? candidate.code : "ERROR",
          message: typeof candidate.message === "string"
            ? candidate.message
            : "error",
        }],
      }, {
        status: typeof candidate.httpStatus === "number"
          ? candidate.httpStatus
          : 500,
      });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "76000000-0000-4000-8000-000000000001";
const branchId = "76000000-0000-4000-8000-000000000002";
const messageId = "76000000-0000-4000-8000-000000000003";
const recipientId = "76000000-0000-4000-8000-000000000004";
const key = "76000000-0000-4000-8000-000000000005";
const actor = {
  organizationId,
  branchId,
  organizationName: "測試機構",
  branchName: "測試分支",
  userId: "76000000-0000-4000-8000-000000000006",
  displayName: "測試人員",
  roles: ["case_manager_social_worker"],
  scopes: ["consultant_messages.read", "consultant_messages.manage"],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};
const createBody = {
  action: "create",
  subject: "顧問討論",
  body: "請登入系統查看內容。",
  occurredAt: "2026-09-02T09:00:00+08:00",
  recipientUserIds: [recipientId],
  attachments: [],
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/consultant-messages", {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: "{}",
  });
}

describe("consultant message API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant scope and returns a correlated consultant-only create receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      operation_id: "76000000-0000-4000-8000-000000000010",
      message_id: messageId,
      category: "consultant",
      recipient_count: 1,
      published_at: "2026-09-02T01:01:00.000Z",
      replayed: false,
    }, error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      messageId,
      category: "consultant",
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_consultant_message",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_recipient_user_ids: [recipientId],
        p_attachments: [],
        p_idempotency_key: key,
      }),
    );
  });

  it("fails closed on a forged category or recipient count", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      operation_id: "76000000-0000-4000-8000-000000000010",
      message_id: messageId,
      category: "general",
      recipient_count: 2,
      published_at: "2026-09-02T01:01:00.000Z",
      replayed: false,
    }, error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe("CONSULTANT_MESSAGE_RECEIPT_INVALID");
  });

  it("rejects attachments before the database and never accepts a URL or path", async () => {
    stubs.readJsonObject.mockResolvedValue({
      ...createBody,
      attachments: [{
        reference: "https://example.invalid/file.pdf",
        sha256: "a".repeat(64),
      }],
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();

    stubs.readJsonObject.mockResolvedValue({
      ...createBody,
      attachments: [{
        reference: "trusted-upload:76000000-0000-4000-8000-000000000011",
        sha256: "a".repeat(64),
      }],
    });
    const configuredReferenceResponse = await POST(request("POST"));
    expect(configuredReferenceResponse.status).toBe(503);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("authorizes before body parsing for demo and missing permissions", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      demo: false,
      scopes: ["consultant_messages.read"],
    });
    response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("correlates a recipient confirmation to the exact message and action", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      roles: ["professional"],
      scopes: ["consultant_messages.read", "consultant_messages.receive"],
    });
    stubs.readJsonObject.mockResolvedValue({ action: "confirm", messageId });
    stubs.maybeSingle.mockResolvedValue({ data: {
      operation_id: "76000000-0000-4000-8000-000000000012",
      message_id: messageId,
      category: "consultant",
      action: "confirm",
      read_at: "2026-09-02T01:02:00.000Z",
      confirmed_at: "2026-09-02T01:02:00.000Z",
      replayed: false,
    }, error: null });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ messageId, action: "confirm" });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "acknowledge_consultant_message",
      expect.objectContaining({
        p_message_id: messageId,
        p_action: "confirm",
        p_idempotency_key: key,
      }),
    );
  });
});
