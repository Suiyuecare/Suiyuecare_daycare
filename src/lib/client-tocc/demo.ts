import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";

import { projectClientToccSnapshot } from "./projection";

const todayTaipei = "2026-09-01";

export function buildDemoClientToccSnapshot() {
  const master = buildDemoClientMasterSnapshot();
  return projectClientToccSnapshot({
    clients: master.clients,
    generatedAt: "2026-09-01T10:24:00+08:00",
    todayTaipei,
    demo: true,
    assessmentRows: [
      {
        assessment_id: "b1111111-1111-4111-8111-111111111111",
        client_id: "a1111111-1111-4111-8111-111111111111",
        assessment_version: 3,
        assessment_date: "2026-08-20",
        valid_through: "2026-09-20",
        validity_rule_version: "calendar-month-asia-taipei-v1",
        validity_status: "current",
        result_status: "clear",
        symptom_summary: null,
        risk_summary: null,
        evidence_status: "not_required",
        action_status: "none_required",
        signed_at: "2026-08-20T09:18:00+08:00",
      },
      {
        assessment_id: "b2222222-2222-4222-8222-222222222222",
        client_id: "a2222222-2222-4222-8222-222222222222",
        assessment_version: 2,
        assessment_date: "2026-07-31",
        valid_through: "2026-08-31",
        validity_rule_version: "calendar-month-asia-taipei-v1",
        validity_status: "expired",
        result_status: "monitor",
        symptom_summary: "輕微咳嗽，持續觀察。",
        risk_summary: null,
        evidence_status: "pending",
        action_status: "in_progress",
        signed_at: "2026-07-31T15:42:00+08:00",
      },
      {
        assessment_id: "b3333333-3333-4333-8333-333333333333",
        client_id: "a3333333-3333-4333-8333-333333333333",
        assessment_version: 1,
        assessment_date: "2026-08-30",
        valid_through: "2026-09-30",
        validity_rule_version: "calendar-month-asia-taipei-v1",
        validity_status: "current",
        result_status: "action_required",
        symptom_summary: "返家期間出現發燒。",
        risk_summary: "有接觸史，待專業人員覆核。",
        evidence_status: "verified",
        action_status: "referred",
        signed_at: "2026-08-30T11:08:00+08:00",
      },
    ],
  });
}

