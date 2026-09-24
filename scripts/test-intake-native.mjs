// Native PostgreSQL validation in a disposable local cluster. Never accepts a URL
// or connects to a hosted database. Auth and Storage schemas are synthetic fixtures.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries || !binaries.startsWith("/")) {
  throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute native PostgreSQL bin directory.");
}
const runtime = await mkdtemp("/tmp/daycare-native-pg.");
const data = join(runtime, "data");
const port = "55439";
const env = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  PGHOST: runtime,
  PGPORT: port,
  PGUSER: "postgres",
  PGDATABASE: "postgres",
  PGCONNECT_TIMEOUT: "5",
};
const run = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], input);
const concurrentSql = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
// Keep one real connection open until the test has observed the competing
// sessions waiting on its advisory lock. No timing-only sleep establishes proof.
const holdAdvisoryLock = async (keySql) => {
  const child = spawn(join(binaries, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { cwd: root, env });
  let stdout = ""; let stderr = ""; let released = false;
  let markReady; let failReady;
  const ready = new Promise((resolveReady, rejectReady) => { markReady = resolveReady; failReady = rejectReady; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (value) => {
      stdout += value;
      const match = stdout.match(/^NATIVE_LOCK_READY=(\d+)$/m);
      if (match) markReady(Number(match[1]));
    });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", (error) => { failReady(error); resolveCompletion({ status: -1 }); });
    child.on("close", (status) => {
      failReady(new Error("Native advisory lock holder ended before readiness."));
      resolveCompletion({ status });
    });
  });
  const timeout = setTimeout(() => failReady(new Error("Native advisory lock holder readiness timed out.")), 10_000);
  child.stdin.write(`begin;set local application_name='native_document_lock_holder';
    select pg_advisory_xact_lock(${keySql});select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
  let pid;
  try { pid = await ready; }
  catch (error) { child.stdin.end("rollback;\n"); await completion; throw error; }
  finally { clearTimeout(timeout); }
  return { pid, release: async () => {
    if (released) return;
    released = true; child.stdin.end("commit;\n");
    const result = await completion;
    if (result.status !== 0) throw new Error(`Native advisory lock holder failed: ${stderr}`);
  } };
};
const waitForAdvisoryWaiters = async (holderPid, applicationNames) => {
  if (!Number.isInteger(holderPid) || applicationNames.some((name) => !/^native_document_[a-z0-9_]+$/.test(name))) throw new Error("Invalid synthetic advisory wait probe.");
  const deadline = Date.now() + 10_000;
  const names = applicationNames.map((name) => `'${name}'`).join(",");
  while (Date.now() < deadline) {
    const waiting = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names})
      and wait_event_type='Lock' and wait_event='advisory' and ${holderPid}=any(pg_blocking_pids(pid));`).trim());
    if (waiting === applicationNames.length) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Native document writers were not observed waiting on the held advisory lock.");
};
const tests = [
  "client_lifecycle_active_scope.test.sql",
  "admission_day_roster_eligibility.test.sql",
  "daily_transport_reconciliation.test.sql",
  "client_weekly_attendance_transport.test.sql",
  "client_intake_profile_and_cms_commit.test.sql",
  "taipei_abcd_intake_drafts.test.sql",
  "client_documents_intake_pipeline.test.sql",
  "client_document_lifecycle_and_history.test.sql",
  "approved_google_intake_actions.test.sql",
  "pending_staff_google_activation.test.sql",
  "taipei_abcd_administrative_workflow.test.sql",
  "intake_completeness_report.test.sql",
  "custom_form_draft_authoring.test.sql",
  "store_overview_attendance_summary.test.sql",
];
const intakeTables = [
  "client_weekly_versions", "client_weekly_exceptions", "client_weekly_operations",
  "client_intake_versions", "client_intake_identities", "client_intake_operations",
  "taipei_abcd_draft_versions", "taipei_abcd_draft_operations",
  "client_document_versions", "client_document_scan_results", "client_document_review_versions",
  "client_document_disposition_events", "client_document_disposition_receipts",
  "client_document_history_snapshots", "client_document_history_items", "client_document_history_cursors",
  "pending_staff_google_activations", "taipei_abcd_review_events", "taipei_abcd_export_snapshots",
];
const intakeTableList = intakeTables.map((name) => `'${name}'`).join(",");
let started = false;
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${port} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql(`create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
  `);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  let upgradeFingerprint;
  let upgradeBaselineCount;
  const fingerprint = () => sql(`select md5(jsonb_build_object(
    'clients',(select jsonb_agg(to_jsonb(c) order by c.id) from public.clients c),
    'measurements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.measurements m),
    -- draft_revision is new concurrency metadata, not a change to an existing
    -- form definition. Its initial value is independently checked below.
    'forms',(select jsonb_agg(to_jsonb(f)-'draft_revision' order by f.id) from public.form_versions f),
    'roles',(select jsonb_agg(to_jsonb(r) order by r.id) from public.roles r)
  )::text);`).trim();
  for (const [migrationIndex, name] of migrations.entries()) {
    if (name.startsWith("20260913175005_")) {
      sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
      upgradeFingerprint = fingerprint();
      upgradeBaselineCount = migrationIndex;
    }
    try { sql(await readFile(join(root, "supabase/migrations", name), "utf8")); }
    catch (error) { throw new Error(`Native migration ${name}: ${error.message}`); }
  }
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  if (!upgradeFingerprint || fingerprint() !== upgradeFingerprint) throw new Error("Intake migration changed pre-existing synthetic clients, measurements, forms, or roles.");
  if (sql("select count(*)>0 and bool_and(draft_revision=1) from public.form_versions;").trim() !== "t") {
    throw new Error("Existing form draft revision metadata did not initialize to 1.");
  }
  console.log(`${upgradeBaselineCount}-to-${migrations.length} upgrade: existing synthetic clients, measurements, forms, and roles unchanged.`);
  console.log("New form concurrency metadata: every existing synthetic form starts at revision 1.");
  // Reuse pinned pgTAP SQL only. No PGlite engine, WASM runtime, or fake assertions.
  const tapSql = run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]);
  sql(tapSql);
  let assertions = 0;
  for (const name of tests) {
    const source = await readFile(join(root, "supabase/tests", name), "utf8");
    const expected = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]);
    const output = sql(source);
    const passed = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
    const failed = output.split("\n").filter((line) => /^not ok \d+\b|^# Looks like/.test(line));
    if (!expected || passed !== expected || failed.length) throw new Error(`${name}: ${passed}/${expected}; ${failed.join("; ")}`);
    assertions += passed;
    console.log(`${name}: ${passed}/${expected}.`);
  }
  const catalog = sql(`begin;
    select plan(9);
    select ok((select count(*)=${intakeTables.length} and bool_and(relrowsecurity and relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in (${intakeTableList})),'all ${intakeTables.length} intake and activation tables exist and force RLS');
    select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in (${intakeTableList}) and (has_table_privilege('anon',c.oid,'select,insert,update,delete') or has_table_privilege('authenticated',c.oid,'select,insert,update,delete') or has_table_privilege('service_role',c.oid,'select,insert,update,delete'))),'no direct client or worker table grants');
    select is((select public from storage.buckets where id='client-intake-documents'),false,'bucket private');
    select is((select file_size_limit from storage.buckets where id='client-intake-documents'),4194304::bigint,'bucket bounded to 4 MB');
    create policy native_unrelated_permissive_policy on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.objects(bucket_id,name) values('client-intake-documents','synthetic-probe');
    set local role anon;
    select is((select count(*)::int from storage.objects where bucket_id='client-intake-documents'),0,'anonymous blocked despite unrelated permissive policy');
    reset role;
    set local role authenticated;
    select is((select count(*)::int from storage.objects where bucket_id='client-intake-documents'),0,'authenticated direct storage read blocked');
    select throws_ok($q$insert into storage.objects(bucket_id,name) values('client-intake-documents','synthetic-browser-upload')$q$,'42501',null,'authenticated direct storage write blocked');
    reset role;
    ${[
      ["taipei_export_client_fk_idx", "taipei_abcd_export_snapshots"],
      ["taipei_review_client_fk_idx", "taipei_abcd_review_events"],
    ].map(([index, table]) => `select ok(exists(
      select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
      where i.indexrelid=to_regclass('private.${index}') and i.indrelid=to_regclass('private.${table}')
      and i.indisvalid and i.indisready and i.indnkeyatts=3 and i.indnatts=3 and not i.indisunique
      and i.indpred is null and i.indexprs is null and am.amname='btree'
      and (select array_agg(a.attname::text order by k.ordinality)
        from unnest(i.indkey::smallint[]) with ordinality k(attnum,ordinality)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum)
        =array['client_id','organization_id','branch_id']::text[]
    ),'${table} has exact ready client-leading FK index');`).join("\n")}
    select * from finish(); rollback;
  `);
  const catalogPassed = catalog.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
  if (catalogPassed !== 9 || /^not ok /m.test(catalog)) throw new Error(`Native ACL/Storage/index checks failed: ${catalog}`);
  console.log(`Native intake suites: ${assertions}/${assertions}; additional ACL/Storage/index probes: 9/9.`);
  // Real two-process sessions exercise advisory-lock serialization, not a mocked
  // sequential replay. Fixtures remain solely inside this disposable cluster.
  const weeklySource = await readFile(join(root, "supabase/tests/client_weekly_attendance_transport.test.sql"), "utf8");
  const fixture = weeklySource.slice(weeklySource.indexOf("select set_config('test.weekly_amr'"), weeklySource.indexOf("create function pg_temp.weekly_day"));
  const approval = weeklySource.match(/insert into private\.executive_access_policy[^;]+;/)?.[0];
  if (!fixture || !approval) throw new Error("Synthetic concurrency fixture not found.");
  const fixtureOutput = sql(`begin;${fixture}${approval}select 'NATIVE_JWT='||current_setting('request.jwt.claims');commit;`);
  const jwt = fixtureOutput.split("\n").find((line) => line.startsWith("NATIVE_JWT="))?.slice("NATIVE_JWT=".length);
  if (!jwt) throw new Error("Synthetic native session claims unavailable.");
  const save = (key, expected) => `begin;
    select set_config('request.jwt.claims','${jwt.replaceAll("'", "''")}',true);
    set local role authenticated;
    select 'NATIVE_RECEIPT='||receipt::text from public.save_client_weekly(
      'c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',
      jsonb_build_object('action','save_plan','clientId','c2600000-0000-4000-8000-000000000001','expectedVersion',${expected},'idempotency_key','${key}',
      'plan',jsonb_build_object('effectiveFrom',(now() at time zone 'Asia/Taipei')::date,'effectiveTo',null,'reason','Synthetic concurrent plan',
      'days',(select jsonb_agg(jsonb_build_object('weekday',n,'attending',true,'startsAt','09:00','endsAt','16:00','outbound',null,'inbound',null)) from generate_series(1,7)n))));
    select pg_sleep(0.25);commit;`;
  const sameKey = "c2800000-0000-4000-8000-000000000081";
  const duplicate = await Promise.all([concurrentSql(save(sameKey, 0)), concurrentSql(save(sameKey, 0))]);
  const receipt = (result) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("NATIVE_RECEIPT="))?.slice("NATIVE_RECEIPT=".length) ?? "null");
  const receipts = duplicate.map(receipt);
  if (duplicate.some((result) => result.status !== 0) || receipts.some((value) => !value) || receipts[0].id !== receipts[1].id || receipts.filter((value) => value.replayed).length !== 1) {
    throw new Error("Concurrent duplicate operation did not serialize to one immutable receipt.");
  }
  const conflict = await Promise.all([
    concurrentSql(save("c2800000-0000-4000-8000-000000000082", 1)),
    concurrentSql(save("c2800000-0000-4000-8000-000000000083", 1)),
  ]);
  if (conflict.filter((result) => result.status === 0).length !== 1 || !conflict.some((result) => result.status !== 0 && result.stderr.includes("40001"))) {
    throw new Error("Concurrent stale-base operations did not produce one success and one version conflict.");
  }
  if (sql("select count(*) from private.client_weekly_versions where client_id='c2600000-0000-4000-8000-000000000001';").trim() !== "2") throw new Error("Concurrent operations produced duplicate weekly versions.");
  console.log("Native two-session checks: duplicate key -> one version/shared receipt; competing keys -> one commit/one SQLSTATE 40001.");
  // Reuse the exact admitted Google actor above, but add synthetic attachment
  // metadata only. No scanner, object download, or hosted service is contacted.
  const documentId = "d0900000-0000-4000-8000-000000000001";
  sql(`insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash,document_label)
    values('${documentId}','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001',
      'identity_front',1,repeat('d',64),'application/pdf',128,'synthetic-native-document/one','c2100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('e',64),'Synthetic native attachment');
    insert into private.client_document_scan_results(document_id,verdict,scanner) values('${documentId}','clean','synthetic-native-scanner');`);
  const documentSave = (key, expected, applicationName) => `begin;
    set local application_name='${applicationName}';
    select set_config('request.jwt.claims','${jwt.replaceAll("'", "''")}',true);
    set local role authenticated;
    select 'NATIVE_DOCUMENT_RECEIPT='||receipt::text from public.change_client_document_disposition(
      'c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',
      jsonb_build_object('clientId','c2600000-0000-4000-8000-000000000001','documentId','${documentId}',
        'category','identity_front','expectedReviewRevision',${expected},'disposition','reviewed',
        'reason','Synthetic concurrent document review','idempotency_key','${key}'));
    commit;`;
  const documentKeyLock = (key) => `hashtextextended('document-disposition-key:'||'c2300000-0000-4000-8000-000000000001'||'c2100000-0000-4000-8000-000000000001'||'${key}',0)`;
  const documentCategoryLock = "hashtextextended('client-document:'||'c2600000-0000-4000-8000-000000000001'||'identity_front',0)";
  const documentReceipt = (result) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("NATIVE_DOCUMENT_RECEIPT="))?.slice("NATIVE_DOCUMENT_RECEIPT=".length) ?? "null");
  const documentCounts = () => JSON.parse(sql(`select jsonb_build_object(
    'events',(select count(*) from private.client_document_disposition_events where document_id='${documentId}'),
    'receipts',(select count(*) from private.client_document_disposition_receipts r join private.client_document_disposition_events e on e.id=r.event_id where e.document_id='${documentId}'),
    'audits',(select count(*) from public.audit_events where table_name='client_document_disposition_events' and metadata->>'document_id'='${documentId}')
  );`).trim());
  const assertDocumentCounts = (expected) => {
    if (Object.values(documentCounts()).some((count) => count !== expected)) throw new Error("Native document event/receipt/audit counts disagree or contain a duplicate.");
  };
  const documentSameKey = "d0910000-0000-4000-8000-000000000001";
  const duplicateHolder = await holdAdvisoryLock(documentKeyLock(documentSameKey));
  const duplicateNames = ["native_document_duplicate_a", "native_document_duplicate_b"];
  const documentDuplicates = duplicateNames.map((name) => concurrentSql(documentSave(documentSameKey, 0, name)));
  try { await waitForAdvisoryWaiters(duplicateHolder.pid, duplicateNames); }
  finally { await duplicateHolder.release(); }
  const documentDuplicateResults = await Promise.all(documentDuplicates);
  const documentDuplicateReceipts = documentDuplicateResults.map(documentReceipt);
  if (documentDuplicateResults.some((result) => result.status !== 0)
    || documentDuplicateReceipts.some((value) => !value || value.documentId !== documentId || value.reviewRevision !== 1 || value.persisted !== true)
    || documentDuplicateReceipts.filter((value) => value.replayed === true).length !== 1
    || JSON.stringify({ ...documentDuplicateReceipts[0], replayed: false }) !== JSON.stringify({ ...documentDuplicateReceipts[1], replayed: false })) {
    throw new Error("Concurrent document duplicate key did not return one immutable result and one replay.");
  }
  assertDocumentCounts(1);
  const conflictHolder = await holdAdvisoryLock(documentCategoryLock);
  const documentConflictNames = ["native_document_conflict_a", "native_document_conflict_b"];
  const documentConflicts = ["d0910000-0000-4000-8000-000000000002", "d0910000-0000-4000-8000-000000000003"]
    .map((key, index) => concurrentSql(documentSave(key, 1, documentConflictNames[index])));
  try { await waitForAdvisoryWaiters(conflictHolder.pid, documentConflictNames); }
  finally { await conflictHolder.release(); }
  const documentConflictResults = await Promise.all(documentConflicts);
  if (documentConflictResults.filter((result) => result.status === 0 && documentReceipt(result)?.reviewRevision === 2).length !== 1
    || documentConflictResults.filter((result) => result.status !== 0 && result.stderr.includes("40001")).length !== 1) {
    throw new Error("Concurrent document same-base operations did not produce one commit and one SQLSTATE 40001.");
  }
  assertDocumentCounts(2);
  // Probe both reauthorization locations: the idempotency-key lock and the
  // shared category lock. Revocation commits only after a genuine wait is seen.
  for (const [stage, key] of [["key", "d0910000-0000-4000-8000-000000000004"], ["category", "d0910000-0000-4000-8000-000000000005"]]) {
    const held = await holdAdvisoryLock(stage === "key" ? documentKeyLock(key) : documentCategoryLock);
    const applicationName = `native_document_revoked_${stage}`;
    const rejected = concurrentSql(documentSave(key, 2, applicationName));
    const before = JSON.stringify(documentCounts());
    try {
      await waitForAdvisoryWaiters(held.pid, [applicationName]);
      sql("update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';");
    } finally { await held.release(); }
    try {
      const result = await rejected;
      if (result.status === 0 || !result.stderr.includes("42501") || documentReceipt(result) !== null || JSON.stringify(documentCounts()) !== before) {
        throw new Error(`Document authorization revoked during ${stage} lock wait did not reject with zero events/receipts/audits.`);
      }
    } finally { sql("update public.organizations set is_active=true where id='c2300000-0000-4000-8000-000000000001';"); }
  }
  console.log("Native document concurrency: observed dual waits -> same key one event/shared receipt; same base different keys one commit/one 40001; revocation during key and category waits -> 42501 with zero new events/receipts/audits.");
  // Two real OAuth-session fixtures compete for the same owner-approved invite.
  // Each connection must receive a safe result, with just one committed grant.
  const activationSource = await readFile(join(root, "supabase/tests/pending_staff_google_activation.test.sql"), "utf8");
  const activationFixture = activationSource.slice(activationSource.indexOf("select set_config('test.activation_amr'"), activationSource.indexOf("select ok("));
  const pendingApproval = activationSource.match(/insert into private\.pending_staff_google_activations[^;]+;/)?.[0];
  if (!activationFixture || !pendingApproval) throw new Error("Synthetic activation concurrency fixture not found.");
  const activationOutput = sql(`begin;${activationFixture}${pendingApproval}
    insert into auth.sessions(id,user_id,created_at,aal) values
      ('db030000-0000-4000-8000-000000000002','db010000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
    insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
      (gen_random_uuid(),'db030000-0000-4000-8000-000000000002',to_timestamp(current_setting('test.activation_amr')::bigint),to_timestamp(current_setting('test.activation_amr')::bigint),'oauth');
    select pg_temp.activation_claims();
    select 'NATIVE_ACTIVATION_JWT='||current_setting('request.jwt.claims');commit;`);
  const activationJwt = activationOutput.split("\n").find((line) => line.startsWith("NATIVE_ACTIVATION_JWT="))?.slice("NATIVE_ACTIVATION_JWT=".length);
  if (!activationJwt) throw new Error("Synthetic activation session claims unavailable.");
  const activate = (session) => {
    const claims = JSON.stringify({ ...JSON.parse(activationJwt), session_id: session });
    return `begin;
      select set_config('request.jwt.claims','${claims.replaceAll("'", "''")}',true);
      set local role authenticated;
      select 'NATIVE_ACTIVATED='||public.activate_approved_staff_google_account()::text;
      select pg_sleep(0.25);commit;`;
  };
  const activated = await Promise.all([
    concurrentSql(activate("db030000-0000-4000-8000-000000000001")),
    concurrentSql(activate("db030000-0000-4000-8000-000000000002")),
  ]);
  if (activated.some((result) => result.status !== 0 || !result.stdout.split("\n").includes("NATIVE_ACTIVATED=true"))) {
    throw new Error("Concurrent approved Google activations did not both receive a safe true result.");
  }
  const activationCounts = JSON.parse(sql(`select jsonb_build_object(
    'grants',(select count(*) from private.staff_google_access_grants where allowed_user_id='db010000-0000-4000-8000-000000000001'),
    'profiles',(select count(*) from public.profiles where id='db010000-0000-4000-8000-000000000001'),
    'memberships',(select count(*) from public.memberships where profile_id='db010000-0000-4000-8000-000000000001'),
    'roles',(select count(*) from public.membership_roles mr join public.memberships m on m.id=mr.membership_id where m.profile_id='db010000-0000-4000-8000-000000000001'),
    'activations',(select count(*) from private.pending_staff_google_activations where user_id='db010000-0000-4000-8000-000000000001' and activated_at is not null and activated_session_id in ('db030000-0000-4000-8000-000000000001','db030000-0000-4000-8000-000000000002')),
    'activation_audits',(select count(*) from public.audit_events where table_name='private.pending_staff_google_activations' and organization_id='db040000-0000-4000-8000-000000000001' and action='update')
  );`).trim());
  if (Object.values(activationCounts).some((count) => count !== 1)) throw new Error("Concurrent Google activation created duplicate authorization or audit records.");
  console.log("Native activation concurrency: two OAuth sessions -> two safe true results, one grant/profile/membership/role and one activation audit.");
  console.log("Native engine verified; hosted Supabase Auth, Storage service, migration ownership, and production data remain separate deployment gates.");
} finally {
  if (started) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
  console.log(`Disposable synthetic-only cluster stopped; artifacts retained at ${runtime}.`);
}
