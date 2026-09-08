import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { abcdAssessmentPayload, parseAbcdAssessmentMutation, parseAbcdAssessmentReceipt } from "./parser";
import { projectAbcdAssessmentSnapshot, type AbcdAssessmentSnapshotSourceRow } from "./projection";
import { emptyAbcdAssessmentFilters } from "./query";
import type { AbcdAssessmentFilters, AbcdAssessmentMutationInput } from "./types";

const ORG = "21200000-0000-4000-8000-000000000001";
const BRANCH = "21200000-0000-4000-8000-000000000002";
const ACTOR = "21200000-0000-4000-8000-000000000003";
const CLIENT = "21200000-0000-4000-8000-000000000004";
const OTHER_CLIENT = "21200000-0000-4000-8000-000000000009";
const MEMBERSHIP = "21200000-0000-4000-8000-000000000005";
const SESSION = "21200000-0000-4000-8000-000000000006";
const KEY_A = "21200000-0000-4000-8000-000000000010";
const KEY_B = "21200000-0000-4000-8000-000000000011";
const KEY_PRIOR = "21200000-0000-4000-8000-000000000012";
const KEY_SIGN = "21200000-0000-4000-8000-000000000013";
const CHALLENGE = "21200000-0000-4000-8000-000000000014";
const CHALLENGE_KEY = "21200000-0000-4000-8000-000000000015";
const KEY_CORRECT = "21200000-0000-4000-8000-000000000016";
const KEY_OTHER_CLIENT = "21200000-0000-4000-8000-000000000017";

function createBody(type: "A" | "B" | "C" | "D" = "A", year = 2026, clientId = CLIENT) {
  return { action: "save_assessment", mode: "create", assessment_key: null,
    previous_version_id: null, expected_version: 0, expected_content_hash: null,
    client_id: clientId, assessment_type: type, assessment_year: year,
    assessment_date: `${year}-09-01`, manual_summary: `合成 ${year} 年 ${type} 類人工候選摘要`,
    result: { state: "recorded", text: "合成人工候選結果", reason: null },
    reassessment: { state: "recorded", date: `${year}-12-01`, basis: "人工指定複評依據" },
    revision_reason: "建立人工候選初稿" };
}

describe("Page 21 PostgreSQL to TypeScript contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite(); await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260908002000_abcd_assessments_page21.sql").sort();
    expect(files.at(-1)).toBe("20260908002000_abcd_assessments_page21.sql");
    for (const file of files) await database.exec(await readFile(resolve(directory, file), "utf8"));
    await database.query(`insert into auth.users(id,aud,role,email,created_at,updated_at)
      values ($1,'authenticated','authenticated','contract21@example.invalid',now(),now())`, [ACTOR]);
    await database.query("insert into public.organizations(id,code,name) values ($1,'contract21','合成 ABCD 測試機構')", [ORG]);
    await database.query("insert into public.branches(id,organization_id,code,name) values ($1,$2,'main','合成主分支')", [BRANCH, ORG]);
    await database.query("insert into public.profiles(id,display_name,kind) values ($1,'合成專業人員','professional')", [ACTOR]);
    await database.query(`insert into public.memberships(id,organization_id,branch_id,profile_id,status)
      values ($1,$2,$3,$4,'active')`, [MEMBERSHIP, ORG, BRANCH, ACTOR]);
    await database.query(`insert into public.membership_roles(membership_id,role_id)
      select $1,id from public.roles where role_key='professional' and is_system`, [MEMBERSHIP]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
      values ($1,$2,$3,'SYN-ABCD-1','合成個案甲','active','2025-01-01'),
      ($4,$2,$3,'SYN-ABCD-2','ASCII Client','active','2025-01-01')`, [CLIENT, ORG, BRANCH, OTHER_CLIENT]);
    await database.query(`insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
      values ($1,$2,$3,$5,'assessment'),($1,$2,$4,$5,'assessment')`,
    [ORG, BRANCH, CLIENT, OTHER_CLIENT, ACTOR]);
    await database.query("select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: ACTOR, role: "authenticated", aal: "aal2", session_id: SESSION })]);
    await database.exec("set role authenticated");
  }, 60_000);
  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function mutate(input: AbcdAssessmentMutationInput) {
    const { rows } = await database.query<{ value: unknown }>(
      `select to_jsonb(result) as value from public.mutate_abcd_assessment(
        $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid) result`,
      [ORG, BRANCH, input.action, JSON.stringify(abcdAssessmentPayload(input)), input.idempotencyKey]);
    expect(rows).toHaveLength(1);
    return parseAbcdAssessmentReceipt(rows[0]!.value, input, ORG, BRANCH);
  }

  async function snapshot(filters: AbcdAssessmentFilters = emptyAbcdAssessmentFilters()) {
    const { rows } = await database.query<{ value: AbcdAssessmentSnapshotSourceRow }>(
      `select to_jsonb(result) as value from public.abcd_assessment_snapshot(
        $1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text,$7::text,$8::text) result`,
      [ORG, BRANCH, filters.clientId, filters.assessmentYear,
        filters.assessmentType === "all" ? null : filters.assessmentType,
        filters.reassessmentState === "all" ? null : filters.reassessmentState,
        filters.status === "all" ? null : filters.status, filters.query]);
    expect(rows).toHaveLength(1);
    return projectAbcdAssessmentSnapshot({ row: rows[0]!.value,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
  }

  it("projects the exact empty SQL snapshot and authorized client options", async () => {
    const actual = await snapshot();
    expect(actual.matchingTotal).toBe(0);
    expect(actual.clients).toHaveLength(2);
    expect(actual.clients).toEqual(expect.arrayContaining([
      { clientId: CLIENT, displayName: "合成個案甲" },
      { clientId: OTHER_CLIENT, displayName: "ASCII Client" },
    ]));
    expect(actual).toMatchObject({ formKind: "manual_unstandardized",
      formalRuleStatus: "not_configured", attachmentStatus: "not_configured",
      notificationStatus: "not_configured", exportStatus: "not_configured",
      offlineStatus: "not_configured" });
  });

  it("accepts real create and exact replay receipts then projects the SQL row", async () => {
    const input = parseAbcdAssessmentMutation(createBody(), KEY_A);
    const created = await mutate(input); expect(created.replayed).toBe(false);
    expect(created).toMatchObject({ organizationId: ORG, branchId: BRANCH, clientId: CLIENT,
      idempotencyKey: KEY_A, previousVersionId: null, sourceContentHash: null,
      recordPayload: { clientId: CLIENT, assessmentType: "A", assessmentYear: 2026,
        manualSummary: "合成 2026 年 A 類人工候選摘要",
        formKind: "manual_unstandardized", formalRuleStatus: "not_configured" } });
    expect(await mutate(input)).toEqual({ ...created, replayed: true });
    const actual = await snapshot();
    expect(actual.matchingTotal).toBe(1);
    expect(actual.assessments[0]).toMatchObject({ assessmentKey: created.assessmentKey,
      assessmentType: "A", assessmentYear: 2026, manualSummary: "合成 2026 年 A 類人工候選摘要",
      result: { state: "recorded", text: "合成人工候選結果", reason: null },
      reassessment: { state: "recorded", date: "2026-12-01", basis: "人工指定複評依據" } });
  });

  it("keeps A/B and year variants in independent SQL chains with strict filters", async () => {
    await mutate(parseAbcdAssessmentMutation(createBody("A", 2026), KEY_A));
    await mutate(parseAbcdAssessmentMutation(createBody("B", 2026), KEY_B));
    await mutate(parseAbcdAssessmentMutation(createBody("A", 2025), KEY_PRIOR));
    const actual = await snapshot();
    expect(actual.assessments.map((item) => `${item.assessmentYear}-${item.assessmentType}`))
      .toEqual(["2026-A", "2026-B", "2025-A"]);
    expect(new Set(actual.assessments.map((item) => item.assessmentKey)).size).toBe(3);
    const filtered = await snapshot({ ...emptyAbcdAssessmentFilters(), assessmentYear: 2026,
      assessmentType: "B", status: "draft", query: "合成個案甲" });
    expect(filtered.assessments).toHaveLength(1);
    expect(filtered.assessments[0]).toMatchObject({ assessmentType: "B", assessmentYear: 2026 });
  });

  it("uses stable client identifiers for same-date Chinese and ASCII client rows", async () => {
    await mutate(parseAbcdAssessmentMutation(createBody("A", 2026, CLIENT), KEY_A));
    await mutate(parseAbcdAssessmentMutation(createBody("A", 2026, OTHER_CLIENT), KEY_OTHER_CLIENT));
    const actual = await snapshot();
    expect(actual.assessments.map((item) => [item.clientId, item.clientDisplayName]))
      .toEqual([[CLIENT, "合成個案甲"], [OTHER_CLIENT, "ASCII Client"]]);
    expect(actual.assessments.every((item) => item.assessmentDate === "2026-09-01")).toBe(true);
  });

  it("projects real signed evidence and an unchanged manual payload", async () => {
    const created = await mutate(parseAbcdAssessmentMutation(createBody(), KEY_A));
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
    const signInput = parseAbcdAssessmentMutation({ action: "sign_assessment", client_id: CLIENT,
      assessment_key: created.assessmentKey, assessment_type: "A", assessment_year: 2026,
      previous_version_id: created.versionId, expected_version: created.version,
      expected_content_hash: created.contentHash }, KEY_SIGN);
    const signed = await mutate(signInput); expect(signed.assessmentState).toBe("signed");
    expect(signed).toMatchObject({ previousVersionId: created.versionId,
      sourceContentHash: created.contentHash, recordPayload: created.recordPayload });
    const correctionInput = parseAbcdAssessmentMutation({ action: "correct_assessment",
      client_id: CLIENT, assessment_key: created.assessmentKey, assessment_type: "A",
      assessment_year: 2026, previous_version_id: signed.versionId,
      expected_version: signed.version, expected_content_hash: signed.contentHash,
      assessment_date: "2026-09-01", manual_summary: "合成 2026 年 A 類人工更正候選摘要",
      result: { state: "recorded", text: "合成人工更正候選結果", reason: null },
      reassessment: { state: "recorded", date: "2026-12-15", basis: "人工更正複評依據" },
      reason: "修正人工摘要與人工複評依據" }, KEY_CORRECT);
    const corrected = await mutate(correctionInput);
    expect(corrected).toMatchObject({ assessmentState: "corrected",
      previousVersionId: signed.versionId, sourceContentHash: signed.contentHash,
      recordPayload: { manualSummary: "合成 2026 年 A 類人工更正候選摘要",
        result: { state: "recorded", text: "合成人工更正候選結果", reason: null },
        reassessment: { state: "recorded", date: "2026-12-15", basis: "人工更正複評依據" } } });
    const actual = await snapshot();
    expect(actual.assessments[0]?.history.map((item) => item.assessmentState)).toEqual(["draft", "signed", "corrected"]);
    expect(actual.assessments[0]?.history[1]).toMatchObject({ manualSummary: "合成 2026 年 A 類人工候選摘要",
      signerDisplayName: "合成專業人員", signerRoleKeys: ["professional"],
      signaturePurpose: "ABCD 人工候選評估簽署", signatureReauthChallengeId: CHALLENGE });
    expect(actual.assessments[0]?.history[2]).toMatchObject({ manualSummary: "合成 2026 年 A 類人工更正候選摘要",
      signaturePurpose: "ABCD 人工候選評估更正簽署", signatureReauthChallengeId: CHALLENGE });
  });
});
