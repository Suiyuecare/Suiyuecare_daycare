// Disposable in-memory compatibility probe. No URL, hosted credentials, real
// patient data, or authorization-function replacement is accepted by this tool.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite/pgtap";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const target = "20260922090058_custom_form_publication_revision.sql";
const migrations = (await readdir(join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
const cutoff = migrations.indexOf(target);
assert(cutoff > 0, "Publication upgrade migration is missing");
const migration = await readFile(join(root, "supabase/migrations", target), "utf8");
const suite = await readFile(join(root, "supabase/tests/custom_form_version_lifecycle.test.sql"), "utf8");
const boundary = suite.indexOf("select ok((select relrowsecurity");
assert(boundary > 0, "Synthetic real-admission fixture boundary is missing");
const fixture = suite.slice(0, boundary).replace(/select plan\(\d+\);/, "");
const org = "d8500000-0000-4000-8000-000000000001";
const branch = "d8600000-0000-4000-8000-000000000001";
const actor = "d8100000-0000-4000-8000-000000000001";
const legacyDefinition = "dc500000-0000-4000-8000-000000000001";
const legacyVersion = "dc600000-0000-4000-8000-000000000001";
const quote = value => "'" + value.replaceAll("'", "''") + "'";
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };

async function fingerprint(db) {
  const result = await db.query(`select md5(jsonb_build_object(
   'requests',(select jsonb_agg(to_jsonb(q) order by q.id) from public.form_publication_requests q),
   'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from public.form_versions v),
   'definitions',(select jsonb_agg(to_jsonb(d) order by d.id) from public.form_definitions d))::text) as fingerprint`);
  return result.rows[0].fingerprint;
}

for (const corrupt of [false, true]) {
  const db = new PGlite({ extensions: { pgtap } });
  try {
    await db.exec(bootstrapSql);
    for (const name of migrations.slice(0, cutoff)) await db.exec(await readFile(join(root, "supabase/migrations", name), "utf8"));
    await db.exec(await readFile(join(root, "supabase/seed.sql"), "utf8"));
    await db.exec(fixture + `select pg_temp.custom_login();set local role authenticated;
      select set_config('test.custom_receipt',pg_temp.custom_save(50)::text,true);
      select set_config('test.upgrade_request',(select request_id::text from public.request_form_publication(${quote(org)},${quote(branch)},pg_temp.custom_id(),'dc700000-0000-4000-8000-000000000001')),true);
      select pg_temp.second_login();
      select * from public.approve_form_publication(${quote(org)},${quote(branch)},current_setting('test.upgrade_request')::uuid,'dc700000-0000-4000-8000-000000000002');
      reset role;
      insert into public.form_definitions(id,organization_id,form_key,name,category,is_official)
        values(${quote(legacyDefinition)},${quote(org)},'tenant.custom.legacy_probe','合成舊式待審表單','行政表單',false);
      insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json)
        values(${quote(legacyVersion)},${quote(legacyDefinition)},1,'draft','2026-09-01','{"fields":[{"key":"legacy_item"}]}','{"legacy_sum":["legacy_item"]}');
      select pg_temp.custom_login();`);
    const jwt = (await db.query("select current_setting('request.jwt.claims') as jwt")).rows[0].jwt;
    const customVersion = (await db.query("select pg_temp.custom_id()::text as id")).rows[0].id;
    if (corrupt) {
      // The old schema permitted a structurally valid but incorrect hash in a
      // manually provisioned request. This synthetic fault must abort upgrade.
      await db.exec(`insert into public.form_publication_requests(organization_id,branch_id,form_definition_id,form_version_id,
        form_content_hash,requested_by,requested_reauth_challenge_id,request_idempotency_key,request_hash)
        values(${quote(org)},${quote(branch)},${quote(legacyDefinition)},${quote(legacyVersion)},repeat('a',64),${quote(actor)},
        'd8800000-0000-4000-8000-000000000001','dc700000-0000-4000-8000-000000000003',repeat('b',64));`);
    } else {
      await db.exec(`set local role authenticated;select * from public.request_form_publication(${quote(org)},${quote(branch)},${quote(legacyVersion)},'dc700000-0000-4000-8000-000000000003');reset role;`);
    }
    await db.exec("commit;");
    check((await db.query("select count(*)::int as count from public.form_publication_requests")).rows[0].count, 2, "Two real pre-migration request rounds exist");
    const before = await fingerprint(db);
    if (corrupt) {
      let code;
      try { await db.exec(migration); } catch (error) { code = error.code; }
      check(code, "23514", "Mismatched legacy hash stops migration");
      await db.exec("rollback;");
      check(await fingerprint(db), before, "Failed upgrade changes no legacy business evidence");
      check((await db.query("select to_regclass('private.custom_form_publication_snapshots')::text as relation")).rows[0].relation, null, "Failed upgrade rolls back new tables");
      check((await db.query("select to_regprocedure('public.write_custom_form_publication_v2(uuid,uuid,uuid,jsonb)')::text as routine")).rows[0].routine, null, "Failed upgrade rolls back new RPCs");
      console.log("Corrupt preexisting request: fail-closed rollback confirmed.");
      continue;
    }
    await db.exec(migration);
    check(await fingerprint(db), before, "Successful upgrade does not rewrite legacy requests, versions, or definitions");
    check((await db.query("select count(*)::int as count from private.custom_form_publication_snapshots")).rows[0].count, 2, "Both pending and approved requests receive snapshots");
    check((await db.query("select count(*)::int as count from private.custom_form_publication_events")).rows[0].count, 3, "Two requests and one original approval are preserved");
    check((await db.query(`select bool_and(s.content_hash=q.form_content_hash and s.content_hash=encode(sha256(convert_to(s.content::text,'UTF8')),'hex')) as matches
      from private.custom_form_publication_snapshots s join public.form_publication_requests q on q.id=s.request_id`)).rows[0].matches, true, "Every backfilled canonical snapshot matches original hash");
    check((await db.query(`select bool_and(e.created_at=case e.action when 'request' then q.requested_at else q.approved_at end
      and e.actor_id=case e.action when 'request' then q.requested_by else q.approved_by end
      and e.challenge_id=case e.action when 'request' then q.requested_reauth_challenge_id else q.approved_reauth_challenge_id end) as matches
      from private.custom_form_publication_events e join public.form_publication_requests q on q.id=e.request_id`)).rows[0].matches, true, "Backfill retains original person, proof, and time");
    const legacyRequest = (await db.query(`select id from public.form_publication_requests where form_version_id=${quote(legacyVersion)}`)).rows[0].id;
    await db.exec(`begin;select set_config('request.jwt.claims',${quote(jwt)},true);set local role authenticated;`);
    const old = (await db.query(`select * from public.form_governance_snapshot(${quote(org)},${quote(branch)})`)).rows[0];
    check(old.publications.length, 2, "Old projection retains both original pending/approved rows");
    check(Object.keys(old.publications[0]).sort(), ["approved_at", "approved_by_current_user", "form_definition_id", "form_version_id", "id", "requested_at", "requested_by_current_user", "status"], "Old request projection shape remains byte-compatible by keys");
    const history = (await db.query(`select public.read_custom_form_publication_history_v2(${quote(org)},${quote(branch)},${quote(customVersion)}) as history`)).rows[0].history;
    check(history.requests[0].status, "approved", "Migrated custom approved request is readable");
    check(history.requests[0].events.length, 2, "Migrated request and approval events are readable");
    const latest = (await db.query(`select versions from public.form_governance_snapshot_v2(${quote(org)},${quote(branch)})`)).rows[0].versions;
    check(latest.find(version => version.id === legacyVersion).custom_builder_eligible, false, "Exact custom prefix does not adopt a nonbuilder/scored legacy form");
    check(latest.find(version => version.id === customVersion).custom_builder_eligible, true, "Valid schema uses explicit custom builder capability");
    // A valid old-style pending form remains approvable through its original
    // workflow after migration; v2 must not claim that legacy capability.
    await db.exec("rollback;begin;");
    await db.exec(`select set_config('test.custom_amr',${quote(String(JSON.parse(jwt).amr[0].timestamp))},true);select pg_temp.second_login();set local role authenticated;`);
    const approved = (await db.query(`select * from public.approve_form_publication(${quote(org)},${quote(branch)},
      ${quote(legacyRequest)},'dc700000-0000-4000-8000-000000000004')`)).rows[0];
    check(approved.status, "approved", "Exact-prefix legacy nonbuilder remains usable through old approval workflow");
    let denied;
    try { await db.query(`select public.read_custom_form_publication_history_v2(${quote(org)},${quote(branch)},${quote(legacyVersion)})`); } catch (error) { denied = error.code; }
    check(denied, "42501", "Preserved old nonbuilder rules cannot enter the custom editor");
    await db.exec("rollback;");
    console.log("Valid preexisting pending + approved requests: immutable backfill and old-client compatibility confirmed.");
  } finally { await db.close(); }
}
console.log(`Publication upgrade probe: ${cutoff} prior migrations -> ${cutoff + 1}; 2 scenarios, ${checks} checks passed. PGlite compatibility proof, not a hosted migration.`);
