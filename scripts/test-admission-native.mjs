// Dedicated real PostgreSQL admission/roster race checks. This script creates a
// disposable Unix-socket-only cluster and never accepts a database URL.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute PostgreSQL bin directory.");
const runtime = await mkdtemp("/tmp/daycare-admission-native.");
const data = join(runtime, "data");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55440", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const run = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = (input) => run(join(binaries, "psql"), args, input);
const concurrent = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
const holders = new Set();
const holdDatabaseLock = async (statement) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = ""; let resolveReady; let rejectReady;
  const ready = new Promise((resolveResult, rejectResult) => { resolveReady = resolveResult; rejectReady = rejectResult; });
  const completion = new Promise((resolveResult) => {
    child.stdout.on("data", (value) => { stdout += value; const match = stdout.match(/^NATIVE_LOCK_READY=(\d+)$/m); if (match) resolveReady(Number(match[1])); });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", (error) => { rejectReady(error); resolveResult({ status: -1 }); });
    child.on("close", (status) => { rejectReady(new Error("Native row holder closed before readiness.")); resolveResult({ status }); });
  });
  const timer = setTimeout(() => rejectReady(new Error("Native row lock readiness timed out.")), 10_000);
  child.stdin.write(`begin;set local application_name='native_admission_holder';${statement};select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
  let released = false;
  const holder = { release: async (ending = "commit;") => {
    if (released) return;
    released = true; child.stdin.end(`${ending}\n`);
    const result = await completion; holders.delete(holder);
    if (result.status !== 0) throw new Error(`Native row holder failed: ${stderr}`);
  } };
  holders.add(holder);
  try { await ready; } finally { clearTimeout(timer); }
  return holder;
};
const holdRow = async (clientId = "c2600000-0000-4000-8000-000000000001") => {
  if (!/^c2600000-0000-4000-8000-00000000000[12]$/.test(clientId)
    && clientId !== "c0800000-0000-4000-8000-000000000001") throw new Error("Invalid synthetic client lock target.");
  return holdDatabaseLock(`select 1 from public.clients where id='${clientId}' for update`);
};
const waitForBlocked = async (names) => {
  if (names.some((name) => !/^native_admission_[a-z0-9_]+$/.test(name))) throw new Error("Invalid synthetic lock probe name.");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const count = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names.map((name) => `'${name}'`).join(",")}) and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (count === names.length) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Competing admission sessions were not observed blocked in PostgreSQL.");
};
let started = false;
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p 55440 -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const suites = [
    "admission_day_roster_eligibility.test.sql",
    "client_lifecycle_active_scope.test.sql",
    "approved_staff_routine_care_access.test.sql",
    "custom_form_version_lifecycle.test.sql",
    "native_staff_nursing_social_drafts.test.sql",
    "family_portal_read_hardening.test.sql",
    "family_message_offline_schedule.test.sql",
    "jubo_admission_preparation.test.sql",
    "jubo_admission_lock_reauthorization.test.sql",
    "quality_monthly_evaluation_evidence.test.sql",
  ];
  let assertionTotal = 0;
  for (const suiteName of suites) {
    const suite = await readFile(join(root, "supabase/tests", suiteName), "utf8");
    if (/create\s+(?:or\s+replace\s+)?function\s+(?:private|public)\.(?:is_active_user|is_staff_login_allowed|is_family_login_allowed|is_executive_login_allowed|has_permission|has_recent_aal2|routine_staff_scope|family_tenant_context)\s*\(/i.test(suite)) {
      throw new Error(`Native ${suiteName} must not replace a production authorization predicate.`);
    }
    const expected = Number(suite.match(/select\s+plan\((\d+)\)/i)?.[1]);
    let output;
    try { output = sql(suite); }
    catch (error) { throw new Error(`Native ${suiteName}: ${error.message}`, { cause: error }); }
    const passed = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
    if (!expected || passed !== expected || /^not ok |^# Looks like/m.test(output)) throw new Error(`Native ${suiteName} failed: ${passed}/${expected}. ${output.split("\n").filter((line) => /^not ok |^#/.test(line)).join(" ")}`);
    assertionTotal += passed;
    console.log(`Native ${suiteName}: ${passed}/${expected}.`);
  }
  console.log(`Native admission regression assertions: ${assertionTotal}/${assertionTotal}; no production predicate replacements.`);

  // Two independently stored native OAuth sessions of one approved ordinary
  // employee exercise draft serialization and post-lock revocation. The claims
  // are fixture metadata, not signed GoTrue tokens or production proof.
  const staffSource = await readFile(join(root, "supabase/tests/approved_staff_routine_care_access.test.sql"), "utf8");
  const staffFixtureStart = staffSource.indexOf("select set_config('test.routine_amr'");
  const staffFixtureEnd = staffSource.indexOf("create function pg_temp.staff_claims");
  if (staffFixtureStart < 0 || staffFixtureEnd <= staffFixtureStart) throw new Error("Strict ordinary employee fixture unavailable.");
  const staffSetup = sql(`begin;${staffSource.slice(staffFixtureStart, staffFixtureEnd)}
    insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
      values('c0100000-0000-4000-8000-000000000001','c0500000-0000-4000-8000-000000000001','care.example.invalid','worker@care.example.invalid','synthetic-routine-worker',true,'Synthetic native race authorization');
    insert into auth.sessions(id,user_id,created_at,aal) values('c0300000-0000-4000-8000-000000000011','c0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
    insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
      values(gen_random_uuid(),'c0300000-0000-4000-8000-000000000011',to_timestamp(current_setting('test.routine_amr')::bigint),to_timestamp(current_setting('test.routine_amr')::bigint),'oauth');
    select 'NATIVE_STAFF_JWT='||jsonb_build_object('sub','c0100000-0000-4000-8000-000000000001','session_id','c0300000-0000-4000-8000-000000000001',
      'aud','authenticated','role','authenticated','aal','aal1','email','worker@care.example.invalid','is_anonymous',false,
      'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
      'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.routine_amr')::bigint)))::text;
    select 'NATIVE_STAFF_OCCURRED='||current_setting('test.routine_now');commit;`);
  const staffJwt = staffSetup.split("\n").find((line) => line.startsWith("NATIVE_STAFF_JWT="))?.slice("NATIVE_STAFF_JWT=".length);
  const occurred = staffSetup.split("\n").find((line) => line.startsWith("NATIVE_STAFF_OCCURRED="))?.slice("NATIVE_STAFF_OCCURRED=".length);
  if (!staffJwt || !occurred) throw new Error("Native ordinary employee fixture metadata unavailable.");
  const secondStaffJwt = JSON.stringify({ ...JSON.parse(staffJwt), session_id: "c0300000-0000-4000-8000-000000000011" });
  const staffClaims = (value) => `select set_config('request.jwt.claims','${value.replaceAll("'", "''")}',true);set local role authenticated;`;
  for (const value of [staffJwt, secondStaffJwt]) {
    const gate = sql(`begin;${staffClaims(value)}select public.is_staff_login_allowed() and not public.is_executive_login_allowed() and not public.has_recent_aal2(15);rollback;`).trim().split("\n").at(-1);
    if (gate !== "t") throw new Error("Native OAuth employee does not satisfy exact ordinary AAL1 admission without executive authority.");
  }
  const ordinaryDraft = (key, name, value = staffJwt) => `begin;set local application_name='${name}';${staffClaims(value)}
    select 'NATIVE_STAFF_RECEIPT='||row_to_json(receipt)::text from public.record_care_diary_quick_draft(
      'c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',
      '${occurred.replaceAll("'", "''")}'::timestamptz,'{"shift":"morning","care_item":"Synthetic native care","note":"Synthetic observed draft","abnormal":false}'::jsonb,'${key}') receipt;commit;`;
  const ordinaryCounts = () => sql(`select jsonb_build_array(
    (select count(*) from public.care_records where organization_id='c0500000-0000-4000-8000-000000000001' and category='staff/daily-care/care-diary'),
    (select count(*) from public.audit_events where organization_id='c0500000-0000-4000-8000-000000000001' and table_name='care_records'))::text;`).trim();
  const staffDuplicateHolder = await holdRow("c0800000-0000-4000-8000-000000000001");
  const staffNames = ["native_admission_staff_duplicate_a", "native_admission_staff_duplicate_b"];
  const staffDuplicateWork = staffNames.map((name, index) => concurrent(ordinaryDraft("cb100000-0000-4000-8000-000000000001", name, index === 0 ? staffJwt : secondStaffJwt)));
  await waitForBlocked(staffNames); await staffDuplicateHolder.release();
  const staffDuplicateResults = await Promise.all(staffDuplicateWork);
  const staffReceipts = staffDuplicateResults.map((result) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("NATIVE_STAFF_RECEIPT="))?.slice("NATIVE_STAFF_RECEIPT=".length) ?? "null"));
  if (staffDuplicateResults.some((result) => result.status !== 0) || staffReceipts.some((value) => !value)
    || staffReceipts[0].id !== staffReceipts[1].id || staffReceipts.filter((value) => value.replayed).length !== 1) {
    throw new Error("Native independent employee sessions did not resolve duplicate drafts to one shared receipt.");
  }
  const staffBaseline = ordinaryCounts();
  if (JSON.parse(staffBaseline)[0] !== 1) throw new Error("Ordinary draft race created duplicate records.");
  console.log("Native two live OAuth employee sessions: AAL1 only, non-executive; observed duplicate draft lock -> one record/shared receipt.");
  const revocations = [
    { key: "2", name: "session", disable: "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='c0300000-0000-4000-8000-000000000001';", restore: "update auth.sessions set not_after=null where id='c0300000-0000-4000-8000-000000000001';" },
    { key: "3", name: "approval", disable: "update private.staff_google_access_grants set enabled=false where allowed_user_id='c0100000-0000-4000-8000-000000000001';", restore: "update private.staff_google_access_grants set enabled=true where allowed_user_id='c0100000-0000-4000-8000-000000000001';" },
    { key: "4", name: "membership", disable: "update public.memberships set status='suspended' where id='c0700000-0000-4000-8000-000000000001';", restore: "update public.memberships set status='active' where id='c0700000-0000-4000-8000-000000000001';" },
    { key: "5", name: "assignment", disable: "update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where assignee_user_id='c0100000-0000-4000-8000-000000000001' and client_id='c0800000-0000-4000-8000-000000000001';", restore: "update public.client_assignments set ends_at=null where assignee_user_id='c0100000-0000-4000-8000-000000000001' and client_id='c0800000-0000-4000-8000-000000000001';" },
  ];
  for (const probe of revocations) {
    const holder = await holdRow("c0800000-0000-4000-8000-000000000001");
    const name = `native_admission_staff_${probe.name}_waiter`;
    const work = concurrent(ordinaryDraft(`cb100000-0000-4000-8000-00000000000${probe.key}`, name));
    await waitForBlocked([name]); await holder.release(`${probe.disable}commit;`);
    const denied = await work;
    if (denied.status === 0 || !denied.stderr.includes("42501") || ordinaryCounts() !== staffBaseline) throw new Error(`Native waiting ordinary draft did not reject revoked ${probe.name} with no extra record/audit.`);
    sql(probe.restore);
    console.log(`Native ordinary employee client-lock race: ${probe.name} revoked while waiting -> 42501; zero extra records/audits.`);
  }

  // Family writes and receipt replays must not retain stale consent after
  // waiting on either advisory lock. The two consent revocations below target
  // distinct recipients: consent revocation is irreversible, never "restored"
  // or implemented by disabling a protection trigger.
  const familySource = await readFile(join(root, "supabase/tests/family_message_offline_schedule.test.sql"), "utf8");
  const familyStart = familySource.indexOf("insert into auth.users");
  const familyEnd = familySource.indexOf("select ok(not has_table_privilege");
  if (familyStart < 0 || familyEnd <= familyStart) throw new Error("Evidence-bound native family fixture unavailable.");
  sql(`begin;${familySource.slice(familyStart, familyEnd)}commit;`);
  const familyActor = (number) => `e9000000-0000-4000-8000-00000000000${number}`;
  const familyOrg = "e9100000-0000-4000-8000-000000000001";
  const familyBranch = "e9200000-0000-4000-8000-000000000001";
  const familyClient = "e9300000-0000-4000-8000-000000000001";
  const familyPayload = (actor, replay) => JSON.stringify({ clientId: familyClient,
    body: replay ? "Synthetic original family message" : "Synthetic waiting family message",
    expectedVersion: replay ? 0 : 1,
    idempotency_key: `ec970000-0000-4000-8000-${replay ? "00000000000" : "00000000010"}${actor}` });
  const familyWrite = (actor, replay, name) => `begin;set local application_name='${name}';
    select set_config('request.jwt.claims','${JSON.stringify({ sub: familyActor(actor), role: "authenticated", aal: "aal1", is_anonymous: false }).replaceAll("'", "''")}',true);
    set local role authenticated;select 'NATIVE_FAMILY_RECEIPT='||receipt::text from public.family_message_write(
      '${familyOrg}','${familyBranch}','${familyPayload(actor, replay).replaceAll("'", "''")}'::jsonb);commit;`;
  for (const actor of [2, 3]) {
    const result = sql(familyWrite(actor, true, `native_admission_family_original_${actor}`));
    const receipt = JSON.parse(result.split("\n").find((line) => line.startsWith("NATIVE_FAMILY_RECEIPT="))?.slice("NATIVE_FAMILY_RECEIPT=".length) ?? "null");
    if (!receipt || receipt.replayed || receipt.status !== "saved") throw new Error("Initial exact-consent native family message was not saved.");
  }
  const familyCounts = () => sql(`select jsonb_build_array(
    (select count(*) from private.family_messages where organization_id='${familyOrg}'),
    (select count(*) from private.family_message_conflicts where organization_id='${familyOrg}'),
    (select count(*) from public.audit_events where organization_id='${familyOrg}' and table_name in ('family_messages','family_message_conflicts')))::text;`).trim();
  const familyBaseline = familyCounts();
  if (JSON.parse(familyBaseline)[0] !== 2 || JSON.parse(familyBaseline)[1] !== 0) throw new Error("Unexpected native family message baseline.");
  for (const boundary of ["branch", "organization", "consent"]) {
    for (const replay of [false, true]) {
      const actor = boundary === "consent" && replay ? 3 : 2;
      const key = JSON.parse(familyPayload(actor, replay)).idempotency_key;
      const lock = replay ? `family-message:${familyActor(actor)}:${key}`
        : `family-thread:${familyOrg}:${familyBranch}:${familyClient}:${familyActor(actor)}`;
      const holder = await holdDatabaseLock(`select pg_advisory_xact_lock(hashtextextended('${lock}',0))`);
      const name = `native_admission_family_${boundary}_${replay ? "replay" : "write"}_waiter`;
      const work = concurrent(familyWrite(actor, replay, name));
      await waitForBlocked([name]);
      const disable = boundary === "consent"
        ? `update public.consents set revoked_at=clock_timestamp() where id='e9600000-0000-4000-8000-00000000000${actor === 2 ? 1 : 5}';`
        : `update public.${boundary === "branch" ? "branches" : "organizations"} set is_active=false where id='${boundary === "branch" ? familyBranch : familyOrg}';`;
      await holder.release(`${disable}commit;`);
      const result = await work;
      if (result.status === 0 || !result.stderr.includes("42501") || familyCounts() !== familyBaseline
        || result.stdout.includes("NATIVE_FAMILY_RECEIPT=")) {
        throw new Error(`Native waiting family ${replay ? "receipt replay" : "thread write"} did not deny revoked ${boundary} without messages/conflicts/audits.`);
      }
      if (boundary !== "consent") sql(`update public.${boundary === "branch" ? "branches" : "organizations"} set is_active=true where id='${boundary === "branch" ? familyBranch : familyOrg}';`);
      console.log(`Native family ${replay ? "receipt replay" : "thread write"} advisory-lock race: ${boundary} revoked while waiting -> 42501; zero new messages/conflicts/audits, no stale receipt.`);
    }
  }

  // Exact Google identities, live OAuth/MFA sessions and independently approved
  // reviewers exercise every operations advisory lock. These are synthetic
  // native-database fixtures, not GoTrue HTTP tokens or production acceptance.
  const operationsSource = await readFile(join(root, "supabase/tests/quality_monthly_evaluation_evidence.test.sql"), "utf8");
  const operationsStart = operationsSource.indexOf("select set_config('test.amr'");
  const operationsEnd = operationsSource.indexOf("select ok((select bool_and");
  if (operationsStart < 0 || operationsEnd <= operationsStart) throw new Error("Strict operations fixture unavailable.");
  const operationsSetup = sql(`begin;${operationsSource.slice(operationsStart, operationsEnd)}
    select 'NATIVE_OPS_JWT1='||pg_temp.jwt(1);select 'NATIVE_OPS_JWT2='||pg_temp.jwt(2);commit;`);
  const operationsJwts = [1, 2].map((actor) => operationsSetup.split("\n").find((line) => line.startsWith(`NATIVE_OPS_JWT${actor}=`))?.slice(`NATIVE_OPS_JWT${actor}=`.length));
  if (operationsJwts.some((value) => !value)) throw new Error("Native operations session metadata unavailable.");
  const operationsOrg = "e1300000-0000-4000-8000-000000000001";
  const operationsBranch = "e1400000-0000-4000-8000-000000000001";
  const operationsActor = (actor) => `e1100000-0000-4000-8000-00000000000${actor}`;
  const operationsKey = (number) => `ee930000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const operationsReadReceipt = (output) => JSON.parse(output.split("\n").find((line) => line.startsWith("NATIVE_OPS_RECEIPT="))?.slice("NATIVE_OPS_RECEIPT=".length) ?? "null");
  const operationsCall = (actor, call, name = "native_admission_ops_setup") => `begin;set local application_name='${name}';${staffClaims(operationsJwts[actor - 1])}
    select 'NATIVE_OPS_RECEIPT='||(${call})::text;commit;`;
  const preparationRequest = JSON.stringify({ itemCode: "INTERNAL_01", expectedVersion: 0, ownerUserId: operationsActor(1), dueOn: "2026-10-30",
    evidenceReference: "e1920000-0000-4000-8000-000000000001", progress: "internal_review_requested", changeReason: "initial" });
  const preparation = operationsReadReceipt(sql(operationsCall(1, `public.evaluation_preparation_mutate('${operationsOrg}','${operationsBranch}','${preparationRequest}'::jsonb,'${operationsKey(10)}')`)));
  const preparationVersion = preparation?.result?.versionId;
  if (!/^[a-f0-9-]{36}$/.test(preparationVersion ?? "")) throw new Error("Native evaluation preparation did not return a version.");
  // Privileged fixture inserts only: a signed successor inherits the clean
  // attachment via the real immutable clinical-link trigger. No live record,
  // signing workflow or qualification is bypassed in an application session.
  sql(`insert into public.care_records(id,organization_id,branch_id,client_id,record_key,version,previous_version_id,category,status,occurred_at,data,signed_at,signed_by,signature_purpose,content_hash,created_by)
    values('e1900000-0000-4000-8000-000000000002','${operationsOrg}','${operationsBranch}','e1600000-0000-4000-8000-000000000001','e1910000-0000-4000-8000-000000000001',2,'e1900000-0000-4000-8000-000000000001','staff/daily-care/care-diary','signed',now(),'{}',now(),'${operationsActor(1)}','Synthetic native signed evidence',repeat('e',64),'${operationsActor(1)}');`);
  const monthly = operationsReadReceipt(sql(operationsCall(1, `public.quality_monthly_snapshot('${operationsOrg}','${operationsBranch}','2026-10',null)`)));
  const operationsFreeze = (key) => `public.quality_monthly_freeze('${operationsOrg}','${operationsBranch}','2026-10','${monthly?.hash}','${key}')`;
  const operationsReview = (key) => `public.evaluation_evidence_review('${operationsOrg}','${operationsBranch}','${preparationVersion}','approved','review_complete','${key}')`;
  const frozen = operationsReadReceipt(sql(operationsCall(1, operationsFreeze(operationsKey(1)))));
  const reviewed = operationsReadReceipt(sql(operationsCall(2, operationsReview(operationsKey(3)))));
  const evidenceState = operationsReadReceipt(sql(operationsCall(2, `public.evaluation_preparation_snapshot('${operationsOrg}','${operationsBranch}',1)`)));
  const operationsBundle = (key) => `public.evaluation_evidence_bundle('${operationsOrg}','${operationsBranch}','${evidenceState?.collectionHash}','${key}')`;
  const bundled = operationsReadReceipt(sql(operationsCall(2, operationsBundle(operationsKey(4)))));
  if (!frozen?.snapshotId || reviewed?.decision !== "approved" || !bundled?.bundleId || bundled.formalSubmissionEnabled !== false) {
    throw new Error("Native exact-source quality/review/bundle positive baseline failed.");
  }
  const operationsCounts = () => sql(`select jsonb_build_array(
    (select count(*) from private.quality_monthly_snapshots where organization_id='${operationsOrg}'),
    (select count(*) from private.evaluation_evidence_reviews where organization_id='${operationsOrg}'),
    (select count(*) from private.evaluation_evidence_bundles where organization_id='${operationsOrg}'),
    (select count(*) from private.evaluation_preparation_versions where organization_id='${operationsOrg}'),
    (select count(*) from public.audit_events where organization_id='${operationsOrg}'
      and table_name in ('quality_monthly_snapshots','evaluation_evidence_reviews','evaluation_evidence_bundles','private.evaluation_preparation_versions')))::text;`).trim();
  const operationsBaseline = operationsCounts();
  const operationBoundaries = {
    session: (actor) => ({ disable: `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='${operationsActor(actor)}';`, restore: `update auth.sessions set not_after=null where user_id='${operationsActor(actor)}';` }),
    branch: () => ({ disable: `update public.branches set is_active=false where id='${operationsBranch}';`, restore: `update public.branches set is_active=true where id='${operationsBranch}';` }),
    organization: () => ({ disable: `update public.organizations set is_active=false where id='${operationsOrg}';`, restore: `update public.organizations set is_active=true where id='${operationsOrg}';` }),
    approval: () => ({ disable: `update private.staff_google_access_grants set enabled=false where allowed_user_id='${operationsActor(2)}';`, restore: `update private.staff_google_access_grants set enabled=true where allowed_user_id='${operationsActor(2)}';` }),
  };
  const operationsLocks = [
    { name: "quality_actor", actor: 1, boundary: "session", replayKey: 1, call: operationsFreeze, seed: 0, value: (key) => operationsActor(1) + key },
    { name: "review_collection", actor: 2, boundary: "branch", replayKey: 3, call: operationsReview, seed: 7902, value: () => `${operationsOrg}:${operationsBranch}` },
    { name: "review_actor", actor: 2, boundary: "approval", replayKey: 3, call: operationsReview, seed: 79, value: (key) => operationsActor(2) + key },
    { name: "review_item", actor: 2, boundary: "organization", call: operationsReview, seed: 79, value: () => `${operationsOrg}:${operationsBranch}:INTERNAL_01` },
    { name: "bundle_collection", actor: 2, boundary: "organization", replayKey: 4, call: operationsBundle, seed: 7902, value: () => `${operationsOrg}:${operationsBranch}` },
    { name: "bundle_actor", actor: 2, boundary: "session", replayKey: 4, call: operationsBundle, seed: 7901, value: (key) => operationsActor(2) + key },
  ];
  let operationsRaceCount = 0;
  for (const probe of operationsLocks) {
    for (const replay of probe.replayKey ? [false, true] : [false]) {
      const key = operationsKey(replay ? probe.replayKey : 100 + operationsRaceCount);
      const holder = await holdDatabaseLock(`select pg_advisory_xact_lock(hashtextextended('${probe.value(key)}',${probe.seed}))`);
      const name = `native_admission_ops_${probe.name}_${replay ? "replay" : "write"}`;
      const work = concurrent(operationsCall(probe.actor, probe.call(key), name));
      await waitForBlocked([name]);
      const boundary = operationBoundaries[probe.boundary](probe.actor);
      await holder.release(`${boundary.disable}commit;`);
      const result = await work;
      if (result.status === 0 || !result.stderr.includes("42501") || result.stdout.includes("NATIVE_OPS_RECEIPT=") || operationsCounts() !== operationsBaseline) {
        const state = result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1] ?? "unclassified";
        throw new Error(`Native operations ${probe.name} ${replay ? "receipt replay" : "write"} did not reject revoked ${probe.boundary} with zero extra versions/reports/reviews/bundles/audits (exit=${result.status}, SQLSTATE=${state}, counts=${operationsCounts()}, baseline=${operationsBaseline}).`);
      }
      sql(boundary.restore);
      operationsRaceCount += 1;
      console.log(`Native operations ${probe.name} ${replay ? "receipt replay" : "write"}: observed advisory lock; ${probe.boundary} revoked -> 42501; zero extra versions/reports/reviews/bundles/audits, no stale receipt.`);
    }
  }
  console.log(`Native operations post-lock races: ${operationsRaceCount}/${operationsRaceCount}; every quality/review/bundle advisory lock covered.`);
  // The executive policy is a singleton. Release only this disposable fixture's
  // policy before the independent roster fixture installs its own approval.
  sql(`delete from private.executive_access_policy where allowed_user_id='${operationsActor(1)}';`);

  // Reuse the exact source-linked JUBO fixture and real native Auth checks. The
  // independent reviewer also holds a manager role so removing ONLY director
  // authority cannot be confused with removing generic preparation permission.
  const juboSource = await readFile(join(root, "supabase/tests/jubo_admission_preparation.test.sql"), "utf8");
  const juboStart = juboSource.indexOf("select set_config('test.director_amr'");
  const juboEnd = juboSource.indexOf("select ok(not has_function_privilege");
  if (juboStart < 0 || juboEnd <= juboStart) throw new Error("Strict source-bound JUBO fixture unavailable.");
  const juboSetup = sql(`begin;${juboSource.slice(juboStart, juboEnd)}
    insert into public.membership_roles(membership_id,role_id) values('bb160000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003');
    select pg_temp.login(1);select 'NATIVE_JUBO_JWT1='||current_setting('request.jwt.claims');
    select pg_temp.login(2);select 'NATIVE_JUBO_JWT2='||current_setting('request.jwt.claims');commit;`);
  const juboJwts = [1, 2].map((actor) => juboSetup.split("\n").find((line) => line.startsWith(`NATIVE_JUBO_JWT${actor}=`))?.slice(`NATIVE_JUBO_JWT${actor}=`.length));
  if (juboJwts.some((value) => !value)) throw new Error("Native JUBO session metadata unavailable.");
  const juboOrg = "bb140000-0000-4000-8000-000000000001";
  const juboBranch = "bb150000-0000-4000-8000-000000000001";
  const juboClient = "bb240000-0000-4000-8000-000000000001";
  const juboActor = (actor) => `bb100000-0000-4000-8000-00000000000${actor}`;
  const juboKey = (number) => `bf930000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const juboCall = (actor, call, name = "native_admission_jubo_setup") => `begin;set local application_name='${name}';${staffClaims(juboJwts[actor - 1])}
    select 'NATIVE_JUBO_RECEIPT='||(${call})::text;commit;`;
  const juboReadReceipt = (output) => JSON.parse(output.split("\n").find((line) => line.startsWith("NATIVE_JUBO_RECEIPT="))?.slice("NATIVE_JUBO_RECEIPT=".length) ?? "null");
  const juboPropose = (key) => `public.propose_jubo_pending_admission('${juboOrg}','${juboBranch}','${juboClient}',
    (clock_timestamp() at time zone 'Asia/Taipei')::date,'SYNTHETIC-ELIGIBILITY',repeat('a',64),
    (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+1,
    'SYNTHETIC-AGREEMENT',repeat('b',64),1,'Synthetic eligibility and agreement declared; source verification remains pending','${key}')`;
  const juboOriginalProposal = juboReadReceipt(sql(juboCall(2, juboPropose(juboKey(1)))));
  const juboReview = (key, proposal) => `public.review_jubo_pending_admission('${juboOrg}','${juboBranch}','${juboClient}',
    '${proposal?.proposalId}','${proposal?.proposalSha256}','approved','Synthetic independent director review; source verification remains pending','${key}')`;
  const juboOriginalReview = juboReadReceipt(sql(juboCall(1, juboReview(juboKey(2), juboOriginalProposal))));
  const juboCurrentProposal = juboReadReceipt(sql(juboCall(2, juboPropose(juboKey(3)))));
  if (juboOriginalProposal?.admissionEnabled !== false || !juboOriginalProposal?.proposalId
    || !juboOriginalReview?.reviewId || juboOriginalReview.admissionEnabled !== false || !juboCurrentProposal?.proposalId) {
    throw new Error("Native JUBO positive preparation/independent review baseline failed.");
  }
  const juboCounts = () => sql(`select jsonb_build_array(
    (select count(*) from private.jubo_pending_admission_proposals where organization_id='${juboOrg}'),
    (select count(*) from private.jubo_pending_admission_reviews where organization_id='${juboOrg}'),
    (select count(*) from public.audit_events where organization_id='${juboOrg}'
      and table_name in ('jubo_pending_admission_proposals','jubo_pending_admission_reviews','private.jubo_pending_admission_proposals','private.jubo_pending_admission_reviews')),
    (select count(*) from public.clients where organization_id='${juboOrg}' and (status<>'pending' or admitted_on is not null)))::text;`).trim();
  const juboBaseline = juboCounts();
  if (JSON.parse(juboBaseline)[0] !== 2 || JSON.parse(juboBaseline)[1] !== 1 || JSON.parse(juboBaseline)[3] !== 0) {
    throw new Error("JUBO fixture must remain pending without a formal admission.");
  }
  const juboBoundaries = {
    session: (actor) => ({ disable: `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='${juboActor(actor)}';`, restore: `update auth.sessions set not_after=null where user_id='${juboActor(actor)}';` }),
    branch: () => ({ disable: `update public.branches set is_active=false where id='${juboBranch}';`, restore: `update public.branches set is_active=true where id='${juboBranch}';` }),
    // Do not try to revoke the shared-locked reauth row from the advisory-lock
    // holder: that would create an artificial deadlock. Downgrade the actual
    // native Auth session's AAL while keeping the in-flight claims unchanged.
    aal2: (actor) => ({ disable: `update auth.sessions set aal='aal1' where user_id='${juboActor(actor)}';`, restore: `update auth.sessions set aal='aal2' where user_id='${juboActor(actor)}';` }),
    director: () => ({ disable: "delete from public.membership_roles where membership_id='bb160000-0000-4000-8000-000000000001' and role_id='10000000-0000-4000-8000-000000000011';", restore: "insert into public.membership_roles(membership_id,role_id) values('bb160000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011');" }),
  };
  let juboRaceCount = 0;
  for (const operation of ["proposal", "review"]) {
    const actor = operation === "proposal" ? 2 : 1;
    for (const boundaryName of operation === "proposal" ? ["session", "branch", "aal2"] : ["session", "branch", "aal2", "director"]) {
      for (const replay of [false, true]) {
        const key = juboKey(replay ? (operation === "proposal" ? 1 : 2) : 100 + juboRaceCount);
        const lock = `jubo-admission-${operation}:${juboActor(actor)}:${key}`;
        const holder = await holdDatabaseLock(`select pg_advisory_xact_lock(hashtextextended('${lock}',0))`);
        const name = `native_admission_jubo_${operation}_${boundaryName}_${replay ? "replay" : "write"}`;
        const call = operation === "proposal" ? juboPropose(key) : juboReview(key, replay ? juboOriginalProposal : juboCurrentProposal);
        const work = concurrent(juboCall(actor, call, name));
        await waitForBlocked([name]);
        const boundary = juboBoundaries[boundaryName](actor);
        await holder.release(`${boundary.disable}commit;`);
        const result = await work;
        if (result.status === 0 || !result.stderr.includes("42501") || result.stdout.includes("NATIVE_JUBO_RECEIPT=") || juboCounts() !== juboBaseline) {
          const state = result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1] ?? "unclassified";
          throw new Error(`Native JUBO ${operation} ${replay ? "receipt replay" : "write"} retained revoked ${boundaryName} (exit=${result.status}, SQLSTATE=${state}, counts=${juboCounts()}, baseline=${juboBaseline}).`);
        }
        if (boundaryName === "director") {
          const stillAuthorized = sql(`begin;${staffClaims(juboJwts[0])}
            select public.jubo_admission_preparation_snapshot('${juboOrg}','${juboBranch}','${juboClient}')->>'canSubmit';
            reset role;select not private.jubo_admission_independent_director('${juboOrg}','${juboBranch}');rollback;`).trim().split("\n").slice(-2).join(",");
          if (stillAuthorized !== "true,t") throw new Error("Director-role race must retain exact manager preparation scope but not independent-review authority.");
        }
        sql(boundary.restore);
        juboRaceCount += 1;
        console.log(`Native JUBO ${operation} ${replay ? "receipt replay" : "write"}: observed advisory lock; ${boundaryName} revoked -> 42501; zero extra proposals/reviews/business audits/admissions, no stale receipt.`);
      }
    }
  }
  console.log(`Native JUBO post-lock races: ${juboRaceCount}/${juboRaceCount}; formal admission remains disabled.`);

  // Reuse only synthetic Auth fixture setup. Claims are kept in memory, never
  // printed, sent to a remote server, or used to impersonate a real employee.
  const source = await readFile(join(root, "supabase/tests/client_weekly_attendance_transport.test.sql"), "utf8");
  const fixture = source.slice(source.indexOf("select set_config('test.weekly_amr'"), source.indexOf("create function pg_temp.weekly_day"));
  const approval = source.match(/insert into private\.executive_access_policy[^;]+;/)?.[0];
  if (!fixture || !approval) throw new Error("Synthetic admission fixture not found.");
  const setup = sql(`begin;${fixture}${approval}select 'NATIVE_JWT='||current_setting('request.jwt.claims');commit;`);
  const jwt = setup.split("\n").find((line) => line.startsWith("NATIVE_JWT="))?.slice("NATIVE_JWT=".length);
  if (!jwt) throw new Error("Synthetic admission claims missing.");
  const claims = `select set_config('request.jwt.claims','${jwt.replaceAll("'", "''")}',true);set local role authenticated;`;
  const save = (key, version, name) => `begin;set local application_name='${name}';${claims}
    select 'NATIVE_RECEIPT='||receipt::text from public.save_care_roster('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',
    jsonb_build_object('clientId','c2600000-0000-4000-8000-000000000001','serviceDate',(clock_timestamp() at time zone 'Asia/Taipei')::date,'shift','morning','staffUserId',null,'expectedVersion',${version},'state','scheduled','sourceNote','Synthetic native allocation','tasks','["temperature"]'::jsonb,'approved',true,'idempotency_key','${key}'));commit;`;
  const receipt = (result) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("NATIVE_RECEIPT="))?.slice("NATIVE_RECEIPT=".length) ?? "null");
  const firstHolder = await holdRow();
  const duplicateNames = ["native_admission_duplicate_a", "native_admission_duplicate_b"];
  const duplicateWork = duplicateNames.map((name) => concurrent(save("ca100000-0000-4000-8000-000000000001", 0, name)));
  await waitForBlocked(duplicateNames); await firstHolder.release();
  const duplicates = await Promise.all(duplicateWork); const receipts = duplicates.map(receipt);
  if (duplicates.some((result) => result.status !== 0) || receipts.some((value) => !value) || receipts[0].id !== receipts[1].id || receipts.filter((value) => value.replayed).length !== 1) throw new Error("Native duplicate key did not resolve to one shared receipt.");

  const conflictHolder = await holdRow();
  const conflictNames = ["native_admission_conflict_a", "native_admission_conflict_b"];
  const conflictWork = conflictNames.map((name, index) => concurrent(save(`ca100000-0000-4000-8000-00000000000${index + 2}`, 1, name)));
  await waitForBlocked(conflictNames); await conflictHolder.release();
  const conflicts = await Promise.all(conflictWork);
  if (conflicts.filter((result) => result.status === 0).length !== 1 || conflicts.filter((result) => result.status !== 0 && result.stderr.includes("40001")).length !== 1) throw new Error("Native competing bases did not produce one success and one 40001.");
  const counts = () => sql("select jsonb_build_array((select count(*) from private.care_roster_versions where organization_id='c2300000-0000-4000-8000-000000000001'),(select count(*) from private.care_roster_operations where organization_id='c2300000-0000-4000-8000-000000000001'))::text;").trim();
  const before = counts();
  if (before !== "[2, 2]") throw new Error("Unexpected roster version/receipt baseline.");
  console.log("Native observed lock races: same key -> one version/shared receipt; competing keys -> one success/one 40001.");

  const suspendHolder = await holdRow();
  const suspensionWork = concurrent(save("ca100000-0000-4000-8000-000000000004", 2, "native_admission_suspend_waiter"));
  await waitForBlocked(["native_admission_suspend_waiter"]);
  await suspendHolder.release(`${claims}select * from public.transition_client('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','suspend',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic native suspension',null,1,'ca200000-0000-4000-8000-000000000001');commit;`);
  const suspension = await suspensionWork;
  if (suspension.status === 0 || !suspension.stderr.includes("23514") || counts() !== before) throw new Error("Roster waiter did not reject the committed suspension without extra versions/receipts.");
  console.log("Native row-lock race: committed suspension -> waiting scheduled write rejected 23514; zero extra versions/receipts.");
  sql(`begin;${claims}select * from public.transition_client('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','resume',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic explicit resume',null,2,'ca200000-0000-4000-8000-000000000002');commit;`);
  const revokeHolder = await holdRow();
  const revokeWork = concurrent(save("ca100000-0000-4000-8000-000000000005", 2, "native_admission_revoke_waiter"));
  await waitForBlocked(["native_admission_revoke_waiter"]);
  await revokeHolder.release("update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';commit;");
  const revoked = await revokeWork;
  if (revoked.status === 0 || !revoked.stderr.includes("42501") || counts() !== before) throw new Error("Roster waiter did not reject revoked organization without extra versions/receipts.");
  console.log("Native row-lock race: organization revoked while waiting -> 42501; zero extra versions/receipts.");

  sql("update public.organizations set is_active=true where id='c2300000-0000-4000-8000-000000000001';insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values('c2600000-0000-4000-8000-000000000002','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-2','Synthetic pending admission',null);");
  const lifecycleCounts = () => sql("select jsonb_build_array((select count(*) from public.client_transitions),(select row_version from public.clients where id='c2600000-0000-4000-8000-000000000002'),(select admitted_on from public.clients where id='c2600000-0000-4000-8000-000000000002'))::text;").trim();
  const lifecycleBefore = lifecycleCounts();
  if (lifecycleBefore !== "[2, 1, null]") throw new Error("Unexpected lifecycle baseline.");
  const admitSql = (key) => `select * from public.transition_client('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000002','admit',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic explicit admission',null,1,'${key}');`;
  for (const scope of ["organization", "branch"]) {
    const table = scope === "organization" ? "organizations" : "branches";
    const id = scope === "organization" ? "c2300000-0000-4000-8000-000000000001" : "c2400000-0000-4000-8000-000000000001";
    for (const boundary of ["rpc", "trigger"]) {
      const holder = await holdRow("c2600000-0000-4000-8000-000000000002");
      const name = `native_admission_${scope}_${boundary}_waiter`;
      // The internal-insert variant stays postgres with the same actual Auth
      // claims, to exercise the trigger without granting staff ledger INSERT.
      const internalClaims = claims.replace("set local role authenticated;", "");
      const operation = boundary === "rpc" ? admitSql("ca300000-0000-4000-8000-000000000001") : "insert into public.client_transitions(client_id,event_kind,effective_on,reason,base_row_version,idempotency_key,actor_user_id) values('c2600000-0000-4000-8000-000000000002','admit',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic internal ledger validation',1,gen_random_uuid(),auth.uid());";
      const work = concurrent(`begin;set local application_name='${name}';${boundary === "rpc" ? claims : internalClaims}${operation}commit;`);
      await waitForBlocked([name]);
      await holder.release(`update public.${table} set is_active=false where id='${id}';commit;`);
      const result = await work;
      if (result.status === 0 || !result.stderr.includes("42501") || lifecycleCounts() !== lifecycleBefore) throw new Error(`Lifecycle ${boundary} waiter did not reject disabled ${scope} without extra transition/version/admission.`);
      sql(`update public.${table} set is_active=true where id='${id}';`);
      console.log(`Native lifecycle ${boundary} client-lock race: ${scope} disabled while waiting -> 42501; zero transitions/version changes.`);
    }
  }

  // The winner commits a legitimate admission and disables its organization in
  // one transaction. A duplicate already waiting on its client lock must deny,
  // rather than return a stale receipt from the second replay lookup.
  const replayHolder = await holdRow("c2600000-0000-4000-8000-000000000002");
  const replayKey = "ca300000-0000-4000-8000-000000000002";
  const replayWork = concurrent(`begin;set local application_name='native_admission_replay_waiter';${claims}${admitSql(replayKey)}commit;`);
  await waitForBlocked(["native_admission_replay_waiter"]);
  await replayHolder.release(`${claims}${admitSql(replayKey)}reset role;update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';commit;`);
  const replayDenied = await replayWork;
  const finalLifecycle = JSON.parse(lifecycleCounts());
  if (replayDenied.status === 0 || !replayDenied.stderr.includes("42501") || finalLifecycle[0] !== 3 || finalLifecycle[1] !== 2 || !finalLifecycle[2]) throw new Error("Lifecycle delayed replay did not deny revoked scope without extra transition.");
  console.log("Native lifecycle delayed replay: winning admission plus scope disable -> waiting duplicate rejected 42501; only original transition retained.");
} finally {
  for (const holder of holders) await holder.release("rollback;").catch(() => {});
  if (started) {
    run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
    console.log("Native disposable PostgreSQL stopped; local Unix socket only, no hosted database connection.");
  }
}
