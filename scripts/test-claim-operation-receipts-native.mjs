// Real PostgreSQL 17 (minor >= 11), test-owned Unix socket only. Synthetic upgrade data,
// current Google/session/AMR admission, unchanged migrations; no hosted URL,
// authorization replacement, real ledger/patient data or external submission.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute PostgreSQL 17 bin directory (minor >= 11).");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-claim-operation-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55456", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
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
  assert.ok(line, `Missing synthetic ${key} marker`);
  return line.slice(key.length + 1);
};
const connection = () => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  const completed = new Promise((resolveResult) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });
  return { child, completed, output: () => stdout };
};
const concurrentSql = (input) => {
  const current = connection(); current.child.stdin.end(input); return current.completed;
};
const holders = new Set();
const hold = async (lockStatement) => {
  const current = connection(); let released = false;
  const holder = { release: async () => {
    if (released) return;
    released = true; current.child.stdin.end("commit;\n");
    const result = await current.completed; holders.delete(holder);
    assert.equal(result.status, 0, result.stderr);
  } };
  holders.add(holder);
  current.child.stdin.write(`begin;set local application_name='native_claim_lock_holder';${lockStatement};select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10_000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned claim lock holder did not become ready.");
    await new Promise((done) => setTimeout(done, 25));
  }
  holder.pid = Number(marker(current.output(), "READY")); return holder;
};
const waitForBlocked = async (names) => {
  assert.ok(names.every((name) => /^native_claim_[a-z_]+$/.test(name)));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object(
      'pid',pid,'applicationName',application_name,'waitEvent',wait_event,
      'blockers',pg_blocking_pids(pid))),'[]'::jsonb)
      from pg_stat_activity where application_name in (${names.map(quote).join(",")})
      and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === names.length && new Set(rows.map((row) => row.pid)).size === names.length) return rows;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Independent claim backends not observed waiting: ${names.join(",")}.`);
};

const actor = "70000000-0000-4000-8000-000000000001";
const session = "70600000-0000-4000-8000-000000000001";
const org = "70100000-0000-4000-8000-000000000001";
const branch = "70200000-0000-4000-8000-000000000001";
const client = "70400000-0000-4000-8000-000000000001";
const mainBatch = "72000000-0000-4000-8000-000000000001";
const membershipBatch = "72000000-0000-4000-8000-000000000004";
const sessionBatch = "72000000-0000-4000-8000-000000000005";
const exportKey = "49070000-0000-4000-8000-000000000001";
const reconcileKey = "49070000-0000-4000-8000-000000000002";
const results = [
  { claim_item_id: "72100000-0000-4000-8000-000000000002", outcome: "rejected", response_code: "R1", response_message: " 合成退件 😀 \"理由\" " },
  { claim_item_id: "72100000-0000-4000-8000-000000000001", outcome: "accepted", response_code: "OK", response_message: null },
];
const evidence = { syntheticOnly: true, hostedConnections: 0, authorizationReplacements: 0, probes: [], assertions: [] };
let started = false;
let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim();
  const version = engine.match(/^postgres \(PostgreSQL\) 17\.(\d+)(?:\s|$)/);
  assert.ok(version && Number.isSafeInteger(Number(version[1])) && Number(version[1]) >= 11,
    "Native claim verification requires PostgreSQL 17.11 or a later PostgreSQL 17 security minor");
  evidence.engine = engine;
  console.log(engine);
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c max_wal_size=128MB -c min_wal_size=32MB`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  const baseline = "20260908004000_claim_validation_receipts.sql";
  assert.ok(migrations.includes(baseline));
  assert.ok(migrations.includes("20260926070013_claim_operation_receipts.sql"));
  evidence.migrations = [];
  const migrate = async (name) => {
    const source = await readFile(join(root, "supabase/migrations", name), "utf8");
    try { sql(source); } catch (error) { throw new Error(`Native migration ${name}: ${error.message}`); }
    evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  };
  for (const name of migrations.filter((name) => name <= baseline)) await migrate(name);
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  // Preserve a real supported upgrade boundary: legacy synthetic service/claim
  // fixtures precede executive admission, then every later migration is applied
  // unchanged. No SQL permission predicate or trigger is replaced for the test.
  const source = await readFile(join(root, "supabase/tests/atomic_claim_workflows.test.sql"), "utf8");
  const start = source.indexOf("insert into auth.users (");
  const end = source.indexOf("-- Defensive export tests");
  assert.ok(start > 0 && end > start);
  sql(`begin;${source.slice(start, end)}commit;`);
  for (const name of migrations.filter((name) => name > baseline)) await migrate(name);
  assert.equal(evidence.migrations.length, migrations.length);
  evidence.compiledMigrations = migrations.length;
  console.log(`Native unchanged migration compilation: ${migrations.length}/${migrations.length}.`);

  const setup = sql(`begin;
    select set_config('test.claim_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
    select set_config('test.claim_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
    insert into auth.identities(id,provider_id,user_id,identity_data,provider) values(
      '49080000-0000-4000-8000-000000000001','synthetic-claim-google','${actor}',
      '{"sub":"synthetic-claim-google","email":"claims-a@example.invalid","email_verified":true}','google');
    insert into auth.sessions(id,user_id,created_at,aal) values('${session}','${actor}',clock_timestamp()-interval '3 minutes','aal2');
    insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
      select ('49090000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${session}',
        to_timestamp(current_setting(case n when 1 then 'test.claim_oauth' else 'test.claim_totp' end)::bigint),
        to_timestamp(current_setting(case n when 1 then 'test.claim_oauth' else 'test.claim_totp' end)::bigint),
        case n when 1 then 'oauth' else 'totp' end from generate_series(1,2)n;
    insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
      values('${actor}','claims-a@example.invalid','synthetic-claim-google',true,'Synthetic native claim upgrade only');
    update public.claim_batches set claim_period_start='2026-08-01',claim_period_end='2026-08-31' where id='${membershipBatch}';
    update public.claim_items set evidence_hash=repeat('5',64) where claim_batch_id='${sessionBatch}';
    select set_config('request.jwt.claims',jsonb_build_object('sub','${actor}','role','authenticated','aud','authenticated',
      'aal','aal2','session_id','${session}','email','claims-a@example.invalid','is_anonymous',false,
      'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
      'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.claim_oauth')::bigint),
        jsonb_build_object('method','totp','timestamp',current_setting('test.claim_totp')::bigint)))::text,true);
    select 'JWT='||current_setting('request.jwt.claims');
    set local role authenticated;
    select 'AUTH='||jsonb_build_object('admitted',public.is_executive_login_allowed(),'recent',public.has_recent_aal2(15))::text;
    select * from public.validate_claim_batch('${org}','${branch}','${mainBatch}',30.00,'490a0000-0000-4000-8000-000000000001');
    select * from public.validate_claim_batch('${org}','${branch}','${membershipBatch}',5.00,'490a0000-0000-4000-8000-000000000002');
    select * from public.validate_claim_batch('${org}','${branch}','${sessionBatch}',5.00,'490a0000-0000-4000-8000-000000000003');commit;`);
  const jwt = marker(setup, "JWT");
  assert.deepEqual(JSON.parse(marker(setup, "AUTH")), { admitted: true, recent: true });
  evidence.assertions.push("Current synthetic Google CEO session and same-session recent AAL2 admitted without helper replacement");
  const transaction = (call, name) => {
    assert.match(name, /^native_claim_[a-z_]+$/);
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;${call};commit;`;
  };
  const exported = ({ batch = mainBatch, key = exportKey, amount = "30.00", organization = org, branchId = branch } = {}) =>
    `select 'RECEIPT='||to_jsonb(result)::text from public.export_claim_batch_receipt(${quote(organization)}::uuid,${quote(branchId)}::uuid,${quote(batch)}::uuid,${amount}::numeric,${quote(key)}::uuid) result`;
  const reconciled = ({ key = reconcileKey, entries = results, amount = "30.00", organization = org, branchId = branch } = {}) =>
    `select 'RECEIPT='||to_jsonb(result)::text from public.reconcile_claim_batch_receipt(${quote(organization)}::uuid,${quote(branchId)}::uuid,${quote(mainBatch)}::uuid,${amount}::numeric,${quote(JSON.stringify(entries))}::jsonb,${quote(key)}::uuid) result`;
  const receipt = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "RECEIPT")); };
  const reject = async (call, code, name) => {
    const result = await concurrentSql(transaction(call, name));
    assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(`\\b${code}\\b`));
    assert.doesNotMatch(result.stdout, /^RECEIPT=/m); return result;
  };
  const state = (batch) => JSON.parse(sql(`select jsonb_build_object('status',status,
    'exportKey',export_idempotency_key,'reconciliationKey',reconciliation_idempotency_key,
    'allocations',(select count(*) from private.claim_service_allocations a where a.claim_batch_id=b.id))
    from public.claim_batches b where b.id=${quote(batch)}::uuid;`).trim());
  const planLock = () => hold(`select pg_advisory_xact_lock(hashtextextended(${quote(`client-service-plan:${org}:${branch}:${client}`)},0))`);

  const duplicateHolder = await planLock();
  const duplicateA = concurrentSql(transaction(exported(), "native_claim_export_a"));
  const duplicateB = concurrentSql(transaction(exported(), "native_claim_export_b"));
  try { evidence.probes.push({ name: "same_key_export_two_real_backends", holderPid: duplicateHolder.pid,
    waiters: await waitForBlocked(["native_claim_export_a", "native_claim_export_b"]) }); }
  finally { await duplicateHolder.release(); }
  const exports = [receipt(await duplicateA), receipt(await duplicateB)];
  assert.equal(exports.filter((item) => item.replayed).length, 1);
  const firstExport = exports.find((item) => !item.replayed);
  assert.deepEqual(exports.find((item) => item.replayed), { ...firstExport, replayed: true });
  assert.deepEqual(state(mainBatch), { status: "exported", exportKey, reconciliationKey: null, allocations: 2 });
  const storedExport = JSON.parse(sql(`select jsonb_build_object('organization_id',organization_id,'branch_id',branch_id,
    'idempotency_key',export_idempotency_key,'request_hash',export_request_hash,'committed_at',exported_at,
    'snapshot_hash',snapshot_hash,'snapshot_hash_version',snapshot_hash_version) from public.claim_batches where id='${mainBatch}';`).trim());
  for (const [field, value] of Object.entries(storedExport)) assert.deepEqual(firstExport[field], value);
  console.log("Native two-backend export: exactly one commit, one exact replay, original persisted commit time.");
  await reject(exported({ amount: "31.00" }), "23505", "native_claim_wrong_export_payload");
  await reject(exported({ organization: "70100000-0000-4000-8000-000000000002" }), "42501", "native_claim_wrong_export_org");
  await reject(exported({ branchId: "70200000-0000-4000-8000-000000000002" }), "42501", "native_claim_wrong_export_branch");
  assert.deepEqual(receipt(await concurrentSql(transaction(exported(), "native_claim_export_replay"))), { ...firstExport, replayed: true });

  const reconcileHolder = await hold(`select id from public.claim_batches where id='${mainBatch}' for update`);
  const reconcileA = concurrentSql(transaction(reconciled(), "native_claim_reconcile_a"));
  const reconcileB = concurrentSql(transaction(reconciled({ entries: [...results].reverse() }), "native_claim_reconcile_b"));
  try { evidence.probes.push({ name: "same_key_reconciliation_two_real_backends", holderPid: reconcileHolder.pid,
    waiters: await waitForBlocked(["native_claim_reconcile_a", "native_claim_reconcile_b"]) }); }
  finally { await reconcileHolder.release(); }
  const reconciliations = [receipt(await reconcileA), receipt(await reconcileB)];
  assert.equal(reconciliations.filter((item) => item.replayed).length, 1);
  const firstReconciliation = reconciliations.find((item) => !item.replayed);
  assert.deepEqual(reconciliations.find((item) => item.replayed), { ...firstReconciliation, replayed: true });
  assert.equal(firstReconciliation.accepted_count, 1); assert.equal(firstReconciliation.rejected_count, 1);
  const storedReconciliation = JSON.parse(sql(`select jsonb_build_object('organization_id',organization_id,'branch_id',branch_id,
    'idempotency_key',reconciliation_idempotency_key,'request_hash',reconciliation_request_hash,'committed_at',reconciled_at,
    'snapshot_hash_version',snapshot_hash_version) from public.claim_batches where id='${mainBatch}';`).trim());
  for (const [field, value] of Object.entries(storedReconciliation)) assert.deepEqual(firstReconciliation[field], value);
  await reject(reconciled({ entries: results.map((item) => ({ ...item, response_code: "CHANGED" })) }), "23505", "native_claim_wrong_response_payload");
  await reject(reconciled({ amount: "31.00" }), "23505", "native_claim_wrong_reconcile_total");
  await reject(reconciled({ organization: "70100000-0000-4000-8000-000000000002" }), "42501", "native_claim_wrong_reconcile_org");
  await reject(reconciled({ branchId: "70200000-0000-4000-8000-000000000002" }), "42501", "native_claim_wrong_reconcile_branch");
  assert.deepEqual(receipt(await concurrentSql(transaction(exported(), "native_claim_historical_export"))), { ...firstExport, replayed: true });
  assert.deepEqual(state(mainBatch), { status: "reconciled", exportKey, reconciliationKey: reconcileKey, allocations: 2 });
  evidence.assertions.push("Export and reconciliation bind stored scope/key/hash/native version/commit time; payload and cross-scope replays rejected");
  console.log("Native two-backend reconciliation: one commit, exact replay including normalized Unicode/quotes and original time; wrong scope/payload rejected.");

  for (const [kind, batch, key, revoke, restore] of [
    ["membership", membershipBatch, "49070000-0000-4000-8000-000000000003",
      `update public.memberships set status='ended',ends_at=clock_timestamp() where id='70300000-0000-4000-8000-000000000001'`,
      `update public.memberships set status='active',ends_at=null where id='70300000-0000-4000-8000-000000000001'`],
    ["session", sessionBatch, "49070000-0000-4000-8000-000000000004",
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${session}'`,
      `update auth.sessions set not_after=null where id='${session}'`],
  ]) {
    const before = state(batch); assert.equal(before.status, "validated"); assert.equal(before.allocations, 0);
    const revokeHolder = await planLock();
    const name = `native_claim_revoke_${kind}`;
    const pending = concurrentSql(transaction(exported({ batch, key, amount: "5.00" }), name));
    try {
      const waiters = await waitForBlocked([name]);
      assert.equal(waiters[0].waitEvent, "advisory");
      assert.ok(waiters[0].blockers.includes(revokeHolder.pid));
      // This independent transaction commits BEFORE the export may continue.
      sql(`begin;${revoke};commit;`);
      evidence.probes.push({ name: `committed_${kind}_revocation_while_export_waits`, holderPid: revokeHolder.pid,
        waiters, revokedBeforeHolderReleased: true });
    } finally { await revokeHolder.release(); }
    const denied = await pending;
    assert.notEqual(denied.status, 0); assert.match(denied.stderr, /\b42501\b/);
    assert.doesNotMatch(denied.stdout, /^RECEIPT=/m); assert.deepEqual(state(batch), before);
    assert.equal(sql(`select count(*) from private.claim_service_allocations where claim_batch_id<>'${mainBatch}';`).trim(), "0");
    sql(`begin;${restore};commit;`);
    evidence.assertions.push(`Committed ${kind} revocation after actual advisory-lock wait: 42501 and zero export/receipt/allocation changes`);
    console.log(`Native export ${kind} revoked after authorization while advisory-blocked: 42501, whole transaction rolled back.`);
  }
  assert.deepEqual(receipt(await concurrentSql(transaction(reconciled(), "native_claim_final_replay"))), { ...firstReconciliation, replayed: true });
  evidence.limitations = [
    "SQL-native fixture only: not PostgREST/HTTP, hosted Auth or official submission-format proof",
    "Concurrent revocation probes cover committed membership-ended and auth.session not_after changes during plan-lock wait",
    "Final authorization check is not full authority-row serialization through COMMIT and does not repair legacy now()-based natural membership expiry",
    "No historic exporter/reconciler actor or original raw API key is inferred or backfilled",
  ];
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Native claim operation receipts verified; evidence: ${join(runtime, "evidence.json")}.`);
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of holders) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  if (testFailure) {
    try { await writeFile(join(runtime, "failure.json"), JSON.stringify({ syntheticOnly: true, error: testFailure.message, evidence }, null, 2)); }
    catch (error) { cleanupErrors.push(error); }
  }
  await cleanupNativeData({ started, testFailure, cleanupErrors,
    stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
