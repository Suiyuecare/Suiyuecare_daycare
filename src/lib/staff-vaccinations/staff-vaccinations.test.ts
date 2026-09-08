import { describe, expect, it } from "vitest";

import { buildDemoStaffVaccinationSnapshot } from "./demo";
import {
  parseStaffVaccinationRecordApiEnvelope,
  parseStaffVaccinationRecordInput,
  parseStaffVaccinationRecordReceipt,
} from "./parser";
import {
  projectStaffVaccinationSnapshot,
  type StaffVaccinationSnapshotSourceRow,
} from "./projection";
import type { StaffVaccinationFilters } from "./types";

const ORG = "73000000-0000-4000-8000-000000000001";
const BRANCH = "73000000-0000-4000-8000-000000000002";
const KEY = "73000000-0000-4000-8000-000000000003";
const STAFF = "73040000-0000-4000-8000-000000000001";
const VACCINATION = "73071000-0000-4000-8000-000000000001";
const VERSION = "73070000-0000-4000-8000-000000000001";
const filters: StaffVaccinationFilters = {
  staffMembershipId: null, vaccineName: null, doseNumber: null,
  dateFrom: null, dateTo: null, status: "all", query: "",
};
const inputBody = {
  action: "create", vaccination_key: VACCINATION,
  previous_version_id: null, expected_base_version: 0,
  staff_membership_id: STAFF, vaccine_name: "合成疫苗",
  dose_number: "合成第 1 劑", vaccinated_on: "2026-08-20",
  lot_number: null, provider_name: "合成院所",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null,
};
const receipt = {
  organization_id: ORG, branch_id: BRANCH,
  vaccination_key: VACCINATION, record_version_id: VERSION,
  version: 1, previous_version_id: null, record_status: "active",
  staff_membership_id: STAFF, content_hash: "a".repeat(64),
  duplicate_warning: true, duplicate_count: 1,
  duplicate_basis: "same_staff_normalized_vaccine_and_dose",
  recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
};

describe("page-73 staff vaccination contracts", () => {
  it("parses the full fact without inventing medical semantics", () => {
    expect(parseStaffVaccinationRecordInput(inputBody, KEY)).toMatchObject({
      vaccineName: "合成疫苗", doseNumber: "合成第 1 劑",
      vaccinatedOn: "2026-08-20", lotNumber: null,
      evidenceStatus: "missing", attachmentReference: null,
    });
  });

  it("fails closed on attachment references before a trusted pipeline exists", () => {
    expect(() => parseStaffVaccinationRecordInput({ ...inputBody,
      evidence_status: "provided", attachment_reference: "browser://fake",
      attachment_sha256: "a".repeat(64),
    }, KEY)).toThrow();
  });

  it("requires exact immutable version shape", () => {
    expect(() => parseStaffVaccinationRecordInput({ ...inputBody,
      action: "correct", previous_version_id: VERSION,
      expected_base_version: 1, correction_reason: null,
    }, KEY)).toThrow();
  });

  it("correlates duplicate warning and receipt count", () => {
    const input = parseStaffVaccinationRecordInput(inputBody, KEY);
    expect(parseStaffVaccinationRecordReceipt(receipt, input, ORG, BRANCH))
      .toMatchObject({ duplicateWarning: true, duplicateCount: 1,
        duplicateBasis: "same_staff_normalized_vaccine_and_dose" });
    expect(() => parseStaffVaccinationRecordReceipt({ ...receipt,
      duplicate_warning: false }, input, ORG, BRANCH)).toThrow();
  });

  it("correlates HTTP status with replay state", () => {
    const input = parseStaffVaccinationRecordInput(inputBody, KEY);
    const apiReceipt = {
      organizationId: ORG, branchId: BRANCH, vaccinationKey: VACCINATION,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", staffMembershipId: STAFF,
      contentHash: "a".repeat(64), duplicateWarning: true, duplicateCount: 1,
      duplicateBasis: "same_staff_normalized_vaccine_and_dose",
      recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
      persisted: true, demo: false,
    };
    const envelope = { requestId: KEY, status: "ok",
      data: { receipt: apiReceipt, persisted: true, demo: false }, errors: [] };
    expect(parseStaffVaccinationRecordApiEnvelope(
      envelope, input, ORG, BRANCH, 201,
    )).toMatchObject({ vaccinationKey: VACCINATION });
    expect(() => parseStaffVaccinationRecordApiEnvelope(
      envelope, input, ORG, BRANCH, 200,
    )).toThrow();
  });

  it("uses synthetic read-only demo records with explicit duplicate matches", () => {
    const snapshot = buildDemoStaffVaccinationSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.duplicateWarningTotal).toBe(2);
    expect(snapshot.records.filter((record) => record.duplicateWarning)).toHaveLength(2);
    expect(snapshot.records[0]?.medicalInterpretationStatus).toBe("not_evaluated");
    expect(snapshot.reminderScheduleStatus).toBe("not_configured");
    expect(snapshot.attachmentPipelineStatus).toBe("not_configured");
  });

  it("filters demo duplicates without auto-merging them", () => {
    const snapshot = buildDemoStaffVaccinationSnapshot({
      organizationId: ORG, branchId: BRANCH,
      filters: { ...filters, status: "duplicate_warning" },
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.records).toHaveLength(2);
    expect(new Set(snapshot.records.map((record) => record.vaccinationKey)).size).toBe(2);
  });

  it("rejects a snapshot whose duplicate evidence is internally inconsistent", () => {
    const snapshot = buildDemoStaffVaccinationSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    const source: StaffVaccinationSnapshotSourceRow = {
      organization_id: snapshot.organizationId,
      branch_id: snapshot.branchId,
      generated_at: snapshot.generatedAt,
      snapshot_date: snapshot.snapshotDate,
      records: [], record_total: 1, records_truncated: false,
      missing_evidence_total: 0, duplicate_warning_total: 0,
      current_month_total: 0, history: [], history_total: 0,
      history_truncated: false, staff_options: [], staff_total: 0,
      staff_truncated: false, vaccine_options: [], vaccine_total: 0,
      vaccines_truncated: false, dose_options: [], dose_total: 0,
      doses_truncated: false, duplicate_rule_status: "configured",
      duplicate_basis: "same_staff_normalized_vaccine_and_dose",
      duplicate_resolution: "warning_only_no_auto_merge",
      medical_interpretation_status: "not_evaluated",
      reminder_schedule_status: "not_configured", reminder_days: null,
      reminder_total: null, attachment_pipeline_status: "not_configured",
      attachment_scan_status: "not_configured",
    };
    expect(() => projectStaffVaccinationSnapshot({ row: source,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_VACCINATION_SNAPSHOT_INVALID");
  });
});
