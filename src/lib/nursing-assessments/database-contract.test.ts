import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite/pgtap";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { parseNursingReceipt, projectNursingAssessmentSnapshot } from "./parser";
import type { NursingRequest, NursingReceipt } from "./types";

const org = "51100000-0000-4000-8000-000000000001";
const branch = "51200000-0000-4000-8000-000000000001";
const actor = "51000000-0000-4000-8000-000000001001";
const session = "51600000-0000-4000-8000-000000000001";
const otherActor = "51000000-0000-4000-8000-000000001002";
const client = "51400000-0000-4000-8000-000000000001";
const key = "51700000-0000-4000-8000-000000000010";
describe("nursing real PostgreSQL JSON to TypeScript contracts", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgtap } }); await db.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260908024027_nursing_assessments_page51.sql").sort();
    expect(files.at(-1)).toBe("20260908024027_nursing_assessments_page51.sql");
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    await db.exec(await readFile(resolve("supabase/seed.sql"), "utf8"));
    await db.exec("create extension pgtap;");
    // Reuse only this domain's synthetic lifecycle fixture. Preserve the test
    // transaction until it has been explicitly validated and committed locally.
    const sql = await readFile(resolve("supabase/tests/nursing_assessments_page51.test.sql"), "utf8");
    const results = await db.exec(sql.replace(/rollback;\s*$/u, "commit;"));
    const output = results.flatMap((result) => result.rows.flatMap((row) => Object.values(row))).filter((value) => typeof value === "string");
    expect(output.filter((value) => /^not ok \d+/u.test(value))).toEqual([]);
  }, 60_000);
  beforeEach(async () => {
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, aal: "aal2", role: "authenticated", session_id: session })]);
    await db.exec("set local role authenticated");
  });
  afterEach(async () => { await db.exec("rollback"); });
  afterAll(async () => { await db?.close(); });
  async function mutate(request: NursingRequest, idempotencyKey = key, actorUserId = actor) {
    const { rows } = await db.query<{ value: unknown }>("select public.mutate_nursing_assessment($1,$2,$3::jsonb,$4) as value",
      [org, branch, JSON.stringify(request), idempotencyKey]);
    return parseNursingReceipt(rows[0]!.value, { request, idempotencyKey, organizationId: org, branchId: branch, actorUserId });
  }
  async function createInput() {
    const { rows } = await db.query<{ v: NursingRequest }>("select v from nursing_test_data where k='create'");
    return rows[0]!.v;
  }
  it("projects actual snapshot with exact version content, signatures and hash links", async () => {
    const { rows } = await db.query<{ value: unknown }>("select public.nursing_assessment_snapshot($1,$2) as value", [org, branch]);
    const actual = projectNursingAssessmentSnapshot(rows[0]!.value, org, branch);
    expect(actual.clients).toHaveLength(1); expect(actual.clients[0]!.versions).toHaveLength(3);
    expect(actual.clients[0]!.versions.map((version) => version.state)).toEqual(["corrected", "signed", "draft"]);
    expect(actual.clients[0]!.versions[0]!.content.formVersionReference).toBe("manual-nursing-v1");
  });
  it("round-trips real create and revise receipts without losing manual content", async () => {
    const request = await createInput(); const draft = await mutate(request);
    const content = structuredClone(draft.result.content);
    content.reassessment = { state: "recorded", dueOn: "2026-12-01", reason: "護理人員依本次觀察人工排定" };
    const revise: NursingRequest = { action: "revise_draft", clientId: client, assessmentKey: draft.result.assessmentKey,
      previousVersionId: draft.result.versionId, expectedVersion: 1, expectedContentHash: draft.result.contentHash, content };
    const actual = await mutate(revise, "51700000-0000-4000-8000-000000000011");
    expect(actual.result.state).toBe("draft"); expect(actual.result.content).toEqual(content);
    expect(actual.result.previousContentHash).toBe(draft.result.contentHash);
  });
  it("checks real existing sign and correction receipt shape against frozen request", async () => {
    const { rows } = await db.query<{ v: NursingReceipt }>("select v from nursing_test_data where k in ('signed','corrected')");
    for (const { v } of rows) expect(parseNursingReceipt(v, { request: v.request, idempotencyKey: v.idempotencyKey,
      organizationId: org, branchId: branch, actorUserId: actor }).result.signatureChallengeId).not.toBeNull();
  });
  it("same idempotency UUID is independently scoped to each authorized actor", async () => {
    const request = await createInput(); const first = await mutate(request);
    await db.exec("reset role");
    await db.query(`insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
      values($1,$2,$3,$4,'nursing')`, [org, branch, client, otherActor]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: otherActor, aal: "aal2", role: "authenticated", session_id: session })]);
    await db.exec("set local role authenticated");
    const second = await mutate(request, key, otherActor);
    expect(second.replayed).toBe(false); expect(second.operationId).not.toBe(first.operationId);
  });
  it("revoked permission denies exact replay and snapshot even with AAL2 and assignment", async () => {
    const request = await createInput(); await mutate(request);
    await db.exec("reset role");
    await db.exec(`delete from public.role_permissions where role_id in(select id from public.roles where role_key='nurse' and is_system)
      and permission_id in(select id from public.permissions where permission_key='nursing_assessments.read')`);
    await db.exec("set local role authenticated");
    await expect(mutate(request)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select public.nursing_assessment_snapshot($1,$2)", [org, branch])).rejects.toBeDefined();
  });
  it("expired or revoked same-session evidence blocks signature replay", async () => {
    const { rows } = await db.query<{ v: NursingRequest }>("select v from nursing_test_data where k='sign'");
    await db.exec("reset role");
    await db.exec("update private.reauth_events set revoked_at=clock_timestamp() where challenge_id='51610000-0000-4000-8000-000000000001'");
    await db.exec("set local role authenticated");
    await expect(mutate(rows[0]!.v, "51700000-0000-4000-8000-000000000002")).rejects.toMatchObject({ code: "42501" });
  });
  it("rechecks membership expiry against wall clock after the transaction begins", async () => {
    await db.exec("reset role");
    await db.exec(`update public.memberships set ends_at=now()+interval '1 millisecond'
      where id='51300000-0000-4000-8000-000000000001'`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fixture = await db.query<{ elapsed: boolean }>(`select ends_at>now() and ends_at<clock_timestamp() as elapsed
      from public.memberships where id='51300000-0000-4000-8000-000000000001'`);
    expect(fixture.rows[0]!.elapsed).toBe(true);
    await db.exec("set local role authenticated");
    await expect(db.query("select public.nursing_assessment_snapshot($1,$2)", [org, branch])).rejects.toMatchObject({ code: "42501" });
  });
  it("removes an assignment expiring after transaction start from the current read", async () => {
    await db.exec("reset role");
    await db.exec(`update public.client_assignments set ends_at=now()+interval '1 millisecond'
      where id='51500000-0000-4000-8000-000000000001'`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fixture = await db.query<{ elapsed: boolean }>(`select ends_at>now() and ends_at<clock_timestamp() as elapsed
      from public.client_assignments where id='51500000-0000-4000-8000-000000000001'`);
    expect(fixture.rows[0]!.elapsed).toBe(true);
    await db.exec("set local role authenticated");
    const { rows } = await db.query<{ value: unknown }>("select public.nursing_assessment_snapshot($1,$2) as value", [org, branch]);
    const actual = projectNursingAssessmentSnapshot(rows[0]!.value, org, branch);
    expect(actual.clients).toEqual([]); expect(actual.clientTotal).toBe(0);
  });
});
