// Disposable native PostgreSQL only; never accepts a URL or hosted credentials.
// Auth/Storage rows below are synthetic. No authorization helper is replaced.
// Run: CUSTOM_LIFECYCLE_NATIVE_PG_BIN=/absolute/postgres/bin node scripts/test-custom-form-lifecycle-native.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.CUSTOM_LIFECYCLE_NATIVE_PG_BIN ?? process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set CUSTOM_LIFECYCLE_NATIVE_PG_BIN to an absolute native PostgreSQL bin directory.");
const runtime = await mkdtemp("/tmp/daycare-form-lifecycle-native.");
const data = join(runtime, "data");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime,
  PGPORT: "55447", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
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
  const timeout = setTimeout(() => readyReject(new Error("Native lifecycle holder readiness timed out")), 10_000);
  child.stdin.write(`begin;set local application_name='native_lifecycle_holder';${statements};select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
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
  if (!Number.isInteger(holderPid) || names.some(name => !/^native_lifecycle_[a-z0-9_]+$/.test(name))) throw new Error("Invalid lock probe");
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
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p 55447 -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  const suite = await readFile(join(root, "supabase/tests/custom_form_version_lifecycle.test.sql"), "utf8");
  const output = sql(suite);
  const expected = Number(suite.match(/select plan\((\d+)\)/)?.[1]);
  const passed = output.split("\n").filter(line => /^ok \d+\b/.test(line)).length;
  if (passed !== expected || /^not ok |^# Looks like/m.test(output)) throw new Error("Native lifecycle assertions failed: " + output);
  console.log(`Native lifecycle SQL assertions: ${passed}/${expected}.`);
  const marker = suite.indexOf("select ok((select relrowsecurity");
  if (marker < 0) throw new Error("Synthetic lifecycle fixture boundary missing");
  const fixture = suite.slice(0, marker).replace(/select plan\(\d+\);/, "").replaceAll("pg_temp.", "private.lifecycle_native_");
  const setup = sql(fixture + "select private.lifecycle_native_custom_login();select 'FIRST='||current_setting('request.jwt.claims');select private.lifecycle_native_second_login();select 'SECOND='||current_setting('request.jwt.claims');commit;");
  const firstJwt = setup.split("\n").find(line => line.startsWith("FIRST="))?.slice(6);
  const secondJwt = setup.split("\n").find(line => line.startsWith("SECOND="))?.slice(7);
  if (!firstJwt || !secondJwt) throw new Error("Synthetic login claims missing");
  const org = "d8500000-0000-4000-8000-000000000001";
  const branch = "d8600000-0000-4000-8000-000000000001";
  const actor = "d8100000-0000-4000-8000-000000000001";
  const second = "d8100000-0000-4000-8000-000000000011";
  const secondSession = "d8300000-0000-4000-8000-000000000011";
  const source = "d9400000-0000-4000-8000-000000000002";
  const client = "db300000-0000-4000-8000-000000000001";
  const key = n => "db900000-0000-4000-8000-" + String(n).padStart(12, "0");
  const definition = n => "db700000-0000-4000-8000-" + String(n).padStart(12, "0");
  const version = n => "db800000-0000-4000-8000-" + String(n).padStart(12, "0");
  const claims = (secondPerson = false) => "select set_config('request.jwt.claims'," + quote(secondPerson ? secondJwt : firstJwt) + ",true);set local role authenticated;";
  const lifecycle = (action, n, formVersionId = source, requestId = null) => "select 'RESULT='||public.write_custom_form_lifecycle(" +
    [org, branch, key(n), JSON.stringify({ action, formVersionId, requestId, reason: "合成原生並行驗收原因" })].map(quote).join(",") + ")::text;";
  const transaction = (name, statement, secondPerson = false) => "begin;set local application_name=" + quote(name) + ";" + claims(secondPerson) + statement + "commit;";
  const makeVersion = n => sql("insert into public.form_definitions(id,organization_id,form_key,name,category,is_official) values(" +
    [definition(n), org, "tenant.custom.native_" + n, "合成並行表單 " + n, "行政表單"].map(quote).join(",") + ",false);" +
    "insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json,published_at,published_by) select " +
    [version(n), definition(n)].map(quote).join(",") + ",1,'published',effective_from,schema_json,scoring_json,clock_timestamp()," + quote(actor) + " from public.form_versions where id=" + quote(source) + ";");
  const draftCount = id => Number(sql("select count(*) from public.form_versions where form_definition_id=" + quote(id) + " and status='draft'").trim());
  const eventCount = id => Number(sql("select count(*) from private.custom_form_lifecycle_events where form_version_id=" + quote(id)).trim());

  const sameNames = ["native_lifecycle_same_a", "native_lifecycle_same_b"];
  const sameHolder = await hold("select pg_advisory_xact_lock(hashtextextended(" + quote("custom-form-lifecycle:" + org + ":" + actor + ":" + key(1)) + ",0))");
  const samePending = sameNames.map(name => concurrentSql(transaction(name, lifecycle("clone", 1))));
  try { await observeWait(0, sameNames); } finally { await sameHolder.release(); }
  const same = (await Promise.all(samePending)).map(result => accept(result, "Same-key clone"));
  if (same[0].event.id !== same[1].event.id || same.filter(row => row.replayed).length !== 1 ||
    JSON.stringify(same[0].event) !== JSON.stringify(same[1].event) || draftCount("d9300000-0000-4000-8000-000000000002") !== 1 || eventCount(source) !== 1)
    throw new Error("Duplicate clone was not exactly one immutable event/draft with exact replay");
  console.log("Observed same-key clone race: one draft/event; exact second replay.");

  makeVersion(2);
  const differentNames = ["native_lifecycle_different_a", "native_lifecycle_different_b"];
  const differentHolder = await hold("select pg_advisory_xact_lock(hashtextextended(" + quote("form-publish-definition:" + definition(2)) + ",0))");
  const differentPending = differentNames.map((name, i) => concurrentSql(transaction(name, lifecycle("clone", 2 + i, version(2)))));
  try { await observeWait(0, differentNames); } finally { await differentHolder.release(); }
  const different = await Promise.all(differentPending);
  if (different.filter(row => row.status === 0).length !== 1) throw new Error("Competing clone winner count differs: " + JSON.stringify(different));
  accept(different.find(row => row.status === 0), "Different-key clone winner");
  reject(different.find(row => row.status !== 0), "23514", "Different-key clone loser");
  if (draftCount(definition(2)) !== 1 || eventCount(version(2)) !== 1) throw new Error("Concurrent clones persisted multiple drafts/events");
  console.log("Observed different-key clone race: at most one draft per definition.");

  const response = (n, v) => "select 'RESULT='||public.write_custom_form_response(" + [org, branch, client, key(n)].map(quote).join(",") +
    ",jsonb_build_object('action','save','formVersionId'," + quote(v) + ",'previousId',null,'baseRevision',null,'serviceDate',(clock_timestamp() at time zone 'Asia/Taipei')::date," +
    "'answers','{\"note\":{\"state\":\"answered\",\"value\":\"合成填答\"},\"count\":{\"state\":\"answered\",\"value\":0},\"yes\":{\"state\":\"answered\",\"value\":false}}'::jsonb,'reason',null))::text;";
  const responseCount = v => Number(sql("select count(*) from private.custom_form_responses where form_version_id=" + quote(v)).trim());
  for (const retirementWins of [true, false]) {
    const n = retirementWins ? 3 : 4;
    makeVersion(n);
    const request = receipt(sql(transaction("native_lifecycle_request_" + n, lifecycle("request_retirement", n * 10, version(n)))));
    if (!request?.event?.id) throw new Error("Retirement fixture request missing");
    const approve = lifecycle("approve_retirement", n * 10 + 1, version(n), request.event.id);
    const save = response(n * 10 + 2, version(n));
    // Execute one real RPC and hold its transaction: this is an actual response
    // SHARE lock or an actual retirement UPDATE lock, not a mocked lock helper.
    const holder = await hold(claims(retirementWins) + (retirementWins ? approve : save));
    const name = "native_lifecycle_" + (retirementWins ? "retirement_first" : "response_first");
    const pending = concurrentSql(transaction(name, retirementWins ? save : approve, !retirementWins));
    try { await observeWait(holder.pid, [name]); } finally { await holder.release(); }
    const result = await pending;
    if (retirementWins) reject(result, "23514", "New response after retirement");
    else accept(result, "Retirement after existing response");
    if (responseCount(version(n)) !== (retirementWins ? 0 : 1) || sql("select status from public.form_versions where id=" + quote(version(n))).trim() !== "retired")
      throw new Error("Retirement/response serialization violated");
    console.log(retirementWins ? "Observed retirement-first race: late new response rejected; no response persisted." : "Observed response-first race: original response retained, retirement completed afterwards.");
  }

  makeVersion(5);
  const beforeAudit = Number(sql("select count(*) from public.audit_events where table_name='custom_form_lifecycle'").trim());
  const auditHolder = await hold("lock table public.audit_events in share mode");
  const auditName = "native_lifecycle_audit_revocation";
  const auditPending = concurrentSql(transaction(auditName, lifecycle("clone", 50, version(5)), true));
  let auditProbeError;
  try {
    await observeWait(auditHolder.pid, [auditName]);
    // auth.sessions is authoritative and has no app audit trigger that could
    // itself wait on our audit-table lock. Do not disable any production guard.
    sql("update auth.sessions set not_after=clock_timestamp() where id=" + quote(secondSession));
  } catch (error) { auditProbeError = error; } finally { await auditHolder.release(); }
  const auditResult = await auditPending;
  sql("update auth.sessions set not_after=null where id=" + quote(secondSession));
  if (auditProbeError) throw auditProbeError;
  reject(auditResult, "42501", "Revoked manager after audit wait");
  if (draftCount(definition(5)) !== 0 || eventCount(version(5)) !== 0 || Number(sql("select count(*) from public.audit_events where table_name='custom_form_lifecycle'").trim()) !== beforeAudit)
    throw new Error("Revoked lifecycle transaction failed to roll back draft, event and audit");
  console.log("Observed audit-lock revocation: no receipt returned; draft/event/audit all rolled back.");

  const challenge = "db910000-0000-4000-8000-000000000001";
  const nonce = "c".repeat(64);
  // An intentionally near-expiry synthetic fixture, inserted once, not altered
  // after creation. Consumption uses the real RPC and real same-session AMR.
  const factor = Number(sql("select floor(extract(epoch from clock_timestamp()-interval '1 second'))").trim());
  sql("update auth.mfa_amr_claims set created_at=to_timestamp(" + factor + "),updated_at=to_timestamp(" + factor + ") where session_id=" + quote(secondSession) + " and authentication_method='totp';" +
    "insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at) values(" +
    [challenge, second, secondSession, nonce, key(90)].map(quote).join(",") + ",clock_timestamp()-interval '60 seconds','native-prior',clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '2 seconds');");
  const expiringJwt = JSON.parse(secondJwt);
  expiringJwt.iat = Math.floor(Date.now() / 1000);
  expiringJwt.jti = "native-refreshed";
  expiringJwt.amr = expiringJwt.amr.map(entry => entry.method === "totp" ? { ...entry, timestamp: factor } : entry);
  const previousEvidence = sql("select challenge_id from private.reauth_events where user_id=" + quote(second)).trim();
  const expiry = Number(sql("select extract(epoch from expires_at)*1000 from private.reauth_challenges where id=" + quote(challenge)).trim());
  const ttlHolder = await hold("select id from private.reauth_challenges where id=" + quote(challenge) + " for update");
  const ttlName = "native_lifecycle_challenge_ttl";
  const ttlPending = concurrentSql("begin;set local application_name=" + quote(ttlName) + ";select set_config('request.jwt.claims'," + quote(JSON.stringify(expiringJwt)) + ",true);set local role authenticated;select 'RESULT='||to_json(public.record_aal2_reauth(" + [challenge, nonce].map(quote).join(",") + "))::text;commit;");
  let ttlProbeError;
  try {
    await observeWait(ttlHolder.pid, [ttlName]);
    const deadline = Date.now() + 10_000;
    while (Number(sql("select extract(epoch from clock_timestamp())*1000").trim()) <= expiry) {
      if (Date.now() > deadline) throw new Error("Challenge wall-clock expiry never arrived");
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
  } catch (error) { ttlProbeError = error; } finally { await ttlHolder.release(); }
  const ttlResult = await ttlPending;
  if (ttlProbeError) throw ttlProbeError;
  if (ttlResult.status !== 0 || receipt(ttlResult.stdout) !== false) throw new Error("Expired challenge accepted after row-lock wait: " + JSON.stringify(ttlResult));
  if (sql("select consumed_at is null from private.reauth_challenges where id=" + quote(challenge)).trim() !== "t" ||
    sql("select challenge_id from private.reauth_events where user_id=" + quote(second)).trim() !== previousEvidence)
    throw new Error("Expired challenge consumption changed immutable MFA proof");
  console.log("Observed challenge row-lock crossing TTL: false result, challenge unconsumed, original reauth evidence unchanged.");
  console.log(`Native custom form lifecycle acceptance: ${passed} SQL assertions and 6 observed two-session races.`);
} finally {
  if (started) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
