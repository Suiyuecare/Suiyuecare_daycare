import { describe, expect, it } from "vitest";

import { buildDemoClientVaccinationSnapshot } from "./demo";
import { parseClientVaccinationBatchApiEnvelope, parseClientVaccinationBatchInput,
  parseClientVaccinationRecordInput, parseClientVaccinationRecordReceipt } from "./parser";
import { projectClientVaccinationSnapshot,
  type ClientVaccinationSnapshotSourceRow } from "./projection";
import { parseClientVaccinationFilters } from "./query";
import type { ClientVaccinationFilters } from "./types";

const ORG = "23000000-0000-4000-8000-000000000001";
const BRANCH = "23000000-0000-4000-8000-000000000002";
const CLIENT = "23000000-0000-4000-8000-000000000003";
const KEY = "23000000-0000-4000-8000-000000000004";
const VERSION = "23000000-0000-4000-8000-000000000005";
const ACTOR = "23000000-0000-4000-8000-000000000006";
const IDEMPOTENCY = "23000000-0000-4000-8000-000000000007";
const filters: ClientVaccinationFilters = { clientId: null, vaccineName: null,
  doseNumber: null, dateFrom: null, dateTo: null, status: "all", query: "" };

function source(): ClientVaccinationSnapshotSourceRow {
  const record = {
    record_version_id: VERSION, vaccination_key: KEY, version: 1,
    previous_version_id: null, record_status: "active" as const,
    correction_reason: null, client_id: CLIENT,
    client_display_name: "合成個案", client_code: "SYN-C001",
    vaccine_name: "來源疫苗", dose_number: "來源第 1 劑",
    vaccinated_on: "2026-09-06", lot_number: "SYN-LOT",
    provider_name: "合成院所", evidence_status: "missing" as const,
    evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry" as const, source_record_id: null,
    duplicate_warning: false, duplicate_count: 0,
    duplicate_basis: "same_client_normalized_vaccine_and_dose" as const,
    duplicate_matches: [], duplicate_matches_truncated: false,
    medical_interpretation_status: "not_evaluated" as const,
    recorded_by: ACTOR, recorded_by_display_name: "合成人員",
    recorded_at: "2026-09-07T02:00:00.000Z", content_hash: "a".repeat(64),
  };
  return {
    organization_id: ORG, branch_id: BRANCH,
    generated_at: "2026-09-07T02:30:00.000Z", snapshot_date: "2026-09-07",
    stale_after: "2026-09-07T02:31:00.000Z",
    filters: { client_id: null, vaccine_name: null, dose_number: null,
      date_from: null, date_to: null, status: "all", query: "" },
    records: [record], record_total: 1, records_truncated: false,
    missing_evidence_total: 1, duplicate_warning_total: 0,
    current_month_total: 1,
    history: [{ record_version_id: record.record_version_id,
      vaccination_key: record.vaccination_key, version: record.version,
      previous_version_id: record.previous_version_id,
      record_status: record.record_status, correction_reason: record.correction_reason,
      vaccine_name: record.vaccine_name, dose_number: record.dose_number,
      vaccinated_on: record.vaccinated_on, lot_number: record.lot_number,
      provider_name: record.provider_name, evidence_status: record.evidence_status,
      evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
      source_system: "manual_entry", source_record_id: null,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at, content_hash: record.content_hash }],
    history_total: 1, history_truncated: false,
    client_options: [{ client_id: CLIENT, display_name: "合成個案",
      client_code: "SYN-C001", service_status: "active", can_record: true }],
    client_total: 1, clients_truncated: false,
    vaccine_options: [{ vaccine_name: "來源疫苗", record_count: 1 }],
    vaccine_total: 1, vaccines_truncated: false,
    dose_options: [{ dose_number: "來源第 1 劑", record_count: 1 }],
    dose_total: 1, doses_truncated: false,
    duplicate_rule_status: "configured",
    duplicate_basis: "same_client_normalized_vaccine_and_dose",
    duplicate_resolution: "warning_only_no_auto_merge",
    medical_interpretation_status: "not_evaluated",
    reminder_schedule_status: "not_configured", reminder_days: null,
    reminder_total: null, attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured", batch_maximum_items: 20,
    offline_status: "not_configured",
  };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return { action: "create", vaccination_key: KEY, previous_version_id: null,
    expected_base_version: 0, client_id: CLIENT, vaccine_name: "來源疫苗",
    dose_number: "第 1 劑", vaccinated_on: "2026-09-06",
    lot_number: null, provider_name: "合成院所", evidence_status: "missing",
    evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry", source_record_id: null,
    correction_reason: null, ...overrides };
}

function persistedPayload() {
  return { client_id: CLIENT, vaccine_name: "來源疫苗", dose_number: "第 1 劑",
    vaccinated_on: "2026-09-06", lot_number: null, provider_name: "合成院所",
    evidence_status: "missing", evidence_reference_id: null, evidence_sha256: null,
    evidence_file_name: null, source_system: "manual_entry", source_record_id: null };
}

describe("Page 23 client vaccination contracts", () => {
  it("parses bounded filters and fails closed on arrays, invalid days and ranges", () => {
    expect(parseClientVaccinationFilters({ client: CLIENT.toUpperCase(),
      from: "2026-09-01", to: "2026-09-07", status: "missing_evidence",
      q: "  疫苗  " }).filters).toMatchObject({ clientId: CLIENT,
      dateFrom: "2026-09-01", dateTo: "2026-09-07",
      status: "missing_evidence", query: "疫苗" });
    expect(parseClientVaccinationFilters({ from: "2026-02-30" }).invalid).toBe(true);
    expect(parseClientVaccinationFilters({ from: "2026-09-08",
      to: "2026-09-07" }).invalid).toBe(true);
    expect(parseClientVaccinationFilters({ q: ["甲", "乙"] }).invalid).toBe(true);
  });

  it("builds only synthetic demo facts and preserves duplicate warnings without merging", () => {
    const snapshot = buildDemoClientVaccinationSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date("2026-09-07T02:30:00.000Z") });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.records).toHaveLength(3);
    expect(snapshot.records.filter((record) => record.duplicateWarning)).toHaveLength(2);
    expect(snapshot.records.every((record) => record.clientCode.startsWith("DEMO-"))).toBe(true);
    expect(snapshot.records.map((record) => record.clientDisplayName)).toEqual(["展示個案甲", "展示個案甲", "展示個案乙"]);
    const filtered = buildDemoClientVaccinationSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, status: "duplicate_warning" },
      now: new Date("2026-09-07T02:30:00.000Z") });
    expect(filtered.recordTotal).toBe(2);
  });

  it("strictly projects tenant, evidence, source, totals and terminal ordering", () => {
    const valid = source();
    expect(projectClientVaccinationSnapshot({ row: valid,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters,
      demo: false }).records[0]?.evidenceStatus).toBe("missing");
    const wrongTenant = structuredClone(valid); wrongTenant.branch_id = ORG;
    expect(() => projectClientVaccinationSnapshot({ row: wrongTenant,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters,
      demo: false })).toThrow("CLIENT_VACCINATION_SNAPSHOT_INVALID");
    const forgedEvidence = structuredClone(valid);
    forgedEvidence.records[0]!.evidence_status = "provided";
    expect(() => projectClientVaccinationSnapshot({ row: forgedEvidence,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters,
      demo: false })).toThrow();
    const forgedMetric = structuredClone(valid); forgedMetric.missing_evidence_total = 0;
    expect(() => projectClientVaccinationSnapshot({ row: forgedMetric,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters,
      demo: false })).toThrow();
    const future = structuredClone(valid); future.records[0]!.vaccinated_on = "2026-09-08";
    expect(() => projectClientVaccinationSnapshot({ row: future,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters,
      demo: false })).toThrow();
  });

  it.each([
    ["expired freshness contract", (row: ClientVaccinationSnapshotSourceRow) => { row.stale_after = row.generated_at; }],
    ["broadened status", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.status = "active"; }],
    ["wrong client filter", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.client_id = CLIENT; }],
    ["wrong vaccine filter", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.vaccine_name = "來源疫苗"; }],
    ["wrong dose filter", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.dose_number = "來源第 1 劑"; }],
    ["wrong date filter", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.date_from = "2026-09-01"; }],
    ["wrong end date", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.date_to = "2026-09-07"; }],
    ["wrong search", (row: ClientVaccinationSnapshotSourceRow) => { row.filters.query = "合成"; }],
    ["unrelated history", (row: ClientVaccinationSnapshotSourceRow) => { row.history[0]!.vaccination_key = ACTOR; }],
    ["inactive writable client", (row: ClientVaccinationSnapshotSourceRow) => { row.client_options[0]!.service_status = "closed"; }],
  ] as const)("rejects %s even when visible records look plausible", (_name, mutate) => {
    const row = source(); mutate(row);
    expect(() => projectClientVaccinationSnapshot({ row, expectedOrganizationId: ORG,
      expectedBranchId: BRANCH, filters, demo: false })).toThrow("CLIENT_VACCINATION_SNAPSHOT_INVALID");
  });

  it("accepts manual create but rejects browser-supplied proof and short reasons", () => {
    expect(parseClientVaccinationRecordInput(createBody(), IDEMPOTENCY))
      .toMatchObject({ action: "create", evidenceStatus: "missing",
        evidenceReferenceId: null, sourceSystem: "manual_entry" });
    expect(() => parseClientVaccinationRecordInput(createBody({
      evidence_status: "provided", evidence_reference_id: VERSION,
      evidence_sha256: "a".repeat(64), evidence_file_name: "proof.pdf",
    }), IDEMPOTENCY)).toThrow();
    expect(() => parseClientVaccinationRecordInput({ action: "void",
      vaccination_key: KEY, previous_version_id: VERSION,
      expected_base_version: 1, client_id: CLIENT, correction_reason: "太短" },
    IDEMPOTENCY)).toThrow();
  });

  it("parses create-only batches with unique row keys and a 20-row ceiling", () => {
    const body = { items: [{ idempotency_key: IDEMPOTENCY,
      record: createBody() }] };
    expect(parseClientVaccinationBatchInput(body, ACTOR).items).toHaveLength(1);
    expect(() => parseClientVaccinationBatchInput({ items: [body.items[0],
      body.items[0]] }, ACTOR)).toThrow();
    expect(() => parseClientVaccinationBatchInput({ items: Array.from({ length: 21 },
      (_, index) => ({ idempotency_key: `23000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        record: createBody({ vaccination_key: `23000000-0000-4000-8001-${String(index + 10).padStart(12, "0")}` }) })) }, ACTOR)).toThrow();
  });

  it("accepts only a receipt matching tenant, client, version and duplicate arithmetic", () => {
    const input = parseClientVaccinationRecordInput(createBody(), IDEMPOTENCY);
    const receipt = { record_payload: persistedPayload(), organization_id: ORG, branch_id: BRANCH,
      vaccination_key: KEY, record_version_id: VERSION, version: 1,
      previous_version_id: null, record_status: "active", client_id: CLIENT,
      content_hash: "b".repeat(64), duplicate_warning: false,
      duplicate_count: 0,
      duplicate_basis: "same_client_normalized_vaccine_and_dose",
      recorded_at: "2026-09-07T02:40:00.000Z", replayed: false };
    expect(parseClientVaccinationRecordReceipt(receipt, input, ORG, BRANCH))
      .toMatchObject({ persisted: true, demo: false, clientId: CLIENT });
    expect(() => parseClientVaccinationRecordReceipt({ ...receipt,
      duplicate_warning: true }, input, ORG, BRANCH)).toThrow();
    expect(() => parseClientVaccinationRecordReceipt({ ...receipt,
      branch_id: ORG }, input, ORG, BRANCH)).toThrow();
    for (const field of ["vaccine_name", "dose_number", "provider_name", "lot_number"]) {
      expect(() => parseClientVaccinationRecordReceipt({ ...receipt,
        record_payload: { ...receipt.record_payload, [field]: "不同的已保存內容" } },
      input, ORG, BRANCH)).toThrow();
    }
    expect(() => parseClientVaccinationRecordReceipt({ ...receipt,
      record_payload: { ...receipt.record_payload, vaccinated_on: "2026-09-05" } },
    input, ORG, BRANCH)).toThrow();
  });

  it("correlates an atomic batch envelope with its outer and per-item keys", () => {
    const expected = parseClientVaccinationBatchInput({ items: [{
      idempotency_key: IDEMPOTENCY, record: createBody(),
    }] }, ACTOR);
    const receipt = { recordPayload: persistedPayload(), organizationId: ORG, branchId: BRANCH,
      vaccinationKey: KEY, recordVersionId: VERSION, version: 1,
      previousVersionId: null, recordStatus: "active", clientId: CLIENT,
      contentHash: "b".repeat(64), duplicateWarning: false, duplicateCount: 0,
      duplicateBasis: "same_client_normalized_vaccine_and_dose",
      recordedAt: "2026-09-07T02:40:00.000Z", replayed: false,
      persisted: true, demo: false };
    const envelope = { requestId: KEY, status: "ok", errors: [], data: {
      batchId: VERSION, batchIdempotencyKey: ACTOR,
      requestHash: "c".repeat(64), replayed: false,
      itemTotal: 1, succeededTotal: 1, rejectedTotal: 0,
      results: [{ index: 0, idempotencyKey: IDEMPOTENCY, status: "created",
        receipt, error: null }], persisted: true, demo: false,
    } };
    expect(parseClientVaccinationBatchApiEnvelope(
      envelope, expected, ORG, BRANCH, 200,
    )).toMatchObject({ batchIdempotencyKey: ACTOR, itemTotal: 1,
      succeededTotal: 1, rejectedTotal: 0 });
    expect(() => parseClientVaccinationBatchApiEnvelope({ ...envelope,
      data: { ...envelope.data, batchIdempotencyKey: KEY } },
    expected, ORG, BRANCH, 200)).toThrow();
    expect(() => parseClientVaccinationBatchApiEnvelope({ ...envelope,
      data: { ...envelope.data, succeededTotal: 0, rejectedTotal: 1 } },
    expected, ORG, BRANCH, 200)).toThrow();
  });
});
