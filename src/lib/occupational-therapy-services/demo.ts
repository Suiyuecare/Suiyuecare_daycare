import {
  filterDemoOccupationalTherapyServiceSnapshot,
  projectOccupationalTherapyServiceSnapshot,
  type OccupationalTherapyServiceSnapshotSourceRow,
} from "./projection";
import type {
  OccupationalTherapyServiceFilters,
  OccupationalTherapyServiceSnapshot,
} from "./types";

const ORGANIZATION_ID = "41000000-0000-4000-8000-000000000001";
const BRANCH_ID = "41000000-0000-4000-8000-000000000002";
const THERAPIST_ID = "41000000-0000-4000-8000-000000000003";
const SECOND_THERAPIST_ID = "41000000-0000-4000-8000-000000000004";
const CLIENT_ONE = "41000000-0000-4000-8000-000000000011";
const CLIENT_TWO = "41000000-0000-4000-8000-000000000012";
const CLIENT_THREE = "41000000-0000-4000-8000-000000000013";

function isoHoursBefore(base: Date, hours: number) {
  return new Date(base.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function taipeiDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function buildDemoOccupationalTherapyServiceSnapshot(
  filters?: OccupationalTherapyServiceFilters,
): OccupationalTherapyServiceSnapshot {
  const generated = new Date();
  const recordOneOccurred = isoHoursBefore(generated, 2);
  const recordTwoOccurred = isoHoursBefore(generated, 28);
  const recordThreeOccurred = isoHoursBefore(generated, 4);
  const recordOneAssessment = {
    status: "linked" as const,
    version_id: "41000000-0000-4000-8000-000000000061",
    assessment_key: "41000000-0000-4000-8000-000000000062",
    assessment_version: 2,
    assessed_on: isoHoursBefore(generated, 96).slice(0, 10),
    therapist_display_name: "王職能治療師（合成）",
  };
  const recordTwoAssessment = {
    status: "linked" as const,
    version_id: "41000000-0000-4000-8000-000000000071",
    assessment_key: "41000000-0000-4000-8000-000000000072",
    assessment_version: 3,
    assessed_on: isoHoursBefore(generated, 240).slice(0, 10),
    therapist_display_name: "林職能治療師（合成）",
  };
  const noneAssessment = {
    status: "none_available" as const,
    version_id: null,
    assessment_key: null,
    assessment_version: null,
    assessed_on: null,
    therapist_display_name: null,
  };
  const recorded = (text: string) => ({
    state: "recorded" as const, text, reason: null,
  });
  const missing = (reason: string) => ({
    state: "missing" as const, text: null, reason,
  });
  const notApplicable = (reason: string) => ({
    state: "not_applicable" as const, text: null, reason,
  });

  const source: OccupationalTherapyServiceSnapshotSourceRow = {
    organization_id: ORGANIZATION_ID,
    branch_id: BRANCH_ID,
    generated_at: generated.toISOString(),
    records: [
      {
        record_key: "41000000-0000-4000-8000-000000000021",
        version_id: "41000000-0000-4000-8000-000000000023",
        record_version: 2,
        record_state: "signed",
        client_id: CLIENT_ONE,
        client_display_name: "合成個案・晨光",
        occurred_at: recordOneOccurred,
        service_content: recorded("依人工計畫進行衣物整理與動作順序練習。"),
        client_reaction: recorded("可依口頭提示完成，過程主動回應。"),
        recommendation: recorded("下次由治療師人工評估是否維持相同練習。"),
        therapist_user_id: THERAPIST_ID,
        therapist_display_name: "王職能治療師（合成）",
        service_status_at_occurrence: "active",
        assessment_reference: recordOneAssessment,
        correction_reason: null,
        signed_at: isoHoursBefore(generated, 1.5),
        signer_display_name: "王職能治療師（合成）",
        created_at: isoHoursBefore(generated, 1.5),
        version_history: [
          {
            version_id: "41000000-0000-4000-8000-000000000022",
            record_version: 1,
            record_state: "draft",
            occurred_at: recordOneOccurred,
            service_content: recorded("依人工計畫進行衣物整理與動作順序練習。"),
            client_reaction: recorded("可依口頭提示完成，過程主動回應。"),
            recommendation: recorded("下次由治療師人工評估是否維持相同練習。"),
            therapist_user_id: THERAPIST_ID,
            therapist_display_name: "王職能治療師（合成）",
            service_status_at_occurrence: "active",
            assessment_reference: recordOneAssessment,
            correction_reason: null,
            signed_at: null,
            signer_display_name: null,
            created_at: isoHoursBefore(generated, 1.8),
          },
          {
            version_id: "41000000-0000-4000-8000-000000000023",
            record_version: 2,
            record_state: "signed",
            occurred_at: recordOneOccurred,
            service_content: recorded("依人工計畫進行衣物整理與動作順序練習。"),
            client_reaction: recorded("可依口頭提示完成，過程主動回應。"),
            recommendation: recorded("下次由治療師人工評估是否維持相同練習。"),
            therapist_user_id: THERAPIST_ID,
            therapist_display_name: "王職能治療師（合成）",
            service_status_at_occurrence: "active",
            assessment_reference: recordOneAssessment,
            correction_reason: null,
            signed_at: isoHoursBefore(generated, 1.5),
            signer_display_name: "王職能治療師（合成）",
            created_at: isoHoursBefore(generated, 1.5),
          },
        ],
        version_history_total: 2,
      },
      {
        record_key: "41000000-0000-4000-8000-000000000031",
        version_id: "41000000-0000-4000-8000-000000000034",
        record_version: 3,
        record_state: "corrected",
        client_id: CLIENT_TWO,
        client_display_name: "合成個案・青松",
        occurred_at: recordTwoOccurred,
        service_content: recorded("進行人工記錄的上肢取物與桌面任務練習。"),
        client_reaction: missing("個案當次未提供可記錄的主觀反應。"),
        recommendation: notApplicable("當次沒有新的人工建議。"),
        therapist_user_id: SECOND_THERAPIST_ID,
        therapist_display_name: "林職能治療師（合成）",
        service_status_at_occurrence: "active",
        assessment_reference: recordTwoAssessment,
        correction_reason: "更正原紀錄中個案反應的狀態，保留原版追溯。",
        signed_at: isoHoursBefore(generated, 20),
        signer_display_name: "林職能治療師（合成）",
        created_at: isoHoursBefore(generated, 20),
        version_history: [
          {
            version_id: "41000000-0000-4000-8000-000000000032",
            record_version: 1,
            record_state: "draft",
            occurred_at: recordTwoOccurred,
            service_content: recorded("進行人工記錄的上肢取物與桌面任務練習。"),
            client_reaction: recorded("原草稿反應內容。"),
            recommendation: notApplicable("當次沒有新的人工建議。"),
            therapist_user_id: SECOND_THERAPIST_ID,
            therapist_display_name: "林職能治療師（合成）",
            service_status_at_occurrence: "active",
            assessment_reference: recordTwoAssessment,
            correction_reason: null,
            signed_at: null,
            signer_display_name: null,
            created_at: isoHoursBefore(generated, 24),
          },
          {
            version_id: "41000000-0000-4000-8000-000000000033",
            record_version: 2,
            record_state: "signed",
            occurred_at: recordTwoOccurred,
            service_content: recorded("進行人工記錄的上肢取物與桌面任務練習。"),
            client_reaction: recorded("原草稿反應內容。"),
            recommendation: notApplicable("當次沒有新的人工建議。"),
            therapist_user_id: SECOND_THERAPIST_ID,
            therapist_display_name: "林職能治療師（合成）",
            service_status_at_occurrence: "active",
            assessment_reference: recordTwoAssessment,
            correction_reason: null,
            signed_at: isoHoursBefore(generated, 23),
            signer_display_name: "林職能治療師（合成）",
            created_at: isoHoursBefore(generated, 23),
          },
          {
            version_id: "41000000-0000-4000-8000-000000000034",
            record_version: 3,
            record_state: "corrected",
            occurred_at: recordTwoOccurred,
            service_content: recorded("進行人工記錄的上肢取物與桌面任務練習。"),
            client_reaction: missing("個案當次未提供可記錄的主觀反應。"),
            recommendation: notApplicable("當次沒有新的人工建議。"),
            therapist_user_id: SECOND_THERAPIST_ID,
            therapist_display_name: "林職能治療師（合成）",
            service_status_at_occurrence: "active",
            assessment_reference: recordTwoAssessment,
            correction_reason: "更正原紀錄中個案反應的狀態，保留原版追溯。",
            signed_at: isoHoursBefore(generated, 20),
            signer_display_name: "林職能治療師（合成）",
            created_at: isoHoursBefore(generated, 20),
          },
        ],
        version_history_total: 3,
      },
      {
        record_key: "41000000-0000-4000-8000-000000000041",
        version_id: "41000000-0000-4000-8000-000000000042",
        record_version: 1,
        record_state: "draft",
        client_id: CLIENT_THREE,
        client_display_name: "合成個案・晴川",
        occurred_at: recordThreeOccurred,
        service_content: recorded("人工草稿：練習日常活動步驟與物品分類。"),
        client_reaction: notApplicable("草稿階段尚未完成反應紀錄。"),
        recommendation: missing("等待治療師完成本次人工建議。"),
        therapist_user_id: THERAPIST_ID,
        therapist_display_name: "王職能治療師（合成）",
        service_status_at_occurrence: "suspended",
        assessment_reference: noneAssessment,
        correction_reason: null,
        signed_at: null,
        signer_display_name: null,
        created_at: isoHoursBefore(generated, 3.5),
        version_history: [{
          version_id: "41000000-0000-4000-8000-000000000042",
          record_version: 1,
          record_state: "draft",
          occurred_at: recordThreeOccurred,
          service_content: recorded("人工草稿：練習日常活動步驟與物品分類。"),
          client_reaction: notApplicable("草稿階段尚未完成反應紀錄。"),
          recommendation: missing("等待治療師完成本次人工建議。"),
          therapist_user_id: THERAPIST_ID,
          therapist_display_name: "王職能治療師（合成）",
          service_status_at_occurrence: "suspended",
          assessment_reference: noneAssessment,
          correction_reason: null,
          signed_at: null,
          signer_display_name: null,
          created_at: isoHoursBefore(generated, 3.5),
        }],
        version_history_total: 1,
      },
    ],
    record_total: 3,
    matching_total: 3,
    records_truncated: false,
    today_total: [recordOneOccurred, recordTwoOccurred, recordThreeOccurred]
      .filter((value) => taipeiDate(value) === taipeiDate(generated)).length,
    draft_total: 1,
    signed_total: 1,
    corrected_total: 1,
    linked_assessment_total: 2,
    client_options: [
      { client_id: CLIENT_ONE, display_name: "合成個案・晨光", service_status: "active", admitted_on: "2026-01-01", ended_on: null },
      { client_id: CLIENT_TWO, display_name: "合成個案・青松", service_status: "active", admitted_on: "2026-02-01", ended_on: null },
      { client_id: CLIENT_THREE, display_name: "合成個案・晴川", service_status: "suspended", admitted_on: "2026-03-01", ended_on: null },
    ],
    client_total: 3,
    client_options_truncated: false,
    therapist_options: [
      { user_id: THERAPIST_ID, display_name: "王職能治療師（合成）" },
      { user_id: SECOND_THERAPIST_ID, display_name: "林職能治療師（合成）" },
    ],
    therapist_total: 2,
    therapist_options_truncated: false,
    assessment_link_status: "readonly_latest_terminal",
    formula_status: "not_configured",
    diagnosis_status: "not_configured",
    automatic_recommendation_status: "not_configured",
    attachment_status: "not_configured",
    export_status: "not_configured",
    offline_sync_status: "not_configured",
  };
  source.records.sort((left, right) =>
    new Date(right.occurred_at).getTime() -
      new Date(left.occurred_at).getTime() ||
    left.record_key.localeCompare(right.record_key, "en")
  );
  const snapshot = projectOccupationalTherapyServiceSnapshot({
    row: source,
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
  });
  return filters
    ? filterDemoOccupationalTherapyServiceSnapshot(snapshot, filters)
    : snapshot;
}
