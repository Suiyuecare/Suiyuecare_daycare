// Disposable native PostgreSQL only; never accepts a URL or hosted credentials.
// Auth/Storage rows below are synthetic. No authorization helper is replaced.
// Run: PUBLICATION_REVISION_NATIVE_PG_BIN=/absolute/postgres/bin node scripts/test-publication-revision-native.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.PUBLICATION_REVISION_NATIVE_PG_BIN ?? process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set PUBLICATION_REVISION_NATIVE_PG_BIN to an absolute native PostgreSQL bin directory.");
const runtime = await mkdtemp("/tmp/daycare-publication-revision-native.");
const data = join(runtime, "data");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime,
  PGPORT: "55449", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const run = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const psqlArgs = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = input => run(join(binaries, "psql"), psqlArgs, input);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const receipt = output => JSON.parse(output.split("\n").find(line => line.startsWith("RESULT="))?.slice(7) ?? "null");
const concurrentSql = input => new Promise(resolveResult => {
  const child = spawn(join(binaries, "psql"), psqlArgs, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", value => { stdout += value; });
  child.stderr.on("data", value => { stderr += value; });
  child.on("error", error => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", status => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
// The holder remains open until a separate pg_stat_activity probe proves that
// the tested RPC is blocked. A timing-only sleep is never concurrency evidence.
const hold = async statements => {
  const child = spawn(join(binaries, "psql"), psqlArgs, { cwd: root, env });
  let stdout = ""; let stderr = ""; let released = false;
  let readyResolve; let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  const finished = new Promise(resolveFinished => {
    child.stdout.on("data", value => {
      stdout += value;
      const match = stdout.match(/^NATIVE_LOCK_READY=(\d+)$/m);
      if (match) readyResolve(Number(match[1]));
    });
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", error => { readyReject(error); resolveFinished(-1); });
    child.on("close", status => { readyReject(new Error("Lock holder ended before readiness: " + stderr)); resolveFinished(status); });
  });
  const timeout = setTimeout(() => readyReject(new Error("Native publication holder readiness timed out")), 10_000);
  child.stdin.write(`begin;set local application_name='native_publication_holder';${statements};select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
  let pid;
  try { pid = await ready; }
  catch (error) { child.stdin.end("rollback;\n"); await finished; throw error; }
  finally { clearTimeout(timeout); }
  return { pid, release: async () => {
    if (released) return;
    released = true; child.stdin.end("commit;\n");
    if (await finished !== 0) throw new Error("Native holder failed: " + stderr);
  } };
};
const observeWait = async (holderPid, names) => {
  if (!Number.isInteger(holderPid) || names.some(name => !/^native_publication_[a-z0-9_]+$/.test(name))) throw new Error("Invalid lock probe");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const count = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names.map(quote).join(",")})
      and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0
      and (${holderPid}=0 or ${holderPid}=any(pg_blocking_pids(pid)));`).trim());
    if (count === names.length) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error("Expected real lock wait was not observed: " + names.join(", "));
};
const reject = (result, code, label) => {
  if (result.status === 0 || !result.stderr.includes(code) || /^RESULT=/m.test(result.stdout)) throw new Error(label + ": " + JSON.stringify(result));
};
const accept = (result, label) => {
  if (result.status !== 0 || !receipt(result.stdout)) throw new Error(label + ": " + JSON.stringify(result));
  return receipt(result.stdout);
};

let started = false;
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p 55449 -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  if (!process.argv.includes("--races-only")) {
    const suite = await readFile(join(root, "supabase/tests/custom_form_publication_revision.test.sql"), "utf8");
    const output = sql(suite);
    const expected = Number(suite.match(/select plan\((\d+)\)/)?.[1]);
    const passed = output.split("\n").filter(line => /^ok \d+\b/.test(line)).length;
    if (passed !== expected || /^not ok |^# Looks like/m.test(output)) throw new Error("Native publication revision SQL failed: " + output);
    console.log(`Native publication SQL assertions: ${passed}/${expected}.`);
  } else console.log("SQL assertion suite explicitly skipped; running native concurrency scenarios only.");
  // Reuse only committed synthetic Auth/Google/MFA fixture setup. No existing
  // authorization, publication or immutability function is replaced.
  const lifecycleSuite = await readFile(join(root, "supabase/tests/custom_form_version_lifecycle.test.sql"), "utf8");
  const marker = lifecycleSuite.indexOf("select ok((select relrowsecurity");
  if (marker < 0) throw new Error("Synthetic real-admission fixture boundary missing");
  const fixture = lifecycleSuite.slice(0, marker).replace(/select plan\(\d+\);/, "").replaceAll("pg_temp.", "private.publication_native_");
  const setup = sql(fixture + "select private.publication_native_custom_login();select 'FIRST='||current_setting('request.jwt.claims');select private.publication_native_second_login();select 'SECOND='||current_setting('request.jwt.claims');commit;");
  const firstJwt = setup.split("\n").find(line => line.startsWith("FIRST="))?.slice(6);
  const secondJwt = setup.split("\n").find(line => line.startsWith("SECOND="))?.slice(7);
  if (!firstJwt || !secondJwt) throw new Error("Synthetic actor claims missing");
  const org = "d8500000-0000-4000-8000-000000000001";
  const branch = "d8600000-0000-4000-8000-000000000001";
  const actor = "d8100000-0000-4000-8000-000000000001";
  const source = "d9400000-0000-4000-8000-000000000002";
  const key = n => "de900000-0000-4000-8000-" + String(n).padStart(12, "0");
  const definition = n => "de700000-0000-4000-8000-" + String(n).padStart(12, "0");
  const version = n => "de800000-0000-4000-8000-" + String(n).padStart(12, "0");
  const claims = (secondPerson = false) => "select set_config('request.jwt.claims'," + quote(secondPerson ? secondJwt : firstJwt) + ",true);set local role authenticated;";
  const transaction = (name, statement, secondPerson = false) => "begin;set local application_name=" + quote(name) + ";" + claims(secondPerson) + statement + "commit;";
  const makeDraft = n => sql("insert into public.form_definitions(id,organization_id,form_key,name,category,is_official) values(" +
    [definition(n), org, "tenant.custom.publication_native_" + n, "合成送審表單 " + n, "行政表單"].map(quote).join(",") + ",false);" +
    "insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json) select " +
    [version(n), definition(n)].map(quote).join(",") + ",1,'draft',(clock_timestamp() at time zone 'Asia/Taipei')::date,schema_json,scoring_json from public.form_versions where id=" + quote(source) + ";");
  const write = (action, n, formVersionId, requestId = null, baseRevision = null) => "select 'RESULT='||public.write_custom_form_publication_v2(" +
    [org, branch, key(n), JSON.stringify({ action, formVersionId, requestId, baseRevision, reason: ["withdraw", "return"].includes(action) ? "合成原生競態修訂原因" : null })].map(quote).join(",") + ")::text;";
  const makeRequest = (n, revision = 1, operation = n * 100) => {
    const result = receipt(sql(transaction("native_publication_request_setup", write("request", operation, version(n), null, revision))));
    if (!result?.event?.requestId || result.requestStatus !== "pending") throw new Error("Missing pending request fixture");
    return result;
  };
  const requestCount = n => Number(sql("select count(*) from public.form_publication_requests where form_version_id=" + quote(version(n))).trim());
  const draftRevision = n => Number(sql("select draft_revision from public.form_versions where id=" + quote(version(n))).trim());
  const save = (n, operation, baseRevision = 1) => "select 'RESULT='||public.save_custom_form_draft(" + [org, branch, version(n)].map(quote).join(",") + "," + baseRevision + "," + quote(key(operation)) +
    ",(select jsonb_build_object('formKey',d.form_key,'name',d.name,'category',d.category,'effectiveFrom',v.effective_from,'effectiveTo',v.effective_to,'schema',jsonb_set(v.schema_json,'{fields,0,label}',to_jsonb('合成修訂文字'::text))) from public.form_versions v join public.form_definitions d on d.id=v.form_definition_id where v.id=" + quote(version(n)) + "))::text;";
  let races = 0;

  makeDraft(1);
  const duplicateNames = ["native_publication_same_a", "native_publication_same_b"];
  const duplicateHolder = await hold("select pg_advisory_xact_lock(hashtextextended(" + quote("form-publish-definition:" + definition(1)) + ",0))");
  const duplicates = duplicateNames.map(name => concurrentSql(transaction(name, write("request", 101, version(1), null, 1))));
  try { await observeWait(0, duplicateNames); } finally { await duplicateHolder.release(); }
  const duplicateRows = (await Promise.all(duplicates)).map(result => accept(result, "Same-key request"));
  if (JSON.stringify(duplicateRows[0].event) !== JSON.stringify(duplicateRows[1].event) || duplicateRows.filter(row => row.replayed).length !== 1 || requestCount(1) !== 1) throw new Error("Same-key requests did not share one immutable event");
  races++;
  console.log("Observed duplicate request: one request/event and exact replay.");

  for (const action of ["withdraw", "return"]) {
    for (const approvalWins of [false, true]) {
      const n = 2 + (action === "return" ? 2 : 0) + (approvalWins ? 1 : 0);
      makeDraft(n);
      const request = makeRequest(n);
      const approval = write("approve", n * 100 + 1, version(n), request.event.requestId);
      const terminal = write(action, n * 100 + 2, version(n), request.event.requestId);
      const holder = await hold(claims(approvalWins || action === "return") + (approvalWins ? approval : terminal));
      const name = "native_publication_" + action + (approvalWins ? "_approval_first" : "_terminal_first");
      const pending = concurrentSql(transaction(name, approvalWins ? terminal : approval, approvalWins ? action === "return" : true));
      try { await observeWait(holder.pid, [name]); } finally { await holder.release(); }
      reject(await pending, "23514", "Approval/" + action + " losing operation");
      const status = sql("select status from public.form_publication_requests where id=" + quote(request.event.requestId)).trim();
      const formStatus = sql("select status from public.form_versions where id=" + quote(version(n))).trim();
      if (status !== (approvalWins ? "approved" : action === "return" ? "returned" : "withdrawn") || formStatus !== (approvalWins ? "published" : "draft")) throw new Error("Approval/terminal race produced mixed states");
      races++;
    }
  }
  console.log("Observed approve/withdraw and approve/return in both orders: exactly one terminal outcome, no partial publication.");

  for (const requestWins of [false, true]) {
    const n = requestWins ? 7 : 6;
    makeDraft(n);
    const request = makeRequest(n);
    sql(transaction("native_publication_rework_setup", write("withdraw", n * 100 + 1, version(n), request.event.requestId)));
    sql(transaction("native_publication_initial_edit", save(n, n * 100 + 2)));
    const submission = write("request", n * 100 + 3, version(n), null, 2);
    const editing = save(n, n * 100 + 4, 2);
    const holder = await hold(claims() + (requestWins ? submission : editing));
    const name = "native_publication_" + (requestWins ? "request_before_save" : "save_before_request");
    const pending = concurrentSql(transaction(name, requestWins ? editing : submission));
    try { await observeWait(holder.pid, [name]); } finally { await holder.release(); }
    reject(await pending, requestWins ? "23514" : "40001", "Save/resubmit stale operation");
    if (requestCount(n) !== (requestWins ? 2 : 1) || draftRevision(n) !== (requestWins ? 2 : 3)) throw new Error("Save/resubmit lost a draft revision or created a stale request");
    races++;
  }
  console.log("Observed edit/resubmit in both orders: stale revision rejected; pending request prevents further edit.");

  makeDraft(8);
  const original = makeRequest(8);
  sql(transaction("native_publication_resubmit_setup", write("withdraw", 801, version(8), original.event.requestId)));
  sql(transaction("native_publication_resubmit_edit", save(8, 802)));
  const resubmitHolder = await hold("select pg_advisory_xact_lock(hashtextextended(" + quote("form-publish-definition:" + definition(8)) + ",0))");
  const resubmitNames = ["native_publication_resubmit_a", "native_publication_resubmit_b"];
  const submissions = resubmitNames.map((name, i) => concurrentSql(transaction(name, write("request", 803 + i, version(8), null, 2))));
  try { await observeWait(0, resubmitNames); } finally { await resubmitHolder.release(); }
  const resubmitted = await Promise.all(submissions);
  if (resubmitted.filter(result => result.status === 0).length !== 1 || requestCount(8) !== 2) throw new Error("Concurrent resubmission created multiple pending histories: " + JSON.stringify(resubmitted));
  accept(resubmitted.find(result => result.status === 0), "Concurrent resubmit winner");
  const loser = resubmitted.find(result => result.status !== 0);
  if (!["23505", "23514"].some(code => loser.stderr.includes(code)) || /^RESULT=/m.test(loser.stdout)) throw new Error("Concurrent resubmit failed with unexpected/unsafe result");
  const oldReplay = receipt(sql(transaction("native_publication_old_request_replay", write("request", 800, version(8), null, 1))));
  if (!oldReplay.replayed || oldReplay.requestStatus !== "withdrawn" || JSON.stringify(oldReplay.event) !== JSON.stringify(original.event) || requestCount(8) !== 2) throw new Error("Old request replay falsely reopened or aliased a later submission");
  races++;
  console.log("Observed concurrent resubmission: one new request, immutable original terminal replay cannot resubmit.");

  sql("create function private.publication_native_audit_wait() returns trigger language plpgsql set search_path='' as $$begin " +
    "if current_setting('application_name') like 'native_publication_audit_%' then perform pg_advisory_xact_lock(hashtextextended('synthetic-publication-audit-boundary',0));end if;return new;end;$$;" +
    "create trigger publication_native_audit_wait before insert on public.audit_events for each row execute function private.publication_native_audit_wait();");
  const auditLock = "select pg_advisory_xact_lock(hashtextextended('synthetic-publication-audit-boundary',0))";
  const auditCount = () => Number(sql("select count(*) from public.audit_events").trim());
  makeDraft(9);
  const request9 = makeRequest(9);
  const beforeAudit9 = auditCount();
  const holder9 = await hold(auditLock);
  const name9 = "native_publication_audit_session_revoke";
  const pending9 = concurrentSql(transaction(name9, write("return", 901, version(9), request9.event.requestId), true));
  let error9;
  try {
    await observeWait(holder9.pid, [name9]);
    sql("update auth.sessions set not_after=clock_timestamp() where id='d8300000-0000-4000-8000-000000000011';");
  } catch (error) { error9 = error; } finally { await holder9.release(); }
  const result9 = await pending9;
  if (error9) throw error9;
  reject(result9, "42501", "Post-audit second-person session revoke");
  if (sql("select status from public.form_publication_requests where id=" + quote(request9.event.requestId)).trim() !== "pending" || auditCount() !== beforeAudit9) throw new Error("Revoked return retained mutation or audit");
  races++;

  makeDraft(10);
  const expiryChallenge = "de880000-0000-4000-8000-000000000001";
  sql("insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values(" +
    [expiryChallenge, actor, "d8300000-0000-4000-8000-000000000001"].map(quote).join(",") + ",repeat('e',64)," + quote(expiryChallenge) +
    ",now()-interval '17 minutes',now()-interval '16 minutes',now()-interval '11 minutes',now()-interval '15 minutes'+interval '2 seconds',now()-interval '15 minutes'+interval '2 seconds','totp',now()-interval '15 minutes'+interval '2 seconds');" +
    "update private.reauth_events set challenge_id=" + quote(expiryChallenge) + ",verified_at=(select factor_verified_at from private.reauth_challenges where id=" + quote(expiryChallenge) + ") where user_id=" + quote(actor) + ";");
  const expiry = Number(sql("select extract(epoch from factor_verified_at+interval '15 minutes')*1000 from private.reauth_challenges where id=" + quote(expiryChallenge)).trim());
  const beforeAudit10 = auditCount();
  const holder10 = await hold(auditLock);
  const name10 = "native_publication_audit_expiry";
  const pending10 = concurrentSql(transaction(name10, write("request", 1000, version(10), null, 1)));
  let error10;
  try {
    await observeWait(holder10.pid, [name10]);
    const deadline = Date.now() + 5000;
    while (Number(sql("select extract(epoch from clock_timestamp())*1000").trim()) <= expiry) {
      if (Date.now() > deadline) throw new Error("Synthetic 15-minute publication boundary did not arrive");
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
  } catch (error) { error10 = error; } finally { await holder10.release(); }
  const result10 = await pending10;
  if (error10) throw error10;
  reject(result10, "42501", "Post-audit actual 15-minute expiry");
  if (requestCount(10) !== 0 || auditCount() !== beforeAudit10 || draftRevision(10) !== 1) throw new Error("Expired publication retained request/audit or modified draft");
  races++;
  console.log(`Post-audit session revocation and real 15-minute expiry roll back. Total observed races: ${races}.`);
} finally {
  if (started) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
