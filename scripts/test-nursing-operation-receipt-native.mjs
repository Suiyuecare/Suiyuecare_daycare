// Exact current migrations; real synthetic Google/session/AMR admission. No
// hosted connection, predicate replacement, clinical replay or external network.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17 bin directory (minor >= 11); no hosted URL.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-nursing-operation-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55463", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
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
  assert.ok(line, `Missing synthetic ${key} marker`); return line.slice(key.length + 1);
};
const connection = () => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  const completed = new Promise((done) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ status: -1, stdout, stderr: error.message }));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  return { child, completed, output: () => stdout };
};
const concurrent = (input) => { const current = connection(); current.child.stdin.end(input); return current.completed; };
const ready = async (current) => {
  const deadline = Date.now() + 10_000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned backend did not become ready.");
    await new Promise((done) => setTimeout(done, 25));
  }
  return Number(marker(current.output(), "READY"));
};
const holders = new Set();
const hold = async (statement) => {
  const current = connection(); let released = false;
  const holder = { release: async () => {
    if (released) return; released = true; current.child.stdin.end("commit;\n");
    const result = await current.completed; holders.delete(holder); assert.equal(result.status, 0, result.stderr);
  } };
  holders.add(holder);
  current.child.stdin.write(`begin;set local application_name='native_nursing_receipt_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  holder.pid = await ready(current); return holder;
};
const waitForBlocked = async (name, holderPid) => {
  assert.match(name, /^native_nursing_receipt_[a-z_]+$/);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'applicationName',application_name,
      'waitEvent',wait_event,'blockers',pg_blocking_pids(pid))),'[]'::jsonb) from pg_stat_activity
      where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === 1 && rows[0].blockers.includes(holderPid)) return rows;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Actual blocked independent backend not observed: ${name}.`);
};
const org = "db500000-0000-4000-8000-000000000001";
const branch = "db600000-0000-4000-8000-000000000001";
const client = "dbb00000-0000-4000-8000-000000000001";
const actor = "db100000-0000-4000-8000-000000000001";
const session = "db300000-0000-4000-8000-000000000001";
const nonce = "dbf00000-0000-4000-8000-000000000001";
const requiredMigration = "20260926170455_nursing_assessment_operation_receipt.sql";
const evidence = { syntheticOnly: true, hostedConnections: 0, externalNetworkRequests: 0, authorizationReplacements: 0, probes: [], assertions: [] };
const counts = () => JSON.parse(sql(`select jsonb_build_object('versions',(select count(*) from public.nursing_assessment_versions),
  'operations',(select count(*) from private.nursing_assessment_operations),'reauth',(select count(*) from private.reauth_events),
  'challenges',(select count(*) from private.reauth_challenges),'clinicalAudits',(select count(*) from public.audit_events where table_name='public.nursing_assessment_versions'),
  'lookupAudits',(select count(*) from public.audit_events where table_name='nursing_assessment_operation_receipt'));`).trim());
const jsonResult = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "RESULT")); };
const denied = (result, code = "42501") => {
  assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(`\\b${code}\\b`)); assert.doesNotMatch(result.stdout, /^RESULT=/m);
};
let started = false; let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim();
  const match = engine.match(/^postgres \(PostgreSQL\) 17\.(\d+)(?:\s|$)/);
  assert.ok(match && Number(match[1]) >= 11, "PostgreSQL 17.11 or later PostgreSQL 17 security minor required");
  evidence.engine = engine;
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c timezone=UTC -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c max_wal_size=128MB -c min_wal_size=32MB`, "-w", "start"]); started = true;
  sql(bootstrapSql);
  sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 144, "This narrow receipt evidence requires the frozen 144-migration baseline");
  assert.equal(migrations.at(-1), requiredMigration);
  evidence.migrations = [];
  for (const name of migrations) {
    const source = await readFile(join(root, "supabase/migrations", name), "utf8");
    try { sql(source); } catch (error) { throw new Error(`Exact migration ${name}: ${error.message}`); }
    evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const source = await readFile(join(root, "supabase/tests/nursing_operation_receipt.test.sql"), "utf8");
  const output = sql(source); const expected = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]);
  const actual = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
  assert.equal(actual, expected, output); assert.doesNotMatch(output, /^not ok \d+\b|^# Looks like/m);
  evidence.pgTapAssertions = actual; evidence.compiledMigrations = migrations.length;
  console.log(`${engine}; exact ${migrations.length}/${migrations.length} migrations; ${actual}/${expected} pgTAP assertions.`);

  // Reuse only the complete approved Auth fixture prefix, never any predicate
  // substitutions or assertions from the older nursing test.
  const admission = await readFile(join(root, "supabase/tests/nursing_approved_staff_admission.test.sql"), "utf8");
  const fixture = admission.slice(0, admission.indexOf("\nselect ok(")).replace(/select\s+plan\(\d+\);/i, "");
  assert.ok(fixture.includes("private.staff_google_access_grants") && fixture.includes("auth.mfa_amr_claims"));
  const setup = sql(`${fixture}\nselect pg_temp.nursing_login(1);select 'JWT='||current_setting('request.jwt.claims');
    select 'CONTENT='||v::text from nursing_admission_data where k='content';commit;`);
  const jwt = marker(setup, "JWT"); const content = JSON.parse(marker(setup, "CONTENT"));
  const transaction = (call, name = "native_nursing_receipt_read", claims = jwt) => {
    assert.match(name, /^native_nursing_receipt_[a-z_]+$/);
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claims)},true);set local role authenticated;${call};commit;`;
  };
  const write = (key, request) => `select 'RESULT='||public.mutate_nursing_assessment('${org}','${branch}',${quote(JSON.stringify(request))}::jsonb,'${key}')::text`;
  const lookup = (key, action = "create_draft") => `select 'RESULT='||public.nursing_assessment_operation_receipt('${org}','${branch}','${client}',${quote(action)},'${key}','${nonce}')::text`;
  const actions = ["create_draft", "revise_draft", "sign", "correct"];
  const operations = [];
  const timezoneRed = (key, timezone) => JSON.parse(sql(`set time zone ${quote(timezone)};
    select jsonb_build_object('resultMismatch',o.receipt->'result' is distinct from private.nursing_version_json(v),
      'hashMismatch',v.content_hash is distinct from encode(sha256(convert_to((to_jsonb(v)-'content_hash')::text,'UTF8')),'hex'))
    from private.nursing_assessment_operations o join public.nursing_assessment_versions v on v.id=o.version_id
    where o.actor_user_id='${actor}' and o.idempotency_key='${key}';`).trim());
  for (const [index, action] of actions.entries()) {
    const key = `dbd00000-0000-4000-8000-${String(index + 11).padStart(12, "0")}`;
    const previous = operations.at(-1)?.receipt.result;
    const request = previous ? { action, clientId: client, assessmentKey: previous.assessmentKey,
      previousVersionId: previous.versionId, expectedVersion: previous.version, expectedContentHash: previous.contentHash } : { action, clientId: client };
    if (action !== "sign") request.content = content;
    if (action === "correct") request.correctionReason = "Synthetic independently verified correction";
    const receipt = jsonResult(await concurrent(transaction(write(key, request), "native_nursing_receipt_write")));
    const result = jsonResult(await concurrent(transaction(lookup(key, action))));
    assert.equal(result.schemaVersion, 1); assert.equal(result.status, "committed"); assert.equal(result.nonce, nonce);
    assert.equal(result.actorUserId, actor); assert.equal(result.clientId, client); assert.equal(result.persisted, true); assert.equal(result.demo, false);
    assert.deepEqual(result.receipt, receipt); assert.equal(result.receipt.replayed, false);
    assert.deepEqual(timezoneRed(key, "Asia/Taipei"), { resultMismatch: true, hashMismatch: true }, "Old raw session-timezone comparison must reproduce RED");
    assert.deepEqual(jsonResult(await concurrent(transaction(`set local time zone 'Asia/Taipei';${lookup(key, action)}`))).receipt, receipt,
      "UTC-written original receipt must survive Taipei read with raw bytes/hash preserved");
    operations.push({ action, key, request, receipt });
  }
  const taipeiOperations = [];
  for (const [index, action] of actions.entries()) {
    const key = `dbd00000-0000-4000-8000-${String(index + 21).padStart(12, "0")}`;
    const previous = taipeiOperations.at(-1)?.result;
    const request = previous ? { action, clientId: client, assessmentKey: previous.assessmentKey,
      previousVersionId: previous.versionId, expectedVersion: previous.version, expectedContentHash: previous.contentHash } : { action, clientId: client };
    if (action !== "sign") request.content = content;
    if (action === "correct") request.correctionReason = "Synthetic Taipei-written correction";
    const receipt = jsonResult(await concurrent(transaction(`set local time zone 'Asia/Taipei';${write(key, request)}`, "native_nursing_receipt_taipei_write")));
    assert.deepEqual(timezoneRed(key, "UTC"), { resultMismatch: true, hashMismatch: true }, "Old cross-timezone comparison must reproduce reverse RED");
    assert.deepEqual(jsonResult(await concurrent(transaction(lookup(key, action)))).receipt, receipt,
      "Taipei-written original receipt must survive UTC read with raw bytes/hash preserved");
    taipeiOperations.push(receipt);
  }
  const stable = counts(); assert.equal(stable.versions, 8); assert.equal(stable.operations, 8); assert.equal(stable.reauth, 3);
  evidence.assertions.push("All four actions both UTC-to-Taipei and Taipei-to-UTC preserve original raw receipt/timestamp/content hash and compare the same persisted instant");
  evidence.assertions.push("Four genuine approved-nurse writes return the exact original immutable receipt by read-only lookup, never replayed");
  // Insert only rolled-back malformed synthetic operation envelopes referencing
  // an existing immutable version. Never disable append-only/RLS/Auth guards.
  const malformedKey = "dbd00000-0000-4000-8000-000000000088";
  const malformedId = "dbf10000-0000-4000-8000-000000000088";
  const base = operations[2].receipt;
  for (const [name, corrupt, badHash] of [
    ["different_created_instant", (r) => ({ ...r, result: { ...r.result, createdAt: "2000-01-01T00:00:00+00:00" } }), false],
    ["different_signed_instant", (r) => ({ ...r, result: { ...r.result, signedAt: "2000-01-01T00:00:00+00:00" } }), false],
    ["offsetless_timestamp", (r) => ({ ...r, result: { ...r.result, createdAt: "2026-09-01T12:00:00" } }), false],
    ["invalid_timestamp", (r) => ({ ...r, result: { ...r.result, createdAt: "2026-13-01T12:00:00+00:00" } }), false],
    ["missing_signed_evidence", (r) => ({ ...r, result: { ...r.result, signedAt: null } }), false],
    ["different_content", (r) => ({ ...r, result: { ...r.result, contentHash: "1".repeat(64) } }), false],
    ["different_operation", (r) => ({ ...r, operationId: nonce }), false],
    ["different_actor", (r) => ({ ...r, actorUserId: "db100000-0000-4000-8000-000000000002" }), false],
    ["different_key", (r) => ({ ...r, idempotencyKey: nonce }), false],
    ["replay_flag", (r) => ({ ...r, replayed: true }), false],
    ["different_request_hash", (r) => r, true],
  ]) {
    const malformed = corrupt({ ...base, operationId: malformedId, idempotencyKey: malformedKey });
    const before = counts();
    const result = await concurrent(`begin;set local application_name='native_nursing_receipt_malformed';
      insert into private.nursing_assessment_operations(id,actor_user_id,idempotency_key,request_hash,version_id,receipt)
      select '${malformedId}','${actor}','${malformedKey}',${badHash ? "repeat('0',64)" : "request_hash"},version_id,${quote(JSON.stringify(malformed))}::jsonb
      from private.nursing_assessment_operations where actor_user_id='${actor}' and idempotency_key='${operations[2].key}';
      select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;${lookup(malformedKey, "sign")};commit;`);
    denied(result, "23514"); assert.deepEqual(counts(), before, `Malformed ${name} fixture and lookup audit must wholly roll back`);
  }
  evidence.assertions.push("Eleven malformed envelope/hash/raw-timestamp cases reject 23514 with no guard overrides and no persisted fixture/audit/clinical change");
  // The same actor with only current read scope still reads their own history.
  // Write-role/current-signing permission is not smuggled into this projection.
  sql(`begin;delete from public.membership_roles where membership_id='db700000-0000-4000-8000-000000000001';
    insert into public.membership_roles(membership_id,role_id) select 'db700000-0000-4000-8000-000000000001',id
      from public.roles where is_system and role_key='organization_manager';commit;`);
  assert.deepEqual(jsonResult(await concurrent(transaction(lookup(operations[2].key, "sign")))).receipt, operations[2].receipt);
  denied(await concurrent(transaction(write("dbd00000-0000-4000-8000-000000000077", { action: "create_draft", clientId: client, content }), "native_nursing_receipt_readonly_manager")));
  sql(`begin;delete from public.membership_roles where membership_id='db700000-0000-4000-8000-000000000001';
    insert into public.membership_roles(membership_id,role_id) select 'db700000-0000-4000-8000-000000000001',id
      from public.roles where is_system and role_key='nurse';commit;`);
  assert.equal(counts().versions, stable.versions); assert.equal(counts().operations, stable.operations);
  evidence.assertions.push("Own historical signature readable after nurse becomes read-only manager; manager still cannot create nursing draft");
  const signed = operations[2];
  sql(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
    created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
    values('db800000-0000-4000-8000-000000000098','${actor}','${session}',repeat('e',64),'db900000-0000-4000-8000-000000000098',
    clock_timestamp()-interval '18 minutes','synthetic-before-expired',clock_timestamp()-interval '17 minutes',clock_timestamp()-interval '12 minutes',
    clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '16 minutes','synthetic-after-expired','totp',clock_timestamp()-interval '16 minutes');
    update private.reauth_events set challenge_id='db800000-0000-4000-8000-000000000098',
      verified_at=(select factor_verified_at from private.reauth_challenges where id='db800000-0000-4000-8000-000000000098') where user_id='${actor}';`);
  assert.deepEqual(jsonResult(await concurrent(transaction(lookup(signed.key, "sign")))).receipt, signed.receipt);
  denied(await concurrent(transaction(write(signed.key, signed.request), "native_nursing_receipt_stale_signature")));
  assert.equal(counts().versions, stable.versions); assert.equal(counts().reauth, stable.reauth);
  evidence.assertions.push("Expired consumed signing verification permits historical receipt read but still denies original signature replay");

  // Hold an actual uncommitted original write after it returned its receipt.
  // Another MVCC reader must report only not_found and must not wait/replay.
  const inFlightKey = "dbd00000-0000-4000-8000-000000000099";
  const writer = connection(); let writerReleased = false;
  const writerHolder = { release: async () => {
    if (writerReleased) return; writerReleased = true; writer.child.stdin.end("commit;\n");
    const result = await writer.completed; holders.delete(writerHolder); assert.equal(result.status, 0, result.stderr);
  } }; holders.add(writerHolder);
  writer.child.stdin.write(transaction(write(inFlightKey, { action: "create_draft", clientId: client, content }), "native_nursing_receipt_inflight").replace(/;commit;$/, ";select 'READY='||pg_backend_pid();\n"));
  const writerPid = await ready(writer); const beforeInflight = counts();
  const absent = jsonResult(await concurrent(transaction(lookup(inFlightKey), "native_nursing_receipt_inflight_read")));
  assert.equal(absent.status, "not_found"); assert.equal(absent.persisted, false); assert.equal(absent.receipt, null);
  assert.equal(counts().versions, beforeInflight.versions); assert.equal(counts().operations, beforeInflight.operations);
  await writerHolder.release();
  const observed = jsonResult(await concurrent(transaction(lookup(inFlightKey))));
  assert.equal(observed.status, "committed"); assert.equal(observed.idempotencyKey, inFlightKey);
  assert.deepEqual(observed.receipt, JSON.parse(marker(writer.output(), "RESULT")));
  assert.equal(counts().versions, stable.versions + 1); assert.equal(counts().operations, stable.operations + 1);
  evidence.probes.push({ name: "uncommitted_original_write_not_found_then_same_key_committed", writerPid, noReplayOrChangedKey: true });

  // The only test hook delays a sanitized audit insert. No authorization, RLS,
  // MFA, mutation or admission function is replaced. Observe the actual blocked
  // backend before committing the concurrent revocation in another connection.
  sql(`create schema native_nursing_receipt_test;
    create function native_nursing_receipt_test.pause_lookup_audit() returns trigger language plpgsql set search_path='' as $$begin
      if new.table_name='nursing_assessment_operation_receipt' then perform pg_advisory_xact_lock(hashtextextended('native-nursing-receipt-audit',0));end if;return new;end;$$;
    create trigger native_nursing_receipt_pause before insert on public.audit_events for each row execute function native_nursing_receipt_test.pause_lookup_audit();`);
  const roleRead = `from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='nursing_assessments.read'`;
  for (const [kind, revoke, restore] of [
    ["assignment", "update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where id='dbc00000-0000-4000-8000-000000000001'", "update public.client_assignments set ends_at=null where id='dbc00000-0000-4000-8000-000000000001'"],
    ["approval", `update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}'`, `update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}'`],
    ["session", `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${session}'`, `update auth.sessions set not_after=null where id='${session}'`],
    ["permission", `update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour' ${roleRead}`, `update public.role_permissions rp set granted_at=clock_timestamp()-interval '1 day' ${roleRead}`],
    ["membership", `update public.memberships set status='ended',ends_at=clock_timestamp() where id='db700000-0000-4000-8000-000000000001'`, `update public.memberships set status='active',ends_at=null where id='db700000-0000-4000-8000-000000000001'`],
  ]) {
    const before = counts(); const holder = await hold("select pg_advisory_xact_lock(hashtextextended('native-nursing-receipt-audit',0))");
    const name = `native_nursing_receipt_revoke_${kind}`;
    const pending = concurrent(transaction(lookup(signed.key, "sign"), name));
    try {
      const waiters = await waitForBlocked(name, holder.pid); assert.equal(waiters[0].waitEvent, "advisory");
      sql(`begin;${revoke};commit;`);
      evidence.probes.push({ name: `${kind}_revoked_after_actual_lookup_audit_wait`, holderPid: holder.pid, waiters, revokedBeforeReleased: true });
    } finally { await holder.release(); }
    denied(await pending); assert.deepEqual(counts(), before, "Entire denied lookup including its audit must roll back without clinical/reauth writes");
    sql(`begin;${restore};commit;`);
  }
  sql("drop trigger native_nursing_receipt_pause on public.audit_events;");
  assert.deepEqual(jsonResult(await concurrent(transaction(lookup(signed.key, "sign")))).receipt, signed.receipt);
  evidence.assertions.push("Five observed backend audit waits with committed assignment/approval/session/read-permission/membership revocation all reject 42501 and roll back their audit; no clinical or MFA write");
  assert.equal(sql("select count(*) from public.audit_events where table_name='nursing_assessment_operation_receipt' and (select count(*) from jsonb_object_keys(metadata))<>3;").trim(), "0");
  evidence.finalCounts = counts();
  evidence.limitations = ["Local SQL-native synthetic Auth only, not hosted Auth/PostgREST/browser acceptance", "not_found never proves failure of a prior request", "Final read-authority check is not full authority-row serialization through COMMIT", "No official nursing questionnaire/scoring claim or deployment is established"];
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Nursing own-operation lookup verified; evidence: ${join(runtime, "evidence.json")}.`);
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  if (testFailure) {
    try { await writeFile(join(runtime, "failure.json"), JSON.stringify({ syntheticOnly: true, error: testFailure.message, evidence }, null, 2)); }
    catch (error) { cleanupErrors.push(error); }
  }
  await cleanupNativeData({ started, testFailure, cleanupErrors,
    stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
