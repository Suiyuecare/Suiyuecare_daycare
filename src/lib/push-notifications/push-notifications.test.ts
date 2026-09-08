import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  parsePushNotificationInput,
  parsePushNotificationPreviewRpc,
  parsePushNotificationQueueRpc,
} from "./parser";
import {
  filterPushNotificationHistory,
  projectPushNotificationManagementSnapshot,
} from "./projection";

const ORGANIZATION_ID = "45100000-0000-4000-8000-000000000001";
const BRANCH_ID = "45100000-0000-4000-8000-000000000002";
const RECIPIENT_ID = "45100000-0000-4000-8000-000000000003";
const NOTIFICATION_ID = "45100000-0000-4000-8000-000000000004";
const IDEMPOTENCY_KEY = "45100000-0000-4000-8000-000000000005";
const GENERATED_AT = "2026-09-01T02:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    branch_id: BRANCH_ID,
    generated_at: GENERATED_AT,
    recipients: [
      {
        user_id: RECIPIENT_ID,
        display_name: "測試員工",
        employee_code: "E001",
        profile_kind: "staff",
        membership_scope: "branch",
        role_names: ["照顧服務員"],
      },
    ],
    recipient_total: 1,
    recipients_truncated: false,
    notifications: [
      {
        notification_id: NOTIFICATION_ID,
        category: "工作提醒",
        priority: 2,
        title: "工作安排已更新",
        body: "請登入系統查看最新內容。",
        notification_status: "scheduled",
        scheduled_for: "2026-09-01T03:00:00.000Z",
        created_at: "2026-09-01T01:30:00.000Z",
        created_by_label: "本人",
        delivery_total: 1,
        queued_count: 1,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        confirmed_count: 0,
        failed_count: 0,
        suppressed_count: 0,
      },
    ],
    notification_total: 1,
    notifications_truncated: false,
    scheduled_total: 1,
    queued_delivery_total: 1,
    read_or_confirmed_total: 0,
    failed_delivery_total: 0,
    provider_boundary: "in_app_only_no_delivery_worker",
    family_boundary: "relationship_consent_not_available",
    retry_boundary: "partial_retry_worker_not_available",
    ...overrides,
  };
}

function input(mode: "preview" | "queue" = "preview") {
  return parsePushNotificationInput(
    {
      mode,
      category: "工作提醒",
      priority: 2,
      title: "工作安排已更新",
      body: "請登入系統查看最新內容。",
      recipient_user_ids: [RECIPIENT_ID],
      channels: ["in_app"],
      scheduled_for: "2026-09-01T03:00:00.000Z",
    },
    IDEMPOTENCY_KEY,
    new Date("2026-09-01T02:00:00.000Z"),
  );
}

describe("push notification page-45 boundaries", () => {
  it("accepts only one in-app channel and canonicalizes recipients", () => {
    const parsed = parsePushNotificationInput(
      {
        mode: "preview",
        category: " 工作提醒 ",
        priority: 1,
        title: " 一般通知 ",
        body: " 請登入系統查看。 ",
        recipient_user_ids: [RECIPIENT_ID, RECIPIENT_ID],
        channels: ["in_app"],
        scheduled_for: null,
      },
      IDEMPOTENCY_KEY,
    );
    expect(parsed.recipientUserIds).toEqual([RECIPIENT_ID]);
    expect(parsed.title).toBe("一般通知");
  });

  it("fails closed for provider and family-shaped notification attempts", () => {
    expect(() =>
      parsePushNotificationInput(
        {
          mode: "queue",
          category: "工作提醒",
          priority: 1,
          title: "一般通知",
          body: "請登入系統查看。",
          recipient_user_ids: [RECIPIENT_ID],
          channels: ["line"],
          scheduled_for: null,
        },
        IDEMPOTENCY_KEY,
      ),
    ).toThrowError(IntegrationError);
  });

  it("rejects sensitive notification copy before any persistence", () => {
    expect(() =>
      parsePushNotificationInput(
        {
          mode: "queue",
          category: "工作提醒",
          priority: 1,
          title: "血糖資料已更新",
          body: "請查看。",
          recipient_user_ids: [RECIPIENT_ID],
          channels: ["in_app"],
          scheduled_for: null,
        },
        IDEMPOTENCY_KEY,
      ),
    ).toThrowError("通知標題與內容不得包含個人識別或健康照顧資訊");
  });

  it("accepts only a preview that exactly matches tenant, branch, and recipients", () => {
    const preview = parsePushNotificationPreviewRpc(
      {
        organization_id: ORGANIZATION_ID,
        branch_id: BRANCH_ID,
        generated_at: GENERATED_AT,
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
      input(),
      ORGANIZATION_ID,
      BRANCH_ID,
      false,
    );
    expect(preview).toMatchObject({
      recipientCount: 1,
      deliveryCount: 1,
      channel: "in_app",
      persisted: false,
      demo: false,
    });

    expect(() =>
      parsePushNotificationPreviewRpc(
        {
          organization_id: ORGANIZATION_ID,
          branch_id: BRANCH_ID,
          generated_at: GENERATED_AT,
          recipients: [],
          recipient_count: 1,
          channel: "in_app",
          persisted: false,
        },
        input(),
        ORGANIZATION_ID,
        BRANCH_ID,
        false,
      ),
    ).toThrowError("通知結果未完整確認");
  });

  it("accepts only a persisted scheduled receipt with the exact fan-out", () => {
    expect(
      parsePushNotificationQueueRpc(
        {
          notification_id: NOTIFICATION_ID,
          delivery_count: 1,
          notification_status: "scheduled",
          scheduled_for: "2026-09-01T03:00:00.000Z",
          replayed: false,
        },
        input("queue"),
      ),
    ).toMatchObject({
      deliveryCount: 1,
      notificationStatus: "scheduled",
      deliveryStatus: "queued",
      persisted: true,
      demo: false,
    });
    expect(() =>
      parsePushNotificationQueueRpc(
        {
          notification_id: NOTIFICATION_ID,
          delivery_count: 2,
          notification_status: "scheduled",
          scheduled_for: "2026-09-01T03:00:00.000Z",
          replayed: false,
        },
        input("queue"),
      ),
    ).toThrowError("通知結果未完整確認");
  });

  it("projects a strict bounded snapshot and filters its loaded history", () => {
    const snapshot = projectPushNotificationManagementSnapshot({
      row: row(),
      expectedOrganizationId: ORGANIZATION_ID,
      expectedBranchId: BRANCH_ID,
      demo: false,
    });
    expect(snapshot).toMatchObject({
      recipientTotal: 1,
      notificationTotal: 1,
      scheduledTotal: 1,
      queuedDeliveryTotal: 1,
      providerBoundary: "in_app_only_no_delivery_worker",
      demo: false,
    });
    expect(
      filterPushNotificationHistory(snapshot, {
        query: "工作安排",
        category: "工作提醒",
        status: "scheduled",
        date: "2026-09-01",
      }, new Date(GENERATED_AT)),
    ).toHaveLength(1);
  });

  it("fails closed when an untruncated aggregate does not exactly match rows", () => {
    for (const malformed of [
      { scheduled_total: 0 },
      { queued_delivery_total: 2 },
      { read_or_confirmed_total: 1 },
      { failed_delivery_total: 1 },
    ]) {
      expect(() =>
        projectPushNotificationManagementSnapshot({
          row: row(malformed),
          expectedOrganizationId: ORGANIZATION_ID,
          expectedBranchId: BRANCH_ID,
          demo: false,
        }),
      ).toThrowError("INVALID_PUSH_NOTIFICATION_MANAGEMENT_PROJECTION");
    }
  });

  it("uses generated_at, not ambient time, to validate scheduled totals", () => {
    expect(() =>
      projectPushNotificationManagementSnapshot({
        row: row({ generated_at: "2026-09-01T04:00:00.000Z" }),
        expectedOrganizationId: ORGANIZATION_ID,
        expectedBranchId: BRANCH_ID,
        demo: false,
      }),
    ).toThrowError("INVALID_PUSH_NOTIFICATION_MANAGEMENT_PROJECTION");
  });

  it("allows greater global aggregates only when history is explicitly truncated", () => {
    const snapshot = projectPushNotificationManagementSnapshot({
      row: row({
        notification_total: 4,
        notifications_truncated: true,
        scheduled_total: 2,
        queued_delivery_total: 4,
        read_or_confirmed_total: 3,
        failed_delivery_total: 1,
      }),
      expectedOrganizationId: ORGANIZATION_ID,
      expectedBranchId: BRANCH_ID,
      demo: false,
    });
    expect(snapshot.notificationsTruncated).toBe(true);
    expect(snapshot.queuedDeliveryTotal).toBe(4);
  });

  it("rejects cross-tenant, family, duplicate, and inconsistent rows", () => {
    const malformedRows = [
      row({ organization_id: "45100000-0000-4000-8000-000000000099" }),
      row({
        recipients: [
          {
            user_id: RECIPIENT_ID,
            display_name: "家屬",
            employee_code: null,
            profile_kind: "family",
            membership_scope: "branch",
            role_names: ["家屬"],
          },
        ],
      }),
      row({ recipient_total: 2, recipients_truncated: false }),
      row({
        notifications: [
          ...(row().notifications as unknown[]),
          ...(row().notifications as unknown[]),
        ],
        notification_total: 2,
      }),
    ];
    for (const malformed of malformedRows) {
      expect(() =>
        projectPushNotificationManagementSnapshot({
          row: malformed,
          expectedOrganizationId: ORGANIZATION_ID,
          expectedBranchId: BRANCH_ID,
          demo: false,
        }),
      ).toThrowError("INVALID_PUSH_NOTIFICATION_MANAGEMENT_PROJECTION");
    }
  });
});
