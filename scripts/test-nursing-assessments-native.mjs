// Latest-schema approved nurse admission and real independent-backend guards.
// Synthetic Supabase-owned session/Google/AMR fixtures; no predicate bypass.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17 bin directory; no hosted URL.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-nursing-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55459", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const execute = (file, argv, input) => spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
const run = (file, argv, input) => {
  const result = execute(file, argv, input);
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), args, input);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const concurrent = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
const holders = new Set();
const hold = async (lock) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let readyResolve; let readyReject; let stdout = ""; let stderr = ""; let released = false;
  const ready = new Promise((a, b) => { readyResolve = a; readyReject = b; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; if (/^READY$/m.test(stdout)) readyResolve(); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { readyReject(error); resolveCompletion(-1); });
    child.on("close", (status) => { readyReject(new Error("Owned holder ended before readiness.")); resolveCompletion(status); });
  });
  const holder = { release: async () => {
    if (released) return; released = true; child.stdin.end("commit;\n");
    const status = await completion; holders.delete(holder); assert.equal(status, 0, stderr);
  } };
  holders.add(holder);
  const timeout = setTimeout(() => readyReject(new Error("Owned holder readiness timed out.")), 10_000);
  child.stdin.write(`begin;${lock};select 'READY';\n`);
  try { await ready; return holder; } finally { clearTimeout(timeout); }
};
const wait = async (name, expected = 1) => {
  assert.match(name, /^native_nursing_[a-z_]+$/);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'name',application_name,'blockers',pg_blocking_pids(pid))),'[]'::jsonb)
      from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === expected) return rows;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Expected ${expected} genuinely waiting backends: ${name}.`);
};
const org = "db500000-0000-4000-8000-000000000001";
const branch = "db600000-0000-4000-8000-000000000001";
const actor = "db100000-0000-4000-8000-000000000001";
const newMigration = "20260926113847_nursing_approved_staff_admission.sql";
const counts = () => JSON.parse(sql(`select jsonb_build_object('versions',(select count(*) from public.nursing_assessment_versions),
  'receipts',(select count(*) from private.nursing_assessment_operations),'audits',(select count(*) from public.audit_events where table_name='public.nursing_assessment_versions'))::text;`).trim());
const receipt = (result) => {
  assert.equal(result.status, 0, result.stderr);
  const row = result.stdout.split("\n").find((line) => line.startsWith("RECEIPT=")); assert.ok(row); return JSON.parse(row.slice(8));
};
const denied = (result, code = "42501") => { assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(code)); assert.doesNotMatch(result.stdout, /^RECEIPT=/m); };
const probes = [];
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
  assert.ok(migrations.includes(newMigration), "Required nurse admission migration must exist.");
  // Later additive migrations may depend on the nursing-only definitions.
  // Reproduce RED on the real predecessor schema, then advance in order to
  // the entire latest schema; never apply a dependent successor without it.
  for (const name of migrations.filter((name) => name < newMigration)) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const source = await readFile(join(root, "supabase/tests/nursing_approved_staff_admission.test.sql"), "utf8");
  const fixture = source.slice(0, source.indexOf("\nselect ok(")).replace(/select\s+plan\(\d+\);/i, "");
  const baseline = execute(join(binaries, "psql"), args, `${fixture}\nselect pg_temp.nursing_login(1);set local role authenticated;
    select 'ADMITTED='||public.is_staff_login_allowed();select public.nursing_assessment_snapshot('${org}','${branch}');rollback;`);
  assert.match(baseline.stdout, /^ADMITTED=true$/m); assert.notEqual(baseline.status, 0); assert.match(baseline.stderr, /42501.*nursing snapshot is not permitted/s);
  console.log("Baseline RED: actually approved non-CEO nurse denied by predecessor schema (42501).");
  for (const name of migrations.filter((name) => name >= newMigration)) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  const expected = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]);
  const output = sql(source); const actual = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
  assert.equal(actual, expected); assert.doesNotMatch(output, /^not ok \d+\b|^# Looks like/m);
  console.log(`Native latest schema GREEN: ${migrations.length} migrations; ${actual}/${expected} exact pgTAP admission/MFA/sign assertions.`);
  const setup = sql(`${fixture}\nselect pg_temp.nursing_login(1);select 'JWT='||current_setting('request.jwt.claims');
    select 'INPUT='||v::text from nursing_admission_data where k='create';commit;`);
  let jwt = setup.split("\n").find((line) => line.startsWith("JWT="))?.slice(4);
  const input = JSON.parse(setup.split("\n").find((line) => line.startsWith("INPUT="))?.slice(6)); assert.ok(jwt);
  const write = (name, key, request = input) => concurrent(`begin;set local application_name=${quote(name)};
    select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;
    select 'RECEIPT='||public.mutate_nursing_assessment('${org}','${branch}',${quote(JSON.stringify(request))}::jsonb,'${key}')::text;commit;`);
  const key = "dbd00000-0000-4000-8000-000000000011";
  const operation = await hold(`select pg_advisory_xact_lock(hashtextextended('nursing-operation:${actor}:${key}',0))`);
  const first = write("native_nursing_same_key", key); const second = write("native_nursing_same_key", key);
  probes.push({ name: "same_key_two_independent_backends", waiters: await wait("native_nursing_same_key", 2) });
  await operation.release(); const results = [receipt(await first), receipt(await second)];
  assert.equal(results[0].result.versionId, results[1].result.versionId); assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  assert.deepEqual(counts(), { versions: 1, receipts: 1, audits: 1 });
  let draft = results[0].result;
  const revise = { action: "revise_draft", clientId: input.clientId, assessmentKey: draft.assessmentKey, previousVersionId: draft.versionId,
    expectedVersion: draft.version, expectedContentHash: draft.contentHash, content: input.content };
  const chainHolder = await hold(`select pg_advisory_xact_lock(hashtextextended('nursing-chain:${org}:${branch}:${draft.assessmentKey}',0))`);
  const revisionOne = write("native_nursing_same_predecessor", "dbd00000-0000-4000-8000-000000000021", revise);
  const revisionTwo = write("native_nursing_same_predecessor", "dbd00000-0000-4000-8000-000000000022", revise);
  probes.push({ name: "different_keys_same_predecessor", waiters: await wait("native_nursing_same_predecessor", 2) });
  await chainHolder.release(); const revisions = [await revisionOne, await revisionTwo];
  assert.equal(revisions.filter((r) => r.status === 0).length, 1);
  denied(revisions.find((r) => r.status !== 0), "40001"); draft = receipt(revisions.find((r) => r.status === 0)).result;
  assert.deepEqual(counts(), { versions: 2, receipts: 2, audits: 2 });
  const sign = { action: "sign", clientId: input.clientId, assessmentKey: draft.assessmentKey, previousVersionId: draft.versionId, expectedVersion: draft.version, expectedContentHash: draft.contentHash };
  const signed = receipt(await write("native_nursing_valid_sign", "dbd00000-0000-4000-8000-000000000012", sign));
  assert.equal(signed.result.state, "signed"); assert.deepEqual(signed.result.content, input.content);
  assert.equal(signed.result.signatureChallengeId, "db800000-0000-4000-8000-000000000001");
  const expectedCounts = { versions: 3, receipts: 3, audits: 3 };
  assert.deepEqual(counts(), expectedCounts);
  const replayKey = "dbd00000-0000-4000-8000-000000000011";
  const grantHolder = await hold(`select pg_advisory_xact_lock(hashtextextended('nursing-operation:${actor}:${replayKey}',0))`);
  const grantWaiter = write("native_nursing_revoke_grant", replayKey);
  probes.push({ name: "grant_revoked_after_operation_wait", waiters: await wait("native_nursing_revoke_grant") });
  sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}';`); await grantHolder.release(); denied(await grantWaiter);
  assert.deepEqual(counts(), expectedCounts);
  sql(`update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}';`);
  const sessionHolder = await hold(`select pg_advisory_xact_lock(hashtextextended('nursing-operation:${actor}:${replayKey}',0))`);
  const sessionWaiter = write("native_nursing_revoke_session", replayKey);
  probes.push({ name: "actual_session_revoked_after_wait", waiters: await wait("native_nursing_revoke_session") });
  sql("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='db300000-0000-4000-8000-000000000001';");
  await sessionHolder.release(); denied(await sessionWaiter); assert.deepEqual(counts(), expectedCounts);
  sql("update auth.sessions set not_after=null where id='db300000-0000-4000-8000-000000000001';");
  sql(`create schema native_nursing_test;create function native_nursing_test.pause_version_audit() returns trigger language plpgsql set search_path='' as $$begin
    if new.table_name='public.nursing_assessment_versions' then perform pg_advisory_xact_lock(hashtextextended('native-nursing-pause',0));end if;return new;end;$$;
    create trigger native_nursing_pause_audit before insert on public.audit_events for each row execute function native_nursing_test.pause_version_audit();`);
  const auditHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-nursing-pause',0))");
  const auditWaiter = write("native_nursing_revoke_assignment", "dbd00000-0000-4000-8000-000000000013");
  probes.push({ name: "assignment_revoked_during_canonical_version_audit", waiters: await wait("native_nursing_revoke_assignment") });
  sql("update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dbc00000-0000-4000-8000-000000000001';");
  await auditHolder.release(); denied(await auditWaiter); assert.deepEqual(counts(), expectedCounts);
  sql("update public.client_assignments set ends_at=null where id='dbc00000-0000-4000-8000-000000000001';drop trigger native_nursing_pause_audit on public.audit_events;");
  // Conditions evaluated before a FOR SHARE wait are not proof of freshness
  // after that wait. The sign replay must recheck the actual wall clock.
  const claimsBeforeExpiry = JSON.parse(jwt);
  const nearingExpiry = Number(sql("select floor(extract(epoch from clock_timestamp()-interval '898 seconds'));").trim());
  sql(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
      created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
    values('db800000-0000-4000-8000-000000000098','${actor}','db300000-0000-4000-8000-000000000001',repeat('e',64),
      'db900000-0000-4000-8000-000000000098',to_timestamp(${nearingExpiry}-2),'synthetic-prior-expiry',to_timestamp(${nearingExpiry}-1),
      to_timestamp(${nearingExpiry}+300),to_timestamp(${nearingExpiry}),to_timestamp(${nearingExpiry}),'synthetic-after-expiry','totp',to_timestamp(${nearingExpiry}));
    update private.reauth_events set challenge_id='db800000-0000-4000-8000-000000000098',verified_at=to_timestamp(${nearingExpiry}) where user_id='${actor}';
    update auth.mfa_amr_claims set updated_at=to_timestamp(${nearingExpiry}) where session_id='db300000-0000-4000-8000-000000000001' and authentication_method='totp';`);
  jwt = JSON.stringify({ ...claimsBeforeExpiry, amr: claimsBeforeExpiry.amr.map((a) => a.method === "totp" ? { ...a, timestamp: nearingExpiry } : a) });
  const expiryHolder = await hold("select id from private.reauth_challenges where id='db800000-0000-4000-8000-000000000098' for update");
  const expiryWaiter = write("native_nursing_expire_factor", "dbd00000-0000-4000-8000-000000000012", sign);
  probes.push({ name: "actual_factor_expires_during_signature_lock_wait", waiters: await wait("native_nursing_expire_factor") });
  await new Promise((resolveWait) => setTimeout(resolveWait, 3_100)); await expiryHolder.release(); denied(await expiryWaiter);
  assert.deepEqual(counts(), expectedCounts);
  const originalFactor = claimsBeforeExpiry.amr.find((a) => a.method === "totp").timestamp;
  sql(`update private.reauth_events set challenge_id='db800000-0000-4000-8000-000000000001',verified_at=to_timestamp(${originalFactor}) where user_id='${actor}';
    update auth.mfa_amr_claims set updated_at=to_timestamp(${originalFactor}) where session_id='db300000-0000-4000-8000-000000000001' and authentication_method='totp';`);
  jwt = JSON.stringify(claimsBeforeExpiry);
  // Genuine public begin -> service-owned challenge -> fresh actual AMR ->
  // authenticated record; then revoke only the new nurse path after its write.
  const oldClaims = JSON.parse(jwt); const challenge = "db800000-0000-4000-8000-000000000099";
  sql(`begin;select set_config('request.jwt.claims',${quote(JSON.stringify({ ...oldClaims, aal: "aal1" }))},true);set local role authenticated;
    do $$begin if public.can_begin_staff_mfa() is not true then raise exception 'nurse MFA admission failed';end if;end;$$;commit;
    begin;set local role service_role;select * from public.issue_aal2_reauth_challenge('${challenge}','${actor}','db300000-0000-4000-8000-000000000001',repeat('f',64),'db900000-0000-4000-8000-000000000099',clock_timestamp()-interval '60 seconds','synthetic-prior',300);commit;`);
  const fresh = Number(sql("select floor(extract(epoch from clock_timestamp()));").trim());
  sql(`update auth.mfa_amr_claims set updated_at=to_timestamp(${fresh}) where session_id='db300000-0000-4000-8000-000000000001' and authentication_method='totp';`);
  jwt = JSON.stringify({ ...oldClaims, iat: fresh, amr: oldClaims.amr.map((a) => a.method === "totp" ? { ...a, timestamp: fresh } : a) });
  const recordInput = `select public.record_aal2_reauth('${challenge}',repeat('f',64))`;
  sql(`create function native_nursing_test.pause_reauth() returns trigger language plpgsql set search_path='' as $$begin
    perform pg_advisory_xact_lock(hashtextextended('native-nursing-pause',0));return new;end;$$;
    create trigger native_nursing_pause_reauth after insert or update on private.reauth_events for each row execute function native_nursing_test.pause_reauth();`);
  const reauthHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-nursing-pause',0))");
  const reauthWaiter = concurrent(`begin;set local application_name='native_nursing_revoke_mfa';select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;${recordInput};commit;`);
  probes.push({ name: "nurse_grant_revoked_after_reauth_evidence_write", waiters: await wait("native_nursing_revoke_mfa") });
  sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}';`);
  await reauthHolder.release(); denied(await reauthWaiter);
  assert.equal(sql(`select consumed_at is null from private.reauth_challenges where id='${challenge}';`).trim(), "t");
  assert.equal(sql(`select challenge_id from private.reauth_events where user_id='${actor}';`).trim(), "db800000-0000-4000-8000-000000000001");
  sql(`drop trigger native_nursing_pause_reauth on private.reauth_events;update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}';`);
  assert.equal(sql(`begin;select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;${recordInput};commit;`).trim().split("\n").at(-1), "t");
  const evidence = sql(`begin;select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;
    select 'EVIDENCE='||public.nursing_recent_aal2_evidence('${org}','${branch}')::text;commit;`).split("\n").find((line) => line.startsWith("EVIDENCE="));
  const parsed = JSON.parse(evidence.slice(9)); assert.equal(new Date(parsed.verifiedAt).getTime(), fresh * 1000);
  assert.deepEqual(Object.keys(parsed).sort(), ["actorUserId", "branchId", "organizationId", "verifiedAt"]);
  const evidenceHolder = await hold(`select id from private.reauth_challenges where id='${challenge}' for update`);
  const evidenceWaiter = concurrent(`begin;set local application_name='native_nursing_revoke_evidence';select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;
    select 'EVIDENCE='||coalesce(public.nursing_recent_aal2_evidence('${org}','${branch}')::text,'null');commit;`);
  probes.push({ name: "scoped_evidence_admission_revoked_during_challenge_wait", waiters: await wait("native_nursing_revoke_evidence") });
  sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}';`);
  await evidenceHolder.release(); const evidenceResult = await evidenceWaiter;
  assert.equal(evidenceResult.status, 0, evidenceResult.stderr); assert.match(evidenceResult.stdout, /^EVIDENCE=null$/m);
  sql(`update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}';`);
  assert.deepEqual(counts(), expectedCounts);
  await writeFile(join(runtime, "evidence.json"), JSON.stringify({ engine, migrations: migrations.length, pgTapAssertions: actual,
    baseline: { approvedStaff: true, nurseSnapshotSqlState: "42501" }, probes, finalCounts: counts(), mfaAcquisition: true, scopedEvidence: parsed,
    authPredicateReplacements: 0, externalConnections: 0, httpLoadTest: false }, null, 2));
  console.log(`Native nursing: baseline RED/latest GREEN; ${probes.length} observed independent-backend probes, exact MFA acquisition and evidence. Evidence: ${runtime}/evidence.json`);
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of holders) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors, stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
