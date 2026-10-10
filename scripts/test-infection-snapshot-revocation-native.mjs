// Reproduce a page-25 broad-scope permission revocation during a snapshot on
// disposable, Unix-socket-only PostgreSQL. All identities and incidents are
// synthetic; this script never accepts a hosted database URL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) {
  throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL bin directory.");
}
const runtime = await mkdtemp("/tmp/daycare-infection-revocation-native.");
const data = join(runtime, "data");
const port = 55449;
const env = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  PGHOST: runtime,
  PGPORT: String(port),
  PGUSER: "postgres",
  PGDATABASE: "postgres",
  PGCONNECT_TIMEOUT: "5",
};
const run = (file, args, input) => {
  const result = spawnSync(file, args, {
    cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"),
  ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], input);
const claims = (sub) => JSON.stringify({ sub, role: "authenticated", aal: "aal2" });
const org = "25100000-0000-4000-8000-000000000001";
const branch = "25200000-0000-4000-8000-000000000001";
const manager = "25000000-0000-4000-8000-000000000001";
const worker = "25000000-0000-4000-8000-000000000002";
const snapshotSql = `select * from public.infection_event_snapshot('${org}', '${branch}')`;
const client = () => new pg.Client({ host: runtime, port, user: "postgres", database: "postgres" });
const withoutGeneratedAt = (row) => {
  const result = { ...row };
  delete result.generated_at;
  return result;
};
const readSnapshot = async (sub) => {
  const connection = client();
  await connection.connect();
  try {
    await connection.query("begin");
    await connection.query("set local role authenticated");
    await connection.query("select set_config('request.jwt.claims', $1, true)", [claims(sub)]);
    const authority = (await connection.query(`select auth.uid() as actor, auth.jwt()->>'aal' as aal,
      private.has_permission('${org}','${branch}','clients.read') as clients_read,
      private.has_permission('${org}','${branch}','quality_events.read') as quality_read,
      private.has_permission('${org}','${branch}','clients.view_all') as view_all`)).rows[0];
    if (authority.actor !== sub || authority.aal !== "aal2" || !authority.clients_read || !authority.quality_read) {
      throw new Error(`Synthetic snapshot fixture authority invalid: ${JSON.stringify(authority)}`);
    }
    const row = (await connection.query(snapshotSql)).rows[0];
    await connection.query("commit");
    return withoutGeneratedAt(row);
  } finally {
    await connection.end();
  }
};
const waitForAuditBlock = async () => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const output = sql("select count(*) from pg_stat_activity where application_name='native_infection_snapshot_waiter' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;");
    if (Number(output.trim()) === 1) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Snapshot was not observed waiting at the controlled audit gate.");
};

let started = false;
const connections = [];
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"),
    "-o", `-k ${runtime} -p ${port} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations")))
    .filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);

  // Isolate the infection permission contract from the separate, exhaustive
  // Google-session gate. This matches the local pgTAP harness and is NEVER
  // applied to a hosted database or persisted as a migration.
  sql("create or replace function private.is_executive_login_allowed() returns boolean language sql volatile security definer set search_path='' as $$ select true $$;");

  const source = await readFile(join(root, "supabase/tests/infection_event_workflow_page25.test.sql"), "utf8");
  const fixtureStart = source.indexOf("insert into auth.users");
  const fixtureEnd = source.indexOf("-- Test-only read grants", fixtureStart);
  const bulkStart = source.indexOf("create temporary table infection_bulk as");
  const bulkEnd = source.indexOf("set local role authenticated;", bulkStart);
  if ([fixtureStart, fixtureEnd, bulkStart, bulkEnd].some((offset) => offset < 0)) {
    throw new Error("Synthetic infection fixture markers changed.");
  }
  sql(source.slice(fixtureStart, fixtureEnd));

  // Compare the entire public response (except a deliberately changing clock)
  // against the original checked-in workflow function on the compact fixture.
  // Extract only CREATE OR REPLACE FUNCTION, not the whole historical migration.
  const migrationPath = "supabase/migrations/20261009150548_infection_event_snapshot_shared_authorized_clients.sql";
  const originalMigration = await readFile(join(root, "supabase/migrations/20260901113955_infection_event_workflow_page25.sql"), "utf8");
  const originalStart = originalMigration.indexOf("create or replace function private.infection_event_snapshot_response(");
  const originalEnd = originalMigration.indexOf("\n$$;", originalStart);
  if (originalStart < 0 || originalEnd < 0) throw new Error("Original infection snapshot definition changed.");
  sql(originalMigration.slice(originalStart, originalEnd + "\n$$;".length));
  const baselineManager = await readSnapshot(manager);
  const baselineWorker = await readSnapshot(worker);
  sql(await readFile(join(root, migrationPath), "utf8"));
  const currentManager = await readSnapshot(manager);
  const currentWorker = await readSnapshot(worker);
  assert.deepEqual(currentManager, baselineManager, "all-view payload changed");
  assert.deepEqual(currentWorker, baselineWorker, "assigned-only payload changed");
  console.log("Native full-payload parity: all-view and assigned-only snapshots match the original workflow function.");

  sql(source.slice(bulkStart, bulkEnd));
  const bulkManager = await readSnapshot(manager);
  const bulkWorker = await readSnapshot(worker);
  assert.equal(Number(bulkManager.matching_total), 205);
  assert.equal(Number(bulkWorker.matching_total), 3);

  const perfClient = client(); connections.push(perfClient); await perfClient.connect();
  await perfClient.query("begin");
  await perfClient.query("set local role authenticated");
  await perfClient.query("select set_config('request.jwt.claims', $1, true)", [claims(manager)]);
  const times = [];
  for (let n = 0; n < 7; n += 1) {
    const startedAt = performance.now();
    const result = await perfClient.query(snapshotSql);
    times.push(performance.now() - startedAt);
    assert.equal(Number(result.rows[0].matching_total), 205);
    assert.equal(Number(result.rows[0].item_total), 200);
  }
  await perfClient.query("commit");
  const warm = times.slice(1).sort((a, b) => a - b);
  const p95 = warm[Math.ceil(warm.length * 0.95) - 1];
  assert.ok(p95 < 2000, `warm snapshot p95 regressed to ${p95.toFixed(1)} ms`);
  console.log(`Native 201-bulk-incident snapshot: warm p95 ${p95.toFixed(1)} ms; ${times.map((ms) => ms.toFixed(1)).join(", ")} ms.`);

  // The gate blocks only this actor's infection-snapshot audit INSERT. The
  // other session can revoke clients.view_all, COMMIT, and release the gate
  // before the snapshot's final authority recheck begins.
  sql(`create function private.native_infection_snapshot_audit_gate() returns trigger language plpgsql set search_path='' as $$
    begin
      if new.actor_user_id='${manager}' and new.action='select' and new.table_name='infection_incidents' then
        perform pg_advisory_xact_lock(77150,205);
      end if;
      return new;
    end;$$;
    create trigger native_infection_snapshot_audit_gate before insert on public.audit_events
      for each row execute function private.native_infection_snapshot_audit_gate();`);
  const baselineAudit = Number(sql(`select count(*) from public.audit_events where actor_user_id='${manager}' and action='select' and table_name='infection_incidents';`).trim());
  const holder = client(); connections.push(holder); await holder.connect();
  const waiter = client(); connections.push(waiter); await waiter.connect();
  await holder.query("begin");
  await holder.query("select pg_advisory_xact_lock(77150,205)");
  await waiter.query("begin");
  await waiter.query("set local application_name='native_infection_snapshot_waiter'");
  await waiter.query("set local role authenticated");
  await waiter.query("select set_config('request.jwt.claims', $1, true)", [claims(manager)]);
  const pending = waiter.query(snapshotSql).then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  await waitForAuditBlock();
  const revocation = await holder.query(`delete from public.role_permissions rp using public.permissions p
    where rp.permission_id=p.id and rp.role_id='10000000-0000-4000-8000-000000000002'
      and p.permission_key='clients.view_all' returning rp.role_id`);
  assert.equal(revocation.rowCount, 1, "synthetic all-view grant was not revoked");
  await holder.query("commit");
  const outcome = await pending;
  assert.equal(outcome.result, undefined, "revoked snapshot emitted an incident result");
  assert.equal(outcome.error?.code, "42501", "in-flight snapshot returned data after broad grant revocation");
  assert.match(outcome.error.message, /infection incident snapshot authority expired/);
  await waiter.query("rollback");
  const finalAudit = Number(sql(`select count(*) from public.audit_events where actor_user_id='${manager}' and action='select' and table_name='infection_incidents';`).trim());
  assert.equal(finalAudit, baselineAudit, "denied snapshot left a committed read-audit entry");
  console.log("Native dual-session revocation race: grant removed while snapshot waited at audit; returned 42501 and no incident payload/audit commit.");
} finally {
  for (const connection of connections.reverse()) await connection.end().catch(() => {});
  if (started) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
