import { projectNotificationCenterSnapshot } from "./projection";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

export function buildDemoNotificationCenterSnapshot(now = new Date()) {
  const at = (minutesAgo: number) =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return projectNotificationCenterSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: now.toISOString(),
      items: [
        {
          delivery_id: "67111111-1111-4111-8111-111111111111",
          notification_id: "67211111-1111-4111-8111-111111111111",
          category: "工作異動",
          priority: 3,
          title: "今日工作項目有重要異動",
          body: "請登入系統查看內容並完成確認。",
          source_type: "attendance_event",
          source_id: "67311111-1111-4111-8111-111111111111",
          available_at: at(18),
          status: "delivered",
          read_at: null,
          confirmed_at: null,
          requires_confirmation: true,
        },
        {
          delivery_id: "67122222-2222-4222-8222-222222222222",
          notification_id: "67222222-2222-4222-8222-222222222222",
          category: "系統提醒",
          priority: 1,
          title: "請查看本週工作摘要",
          body: "最新摘要已可在工作台查看。",
          source_type: null,
          source_id: null,
          available_at: at(75),
          status: "queued",
          read_at: null,
          confirmed_at: null,
          requires_confirmation: false,
        },
        {
          delivery_id: "67133333-3333-4333-8333-333333333333",
          notification_id: "67233333-3333-4333-8333-333333333333",
          category: "工作異動",
          priority: 3,
          title: "先前工作異動已確認",
          body: "此合成通知僅用於展示已確認狀態。",
          source_type: "service_event",
          source_id: "67333333-3333-4333-8333-333333333333",
          available_at: at(1_500),
          status: "confirmed",
          read_at: at(1_490),
          confirmed_at: at(1_480),
          requires_confirmation: true,
        },
      ],
      item_total: 3,
      unread_total: 2,
      confirmation_pending_total: 1,
      today_total: 2,
      items_truncated: false,
      confirmation_rule_status: "technical_priority_3_only",
    },
  });
}
