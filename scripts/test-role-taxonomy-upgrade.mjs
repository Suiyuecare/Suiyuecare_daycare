// Local synthetic upgrade regression. Never connects to hosted Supabase.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgtap } from '@electric-sql/pglite/pgtap';
import { bootstrapSql } from './lib/pglite-bootstrap.mjs';

const root = resolve(import.meta.dirname, '..');
const migrationDirectory = join(root, 'supabase/migrations');
const target = '20260913123658_eleven_role_taxonomy_branch_scope.sql';
const directorId = '10000000-0000-4000-8000-000000000011';
const database = new PGlite({ extensions: { pgtap } });
let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}
async function rows(sql) {
  return (await database.query(sql)).rows;
}
async function snapshot() {
  return {
    roles: await rows('select * from public.roles order by id'),
    permissions: await rows('select * from public.role_permissions order by role_id, permission_id'),
    memberships: await rows('select * from public.memberships order by id'),
    assignments: await rows('select * from public.membership_roles order by membership_id, role_id'),
    users: await rows('select id from auth.users order by id'),
    records: await rows('select * from public.care_records order by id'),
    audit: await rows('select * from public.audit_events order by id'),
  };
}
try {
  await database.exec(bootstrapSql);
  const files = (await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort();
  check(files.includes(target), true, 'target migration must exist');
  for (const file of files.filter(file => file < target)) {
    await database.exec(await readFile(join(migrationDirectory, file), 'utf8'));
  }
  await database.exec(`
    insert into auth.users(id,email) values
      ('d2100000-0000-4000-8000-000000000001','synthetic-upgrade@example.invalid');
    insert into public.profiles(id,display_name,kind) values
      ('d2100000-0000-4000-8000-000000000001','Synthetic upgrade person','staff');
    insert into public.organizations(id,code,name) values
      ('d2200000-0000-4000-8000-000000000001','synthetic_upgrade','Synthetic upgrade organization');
    insert into public.branches(id,organization_id,code,name) values
      ('d2250000-0000-4000-8000-000000000001','d2200000-0000-4000-8000-000000000001',
       'synthetic_branch','Synthetic upgrade branch');
    insert into public.memberships(id,organization_id,profile_id,status) values
      ('d2300000-0000-4000-8000-000000000001','d2200000-0000-4000-8000-000000000001',
       'd2100000-0000-4000-8000-000000000001','active');
    insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
      ('d2300000-0000-4000-8000-000000000002','d2200000-0000-4000-8000-000000000001',
       'd2250000-0000-4000-8000-000000000001','d2100000-0000-4000-8000-000000000001','active');
    insert into public.membership_roles(membership_id,role_id) values
      ('d2300000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
      ('d2300000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005');
    insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
      ('d2500000-0000-4000-8000-000000000001','d2200000-0000-4000-8000-000000000001',
       'd2250000-0000-4000-8000-000000000001','SYNTHETIC-UPGRADE','Synthetic upgrade client');
    insert into public.care_records(id,organization_id,branch_id,client_id,record_key,category,occurred_at,data,created_by) values
      ('d2600000-0000-4000-8000-000000000001','d2200000-0000-4000-8000-000000000001',
       'd2250000-0000-4000-8000-000000000001','d2500000-0000-4000-8000-000000000001',
       'd2700000-0000-4000-8000-000000000001','synthetic/clinical',now()-interval '2 days',
       '{"note":"Synthetic preserved clinical draft"}','d2100000-0000-4000-8000-000000000001');
    insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata) values
      ('d2200000-0000-4000-8000-000000000001','d2250000-0000-4000-8000-000000000001',
       'd2100000-0000-4000-8000-000000000001','select','synthetic_upgrade_evidence',
       'd2600000-0000-4000-8000-000000000001',array['synthetic_fixture'],'{"purpose":"historical_upgrade_evidence"}');
    insert into public.roles(id,organization_id,role_key,name,is_system) values
      ('d2400000-0000-4000-8000-000000000001','d2200000-0000-4000-8000-000000000001',
       'branch_supervisor','Synthetic tenant-owned label',false);
  `);
  const migration = await readFile(join(migrationDirectory, target), 'utf8');
  // PGlite's multi-statement exec can hide missing transaction boundaries that
  // fail when the native CLI sends statements separately. Require the migration
  // itself to own BEGIN/COMMIT; never provide an outer BEGIN from this harness.
  const executableMigration = migration.replace(/^\s*--[^\n]*$/gm, '').trim();
  check(/^begin;[\s\S]*\bcommit;$/i.test(executableMigration), true,
    'migration explicitly owns the transaction required by SET LOCAL and LOCK TABLE');
  const beforeBlocked = await snapshot();
  let blocked;
  try {
    await database.exec(migration);
  } catch (error) {
    blocked = error;
    // The migration's BEGIN has entered an aborted transaction. Roll back only
    // this failure; a successful migration already issued its own COMMIT.
    await database.exec('rollback;');
  }
  check(blocked?.code, '23514', 'existing NULL-branch supervisor must abort migration');
  check(blocked?.message, 'existing single-branch role assignment requires explicit branch review',
    'preflight must report explicit scope review, not silently scope/migrate a person');
  check(await snapshot(), beforeBlocked, 'failed upgrade must leave all scoped fixtures and old audit rows unchanged');

  // Fixture-only resolution emulates explicit revocation, not a production cleanup.
  await database.exec(`delete from public.membership_roles
    where membership_id='d2300000-0000-4000-8000-000000000001'
      and role_id='10000000-0000-4000-8000-000000000003';`);
  const before = await snapshot();
  check(before.assignments.length, 1, 'valid upgrade preserves a nonempty existing nursing assignment');
  check(before.records.length, 1, 'clinical preservation assertion uses a nonempty clinical draft');
  check(before.audit.some(event => event.table_name === 'synthetic_upgrade_evidence'), true,
    'old audit preservation includes an explicit historical evidence fixture');
  await database.exec(migration);
  const after = await snapshot();
  check(after.roles.filter(role => role.is_system).length, 11, 'valid upgrade creates exactly eleven system categories');
  check(after.roles.filter(role => role.id !== directorId).map(role => [role.id, role.role_key]),
    before.roles.map(role => [role.id, role.role_key]), 'all existing role keys and IDs are retained');
  check(after.roles.find(role => role.id === 'd2400000-0000-4000-8000-000000000001'),
    before.roles.find(role => role.id === 'd2400000-0000-4000-8000-000000000001'),
    'tenant custom role colliding with the system key is unchanged');
  check(after.permissions.filter(grant => grant.role_id !== directorId), before.permissions,
    'all previous role permissions are unchanged');
  check(after.memberships, before.memberships, 'no membership branch, person or status changes');
  check(after.assignments, before.assignments, 'no person receives or loses roles during valid taxonomy migration');
  check(after.users, before.users, 'no account is created or reapproved');
  check(after.records, before.records, 'clinical records are not rewritten');
  check(after.audit.slice(0, before.audit.length), before.audit, 'existing audit events remain byte-for-byte data equivalent');
  check(after.roles.find(role => role.role_key === 'organization_manager' && role.is_system)?.name,
    '全機構管理員（多點管理）', 'multi-site role label is explicit');
  check(after.roles.find(role => role.role_key === 'branch_supervisor' && role.is_system)?.name,
    '機構管理員（單點管理）', 'single-site role label is explicit');
  check(after.permissions.filter(grant => grant.role_id === directorId).length, 6,
    'new director has only the six approved read-only grants');
  console.log(`Role taxonomy upgrade: ${assertions} assertions passed (local PGlite only).`);
} finally {
  await database.close();
}
