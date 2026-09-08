import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoConsultantMessageSnapshot } from "./demo";
import {
  parseConsultantMessageCreate,
  parseConsultantMessageCreateDatabaseReceipt,
  parseConsultantMessageReceiptApiSuccess,
} from "./parser";
import {
  projectConsultantMessageSnapshot,
  type ConsultantMessageSnapshotSource,
} from "./projection";

const organizationId = "76100000-0000-4000-8000-000000000001";
const branchId = "76100000-0000-4000-8000-000000000002";
const authorId = "76100000-0000-4000-8000-000000000003";
const recipientId = "76100000-0000-4000-8000-000000000004";
const messageId = "76100000-0000-4000-8000-000000000005";
const operationId = "76100000-0000-4000-8000-000000000006";
const requestId = "76100000-0000-4000-8000-000000000007";
const idempotencyKey = "76100000-0000-4000-8000-000000000008";

function managerRow(): ConsultantMessageSnapshotSource {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-02T02:00:00.000Z",
    items: [{
      message_id: messageId,
      category: "consultant",
      subject: "專業服務討論",
      body: "請於系統內確認本次顧問建議。",
      occurred_at: "2026-09-02T01:00:00.000Z",
      published_at: "2026-09-02T01:01:00.000Z",
      author_display_name: "範例社工",
      author_profile_kind: "staff",
      recipient_count: 1,
      read_count: 1,
      confirmed_count: 0,
      actor_is_recipient: false,
      actor_read_at: null,
      actor_confirmed_at: null,
      attachment_count: 0,
      recipients: [{
        user_id: recipientId,
        display_name: "範例顧問",
        employee_code: "DEMO-PRO",
        profile_kind: "professional",
        role_names: ["專業顧問"],
        read_at: "2026-09-02T01:05:00.000Z",
        confirmed_at: null,
      }],
    }],
    message_total: 1,
    unread_total: 0,
    today_total: 1,
    attachment_total: 0,
    confirmation_pending_total: 1,
    items_truncated: false,
    can_manage: true,
    recipient_options: [{
      user_id: recipientId,
      display_name: "範例顧問",
      employee_code: "DEMO-PRO",
      profile_kind: "professional",
      role_names: ["專業顧問"],
    }],
    category_boundary: "consultant_only",
    delivery_boundary: "in_app_only",
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured",
  };
}

const createBody = {
  action: "create",
  subject: "顧問討論",
  body: "請登入系統查看。",
  occurredAt: "2026-09-02T09:00:00+08:00",
  recipientUserIds: [recipientId],
  attachments: [],
};

describe("consultant message projection", () => {
  it("projects a strictly scoped consultant-only manager snapshot", () => {
    const result = projectConsultantMessageSnapshot({
      row: managerRow(),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      expectedCanManage: true,
      demo: false,
    });
    expect(result.items[0]).toMatchObject({
      messageId,
      category: "consultant",
      recipientCount: 1,
      readCount: 1,
      confirmedCount: 0,
    });
    expect(result).not.toHaveProperty("authorId", authorId);
    expect(result.deliveryBoundary).toBe("in_app_only");
    expect(result.attachmentPipelineStatus).toBe("not_configured");
  });

  it("fails closed on general category, cross-branch scope, or aggregate drift", () => {
    for (const mutate of [
      (row: ReturnType<typeof managerRow>) => {
        (row.items[0] as { category: string }).category = "general";
      },
      (row: ReturnType<typeof managerRow>) => { row.branch_id = "76100000-0000-4000-8000-000000000099"; },
      (row: ReturnType<typeof managerRow>) => { row.items[0]!.read_count = 0; },
    ]) {
      const row = managerRow();
      mutate(row);
      expect(() => projectConsultantMessageSnapshot({
        row,
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        expectedCanManage: true,
        demo: false,
      })).toThrow("INVALID_CONSULTANT_MESSAGE_SNAPSHOT");
    }
  });

  it("requires a recipient snapshot to contain only the current recipient", () => {
    const row = managerRow();
    row.can_manage = false;
    row.recipient_options = [];
    row.items[0]!.actor_is_recipient = true;
    row.items[0]!.actor_read_at = "2026-09-02T01:05:00.000Z";
    expect(projectConsultantMessageSnapshot({
      row,
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      expectedCanManage: false,
      demo: false,
    }).items).toHaveLength(1);
    row.items[0]!.actor_is_recipient = false;
    expect(() => projectConsultantMessageSnapshot({
      row,
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      expectedCanManage: false,
      demo: false,
    })).toThrow();
  });

  it("filters synthetic demo history without widening the category boundary", () => {
    const result = buildDemoConsultantMessageSnapshot({
      organizationId,
      branchId,
      filters: {
        consultantUserId: "76a00000-0000-4000-8000-000000000002",
        dateFrom: "2026-09-01",
        dateTo: "2026-09-01",
        status: "confirmed",
        query: "餐食",
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items.every((item) => item.category === "consultant")).toBe(true);
    expect(result.demo).toBe(true);
  });
});

describe("consultant message strict write contracts", () => {
  it("normalizes and sorts recipients while rejecting unknown or duplicate input", () => {
    const second = "76100000-0000-4000-8000-000000000009";
    expect(parseConsultantMessageCreate({
      ...createBody,
      subject: "  顧問討論  ",
      recipientUserIds: [second, recipientId],
    }, idempotencyKey)).toMatchObject({
      subject: "顧問討論",
      recipientUserIds: [recipientId, second],
    });
    expect(() => parseConsultantMessageCreate({
      ...createBody,
      recipientUserIds: [recipientId, recipientId],
    }, idempotencyKey)).toThrow();
    expect(() => parseConsultantMessageCreate({
      ...createBody,
      category: "general",
    }, idempotencyKey)).toThrow();
  });

  it("rejects paths and URLs, and reports not_configured for a trusted reference", () => {
    for (const reference of ["/Users/example/file.pdf", "https://example.invalid/file.pdf"]) {
      expect(() => parseConsultantMessageCreate({
        ...createBody,
        attachments: [{ reference, sha256: "a".repeat(64) }],
      }, idempotencyKey)).toThrow();
    }
    try {
      parseConsultantMessageCreate({
        ...createBody,
        attachments: [{
          reference: "trusted-upload:76100000-0000-4000-8000-000000000010",
          sha256: "a".repeat(64),
        }],
      }, idempotencyKey);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationError);
      expect((error as IntegrationError).code).toBe("ATTACHMENT_PIPELINE_NOT_CONFIGURED");
      expect((error as IntegrationError).httpStatus).toBe(503);
    }
  });

  it("correlates database and browser receipts to the exact operation", () => {
    const input = parseConsultantMessageCreate(createBody, idempotencyKey);
    expect(parseConsultantMessageCreateDatabaseReceipt({
      operation_id: operationId,
      message_id: messageId,
      category: "consultant",
      recipient_count: 1,
      published_at: "2026-09-02T01:01:00.000Z",
      replayed: false,
    }, input).message_id).toBe(messageId);
    expect(() => parseConsultantMessageCreateDatabaseReceipt({
      operation_id: operationId,
      message_id: messageId,
      category: "consultant",
      recipient_count: 2,
      published_at: "2026-09-02T01:01:00.000Z",
      replayed: false,
    }, input)).toThrow();

    expect(() => parseConsultantMessageReceiptApiSuccess({
      requestId,
      status: "ok",
      data: {
        operationId,
        messageId: "76100000-0000-4000-8000-000000000099",
        category: "consultant",
        action: "confirm",
        readAt: "2026-09-02T01:02:00.000Z",
        confirmedAt: "2026-09-02T01:02:00.000Z",
        persisted: true,
        demo: false,
        replayed: false,
      },
      errors: [],
    }, { action: "confirm", messageId, idempotencyKey })).toThrow(
      "MISMATCHED_CONSULTANT_MESSAGE_RECEIPT_SUCCESS",
    );
  });
});
