// Real PostgreSQL / Unix socket / synthetic approved Google identities only.
// Authorization predicates and immutable business guards are never replaced.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17 bin directory. No hosted URL is accepted.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-referral-admission-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55471", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const execute = (file, argv, input) => spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
const run = (file, argv, input) => {
  const result = execute(file, argv, input);
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), args, input);
const quote = (value) => value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const marker = (output, name) => { const row = output.split("\n").find((line) => line.startsWith(`${name}=`)); assert.ok(row, `Missing ${name}`); return row.slice(name.length + 1); };
const concurrent = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr })); child.stdin.end(input);
});
const holders = new Set();
const hold = async (statement) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let resolveReady; let rejectReady; let stdout = ""; let stderr = ""; let released = false;
  const ready = new Promise((a, b) => { resolveReady = a; rejectReady = b; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; if (/^READY=\d+$/m.test(stdout)) resolveReady(Number(marker(stdout, "READY"))); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { rejectReady(error); resolveCompletion(-1); });
    child.on("close", (status) => { rejectReady(new Error("Owned lock holder ended before readiness.")); resolveCompletion(status); });
  });
  const holder = { release: async () => { if (released) return; released = true; child.stdin.end("commit;\n"); const status = await completion; holders.delete(holder); assert.equal(status, 0, stderr); } };
  holders.add(holder); const timer = setTimeout(() => rejectReady(new Error("Owned lock readiness timed out.")), 10_000);
  child.stdin.write(`begin;${statement};select 'READY='||pg_backend_pid();\n`);
  try { holder.pid = await ready; return holder; } finally { clearTimeout(timer); }
};
const waitForBlocked = async (name, count = 1) => {
  assert.match(name, /^native_referral_[a-z_]+$/); const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'name',application_name,'blockers',pg_blocking_pids(pid))),'[]'::jsonb) from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === count && new Set(rows.map((row) => row.pid)).size === count) return rows;
    await new Promise((resume) => setTimeout(resume, 25));
  }
  throw new Error(`Expected ${count} genuinely blocked independent backends: ${name}`);
};
const waitForDatabase = async (predicate) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (sql(`select (${predicate});`).trim() === "t") return; await new Promise((resume) => setTimeout(resume, 25)); }
  throw new Error("Wall-clock database boundary was not observed.");
};
const receipt = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "RECEIPT")); };
const denied = (result, state = "42501") => { assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(state)); assert.doesNotMatch(result.stdout, /^RECEIPT=/m); };
const probes = [];
const org = "dc500000-0000-4000-8000-000000000001";
const branch = "dc600000-0000-4000-8000-000000000001";
const actor = "dc100000-0000-4000-8000-000000000001";
const session = "dc300000-0000-4000-8000-000000000001";
const client = "dcb00000-0000-4000-8000-000000000001";
const assignment = "dcc00000-0000-4000-8000-000000000001";
const key = (n) => `dcd00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const counts = () => JSON.parse(sql(`select jsonb_build_object('events',(select count(*) from public.referral_events),
  'operations',(select count(*) from private.referral_operations),'notifications',(select count(*) from public.referral_notification_outbox),
  'audits',(select count(*) from public.audit_events where table_name in('public.referral_events','public.referral_notification_outbox')))::text;`).trim());
let started = false; let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim(); assert.match(engine, /PostgreSQL\) 17\./);
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]); started = true;
  sql(bootstrapSql);
  sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  const admissionMigrations = migrations.filter((name) => name.endsWith("_referral_approved_staff_admission.sql")); assert.equal(admissionMigrations.length, 1);
  const newMigration = admissionMigrations[0];
  // Later migrations can depend on this additive module. Historical RED uses
  // only its predecessors; latest GREEN then compiles the remainder in order.
  for (const name of migrations.filter((name) => name < newMigration)) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const source = await readFile(join(root, "supabase/tests/referral_approved_staff_admission.test.sql"), "utf8");
  const boundary = source.indexOf("\nselect ok("); assert.ok(boundary > 0);
  const fixture = source.slice(0, boundary).replace(/select\s+plan\(\d+\);/i, "");
  const snapshotRpc = `public.referral_management_snapshot('${org}','${branch}',null,'all',null,'all',null,null,null)`;
  const baseline = execute(join(binaries, "psql"), args, `${fixture}\nselect pg_temp.referral_login(1);set local role authenticated;
    select 'ADMITTED='||public.is_staff_login_allowed();select * from ${snapshotRpc};rollback;`);
  assert.match(baseline.stdout, /^ADMITTED=true$/m); denied(baseline); assert.match(baseline.stderr, /referral snapshot is not permitted/);
  console.log("Baseline RED: genuinely approved non-CEO social worker cannot read Page39 (42501).");
  for (const name of migrations.filter((name) => name >= newMigration)) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  const expected = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]); assert.ok(expected > 0);
  const output = sql(source); const actual = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
  assert.equal(actual, expected); assert.doesNotMatch(output, /^not ok \d+\b|^# Looks like/m);
  console.log(`Latest-schema native GREEN: ${migrations.length} exact migrations, ${actual}/${expected} pgTAP assertions.`);
  const setup = sql(`${fixture}\nselect pg_temp.referral_login(1);select 'JWT='||current_setting('request.jwt.claims');
    select 'DATE='||date_trunc('minute',clock_timestamp()-interval '1 day');commit;`);
  let jwt = marker(setup, "JWT"); const claims = JSON.parse(jwt); const referralDate = marker(setup, "DATE");
  const authenticated = (body, name = "native_referral_control", claim = jwt) => {
    assert.match(name, /^native_referral_[a-z_]+$/);
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claim)},true);set local role authenticated;${body};commit;`;
  };
  const mutation = (input, operationKey) => `select 'RECEIPT='||row_to_json(result)::text from public.mutate_referral_management(
    '${org}','${branch}',${quote(input.action)},${quote(input.referralKey)}::uuid,${quote(input.previousEventId)}::uuid,
    ${input.expectedSequence ?? "null"},${quote(input.clientId)}::uuid,${quote(input.receivingUnitState)},${quote(input.receivingUnitCode)},
    ${quote(input.receivingUnitName)},${quote(input.referralDate)}::timestamptz,${quote(input.referralReason)},${quote(input.entryContent)},
    ${quote(input.correctionReason)},${quote(input.correctsEventId)}::uuid,'${operationKey}') result`;
  const write = (name, operationKey, input) => concurrent(authenticated(mutation(input, operationKey), name));
  const create = { action: "create", clientId: client, receivingUnitState: "manual_unstandardized", receivingUnitCode: "SYNTHETIC",
    receivingUnitName: "Synthetic native receiving unit", referralDate, referralReason: "Synthetic human referral reason" };
  // Genuine MFA admission uses AAL1; no direct clinical path is granted AAL1.
  assert.equal(marker(sql(authenticated("select 'BEGIN='||public.can_begin_staff_mfa()", "native_referral_begin", JSON.stringify({ ...claims, aal: "aal1" }))), "BEGIN"), "true");
  const issue = (n) => { const challenge = `dc800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const nonceHash = n.toString(16).padStart(64, "0");
    sql(`begin;set local role service_role;select * from public.issue_aal2_reauth_challenge('${challenge}','${actor}','${session}','${nonceHash}','${key(900 + n)}',clock_timestamp()-interval '60 seconds','synthetic-before',300);commit;`);
    const timestamp = Number(sql("select floor(extract(epoch from clock_timestamp()));").trim());
    sql(`update auth.mfa_amr_claims set updated_at=to_timestamp(${timestamp}) where session_id='${session}' and authentication_method='totp';`);
    jwt = JSON.stringify({ ...claims, iat: timestamp, amr: claims.amr.map((entry) => entry.method === "totp" ? { ...entry, timestamp } : entry) });
    return { challenge, timestamp, body: `select public.record_aal2_reauth('${challenge}','${nonceHash}')` };
  };
  const acquired = issue(99);
  assert.equal(sql(authenticated(acquired.body)).trim().split("\n").at(-1), "t");
  const proof = JSON.parse(marker(sql(authenticated(`select 'EVIDENCE='||public.referral_recent_aal2_evidence('${org}','${branch}')::text`)), "EVIDENCE"));
  assert.deepEqual(Object.keys(proof).sort(), ["actorUserId", "branchId", "organizationId", "verifiedAt"]);
  assert.equal(proof.actorUserId, actor); assert.equal(Date.parse(proof.verifiedAt), acquired.timestamp * 1000);
  assert.deepEqual(JSON.parse(marker(sql(authenticated("select 'GENERIC='||jsonb_build_object('active',private.is_active_user(),'recent',public.has_recent_aal2(15))::text")), "GENERIC")), { active: false, recent: false });
  assert.equal(sql(authenticated(acquired.body)).trim().split("\n").at(-1), "f");
  assert.equal(marker(sql(authenticated(`select 'CLIENTS='||jsonb_array_length(client_options) from ${snapshotRpc}`)), "CLIENTS"), "1");

  const operationHolder = await hold(`select pg_advisory_xact_lock(hashtextextended('referral-management-operation:${actor}:${key(1)}',39))`);
  const duplicateA = write("native_referral_same_key", key(1), create); const duplicateB = write("native_referral_same_key", key(1), create);
  try { probes.push({ name: "same_key_two_independent_backends", waiters: await waitForBlocked("native_referral_same_key", 2) }); } finally { await operationHolder.release(); }
  const duplicate = [receipt(await duplicateA), receipt(await duplicateB)];
  assert.equal(duplicate[0].event_id, duplicate[1].event_id); assert.deepEqual(duplicate.map((entry) => entry.replayed).sort(), [false, true]);
  denied(await write("native_referral_wrong_body", key(1), { ...create, referralReason: "Changed synthetic payload" }), "23505");
  let last = duplicate[0]; const first = last;
  const continuation = (action, input = {}) => ({ action, referralKey: last.referral_key, previousEventId: last.event_id, expectedSequence: last.event_sequence, ...input });
  for (const [index, action] of ["submit", "register_received", "respond", "close", "correct"].entries()) {
    const request = continuation(action, { entryContent: `Synthetic ${action} human evidence`, ...(action === "correct" ? { correctsEventId: first.event_id, correctionReason: "Synthetic narrow correction reason" } : {}) });
    let operationKey = key(index + 2); let result;
    if (index === 0) {
      const streamHolder = await hold(`select pg_advisory_xact_lock(hashtextextended('referral-management-stream:${org}:${branch}:${last.referral_key}',39))`);
      const firstSubmit = write("native_referral_same_predecessor", operationKey, request); const secondSubmit = write("native_referral_same_predecessor", key(22), request);
      try { probes.push({ name: "different_keys_same_predecessor_one_success", waiters: await waitForBlocked("native_referral_same_predecessor", 2) }); } finally { await streamHolder.release(); }
      const attempts = [await firstSubmit, await secondSubmit]; assert.equal(attempts.filter((entry) => entry.status === 0).length, 1);
      const winner = attempts.findIndex((entry) => entry.status === 0); denied(attempts[1 - winner], "40001"); result = receipt(attempts[winner]); operationKey = winner === 0 ? operationKey : key(22);
    } else result = receipt(await write("native_referral_full_flow", operationKey, request));
    assert.equal(result.event_sequence, index + 2); assert.equal(result.previous_event_id, last.event_id);
    assert.equal(result.referral_status, ["submitted", "received", "responded", "closed", "closed"][index]);
    const replay = receipt(await write("native_referral_exact_replay", operationKey, request)); assert.deepEqual({ ...replay, replayed: false }, result); last = result;
  }
  const expectedCounts = counts(); assert.equal(expectedCounts.events, 6); assert.equal(expectedCounts.operations, 6); assert.equal(expectedCounts.notifications, 6); assert.equal(expectedCounts.audits, 12);
  // Every exact replay must check current assignment and admission after the
  // real operation-key lock, not only its previously committed receipt.
  for (const [name, revoke, restore] of [
    ["grant", `update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}'`, `update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}'`],
    ["session", `update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='${session}'`, `update auth.sessions set not_after=null where id='${session}'`],
    ["assignment", `update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='${assignment}'`, `update public.client_assignments set ends_at=null where id='${assignment}'`],
  ]) {
    const held = await hold(`select pg_advisory_xact_lock(hashtextextended('referral-management-operation:${actor}:${key(1)}',39))`);
    const pending = write(`native_referral_revoke_${name}`, key(1), create);
    try { probes.push({ name: `${name}_revoked_during_original_key_wait`, waiters: await waitForBlocked(`native_referral_revoke_${name}`) }); sql(`${revoke};`); } finally { await held.release(); }
    denied(await pending); assert.deepEqual(counts(), expectedCounts); sql(`${restore};`);
  }
  sql(`create schema native_referral_test;create function native_referral_test.pause_audit() returns trigger language plpgsql set search_path='' as $$begin
    if new.table_name='public.referral_events' then perform pg_advisory_xact_lock(hashtextextended('native-referral-audit-pause',0));end if;return new;end;$$;
    create trigger native_referral_pause_audit before insert on public.audit_events for each row execute function native_referral_test.pause_audit();`);
  const auditHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-referral-audit-pause',0))");
  const auditWrite = write("native_referral_assignment_audit", key(20), create);
  try { probes.push({ name: "assignment_revoked_after_clinical_event_insert", waiters: await waitForBlocked("native_referral_assignment_audit") }); sql(`update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='${assignment}';`); } finally { await auditHolder.release(); }
  denied(await auditWrite); assert.deepEqual(counts(), expectedCounts);
  sql(`update public.client_assignments set ends_at=null where id='${assignment}';drop trigger native_referral_pause_audit on public.audit_events;`);
  // A row lock forces evidence to become stale after the predicate's first
  // evaluation. Observe the actual DB clock boundary instead of sleep-only.
  const nearExpiry = Number(sql("select floor(extract(epoch from clock_timestamp()-interval '898 seconds')); ").trim());
  const originalJwt = jwt;
  sql(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
    values('dc800000-0000-4000-8000-000000000098','${actor}','${session}',repeat('e',64),'${key(998)}',to_timestamp(${nearExpiry}-2),'synthetic-old',to_timestamp(${nearExpiry}-1),to_timestamp(${nearExpiry}+300),to_timestamp(${nearExpiry}),to_timestamp(${nearExpiry}),'synthetic-new','totp',to_timestamp(${nearExpiry}));
    update private.reauth_events set challenge_id='dc800000-0000-4000-8000-000000000098',verified_at=to_timestamp(${nearExpiry}) where user_id='${actor}';
    update auth.mfa_amr_claims set updated_at=to_timestamp(${nearExpiry}) where session_id='${session}' and authentication_method='totp';`);
  jwt = JSON.stringify({ ...JSON.parse(jwt), amr: JSON.parse(jwt).amr.map((entry) => entry.method === "totp" ? { ...entry, timestamp: nearExpiry } : entry) });
  const expiryHolder = await hold("select id from private.reauth_challenges where id='dc800000-0000-4000-8000-000000000098' for update");
  const expiringWrite = write("native_referral_evidence_expiry", key(21), create);
  try { probes.push({ name: "verification_expires_during_real_challenge_lock_wait", waiters: await waitForBlocked("native_referral_evidence_expiry") }); await waitForDatabase(`clock_timestamp()>to_timestamp(${nearExpiry})+interval '15 minutes'`); } finally { await expiryHolder.release(); }
  denied(await expiringWrite); assert.deepEqual(counts(), expectedCounts);
  sql(`update private.reauth_events set challenge_id='${acquired.challenge}',verified_at=to_timestamp(${acquired.timestamp}) where user_id='${actor}';update auth.mfa_amr_claims set updated_at=to_timestamp(${acquired.timestamp}) where session_id='${session}' and authentication_method='totp';`); jwt = originalJwt;
  // Canonical snapshot read can also wait inside its audit. Removing client
  // visibility during that wait must not return the already-computed bundle.
  sql(`create function native_referral_test.pause_snapshot() returns trigger language plpgsql set search_path='' as $$begin
    if new.table_name='referral_management_snapshot' then perform pg_advisory_xact_lock(hashtextextended('native-referral-read-pause',0));end if;return new;end;$$;
    create trigger native_referral_pause_snapshot before insert on public.audit_events for each row execute function native_referral_test.pause_snapshot();`);
  const readAudits = sql("select count(*) from public.audit_events where table_name='referral_management_snapshot';").trim();
  const readHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-referral-read-pause',0))");
  const readPending = concurrent(authenticated(`select 'READ='||row_to_json(result)::text from ${snapshotRpc} result`, "native_referral_snapshot_assignment"));
  try { probes.push({ name: "assignment_revoked_during_complete_snapshot_audit", waiters: await waitForBlocked("native_referral_snapshot_assignment") }); sql(`update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='${assignment}';`); } finally { await readHolder.release(); }
  const rejectedRead = await readPending; denied(rejectedRead); assert.doesNotMatch(rejectedRead.stdout, /^READ=/m);
  assert.equal(sql("select count(*) from public.audit_events where table_name='referral_management_snapshot';").trim(), readAudits);
  assert.deepEqual(counts(), expectedCounts);
  sql(`update public.client_assignments set ends_at=null where id='${assignment}';drop trigger native_referral_pause_snapshot on public.audit_events;`);
  // A selected MFA admission path cannot fall through to a different module
  // which became effective only AFTER evidence insertion. Selection priority
  // is executive -> custom -> nursing -> referral, after the challenge lock.
  sql(`insert into public.membership_roles(membership_id,role_id,assigned_at)
    select 'dc700000-0000-4000-8000-000000000001',id,clock_timestamp()-interval '1 minute' from public.roles where role_key='nurse' and is_system;
    update public.role_permissions set granted_at=clock_timestamp()+interval '1 hour'
      where role_id in(select id from public.roles where role_key='nurse' and is_system)
      and permission_id in(select id from public.permissions where permission_key like 'referral_management.%');
    create function native_referral_test.pause_reauth() returns trigger language plpgsql set search_path='' as $$begin
    if new.user_id='${actor}'::uuid then perform pg_advisory_xact_lock(hashtextextended('native-referral-mfa-pause',0));end if;return new;end;$$;
    create trigger native_referral_pause_reauth after insert or update on private.reauth_events for each row execute function native_referral_test.pause_reauth();`);
  const setPermission = (role, permission, effective) => sql(`update public.role_permissions set granted_at=clock_timestamp()+interval '${effective ? "-1 minute" : "1 hour"}'
    where role_id in(select id from public.roles where role_key=${quote(role)} and is_system) and permission_id in(select id from public.permissions where permission_key=${quote(permission)});`);
  const eligibility = () => JSON.parse(sql(`begin;select set_config('request.jwt.claims',${quote(jwt)},true);select jsonb_build_object(
    'executive',private.is_executive_login_allowed(),'custom',private.has_any_custom_governance_scope(),
    'nursing',private.has_any_nursing_mfa_scope(),'referral',private.has_any_referral_mfa_scope())::text;commit;`).trim().split("\n").at(-1));
  for (const [index, path] of ["referral", "nursing"].entries()) {
    const referralFirst = path === "referral";
    setPermission("case_manager_social_worker", "referral_management.read", referralFirst);
    setPermission("nurse", "nursing_assessments.sign", !referralFirst);
    assert.deepEqual(eligibility(), { executive: false, custom: false, nursing: !referralFirst, referral: referralFirst });
    const fresh = issue(100 + index); const priorChallenge = sql(`select challenge_id from private.reauth_events where user_id='${actor}' and session_id='${session}';`).trim();
    const mfaHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-referral-mfa-pause',0))");
    const mfaWrite = concurrent(authenticated(fresh.body, `native_referral_selected_${path}`));
    try {
      probes.push({ name: `selected_${path}_revoked_after_evidence_insert_without_fallthrough`, waiters: await waitForBlocked(`native_referral_selected_${path}`) });
      setPermission("case_manager_social_worker", "referral_management.read", !referralFirst);
      setPermission("nurse", "nursing_assessments.sign", referralFirst);
      assert.deepEqual(eligibility(), { executive: false, custom: false, nursing: referralFirst, referral: !referralFirst });
    } finally { await mfaHolder.release(); }
    denied(await mfaWrite); assert.equal(sql(`select consumed_at is null from private.reauth_challenges where id='${fresh.challenge}';`).trim(), "t");
    assert.equal(sql(`select challenge_id from private.reauth_events where user_id='${actor}' and session_id='${session}';`).trim(), priorChallenge);
    assert.deepEqual(counts(), expectedCounts);
  }
  setPermission("case_manager_social_worker", "referral_management.read", true); setPermission("nurse", "nursing_assessments.sign", true);
  // Admission can disappear after the challenge was consumed and its event
  // written. Observe that actual boundary; the whole MFA transaction must
  // roll back, including both terminal evidence and the previous receipt.
  for (const [index, [name, revoke, restore]] of [
    ["grant", `update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}'`, `update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}'`],
    ["session", `update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='${session}'`, `update auth.sessions set not_after=null where id='${session}'`],
  ].entries()) {
    const fresh = issue(102 + index);
    const originalEvidence = sql(`select row_to_json(result)::text from private.reauth_events result where user_id='${actor}' and session_id='${session}';`).trim();
    const mfaHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-referral-mfa-pause',0))");
    const mfaWrite = concurrent(authenticated(fresh.body, `native_referral_mfa_${name}`));
    try {
      probes.push({ name: `${name}_revoked_after_mfa_event_insert`, waiters: await waitForBlocked(`native_referral_mfa_${name}`) });
      sql(`${revoke};`);
    } finally { await mfaHolder.release(); }
    denied(await mfaWrite);
    assert.equal(sql(`select consumed_at is null from private.reauth_challenges where id='${fresh.challenge}';`).trim(), "t");
    assert.equal(sql(`select row_to_json(result)::text from private.reauth_events result where user_id='${actor}' and session_id='${session}';`).trim(), originalEvidence);
    assert.deepEqual(counts(), expectedCounts);
    sql(`${restore};`);
  }
  sql(`drop trigger native_referral_pause_reauth on private.reauth_events;update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute'
    where role_id in(select id from public.roles where role_key='nurse' and is_system) and permission_id in(select id from public.permissions where permission_key like 'referral_management.%');`);
  await writeFile(join(runtime, "evidence.json"), JSON.stringify({ engine, migrations: migrations.length, pgTapAssertions: actual,
    baseline: { approvedSocialWorker: true, referralSnapshotSqlState: "42501" }, probes, finalCounts: counts(), mfaAcquisition: true, scopedEvidence: proof,
    authPredicateReplacements: 0, externalConnections: 0, hostedVerification: false, httpLoadTest: false }, null, 2));
  console.log(`Native referral admission: RED/GREEN, exact MFA/full flow and ${probes.length} observed independent-backend probes. Evidence: ${runtime}/evidence.json`);
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = []; for (const holder of holders) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors, stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
