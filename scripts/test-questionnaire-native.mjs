// Real PostgreSQL connections in a disposable, Unix-socket-only local cluster.
// No hosted URL, real patient data, auth-predicate replacement or remote calls.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute native PostgreSQL bin directory.");
const runtime = await mkdtemp("/tmp/daycare-questionnaire-native.");
const data = join(runtime, "data");
const port = "55447";
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: port, PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const run = (file, argv, input) => {
  const result = spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), args, input);
const startConnection = () => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  const completion = new Promise((resolveResult) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });
  return { child, completion, output: () => stdout };
};
const concurrent = (input) => {
  const connection = startConnection();
  connection.child.stdin.end(input);
  return connection.completion;
};
const holders = new Set();
const holdLock = async (lockSql) => {
  const connection = startConnection();
  connection.child.stdin.write(`begin;select pg_advisory_xact_lock(${lockSql});select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10_000;
  let released = false;
  const holder = { release: async () => {
    if (released) return;
    released = true; connection.child.stdin.end("commit;\n");
    const result = await connection.completion; holders.delete(holder);
    assert.equal(result.status, 0, "lock holder completes successfully");
  } };
  holders.add(holder);
  while (!/^READY=\d+$/m.test(connection.output())) {
    if (connection.child.exitCode !== null || Date.now() >= deadline) throw new Error("Native lock holder did not become ready.");
    await new Promise((done) => setTimeout(done, 25));
  }
  return holder;
};
const waitForBlocked = async (names) => {
  assert(names.every((name) => /^native_questionnaire_[a-z_]+$/.test(name)));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(json_agg(pid),'[]') from pg_stat_activity
      where application_name in (${names.map((name) => `'${name}'`).join(",")})
      and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === names.length) {
      assert.equal(new Set(rows).size, names.length, "independent backend processes observed waiting");
      return;
    }
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("Competing questionnaire connections were not observed waiting in PostgreSQL.");
};
const marker = (result, label) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith(`${label}=`))?.slice(label.length + 1) ?? "null");
const actor = "c2100000-0000-4000-8000-000000000001";
const organization = "c2300000-0000-4000-8000-000000000001";
const branch = "c2400000-0000-4000-8000-000000000001";
const client = "c2600000-0000-4000-8000-000000000001";
const operationLock = (key) => `hashtextextended('questionnaire-operation:${actor}:${key}',0)`;
const assessmentLock = (key) => `hashtextextended('questionnaire-assessment:${key}',0)`;
const insertLock = "hashtextextended('native-questionnaire-insert-pause',0)";
const answers = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`spmsq_${String(index + 1).padStart(2, "0")}`, { state: "answered", value: "correct" }]));
const payload = (overrides = {}) => ({ action: "create", client_id: client, form_key: "spmsq", form_version: "spmsq-pfeiffer-10-education-adjusted-v1", assessed_on: "2026-09-25", answers, context: {}, ...overrides });
let started = false;
let testFailure;
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${port} -c listen_addresses='' -c statement_timeout=15000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  for (const name of ["questionnaire_assessment_drafts.test.sql", "questionnaire_assessment_history.test.sql", "questionnaire_assessment_admission_validation.test.sql"]) {
    const suite = await readFile(join(root, "supabase/tests", name), "utf8");
    const expected = Number(suite.match(/select\s+plan\((\d+)\)/i)?.[1]);
    const output = sql(suite);
    assert.equal(output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length, expected);
    assert(!/^not ok |^# Looks like/m.test(output), "native questionnaire pgTAP has no failures");
    console.log(`Native ${name}: ${expected}/${expected}.`);
  }
  assert.equal(sql(`select has_function_privilege('authenticated','private.mutate_questionnaire_assessment_core_v1(uuid,uuid,jsonb,uuid)','execute');`).trim(), "f", "serialized core cannot be called directly");
  // Actual Google identity, session, AMR and pinned approval fixtures. No
  // authorization function is replaced or bypassed for these native tests.
  const fixtureSource = await readFile(join(root, "supabase/tests/client_weekly_attendance_transport.test.sql"), "utf8");
  const fixture = fixtureSource.slice(fixtureSource.indexOf("select set_config('test.weekly_amr'"), fixtureSource.indexOf("create function pg_temp.weekly_day"));
  const approval = fixtureSource.match(/insert into private\.executive_access_policy[^;]+;/)?.[0];
  assert(fixture && approval, "complete admitted synthetic Google fixture found");
  const setup = sql(`begin;${fixture}${approval}select 'JWT='||current_setting('request.jwt.claims');commit;`);
  const jwt = setup.split("\n").find((line) => line.startsWith("JWT="))?.slice(4);
  assert(jwt, "synthetic claims exist");
  const claims = `select set_config('request.jwt.claims','${jwt.replaceAll("'", "''")}',true);set local role authenticated;`;
  const mutate = (body, key, name) => `begin;set local application_name='${name}';${claims}
    select 'RECEIPT='||public.mutate_questionnaire_assessment('${organization}','${branch}',
      '${JSON.stringify(body).replaceAll("'", "''")}'::jsonb,'${key}')::text;commit;`;
  const counts = () => JSON.parse(sql(`select jsonb_build_object(
    'versions',(select count(*) from public.questionnaire_assessment_versions where client_id='${client}'),
    'operations',(select count(*) from private.questionnaire_assessment_operations where client_id='${client}'),
    'audits',(select count(*) from public.audit_events where organization_id='${organization}' and table_name in ('public.questionnaire_assessment_versions','private.questionnaire_assessment_operations')));`).trim());
  // This synthetic timing trigger forces the first insert to wait, so a
  // regression to unlocked SELECT-before-INSERT deterministically races.
  sql(`create schema native_test;create function native_test.pause_insert() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(${insertLock});return new;end;$$;
    create trigger native_pause_insert before insert on public.questionnaire_assessment_versions for each row execute function native_test.pause_insert();`);
  const key = "e0900000-0000-4000-8000-000000000001";
  const holder = await holdLock(insertLock);
  const names = ["native_questionnaire_duplicate_a", "native_questionnaire_duplicate_b"];
  const writes = names.map((name) => concurrent(mutate(payload(), key, name)));
  try { await waitForBlocked(names); } finally { await holder.release(); }
  const duplicates = await Promise.all(writes);
  assert(duplicates.every((result) => result.status === 0), "concurrent duplicate writes both succeed");
  const receipts = duplicates.map((result) => marker(result, "RECEIPT"));
  assert.equal(receipts[0].versionId, receipts[1].versionId);
  assert.equal(receipts.filter((receipt) => receipt.replayed).length, 1);
  assert.deepEqual(counts(), { versions: 1, operations: 1, audits: 2 });
  console.log("Observed independent concurrent sessions: duplicate key -> one immutable version/receipt, one replay.");
  sql("drop trigger native_pause_insert on public.questionnaire_assessment_versions;drop schema native_test cascade;");
  const baseline = receipts[0];
  const revised = payload({ action: "revise", assessment_key: baseline.assessmentKey, previous_version_id: baseline.versionId, expected_version: 1, context: { qualitative_note: "Synthetic revision" } });
  const versionHolder = await holdLock(assessmentLock(baseline.assessmentKey));
  const reviseNames = ["native_questionnaire_revision_a", "native_questionnaire_revision_b"];
  const revisions = reviseNames.map((name, index) => concurrent(mutate(revised, `e0900000-0000-4000-8000-00000000000${index + 2}`, name)));
  try { await waitForBlocked(reviseNames); } finally { await versionHolder.release(); }
  const competing = await Promise.all(revisions);
  assert.equal(competing.filter((result) => result.status === 0 && marker(result, "RECEIPT")?.version === 2).length, 1);
  assert.equal(competing.filter((result) => result.status !== 0 && result.stderr.includes("40001")).length, 1);
  assert.deepEqual(counts(), { versions: 2, operations: 2, audits: 4 });
  console.log("Observed competing revisions: one version-2 commit; one SQLSTATE 40001, with no duplicate audit.");
  const reused = await concurrent(mutate(payload({ context: { qualitative_note: "Changed request" } }), key, "native_questionnaire_reused"));
  assert(reused.status !== 0 && reused.stderr.includes("23505"));
  // Fifty actual connections replay one operation under contention. This is
  // request-concurrency proof for one admitted actor, NOT a 50-employee HTTP
  // load test or latency measurement (the artificial barrier adds waiting).
  const loadKey = "e0900000-0000-4000-8000-000000000009";
  const loadNames = Array.from({ length: 50 }, (_, index) => `native_questionnaire_load_${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`);
  const loadHolder = await holdLock(operationLock(loadKey));
  const loadWrites = loadNames.map((name) => concurrent(mutate(payload(), loadKey, name)));
  try { await waitForBlocked(loadNames); } finally { await loadHolder.release(); }
  const loadResults = await Promise.all(loadWrites);
  assert(loadResults.every((result) => result.status === 0));
  const loadReceipts = loadResults.map((result) => marker(result, "RECEIPT"));
  assert.equal(new Set(loadReceipts.map((receipt) => receipt.versionId)).size, 1);
  assert.equal(loadReceipts.filter((receipt) => receipt.replayed).length, 49);
  assert.deepEqual(counts(), { versions: 3, operations: 3, audits: 6 });
  console.log("Observed 50 simultaneous real connections, one actor: one commit/49 exact replays, no duplicate versions or audits. Not a 50-employee HTTP performance certificate.");
  const before = counts();
  for (const stage of ["operation", "assessment", "insert"]) {
    const revokedKey = `e0900000-0000-4000-8000-00000000000${{ operation: 4, assessment: 5, insert: 6 }[stage]}`;
    const latest = competing.filter((result) => result.status === 0).map((result) => marker(result, "RECEIPT"))[0];
    const body = stage === "assessment" ? payload({ action: "revise", assessment_key: latest.assessmentKey, previous_version_id: latest.versionId, expected_version: 2 }) : payload();
    if (stage === "insert") sql(`create schema native_test;create function native_test.pause_insert() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(${insertLock});return new;end;$$;create trigger native_pause_insert before insert on public.questionnaire_assessment_versions for each row execute function native_test.pause_insert();`);
    const revocationHolder = await holdLock(stage === "operation" ? operationLock(revokedKey) : stage === "assessment" ? assessmentLock(latest.assessmentKey) : insertLock);
    const name = `native_questionnaire_revoked_${stage}`;
    const blockedWrite = concurrent(mutate(body, revokedKey, name));
    try {
      await waitForBlocked([name]);
      sql(`update public.organizations set is_active=false where id='${organization}';`);
    } finally { await revocationHolder.release(); }
    try {
      const result = await blockedWrite;
      assert(result.status !== 0 && result.stderr.includes("42501") && marker(result, "RECEIPT") === null);
      assert.deepEqual(counts(), before, "revocation leaves no version, receipt or audit");
    } finally {
      sql(`update public.organizations set is_active=true where id='${organization}';`);
      if (stage === "insert") sql("drop trigger native_pause_insert on public.questionnaire_assessment_versions;drop schema native_test cascade;");
    }
  }
  console.log("Revocation during operation, assessment and insert waits -> 42501, zero additional records/receipts/audits.");
  // SELECT RPCs append a minimal audit and may wait too. Prove their final
  // scope check runs after that wait, instead of returning a stale snapshot.
  const readLock = "hashtextextended('native-questionnaire-read-audit-pause',0)";
  const readAuditCount = () => sql(`select count(*) from public.audit_events
    where organization_id='${organization}' and metadata->>'workflow' in
    ('questionnaire_assessment_list_v1','questionnaire_assessment_history_v1','questionnaire_assessment_snapshot_v2');`).trim();
  const readAuditsBefore = readAuditCount();
  sql(`create schema native_test;create function native_test.pause_read_audit() returns trigger language plpgsql as $$
    begin if new.metadata->>'workflow' in ('questionnaire_assessment_list_v1','questionnaire_assessment_history_v1','questionnaire_assessment_snapshot_v2')
    then perform pg_advisory_xact_lock(${readLock});end if;return new;end;$$;
    create trigger native_pause_read_audit before insert on public.audit_events for each row execute function native_test.pause_read_audit();`);
  try {
    for (const mode of ["list", "history", "snapshot"]) {
      const name = `native_questionnaire_read_${mode}`;
      const readHolder = await holdLock(readLock);
      const readCall = mode === "history"
        ? `public.questionnaire_assessment_history('${organization}','${branch}','spmsq','${client}','${baseline.assessmentKey}')`
        : mode === "list"
          ? `public.questionnaire_assessment_list('${organization}','${branch}','spmsq','${client}')`
          : `public.questionnaire_assessment_snapshot('${organization}','${branch}','spmsq','${client}')`;
      const blockedRead = concurrent(`begin;set local application_name='${name}';${claims}select 'READ='||${readCall}::text;commit;`);
      try {
        await waitForBlocked([name]);
        sql(`update public.organizations set is_active=false where id='${organization}';`);
      } finally { await readHolder.release(); }
      try {
        const result = await blockedRead;
        assert(result.status !== 0 && result.stderr.includes("42501") && marker(result, "READ") === null);
        assert.equal(readAuditCount(), readAuditsBefore, "revoked read rolls back its audit and returns no answer data");
      } finally { sql(`update public.organizations set is_active=true where id='${organization}';`); }
    }
  } finally { sql("drop trigger native_pause_read_audit on public.audit_events;drop schema native_test cascade;"); }
  console.log("List, history and snapshot audit waits recheck revoked authority -> 42501, no returned answers or committed read audits.");
  const crossScope = await concurrent(mutate(payload({ client_id: "30000000-0000-4000-8000-000000000001" }), "e0900000-0000-4000-8000-000000000007", "native_questionnaire_cross_scope"));
  assert(crossScope.status !== 0 && crossScope.stderr.includes("42501"));
  sql("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='c2200000-0000-4000-8000-000000000001';");
  const revokedSession = await concurrent(mutate(payload(), "e0900000-0000-4000-8000-000000000008", "native_questionnaire_session"));
  assert(revokedSession.status !== 0 && revokedSession.stderr.includes("42501"));
  assert.deepEqual(counts(), before);
  console.log("Cross-scope client and revoked session writes denied; immutable counts unchanged.");
  // Actual dump/restore in a second disposable database, never the live store.
  // Compare all answer versions, operation receipts and their minimal audits,
  // then verify the restored boundary still rejects direct browser access.
  const fingerprintSql = `select md5(jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from public.questionnaire_assessment_versions v),
    'operations',(select jsonb_agg(to_jsonb(o) order by o.id) from private.questionnaire_assessment_operations o),
    'audits',(select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a
      where a.table_name in ('public.questionnaire_assessment_versions','private.questionnaire_assessment_operations'))
  )::text);`;
  const originalFingerprint = sql(fingerprintSql).trim();
  const backupStarted = Date.now();
  run(join(binaries, "pg_dump"), ["--format=custom", "--file", join(runtime, "synthetic-backup.dump")]);
  sql("create database native_questionnaire_restored;");
  run(join(binaries, "pg_restore"), ["--exit-on-error", "--dbname", "native_questionnaire_restored", join(runtime, "synthetic-backup.dump")]);
  const restoredSql = (input) => run(join(binaries, "psql"), [...args, "--dbname", "native_questionnaire_restored"], input);
  assert.equal(restoredSql(fingerprintSql).trim(), originalFingerprint, "actual restored rows and receipts match byte-equivalent canonical fingerprint");
  assert.equal(restoredSql(`select relrowsecurity and relforcerowsecurity
    and not has_table_privilege('authenticated',oid,'select,insert,update,delete')
    from pg_class where oid='public.questionnaire_assessment_versions'::regclass;`).trim(), "t");
  assert.equal(restoredSql("select count(*) from pg_trigger where tgrelid='public.questionnaire_assessment_versions'::regclass and tgname='questionnaire_assessment_versions_append_only' and not tgisinternal;").trim(), "1");
  assert.throws(() => restoredSql(`begin;${claims}select public.questionnaire_assessment_history(
    '${organization}','${branch}','spmsq','${client}','${baseline.assessmentKey}');rollback;`),
  (error) => error instanceof Error && error.message.includes("42501"), "restored expired session is denied by the real history RPC");
  assert.throws(() => restoredSql("update public.questionnaire_assessment_versions set assessed_on=assessed_on;"),
  (error) => error instanceof Error && error.message.includes("55000"), "restored immutable trigger rejects an actual update");
  console.log(`Synthetic native backup/restore: answer/receipt/audit fingerprints identical; RLS, grants and immutable trigger preserved (${Date.now() - backupStarted} ms). Not a hosted PITR or production RPO/RTO certificate.`);
  console.log("Native questionnaire safety passed. Hosted Auth, final signature/rule activation and production deployment remain separate gates.");
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const released = await Promise.allSettled([...holders].map((holder) => holder.release()));
  const cleanupErrors = released.filter((result) => result.status === "rejected").map((result) => result.reason);
  let stopped = !started;
  try {
    if (started) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
    stopped = true;
  } catch (error) { cleanupErrors.push(error); }
  console.log(`Disposable synthetic-only cluster ${stopped ? "stopped" : "could not be stopped"}; artifacts retained at ${runtime}.`);
  if (cleanupErrors.length && !testFailure) throw new AggregateError(cleanupErrors, "Native cluster cleanup failed.");
  if (cleanupErrors.length && testFailure) console.error("Native cleanup also failed; the original test failure is preserved.");
}
