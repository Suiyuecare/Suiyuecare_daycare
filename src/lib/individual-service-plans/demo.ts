import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";

import { projectIndividualServicePlanSnapshot } from "./projection";

export function buildDemoIndividualServicePlanSnapshot(planMonth: string) {
  const master = buildDemoClientMasterSnapshot();
  return projectIndividualServicePlanSnapshot({
    clients: master.clients,
    planMonth,
    generatedAt: "2026-09-01T10:36:00+08:00",
    demo: true,
    responsibleRows: [
      { user_id: "d1111111-1111-4111-8111-111111111111", display_name: "王社工" },
      { user_id: "d2222222-2222-4222-8222-222222222222", display_name: "李照服員" },
    ],
    planRows: planMonth === "2026-09" ? [
      {
        plan_id: "e1111111-1111-4111-8111-111111111111",
        client_id: "a1111111-1111-4111-8111-111111111111",
        plan_month: "2026-09-01",
        plan_version: 2,
        previous_plan_id: "e1111111-1111-4111-8111-111111111110",
        correction_reason: "依 9 月 1 日團隊會議更新活動進度。",
        signed_at: "2026-09-01T10:15:00+08:00",
        plan_items: [
          {
            item_order: 1,
            goal: "維持團體活動參與",
            activity: "參與桌遊與簡易園藝活動",
            frequency: "每週二次，由現場人員依實際出席紀錄",
            responsible_user_id: "d1111111-1111-4111-8111-111111111111",
            responsible_display_name: "王社工",
            progress_status: "in_progress",
            progress_note: "已完成第一週活動。",
          },
        ],
      },
    ] : [],
  });
}
