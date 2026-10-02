// Real PostgreSQL, local Unix socket only, synthetic identities and challenges.
// Never accepts a database URL or replaces an authorization predicate.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute native PostgreSQL bin directory.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-questionnaire-rule-governance-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55455", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const run = (file, argv, input) => {
  const result = spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), args, input);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const marker = (output, key) => {
  const line = output.split("\n").find((item) => item.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing synthetic ${key} result.`);
  return line.slice(key.length + 1);
};
const concurrentSql = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
const holders = new Set();
const hold = async (lockKey) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = ""; let released = false;
  let markReady; let failReady;
  const ready = new Promise((resolveReady, rejectReady) => { markReady = resolveReady; failReady = rejectReady; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const found = stdout.match(/^READY=(\d+)$/m);
      if (found) markReady(Number(found[1]));
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { failReady(error); resolveCompletion({ status: -1 }); });
    child.on("close", (status) => { failReady(new Error("Owned lock holder ended before readiness.")); resolveCompletion({ status }); });
  });
  const holder = { release: async () => {
    if (released) return;
    released = true; child.stdin.end("commit;\n");
    const result = await completion;
    holders.delete(holder);
    if (result.status !== 0) throw new Error(`Owned lock holder failed: ${stderr}`);
  } };
  holders.add(holder);
  const timeout = setTimeout(() => failReady(new Error("Owned lock readiness timed out.")), 10_000);
  child.stdin.write(`begin;set local application_name='native_rule_lock_holder';select pg_advisory_xact_lock(hashtextextended(${quote(lockKey)},0));select 'READY='||pg_backend_pid();\n`);
  try { holder.pid = await ready; return holder; }
  finally { clearTimeout(timeout); }
};
const waitForBlocked = async (names) => {
  if (names.some((name) => !/^native_rule_[a-z_]+$/.test(name))) throw new Error("Invalid native application name.");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'applicationName',application_name,'blockers',pg_blocking_pids(pid))), '[]'::jsonb) from pg_stat_activity where application_name in (${names.map(quote).join(",")}) and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === names.length && new Set(rows.map((row) => row.pid)).size === names.length) return rows;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Independent backends not observed waiting: ${names.join(",")}.`);
};

const org = "da500000-0000-4000-8000-000000000001";
const branch = "da600000-0000-4000-8000-000000000001";
const probes = [];
let started = false;
let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim();
  assert.match(engine, /PostgreSQL\) 17\./);
  console.log(engine);
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    try { sql(await readFile(join(root, "supabase/migrations", name), "utf8")); }
    catch (error) { throw new Error(`Native migration ${name}: ${error.message}`); }
  }
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  const suites = [];
  for (const name of ["questionnaire_rule_review_activation.test.sql", "questionnaire_rule_retirement.test.sql"]) {
    const source = await readFile(join(root, "supabase/tests", name), "utf8");
    const expected = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]);
    const output = sql(source);
    const actual = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
    assert.equal(actual, expected, `${name} assertion count`);
    assert.doesNotMatch(output, /^not ok \d+\b|^# Looks like/m);
    suites.push({ name, assertions: actual });
    console.log(`${name}: ${actual}/${expected}.`);
  }
  // Commit only synthetic Auth/catalog fixtures so independent backends see the
  // exact same legitimate approval/factor data. No pgTAP permission override.
  const reviewSource = await readFile(join(root, "supabase/tests/questionnaire_rule_review_activation.test.sql"), "utf8");
  const boundary = reviewSource.indexOf("\nselect ok(");
  assert.ok(boundary > 0);
  const fixture = reviewSource.slice(0, boundary).replace(/select\s+plan\(\d+\);/i, "");
  const setup = sql(`${fixture}
    select pg_temp.rule_login(1);set local role authenticated;select 'JWT1='||current_setting('request.jwt.claims');
    select set_config('test.native_request',pg_temp.rule_write(1)::text,true);
    select pg_temp.rule_login(2);select 'JWT2='||current_setting('request.jwt.claims');
    select 'ACTIVATION='||(pg_temp.rule_write(2,pg_temp.rule_payload('approve',pg_temp.rule_request('test.native_request')))->'request'->'activation'->>'activationId');
    reset role;select 'CATALOG='||current_setting('test.rule_hash');select 'SUCCESSOR='||current_setting('test.rule_hash2');commit;`);
  const jwt1 = marker(setup, "JWT1"); const jwt2 = marker(setup, "JWT2");
  const activationId = marker(setup, "ACTIVATION"); const catalogHash = marker(setup, "CATALOG"); const successorHash = marker(setup, "SUCCESSOR");
  const todayOffset = Number(sql("select (clock_timestamp() at time zone 'Asia/Taipei')::date-date '2000-01-01';").trim());
  const date = (offset) => new Date(Date.UTC(2000, 0, 1 + todayOffset + offset)).toISOString().slice(0, 10);
  const mutation = (input, key, name, jwt, workflow = "retirement") => {
    assert.match(name, /^native_rule_[a-z_]+$/);
    assert.ok(["review", "retirement"].includes(workflow));
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;
      select 'RECEIPT='||public.write_questionnaire_rule_${workflow}(${quote(org)}::uuid,${quote(branch)}::uuid,${quote(key)}::uuid,${quote(JSON.stringify(input))}::jsonb)::text;commit;`;
  };
  const receipt = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "RECEIPT")); };
  const input = { action: "request", formKey: "spmsq", catalogHash, activationId, requestId: null, effectiveThrough: date(5), reason: "Synthetic native retirement review" };
  const scopeHolder = await hold(`questionnaire-rule-scope:${org}:${branch}:spmsq`);
  const duplicateA = concurrentSql(mutation(input, "dae00000-0000-4000-8000-000000000001", "native_rule_duplicate_a", jwt1));
  const duplicateB = concurrentSql(mutation(input, "dae00000-0000-4000-8000-000000000001", "native_rule_duplicate_b", jwt1));
  try { probes.push({ name: "duplicate_retirement_request", waiters: await waitForBlocked(["native_rule_duplicate_a", "native_rule_duplicate_b"]) }); }
  finally { await scopeHolder.release(); }
  const duplicateReceipts = [receipt(await duplicateA), receipt(await duplicateB)];
  assert.equal(duplicateReceipts[0].request.requestId, duplicateReceipts[1].request.requestId);
  assert.equal(duplicateReceipts.filter((item) => item.replayed).length, 1);
  assert.equal(sql("select count(*) from private.questionnaire_rule_retirement_requests;").trim(), "1");
  assert.equal(sql("select count(*) from private.questionnaire_rule_retirement_operations;").trim(), "1");
  console.log("Native independent-backend same-key request: one proposal/receipt, exact replay.");

  // A test-owned pause AFTER normal authorization, before immutable retirement
  // insertion, makes lock ordering observable without weakening any admission.
  const pauseKey = "native-rule-retirement-insert-pause";
  sql(`create schema native_rule_test;
    create function native_rule_test.pause_retirement() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(hashtextextended('${pauseKey}',0));return new;end;$$;
    create trigger native_rule_pause_retirement before insert on private.questionnaire_rule_retirements for each row execute function native_rule_test.pause_retirement();`);
  sql(`create function native_rule_test.pause_snapshot_read() returns trigger language plpgsql as $$begin
    if new.table_name='questionnaire_rule_retirement' and new.action='select' then perform pg_advisory_xact_lock(hashtextextended('native-rule-snapshot-audit-pause',0));end if;return new;end;$$;
    create trigger native_rule_pause_snapshot_read before insert on public.audit_events for each row execute function native_rule_test.pause_snapshot_read();`);
  const readSql = (name) => `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(jwt1)},true);set local role authenticated;select 'READ='||public.read_questionnaire_rule_retirement('${org}'::uuid,'${branch}'::uuid,'${activationId}'::uuid)::text;commit;`;
  const readSnapshot = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "READ")); };
  const snapshotHolder = await hold("native-rule-snapshot-audit-pause");
  const snapshotRun = concurrentSql(readSql("native_rule_snapshot_read"));
  const pauseHolder = await hold(pauseKey);
  const approval = { ...input, action: "approve", requestId: duplicateReceipts[0].request.requestId, effectiveThrough: null, reason: null };
  let approveRun;
  try {
    await waitForBlocked(["native_rule_snapshot_read"]);
    approveRun = concurrentSql(mutation(approval, "dae00000-0000-4000-8000-000000000002", "native_rule_approve_wait", jwt2));
    probes.push({ name: "normal_approval_waits_for_consistent_retirement_read", waiters: await waitForBlocked(["native_rule_snapshot_read", "native_rule_approve_wait"]) });
  } finally { await snapshotHolder.release(); }
  const pendingSnapshot = readSnapshot(await snapshotRun);
  assert.equal(pendingSnapshot.total, 1);
  assert.equal(pendingSnapshot.requests[0].status, "pending");
  assert.equal(pendingSnapshot.requests[0].retirement, null);
  assert.equal(pendingSnapshot.effectiveThrough, null);
  assert.equal(pendingSnapshot.originalEffectiveTo, null);
  assert.equal(pendingSnapshot.requests[0].requestId, duplicateReceipts[0].request.requestId);
  console.log("Native retirement read audit wait: normal approval serialized; pending history/cutoff snapshot consistent.");
  let adoptionRun;
  const successor = { action: "request", formKey: "spmsq", catalogHash: successorHash, requestId: null, effectiveFrom: date(6), effectiveTo: null, reason: null };
  try {
    await waitForBlocked(["native_rule_approve_wait"]);
    adoptionRun = concurrentSql(mutation(successor, "dae00000-0000-4000-8000-000000000003", "native_rule_adopt_wait", jwt1, "review"));
    probes.push({ name: "retirement_and_successor_serialization", waiters: await waitForBlocked(["native_rule_approve_wait", "native_rule_adopt_wait"]) });
  } finally { await pauseHolder.release(); }
  const approvedReceipt = receipt(await approveRun);
  const successorRequest = receipt(await adoptionRun);
  const approvedSnapshot = readSnapshot(await concurrentSql(readSql("native_rule_approved_snapshot")));
  assert.equal(approvedSnapshot.requests[0].status, "approved");
  assert.equal(approvedSnapshot.requests[0].retirement.effectiveThrough, date(5));
  assert.equal(approvedSnapshot.effectiveThrough, date(5));
  assert.equal(approvedSnapshot.requests[0].decision.eventId, approvedReceipt.eventId);
  assert.deepEqual(approvedSnapshot.requests[0].retirement, approvedReceipt.request.retirement);
  sql("drop trigger native_rule_pause_snapshot_read on public.audit_events;");
  assert.equal(sql(`select private.questionnaire_rule_effective_through('${activationId}'::uuid);`).trim(), date(5));
  assert.equal(sql(`select effective_to is null from private.questionnaire_rule_activations where id='${activationId}'::uuid;`).trim(), "t");
  console.log("Native retirement/successor contention: approval commits before next period admission; original date unchanged.");
  // Retired, old catalogs remain immutable and an exact old operation still
  // replays its original snapshot rather than being recomputed under v2.
  const oldReplay = receipt(await concurrentSql(mutation(approval, "dae00000-0000-4000-8000-000000000002", "native_rule_old_catalog_replay", jwt2)));
  assert.equal(oldReplay.replayed, true);
  assert.equal(oldReplay.catalogHash, catalogHash);
  assert.deepEqual({ ...oldReplay, replayed: false }, approvedReceipt);

  const successorApproved = receipt(await concurrentSql(mutation({ ...successor, action: "approve", requestId: successorRequest.request.requestId, effectiveFrom: null }, "dae00000-0000-4000-8000-000000000004", "native_rule_successor_approve", jwt2, "review")));
  const secondInput = { ...input, catalogHash: successorHash, activationId: successorApproved.request.activation.activationId, effectiveThrough: date(8) };
  const secondRequest = receipt(await concurrentSql(mutation(secondInput, "dae00000-0000-4000-8000-000000000005", "native_rule_second_request", jwt1)));
  const revokeHolder = await hold(pauseKey);
  const deniedApproval = concurrentSql(mutation({ ...secondInput, action: "approve", requestId: secondRequest.request.requestId, effectiveThrough: null, reason: null }, "dae00000-0000-4000-8000-000000000006", "native_rule_revoked_approve", jwt2));
  try {
    probes.push({ name: "scope_revoked_after_authorization_before_commit", waiters: await waitForBlocked(["native_rule_revoked_approve"]) });
    sql("update private.staff_google_access_grants set enabled=false where allowed_user_id='da100000-0000-4000-8000-000000000002';");
  } finally { await revokeHolder.release(); }
  const revoked = await deniedApproval;
  assert.notEqual(revoked.status, 0);
  assert.match(revoked.stderr, /42501/);
  assert.doesNotMatch(revoked.stdout, /^RECEIPT=/m);
  assert.equal(sql("select count(*) from private.questionnaire_rule_retirements;").trim(), "1");
  assert.equal(sql("select count(*) from private.questionnaire_rule_retirement_operations where idempotency_key='dae00000-0000-4000-8000-000000000006';").trim(), "0");
  assert.equal(sql(`select count(*) from private.questionnaire_rule_retirement_events where request_id='${secondRequest.request.requestId}'::uuid and action='approve';`).trim(), "0");
  console.log("Native approval authority revoked while waiting: 42501, no retirement/receipt committed.");

  const scopeReadHolder = await hold(`questionnaire-rule-scope:${org}:${branch}:spmsq`);
  const scopeDeniedRead = concurrentSql(readSql("native_rule_revoked_scope_read"));
  try {
    probes.push({ name: "read_authority_revoked_while_waiting_for_scope", waiters: await waitForBlocked(["native_rule_revoked_scope_read"]) });
    sql("update private.staff_google_access_grants set enabled=false where allowed_user_id='da100000-0000-4000-8000-000000000001';");
  } finally { await scopeReadHolder.release(); }
  const scopeRevoked = await scopeDeniedRead;
  assert.notEqual(scopeRevoked.status, 0);
  assert.match(scopeRevoked.stderr, /42501/);
  assert.doesNotMatch(scopeRevoked.stdout, /^READ=/m);
  sql("update private.staff_google_access_grants set enabled=true where allowed_user_id='da100000-0000-4000-8000-000000000001';");
  console.log("Native read authority revoked while waiting for scope lock: 42501 before snapshot/audit.");

  // Read authorization is also checked after its audit wait; no stale scope
  // snapshot may escape in a successful result after the account is disabled.
  sql(`create function native_rule_test.pause_read() returns trigger language plpgsql as $$begin
    if new.table_name='questionnaire_rule_retirement' and new.action='select' then perform pg_advisory_xact_lock(hashtextextended('native-rule-read-audit-pause',0));end if;return new;end;$$;
    create trigger native_rule_pause_read before insert on public.audit_events for each row execute function native_rule_test.pause_read();`);
  const readHolder = await hold("native-rule-read-audit-pause");
  const readAuditsBefore = sql("select count(*) from public.audit_events where table_name='questionnaire_rule_retirement' and action='select';").trim();
  const deniedRead = concurrentSql(`begin;set local application_name='native_rule_revoked_read';select set_config('request.jwt.claims',${quote(jwt1)},true);set local role authenticated;select 'READ='||public.read_questionnaire_rule_retirement('${org}'::uuid,'${branch}'::uuid,'${activationId}'::uuid)::text;commit;`);
  try {
    probes.push({ name: "read_scope_revoked_after_audit_wait", waiters: await waitForBlocked(["native_rule_revoked_read"]) });
    sql("update private.staff_google_access_grants set enabled=false where allowed_user_id='da100000-0000-4000-8000-000000000001';");
  } finally { await readHolder.release(); }
  const revokedRead = await deniedRead;
  assert.notEqual(revokedRead.status, 0);
  assert.match(revokedRead.stderr, /42501/);
  assert.doesNotMatch(revokedRead.stdout, /^READ=/m);
  assert.equal(sql("select count(*) from public.audit_events where table_name='questionnaire_rule_retirement' and action='select';").trim(), readAuditsBefore);
  console.log("Native read authority revoked during audit wait: 42501, no successful scope snapshot.");
  sql("drop trigger native_rule_pause_read on public.audit_events;drop trigger native_rule_pause_retirement on private.questionnaire_rule_retirements;drop schema native_rule_test cascade;");
  await writeFile(join(runtime, "evidence.json"), JSON.stringify({ engine, compiledMigrations: migrations.length, suites, probes, retirementReadSnapshotConsistent: true, oldCatalogExactReplay: true, replacedAuthorizationFunctions: 0, hostedConnections: 0 }, null, 2));
  console.log(`Native questionnaire governance verified; evidence: ${join(runtime, "evidence.json")}.`);
} catch (error) { testFailure = error; throw error; } finally {
  const cleanupErrors = [];
  for (const holder of holders) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors, stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
