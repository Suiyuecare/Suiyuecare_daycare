import { describe, expect, it } from "vitest";

import { parseCaseServiceRecordApiEnvelope } from "./client-contract";
import { buildDemoCaseServiceRecordSnapshot } from "./demo";
import {
  parseCaseServiceRecordMutation,
  parseCaseServiceRecordReceipt,
} from "./parser";
import {
  projectCaseServiceRecordSnapshot,
  type CaseServiceRecordSnapshotSourceRow,
} from "./projection";
import { emptyCaseServiceRecordFilters, parseCaseServiceRecordFilters } from "./query";

const ORG = "50110000-0000-4000-8000-000000000001";
const BRANCH = "50120000-0000-4000-8000-000000000001";
const CLIENT = "50130000-0000-4000-8000-000000000001";
const ACTOR = "50140000-0000-4000-8000-000000000001";
const CORRECTOR = "50140000-0000-4000-8000-000000000002";
const KEY = "50150000-0000-4000-8000-000000000001";
const RECORD = "50160000-0000-4000-8000-000000000001";
const VERSION = "50170000-0000-4000-8000-000000000001";
const SIGNED_VERSION = "50170000-0000-4000-8000-000000000002";
const CHALLENGE = "50180000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);

const createBody = {
  action: "save_record",
  mode: "create",
  record_key: null,
  previous_version_id: null,
  expected_version: 0,
  expected_content_hash: null,
  client_id: CLIENT,
  started_at: "2026-09-08T09:00:00+08:00",
  ended_at: "2026-09-08T09:30:00+08:00",
  service_type: "生活支持",
  service_content: "人工輸入服務內容。",
  service_result: "人工輸入服務結果。",
  execution_reference_id: null,
  revision_reason: "建立人工服務敘事草稿",
};

function persistedPayload() {
  return {
    client_id: CLIENT,
    started_at: "2026-09-08T01:00:00.000Z",
    ended_at: "2026-09-08T01:30:00.000Z",
    service_type: "生活支持",
    service_content: "人工輸入服務內容。",
    service_result: "人工輸入服務結果。",
    execution_reference_id: null,
    execution_reference_status: "not_linked",
    execution_reference_content_hash: null,
    author_user_id: ACTOR,
    source_kind: "manual_local",
    schema_kind: "manual_service_narrative_v1",
    statutory_rule_status: "not_configured",
    claim_eligibility_status: "not_configured",
  } as const;
}

function createReceipt() {
  return {
    organization_id: ORG,
    branch_id: BRANCH,
    client_id: CLIENT,
    actor_user_id: ACTOR,
    operation_id: KEY,
    idempotency_key: KEY,
    action: "save_record",
    record_key: RECORD,
    version_id: VERSION,
    version: 1,
    record_state: "draft",
    previous_version_id: null,
    source_content_hash: null,
    content_hash: HASH,
    record_payload: persistedPayload(),
    committed_at: "2026-09-08T01:31:00.000Z",
    replayed: false,
  } as const;
}

function snapshotSource(): CaseServiceRecordSnapshotSourceRow {
  const common = {
    record_key: RECORD,
    client_id: CLIENT,
    client_display_name: "合成個案",
    started_at: "2026-09-08T01:00:00.000Z",
    ended_at: "2026-09-08T01:30:00.000Z",
    service_type: "生活支持",
    service_content: "人工輸入服務內容。",
    service_result: "人工輸入服務結果。",
    execution_reference_id: null,
    execution_reference_status: "not_linked" as const,
    execution_reference_content_hash: null,
    execution_reference_verification: "not_linked" as const,
    author_user_id: ACTOR,
    author_display_name: "合成紀錄員",
    correction_reason: null,
    source_kind: "manual_local" as const,
    schema_kind: "manual_service_narrative_v1" as const,
    statutory_rule_status: "not_configured" as const,
    claim_eligibility_status: "not_configured" as const,
  };
  const draft = {
    ...common,
    version_id: VERSION,
    version: 1,
    previous_version_id: null,
    content_hash: HASH,
    record_state: "draft" as const,
    revision_reason: "建立人工服務敘事草稿",
    signed_at: null,
    signed_by_user_id: null,
    signer_display_name: null,
    signer_role_keys: null,
    signature_purpose: null,
    signature_reauth_challenge_id: null,
    created_at: "2026-09-08T01:31:00.000Z",
  };
  const signed = {
    ...common,
    version_id: SIGNED_VERSION,
    version: 2,
    previous_version_id: VERSION,
    content_hash: "b".repeat(64),
    record_state: "signed" as const,
    revision_reason: null,
    signed_at: "2026-09-08T01:32:00.000Z",
    signed_by_user_id: ACTOR,
    signer_display_name: "合成簽署人",
    signer_role_keys: ["branch_supervisor"],
    signature_purpose: "個案服務紀錄簽署",
    signature_reauth_challenge_id: CHALLENGE,
    created_at: "2026-09-08T01:32:00.000Z",
  };
  return {
    organization_id: ORG,
    branch_id: BRANCH,
    generated_at: "2026-09-08T01:33:00.000Z",
    records: [{ ...signed, history: [draft, signed], history_total: 2 }],
    matching_total: 1,
    records_truncated: false,
    service_total: 1,
    draft_total: 0,
    signed_total: 1,
    corrected_total: 0,
    linked_execution_total: 0,
    changed_execution_total: 0,
    clients: [{ client_id: CLIENT, display_name: "合成個案" }],
    client_total: 1,
    clients_truncated: false,
    service_types: ["生活支持"],
    service_type_total: 1,
    service_types_truncated: false,
    authors: [{ user_id: ACTOR, display_name: "合成紀錄員" }],
    author_total: 1,
    authors_truncated: false,
    schema_kind: "manual_service_narrative_v1",
    statutory_rule_status: "not_configured",
    attachment_status: "not_configured",
    export_status: "not_configured",
    notification_status: "not_configured",
    offline_status: "not_configured",
    claim_eligibility_status: "not_configured",
  };
}

describe("Page 50 case-service-record contracts", () => {
  it("parses only required local manual fields and no statutory or claim assertions", () => {
    expect(parseCaseServiceRecordMutation(createBody, KEY)).toMatchObject({
      action: "save_record",
      mode: "create",
      clientId: CLIENT,
      startedAt: "2026-09-08T01:00:00.000Z",
      serviceContent: "人工輸入服務內容。",
    });
    expect(() => parseCaseServiceRecordMutation({ ...createBody, statutory_complete: true }, KEY))
      .toThrow();
    expect(() => parseCaseServiceRecordMutation({ ...createBody, claim_eligible: true }, KEY))
      .toThrow();
    expect(() => parseCaseServiceRecordMutation({ ...createBody, service_content: "" }, KEY))
      .toThrow();
    expect(() => parseCaseServiceRecordMutation({ ...createBody, service_result: "" }, KEY))
      .toThrow();
  });

  it.each([
    "2026-02-30T10:00:00+08:00",
    "2025-02-29T10:00:00+08:00",
    "2026-09-08",
    "2026-09-08T10:00:00",
    "prefix2026-09-08T10:00:00Z",
  ])("rejects impossible or non-offset service timestamp %s", (startedAt) => {
    expect(() => parseCaseServiceRecordMutation({ ...createBody, started_at: startedAt }, KEY))
      .toThrow();
  });

  it("accepts offset minute precision and rejects a reversed period", () => {
    expect(parseCaseServiceRecordMutation({ ...createBody,
      started_at: "2026-09-08T09:00+08:00",
      ended_at: "2026-09-08T09:30+08:00",
    }, KEY)).toMatchObject({ startedAt: "2026-09-08T01:00:00.000Z" });
    expect(() => parseCaseServiceRecordMutation({ ...createBody,
      ended_at: "2026-09-08T08:59:00+08:00",
    }, KEY)).toThrow(/結束時間/u);
  });

  it("strictly handles native empty filters while rejecting repeats and unknown keys", () => {
    expect(parseCaseServiceRecordFilters(new URLSearchParams(
      "from=&to=&client=&type=&author=&status=all",
    ))).toEqual(emptyCaseServiceRecordFilters());
    expect(parseCaseServiceRecordFilters(new URLSearchParams(
      `from=2026-09-01&to=2026-09-30&client=${CLIENT}&type=%E7%94%9F%E6%B4%BB%E6%94%AF%E6%8C%81&author=${ACTOR}&status=signed`,
    ))).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-30",
      clientId: CLIENT, authorUserId: ACTOR, recordState: "signed" });
    expect(() => parseCaseServiceRecordFilters(new URLSearchParams("client=&client="))).toThrow();
    expect(() => parseCaseServiceRecordFilters(new URLSearchParams("query=敘事"))).toThrow();
    for (const invalidDate of ["2026-02-30", "2025-02-29", "2026-9-08",
      "2026-09-08T00:00:00+08:00"]) {
      expect(() => parseCaseServiceRecordFilters(new URLSearchParams(`from=${invalidDate}`)))
        .toThrow();
    }
  });

  it("correlates create receipts to tenant, actor, baseline and full persisted payload", () => {
    const input = parseCaseServiceRecordMutation(createBody, KEY);
    expect(parseCaseServiceRecordReceipt(createReceipt(), input, ORG, BRANCH, ACTOR))
      .toMatchObject({ organizationId: ORG, branchId: BRANCH, clientId: CLIENT,
        actorUserId: ACTOR, recordKey: RECORD, version: 1, persisted: true, demo: false,
        recordPayload: { serviceContent: "人工輸入服務內容。", statutoryRuleStatus: "not_configured" } });
  });

  it.each([
    { organization_id: ACTOR },
    { branch_id: ACTOR },
    { client_id: ACTOR },
    { actor_user_id: CLIENT },
    { idempotency_key: ACTOR },
    { version: 2 },
    { source_content_hash: HASH },
    { record_payload: { ...persistedPayload(), service_result: "遭置換" } },
  ])("rejects a detached or forged SQL receipt", (forgery) => {
    const input = parseCaseServiceRecordMutation(createBody, KEY);
    expect(() => parseCaseServiceRecordReceipt({ ...createReceipt(), ...forgery },
      input, ORG, BRANCH, ACTOR)).toThrow(/回執/u);
  });

  it("maps malformed persisted timestamps to a receipt failure, never a user-input 400", () => {
    const input = parseCaseServiceRecordMutation(createBody, KEY);
    try {
      parseCaseServiceRecordReceipt({ ...createReceipt(), record_payload: {
        ...persistedPayload(), started_at: "2026-02-30T10:00:00+08:00",
      } }, input, ORG, BRANCH, ACTOR);
      throw new Error("expected receipt failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "CASE_SERVICE_RECORD_RECEIPT_INVALID", httpStatus: 502 });
    }
  });

  it("requires sign input and receipt to retain the complete selected draft", () => {
    const expected = parseCaseServiceRecordReceipt(createReceipt(),
      parseCaseServiceRecordMutation(createBody, KEY), ORG, BRANCH, ACTOR).recordPayload;
    const signInput = parseCaseServiceRecordMutation({
      action: "sign_record",
      client_id: CLIENT,
      record_key: RECORD,
      previous_version_id: VERSION,
      expected_version: 1,
      expected_content_hash: HASH,
      expected_record_payload: {
        client_id: expected.clientId,
        started_at: expected.startedAt,
        ended_at: expected.endedAt,
        service_type: expected.serviceType,
        service_content: expected.serviceContent,
        service_result: expected.serviceResult,
        execution_reference_id: expected.executionReferenceId,
        execution_reference_status: expected.executionReferenceStatus,
        execution_reference_content_hash: expected.executionReferenceContentHash,
        author_user_id: expected.authorUserId,
        source_kind: expected.sourceKind,
        schema_kind: expected.schemaKind,
        statutory_rule_status: expected.statutoryRuleStatus,
        claim_eligibility_status: expected.claimEligibilityStatus,
      },
    }, KEY);
    expect(signInput).toMatchObject({ action: "sign_record", expectedRecordPayload: expected });
    expect(() => parseCaseServiceRecordMutation({
      action: "sign_record", client_id: CLIENT, record_key: RECORD,
      previous_version_id: VERSION, expected_version: 1, expected_content_hash: HASH,
    }, KEY)).toThrow();
  });

  it("keeps the original author distinct from the correction signer and binds the receipt", () => {
    const input = parseCaseServiceRecordMutation({
      action: "correct_record",
      client_id: CLIENT,
      record_key: RECORD,
      previous_version_id: VERSION,
      expected_version: 1,
      expected_content_hash: HASH,
      expected_author_user_id: ACTOR,
      started_at: createBody.started_at,
      ended_at: createBody.ended_at,
      service_type: createBody.service_type,
      service_content: createBody.service_content,
      service_result: "依紙本核對後修正人工結果。",
      execution_reference_id: null,
      reason: "依紙本原始紀錄核對後修正人工結果",
    }, KEY);
    const corrected = {
      ...createReceipt(),
      actor_user_id: CORRECTOR,
      action: "correct_record",
      version_id: SIGNED_VERSION,
      version: 2,
      record_state: "corrected",
      previous_version_id: VERSION,
      source_content_hash: HASH,
      content_hash: "b".repeat(64),
      record_payload: {
        ...persistedPayload(),
        service_result: "依紙本核對後修正人工結果。",
      },
    };
    expect(parseCaseServiceRecordReceipt(corrected, input, ORG, BRANCH, CORRECTOR))
      .toMatchObject({ actorUserId: CORRECTOR, recordPayload: { authorUserId: ACTOR } });
    expect(() => parseCaseServiceRecordReceipt({ ...corrected, record_payload: {
      ...corrected.record_payload,
      author_user_id: CORRECTOR,
    } }, input, ORG, BRANCH, CORRECTOR)).toThrow(/回執/u);
  });

  it("validates the camelCase browser envelope and HTTP replay status", () => {
    const input = parseCaseServiceRecordMutation(createBody, KEY);
    const sql = createReceipt();
    const api = {
      requestId: "50190000-0000-4000-8000-000000000001",
      status: "ok",
      errors: [],
      data: {
        organizationId: sql.organization_id, branchId: sql.branch_id, clientId: sql.client_id,
        actorUserId: sql.actor_user_id, operationId: sql.operation_id,
        idempotencyKey: sql.idempotency_key, action: sql.action, recordKey: sql.record_key,
        versionId: sql.version_id, version: sql.version, recordState: sql.record_state,
        previousVersionId: sql.previous_version_id, sourceContentHash: sql.source_content_hash,
        contentHash: sql.content_hash,
        recordPayload: {
          clientId: sql.record_payload.client_id, startedAt: sql.record_payload.started_at,
          endedAt: sql.record_payload.ended_at, serviceType: sql.record_payload.service_type,
          serviceContent: sql.record_payload.service_content, serviceResult: sql.record_payload.service_result,
          executionReferenceId: sql.record_payload.execution_reference_id,
          executionReferenceStatus: sql.record_payload.execution_reference_status,
          executionReferenceContentHash: sql.record_payload.execution_reference_content_hash,
          authorUserId: sql.record_payload.author_user_id, sourceKind: sql.record_payload.source_kind,
          schemaKind: sql.record_payload.schema_kind,
          statutoryRuleStatus: sql.record_payload.statutory_rule_status,
          claimEligibilityStatus: sql.record_payload.claim_eligibility_status,
        },
        committedAt: sql.committed_at, replayed: false, persisted: true, demo: false,
      },
    };
    expect(parseCaseServiceRecordApiEnvelope(api, 201, input, ORG, BRANCH, ACTOR))
      .toMatchObject({ recordKey: RECORD, replayed: false });
    expect(() => parseCaseServiceRecordApiEnvelope(api, 200, input, ORG, BRANCH, ACTOR)).toThrow();
    expect(() => parseCaseServiceRecordApiEnvelope({ ...api, warning: true },
      201, input, ORG, BRANCH, ACTOR)).toThrow();
    expect(() => parseCaseServiceRecordApiEnvelope({ ...api, errors: [{ code: "WARNING" }] },
      201, input, ORG, BRANCH, ACTOR)).toThrow();
  });

  it("projects signer evidence and a strict immutable draft-to-sign chain", () => {
    const projected = projectCaseServiceRecordSnapshot({ row: snapshotSource(),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: emptyCaseServiceRecordFilters(), demo: false });
    expect(projected.records[0]).toMatchObject({ recordState: "signed", historyTotal: 2,
      signerDisplayName: "合成簽署人", signerRoleKeys: ["branch_supervisor"],
      signaturePurpose: "個案服務紀錄簽署", signatureReauthChallengeId: CHALLENGE });
  });

  it("rejects forged full-set metrics, signature evidence and changed signed payload", () => {
    const metric = snapshotSource(); metric.signed_total = 0; metric.draft_total = 1;
    expect(() => projectCaseServiceRecordSnapshot({ row: metric,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: emptyCaseServiceRecordFilters(), demo: false })).toThrow();
    const purpose = snapshotSource(); purpose.records[0]!.signature_purpose = "不正確目的";
    expect(() => projectCaseServiceRecordSnapshot({ row: purpose,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: emptyCaseServiceRecordFilters(), demo: false })).toThrow();
    const content = snapshotSource(); content.records[0]!.history[1]!.service_result = "簽署時遭置換";
    content.records[0]!.service_result = "簽署時遭置換";
    expect(() => projectCaseServiceRecordSnapshot({ row: content,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: emptyCaseServiceRecordFilters(), demo: false })).toThrow();
  });

  it("keeps every unsupported boundary explicit in synthetic demo", () => {
    const demo = buildDemoCaseServiceRecordSnapshot(emptyCaseServiceRecordFilters());
    expect(demo).toMatchObject({ demo: true, schemaKind: "manual_service_narrative_v1",
      statutoryRuleStatus: "not_configured", attachmentStatus: "not_configured",
      exportStatus: "not_configured", notificationStatus: "not_configured",
      offlineStatus: "not_configured", claimEligibilityStatus: "not_configured" });
    expect(demo.records).toHaveLength(3);
    expect(demo.records.every((record) => record.clientDisplayName.startsWith("日照個案"))).toBe(true);
  });
});
