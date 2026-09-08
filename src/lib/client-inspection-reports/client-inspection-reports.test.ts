import { describe, expect, it } from "vitest";

import { buildDemoClientInspectionReportSnapshot } from "./demo";
import {
  parseClientInspectionReportApiEnvelope,
  parseClientInspectionReportInput,
  parseClientInspectionReportReceipt,
} from "./parser";
import {
  projectClientInspectionReportSnapshot,
  type ClientInspectionReportSnapshotSourceRow,
} from "./projection";
import { parseClientInspectionReportFilters } from "./query";
import type { ClientInspectionReportFilters } from "./types";

const ORG = "22000000-0000-4000-8000-000000000001";
const BRANCH = "22000000-0000-4000-8000-000000000002";
const CLIENT = "22000000-0000-4000-8000-000000000003";
const KEY = "22000000-0000-4000-8000-000000000004";
const REPORT = "22000000-0000-4000-8000-000000000005";
const VERSION = "22000000-0000-4000-8000-000000000006";
const filters: ClientInspectionReportFilters = {
  clientId: null, reportType: null, examinedFrom: null, examinedTo: null,
  recordStatus: "all", resultStatus: "all", sourceStatus: "all",
  attachmentStatus: "all", duplicateStatus: "all", query: "",
};
const body = {
  action: "create", report_key: REPORT, previous_version_id: null,
  expected_base_version: 0, client_id: CLIENT, report_type: "合成檢查類型",
  examined_on: "2026-08-20", result_status: "present",
  result_text: "合成結果來源原文", result_reason: null,
  source_status: "missing", source_text: null,
  source_reason: "來源單位仍待人工確認補齊", attachment_status: "missing",
  attachment_id: null, attachment_sha256: null,
  attachment_source_filename: null, correction_reason: null,
};
const receipt = {
  organization_id: ORG, branch_id: BRANCH, report_key: REPORT,
  record_version_id: VERSION, version: 1, previous_version_id: null,
  record_status: "active", client_id: CLIENT,
  content_hash: "a".repeat(64), payload_hash: "b".repeat(64),
  exact_duplicate_count: 1, key_field_duplicate_count: 2,
  attachment_duplicate_count: 0, duplicate_warning: true,
  duplicate_resolution: "warning_only_no_auto_merge",
  recorded_at: "2026-09-07T04:00:00.000Z", replayed: false,
};

describe("Page 22 client inspection report contracts", () => {
  it("parses strict tri-state result, source and unavailable attachment input", () => {
    expect(parseClientInspectionReportInput(body, KEY)).toMatchObject({
      action: "create", clientId: CLIENT, resultStatus: "present",
      resultText: "合成結果來源原文", resultReason: null,
      sourceStatus: "missing", sourceText: null,
      sourceReason: "來源單位仍待人工確認補齊", attachmentStatus: "missing",
      attachmentId: null,
    });
  });

  it("rejects unknown fields, invalid dates and empty missing-value reasons", () => {
    expect(() => parseClientInspectionReportInput({ ...body, diagnosis: "正常" }, KEY))
      .toThrow();
    expect(() => parseClientInspectionReportInput({ ...body,
      examined_on: "2026-02-30",
    }, KEY)).toThrow();
    expect(() => parseClientInspectionReportInput({ ...body,
      result_status: "missing", result_text: null, result_reason: "   ",
    }, KEY)).toThrow();
  });

  it("fails closed when create claims an attachment identifier", () => {
    expect(() => parseClientInspectionReportInput({ ...body,
      attachment_status: "provided",
      attachment_id: "22000000-0000-4000-8000-000000000010",
      attachment_sha256: "c".repeat(64),
      attachment_source_filename: "pretend.pdf",
    }, KEY)).toThrow("附件服務尚未配置");
  });

  it("allows only a fully described prior trusted attachment on correction", () => {
    const corrected = { ...body, action: "correct", previous_version_id: VERSION,
      expected_base_version: 1, correction_reason: "查核原始文件後建立更正版",
      attachment_status: "provided",
      attachment_id: "22000000-0000-4000-8000-000000000010",
      attachment_sha256: "c".repeat(64), attachment_source_filename: "trusted.pdf" };
    expect(parseClientInspectionReportInput(corrected, KEY)).toMatchObject({
      action: "correct", attachmentStatus: "provided",
      attachmentSourceFilename: "trusted.pdf",
    });
    expect(() => parseClientInspectionReportInput({ ...corrected,
      attachment_sha256: null,
    }, KEY)).toThrow();
  });

  it("requires an exact terminal base and reason shape for void", () => {
    expect(parseClientInspectionReportInput({ action: "void", report_key: REPORT,
      previous_version_id: VERSION, expected_base_version: 1, client_id: CLIENT,
      correction_reason: "確認來源不屬此個案故依法作廢",
    }, KEY)).toMatchObject({ action: "void", expectedBaseVersion: 1 });
    expect(() => parseClientInspectionReportInput({ action: "void", report_key: REPORT,
      previous_version_id: VERSION, expected_base_version: 0, client_id: CLIENT,
      correction_reason: "太短",
    }, KEY)).toThrow();
  });

  it("correlates strict hashes, versions and all duplicate tiers in receipts", () => {
    const input = parseClientInspectionReportInput(body, KEY);
    expect(parseClientInspectionReportReceipt(receipt, input, ORG, BRANCH))
      .toMatchObject({ reportKey: REPORT, version: 1, exactDuplicateCount: 1,
        keyFieldDuplicateCount: 2, attachmentDuplicateCount: 0,
        duplicateWarning: true, persisted: true });
    expect(() => parseClientInspectionReportReceipt({ ...receipt,
      duplicate_warning: false,
    }, input, ORG, BRANCH)).toThrow();
    expect(() => parseClientInspectionReportReceipt({ ...receipt,
      payload_hash: "not-a-hash",
    }, input, ORG, BRANCH)).toThrow();
  });

  it("correlates HTTP replay state with 200 or 201", () => {
    const input = parseClientInspectionReportInput(body, KEY);
    const apiReceipt = {
      organizationId: ORG, branchId: BRANCH, reportKey: REPORT,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", clientId: CLIENT, contentHash: "a".repeat(64),
      payloadHash: "b".repeat(64), exactDuplicateCount: 1,
      keyFieldDuplicateCount: 2, attachmentDuplicateCount: 0,
      duplicateWarning: true, duplicateResolution: "warning_only_no_auto_merge",
      recordedAt: "2026-09-07T04:00:00.000Z", replayed: false,
      persisted: true, demo: false,
    };
    const envelope = { requestId: KEY, status: "ok", errors: [],
      data: { receipt: apiReceipt, persisted: true, demo: false } };
    expect(parseClientInspectionReportApiEnvelope(
      envelope, input, ORG, BRANCH, 201,
    )).toMatchObject({ reportKey: REPORT });
    expect(() => parseClientInspectionReportApiEnvelope(
      envelope, input, ORG, BRANCH, 200,
    )).toThrow();
  });

  it("strictly parses query keys, duplicates, dates, enums and ranges", () => {
    expect(parseClientInspectionReportFilters(new URLSearchParams(
      `client=${CLIENT}&type=%E5%90%88%E6%88%90%E6%AA%A2%E6%9F%A5&from=2026-08-01&to=2026-08-31&duplicate=exact`,
    ))).toMatchObject({ clientId: CLIENT, reportType: "合成檢查",
      examinedFrom: "2026-08-01", examinedTo: "2026-08-31",
      duplicateStatus: "exact" });
    expect(() => parseClientInspectionReportFilters(
      new URLSearchParams("client=all&client=all"))).toThrow();
    expect(() => parseClientInspectionReportFilters(
      new URLSearchParams("unknown=value"))).toThrow();
    expect(() => parseClientInspectionReportFilters(
      new URLSearchParams("from=2026-09-02&to=2026-09-01"))).toThrow();
  });

  it("provides only synthetic read-only demo facts and explicit boundaries", () => {
    const snapshot = buildDemoClientInspectionReportSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-07T04:00:00.000Z"),
    });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.records).toHaveLength(4);
    expect(snapshot.history).toHaveLength(5);
    expect(snapshot.duplicateWarningTotal).toBe(3);
    expect(snapshot.records.every((record) =>
      record.clientDisplayName.startsWith("展示個案"))).toBe(true);
    expect(snapshot.attachmentPipelineStatus).toBe("not_configured");
    expect(snapshot.medicalInterpretationStatus).toBe("not_configured");
    expect(snapshot.diagnosisStatus).toBe("not_configured");
    expect(snapshot.ocrStatus).toBe("not_configured");
    expect(snapshot.exportStatus).toBe("not_configured");
  });

  it("filters exact, key, attachment and no-warning tiers without merging", () => {
    const build = (duplicateStatus: ClientInspectionReportFilters["duplicateStatus"]) =>
      buildDemoClientInspectionReportSnapshot({ organizationId: ORG, branchId: BRANCH,
        filters: { ...filters, duplicateStatus },
        now: new Date("2026-09-07T04:00:00.000Z") });
    expect(build("exact").records).toHaveLength(2);
    expect(build("key_fields").records).toHaveLength(3);
    expect(build("attachment").records).toHaveLength(2);
    expect(build("none").records).toHaveLength(1);
  });

  it("rejects contradictory snapshot aggregates, states and chain evidence", () => {
    const snapshot = buildDemoClientInspectionReportSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-07T04:00:00.000Z"),
    });
    const source = toSource(snapshot);
    expect(() => projectClientInspectionReportSnapshot({
      row: { ...source, active_total: 999 }, expectedOrganizationId: ORG,
      expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("INVALID_CLIENT_INSPECTION_REPORT_SNAPSHOT");
    expect(() => projectClientInspectionReportSnapshot({
      row: { ...source, records: source.records.map((record, index) => index === 0
        ? { ...record, result_status: "missing" as const, result_text: null,
          result_reason: null } : record) }, expectedOrganizationId: ORG,
      expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("INVALID_CLIENT_INSPECTION_REPORT_SNAPSHOT");
    expect(() => projectClientInspectionReportSnapshot({
      row: { ...source, history: source.history.slice(1),
        history_total: Number(source.history_total) - 1 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("INVALID_CLIENT_INSPECTION_REPORT_SNAPSHOT");
  });
});

function toSource(snapshot: ReturnType<typeof buildDemoClientInspectionReportSnapshot>):
ClientInspectionReportSnapshotSourceRow {
  return {
    organization_id: snapshot.organizationId, branch_id: snapshot.branchId,
    generated_at: snapshot.generatedAt, snapshot_date: snapshot.snapshotDate,
    records: snapshot.records.map((record) => ({
      record_version_id: record.recordVersionId, report_key: record.reportKey,
      version: record.version, previous_version_id: record.previousVersionId,
      record_status: record.recordStatus, correction_reason: record.correctionReason,
      client_id: record.clientId, client_code: record.clientCode,
      client_display_name: record.clientDisplayName, report_type: record.reportType,
      examined_on: record.examinedOn, result_status: record.resultStatus,
      result_text: record.resultText, result_reason: record.resultReason,
      source_status: record.sourceStatus, source_text: record.sourceText,
      source_reason: record.sourceReason, attachment_status: record.attachmentStatus,
      attachment_id: record.attachmentId, attachment_sha256: record.attachmentSha256,
      attachment_source_filename: record.attachmentSourceFilename,
      payload_hash: record.payloadHash, content_hash: record.contentHash,
      exact_duplicate_count: record.exactDuplicateCount,
      key_field_duplicate_count: record.keyFieldDuplicateCount,
      attachment_duplicate_count: record.attachmentDuplicateCount,
      duplicate_warning: record.duplicateWarning,
      duplicate_bases: [...record.duplicateBases],
      duplicate_matches: record.duplicateMatches.map((match) => ({
        report_key: match.reportKey, record_version_id: match.recordVersionId,
        examined_on: match.examinedOn, match_kind: match.matchKind,
      })), duplicate_matches_truncated: record.duplicateMatchesTruncated,
      recorded_by: record.recordedBy,
      recorded_by_display_name: record.recordedByDisplayName,
      recorded_at: record.recordedAt,
    })), record_total: snapshot.recordTotal,
    records_truncated: snapshot.recordsTruncated, active_total: snapshot.activeTotal,
    voided_total: snapshot.voidedTotal,
    missing_result_total: snapshot.missingResultTotal,
    missing_attachment_total: snapshot.missingAttachmentTotal,
    duplicate_warning_total: snapshot.duplicateWarningTotal,
    history: snapshot.history.map((record) => ({
      record_version_id: record.recordVersionId, report_key: record.reportKey,
      version: record.version, previous_version_id: record.previousVersionId,
      record_status: record.recordStatus, correction_reason: record.correctionReason,
      report_type: record.reportType, examined_on: record.examinedOn,
      result_status: record.resultStatus, result_text: record.resultText,
      result_reason: record.resultReason, source_status: record.sourceStatus,
      source_text: record.sourceText, source_reason: record.sourceReason,
      attachment_status: record.attachmentStatus, attachment_id: record.attachmentId,
      attachment_sha256: record.attachmentSha256,
      attachment_source_filename: record.attachmentSourceFilename,
      payload_hash: record.payloadHash, content_hash: record.contentHash,
      recorded_by_display_name: record.recordedByDisplayName,
      recorded_at: record.recordedAt,
    })), history_total: snapshot.historyTotal,
    history_truncated: snapshot.historyTruncated,
    client_options: snapshot.clientOptions.map((client) => ({
      client_id: client.clientId, client_code: client.clientCode,
      display_name: client.displayName,
    })), client_total: snapshot.clientTotal,
    clients_truncated: snapshot.clientsTruncated,
    type_options: snapshot.typeOptions.map((type) => ({
      report_type: type.reportType, record_count: type.recordCount,
    })), type_total: snapshot.typeTotal, types_truncated: snapshot.typesTruncated,
    duplicate_rule_status: snapshot.duplicateRuleStatus,
    duplicate_resolution: snapshot.duplicateResolution,
    report_type_taxonomy_status: snapshot.reportTypeTaxonomyStatus,
    medical_interpretation_status: snapshot.medicalInterpretationStatus,
    diagnosis_status: snapshot.diagnosisStatus, ocr_status: snapshot.ocrStatus,
    attachment_pipeline_status: snapshot.attachmentPipelineStatus,
    attachment_scan_status: snapshot.attachmentScanStatus,
    attachment_download_status: snapshot.attachmentDownloadStatus,
    export_status: snapshot.exportStatus, offline_status: snapshot.offlineStatus,
    recent_aal2_max_age_minutes: snapshot.recentAal2MaxAgeMinutes,
  };
}
