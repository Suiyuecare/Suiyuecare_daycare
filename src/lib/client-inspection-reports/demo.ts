import {
  projectClientInspectionReportSnapshot,
  type ClientInspectionReportSnapshotSourceRow,
} from "./projection";
import { clientInspectionReportTaipeiDate } from "./query";
import type { ClientInspectionReportFilters } from "./types";

const CLIENT_A = "22000000-0000-4000-8000-000000000001";
const CLIENT_B = "22000000-0000-4000-8000-000000000002";
const REPORT_A = "22010000-0000-4000-8000-000000000001";
const REPORT_B = "22010000-0000-4000-8000-000000000002";
const REPORT_C = "22010000-0000-4000-8000-000000000003";
const REPORT_D = "22010000-0000-4000-8000-000000000004";
const VERSION_A = "22020000-0000-4000-8000-000000000001";
const VERSION_B = "22020000-0000-4000-8000-000000000002";
const VERSION_C = "22020000-0000-4000-8000-000000000003";
const VERSION_D1 = "22020000-0000-4000-8000-000000000004";
const VERSION_D2 = "22020000-0000-4000-8000-000000000005";
const ACTOR = "22030000-0000-4000-8000-000000000001";
const ATTACHMENT = "22040000-0000-4000-8000-000000000001";
const ATTACHMENT_SHA = "a".repeat(64);

function offsetDate(today: string, amount: number) {
  const value = new Date(`${today}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return clientInspectionReportTaipeiDate(value);
}

export function buildDemoClientInspectionReportSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: ClientInspectionReportFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = clientInspectionReportTaipeiDate(now);
  const sharedDate = offsetDate(today, -18);
  const otherDate = offsetDate(today, -4);
  const recordedAt = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
  const allRecords: ClientInspectionReportSnapshotSourceRow["records"] = [
    {
      record_version_id: VERSION_A, report_key: REPORT_A, version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      client_id: CLIENT_A, client_code: "DEMO-C001", client_display_name: "展示個案甲",
      report_type: "展示胸部影像報告", examined_on: sharedDate,
      result_status: "present", result_text: "展示結果原文 A（僅照錄，不作判讀）",
      result_reason: null, source_status: "present", source_text: "展示合作院所",
      source_reason: null, attachment_status: "provided", attachment_id: ATTACHMENT,
      attachment_sha256: ATTACHMENT_SHA,
      attachment_source_filename: "demo-report-a.pdf", payload_hash: "1".repeat(64),
      content_hash: "b".repeat(64), exact_duplicate_count: 1,
      key_field_duplicate_count: 2, attachment_duplicate_count: 1,
      duplicate_warning: true,
      duplicate_bases: ["exact_content", "same_client_type_date_source", "same_attachment_sha256"],
      duplicate_matches: [
        { report_key: REPORT_B, record_version_id: VERSION_B, examined_on: sharedDate,
          match_kind: "exact_content" },
        { report_key: REPORT_B, record_version_id: VERSION_B, examined_on: sharedDate,
          match_kind: "same_client_type_date_source" },
        { report_key: REPORT_C, record_version_id: VERSION_C, examined_on: sharedDate,
          match_kind: "same_client_type_date_source" },
        { report_key: REPORT_B, record_version_id: VERSION_B, examined_on: sharedDate,
          match_kind: "same_attachment_sha256" },
      ], duplicate_matches_truncated: false, recorded_by: ACTOR,
      recorded_by_display_name: "展示護理人員", recorded_at: recordedAt,
    },
    {
      record_version_id: VERSION_B, report_key: REPORT_B, version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      client_id: CLIENT_A, client_code: "DEMO-C001", client_display_name: "展示個案甲",
      report_type: "展示胸部影像報告", examined_on: sharedDate,
      result_status: "present", result_text: "展示結果原文 A（僅照錄，不作判讀）",
      result_reason: null, source_status: "present", source_text: "展示合作院所",
      source_reason: null, attachment_status: "provided", attachment_id: ATTACHMENT,
      attachment_sha256: ATTACHMENT_SHA,
      attachment_source_filename: "demo-report-a.pdf", payload_hash: "1".repeat(64),
      content_hash: "c".repeat(64), exact_duplicate_count: 1,
      key_field_duplicate_count: 2, attachment_duplicate_count: 1,
      duplicate_warning: true,
      duplicate_bases: ["exact_content", "same_client_type_date_source", "same_attachment_sha256"],
      duplicate_matches: [
        { report_key: REPORT_A, record_version_id: VERSION_A, examined_on: sharedDate,
          match_kind: "exact_content" },
        { report_key: REPORT_A, record_version_id: VERSION_A, examined_on: sharedDate,
          match_kind: "same_client_type_date_source" },
        { report_key: REPORT_C, record_version_id: VERSION_C, examined_on: sharedDate,
          match_kind: "same_client_type_date_source" },
        { report_key: REPORT_A, record_version_id: VERSION_A, examined_on: sharedDate,
          match_kind: "same_attachment_sha256" },
      ], duplicate_matches_truncated: false, recorded_by: ACTOR,
      recorded_by_display_name: "展示護理人員", recorded_at: recordedAt,
    },
    {
      record_version_id: VERSION_C, report_key: REPORT_C, version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      client_id: CLIENT_A, client_code: "DEMO-C001", client_display_name: "展示個案甲",
      report_type: "展示胸部影像報告", examined_on: sharedDate,
      result_status: "missing", result_text: null,
      result_reason: "展示缺值原因：來源文件尚未提供結果文字",
      source_status: "present", source_text: "展示合作院所", source_reason: null,
      attachment_status: "missing", attachment_id: null, attachment_sha256: null,
      attachment_source_filename: null, payload_hash: "2".repeat(64),
      content_hash: "d".repeat(64), exact_duplicate_count: 0,
      key_field_duplicate_count: 2, attachment_duplicate_count: 0,
      duplicate_warning: true, duplicate_bases: ["same_client_type_date_source"],
      duplicate_matches: [
        { report_key: REPORT_A, record_version_id: VERSION_A, examined_on: sharedDate,
          match_kind: "same_client_type_date_source" },
        { report_key: REPORT_B, record_version_id: VERSION_B, examined_on: sharedDate,
          match_kind: "same_client_type_date_source" },
      ], duplicate_matches_truncated: false, recorded_by: ACTOR,
      recorded_by_display_name: "展示護理人員", recorded_at: recordedAt,
    },
    {
      record_version_id: VERSION_D2, report_key: REPORT_D, version: 2,
      previous_version_id: VERSION_D1, record_status: "active",
      correction_reason: "展示更正：補充檢查來源狀態說明",
      client_id: CLIENT_B, client_code: "DEMO-C002", client_display_name: "展示個案乙",
      report_type: "展示生化檢查報告", examined_on: otherDate,
      result_status: "not_applicable", result_text: null,
      result_reason: "展示不適用原因：此份資料僅記錄完成狀態",
      source_status: "missing", source_text: null,
      source_reason: "展示缺值原因：來源單位尚待人工確認",
      attachment_status: "not_applicable", attachment_id: null,
      attachment_sha256: null, attachment_source_filename: null,
      payload_hash: "3".repeat(64), content_hash: "e".repeat(64),
      exact_duplicate_count: 0, key_field_duplicate_count: 0,
      attachment_duplicate_count: 0, duplicate_warning: false,
      duplicate_bases: [], duplicate_matches: [], duplicate_matches_truncated: false,
      recorded_by: ACTOR, recorded_by_display_name: "展示護理人員",
      recorded_at: recordedAt,
    },
  ];
  allRecords.sort((a, b) => b.examined_on.localeCompare(a.examined_on) ||
    a.client_display_name.localeCompare(b.client_display_name, "zh-TW") ||
    a.report_key.localeCompare(b.report_key));

  const query = filters.query.toLocaleLowerCase("zh-Hant-TW");
  const records = allRecords.filter((record) => {
    const haystack = [record.client_code, record.client_display_name, record.report_type,
      record.result_text ?? record.result_reason ?? "",
      record.source_text ?? record.source_reason ?? "",
      record.attachment_source_filename ?? ""].join(" ").toLocaleLowerCase("zh-Hant-TW");
    return (filters.clientId === null || filters.clientId === record.client_id) &&
      (filters.reportType === null || filters.reportType === record.report_type) &&
      (filters.examinedFrom === null || record.examined_on >= filters.examinedFrom) &&
      (filters.examinedTo === null || record.examined_on <= filters.examinedTo) &&
      (filters.recordStatus === "all" || record.record_status === filters.recordStatus) &&
      (filters.resultStatus === "all" || record.result_status === filters.resultStatus) &&
      (filters.sourceStatus === "all" || record.source_status === filters.sourceStatus) &&
      (filters.attachmentStatus === "all" ||
        record.attachment_status === filters.attachmentStatus) &&
      (filters.duplicateStatus === "all" ||
        (filters.duplicateStatus === "any" && record.duplicate_warning) ||
        (filters.duplicateStatus === "exact" && Number(record.exact_duplicate_count) > 0) ||
        (filters.duplicateStatus === "key_fields" && Number(record.key_field_duplicate_count) > 0) ||
        (filters.duplicateStatus === "attachment" && Number(record.attachment_duplicate_count) > 0) ||
        (filters.duplicateStatus === "none" && !record.duplicate_warning)) &&
      (!query || haystack.includes(query));
  });
  const visibleKeys = new Set(records.map(({ report_key }) => report_key));
  const baseHistory: ClientInspectionReportSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id, report_key: record.report_key,
      version: record.version, previous_version_id: record.previous_version_id,
      record_status: record.record_status, correction_reason: record.correction_reason,
      report_type: record.report_type, examined_on: record.examined_on,
      result_status: record.result_status, result_text: record.result_text,
      result_reason: record.result_reason, source_status: record.source_status,
      source_text: record.source_text, source_reason: record.source_reason,
      attachment_status: record.attachment_status, attachment_id: record.attachment_id,
      attachment_sha256: record.attachment_sha256,
      attachment_source_filename: record.attachment_source_filename,
      payload_hash: record.payload_hash, content_hash: record.content_hash,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at,
    })),
    {
      record_version_id: VERSION_D1, report_key: REPORT_D, version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      report_type: "展示生化檢查報告", examined_on: otherDate,
      result_status: "not_applicable", result_text: null,
      result_reason: "展示不適用原因：此份資料僅記錄完成狀態",
      source_status: "missing", source_text: null,
      source_reason: "展示缺值原因：原始來源尚未確認",
      attachment_status: "not_applicable", attachment_id: null,
      attachment_sha256: null, attachment_source_filename: null,
      payload_hash: "4".repeat(64), content_hash: "f".repeat(64),
      recorded_by_display_name: "展示護理人員",
      recorded_at: new Date(now.getTime() - 30 * 60 * 60_000).toISOString(),
    },
  ];
  const history = baseHistory.filter(({ report_key }) => visibleKeys.has(report_key))
    .sort((a, b) => a.report_key.localeCompare(b.report_key) ||
      Number(b.version) - Number(a.version));

  const row: ClientInspectionReportSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
    snapshot_date: today, records, record_total: records.length,
    records_truncated: false,
    active_total: records.filter(({ record_status }) => record_status === "active").length,
    voided_total: records.filter(({ record_status }) => record_status === "voided").length,
    missing_result_total: records.filter(({ result_status }) => result_status === "missing").length,
    missing_attachment_total: records.filter(({ attachment_status }) =>
      attachment_status === "missing").length,
    duplicate_warning_total: records.filter(({ duplicate_warning }) => duplicate_warning).length,
    history, history_total: history.length, history_truncated: false,
    client_options: [
      { client_id: CLIENT_A, client_code: "DEMO-C001", display_name: "展示個案甲" },
      { client_id: CLIENT_B, client_code: "DEMO-C002", display_name: "展示個案乙" },
    ], client_total: 2, clients_truncated: false,
    type_options: [
      { report_type: "展示胸部影像報告", record_count: 3 },
      { report_type: "展示生化檢查報告", record_count: 1 },
    ], type_total: 2, types_truncated: false,
    duplicate_rule_status: "configured",
    duplicate_resolution: "warning_only_no_auto_merge",
    report_type_taxonomy_status: "manual_unstandardized",
    medical_interpretation_status: "not_configured",
    diagnosis_status: "not_configured", ocr_status: "not_configured",
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured",
    attachment_download_status: "not_configured",
    export_status: "not_configured", offline_status: "not_configured",
    recent_aal2_max_age_minutes: 15,
  };
  return projectClientInspectionReportSnapshot({ row,
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    filters, demo: true });
}
