// Dedicated real PostgreSQL admission/roster race checks. This script creates a
// disposable Unix-socket-only cluster and never accepts a database URL.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute PostgreSQL bin directory.");
const runtime = await mkdtemp("/tmp/daycare-admission-native.");
const data = join(runtime, "data");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55440", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const run = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = (input) => run(join(binaries, "psql"), args, input);
const concurrent = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
const holders = new Set();
const holdRow = async (clientId = "c2600000-0000-4000-8000-000000000001") => {
  if (!/^c2600000-0000-4000-8000-00000000000[12]$/.test(clientId)) throw new Error("Invalid synthetic client lock target.");
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = ""; let resolveReady; let rejectReady;
  const ready = new Promise((resolveResult, rejectResult) => { resolveReady = resolveResult; rejectReady = rejectResult; });
  const completion = new Promise((resolveResult) => {
    child.stdout.on("data", (value) => { stdout += value; const match = stdout.match(/^NATIVE_LOCK_READY=(\d+)$/m); if (match) resolveReady(Number(match[1])); });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", (error) => { rejectReady(error); resolveResult({ status: -1 }); });
    child.on("close", (status) => { rejectReady(new Error("Native row holder closed before readiness.")); resolveResult({ status }); });
  });
  const timer = setTimeout(() => rejectReady(new Error("Native row lock readiness timed out.")), 10_000);
  child.stdin.write(`begin;set local application_name='native_admission_holder';select 1 from public.clients where id='${clientId}' for update;select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
  let released = false;
  const holder = { release: async (ending = "commit;") => {
    if (released) return;
    released = true; child.stdin.end(`${ending}\n`);
    const result = await completion; holders.delete(holder);
    if (result.status !== 0) throw new Error(`Native row holder failed: ${stderr}`);
  } };
  holders.add(holder);
  try { await ready; } finally { clearTimeout(timer); }
  return holder;
};
const waitForBlocked = async (names) => {
  if (names.some((name) => !/^native_admission_[a-z0-9_]+$/.test(name))) throw new Error("Invalid synthetic lock probe name.");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const count = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names.map((name) => `'${name}'`).join(",")}) and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (count === names.length) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Competing admission sessions were not observed blocked in PostgreSQL.");
};
let started = false;
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p 55440 -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  for (const suiteName of ["admission_day_roster_eligibility.test.sql", "client_lifecycle_active_scope.test.sql"]) {
    const suite = await readFile(join(root, "supabase/tests", suiteName), "utf8");
    const expected = Number(suite.match(/select\s+plan\((\d+)\)/i)?.[1]);
    const output = sql(suite);
    const passed = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
    if (!expected || passed !== expected || /^not ok |^# Looks like/m.test(output)) throw new Error(`Native ${suiteName} failed: ${passed}/${expected}. ${output.split("\n").filter((line) => /^not ok |^#/.test(line)).join(" ")}`);
    console.log(`Native ${suiteName}: ${passed}/${expected}.`);
  }

  // Reuse only synthetic Auth fixture setup. Claims are kept in memory, never
  // printed, sent to a remote server, or used to impersonate a real employee.
  const source = await readFile(join(root, "supabase/tests/client_weekly_attendance_transport.test.sql"), "utf8");
  const fixture = source.slice(source.indexOf("select set_config('test.weekly_amr'"), source.indexOf("create function pg_temp.weekly_day"));
  const approval = source.match(/insert into private\.executive_access_policy[^;]+;/)?.[0];
  if (!fixture || !approval) throw new Error("Synthetic admission fixture not found.");
  const setup = sql(`begin;${fixture}${approval}select 'NATIVE_JWT='||current_setting('request.jwt.claims');commit;`);
  const jwt = setup.split("\n").find((line) => line.startsWith("NATIVE_JWT="))?.slice("NATIVE_JWT=".length);
  if (!jwt) throw new Error("Synthetic admission claims missing.");
  const claims = `select set_config('request.jwt.claims','${jwt.replaceAll("'", "''")}',true);set local role authenticated;`;
  const save = (key, version, name) => `begin;set local application_name='${name}';${claims}
    select 'NATIVE_RECEIPT='||receipt::text from public.save_care_roster('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',
    jsonb_build_object('clientId','c2600000-0000-4000-8000-000000000001','serviceDate',(clock_timestamp() at time zone 'Asia/Taipei')::date,'shift','morning','staffUserId',null,'expectedVersion',${version},'state','scheduled','sourceNote','Synthetic native allocation','tasks','["temperature"]'::jsonb,'approved',true,'idempotency_key','${key}'));commit;`;
  const receipt = (result) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("NATIVE_RECEIPT="))?.slice("NATIVE_RECEIPT=".length) ?? "null");
  const firstHolder = await holdRow();
  const duplicateNames = ["native_admission_duplicate_a", "native_admission_duplicate_b"];
  const duplicateWork = duplicateNames.map((name) => concurrent(save("ca100000-0000-4000-8000-000000000001", 0, name)));
  await waitForBlocked(duplicateNames); await firstHolder.release();
  const duplicates = await Promise.all(duplicateWork); const receipts = duplicates.map(receipt);
  if (duplicates.some((result) => result.status !== 0) || receipts.some((value) => !value) || receipts[0].id !== receipts[1].id || receipts.filter((value) => value.replayed).length !== 1) throw new Error("Native duplicate key did not resolve to one shared receipt.");

  const conflictHolder = await holdRow();
  const conflictNames = ["native_admission_conflict_a", "native_admission_conflict_b"];
  const conflictWork = conflictNames.map((name, index) => concurrent(save(`ca100000-0000-4000-8000-00000000000${index + 2}`, 1, name)));
  await waitForBlocked(conflictNames); await conflictHolder.release();
  const conflicts = await Promise.all(conflictWork);
  if (conflicts.filter((result) => result.status === 0).length !== 1 || conflicts.filter((result) => result.status !== 0 && result.stderr.includes("40001")).length !== 1) throw new Error("Native competing bases did not produce one success and one 40001.");
  const counts = () => sql("select jsonb_build_array((select count(*) from private.care_roster_versions),(select count(*) from private.care_roster_operations))::text;").trim();
  const before = counts();
  if (before !== "[2, 2]") throw new Error("Unexpected roster version/receipt baseline.");
  console.log("Native observed lock races: same key -> one version/shared receipt; competing keys -> one success/one 40001.");

  const suspendHolder = await holdRow();
  const suspensionWork = concurrent(save("ca100000-0000-4000-8000-000000000004", 2, "native_admission_suspend_waiter"));
  await waitForBlocked(["native_admission_suspend_waiter"]);
  await suspendHolder.release(`${claims}select * from public.transition_client('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','suspend',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic native suspension',null,1,'ca200000-0000-4000-8000-000000000001');commit;`);
  const suspension = await suspensionWork;
  if (suspension.status === 0 || !suspension.stderr.includes("23514") || counts() !== before) throw new Error("Roster waiter did not reject the committed suspension without extra versions/receipts.");
  console.log("Native row-lock race: committed suspension -> waiting scheduled write rejected 23514; zero extra versions/receipts.");
  sql(`begin;${claims}select * from public.transition_client('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','resume',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic explicit resume',null,2,'ca200000-0000-4000-8000-000000000002');commit;`);
  const revokeHolder = await holdRow();
  const revokeWork = concurrent(save("ca100000-0000-4000-8000-000000000005", 2, "native_admission_revoke_waiter"));
  await waitForBlocked(["native_admission_revoke_waiter"]);
  await revokeHolder.release("update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';commit;");
  const revoked = await revokeWork;
  if (revoked.status === 0 || !revoked.stderr.includes("42501") || counts() !== before) throw new Error("Roster waiter did not reject revoked organization without extra versions/receipts.");
  console.log("Native row-lock race: organization revoked while waiting -> 42501; zero extra versions/receipts.");

  sql("update public.organizations set is_active=true where id='c2300000-0000-4000-8000-000000000001';insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values('c2600000-0000-4000-8000-000000000002','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-2','Synthetic pending admission',null);");
  const lifecycleCounts = () => sql("select jsonb_build_array((select count(*) from public.client_transitions),(select row_version from public.clients where id='c2600000-0000-4000-8000-000000000002'),(select admitted_on from public.clients where id='c2600000-0000-4000-8000-000000000002'))::text;").trim();
  const lifecycleBefore = lifecycleCounts();
  if (lifecycleBefore !== "[2, 1, null]") throw new Error("Unexpected lifecycle baseline.");
  const admitSql = (key) => `select * from public.transition_client('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000002','admit',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic explicit admission',null,1,'${key}');`;
  for (const scope of ["organization", "branch"]) {
    const table = scope === "organization" ? "organizations" : "branches";
    const id = scope === "organization" ? "c2300000-0000-4000-8000-000000000001" : "c2400000-0000-4000-8000-000000000001";
    for (const boundary of ["rpc", "trigger"]) {
      const holder = await holdRow("c2600000-0000-4000-8000-000000000002");
      const name = `native_admission_${scope}_${boundary}_waiter`;
      // The internal-insert variant stays postgres with the same actual Auth
      // claims, to exercise the trigger without granting staff ledger INSERT.
      const internalClaims = claims.replace("set local role authenticated;", "");
      const operation = boundary === "rpc" ? admitSql("ca300000-0000-4000-8000-000000000001") : "insert into public.client_transitions(client_id,event_kind,effective_on,reason,base_row_version,idempotency_key,actor_user_id) values('c2600000-0000-4000-8000-000000000002','admit',(clock_timestamp() at time zone 'Asia/Taipei')::date,'Synthetic internal ledger validation',1,gen_random_uuid(),auth.uid());";
      const work = concurrent(`begin;set local application_name='${name}';${boundary === "rpc" ? claims : internalClaims}${operation}commit;`);
      await waitForBlocked([name]);
      await holder.release(`update public.${table} set is_active=false where id='${id}';commit;`);
      const result = await work;
      if (result.status === 0 || !result.stderr.includes("42501") || lifecycleCounts() !== lifecycleBefore) throw new Error(`Lifecycle ${boundary} waiter did not reject disabled ${scope} without extra transition/version/admission.`);
      sql(`update public.${table} set is_active=true where id='${id}';`);
      console.log(`Native lifecycle ${boundary} client-lock race: ${scope} disabled while waiting -> 42501; zero transitions/version changes.`);
    }
  }

  // The winner commits a legitimate admission and disables its organization in
  // one transaction. A duplicate already waiting on its client lock must deny,
  // rather than return a stale receipt from the second replay lookup.
  const replayHolder = await holdRow("c2600000-0000-4000-8000-000000000002");
  const replayKey = "ca300000-0000-4000-8000-000000000002";
  const replayWork = concurrent(`begin;set local application_name='native_admission_replay_waiter';${claims}${admitSql(replayKey)}commit;`);
  await waitForBlocked(["native_admission_replay_waiter"]);
  await replayHolder.release(`${claims}${admitSql(replayKey)}reset role;update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';commit;`);
  const replayDenied = await replayWork;
  const finalLifecycle = JSON.parse(lifecycleCounts());
  if (replayDenied.status === 0 || !replayDenied.stderr.includes("42501") || finalLifecycle[0] !== 3 || finalLifecycle[1] !== 2 || !finalLifecycle[2]) throw new Error("Lifecycle delayed replay did not deny revoked scope without extra transition.");
  console.log("Native lifecycle delayed replay: winning admission plus scope disable -> waiting duplicate rejected 42501; only original transition retained.");
} finally {
  for (const holder of holders) await holder.release("rollback;").catch(() => {});
  if (started) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
