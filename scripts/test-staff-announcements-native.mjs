// Real PostgreSQL 17, owned temporary Unix socket and synthetic identities only.
// Runs the exact enforceable pgTAP suite without SQL compatibility transforms.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute PostgreSQL 17 bin directory.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-staff-announcements-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55457", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const run = (file, argv, input) => {
  const result = spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
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
const hold = async () => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let markReady; let failReady; let stderr = ""; let stdout = ""; let released = false;
  const ready = new Promise((resolveReady, rejectReady) => { markReady = resolveReady; failReady = rejectReady; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; if (/^READY$/m.test(stdout)) markReady(); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { failReady(error); resolveCompletion(-1); });
    child.on("close", (status) => { failReady(new Error("Owned holder ended before readiness.")); resolveCompletion(status); });
  });
  const holder = { release: async () => {
    if (released) return;
    released = true; child.stdin.end("commit;\n");
    const status = await completion; holders.delete(holder);
    assert.equal(status, 0, stderr);
  } };
  holders.add(holder);
  const timeout = setTimeout(() => failReady(new Error("Owned holder readiness timed out.")), 10_000);
  child.stdin.write("begin;select pg_advisory_xact_lock(hashtextextended('native-announcement-audit-pause',0));select 'READY';\n");
  try { await ready; return holder; } finally { clearTimeout(timeout); }
};
const waitForBlocked = async (name) => {
  assert.match(name, /^native_announcement_[a-z_]+$/);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'applicationName',application_name,'blockers',pg_blocking_pids(pid))),'[]'::jsonb)
      from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === 1) return rows[0];
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Independent backend not observed waiting: ${name}.`);
};
const org = "db500000-0000-4000-8000-000000000001";
const branch = "db600000-0000-4000-8000-000000000001";
const projectionCount = () => sql("select count(*) from public.audit_events where metadata->>'projection'='page68_staff_announcement_management_v2';").trim();
const probes = [];
let started = false; let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim();
  assert.match(engine, /PostgreSQL\) 17\./);
  console.log(engine);
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    try { sql(await readFile(join(root, "supabase/migrations", name), "utf8")); }
    catch (error) { throw new Error(`Native migration ${name}: ${error.message}`); }
  }
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const source = await readFile(join(root, "supabase/tests/staff_announcement_paged_snapshot_v2.test.sql"), "utf8");
  const expected = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]);
  const output = sql(source);
  const actual = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
  assert.equal(actual, expected, "Exact announcement pgTAP assertion count");
  assert.doesNotMatch(output, /^not ok \d+\b|^# Looks like/m);
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}; exact announcement suite: ${actual}/${expected}.`);

  // Commit only legitimate synthetic fixtures for independent-backend races.
  const boundary = source.indexOf("\nselect ok(");
  assert.ok(boundary > 0);
  const fixture = source.slice(0, boundary).replace(/select\s+plan\(\d+\);/i, "");
  const setup = sql(`${fixture}\nselect pg_temp.announcement_fixture(102,250);select pg_temp.announcement_login();
    select 'JWT='||current_setting('request.jwt.claims');commit;`);
  const jwt = setup.split("\n").find((line) => line.startsWith("JWT="))?.slice(4);
  assert.ok(jwt);
  sql(`create schema native_announcement_test;create function native_announcement_test.pause_audit() returns trigger language plpgsql set search_path='' as $$begin
    if new.metadata->>'projection'='page68_staff_announcement_management_v2' then perform pg_advisory_xact_lock(hashtextextended('native-announcement-audit-pause',0));end if;return new;end;$$;
    create trigger native_announcement_pause_audit before insert on public.audit_events for each row execute function native_announcement_test.pause_audit();`);
  const read = (name) => concurrent(`begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;
    select 'PAGE='||to_jsonb(page)::text from public.staff_announcement_management_snapshot_v2('${org}'::uuid,'${branch}'::uuid) page;commit;`);
  const denyStale = (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /42501.*announcement management snapshot expired after audit/s);
    assert.doesNotMatch(result.stdout, /^PAGE=/m);
  };
  const originalAudits = projectionCount();
  const pageHolder = await hold();
  const changingPage = read("native_announcement_page_change");
  try {
    probes.push({ name: "matching_count_changed_during_audit_wait", waiter: await waitForBlocked("native_announcement_page_change") });
    sql(`begin;select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;
      select * from public.create_staff_announcement_draft('${org}'::uuid,'${branch}'::uuid,null,'Synthetic independent new announcement','Synthetic native body',
      now()-interval '1 day',null,array['db100000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],null,'dbc00000-0000-4000-8000-000000000010'::uuid);commit;`);
  } finally { await pageHolder.release(); }
  denyStale(await changingPage);
  assert.equal(projectionCount(), originalAudits);
  assert.equal(sql(`select count(distinct announcement_key) from public.staff_announcement_versions where organization_id='${org}'::uuid and branch_id='${branch}'::uuid;`).trim(), "251");
  console.log("Native independent writer: stale matching count/page denied; valid draft remains, denied snapshot audit absent.");

  const authorityHolder = await hold();
  const revokedPage = read("native_announcement_revoked_scope");
  try {
    probes.push({ name: "admission_revoked_during_audit_wait", waiter: await waitForBlocked("native_announcement_revoked_scope") });
    sql("update private.executive_access_policy set enabled=false where allowed_user_id='db100000-0000-4000-8000-000000000001';");
  } finally { await authorityHolder.release(); }
  denyStale(await revokedPage);
  assert.equal(projectionCount(), originalAudits);
  console.log("Native admission revoked during read: 42501, no data/counts or successful snapshot audit.");
  sql("drop trigger native_announcement_pause_audit on public.audit_events;drop schema native_announcement_test cascade;");
  await writeFile(join(runtime, "evidence.json"), JSON.stringify({ engine, compiledMigrations: migrations.length, suiteAssertions: actual, exactSqlCompatibilityTransforms: 0, probes, replacedAuthorizationFunctions: 0, hostedConnections: 0 }, null, 2));
  console.log(`Native staff announcements verified; evidence: ${join(runtime, "evidence.json")}.`);
} catch (error) { testFailure = error; throw error; } finally {
  const cleanupErrors = [];
  for (const holder of holders) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors, stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
