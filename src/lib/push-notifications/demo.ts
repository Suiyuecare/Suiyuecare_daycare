import { projectPushNotificationManagementSnapshot } from "./projection";

export const DEMO_PUSH_NOTIFICATION_RECIPIENT_IDS = [
  "45111111-1111-4111-8111-111111111111",
  "45122222-2222-4222-8222-222222222222",
  "45133333-3333-4333-8333-333333333333",
] as const;

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

export function buildDemoPushNotificationManagementSnapshot(now = new Date()) {
  const minutes = (value: number) =>
    new Date(now.getTime() + value * 60_000).toISOString();
  return projectPushNotificationManagementSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: now.toISOString(),
      recipients: [
        {
          user_id: DEMO_PUSH_NOTIFICATION_RECIPIENT_IDS[0],
          display_name: "王小芬",
          employee_code: "DC-021",
          profile_kind: "staff",
          membership_scope: "branch",
          role_names: ["照顧服務員"],
        },
        {
          user_id: DEMO_PUSH_NOTIFICATION_RECIPIENT_IDS[1],
          display_name: "林護理師",
          employee_code: "DC-008",
          profile_kind: "professional",
          membership_scope: "branch",
          role_names: ["護理人員"],
        },
        {
          user_id: DEMO_PUSH_NOTIFICATION_RECIPIENT_IDS[2],
          display_name: "陳司機",
          employee_code: "DC-034",
          profile_kind: "driver",
          membership_scope: "organization",
          role_names: ["交通與駕駛人員"],
        },
      ],
      recipient_total: 3,
      recipients_truncated: false,
      notifications: [
        {
          notification_id: "45211111-1111-4111-8111-111111111111",
          category: "工作提醒",
          priority: 2,
          title: "明日工作安排已更新",
          body: "請登入系統查看最新工作安排。",
          notification_status: "scheduled",
          scheduled_for: minutes(180),
          created_at: minutes(-30),
          created_by_label: "本人",
          delivery_total: 3,
          queued_count: 3,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          confirmed_count: 0,
          failed_count: 0,
          suppressed_count: 0,
        },
        {
          notification_id: "45222222-2222-4222-8222-222222222222",
          category: "系統通知",
          priority: 1,
          title: "本週工作摘要已更新",
          body: "請登入系統查看最新內容。",
          notification_status: "scheduled",
          scheduled_for: minutes(-1_500),
          created_at: minutes(-1_510),
          created_by_label: "周督導",
          delivery_total: 2,
          queued_count: 1,
          sent_count: 0,
          delivered_count: 0,
          read_count: 1,
          confirmed_count: 0,
          failed_count: 0,
          suppressed_count: 0,
        },
      ],
      notification_total: 2,
      notifications_truncated: false,
      scheduled_total: 1,
      queued_delivery_total: 4,
      read_or_confirmed_total: 1,
      failed_delivery_total: 0,
      provider_boundary: "in_app_only_no_delivery_worker",
      family_boundary: "relationship_consent_not_available",
      retry_boundary: "partial_retry_worker_not_available",
    },
  });
}
