// Exact deployment migrations; Unix-socket-only PG17.11+, synthetic actual
// Google admission. This is candidate-read evidence, never clinical approval.
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
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute native PostgreSQL 17 bin directory (minor >=11); no hosted URL.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-questionnaire-readiness-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55465", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
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
  assert.ok(line, `Missing synthetic ${key} marker`); return JSON.parse(line.slice(key.length + 1));
};
const connection = () => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  const completion = new Promise((done) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ status: -1, stdout, stderr: error.message }));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  return { child, completion, output: () => stdout };
};
const concurrent = (input) => { const c = connection(); c.child.stdin.end(input); return c.completion; };
const holders = new Set();
const auditLock = "hashtextextended('native-questionnaire-readiness-audit-pause',0)";
const hold = async () => {
  const c = connection(); let released = false;
  const holder = { release: async () => { if (released) return; released = true; c.child.stdin.end("commit;\n"); const result = await c.completion; holders.delete(holder); assert.equal(result.status, 0, result.stderr); } };
  holders.add(holder);
  c.child.stdin.write(`begin;select pg_advisory_xact_lock(${auditLock});select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10_000;
  while (!/^READY=\d+$/m.test(c.output())) {
    if (c.child.exitCode !== null || Date.now() >= deadline) throw new Error("Owned audit lock holder failed readiness.");
    await new Promise((done) => setTimeout(done, 25));
  }
  return holder;
};
const waitBlocked = async (name) => {
  assert.match(name, /^native_readiness_[a-z_]+$/);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (sql(`select count(*) from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim() === "1") return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("Independent readiness read backend was not observed waiting.");
};

// Transpile the checked-in server-only pure contracts; no bundler, hosted
// origin, dependency installation or replacement of database authority.
const require = createRequire(import.meta.url);
const Module = require("node:module"); const ts = require("typescript");
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) request = join(root, "src", request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
Module._load = function (request, ...rest) { return request === "server-only" ? {} : originalLoad.call(this, request, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { QUESTIONNAIRE_FORMS } = require(join(root, "src/lib/questionnaire-assessments/forms.ts"));
const { buildQuestionnaireRuleCatalogEntry } = require(join(root, "src/lib/questionnaire-assessments/rule-catalog.ts"));
const { buildQuestionnaireValidationCatalogEntry } = require(join(root, "src/lib/questionnaire-assessments/validation-catalog.ts"));
const { buildQuestionnaireReadinessCatalogEntry } = require(join(root, "src/lib/questionnaire-assessments/readiness-catalog.ts"));
const { buildQuestionnaireReadinessReport } = require(join(root, "src/lib/questionnaire-assessments/readiness-source.ts"));
const { evaluateQuestionnaireValidationCandidate } = require(join(root, "src/lib/questionnaire-assessments/validation-evaluator.ts"));
const org = "a7500000-0000-4000-8000-000000000001"; const branch = "a7600000-0000-4000-8000-000000000001";
const actor = "a7100000-0000-4000-8000-000000000001"; const client = "a7800000-0000-4000-8000-000000000001";
const nonce = "a7c00000-0000-4000-8000-000000000001";
const evidence = { syntheticOnly: true, hosted: false, formalApproval: false, migrations: [], forms: [], concurrency: [] };
let started = false; let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim(); const version = engine.match(/PostgreSQL\) 17\.(\d+)/);
  assert.ok(version && Number(version[1]) >= 11, "Native readiness requires PostgreSQL 17.11 or newer security minor.");
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c statement_timeout=20000`, "-w", "start"]);
  started = true; sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 153, "Frozen exact migration set including original import operation locator is required.");
  assert.equal(migrations.at(-1), "20260927171515_import_upload_operation_locator.sql");
  const oldIdentity = () => sql("select jsonb_build_object('catalog',(select jsonb_agg(jsonb_build_object('hash',catalog_hash,'canonical',canonical_json) order by form_key) from private.questionnaire_rule_catalog),'authority',md5(pg_get_functiondef('private.questionnaire_assessment_authority(uuid,uuid,uuid,text,text)'::regprocedure)),'writer',md5(pg_get_functiondef('public.mutate_questionnaire_assessment(uuid,uuid,jsonb,uuid)'::regprocedure)),'activation',(select count(*) from private.questionnaire_rule_activations),'retirement',(select count(*) from private.questionnaire_rule_retirements));").trim();
  let previousIdentity;
  for (const name of migrations) {
    if (name === "20260926174621_questionnaire_readiness_candidate_catalog.sql") previousIdentity = oldIdentity();
    const source = await readFile(join(root, "supabase/migrations", name), "utf8"); sql(source);
    evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  assert.ok(previousIdentity); assert.equal(oldIdentity(), previousIdentity, "144-to-153 upgrade preserves original v1 catalog bytes, authority/writer and all adoption/retirement state.");
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const suite = await readFile(join(root, "supabase/tests/questionnaire_readiness_source.test.sql"), "utf8");
  const expected = Number(suite.match(/select\s+plan\((\d+)\)/i)?.[1]); const tap = sql(suite);
  assert.equal(tap.split("\n").filter((line) => /^ok \d+\b/.test(line)).length, expected, tap);
  assert.doesNotMatch(tap, /^not ok \d+\b|^# Looks like/m);
  console.log(`${engine}; exact ${migrations.length}/${migrations.length} migrations; ${expected}/${expected} native pgTAP assertions.`);
  const fixture = suite.slice(0, suite.indexOf("create temporary table readiness_results")).replace(/select\s+plan\(\d+\);/i, "");
  assert.ok(fixture.includes("auth.mfa_amr_claims") && fixture.includes("private.staff_google_access_grants"));
  const setup = sql(`${fixture}select pg_temp.history_login();select 'JWT='||current_setting('request.jwt.claims');commit;`);
  const jwt = marker(setup, "JWT");
  const transaction = (call, name = "native_readiness_read") => `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(JSON.stringify(jwt))},true);set local role authenticated;${call};commit;`;
  const mutate = (payload, key) => `select 'RESULT='||public.mutate_questionnaire_assessment('${org}','${branch}',${quote(JSON.stringify(payload))}::jsonb,'${key}')::text`;
  const read = (formKey, receipt) => `select 'RESULT='||public.questionnaire_assessment_readiness_source('${org}','${branch}',${quote(formKey)},'${client}','${receipt.versionId}','${receipt.contentHash}','${nonce}')::text`;
  const counts = () => JSON.parse(sql(`select jsonb_build_object('versions',(select count(*) from public.questionnaire_assessment_versions),'operations',(select count(*) from private.questionnaire_assessment_operations),'activations',(select count(*) from private.questionnaire_rule_activations),'reauth',(select count(*) from private.reauth_events));`).trim());
  const catalogs = JSON.parse(sql("select jsonb_agg(jsonb_build_object('formKey',b.form_key,'bundleHash',b.bundle_hash,'canonicalJson',b.canonical_json,'scoringCanonicalJson',s.canonical_json,'validationCanonicalJson',v.canonical_json)) from private.questionnaire_readiness_catalog b join private.questionnaire_rule_catalog s on s.catalog_hash=b.scoring_catalog_hash join private.questionnaire_validation_catalog v on v.validation_catalog_hash=b.validation_catalog_hash;").trim());
  const operations = [];
  for (const [index, formKey] of Object.keys(QUESTIONNAIRE_FORMS).entries()) {
    const scoring = buildQuestionnaireRuleCatalogEntry(formKey); const validation = buildQuestionnaireValidationCatalogEntry(formKey); const bundle = buildQuestionnaireReadinessCatalogEntry(formKey);
    const stored = catalogs.find((c) => c.formKey === formKey);
    assert.equal(stored.bundleHash, bundle.bundleHash); assert.equal(stored.canonicalJson, bundle.canonicalJson);
    assert.equal(stored.scoringCanonicalJson, scoring.canonicalJson); assert.equal(stored.validationCanonicalJson, validation.canonicalJson);
    const answers = Object.fromEntries(scoring.manifest.rules.items.map((item) => [item.id, { state: "answered", value: item.choices[0].value }]));
    const context = formKey === "spmsq" ? { education_adjustment: "middle_or_high_school" } : formKey === "mna_sf" ? { height_cm: "170.0", weight_kg: "50.0" } : {};
    const today = sql("select (clock_timestamp() at time zone 'Asia/Taipei')::date;").trim();
    const payload = { action: "create", client_id: client, form_key: formKey, form_version: scoring.formVersion, assessed_on: today, answers, context };
    const receipt = marker(sql(transaction(mutate(payload, `a7d00000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`))), "RESULT");
    const before = counts(); const source = marker(sql(transaction(read(formKey, receipt))), "RESULT");
    const report = buildQuestionnaireReadinessReport(source, { organizationId: org, branchId: branch, actorUserId: actor, formKey, clientId: client, versionId: receipt.versionId, contentHash: receipt.contentHash, readNonce: nonce });
    assert.deepEqual(report.candidate, evaluateQuestionnaireValidationCandidate(validation, scoring, answers, context));
    assert.equal(report.candidate.status, "complete"); assert.equal(report.signable, false); assert.equal(report.formalScore, null);
    assert.deepEqual(report.blockers, ["source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable"]);
    assert.deepEqual(counts(), before, "read changes no clinical record, operation, adoption or reauth");
    operations.push({ formKey, receipt, payload }); evidence.forms.push({ formKey, bundleHash: bundle.bundleHash, candidateStatus: report.candidate.status, signable: false });
  }
  console.log("All nine real admitted writes -> exact original immutable DB content hash -> actual RPC JSON -> Node candidate report; all catalog bytes match; no clinical/sign/adoption/MFA side effect.");

  // An audit barrier makes after-wait state changes deterministic, not inferred
  // from an artificial sleep or replaced authorization predicate.
  sql(`create schema native_test;create function native_test.pause_readiness_audit() returns trigger language plpgsql as $$begin if new.metadata->>'workflow'='questionnaire_readiness_source_v1' then perform pg_advisory_xact_lock(${auditLock});end if;return new;end;$$;create trigger native_pause_readiness_audit before insert on public.audit_events for each row execute function native_test.pause_readiness_audit();`);
  const initial = operations[0];
  const auditCount = () => sql("select count(*) from public.audit_events where metadata->>'workflow'='questionnaire_readiness_source_v1';").trim();
  const probe = async (name, change, expectedCode, restore) => {
    const before = counts(); const auditBefore = auditCount(); const holder = await hold();
    const resultPromise = concurrent(transaction(read(initial.formKey, initial.receipt), name));
    try { await waitBlocked(name); await change(); } finally { await holder.release(); }
    try {
      const result = await resultPromise; assert.notEqual(result.status, 0, result.stdout);
      assert.ok(result.stderr.includes(expectedCode), result.stderr); assert.doesNotMatch(result.stdout, /^RESULT=/m);
      assert.deepEqual(counts(), before); assert.equal(auditCount(), auditBefore);
      evidence.concurrency.push({ name, expectedCode, outputExcluded: true, failedAuditRolledBack: true });
    } finally { if (restore) await restore(); }
  };
  await probe("native_readiness_organization", () => sql(`update public.organizations set is_active=false where id='${org}';`), "42501", () => sql(`update public.organizations set is_active=true where id='${org}';`));
  await probe("native_readiness_assignment", () => sql(`update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where client_id='${client}';`), "42501", () => sql(`update public.client_assignments set ends_at=null where client_id='${client}';`));
  await probe("native_readiness_google", () => sql(`update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}';`), "42501", () => sql(`update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}';`));
  await probe("native_readiness_read_grant", () => sql("update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour' from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='questionnaire_cognition.read';"), "42501", () => sql("update public.role_permissions rp set granted_at=clock_timestamp()-interval '1 day' from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='questionnaire_cognition.read';"));
  // Revision commits while read waits. The old request is not relabelled current.
  const holder = await hold(); const pending = concurrent(transaction(read(initial.formKey, initial.receipt), "native_readiness_revision"));
  let revised;
  try {
    await waitBlocked("native_readiness_revision");
    const payload = { ...initial.payload, action: "revise", assessment_key: initial.receipt.assessmentKey, previous_version_id: initial.receipt.versionId, expected_version: 1 };
    revised = marker(sql(transaction(mutate(payload, "a7d00000-0000-4000-8000-000000000050"), "native_readiness_write")), "RESULT");
  } finally { await holder.release(); }
  const revisionResult = await pending; assert.notEqual(revisionResult.status, 0); assert.ok(revisionResult.stderr.includes("40001")); assert.doesNotMatch(revisionResult.stdout, /^RESULT=/m);
  const olderSource = marker(sql(transaction(read(initial.formKey, initial.receipt))), "RESULT");
  assert.equal(olderSource.draft.versionId, initial.receipt.versionId); assert.equal(olderSource.currentVersionId, revised.versionId);
  const olderReport = buildQuestionnaireReadinessReport(olderSource, { organizationId: org, branchId: branch, actorUserId: actor, formKey: initial.formKey, clientId: client, versionId: initial.receipt.versionId, contentHash: initial.receipt.contentHash, readNonce: nonce });
  assert.ok(olderReport.blockers.includes("version_superseded"));
  const independentHolder = await hold(); const independentRead = concurrent(transaction(read(initial.formKey, initial.receipt), "native_readiness_independent"));
  try { await waitBlocked("native_readiness_independent"); sql(transaction(mutate(initial.payload, "a7d00000-0000-4000-8000-000000000051"), "native_readiness_write")); }
  finally { await independentHolder.release(); }
  const independentResult = await independentRead; assert.equal(independentResult.status, 0, independentResult.stderr);
  assert.equal(marker(independentResult.stdout, "RESULT").currentVersionId, revised.versionId);
  evidence.concurrency.push({ name: "same_chain_revision", expectedCode: "40001", olderSourceStillReadable: true }, { name: "independent_assessment", sameChainHeadPreserved: true });
  console.log("Observed independent PostgreSQL backends: organization/assignment/Google revocation after audit wait ->42501/no payload/audit rollback; same-chain revise ->40001; older source stays superseded; another assessment cannot replace its head.");
  sql("drop trigger native_pause_readiness_audit on public.audit_events;drop schema native_test cascade;");
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Private synthetic readiness evidence: ${join(runtime, "evidence.json")}`);
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors,
    stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
