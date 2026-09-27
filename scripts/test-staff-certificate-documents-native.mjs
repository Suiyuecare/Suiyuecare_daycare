// Synthetic, Unix-socket-only PostgreSQL verification. No hosted database,
// scanner network, Auth predicate replacement or formal qualification claim.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17 bin directory, minor >= 11; no hosted URL.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-staff-documents-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime,
  PGPORT: "55469", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
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
  } };
  holders.add(holder);
  current.child.stdin.write(`begin;set local application_name='native_staff_document_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  holder.pid = await ready(current); return holder;
};
const waitForBlocked = async (name, holderPid) => {
  assert.match(name, /^native_staff_document_[a-z_]+$/u);
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
  assert.equal(migrations.length, 152, "This evidence requires the exact current 152-migration baseline");
  assert.equal(migrations.at(-1), "20260927163540_import_upload_authority_fences.sql");
  for (const name of migrations) {
    const source = await readFile(join(root, "supabase/migrations", name), "utf8");
    try { sql(source); } catch (error) { throw new Error(`Exact migration ${name}: ${error.message}`); }
    evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const testSource = await readFile(join(root, "supabase/tests/staff_certificate_documents.test.sql"), "utf8");
  evidence.testSha256 = createHash("sha256").update(testSource).digest("hex");
  const tap = sql(testSource);
  const expected = Number(testSource.match(/select\s+plan\((\d+)\)/iu)?.[1] ?? tap.match(/^1\.\.(\d+)$/mu)?.[1]);
  const actual = tap.split("\n").filter(line => /^ok \d+\b/u.test(line)).length;
  assert.equal(actual, expected, tap); assert.doesNotMatch(tap, /^not ok \d+\b|^# Looks like/mu);
  evidence.pgTapAssertions = actual; evidence.compiledMigrations = migrations.length;
  console.log(`${engine}; exact ${migrations.length}/${migrations.length} migrations; ${actual}/${expected} pgTAP assertions.`);

  // The remaining probes use only the approved real Auth fixture, committed
  // into this isolated cluster. No authorization or append-only guard changes.
  const sentinel = "-- NATIVE_FIXTURE_END";
  assert.ok(testSource.includes(sentinel), "SQL fixture must expose a bounded native setup prefix");
  const fixturePrefix = testSource.slice(0, testSource.indexOf(sentinel)).replace(/select\s+(?:plan\(\d+\)|no_plan\(\));/iu, "");
  assert.ok(fixturePrefix.includes("private.staff_google_access_grants") && fixturePrefix.includes("auth.mfa_amr_claims"));
  const setup = sql(`${fixturePrefix}\nselect pg_temp.doc_login(1);select 'JWT='||current_setting('request.jwt.claims');
    select pg_temp.doc_login(2);select 'REVIEW_JWT='||current_setting('request.jwt.claims');
    select 'FIXTURE='||v::text from doc_data where k='native';commit;`);
  let jwt = marker(setup, "JWT");
  const originalJwt = jwt, reviewJwt = marker(setup, "REVIEW_JWT"), fixture = JSON.parse(marker(setup, "FIXTURE"));
  const { organizationId: org, branchId: branch, actorUserId: actor, targetMembershipId: member,
    certificateKey: cert, recordVersionId: versionId, recordContentHash: contentHash, reviewerUserId: reviewer } = fixture;
  for (const value of [org, branch, actor, member, cert, versionId, reviewer]) assert.match(value, /^[a-f0-9-]{36}$/u);
  assert.match(contentHash, /^[a-f0-9]{64}$/u);
  assert.notEqual(actor, reviewer); assert.notEqual(reviewer, fixture.targetUserId);
  const transaction = (call, name, claims = jwt, role = "authenticated") => {
    assert.match(name, /^native_staff_document_[a-z_]+$/u); assert.ok(["authenticated", "service_role"].includes(role));
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claims)},true);set local role ${role};${call};commit;`;
  };
  const counts = () => JSON.parse(sql(`select jsonb_build_object(
    'documents',(select count(*) from private.staff_certificate_documents),
    'scans',(select count(*) from private.staff_certificate_document_scans),
    'reviews',(select count(*) from private.staff_certificate_document_reviews),
    'operations',(select count(*) from private.staff_certificate_document_operations),
    'certificates',(select count(*) from public.staff_certificate_versions),
    'documentAudits',(select count(*) from public.audit_events where table_name like 'staff_certificate_document%'))`).trim());
  const input = key => ({ staffMembershipId: member, certificateKey: cert, recordVersionId: versionId,
    recordContentHash: contentHash, idempotency_key: key, sha256: "a".repeat(64), mimeType: "application/pdf", fileSizeBytes: 8 });
  let keyNumber = 100;
  const key = () => `ed900000-0000-4000-8000-${String(++keyNumber).padStart(12, "0")}`;
  const reserve = async () => {
    const request = input(key());
    const reserved = jsonResult(await concurrent(transaction(`select 'RESULT='||payload::text from public.reserve_staff_certificate_document('${org}','${branch}',${quote(JSON.stringify(request))}::jsonb)`, "native_staff_document_reserve")));
    sql(`insert into storage.objects(bucket_id,name,metadata) values('staff-certificate-documents',${quote(reserved.objectPath)},
      jsonb_build_object('mimetype','application/pdf','size',8))`);
    return { request, reserved };
  };
  const scanCall = document => `select 'RESULT='||payload::text from public.complete_staff_certificate_document_scan('${document.documentId}','${document.sha256}','clean','native-synthetic-scanner')`;
  const scan = document => concurrent(transaction(scanCall(document), "native_staff_document_scan", '{"role":"service_role"}', "service_role"));
  const reviewCall = (document, requestKey = key()) => `select 'RESULT='||payload::text from public.review_staff_certificate_document('${org}','${branch}',${quote(JSON.stringify({
    documentId: document.documentId, recordVersionId: versionId, recordContentHash: contentHash,
    decision: "verified", reason: "Synthetic independent review only", idempotency_key: requestKey,
  }))}::jsonb)`;
  const certLock = `select pg_advisory_xact_lock(hashtextextended('staff-certificate:${org}:${branch}:${cert}',0))`;
  const authorityCases = [
    ["target_stop", `update public.memberships set status='ended',ends_at=clock_timestamp() where id='${member}'`,
      `update public.memberships set status='active',ends_at=null where id='${member}'`],
    ["all_admission_revoke", `update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}';
      update private.executive_access_policy set enabled=false where allowed_user_id='${actor}'`,
      `update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}';
      update private.executive_access_policy set enabled=true where allowed_user_id='${actor}'`],
  ];
  for (const [name, revoke, restore] of authorityCases) {
    const { reserved } = await reserve(); const before = counts(), holder = await hold(certLock);
    const applicationName = `native_staff_document_scan_${name}`;
    const pending = concurrent(transaction(scanCall(reserved), applicationName, '{"role":"service_role"}', "service_role"));
    try {
      const waiters = await waitForBlocked(applicationName, holder.pid);
      sql(`begin;${revoke};commit;`);
      evidence.probes.push({ name, holderPid: holder.pid, waiters, revokedBeforeReleased: true });
    } finally { await holder.release(); }
    denied(await pending); assert.deepEqual(counts(), before, `${name}: no scan, operation or audit may commit`);
    sql(`begin;${restore};commit;`);
  }
  {
    const session = "ed120000-0000-4000-8000-000000000101";
    const recent = Number(sql("select floor(extract(epoch from clock_timestamp()-interval '15 minutes'+interval '5 seconds'))").trim());
    const oauth = recent - 240;
    const nearChallenge = "ed500000-0000-4000-8000-000000000101";
    sql(`begin;insert into auth.sessions(id,user_id,created_at,aal) values('${session}','${actor}',to_timestamp(${oauth})-interval '1 minute','aal2');
      insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
      ('ed130000-0000-4000-8000-000000000101','${session}',to_timestamp(${oauth}),to_timestamp(${oauth}),'oauth'),
      ('ed130000-0000-4000-8000-000000000102','${session}',to_timestamp(${recent}),to_timestamp(${recent}),'totp');
      insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
      created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
      values('${nearChallenge}','${actor}','${session}',repeat('e',64),'ed510000-0000-4000-8000-000000000101',
      to_timestamp(${recent})-interval '2 minutes','synthetic-expiring-before',to_timestamp(${recent})-interval '1 minute',
      to_timestamp(${recent})+interval '5 minutes',to_timestamp(${recent}),to_timestamp(${recent}),'synthetic-expiring-after','totp',to_timestamp(${recent}));
      insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
      values('${actor}','${session}','${nearChallenge}','aal2','totp',to_timestamp(${recent}));commit;`);
    const nearClaims = JSON.parse(jwt);
    nearClaims.session_id = session;
    nearClaims.amr = nearClaims.amr.map(claim => ({ ...claim, timestamp: claim.method === "totp" ? recent : oauth }));
    jwt = JSON.stringify(nearClaims);
    const { reserved } = await reserve(), before = counts(), holder = await hold(certLock);
    const name = "native_staff_document_scan_recent_expiration";
    const pending = concurrent(transaction(scanCall(reserved), name, '{"role":"service_role"}', "service_role"));
    try {
      const waiters = await waitForBlocked(name, holder.pid);
      const expiresAt = Number(sql(`select extract(epoch from c.factor_verified_at+interval '15 minutes')*1000
        from private.staff_certificate_documents d join private.reauth_challenges c on c.id=d.uploader_challenge_id
        where d.id='${reserved.documentId}'`).trim());
      assert.ok(Number.isFinite(expiresAt) && expiresAt < Date.now() + 15000, "Exact captured evidence must be near its real deadline");
      while (Date.now() <= expiresAt + 100) await new Promise(done => setTimeout(done, 100));
      evidence.probes.push({ name: "recent_expiration", holderPid: holder.pid, waiters, expiresAt,
        releasedAfterActualExpiry: Date.now() > expiresAt });
    } finally { await holder.release(); }
    denied(await pending); assert.deepEqual(counts(), before, "Expired captured MFA evidence must roll back scan and audit");
    jwt = originalJwt;
  }
  {
    const { reserved } = await reserve(); const clean = jsonResult(await scan(reserved));
    assert.equal(clean.scanStatus, "clean"); assert.equal(clean.signable, false); assert.equal(clean.serviceEligibility, "not_evaluated");
    const beforeSelf = counts();
    denied(await concurrent(transaction(reviewCall(reserved), "native_staff_document_review_self")));
    assert.deepEqual(counts(), beforeSelf, "Uploader cannot independently review their own file");
    sql(`create schema native_staff_document_test;
      create function native_staff_document_test.pause_review_audit() returns trigger language plpgsql set search_path='' as $$begin
        if new.table_name='staff_certificate_document_review' then
          perform pg_advisory_xact_lock(hashtextextended('native-staff-document-review-audit',0));end if;return new;end;$$;
      create trigger native_staff_document_pause before insert on public.audit_events
        for each row execute function native_staff_document_test.pause_review_audit();`);
    const before = counts(), holder = await hold("select pg_advisory_xact_lock(hashtextextended('native-staff-document-review-audit',0))");
    const name = "native_staff_document_review_audit_revoke", requestKey = key();
    const pending = concurrent(transaction(reviewCall(reserved, requestKey), name, reviewJwt));
    try {
      const waiters = await waitForBlocked(name, holder.pid);
      sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${reviewer}'`);
      evidence.probes.push({ name: "review_audit_revoke", holderPid: holder.pid, waiters, revokedBeforeReleased: true });
    } finally { await holder.release(); }
    denied(await pending); assert.deepEqual(counts(), before, "Review row, exact operation and its audit must roll back together");
    sql(`update private.staff_google_access_grants set enabled=true where allowed_user_id='${reviewer}';
      drop trigger native_staff_document_pause on public.audit_events;`);
    const approved = jsonResult(await concurrent(transaction(reviewCall(reserved, requestKey), "native_staff_document_review_success", reviewJwt)));
    assert.equal(approved.reviewedBy, reviewer); assert.equal(approved.decision, "verified"); assert.equal(approved.signable, false);
    const replayed = jsonResult(await concurrent(transaction(reviewCall(reserved, requestKey), "native_staff_document_review_replay", reviewJwt)));
    assert.deepEqual({ ...replayed, replayed: false }, approved, "Original independent review receipt must be byte-equivalent except replay flag");
    assert.equal(counts().reviews, before.reviews + 1); assert.equal(counts().operations, before.operations + 1);
    evidence.assertions.push("Clean scan plus independent review succeeds, uploader self-review denies, revoked audit-wait review rolls back, original-key retry creates exactly one immutable review");
  }
  // SQL owner provides a real source replacement statement using the original
  // writer, not direct inserts into an immutable certificate table.
  const replaceCertificateSql = `select * from public.append_staff_certificate('${org}','${branch}','correct','${cert}','${versionId}',1,'${member}',
    'Synthetic professional certificate','SYNTH-STAFF-001',(clock_timestamp() at time zone 'Asia/Taipei')::date-1,
    (clock_timestamp() at time zone 'Asia/Taipei')::date+365,'registered','verified','missing',null,null,
    'Synthetic actual certificate replacement','ed610000-0000-4000-8000-000000000101')`;
  {
    const { reserved } = await reserve(), before = counts(), holder = await hold(certLock);
    const name = "native_staff_document_scan_version_replace";
    const pending = concurrent(transaction(scanCall(reserved), name, '{"role":"service_role"}', "service_role"));
    try {
      const waiters = await waitForBlocked(name, holder.pid);
      await holder.release(`select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;${replaceCertificateSql}`);
      evidence.probes.push({ name: "version_replace", holderPid: holder.pid, waiters, replacementBeforeReleased: true });
    } finally { await holder.release(); }
    denied(await pending, "40001");
    const after = counts(); assert.equal(after.certificates, before.certificates + 1);
    assert.deepEqual({ ...after, certificates: before.certificates }, before, "Rejected old source scan must add no document evidence or audit");
  }
  // Other probes use a separate exact source so real replacement above is not
  // undone or hidden by weakening append-only guards.
  evidence.finalCounts = counts();
  for (const migration of evidence.migrations) {
    const source = await readFile(join(root, "supabase/migrations", migration.name), "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), migration.sha256, `Migration changed during native verification: ${migration.name}`);
  }
  assert.equal(createHash("sha256").update(await readFile(join(root, "supabase/tests/staff_certificate_documents.test.sql"))).digest("hex"),
    evidence.testSha256, "SQL fixture/tests changed during native verification; rerun frozen sources");
  assert.equal(createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"), evidence.runnerSha256,
    "Native runner changed during verification; rerun frozen sources");
  evidence.limitations = ["Local synthetic SQL/Auth/storage metadata only; not real scanner bytes, HTTP, hosted Auth or production acceptance",
    "Final live checks are not universal authority-row serialization through COMMIT", "No UI, provided certificate append, registration or service qualification integration is established"];
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Staff certificate documents native evidence: ${join(runtime, "evidence.json")}.`);
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
