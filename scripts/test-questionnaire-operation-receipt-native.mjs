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
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-questionnaire-operation-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55466", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
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
const auditLock = "hashtextextended('native-questionnaire-operation-audit-pause',0)";
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
  assert.match(name, /^native_receipt_[a-z_]+$/);
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
const { parseQuestionnaireOperationReceipt } = require(join(root, "src/lib/questionnaire-assessments/operation-receipt.ts"));
const org = "a7500000-0000-4000-8000-000000000001", branch = "a7600000-0000-4000-8000-000000000001";
const actor = "a7100000-0000-4000-8000-000000000001", client = "a7800000-0000-4000-8000-000000000001", nonce = "a7c00000-0000-4000-8000-000000000001";
const evidence = { syntheticOnly: true, hosted: false, formalApproval: false, migrations: [], forms: [], concurrency: [] };
let started = false, testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim(), version = engine.match(/PostgreSQL\) 17\.(\d+)/);
  assert.ok(version && Number(version[1]) >= 11, "Native receipt gate requires PostgreSQL 17.11+.");
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", "-k " + runtime + " -p " + env.PGPORT + " -c listen_addresses='' -c statement_timeout=20000", "-w", "start"]);
  started = true; sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 149); assert.equal(migrations.at(-1), "20260927132511_staff_certificate_document_recovery.sql");
  const identity = () => sql("select jsonb_build_object('catalog',(select jsonb_agg(jsonb_build_object('hash',catalog_hash,'canonical',canonical_json) order by form_key) from private.questionnaire_rule_catalog),'validation',(select jsonb_agg(canonical_json order by form_key) from private.questionnaire_validation_catalog),'bundles',(select jsonb_agg(canonical_json order by form_key) from private.questionnaire_readiness_catalog),'authority',md5(pg_get_functiondef('private.questionnaire_assessment_authority(uuid,uuid,uuid,text,text)'::regprocedure)),'writer',md5(pg_get_functiondef('public.mutate_questionnaire_assessment(uuid,uuid,jsonb,uuid)'::regprocedure)),'core',md5(pg_get_functiondef('private.mutate_questionnaire_assessment_core_v1(uuid,uuid,jsonb,uuid)'::regprocedure)),'activations',(select count(*) from private.questionnaire_rule_activations),'retirements',(select count(*) from private.questionnaire_rule_retirements));").trim();
  let beforeUpgrade;
  for (const name of migrations) {
    if (name === "20260927111927_questionnaire_operation_receipt.sql") beforeUpgrade = identity();
    const source = await readFile(join(root, "supabase/migrations", name), "utf8"); sql(source);
    evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  assert.ok(beforeUpgrade); assert.equal(identity(), beforeUpgrade, "Receipt addition preserves exact catalog bytes, authority, writer and formal policy state.");
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const suite = await readFile(join(root, "supabase/tests/questionnaire_operation_receipt.test.sql"), "utf8");
  const expectedTap = Number(suite.match(/select\s+plan\((\d+)\)/i)?.[1]), tap = sql(suite);
  assert.doesNotMatch(tap, /^not ok \d+\b|^# Looks like/m); assert.equal(tap.split("\n").filter(line => /^ok \d+\b/.test(line)).length, expectedTap, tap);
  console.log(engine + "; exact " + migrations.length + " migrations; " + expectedTap + "/" + expectedTap + " native pgTAP assertions.");
  const fixture = suite.slice(0, suite.indexOf("create temporary table receipt_payloads")).replace(/select\s+plan\(\d+\);/i, "");
  assert.ok(fixture.includes("auth.mfa_amr_claims") && fixture.includes("private.staff_google_access_grants"));
  const jwt = marker(sql(fixture + "select pg_temp.history_login();select 'JWT='||current_setting('request.jwt.claims');commit;"), "JWT");
  const transaction = (call, name = "native_receipt_read", timezone = "UTC") =>
    "begin;set local application_name=" + quote(name) + ";set local time zone " + quote(timezone) + ";select set_config('request.jwt.claims'," + quote(JSON.stringify(jwt)) + ",true);set local role authenticated;" + call + ";commit;";
  const write = (payload, key) => "select 'RESULT='||public.mutate_questionnaire_assessment('" + org + "','" + branch + "'," + quote(JSON.stringify(payload)) + "::jsonb,'" + key + "')::text";
  const read = (form, action, key) => "select 'RESULT='||public.questionnaire_assessment_operation_receipt('" + org + "','" + branch + "'," + quote(form) + ",'" + client + "'," + quote(action) + ",'" + key + "','" + nonce + "')::text";
  const check = (proof, formKey, action, key, payload) => parseQuestionnaireOperationReceipt(proof, {
    organizationId: org, branchId: branch, actorUserId: actor, clientId: client, formKey, action, idempotencyKey: key, nonce,
    request: { action, clientId: client, formKey, formVersion: payload.form_version, assessedOn: payload.assessed_on, answers: payload.answers,
      context: payload.context, ...(action === "revise" ? { assessmentKey: payload.assessment_key, previousVersionId: payload.previous_version_id, expectedVersion: payload.expected_version } : {}) },
  });
  const counts = () => JSON.parse(sql("select jsonb_build_object('versions',(select count(*) from public.questionnaire_assessment_versions),'operations',(select count(*) from private.questionnaire_assessment_operations),'reauth',(select count(*) from private.reauth_events),'adoptions',(select count(*) from private.questionnaire_rule_activations),'retirements',(select count(*) from private.questionnaire_rule_retirements));").trim());
  const operations = [], today = sql("select (clock_timestamp() at time zone 'Asia/Taipei')::date;").trim();
  for (const [index, formKey] of Object.keys(QUESTIONNAIRE_FORMS).entries()) {
    const catalog = buildQuestionnaireRuleCatalogEntry(formKey);
    const payload = { action: "create", client_id: client, form_key: formKey, form_version: catalog.formVersion, assessed_on: today,
      answers: Object.fromEntries(catalog.manifest.rules.items.map(item => [item.id, { state: "answered", value: item.choices[0].value }])),
      context: formKey === "spmsq" ? { education_adjustment: "middle_or_high_school" } : formKey === "mna_sf" ? { height_cm: "170.0", weight_kg: "50.0" } : {} };
    const key = "a7d00000-0000-4000-8000-" + String(index + 1).padStart(12, "0");
    const original = marker(sql(transaction(write(payload, key), "native_receipt_write", "Asia/Taipei")), "RESULT");
    const revisePayload = { ...payload, action: "revise", assessment_key: original.assessmentKey, previous_version_id: original.versionId, expected_version: 1 };
    const reviseKey = "a7d00000-0000-4000-8000-" + String(index + 101).padStart(12, "0");
    const revised = marker(sql(transaction(write(revisePayload, reviseKey), "native_receipt_write", "UTC")), "RESULT");
    const before = counts();
    for (const timezone of ["UTC", "Asia/Taipei", "America/New_York"]) {
      const proof = check(marker(sql(transaction(read(formKey, "create", key), "native_receipt_read", timezone)), "RESULT"), formKey, "create", key, payload);
      const revision = check(marker(sql(transaction(read(formKey, "revise", reviseKey), "native_receipt_read", timezone)), "RESULT"), formKey, "revise", reviseKey, revisePayload);
      assert.deepEqual(proof.receipt, original); assert.deepEqual(revision.receipt, revised); assert.equal(proof.draft.version, 1); assert.equal(revision.draft.version, 2);
      assert.equal(proof.request.assessment_key, null); assert.equal(proof.request.previous_version_id, null); assert.equal(proof.request.expected_version, 0);
      assert.equal(revision.request.previous_version_id, original.versionId);
    }
    assert.deepEqual(counts(), before);
    operations.push({ formKey, key, payload, original, reviseKey, revisePayload, revised });
    evidence.forms.push({ formKey, createVersionId: original.versionId, reviseVersionId: revised.versionId, originalWireAcrossThreeTimezones: true, nodeProofValidated: true });
  }
  console.log("Nine actual Google AAL1 create/revise -> original immutable receipt RPC -> strict Node proof; UTC/Taipei/New York wire preservation; no write/MFA/adoption changes.");

  // A second backend reads committed state while the original actor's real
  // write remains open. No production authority predicate is replaced.
  const first = operations[0];
  async function heldWrite(key, finish) {
    const before = counts(), c = connection(); let released = false;
    const owner = { release: async () => { if (released) return; released = true; c.child.stdin.end(finish + ";\n"); const result = await c.completion; holders.delete(owner); assert.equal(result.status, 0, result.stderr); } };
    holders.add(owner);
    c.child.stdin.write(transaction(write(first.payload, key), "native_receipt_inflight").replace(/commit;$/, "") + "\n");
    const deadline = Date.now() + 10_000;
    while (!/^RESULT=/m.test(c.output())) {
      if (c.child.exitCode !== null || Date.now() >= deadline) throw new Error("Real write did not reach uncommitted receipt.");
      await new Promise(done => setTimeout(done, 25));
    }
    const absent = marker(sql(transaction(read(first.formKey, "create", key))), "RESULT");
    assert.equal(absent.status, "not_found"); assert.equal(absent.receipt, null); assert.equal(absent.persisted, false); assert.deepEqual(counts(), before);
    await owner.release();
    const after = marker(sql(transaction(read(first.formKey, "create", key))), "RESULT");
    assert.equal(after.status, finish === "commit" ? "committed" : "not_found");
    if (finish === "rollback") assert.deepEqual(counts(), before); else check(after, first.formKey, "create", key, first.payload);
    evidence.concurrency.push({ name: "real_uncommitted_" + finish, absentDoesNotTakeWriteLock: true, finalStatus: after.status });
  }
  await heldWrite("a7d00000-0000-4000-8000-000000000201", "commit");
  await heldWrite("a7d00000-0000-4000-8000-000000000202", "rollback");

  sql("create schema native_test;create function native_test.pause_receipt_audit() returns trigger language plpgsql as $$begin if new.metadata->>'workflow'='questionnaire_own_operation_receipt_v1' then perform pg_advisory_xact_lock(" + auditLock + ");end if;return new;end;$$;create trigger native_pause_receipt_audit before insert on public.audit_events for each row execute function native_test.pause_receipt_audit();");
  const auditCount = () => sql("select count(*) from public.audit_events where metadata->>'workflow'='questionnaire_own_operation_receipt_v1';").trim();
  const probe = async (name, change, restore, expectedCode = "42501") => {
    const before = counts(), auditBefore = auditCount(), holder = await hold();
    const pending = concurrent(transaction(read(first.formKey, "create", first.key), name));
    try { await waitBlocked(name); await change(); } finally { await holder.release(); }
    try {
      const result = await pending; assert.notEqual(result.status, 0, result.stdout); assert.ok(result.stderr.includes(expectedCode), result.stderr);
      assert.doesNotMatch(result.stdout, /^RESULT=/m); assert.deepEqual(counts(), before); assert.equal(auditCount(), auditBefore);
      evidence.concurrency.push({ name, expectedCode, noPayload: true, auditRolledBack: true });
    } finally { if (restore) await restore(); }
  };
  const update = (table, set, where) => sql("update " + table + " set " + set + " where " + where + ";");
  await probe("native_receipt_assignment", () => update("public.client_assignments", "ends_at=clock_timestamp()-interval '1 second'", "client_id='" + client + "' and assignee_user_id='" + actor + "'"), () => update("public.client_assignments", "ends_at=null", "client_id='" + client + "' and assignee_user_id='" + actor + "'"));
  await probe("native_receipt_google", () => update("private.staff_google_access_grants", "enabled=false", "allowed_user_id='" + actor + "'"), () => update("private.staff_google_access_grants", "enabled=true", "allowed_user_id='" + actor + "'"));
  await probe("native_receipt_branch", () => update("public.branches", "is_active=false", "id='" + branch + "'"), () => update("public.branches", "is_active=true", "id='" + branch + "'"));
  await probe("native_receipt_session", () => update("auth.sessions", "not_after=clock_timestamp()-interval '1 second'", "id='a7300000-0000-4000-8000-000000000001'"), () => update("auth.sessions", "not_after=null", "id='a7300000-0000-4000-8000-000000000001'"));
  const grantWhere = " from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='questionnaire_cognition.read';";
  await probe("native_receipt_read_grant", () => sql("update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour'" + grantWhere), () => sql("update public.role_permissions rp set granted_at=clock_timestamp()-interval '1 day'" + grantWhere));
  const originalJson = sql("select receipt::text from private.questionnaire_assessment_operations where actor_user_id='" + actor + "' and idempotency_key='" + first.key + "';").trim();
  const changeReceipt = expression => sql("begin;alter table private.questionnaire_assessment_operations disable trigger questionnaire_assessment_operations_append_only;update private.questionnaire_assessment_operations set receipt=" + expression + " where actor_user_id='" + actor + "' and idempotency_key='" + first.key + "';alter table private.questionnaire_assessment_operations enable trigger questionnaire_assessment_operations_append_only;commit;");
  await probe("native_receipt_source_changed", () => changeReceipt("receipt||'{\"synthetic_corruption\":true}'"), () => changeReceipt(quote(originalJson) + "::jsonb"), "23514");
  sql("drop trigger native_pause_receipt_audit on public.audit_events;drop schema native_test cascade;");
  assert.equal(identity(), beforeUpgrade, "Tests retain original catalog, writer/authority identities and no formal adoption.");
  console.log("Observed real uncommitted commit/rollback; blocked-audit revocation of assignment/Google/branch/session/read grant ->42501; original source changed ->23514; no payload and failed-read audit rollback.");
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Private synthetic original-receipt evidence: " + join(runtime, "evidence.json"));
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors,
    stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
