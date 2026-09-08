import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { clientServicePlanMutationArgs, parseClientServicePlanMutation,
  parseClientServicePlanReceipt } from "./parser";
import { projectClientServicePlanSnapshot,
  type ClientServicePlanSnapshotSourceRow } from "./projection";
import type { ClientServicePlanFilters, ClientServicePlanMutationInput } from "./types";

const ORG = "52d10000-0000-4000-8000-000000000001";
const BRANCH = "52d20000-0000-4000-8000-000000000001";
const ACTOR = "52d30000-0000-4000-8000-000000000001";
const MEMBERSHIP = "52d40000-0000-4000-8000-000000000001";
const CLIENT = "52d50000-0000-4000-8000-000000000001";
const PERIOD_CLIENT = "52d50000-0000-4000-8000-000000000002";
const SESSION = "52d60000-0000-4000-8000-000000000001";
const CHALLENGE = "52d70000-0000-4000-8000-000000000001";
const AUTHORIZATION = "52d80000-0000-4000-8000-000000000001";
const AUTHORIZATION_KEY = "52d81000-0000-4000-8000-000000000001";
const PLAN_KEY = "52d90000-0000-4000-8000-000000000001";
const GOAL = "52da0000-0000-4000-8000-000000000001";
const MEASURE = "52db0000-0000-4000-8000-000000000001";
const AUTH_HASH = "c".repeat(64);
const filters: ClientServicePlanFilters = { clientId: null, status: "all",
  asOf: "2026-09-08", query: null };

function draft(overrides: Record<string, unknown> = {}, key = "52dc0000-0000-4000-8000-000000000001") {
  return parseClientServicePlanMutation({ action: "create_draft", client_id: CLIENT,
    plan_key: PLAN_KEY, expected_terminal_id: null, expected_terminal_version: 0,
    expected_terminal_payload_hash: null, expected_authorized_care_plan_id: AUTHORIZATION,
    expected_authorized_content_hash: AUTH_HASH, effective_from: "2026-09-01",
    effective_to: "2027-12-31", review_due_on: "2026-10-31", responsible_user_id: ACTOR,
    goals: [{ goal_id: GOAL, item_order: 1, goal: "合成服務計畫目標",
      target_outcome: "合成人工檢討成果" }],
    planned_services: [{ measure_id: MEASURE, item_order: 1, goal_id: GOAL,
      measure: "合成結構化活動支持", frequency: "合成服務日執行", responsible_user_id: ACTOR }],
    reason: "建立合成服務計畫初稿", ...overrides }, key);
}

function transition(action: "approve" | "sign" | "void", previous: {
  planId: string; version: number; payloadHash: string; authorizedCarePlanId: string;
  authorizedContentHash: string;
}, key: string) {
  return parseClientServicePlanMutation({ action, client_id: CLIENT, plan_key: PLAN_KEY,
    expected_terminal_id: previous.planId, expected_terminal_version: previous.version,
    expected_terminal_payload_hash: previous.payloadHash,
    expected_authorized_care_plan_id: previous.authorizedCarePlanId,
    expected_authorized_content_hash: previous.authorizedContentHash,
    effective_from: null, effective_to: null, review_due_on: null,
    responsible_user_id: null, goals: null, planned_services: null,
    reason: action === "approve" ? "主管核准合成服務計畫" :
      action === "sign" ? "簽署核准合成服務計畫" : "安全作廢合成服務計畫" }, key);
}

describe("Page 52 PostgreSQL → TypeScript contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260907165036_client_service_plan_workflow_page52.sql").sort();
    expect(files.at(-1)).toBe("20260907165036_client_service_plan_workflow_page52.sql");
    for (const file of files) await database.exec(await readFile(resolve(directory, file), "utf8"));
    await database.query(`insert into auth.users(id,aud,role,email,created_at,updated_at)
      values($1,'authenticated','authenticated','contract52@example.invalid',now(),now())`, [ACTOR]);
    await database.query("insert into public.organizations(id,code,name) values($1,'contract52','合成服務計畫機構')", [ORG]);
    await database.query(`insert into public.branches(id,organization_id,code,name)
      values($1,$2,'main','合成服務計畫分支')`, [BRANCH, ORG]);
    await database.query("insert into public.profiles(id,display_name,kind) values($1,'合成服務計畫主管','staff')", [ACTOR]);
    await database.query(`insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
      values($1,$2,null,$3,'active',now()-interval '1 year')`, [MEMBERSHIP, ORG, ACTOR]);
    await database.query(`insert into public.membership_roles(membership_id,role_id)
      select $1,id from public.roles where role_key='organization_manager' and is_system`, [MEMBERSHIP]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,
      display_name,status,admitted_on) values($1,$2,$3,'SYN-CONTRACT-52',
      '合成服務計畫個案','active','2026-01-01')`, [CLIENT, ORG, BRANCH]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,
      display_name,status,admitted_on) values($1,$2,$3,'SYN-CONTRACT-52-PERIOD',
      '合成分期核定個案','active','2026-01-01')`, [PERIOD_CLIENT, ORG, BRANCH]);
    await database.query(`insert into private.reauth_challenges(id,user_id,session_id,
      nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,
      consumed_jwt_iat,factor_method,factor_verified_at) values($1,$2,$3,repeat('a',64),$1,
      now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',
      now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds')`,
    [CHALLENGE, ACTOR, SESSION]);
    await database.query(`insert into private.reauth_events(user_id,session_id,challenge_id,
      aal,verification_method,verified_at)
      select $1,$2,$3,'aal2','totp',factor_verified_at
      from private.reauth_challenges where id=$3`, [ACTOR, SESSION, CHALLENGE]);
    await database.query(`insert into public.authorized_care_plans(id,organization_id,branch_id,
      client_id,plan_key,version,status,effective_from,effective_to,source_system,source_record_id,
      source_provenance,authorized_on,authorization_reference,service_limits,plan_data,
      idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
      approval_reauth_challenge_id,signed_by,signed_at,signature_purpose,
      signature_reauth_challenge_id,content_hash) values($1,$2,$3,$4,$5,1,'signed',
      '2026-01-01','2027-12-31','central_html_import','SYN-CONTRACT-AUTH',
      '{"source":"synthetic"}','2025-12-31','SYN-CONTRACT-AUTH','{}','{}',$6,$7,$7,
      now(),repeat('b',64),$8,$7,now(),'合成核定簽署',$8,$9)`,
    [AUTHORIZATION, ORG, BRANCH, CLIENT, AUTHORIZATION_KEY,
      "52dd0000-0000-4000-8000-000000000001", ACTOR, CHALLENGE, AUTH_HASH]);
    await database.query(`insert into public.authorized_care_plans(id,organization_id,branch_id,
      client_id,plan_key,version,status,effective_from,effective_to,source_system,source_record_id,
      source_provenance,authorized_on,authorization_reference,service_limits,plan_data,
      idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
      approval_reauth_challenge_id,signed_by,signed_at,signature_purpose,
      signature_reauth_challenge_id,content_hash) values(
      '52de0000-0000-4000-8000-000000000001',$1,$2,$3,
      '52de1000-0000-4000-8000-000000000001',1,'signed','2026-01-01','2026-12-31',
      'central_html_import','SYN-CONTRACT-PERIOD-1','{"source":"synthetic"}',
      '2025-12-31','SYN-CONTRACT-PERIOD','{"period":1}','{"synthetic":1}',
      '52de2000-0000-4000-8000-000000000001',$4,$4,now(),repeat('3',64),$5,$4,now(),
      '合成分期核定簽署',$5,repeat('4',64))`, [ORG, BRANCH, PERIOD_CLIENT, ACTOR, CHALLENGE]);
    await database.query(`insert into public.authorized_care_plans(id,organization_id,branch_id,
      client_id,plan_key,version,previous_version_id,status,effective_from,effective_to,
      source_system,source_record_id,source_provenance,authorized_on,authorization_reference,
      service_limits,plan_data,correction_reason,idempotency_key,created_by,approved_by,
      approved_at,approval_evidence_hash,approval_reauth_challenge_id,signed_by,signed_at,
      signature_purpose,signature_reauth_challenge_id,content_hash)
      select '52de0000-0000-4000-8000-000000000002',organization_id,branch_id,client_id,
      plan_key,2,id,'signed','2026-10-01','2026-12-31',source_system,
      'SYN-CONTRACT-PERIOD-2',source_provenance,authorized_on,authorization_reference,
      '{"period":2}','{"synthetic":2}','第四季核定版本生效',
      '52de2000-0000-4000-8000-000000000002',created_by,approved_by,now(),repeat('5',64),
      approval_reauth_challenge_id,signed_by,now(),'合成第四季核定簽署',
      signature_reauth_challenge_id,repeat('6',64)
      from public.authorized_care_plans where id='52de0000-0000-4000-8000-000000000001'`);
    await database.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub: ACTOR, role: "authenticated", aal: "aal2", session_id: SESSION })]);
    await database.exec("set role authenticated");
  }, 60_000);
  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function mutate(input: ClientServicePlanMutationInput) {
    const args = clientServicePlanMutationArgs(input);
    let rows: { value: unknown }[];
    try {
      ({ rows } = await database.query<{ value: unknown }>(`select to_jsonb(result) as value
        from public.mutate_client_service_plan_workflow($1::uuid,$2::uuid,$3::text,$4::uuid,
        $5::uuid,$6::uuid,$7::integer,$8::text,$9::uuid,$10::text,$11::date,$12::date,
        $13::date,$14::uuid,$15::jsonb,$16::jsonb,$17::text,$18::uuid) result`,
      [ORG, BRANCH, args.p_action, args.p_client_id, args.p_plan_key,
        args.p_expected_terminal_id, args.p_expected_terminal_version,
        args.p_expected_terminal_payload_hash, args.p_expected_authorized_care_plan_id,
        args.p_expected_authorized_content_hash, args.p_effective_from, args.p_effective_to,
        args.p_review_due_on, args.p_responsible_user_id,
        args.p_goals === null ? null : JSON.stringify(args.p_goals),
        args.p_planned_services === null ? null : JSON.stringify(args.p_planned_services),
        args.p_reason, args.p_idempotency_key]));
    } catch (error) {
      throw new Error(`Page52 real SQL ${input.action} failed`, { cause: error });
    }
    expect(rows).toHaveLength(1);
    return parseClientServicePlanReceipt(rows[0]!.value, input, ORG, BRANCH);
  }

  async function snapshot(actualFilters = filters) {
    const { rows } = await database.query<{ value: ClientServicePlanSnapshotSourceRow }>(
      `select to_jsonb(result) as value from public.client_service_plan_workflow_snapshot(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::date,$6::text) result`,
      [ORG, BRANCH, actualFilters.clientId,
        actualFilters.status === "all" ? null : actualFilters.status,
        actualFilters.asOf, actualFilters.query]);
    expect(rows).toHaveLength(1);
    return projectClientServicePlanSnapshot({ row: rows[0]!.value,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters: actualFilters, demo: false });
  }

  it("projects the exact empty snapshot and server-controlled governance limits", async () => {
    const actual = await snapshot();
    expect(actual.plans).toEqual([]);
    expect(actual.clients.map((item) => item.clientId)).toEqual([PERIOD_CLIENT, CLIENT]);
    expect(actual.claimEligibilityStatus).toBe("blocked_not_configured");
    expect(Date.parse(actual.staleAfter) - Date.parse(actual.generatedAt)).toBe(60_000);
    expect(actual.authorizations.find((item) => item.clientId === PERIOD_CLIENT))
      .toMatchObject({ authorizedCarePlanId: "52de0000-0000-4000-8000-000000000001", version: 1 });
    const november = await snapshot({ ...filters, asOf: "2026-11-08" });
    expect(november.authorizations.find((item) => item.clientId === PERIOD_CLIENT))
      .toMatchObject({ authorizedCarePlanId: "52de0000-0000-4000-8000-000000000002", version: 2 });
  });

  it("accepts real immutable create, approval, signature and exact replay receipts", async () => {
    const input = draft();
    const created = await mutate(input);
    expect(created.replayed).toBe(false);
    expect(await mutate(input)).toEqual({ ...created, replayed: true });
    const approved = await mutate(transition("approve", created,
      "52dc0000-0000-4000-8000-000000000002"));
    const signed = await mutate(transition("sign", approved,
      "52dc0000-0000-4000-8000-000000000003"));
    expect([created.status, approved.status, signed.status]).toEqual(["draft", "approved", "signed"]);
    expect(signed.persistedPayload.goals).toEqual(created.persistedPayload.goals);
    expect(signed.persistedPayload.sourceProvenance.claimEligibilityStatus)
      .toBe("blocked_not_configured");
  });

  it("keeps a date-applicable signed publication visible behind newer draft and future versions", async () => {
    const created = await mutate(draft());
    const approved = await mutate(transition("approve", created,
      "52dc0000-0000-4000-8000-000000000002"));
    const signed = await mutate(transition("sign", approved,
      "52dc0000-0000-4000-8000-000000000003"));
    const revised = await mutate(draft({ action: "revise_draft",
      expected_terminal_id: signed.planId, expected_terminal_version: signed.version,
      expected_terminal_payload_hash: signed.payloadHash, effective_from: "2027-01-01",
      effective_to: "2027-12-31", review_due_on: "2027-03-31",
      reason: "建立未來期間修訂草稿" },
    "52dc0000-0000-4000-8000-000000000004"));
    let actual = await snapshot({ ...filters, query: PLAN_KEY });
    expect(actual.plans[0]).toMatchObject({ version: 4, status: "draft",
      publishedPlanId: signed.planId, publishedVersion: 3,
      publishedStatus: "signed", streamOperationalStatus: "signed_current" });
    expect(actual.metrics.executableTotal).toBe(1);
    const futureApproved = await mutate(transition("approve", revised,
      "52dc0000-0000-4000-8000-000000000005"));
    const futureSigned = await mutate(transition("sign", futureApproved,
      "52dc0000-0000-4000-8000-000000000006"));
    actual = await snapshot({ ...filters, query: PLAN_KEY });
    expect(actual.plans[0]).toMatchObject({ version: 6, status: "signed",
      publishedPlanId: signed.planId, publishedVersion: 3,
      publishedStatus: "signed", streamOperationalStatus: "signed_current" });
    expect(actual.plans[0]!.publishedPlanId).not.toBe(futureSigned.planId);
    expect(actual.plans[0]!.history.map((item) => item.version)).toEqual([2, 3, 4, 5, 6]);
  });
});
