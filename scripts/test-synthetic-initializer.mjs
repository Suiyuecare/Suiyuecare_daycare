import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

// Entirely in memory: no env loading, network, hosted Auth, or file writes.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrations = await Promise.all(
  migrationFiles.map((name) => readFile(join(migrationDirectory, name), "utf8")),
);
const initializer = await readFile(
  join(projectRoot, "scripts", "initialize-synthetic-supabase.sql"),
  "utf8",
);
const verification = await readFile(
  join(projectRoot, "scripts", "verify-supabase-initialization.sql"),
  "utf8",
);
const closeGate = await readFile(
  join(projectRoot, "scripts", "supabase-initialization-close-gate.sql"),
  "utf8",
);
const openGate = await readFile(
  join(projectRoot, "scripts", "supabase-initialization-open-gate.sql"),
  "utf8",
);
const requestId = "synthetic-bootstrap-v1:0b255030-6ccc-4873-b413-47d041e24b35";
const tables = ["organizations", "branches", "clients", "audit_events"];
let passed = 0;

async function snapshot(database) {
  const result = {};
  for (const table of tables) {
    result[table] = (await database.query(`select * from public.${table} order by id`)).rows;
  }
  return result;
}

async function assertRejectedUnchanged(database, expected) {
  const before = await snapshot(database);
  await assert.rejects(database.exec(initializer), expected);
  // An explicit failed SQL transaction must be rolled back before diagnostics.
  await database.exec("rollback");
  assert.deepEqual(await snapshot(database), before);
}

async function scenario(name, test, { applyMigrations = true } = {}) {
  const database = new PGlite();
  try {
    await database.exec(bootstrapSql);
    if (applyMigrations) {
      for (const migration of migrations) await database.exec(migration);
    }
    await test(database);
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    // PGlite errors can contain the full SQL and a large bundled stack. Keep
    // diagnostics bounded and do not print query contents or row data.
    const message = error instanceof Error ? error.message : "Unknown test failure";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "TEST_FAILURE";
    throw new Error(`${name}: ${message} (${code})`);
  } finally {
    await database.close();
  }
}

await scenario("first run creates only inactive TEST organization/branch and two suspended clients", async (db) => {
  const before = await snapshot(db);
  await db.exec(initializer);
  const after = await snapshot(db);
  assert.equal(after.organizations.length, 1);
  assert.equal(after.branches.length, 1);
  assert.equal(after.clients.length, 2);
  assert.equal(after.organizations[0].is_active, false);
  assert.equal(after.branches[0].is_active, false);
  assert.equal(after.branches[0].capacity, null);
  assert.equal(after.organizations[0].settings.data_classification, "synthetic");
  assert.equal(after.branches[0].settings.data_classification, "synthetic");
  assert.match(after.organizations[0].name, /^\[TEST\]/u);
  assert.match(after.branches[0].name, /^\[TEST\]/u);
  for (const client of after.clients) {
    assert.match(client.display_name, /^\[TEST\]/u);
    assert.equal(client.status, "suspended");
    assert.equal(client.source_system, "synthetic_schema_bootstrap_v1");
    for (const field of ["date_of_birth", "national_id_ciphertext", "external_key", "admitted_on", "ended_on", "source_updated_at"]) {
      assert.equal(client[field], null);
    }
  }
  for (const table of ["auth.users", "public.profiles", "public.memberships", "public.membership_roles", "public.client_assignments", "public.consents", "public.measurements", "public.medication_plans", "public.service_events", "public.claim_batches", "public.notifications", "public.form_definitions"]) {
    assert.equal((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0);
  }
  const receipts = after.audit_events.filter((row) => row.request_id === requestId);
  assert.equal(receipts.length, 4);
  assert.equal(after.audit_events.length, before.audit_events.length + 4);
  assert.ok(receipts.every((row) => row.action === "insert" && row.actor_user_id === null && row.metadata.system_actor === true));

  await db.exec(initializer);
  assert.deepEqual(await snapshot(db), after, "exact replay must not change even timestamps or audit rows");
  passed += 1;
  process.stdout.write("PASS exact replay is a zero-write no-op\n");
});

await scenario("same code with different existing content is rejected without any partial write", async (db) => {
  await db.exec(`insert into public.organizations (id, code, name, is_active)
    values ('a45c3be1-cd24-4479-b7ef-52aaf73565d2', 'test_schema_bootstrap_v1', '[TEST] conflicting fixture', false)`);
  await assertRejectedUnchanged(db, /SYNTHETIC_INITIALIZER_BASELINE_CONFLICT/u);
});

await scenario("changed client content on replay is rejected without overwrite", async (db) => {
  await db.exec(initializer);
  await db.exec("update public.clients set display_name = '[TEST] modified fixture' where client_code = 'TEST-001'");
  await assertRejectedUnchanged(db, /SYNTHETIC_INITIALIZER_CONTENT_CONFLICT/u);
});

await scenario("changed organization activation on replay is rejected", async (db) => {
  await db.exec(initializer);
  await db.exec("update public.organizations set is_active = true");
  await assertRejectedUnchanged(db, /SYNTHETIC_INITIALIZER_CONTENT_CONFLICT/u);
});

await scenario("existing Auth user prevents initialization without creating any application identity", async (db) => {
  await db.exec("insert into auth.users (id) values ('7b44e9c8-ae49-46a0-8c5d-858cd75239c0')");
  await assertRejectedUnchanged(db, /SYNTHETIC_INITIALIZER_AUTH_NOT_EMPTY/u);
  assert.equal((await db.query("select count(*)::int as count from auth.users")).rows[0].count, 1);
});

await scenario("unrelated business data prevents initialization", async (db) => {
  await db.exec(`insert into public.form_definitions (form_key, name, category, is_official)
    values ('test.existing_fixture', '[TEST] existing fixture', 'test', false)`);
  await assertRejectedUnchanged(db, /SYNTHETIC_INITIALIZER_BUSINESS_DATA_NOT_EMPTY/u);
});

await scenario("second client constraint failure rolls back organization, branch, clients and audit inserts", async (db) => {
  // Local-only fault injection; never included in the hosted initializer.
  await db.exec("alter table public.clients add constraint initializer_test_second_client_failure check (client_code <> 'TEST-002')");
  await assertRejectedUnchanged(db, /initializer_test_second_client_failure/u);
  assert.equal((await db.query("select count(*)::int as count from public.audit_events where request_id = $1", [requestId])).rows[0].count, 0);
});

await scenario("missing audit trigger causes complete rollback rather than apparent success", async (db) => {
  // Local-only fault injection proves the initializer requires real audit rows.
  await db.exec("alter table public.clients disable trigger clients_audit_row_change");
  await assertRejectedUnchanged(db, /SYNTHETIC_INITIALIZER_AUDIT_CONFLICT/u);
});

await scenario("hosted verification SQL passes with local-only empty Storage stub and rolls back role simulation", async (db) => {
  // PGlite does not ship Supabase Storage. This stub is test-only, outside public
  // and private, and must never be included in any hosted initialization SQL.
  await db.exec("create schema storage; create table storage.objects (id uuid primary key)");
  await db.exec(initializer);
  const before = await snapshot(db);
  const results = await db.exec(verification);
  assert.ok(results.some((result) => result.rows.some((row) => row.initialization_database_checks === "PASS")));
  assert.deepEqual(await snapshot(db), before);
  assert.equal((await db.query("select current_user as role")).rows[0].role, "postgres");
  assert.equal((await db.query("select auth.uid() as actor")).rows[0].actor, null);
});

await scenario("schema gate stays closed for incomplete migrations and reopens only after complete initialization", async (db) => {
  // Empty PGlite + local Storage stub, not a connection to hosted Supabase.
  await db.exec("create schema storage; create table storage.objects (id uuid primary key)");
  // Model an existing project's permissive schema ACL so both direct role grants
  // and implicit PUBLIC membership must be removed by the actual gate script.
  await db.exec("grant usage, create on schema public to public, anon, authenticated");
  const privileges = async () => (await db.query(`
    select role_name,
      has_schema_privilege(role_name, 'public', 'USAGE') as can_use,
      has_schema_privilege(role_name, 'public', 'CREATE') as can_create
    from (values ('anon'), ('authenticated')) as roles(role_name)
    order by role_name
  `)).rows;
  const closed = [
    { role_name: "anon", can_use: false, can_create: false },
    { role_name: "authenticated", can_use: false, can_create: false },
  ];
  const opened = closed.map((row) => ({ ...row, can_use: true }));
  assert.ok((await privileges()).every((row) => row.can_use && row.can_create));
  await db.exec(closeGate);
  assert.deepEqual(await privileges(), closed);

  const emptyState = async () => (await db.query(`
    select
      (select count(*)::int from auth.users) as auth_users,
      (select count(*)::int from storage.objects) as storage_objects,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')) as business_tables
  `)).rows;
  const emptyBefore = await emptyState();
  await assert.rejects(db.exec(openGate), /Application schema is incomplete/u);
  await db.exec("rollback");
  assert.deepEqual(await privileges(), closed);
  assert.deepEqual(await emptyState(), emptyBefore);

  // Also prove a partially created application, not just a completely empty
  // project, is rejected without reopening the schema or changing its data.
  for (const migration of migrations.slice(0, 2)) await db.exec(migration);
  const partialBefore = await snapshot(db);
  await assert.rejects(db.exec(openGate), /Application schema is incomplete/u);
  await db.exec("rollback");
  assert.deepEqual(await privileges(), closed);
  assert.deepEqual(await snapshot(db), partialBefore);

  for (const migration of migrations.slice(2)) await db.exec(migration);
  assert.deepEqual(await privileges(), closed, "migrations must not silently reopen the schema");
  await db.exec(initializer);
  assert.deepEqual(await privileges(), closed, "synthetic DML must not reopen the schema");
  const initialized = await snapshot(db);
  await assert.rejects(db.exec(verification), /Verify only after restoring USAGE/u);
  await db.exec("rollback");
  assert.deepEqual(await privileges(), closed, "closed-gate verification must not open access");
  assert.deepEqual(await snapshot(db), initialized);

  // Local-only ACL fault injection. The gate must reject rather than silently
  // normalize an unexpected CREATE grant or partially restore USAGE.
  await db.exec("grant create on schema public to anon");
  const unexpectedCreate = [
    { role_name: "anon", can_use: false, can_create: true },
    { role_name: "authenticated", can_use: false, can_create: false },
  ];
  assert.deepEqual(await privileges(), unexpectedCreate);
  await assert.rejects(db.exec(openGate), /Unexpected public schema CREATE privilege/u);
  await db.exec("rollback");
  assert.deepEqual(await privileges(), unexpectedCreate, "failed opening must leave USAGE denied");
  assert.deepEqual(await snapshot(db), initialized);
  await db.exec("revoke create on schema public from anon");
  assert.deepEqual(await privileges(), closed);

  await db.exec(openGate);
  assert.deepEqual(await privileges(), opened, "opening restores USAGE, never CREATE");
  assert.deepEqual(await snapshot(db), initialized, "opening must not change business or audit rows");
  const results = await db.exec(verification);
  assert.ok(results.some((result) => result.rows.some((row) => row.initialization_database_checks === "PASS")));
  assert.deepEqual(await privileges(), opened);
  assert.deepEqual(await snapshot(db), initialized);
  assert.equal((await db.query("select current_user as role")).rows[0].role, "postgres");
  assert.equal((await db.query("select auth.uid() as actor")).rows[0].actor, null);
}, { applyMigrations: false });

process.stdout.write(JSON.stringify({
  mode: "local_in_memory_only",
  migrations: migrationFiles.length,
  scenariosPassed: passed,
  remoteWrites: 0,
  realPersonalData: 0,
}) + "\n");
