// Synthetic Unix-socket-only original-operation recovery gate. Every lock
// race records actual independent PostgreSQL backend blockers, not a timer.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17 bin directory, minor >=11; no hosted URL.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-staff-document-recovery-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime,
  PGPORT: "55470", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const run = (file, argv, input) => {
  const result = spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = input => run(join(binaries, "psql"), args, input);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const marker = (output, key) => {
  const line = output.split("\n").find(item => item.startsWith(`${key}=`));
  assert.ok(line, `Missing synthetic ${key} marker`); return line.slice(key.length + 1);
};
const children = new Set();
const connection = () => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  children.add(child); let stdout = "", stderr = "";
  const completed = new Promise(done => {
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => done({ status: -1, stdout, stderr: error.message }));
    child.on("close", status => { children.delete(child); done({ status, stdout, stderr }); });
  });
  return { child, completed, output: () => stdout };
};
const concurrent = input => { const current = connection(); current.child.stdin.end(input); return current.completed; };
const ready = async current => {
  const deadline = Date.now() + 10000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned backend did not become ready.");
    await new Promise(done => setTimeout(done, 25));
  }
  return Number(marker(current.output(), "READY"));
};
const holders = new Set();
const hold = async statement => {
  const current = connection(); let released = false;
  const holder = { run: fragment => current.child.stdin.write(`${fragment};\n`), release: async (fragment = "") => {
    if (released) return; released = true;
    current.child.stdin.end(`${fragment};commit;\n`);
    const result = await current.completed; holders.delete(holder); assert.equal(result.status, 0, result.stderr);
    return result;
  } };
  holders.add(holder);
  current.child.stdin.write(`begin;set local application_name='native_staff_recovery_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  holder.pid = await ready(current); return holder;
};
const waitForBlocked = async (name, holderPid) => {
  assert.match(name, /^native_staff_recovery_[a-z_]+$/u);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const waiters = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'applicationName',application_name,
      'waitEvent',wait_event,'blockers',pg_blocking_pids(pid))),'[]'::jsonb) from pg_stat_activity
      where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (waiters.length === 1 && waiters[0].blockers.includes(holderPid)) return waiters;
    await new Promise(done => setTimeout(done, 25));
  }
  throw new Error(`Actual blocked independent backend not observed: ${name}.`);
};
const jsonResult = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "RESULT")); };
const denied = (result, code = "42501") => {
  assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(`\\b${code}\\b`));
  assert.doesNotMatch(result.stdout, /^RESULT=/m);
};
const evidence = { syntheticOnly: true, hostedConnections: 0, externalNetworkRequests: 0,
  authorizationReplacements: 0, migrations: [], probes: [], assertions: [] };
evidence.runnerSha256 = createHash("sha256").update(await readFile(import.meta.filename)).digest("hex");
let started = false, testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim();
  const version = engine.match(/^postgres \(PostgreSQL\) 17\.(\d+)(?:\s|$)/u);
  assert.ok(version && Number(version[1]) >= 11, "PostgreSQL 17.11 or later PostgreSQL 17 security minor required");
  evidence.engine = engine;
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o",
    `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c timezone=UTC -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c max_wal_size=128MB -c min_wal_size=32MB`, "-w", "start"]); started = true;
  sql(bootstrapSql);
  sql(`create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,
      metadata jsonb,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 150, "This evidence requires the exact current 150-migration baseline");
  assert.equal(migrations.at(-1), "20260927151109_general_import_repository.sql");
  for (const name of migrations) {
    const source = await readFile(join(root, "supabase/migrations", name), "utf8");
    assert.ok(source.trim(), `Exact migration ${name} must not be an empty in-progress source`);
    try { sql(source); } catch (error) { throw new Error(`Exact migration ${name}: ${error.message}`); }
    evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const testPath = join(root, "supabase/tests/staff_certificate_document_recovery.test.sql");
  const testSource = await readFile(testPath, "utf8");
  evidence.testSha256 = createHash("sha256").update(testSource).digest("hex");
  const tap = sql(testSource);
  const expected = Number(testSource.match(/select\s+plan\((\d+)\)/iu)?.[1] ?? tap.match(/^1\.\.(\d+)$/mu)?.[1]);
  const actual = tap.split("\n").filter(line => /^ok \d+\b/u.test(line)).length;
  assert.ok(expected > 0); assert.equal(actual, expected, tap); assert.doesNotMatch(tap, /^not ok \d+\b|^# Looks like/mu);
  evidence.pgTapAssertions = actual; evidence.compiledMigrations = migrations.length;
  console.log(`${engine}; exact ${migrations.length}/${migrations.length} migrations; ${actual}/${expected} pgTAP assertions.`);

  const schemaPaths = ["src/lib/staff-certificate-documents/schema.ts", "src/lib/staff-certificate-documents/recovery-schema.ts"];
  evidence.schemaSources = [];
  for (const name of schemaPaths) evidence.schemaSources.push({ name, sha256: createHash("sha256").update(await readFile(join(root, name))).digest("hex") });
  const { sourcesSnapshotSchema, parseStaffCertificateDocumentOperationReceipt, parseStaffCertificateDocumentClosureReceipt } =
    require(join(root, "src/lib/staff-certificate-documents/recovery-schema.ts"));
  const { reservationSchema, documentReceiptSchema } = require(join(root, "src/lib/staff-certificate-documents/schema.ts"));
  const sentinel = "-- NATIVE_FIXTURE_END";
  assert.ok(testSource.includes(sentinel), "SQL fixture must expose a bounded native setup prefix");
  const fixturePrefix = testSource.slice(0, testSource.indexOf(sentinel)).replace(/select\s+(?:plan\(\d+\)|no_plan\(\));/iu, "");
  assert.ok(fixturePrefix.includes("private.staff_google_access_grants") && fixturePrefix.includes("auth.mfa_amr_claims"));
  const setup = sql(`${fixturePrefix}\nselect pg_temp.doc_login(1);select 'JWT='||current_setting('request.jwt.claims');
    select pg_temp.doc_login(2);select 'REVIEW_JWT='||current_setting('request.jwt.claims');
    select pg_temp.doc_login(3);select 'SELF_JWT='||current_setting('request.jwt.claims');
    select 'FIXTURE='||v::text from doc_data where k='native';commit;`);
  const originalJwt = marker(setup, "JWT"), reviewJwt = marker(setup, "REVIEW_JWT"), selfJwt = marker(setup, "SELF_JWT");
  const fixture = JSON.parse(marker(setup, "FIXTURE"));
  const { organizationId: org, branchId: branch, actorUserId: actor, targetMembershipId: member,
    certificateKey: cert, recordVersionId: versionId, recordContentHash: contentHash, reviewerUserId: reviewer, targetUserId: target } = fixture;
  for (const value of [org, branch, actor, member, cert, versionId, reviewer, target]) assert.match(value, /^[a-f0-9-]{36}$/u);
  assert.match(contentHash, /^[a-f0-9]{64}$/u); assert.notEqual(actor, reviewer); assert.notEqual(reviewer, target);
  let latestSourceVersionId = versionId, latestSourceContentHash = contentHash;
  let jwt = originalJwt, keyNumber = 100;
  const key = () => `ef900000-0000-4000-8000-${String(++keyNumber).padStart(12, "0")}`;
  const nonce = () => key();
  const transaction = (call, name, claims = jwt, role = "authenticated") => {
    assert.match(name, /^native_staff_recovery_[a-z_]+$/u); assert.ok(["authenticated", "service_role"].includes(role));
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claims)},true);set local role ${role};${call};commit;`;
  };
  const binding = { staffMembershipId: member, certificateKey: cert, recordVersionId: versionId,
    recordContentHash: contentHash, sha256: "a".repeat(64), mimeType: "application/pdf", fileSizeBytes: 8 };
  const reserveCall = request => `select 'RESULT='||payload::text from public.reserve_staff_certificate_document('${org}','${branch}',${quote(JSON.stringify(request))}::jsonb)`;
  const reserve = async () => {
    const request = { ...binding, idempotency_key: key() };
    const reserved = reservationSchema.parse(jsonResult(await concurrent(transaction(reserveCall(request), "native_staff_recovery_reserve"))));
    sql(`insert into storage.objects(bucket_id,name,metadata) values('staff-certificate-documents',${quote(reserved.objectPath)},
      jsonb_build_object('mimetype','application/pdf','size',8))`);
    return { request, reserved };
  };
  const sourceCall = (membership = member, page = 1, requestedBranch = branch) => `select 'RESULT='||payload::text from public.staff_certificate_document_sources('${org}','${requestedBranch}',${membership ? quote(membership) : "null"},${page})`;
  const operationCall = (request, challenge) => `select 'RESULT='||payload::text from public.staff_certificate_document_operation_receipt('${org}','${branch}','reserve','${request.idempotency_key}',${quote(JSON.stringify(binding))}::jsonb,'${challenge}')`;
  const closeCall = (request, reconciliationKey, challenge) => `select 'RESULT='||payload::text from public.reconcile_expired_staff_certificate_document('${org}','${branch}','${request.idempotency_key}','${reconciliationKey}',${quote(JSON.stringify(binding))}::jsonb,'${challenge}')`;
  const scanCall = document => `select 'RESULT='||payload::text from public.complete_staff_certificate_document_scan('${document.documentId}','${document.sha256}','clean','native-synthetic-scanner')`;
  const expectedOperation = (request, challenge, actorUserId = actor) => ({ organizationId: org, branchId: branch, actorUserId,
    action: "reserve", idempotencyKey: request.idempotency_key, binding, nonce: challenge });
  const expectedClosure = (request, reconciliationKey, challenge) => ({ organizationId: org, branchId: branch, actorUserId: actor,
    originalIdempotencyKey: request.idempotency_key, reconciliationKey, binding, nonce: challenge });
  const read = async (request, claims = jwt, owner = actor) => {
    const challenge = nonce();
    return parseStaffCertificateDocumentOperationReceipt(jsonResult(await concurrent(transaction(operationCall(request, challenge), "native_staff_recovery_receipt", claims))),
      expectedOperation(request, challenge, owner));
  };

  // Audit pause triggers are confined to this disposable synthetic cluster;
  // production functions and genuine admission predicates remain unchanged.
  sql(`create schema native_staff_recovery_test;
    create function native_staff_recovery_test.pause_audit() returns trigger language plpgsql set search_path='' as $$begin
      if new.table_name in ('staff_certificate_document_sources','staff_certificate_document_operation_receipt',
        'staff_certificate_document_scan','staff_certificate_document_expiry_reconciliation') then
        perform pg_advisory_xact_lock(hashtextextended('native-staff-recovery-audit:'||new.table_name,0));end if;return new;end;$$;
    create trigger native_staff_recovery_pause before insert on public.audit_events
      for each row execute function native_staff_recovery_test.pause_audit();`);
  const auditLock = name => `select pg_advisory_xact_lock(hashtextextended('native-staff-recovery-audit:${name}',0))`;
  const counts = () => JSON.parse(sql(`select jsonb_build_object('documents',(select count(*) from private.staff_certificate_documents),
    'scans',(select count(*) from private.staff_certificate_document_scans),'reviews',(select count(*) from private.staff_certificate_document_reviews),
    'operations',(select count(*) from private.staff_certificate_document_operations),'terminations',(select count(*) from private.staff_certificate_document_terminations),
    'reconciliations',(select count(*) from private.staff_certificate_document_reconciliations),
    'certificates',(select count(*) from public.staff_certificate_versions),
    'documentAudits',(select count(*) from public.audit_events where table_name like 'staff_certificate_document%'))`).trim());
  const original = await reserve();
  assert.equal((await read(original.request)).status, "reserved");
  {
    const before = counts(), holder = await hold(auditLock("staff_certificate_document_sources"));
    const name = "native_staff_recovery_source_audit_revoke";
    const pending = concurrent(transaction(sourceCall(), name, reviewJwt));
    try {
      const waiters = await waitForBlocked(name, holder.pid);
      sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${reviewer}'`);
      evidence.probes.push({ name: "source_after_audit_revoke", holderPid: holder.pid, waiters, revokedBeforeReleased: true });
    } finally { await holder.release(); }
    denied(await pending); assert.deepEqual(counts(), before, "Source audit and JSON must not survive revoked admission");
    sql(`update private.staff_google_access_grants set enabled=true where allowed_user_id='${reviewer}'`);
  }
  {
    const before = counts(), holder = await hold(auditLock("staff_certificate_document_operation_receipt"));
    const name = "native_staff_recovery_receipt_audit_revoke", challenge = nonce();
    const pending = concurrent(transaction(operationCall(original.request, challenge), name));
    try {
      const waiters = await waitForBlocked(name, holder.pid);
      sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}';
        update private.executive_access_policy set enabled=false where allowed_user_id='${actor}'`);
      evidence.probes.push({ name: "original_receipt_after_audit_revoke", holderPid: holder.pid, waiters, allAdmissionRevokedBeforeReleased: true });
    } finally { await holder.release(); }
    denied(await pending); assert.deepEqual(counts(), before, "Original receipt read audit and JSON must roll back after revocation");
    sql(`update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}';
      update private.executive_access_policy set enabled=true where allowed_user_id='${actor}'`);
  }

  {
    const before = counts(), holder = await hold(auditLock("staff_certificate_document_scan"));
    const scanName = "native_staff_recovery_scan_terminal_first";
    const pendingScan = concurrent(transaction(scanCall(original.reserved), scanName, '{"role":"service_role"}', "service_role"));
    const reconciliationKey = key(), challenge = nonce(), closeName = "native_staff_recovery_close_behind_scan";
    let pendingClose;
    try {
      const scanWaiters = await waitForBlocked(scanName, holder.pid);
      pendingClose = concurrent(transaction(closeCall(original.request, reconciliationKey, challenge), closeName));
      const closeWaiters = await waitForBlocked(closeName, scanWaiters[0].pid);
      evidence.probes.push({ name: "terminal_scan_before_expired_closure", holderPid: holder.pid, scanWaiters, closeWaiters,
        closeBlockedByActualScanBackend: true });
    } finally { await holder.release(); }
    const terminal = documentReceiptSchema.parse(jsonResult(await pendingScan));
    assert.equal(terminal.scanStatus, "clean");
    const closed = await parseStaffCertificateDocumentClosureReceipt(jsonResult(await pendingClose),
      expectedClosure(original.request, reconciliationKey, challenge));
    assert.equal(closed.status, "completed"); assert.equal(closed.replayed, true); assert.equal(closed.closure, null);
    assert.deepEqual(closed.receipt, terminal, "Closure waiting for committed scan must return the exact original terminal receipt");
    const after = counts(); assert.equal(after.terminations, before.terminations); assert.equal(after.scans, before.scans + 1);
    assert.equal(after.reconciliations, before.reconciliations + 1, "Completed original still persists one immutable reconciliation intent");
    assert.equal(after.documents, before.documents); assert.equal(after.operations, before.operations);
    const proof = await read(original.request); assert.equal(proof.status, "completed"); assert.deepEqual(proof.receipt, terminal);
    const replayNonce = nonce();
    const replayed = await parseStaffCertificateDocumentClosureReceipt(jsonResult(await concurrent(transaction(closeCall(original.request, reconciliationKey, replayNonce),
      "native_staff_recovery_terminal_reconcile_replay"))), expectedClosure(original.request, reconciliationKey, replayNonce));
    assert.equal(replayed.status, "completed"); assert.equal(replayed.replayed, true); assert.deepEqual(replayed.receipt, terminal);
    assert.equal(counts().reconciliations, before.reconciliations + 1);
    const differentOriginal = await reserve(), beforeConflict = counts();
    denied(await concurrent(transaction(closeCall(differentOriginal.request, reconciliationKey, nonce()), "native_staff_recovery_terminal_reconcile_conflict")), "23505");
    denied(await concurrent(transaction(reserveCall({ ...binding, idempotency_key: reconciliationKey }), "native_staff_recovery_terminal_reconcile_reserve_alias")), "23505");
    assert.deepEqual(counts(), beforeConflict, "A completed reconciliation key binds one original intent and cannot become another reservation");
    evidence.assertions.push("Scan-first original terminal commits exactly once; waiting closure returns exact terminal without manufacturing termination");
  }
  const actualSession = (suffix, verified) => {
    const session = `ef120000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const challenge = `ef500000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const challengeNonceHash = createHash("sha256").update(`native-synthetic-challenge-${suffix}`).digest("hex");
    const oauth = verified - 240;
    sql(`begin;insert into auth.sessions(id,user_id,created_at,aal) values('${session}','${actor}',to_timestamp(${oauth})-interval '1 minute','aal2');
      insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
      ('ef130000-0000-4000-8000-${String(suffix * 2).padStart(12, "0")}','${session}',to_timestamp(${oauth}),to_timestamp(${oauth}),'oauth'),
      ('ef130000-0000-4000-8000-${String(suffix * 2 + 1).padStart(12, "0")}','${session}',to_timestamp(${verified}),to_timestamp(${verified}),'totp');
      insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
      created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
      values('${challenge}','${actor}','${session}','${challengeNonceHash}','ef510000-0000-4000-8000-${String(suffix).padStart(12, "0")}',
      to_timestamp(${verified})-interval '2 minutes','synthetic-before-${suffix}',to_timestamp(${verified})-interval '1 minute',
      to_timestamp(${verified})+interval '5 minutes',to_timestamp(${verified}),to_timestamp(${verified}),'synthetic-after-${suffix}','totp',to_timestamp(${verified}));
      insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
      values('${actor}','${session}','${challenge}','aal2','totp',to_timestamp(${verified}));commit;`);
    const claims = JSON.parse(originalJwt); claims.session_id = session;
    claims.amr = claims.amr.map(claim => ({ ...claim, timestamp: claim.method === "totp" ? verified : oauth }));
    return { claims: JSON.stringify(claims), challenge };
  };
  {
    const nearVerified = Number(sql("select floor(extract(epoch from clock_timestamp()-interval '15 minutes'+interval '5 seconds'))").trim());
    const near = actualSession(101, nearVerified); jwt = near.claims;
    const expired = await reserve(), historical = await reserve();
    const expiresAt = Number(sql(`select extract(epoch from c.factor_verified_at+interval '15 minutes')*1000
      from private.staff_certificate_documents d join private.reauth_challenges c on c.id=d.uploader_challenge_id
      where d.id='${expired.reserved.documentId}'`).trim());
    assert.ok(Number.isFinite(expiresAt) && expiresAt < Date.now() + 15000, "Captured actual MFA must be near its real deadline");
    while (Date.now() <= expiresAt + 100) await new Promise(done => setTimeout(done, 100));
    // A separate real fresh session/consumed challenge for the same actor may
    // authorize reconciliation; it never updates the immutable original row.
    const fresh = actualSession(102, Number(sql("select floor(extract(epoch from clock_timestamp()-interval '2 seconds'))").trim()));
    jwt = fresh.claims;
    const expiredProof = await read(expired.request); assert.equal(expiredProof.status, "reserved");
    assert.equal(expiredProof.reservationState, "expired"); assert.equal(expiredProof.receipt.uploadedAt, expired.reserved.uploadedAt);
    assert.equal(expiredProof.receipt.recordVersionId, versionId); assert.equal(expiredProof.receipt.recordContentHash, contentHash);
    const before = counts(), holder = await hold(auditLock("staff_certificate_document_expiry_reconciliation"));
    const reconciliationKey = key(), challenge = nonce(), closeName = "native_staff_recovery_close_first";
    const pendingClose = concurrent(transaction(closeCall(expired.request, reconciliationKey, challenge), closeName));
    let pendingReserve;
    try {
      const closeWaiters = await waitForBlocked(closeName, holder.pid);
      const reserveName = "native_staff_recovery_reserve_after_close";
      pendingReserve = concurrent(transaction(reserveCall(expired.request), reserveName));
      const reserveWaiters = await waitForBlocked(reserveName, closeWaiters[0].pid);
      // Expired captured uploader evidence rejects a newly-started scanner
      // before the shared locks. That is a denial, not a claimed lock wait.
      denied(await concurrent(transaction(scanCall(expired.reserved), "native_staff_recovery_scan_during_close", '{"role":"service_role"}', "service_role")));
      evidence.probes.push({ name: "expired_closure_before_scan_and_fresh_mfa_reserve", holderPid: holder.pid,
        closeWaiters, reserveWaiters, expiresAt, realClockExpired: Date.now() > expiresAt, newExpiredScannerDeniedBeforeLocks: true,
        originalCapturedChallengeId: near.challenge, freshSessionChallengeId: fresh.challenge, originalTimestampUnchanged: true });
    } finally { await holder.release(); }
    const closed = await parseStaffCertificateDocumentClosureReceipt(jsonResult(await pendingClose),
      expectedClosure(expired.request, reconciliationKey, challenge));
    assert.equal(closed.status, "expired_closed"); assert.equal(closed.replayed, false);
    assert.equal(closed.receipt.documentId, expired.reserved.documentId); assert.equal(closed.receipt.scanStatus, "reserved");
    assert.equal(closed.receipt.uploadedAt, expired.reserved.uploadedAt);
    denied(await pendingReserve, "55000");
    denied(await concurrent(transaction(scanCall(expired.reserved), "native_staff_recovery_scan_after_close", '{"role":"service_role"}', "service_role")), "55000");
    const after = counts(); assert.equal(after.terminations, before.terminations + 1); assert.equal(after.reconciliations, before.reconciliations + 1);
    assert.equal(after.documents, before.documents);
    assert.equal(after.scans, before.scans); assert.equal(after.operations, before.operations); assert.equal(after.certificates, before.certificates);
    const originalProof = await read(expired.request); assert.equal(originalProof.status, "expired_closed");
    assert.deepEqual(originalProof.closure, closed.closure); assert.deepEqual(originalProof.receipt, closed.receipt);
    const retryNonce = nonce();
    const replayed = await parseStaffCertificateDocumentClosureReceipt(jsonResult(await concurrent(transaction(closeCall(expired.request, reconciliationKey, retryNonce),
      "native_staff_recovery_close_replay"))), expectedClosure(expired.request, reconciliationKey, retryNonce));
    assert.equal(replayed.replayed, true); assert.deepEqual(replayed.closure, closed.closure); assert.deepEqual(replayed.receipt, closed.receipt);
    assert.equal(counts().terminations, before.terminations + 1);
    assert.equal(counts().reconciliations, before.reconciliations + 1);
    evidence.assertions.push("Real captured expiry followed by actual fresh MFA cannot revive a closed original reservation; exact-key replay returns one immutable termination");
    const replacement = jsonResult(await concurrent(transaction(`select 'RESULT='||to_jsonb(r)::text from public.append_staff_certificate('${org}','${branch}',
      'correct','${cert}','${versionId}',1,'${member}','Synthetic professional certificate','SYNTH-STAFF-001',
      (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+365,
      'registered','verified','missing',null,null,'Synthetic real certificate revision before expired closure',
      'ef610000-0000-4000-8000-000000000002')r`, "native_staff_recovery_original_source_replace")));
    latestSourceVersionId = replacement.record_version_id; latestSourceContentHash = replacement.content_hash;
    assert.match(latestSourceVersionId, /^[a-f0-9-]{36}$/u); assert.match(latestSourceContentHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(latestSourceVersionId, versionId); assert.notEqual(latestSourceContentHash, contentHash);
    const historicalProof = await read(historical.request); assert.equal(historicalProof.status, "reserved");
    assert.equal(historicalProof.reservationState, "expired"); assert.equal(historicalProof.receipt.recordVersionId, versionId);
    assert.equal(historicalProof.receipt.recordContentHash, contentHash);
    const historicalKey = key(), historicalNonce = nonce(), beforeHistorical = counts();
    const historicalClosed = await parseStaffCertificateDocumentClosureReceipt(jsonResult(await concurrent(transaction(closeCall(historical.request, historicalKey, historicalNonce),
      "native_staff_recovery_historical_close"))), expectedClosure(historical.request, historicalKey, historicalNonce));
    assert.equal(historicalClosed.status, "expired_closed"); assert.equal(historicalClosed.replayed, false);
    assert.deepEqual(historicalClosed.receipt, historicalProof.receipt, "Historical closure must retain exactly the original saved version, hash and timestamp");
    const historicalRetryNonce = nonce();
    const historicalReplay = await parseStaffCertificateDocumentClosureReceipt(jsonResult(await concurrent(transaction(closeCall(historical.request, historicalKey, historicalRetryNonce),
      "native_staff_recovery_historical_close_replay"))), expectedClosure(historical.request, historicalKey, historicalRetryNonce));
    assert.equal(historicalReplay.replayed, true); assert.deepEqual(historicalReplay.closure, historicalClosed.closure);
    assert.deepEqual(historicalReplay.receipt, historicalClosed.receipt);
    denied(await concurrent(transaction(reserveCall(historical.request), "native_staff_recovery_historical_reserve")), "40001");
    denied(await concurrent(transaction(scanCall(historical.reserved), "native_staff_recovery_historical_scan", '{"role":"service_role"}', "service_role")), "55000");
    const afterHistorical = counts(); assert.equal(afterHistorical.terminations, beforeHistorical.terminations + 1);
    assert.equal(afterHistorical.reconciliations, beforeHistorical.reconciliations + 1);
    assert.deepEqual({ ...afterHistorical, terminations: beforeHistorical.terminations, reconciliations: beforeHistorical.reconciliations,
      documentAudits: beforeHistorical.documentAudits }, beforeHistorical, "Historical closure cannot append certificate, scan or ordinary operation evidence");
    assert.equal(sql(`select bool_and(evidence_status='missing' and attachment_reference is null and attachment_sha256 is null)
      from public.staff_certificate_versions where certificate_key='${cert}'`).trim(), "t");
    evidence.assertions.push("Original writer's real revision changes current source pointer only; exact historical expired closure/replay retains original content and cannot revive old upload, scan or provided evidence");
    jwt = originalJwt;
  }

  // Source capability is document-specific. It must not manufacture old
  // certificate management authority for an approved routine/self reader.
  const ownMember = sql(`select id from public.memberships where organization_id='${org}' and branch_id='${branch}' and profile_id='${actor}' and status='active'`).trim();
  assert.match(ownMember, /^[a-f0-9-]{36}$/u); assert.notEqual(ownMember, member);
  jsonResult(await concurrent(transaction(`select 'RESULT='||to_jsonb(r)::text from public.append_staff_certificate('${org}','${branch}','create',
    'ef600000-0000-4000-8000-000000000001',null,0,'${ownMember}','Synthetic second professional certificate','SYNTH-STAFF-002',
    (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+365,
    'registered','verified','missing',null,null,null,'ef610000-0000-4000-8000-000000000001')r`, "native_staff_recovery_source_second")));
  sql(`delete from public.membership_roles where membership_id='${member}';
    insert into public.roles(id,organization_id,role_key,name) values('ef800000-0000-4000-8000-000000000001','${org}',
      'synthetic_native_doc_reader','Synthetic native self reader');
    insert into public.role_permissions(role_id,permission_id) select 'ef800000-0000-4000-8000-000000000001',id from public.permissions where permission_key='staff_certificates.read';
    insert into public.membership_roles(membership_id,role_id) values('${member}','ef800000-0000-4000-8000-000000000001');`);
  const mine = sourcesSnapshotSchema.parse(jsonResult(await concurrent(transaction(sourceCall(null), "native_staff_recovery_source_self", selfJwt))));
  assert.equal(mine.actorUserId, target); assert.equal(mine.canManageDocuments, false); assert.equal(mine.rows.length, 1);
  assert.ok(mine.rows.every(row => row.staffUserId === target && row.staffMembershipId === member && !row.canUpload));
  assert.equal(mine.rows[0].certificateKey, cert); assert.equal(mine.rows[0].recordVersionId, latestSourceVersionId); assert.equal(mine.rows[0].recordContentHash, latestSourceContentHash);
  denied(await concurrent(transaction(sourceCall(ownMember), "native_staff_recovery_source_crossowner", selfJwt)));
  const otherBranch = sql(`select id from public.branches where organization_id='${org}' and id<>'${branch}'`).trim();
  assert.match(otherBranch, /^[a-f0-9-]{36}$/u);
  denied(await concurrent(transaction(sourceCall(member, 1, otherBranch), "native_staff_recovery_source_crossbranch", selfJwt)));
  const management = sourcesSnapshotSchema.parse(jsonResult(await concurrent(transaction(sourceCall(null), "native_staff_recovery_source_manager", reviewJwt))));
  assert.equal(management.actorUserId, reviewer); assert.equal(management.canManageDocuments, true); assert.equal(management.rows.length, 2);
  assert.ok(management.rows.every(row => row.canUpload));
  const otherOwner = await read(original.request, reviewJwt, reviewer);
  assert.equal(otherOwner.status, "not_found"); assert.equal(otherOwner.receipt, null); assert.equal(otherOwner.persisted, false);
  evidence.assertions.push("Approved nonexecutive manager reads exact sources; readonly self sees only own saved version/hash; crossowner source rejects and original key cannot disclose another uploader receipt");
  evidence.finalCounts = counts();

  for (const migration of evidence.migrations) {
    const source = await readFile(join(root, "supabase/migrations", migration.name), "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), migration.sha256, `Migration changed during native verification: ${migration.name}`);
  }
  assert.equal(createHash("sha256").update(await readFile(testPath)).digest("hex"), evidence.testSha256,
    "SQL fixture/tests changed during native verification; rerun frozen sources");
  assert.equal(createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"), evidence.runnerSha256,
    "Native runner changed during verification; rerun frozen sources");
  for (const source of evidence.schemaSources) assert.equal(createHash("sha256").update(await readFile(join(root, source.name))).digest("hex"), source.sha256,
    `Recovery parser changed during verification: ${source.name}`);
  evidence.limitations = ["Local synthetic SQL/Auth/storage metadata only; not scanner bytes, HTTP, hosted Auth or production acceptance",
    "Final live authority checks do not universally serialize every authority-row change through COMMIT",
    "No UI, provided certificate append or formal qualification integration is established"];
  assert.ok(evidence.probes.length >= 4, "A compile-only run is not this native recovery safety gate");
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Staff certificate document recovery native evidence: ${join(runtime, "evidence.json")}.`);
} catch (error) {
  testFailure = error; throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  for (const child of children) child.kill("SIGTERM");
  if (testFailure) {
    try { await writeFile(join(runtime, "failure.json"), JSON.stringify({ syntheticOnly: true, error: testFailure.message, evidence }, null, 2)); }
    catch (error) { cleanupErrors.push(error); }
  }
  await cleanupNativeData({ started, testFailure, cleanupErrors,
    stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
