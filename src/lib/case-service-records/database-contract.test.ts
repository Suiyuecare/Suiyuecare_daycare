import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import {
  caseServiceRecordPayload,
  parseCaseServiceRecordMutation,
  parseCaseServiceRecordReceipt,
} from "./parser";
import {
  projectCaseServiceRecordSnapshot,
  type CaseServiceRecordSnapshotSourceRow,
} from "./projection";
import { emptyCaseServiceRecordFilters } from "./query";
import type {
  CaseServiceRecordFilters,
  CaseServiceRecordMutationInput,
  CaseServiceRecordReceiptPayload,
} from "./types";

const ORG = "50200000-0000-4000-8000-000000000001";
const BRANCH = "50200000-0000-4000-8000-000000000002";
const ACTOR = "50200000-0000-4000-8000-000000000003";
const CLIENT = "50200000-0000-4000-8000-000000000004";
const OTHER_CLIENT = "50200000-0000-4000-8000-000000000009";
const MEMBERSHIP = "50200000-0000-4000-8000-000000000005";
const SESSION = "50200000-0000-4000-8000-000000000006";
const EXECUTION = "50200000-0000-4000-8000-000000000007";
const EXECUTION_KEY = "50200000-0000-4000-8000-000000000008";
const CREATE_KEY = "50200000-0000-4000-8000-000000000010";
const OTHER_KEY = "50200000-0000-4000-8000-000000000011";
const SIGN_KEY = "50200000-0000-4000-8000-000000000012";
const CORRECT_KEY = "50200000-0000-4000-8000-000000000013";
const CHALLENGE = "50200000-0000-4000-8000-000000000014";
const CHALLENGE_KEY = "50200000-0000-4000-8000-000000000015";
const STARTED_AT = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
const ENDED_AT = new Date(Date.now() - 60 * 60_000).toISOString();

function createBody(clientId = CLIENT, executionReferenceId: string | null = null) {
  return {
    action: "save_record",
    mode: "create",
    record_key: null,
    previous_version_id: null,
    expected_version: 0,
    expected_content_hash: null,
    client_id: clientId,
    started_at: STARTED_AT,
    ended_at: ENDED_AT,
    service_type: "生活支持",
    service_content: "真實 SQL 合成人工服務敘事。",
    service_result: "真實 SQL 合成人工結果。",
    execution_reference_id: executionReferenceId,
    revision_reason: "建立真實 SQL 合成草稿",
  };
}

function wirePayload(payload: CaseServiceRecordReceiptPayload) {
  return {
    client_id: payload.clientId,
    started_at: payload.startedAt,
    ended_at: payload.endedAt,
    service_type: payload.serviceType,
    service_content: payload.serviceContent,
    service_result: payload.serviceResult,
    execution_reference_id: payload.executionReferenceId,
    execution_reference_status: payload.executionReferenceStatus,
    execution_reference_content_hash: payload.executionReferenceContentHash,
    author_user_id: payload.authorUserId,
    source_kind: payload.sourceKind,
    schema_kind: payload.schemaKind,
    statutory_rule_status: payload.statutoryRuleStatus,
    claim_eligibility_status: payload.claimEligibilityStatus,
  };
}

describe("Page 50 PostgreSQL to TypeScript contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260908007000_case_service_records_page50.sql").sort();
    expect(files.at(-1)).toBe("20260908007000_case_service_records_page50.sql");
    for (const file of files) await database.exec(await readFile(resolve(directory, file), "utf8"));
    await database.query(`insert into auth.users(id,aud,role,email,created_at,updated_at)
      values ($1,'authenticated','authenticated','contract50@example.invalid',now(),now())`, [ACTOR]);
    await database.query("insert into public.organizations(id,code,name) values ($1,'contract50','合成服務紀錄機構')", [ORG]);
    await database.query("insert into public.branches(id,organization_id,code,name) values ($1,$2,'main','合成主分支')", [BRANCH, ORG]);
    await database.query("insert into public.profiles(id,display_name,kind) values ($1,'合成專業人員','professional')", [ACTOR]);
    await database.query(`insert into public.memberships(id,organization_id,branch_id,profile_id,status)
      values ($1,$2,$3,$4,'active')`, [MEMBERSHIP, ORG, BRANCH, ACTOR]);
    await database.query(`insert into public.membership_roles(membership_id,role_id)
      select $1,id from public.roles where role_key='professional' and is_system`, [MEMBERSHIP]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
      values ($1,$2,$3,'SYN-P50-1','合成個案甲','active','2025-01-01'),
      ($4,$2,$3,'SYN-P50-2','ASCII Client','active','2025-01-01')`,
    [CLIENT, ORG, BRANCH, OTHER_CLIENT]);
    await database.query(`insert into public.client_assignments(organization_id,branch_id,client_id,
      assignee_user_id,assignment_kind) values ($1,$2,$3,$5,'service-record'),
      ($1,$2,$4,$5,'service-record')`, [ORG, BRANCH, CLIENT, OTHER_CLIENT, ACTOR]);
    await database.exec("alter table public.service_events disable trigger service_events_validate_client_service_plan");
    await database.query(`insert into public.service_events(id,organization_id,branch_id,client_id,
      service_code,status,started_at,ended_at,staff_user_id,evidence,idempotency_key,content_hash)
      values ($1,$2,$3,$4,'SYN-P50-NOT-OFFICIAL','completed','2026-09-08T09:00:00+08:00',
      '2026-09-08T09:30:00+08:00',$5,'{"synthetic":true}',$6,repeat('8',64))`,
    [EXECUTION, ORG, BRANCH, CLIENT, ACTOR, EXECUTION_KEY]);
    await database.exec("alter table public.service_events enable trigger service_events_validate_client_service_plan");
    await database.query("select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: ACTOR, role: "authenticated", aal: "aal2", session_id: SESSION })]);
    await database.exec("set role authenticated");
  }, 60_000);

  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function mutate(input: CaseServiceRecordMutationInput) {
    const { rows } = await database.query<{ value: unknown }>(
      `select to_jsonb(result) as value from public.mutate_case_service_record(
        $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid) result`,
      [ORG, BRANCH, input.action, JSON.stringify(caseServiceRecordPayload(input)), input.idempotencyKey],
    );
    expect(rows).toHaveLength(1);
    return parseCaseServiceRecordReceipt(rows[0]!.value, input, ORG, BRANCH, ACTOR);
  }

  async function snapshot(filters: CaseServiceRecordFilters = emptyCaseServiceRecordFilters()) {
    const { rows } = await database.query<{ value: CaseServiceRecordSnapshotSourceRow }>(
      `select to_jsonb(result) as value from public.case_service_record_snapshot(
        $1::uuid,$2::uuid,$3::date,$4::date,$5::uuid,$6::text,$7::uuid,$8::text) result`,
      [ORG, BRANCH, filters.dateFrom, filters.dateTo, filters.clientId, filters.serviceType,
        filters.authorUserId, filters.recordState === "all" ? null : filters.recordState],
    );
    expect(rows).toHaveLength(1);
    return projectCaseServiceRecordSnapshot({ row: rows[0]!.value,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
  }

  async function addReauth() {
    await database.exec("reset role");
    await database.query(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,
      idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,
      factor_method,factor_verified_at) values ($1,$2,$3,repeat('3',64),$4,now()-interval '1 minute',
      now()-interval '1 minute',now()+interval '5 minutes',now()-interval '20 seconds',
      now()-interval '20 seconds','totp',now()-interval '20 seconds')`,
    [CHALLENGE, ACTOR, SESSION, CHALLENGE_KEY]);
    await database.query(`insert into private.reauth_events(user_id,session_id,challenge_id,aal,
      verification_method,verified_at) select $1,$2,$3,'aal2','totp',factor_verified_at
      from private.reauth_challenges where id=$3`, [ACTOR, SESSION, CHALLENGE]);
    await database.exec("set role authenticated");
  }

  it("projects the exact empty SQL snapshot and accessible client options", async () => {
    const actual = await snapshot();
    expect(actual.matchingTotal).toBe(0);
    expect(actual.clients).toEqual(expect.arrayContaining([
      { clientId: CLIENT, displayName: "合成個案甲" },
      { clientId: OTHER_CLIENT, displayName: "ASCII Client" },
    ]));
    expect(actual).toMatchObject({ schemaKind: "manual_service_narrative_v1",
      statutoryRuleStatus: "not_configured", attachmentStatus: "not_configured",
      exportStatus: "not_configured", notificationStatus: "not_configured",
      offlineStatus: "not_configured", claimEligibilityStatus: "not_configured" });
  });

  it("accepts a real SQL create and exact replay receipt", async () => {
    const input = parseCaseServiceRecordMutation(createBody(), CREATE_KEY);
    const created = await mutate(input);
    expect(created).toMatchObject({ organizationId: ORG, branchId: BRANCH, clientId: CLIENT,
      actorUserId: ACTOR, idempotencyKey: CREATE_KEY, version: 1,
      previousVersionId: null, sourceContentHash: null, replayed: false,
      recordPayload: { serviceContent: "真實 SQL 合成人工服務敘事。",
        statutoryRuleStatus: "not_configured", claimEligibilityStatus: "not_configured" } });
    expect(await mutate(input)).toEqual({ ...created, replayed: true });
    const actual = await snapshot();
    expect(actual.records[0]).toMatchObject({ recordKey: created.recordKey,
      serviceContent: "真實 SQL 合成人工服務敘事。", recordState: "draft" });
  });

  it("uses stable client identifiers for equal service times regardless of name collation", async () => {
    await mutate(parseCaseServiceRecordMutation(createBody(CLIENT), CREATE_KEY));
    await mutate(parseCaseServiceRecordMutation(createBody(OTHER_CLIENT), OTHER_KEY));
    const actual = await snapshot();
    expect(actual.records.map((record) => [record.clientId, record.clientDisplayName]))
      .toEqual([[CLIENT, "合成個案甲"], [OTHER_CLIENT, "ASCII Client"]]);
    expect(actual.records.every((record) => record.startedAt === STARTED_AT))
      .toBe(true);
  });

  it("round-trips completed execution evidence through sign and correction", async () => {
    const created = await mutate(parseCaseServiceRecordMutation(createBody(CLIENT, EXECUTION), CREATE_KEY));
    expect(created.recordPayload).toMatchObject({ executionReferenceId: EXECUTION,
      executionReferenceStatus: "linked_completed_event",
      executionReferenceContentHash: "8".repeat(64) });
    await addReauth();
    const sign = parseCaseServiceRecordMutation({ action: "sign_record", client_id: CLIENT,
      record_key: created.recordKey, previous_version_id: created.versionId,
      expected_version: created.version, expected_content_hash: created.contentHash,
      expected_record_payload: wirePayload(created.recordPayload) }, SIGN_KEY);
    const signed = await mutate(sign);
    expect(signed).toMatchObject({ recordState: "signed", previousVersionId: created.versionId,
      sourceContentHash: created.contentHash, recordPayload: created.recordPayload });
    const correction = parseCaseServiceRecordMutation({ action: "correct_record", client_id: CLIENT,
      record_key: signed.recordKey, previous_version_id: signed.versionId,
      expected_version: signed.version, expected_content_hash: signed.contentHash,
      expected_author_user_id: signed.recordPayload.authorUserId,
      started_at: STARTED_AT, ended_at: ENDED_AT,
      service_type: "生活支持", service_content: "真實 SQL 合成人工服務敘事。",
      service_result: "依紙本核對後修正人工結果。", execution_reference_id: EXECUTION,
      reason: "依紙本原始紀錄修正人工服務結果" }, CORRECT_KEY);
    const corrected = await mutate(correction);
    expect(corrected).toMatchObject({ recordState: "corrected", previousVersionId: signed.versionId,
      sourceContentHash: signed.contentHash,
      recordPayload: { serviceResult: "依紙本核對後修正人工結果。",
        executionReferenceContentHash: "8".repeat(64) } });
    const actual = await snapshot();
    expect(actual.records[0]?.history.map((row) => row.recordState))
      .toEqual(["draft", "signed", "corrected"]);
    expect(actual.records[0]?.history[1]).toMatchObject({ signerDisplayName: "合成專業人員",
      signerRoleKeys: ["professional"], signaturePurpose: "個案服務紀錄簽署",
      signatureReauthChallengeId: CHALLENGE });
    expect(actual.records[0]?.history[2]).toMatchObject({
      signaturePurpose: "個案服務紀錄更正簽署", signatureReauthChallengeId: CHALLENGE });
    expect(actual.metrics).toMatchObject({ correctedTotal: 1, linkedExecutionTotal: 1,
      changedExecutionTotal: 0 });
    await database.exec("reset role");
    await database.query("update public.service_events set status='voided' where id=$1", [EXECUTION]);
    await database.exec("set role authenticated");
    const changed = await snapshot();
    expect(changed.records[0]?.executionReferenceVerification).toBe("changed_or_unavailable");
    expect(changed.metrics.changedExecutionTotal).toBe(1);
  });
});
