import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { JUBO_OPERATOR_AUTHORIZATION, prepareJuboOperatorPending } from "./operator-pending";
import { APPROVED_JUBO_SOURCE_SHA256 } from "./xlsx-reader";
import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { readdirSync } from "node:fs";
import { QUESTIONNAIRE_FORMS } from "../questionnaire-assessments/forms";

const sourceDir = process.env.JUBO_APPROVED_SOURCE_DIR;
const sourceTest = sourceDir ? it : it.skip;
const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function sourceInput() {
  return {
    organizationId: "fbc10000-0000-4000-8000-000000000001", branchId: "fbc20000-0000-4000-8000-000000000001",
    idempotencyKey: "fbc30000-0000-4000-8000-000000000001", authorizationReference: JUBO_OPERATOR_AUTHORIZATION,
    hmacSecret: "synthetic-source-mapping-secret-longer-than-32-bytes",
    master: { kind: "master" as const, fileName: "jubo-all-status-client-master-20261003.xlsx", mimeType,
      bytes: Uint8Array.from(readFileSync(path.join(sourceDir!, "jubo-all-status-client-master-20261003.xlsx"))) },
    monthly: { kind: "monthlySummary" as const, fileName: "jubo-daycare-summary-20261003.xlsx", mimeType,
      bytes: Uint8Array.from(readFileSync(path.join(sourceDir!, "jubo-daycare-summary-20261003.xlsx"))) },
  };
}
it("rejects email-only/user impersonation or a different authorization purpose before parsing", () => {
  const invalid = { organizationId: "not-uuid", branchId: "not-uuid", idempotencyKey: "not-uuid",
    authorizationReference: JUBO_OPERATOR_AUTHORIZATION, hmacSecret: "not-used",
    master: { kind: "master" as const, fileName: "synthetic.xlsx", mimeType, bytes: new Uint8Array() },
    monthly: { kind: "monthlySummary" as const, fileName: "synthetic.xlsx", mimeType, bytes: new Uint8Array() } };
  expect(() => prepareJuboOperatorPending(invalid)).toThrow("JUBO_OPERATOR_INVALID_INPUT");
});
sourceTest("binds complete mapping and all original bytes without inventing a logged-in user", async () => {
  const prepared = prepareJuboOperatorPending(sourceInput());
  expect(prepared.parameters).toHaveLength(7);
  expect(createHash("sha256").update(prepared.parameters[4]).digest("hex")).toBe(APPROVED_JUBO_SOURCE_SHA256.master);
  expect(createHash("sha256").update(prepared.parameters[5]).digest("hex")).toBe(APPROVED_JUBO_SOURCE_SHA256.monthlySummary);
  expect(prepared.counts).toEqual({ master: 23, monthly: 17, newAttendance: 0, admitted: 0 });
  const db = new PGlite();
  try {
    const digest = await db.query<{ hash: string }>("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') as hash", [prepared.parameters[6]]);
    // Only a one-way dataset hash is surfaced for the pinned database mapping.
    if (process.env.JUBO_OPERATOR_PRINT_DIGEST === "true") process.stdout.write(`JUBO_OPERATOR_DATASET_SHA256 ${digest.rows[0].hash}\n`);
    expect(digest.rows[0].hash).toBe("21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da");
  } finally { await db.close(); }
}, 120_000);

sourceTest("atomically imports exactly 23 pending basic profiles, reconciles 17 and never manufactures Auth or clinical evidence", async () => {
  const prepared = prepareJuboOperatorPending(sourceInput());
  const db = new PGlite();
  try {
    await db.exec(bootstrapSql);
    const migrationDir = path.resolve(import.meta.dirname, "../../../supabase/migrations");
    for (const file of readdirSync(migrationDir).filter(file => file.endsWith(".sql")).sort()) {
      try { await db.exec(readFileSync(path.join(migrationDir, file), "utf8")); }
      catch { throw new Error(`OPERATOR_TEST_MIGRATION_FAILED ${file}`); }
    }
    await db.exec(`insert into public.organizations(id,code,name) values ('fbc10000-0000-4000-8000-000000000001','operator-test','合成移轉測試機構');
      insert into public.branches(id,organization_id,code,name) values ('fbc20000-0000-4000-8000-000000000001','fbc10000-0000-4000-8000-000000000001','test','合成分支');`);
    const invoke = async (parameters: readonly unknown[]) => {
      try { return await db.query<{ receipt: Record<string, unknown> }>(prepared.sql, [...parameters]); }
      catch (error) { throw new Error(`OPERATOR_TEST_DB_CODE ${(error as { code?: string }).code ?? "unknown"}`); }
    };
    const result = await invoke(prepared.parameters);
    expect(result.rows[0].receipt).toMatchObject({ masterRows: 23, monthlyReferences: 17, publicPendingClients: 23,
      formalAdmissions: 0, attendanceRecords: 0, serviceRecords: 0, clinicalApprovals: 0,
      executionMode: "database_operator", authorizationReference: JUBO_OPERATOR_AUTHORIZATION, replayed: false });
    const readback = await db.query<{ passed: boolean }>(`select
      (select count(*) from public.clients where status='pending' and admitted_on is null and ended_on is null)=23
      and (select count(*) from private.jubo_operator_master_links)=23
      and (select count(*) from private.jubo_operator_master_links where monthly_source_sheet_row is not null)=17
      and not exists(select 1 from auth.users) and not exists(select 1 from private.reauth_events)
      and not exists(select 1 from private.questionnaire_rule_publications)
      and not exists(select 1 from public.questionnaire_assessment_versions) as passed`);
    expect(readback.rows[0].passed).toBe(true);
    expect((await invoke(prepared.parameters)).rows[0].receipt.replayed).toBe(true);
    const tampered = [...prepared.parameters];
    const dataset = JSON.parse(String(tampered[6]));
    dataset.master.rows[0].rawValues[2] = "synthetic-tampered-value";
    tampered[6] = JSON.stringify(dataset);
    await expect(invoke(tampered)).rejects.toThrow("OPERATOR_TEST_DB_CODE 22023");
    const freshKey = [...prepared.parameters]; freshKey[2] = "fbc30000-0000-4000-8000-000000000002";
    await expect(invoke(freshKey)).rejects.toThrow("OPERATOR_TEST_DB_CODE 23505");
    // A borrowed setting cannot create another person or activate a pending one.
    await db.exec(`select set_config('app.jubo_operator_import_id', '${result.rows[0].receipt.operationId}', false)`);
    try {
      await db.exec(`insert into public.clients(organization_id,branch_id,client_code,display_name,status,source_system)
        values('fbc10000-0000-4000-8000-000000000001','fbc20000-0000-4000-8000-000000000001','UNBOUND','synthetic','pending','jubo')`);
      throw new Error("OPERATOR_TEST_UNBOUND_INSERT_SUCCEEDED");
    } catch (error) { expect((error as { code?: string }).code).toBe("42501"); }
    try {
      await db.exec("update public.clients set status='active', admitted_on=current_date where client_code='JUBO-20261003-006'");
      throw new Error("OPERATOR_TEST_UNREVIEWED_ADMISSION_SUCCEEDED");
    } catch (error) { expect((error as { code?: string }).code).toBe("42501"); }
    await db.exec("set role authenticated");
    await expect(invoke(prepared.parameters)).rejects.toThrow("OPERATOR_TEST_DB_CODE 42501");
    await db.exec("reset role");
    const finalCount = await db.query<{ count: number }>("select count(*)::integer as count from public.clients");
    expect(finalCount.rows[0].count).toBe(23);

    // Only the local acceptance database receives synthetic native Google
    // fixtures. The operator import itself created no identity or approval.
    await db.exec(`insert into public.branches(id,organization_id,code,name) values
      ('fbc20000-0000-4000-8000-000000000002','fbc10000-0000-4000-8000-000000000001','other','合成別分支');
      insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
      select ('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
       'pending-q'||n||'@example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,5)n;
      insert into auth.identities(id,provider_id,user_id,identity_data,provider)
      select ('fbd20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pending-google-'||n,
       ('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       jsonb_build_object('sub','pending-google-'||n,'email','pending-q'||n||'@example.invalid','email_verified',true),'google' from generate_series(1,5)n;
      insert into auth.sessions(id,user_id,created_at,aal)
      select ('fbd30000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal1' from generate_series(1,5)n;
      insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
      select ('fbd40000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('fbd30000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '2 minutes',now()-interval '2 minutes','oauth' from generate_series(1,5)n;
      insert into public.profiles(id,display_name,kind)
      select ('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'合成評估測試人員'||n,'staff' from generate_series(1,5)n;
      insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
      select ('fbd50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fbc10000-0000-4000-8000-000000000001',
       case when n=4 then 'fbc20000-0000-4000-8000-000000000002'::uuid else 'fbc20000-0000-4000-8000-000000000001'::uuid end,
       ('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,5)n;
      insert into public.membership_roles(membership_id,role_id)
      select ('fbd50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,r.id from generate_series(1,5)n join public.roles r
       on r.role_key=case when n in(1,4) then 'branch_director' when n=2 then 'care_worker' when n=5 then 'organization_manager' else 'nurse' end and r.is_system;
      insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
      select ('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fbc10000-0000-4000-8000-000000000001',
       'example.invalid','pending-q'||n||'@example.invalid','pending-google-'||n,true,'synthetic pending draft admission' from generate_series(1,5)n;
      -- Test-only preexisting assignments prove that assignment alone still
      -- cannot expand care-worker/nurse authority into pending assessment.
      alter table public.client_assignments disable trigger jubo_pending_client_no_activity;
      insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
      select organization_id,branch_id,id,('fbd10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'primary',now()-interval '1 day'
       from public.clients cross join generate_series(1,3)n;
      alter table public.client_assignments enable trigger jubo_pending_client_no_activity;
      alter table public.clients disable trigger aa_jubo_pending_client_insert_guard;
      insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,source_system)
       values('fbd60000-0000-4000-8000-000000000001','fbc10000-0000-4000-8000-000000000001','fbc20000-0000-4000-8000-000000000001','UNBOUND-PENDING','合成未綁來源','pending','manual');
      alter table public.clients enable trigger aa_jubo_pending_client_insert_guard;`);
    const selected = (await db.query<{ id: string }>("select client_id as id from private.jubo_operator_master_links order by source_sheet_row limit 1")).rows[0].id;
    const today = (await db.query<{ assessed_on: string }>("select to_char(clock_timestamp() at time zone 'Asia/Taipei','YYYY-MM-DD') as assessed_on")).rows[0].assessed_on;
    const login = async (n: number) => {
      await db.exec("reset role");
      const oauth = (await db.query<{ stamp: number }>("select floor(extract(epoch from updated_at))::integer stamp from auth.mfa_amr_claims where session_id=$1", [`fbd30000-0000-4000-8000-${String(n).padStart(12, "0")}`])).rows[0].stamp;
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: `fbd10000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        session_id: `fbd30000-0000-4000-8000-${String(n).padStart(12, "0")}`, role: "authenticated", aud: "authenticated", aal: "aal1", is_anonymous: false,
        email: `pending-q${n}@example.invalid`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 1800, amr: [{ method: "oauth", timestamp: oauth }] })]);
      await db.exec("set role authenticated");
    };
    const scopedCall = async (sql: string, parameters: unknown[]) => {
      try { return await db.query<{ snapshot: Record<string, unknown> }>(sql, parameters); }
      catch (error) { throw new Error(`OPERATOR_PENDING_DRAFT_DB_CODE ${(error as { code?: string }).code ?? "unknown"}`); }
    };
    const scope = [prepared.parameters[0], prepared.parameters[1]];
    const workspace = "select public.questionnaire_assessment_workspace_snapshot($1,$2,'spmsq',$3) snapshot";
    const originalDigest = (await db.query<{ profile_digest: string; source_digest: string }>(
      "select encode(sha256(convert_to(profile::text,'UTF8')),'hex') profile_digest,source_row_sha256 source_digest from private.jubo_operator_master_links where client_id=$1", [selected])).rows[0];
    // A real authorized manager may append missing contact data through the
    // scoped routine RPC. Original source values remain immutable provenance.
    await login(5);
    const sourceSnapshot = (await scopedCall("select public.client_intake_snapshot($1,$2,$3) snapshot", [...scope, selected])).rows[0].snapshot;
    expect(sourceSnapshot.profileVersion).toBe(0);
    expect(sourceSnapshot.protectedFieldKeys).toEqual(expect.arrayContaining(["clientCode", "displayName", "identityNumber"]));
    expect(sourceSnapshot.protectedFieldKeys).not.toContain("phone");
    const supplement = { ...(sourceSnapshot.profile as object), phone: "0900000000", notes: "合成待收案聯絡補填" };
    const profileWrite = "select public.update_intake_profile($1,$2,$3,$4,$5,$6,$7::jsonb) snapshot";
    const supplementArgs = [...scope, "fbd80000-0000-4000-8000-000000000001", selected, 0, 1, JSON.stringify(supplement)];
    expect((await scopedCall(profileWrite, supplementArgs)).rows[0].snapshot).toMatchObject({ profileVersion: 1, clientRowVersion: 2, pending: true, replayed: false });
    expect((await scopedCall(profileWrite, supplementArgs)).rows[0].snapshot.replayed).toBe(true);
    expect((await scopedCall("select public.authorized_pending_questionnaire_client_ids($1,$2,array[$3::uuid]) snapshot", [...scope, selected])).rows[0].snapshot).toEqual([selected]);
    await expect(scopedCall(profileWrite, [...scope, "fbd80000-0000-4000-8000-000000000002", selected, 1, 2, JSON.stringify({ ...supplement, identityNumber: "SYNTH0002" })]))
      .rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
    await db.exec("reset role");
    const sourceIntegrity = await db.query<{ unchanged: boolean }>(`select
      encode(sha256(convert_to(link.profile::text,'UTF8')),'hex')=$2 and link.source_row_sha256=$3
      and link.profile->>'phone' is distinct from '0900000000'
      and c.status='pending' and c.admitted_on is null and c.ended_on is null
      and (select count(*) from private.client_intake_versions where client_id=c.id)=1 as unchanged
      from private.jubo_operator_master_links link join public.clients c on c.id=link.client_id where c.id=$1`, [selected, originalDigest.profile_digest, originalDigest.source_digest]);
    expect(sourceIntegrity.rows[0].unchanged).toBe(true);
    await login(1);
    expect((await db.query<{ allowed: boolean }>("select public.is_staff_login_allowed() as allowed")).rows[0].allowed).toBe(true);
    await db.exec("reset role");
    const gate = await db.query<{ authorized: boolean; source_bound: boolean }>("select private.questionnaire_assessment_authority($1,$2,$3,'spmsq','read') as authorized, private.jubo_pending_questionnaire_scope($1,$2,$3) as source_bound", [...scope, selected]);
    expect(gate.rows[0]).toEqual({ authorized: true, source_bound: true });
    await db.exec("set role authenticated");
    const roster = (await scopedCall(workspace, [...scope, selected])).rows[0].snapshot;
    expect(roster.canSign).toBe(false);
    expect(roster.matchingTotal).toBe(23);
    const answers = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`spmsq_${String(i + 1).padStart(2, "0")}`, { state: "answered", value: "correct" }]));
    const create = { action: "create", client_id: selected, form_key: "spmsq", form_version: "spmsq-pfeiffer-10-education-adjusted-v1",
      assessed_on: today, answers, context: { education_adjustment: "grade_school_or_less" } };
    const write = (body: object, n: number) => scopedCall("select public.mutate_questionnaire_assessment($1,$2,$3::jsonb,$4) snapshot", [...scope, JSON.stringify(body), `fbd70000-0000-4000-8000-${String(n).padStart(12, "0")}`]);
    const draft = (await write(create, 1)).rows[0].snapshot;
    expect(draft.recordState).toBe("draft");
    expect((await write(create, 1)).rows[0].snapshot.replayed).toBe(true);
    const baseline = { client_id: selected, form_key: "spmsq", assessment_key: draft.assessmentKey, previous_version_id: draft.versionId, expected_version: draft.version };
    const revised = (await write({ ...create, ...baseline, action: "revise" }, 2)).rows[0].snapshot;
    expect(revised.version).toBe(2);
    for (const action of ["submit", "sign", "return", "correct"]) {
      await expect(write({ ...baseline, previous_version_id: revised.versionId, expected_version: revised.version, action, reason: "合成驗收" }, 10))
        .rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
    }
    const pendingDrafts = Object.values(QUESTIONNAIRE_FORMS).map(form => ({ ...create, form_key: form.key, form_version: form.version,
      answers: Object.fromEntries(form.questions.map(question => [question.id, { state: "missing" }])), context: {} }));
    for (const [index, body] of pendingDrafts.entries()) {
      const formWorkspace = (await scopedCall("select public.questionnaire_assessment_workspace_snapshot($1,$2,$3,$4) snapshot", [...scope, body.form_key, selected])).rows[0].snapshot;
      expect(formWorkspace.canSign).toBe(false);
      expect((await write(body, 100 + index)).rows[0].snapshot.recordState).toBe("draft");
    }
    const matrix = (await scopedCall("select public.assessment_matrix_snapshot($1,$2,date_trunc('month',$3::date)::date) snapshot", [...scope, today])).rows[0].snapshot;
    expect(matrix.totalClients).toBe(23);
    const selectedMatrix = (matrix.clients as { clientId: string; serviceStatus: string; cells: Record<string, { state: string }> }[]).find(row => row.clientId === selected)!;
    expect(selectedMatrix.serviceStatus).toBe("pending");
    expect(Object.keys(selectedMatrix.cells)).toHaveLength(10);
    expect(selectedMatrix.cells.mna_sf.state).toBe("draft");
    expect(selectedMatrix.cells.full_mna.state).toBe("draft");
    expect(Object.values(selectedMatrix.cells).every(cell => cell.state === "draft")).toBe(true);
    await expect(scopedCall(workspace, [...scope, "fbd60000-0000-4000-8000-000000000001"])).rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
    await expect(write({ ...create, client_id: "fbd60000-0000-4000-8000-000000000001" }, 11)).rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
    for (const n of [2, 3, 4]) {
      await login(n);
      await expect(scopedCall(workspace, [...scope, selected])).rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
      await expect(write(create, 20 + n)).rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
      await expect(write(pendingDrafts.find(body => body.form_key === "barthel_adl")!, 30 + n)).rejects.toThrow("OPERATOR_PENDING_DRAFT_DB_CODE 42501");
    }
    await db.exec("reset role");
    const formal = await db.query<{ safe: boolean }>("select not exists(select 1 from public.clients where admitted_on is not null) and not exists(select 1 from public.questionnaire_assessment_versions where record_state<>'draft') and not exists(select 1 from private.questionnaire_rule_publications) as safe");
    expect(formal.rows[0].safe).toBe(true);
  } finally { await db.close(); }
}, 180_000);
