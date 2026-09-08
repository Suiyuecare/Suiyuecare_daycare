import { describe, expect, it } from "vitest";

import {
  filterNotificationCenterSnapshot,
  notificationSourceHref,
  projectNotificationCenterSnapshot,
} from "./projection";
import {
  parseNotificationAcknowledgementInput,
  parseNotificationAcknowledgementRpcResult,
  parseNotificationAcknowledgementSuccess,
} from "./parser";

const ORG = "67100000-0000-4000-8000-000000000001";
const BRANCH = "67200000-0000-4000-8000-000000000001";
const DELIVERY_1 = "67300000-0000-4000-8000-000000000001";
const DELIVERY_2 = "67300000-0000-4000-8000-000000000002";
const NOTICE_1 = "67400000-0000-4000-8000-000000000001";
const NOTICE_2 = "67400000-0000-4000-8000-000000000002";
const OPERATION = "67500000-0000-4000-8000-000000000001";
const IDEMPOTENCY = "67600000-0000-4000-8000-000000000001";

function row() {
  return {
    organization_id: ORG,
    branch_id: BRANCH,
    generated_at: "2026-09-01T02:00:00.000Z",
    items: [
      {
        delivery_id: DELIVERY_1,
        notification_id: NOTICE_1,
        category: "工作異動",
        priority: 3,
        title: "最高優先工作異動",
        body: "請登入系統查看內容並確認。",
        source_type: "attendance_event",
        source_id: "67700000-0000-4000-8000-000000000001",
        available_at: "2026-09-01T01:30:00.000Z",
        status: "delivered",
        read_at: null,
        confirmed_at: null,
        requires_confirmation: true,
      },
      {
        delivery_id: DELIVERY_2,
        notification_id: NOTICE_2,
        category: "一般提醒",
        priority: 1,
        title: "一般工作摘要",
        body: "請登入工作台查看摘要。",
        source_type: null,
        source_id: null,
        available_at: "2026-08-31T01:30:00.000Z",
        status: "read",
        read_at: "2026-08-31T01:40:00.000Z",
        confirmed_at: null,
        requires_confirmation: false,
      },
    ],
    item_total: 2,
    unread_total: 1,
    confirmation_pending_total: 1,
    today_total: 1,
    items_truncated: false,
    confirmation_rule_status: "technical_priority_3_only",
  };
}

describe("notification center projection", () => {
  it("projects a scoped bounded snapshot and only allowlists UUID internal sources", () => {
    const snapshot = projectNotificationCenterSnapshot({
      row: row(),
      expectedOrganizationId: ORG,
      expectedBranchId: BRANCH,
      demo: false,
    });
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]?.sourceHref).toBe(
      "/app/staff/service-management/attendance?source=67700000-0000-4000-8000-000000000001",
    );
    expect(notificationSourceHref("attendance_event", "event-1")).toBeNull();
    expect(notificationSourceHref("https://evil.invalid", NOTICE_1)).toBeNull();
    expect(snapshot.overdueTotal).toBeNull();
  });

  it("rejects cross-tenant, inconsistent confirmation and incomplete count claims", () => {
    expect(() =>
      projectNotificationCenterSnapshot({
        row: row(),
        expectedOrganizationId: "67100000-0000-4000-8000-000000000099",
        expectedBranchId: BRANCH,
        demo: false,
      }),
    ).toThrow("INVALID_NOTIFICATION_CENTER_PROJECTION");

    const wrongPriority = structuredClone(row());
    wrongPriority.items[0]!.requires_confirmation = false;
    expect(() =>
      projectNotificationCenterSnapshot({
        row: wrongPriority,
        expectedOrganizationId: ORG,
        expectedBranchId: BRANCH,
        demo: false,
      }),
    ).toThrow("INVALID_NOTIFICATION_CENTER_PROJECTION");

    const wrongCount = structuredClone(row());
    wrongCount.confirmation_pending_total = 2;
    expect(() =>
      projectNotificationCenterSnapshot({
        row: wrongCount,
        expectedOrganizationId: ORG,
        expectedBranchId: BRANCH,
        demo: false,
      }),
    ).toThrow("INVALID_NOTIFICATION_CENTER_PROJECTION");

    const pendingWithReadEvidence = structuredClone(row());
    pendingWithReadEvidence.items[0]!.read_at = "2026-09-01T01:40:00.000Z";
    expect(() =>
      projectNotificationCenterSnapshot({
        row: pendingWithReadEvidence,
        expectedOrganizationId: ORG,
        expectedBranchId: BRANCH,
        demo: false,
      }),
    ).toThrow("INVALID_NOTIFICATION_CENTER_PROJECTION");

    const futureItem = structuredClone(row());
    futureItem.items[0]!.available_at = "2026-09-01T02:00:01.000Z";
    expect(() =>
      projectNotificationCenterSnapshot({
        row: futureItem,
        expectedOrganizationId: ORG,
        expectedBranchId: BRANCH,
        demo: false,
      }),
    ).toThrow("INVALID_NOTIFICATION_CENTER_PROJECTION");
  });

  it("combines query, state, category, priority and Taipei date filters", () => {
    const snapshot = projectNotificationCenterSnapshot({
      row: row(),
      expectedOrganizationId: ORG,
      expectedBranchId: BRANCH,
      demo: false,
    });
    const filtered = filterNotificationCenterSnapshot(snapshot, {
      query: "最高優先",
      status: "confirmation_pending",
      category: "工作異動",
      priority: "3",
      date: "2026-09-01",
    });
    expect(filtered.items.map((item) => item.deliveryId)).toEqual([DELIVERY_1]);
    expect(
      filterNotificationCenterSnapshot(snapshot, {
        query: "",
        status: "confirmed",
        category: "all",
        priority: "all",
        date: null,
      }).items,
    ).toHaveLength(0);
  });
});

describe("notification acknowledgement contracts", () => {
  it("requires a strict body and UUID header", () => {
    expect(
      parseNotificationAcknowledgementInput(
        { delivery_id: DELIVERY_1, target_status: "confirmed" },
        IDEMPOTENCY,
      ),
    ).toEqual({
      deliveryId: DELIVERY_1,
      targetStatus: "confirmed",
      idempotencyKey: IDEMPOTENCY,
    });
    expect(() =>
      parseNotificationAcknowledgementInput(
        { delivery_id: DELIVERY_1, target_status: "confirmed", actor_id: ORG },
        IDEMPOTENCY,
      ),
    ).toThrow();
  });

  it("correlates the exact RPC receipt and confirmation timestamps", () => {
    expect(
      parseNotificationAcknowledgementRpcResult(
        {
          acknowledgement_operation_id: OPERATION,
          notification_delivery_id: DELIVERY_1,
          notification_id: NOTICE_1,
          status: "confirmed",
          read_at: "2026-09-01T02:00:00.000Z",
          confirmed_at: "2026-09-01T02:00:00.000Z",
          acknowledged_at: "2026-09-01T02:00:00.000Z",
          replayed: false,
        },
        { deliveryId: DELIVERY_1, targetStatus: "confirmed" },
      ),
    ).toMatchObject({
      operationId: OPERATION,
      deliveryId: DELIVERY_1,
      status: "confirmed",
      persisted: true,
      demo: false,
    });
    expect(() =>
      parseNotificationAcknowledgementRpcResult(
        {
          acknowledgement_operation_id: OPERATION,
          notification_delivery_id: DELIVERY_2,
          notification_id: NOTICE_1,
          status: "confirmed",
          read_at: "2026-09-01T02:00:00.000Z",
          confirmed_at: "2026-09-01T02:00:00.000Z",
          acknowledged_at: "2026-09-01T02:00:00.000Z",
          replayed: false,
        },
        { deliveryId: DELIVERY_1, targetStatus: "confirmed" },
      ),
    ).toThrow();
  });

  it("rejects malformed success and HTTP/replay mismatches", () => {
    const envelope = {
      requestId: "67800000-0000-4000-8000-000000000001",
      status: "ok",
      data: {
        operationId: OPERATION,
        deliveryId: DELIVERY_1,
        notificationId: NOTICE_1,
        status: "read",
        readAt: "2026-09-01T02:00:00.000Z",
        confirmedAt: null,
        acknowledgedAt: "2026-09-01T02:00:00.000Z",
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(
      parseNotificationAcknowledgementSuccess(
        envelope,
        { deliveryId: DELIVERY_1, targetStatus: "read" },
        201,
      ).data.status,
    ).toBe("read");
    expect(() =>
      parseNotificationAcknowledgementSuccess(
        envelope,
        { deliveryId: DELIVERY_1, targetStatus: "read" },
        200,
      ),
    ).toThrow();
    expect(() =>
      parseNotificationAcknowledgementSuccess(
        { ...envelope, extra: true },
        { deliveryId: DELIVERY_1, targetStatus: "read" },
        201,
      ),
    ).toThrow();
  });
});
