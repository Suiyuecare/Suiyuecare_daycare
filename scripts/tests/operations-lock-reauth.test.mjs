import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = await readFile(new URL("../../supabase/migrations/20261011172000_operations_evidence_lock_reauthorization.sql", import.meta.url), "utf8");
// Source contracts supplement the native concurrency suite; they do not claim
// that a real lock race, cloud admission or production workload has been run.
for (const [name, lockCount, guards] of [
  ["quality_monthly_freeze", 1, ["quality_monthly_authorized", "has_operations_evidence_permission", "data_inventory_reauth"]],
  ["evaluation_evidence_review", 3, ["evaluation_preparation_authorized", "data_inventory_reauth"]],
  ["evaluation_evidence_bundle", 2, ["evaluation_preparation_authorized", "data_inventory_reauth"]],
]) {
  test(`${name} repeats exact permission and recent reauth after every lock`, () => {
    const start = source.indexOf(`create or replace function private.${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf("\nend;$$;", start);
    assert.ok(end > start);
    const body = source.slice(start, end);
    assert.match(body, /volatile security definer set search_path=''/u);
    const locks = [...body.matchAll(/perform pg_advisory_xact_lock\([^\n]+\);\n/gu)];
    assert.equal(locks.length, lockCount);
    for (const lock of locks) {
      const after = body.slice(lock.index + lock[0].length);
      const guard = after.match(/^\s*if ([^\n]+) then\n\s*raise exception using errcode='42501',message='[^']+ denied after lock';end if;/u);
      assert.ok(guard, "No read, replay, receipt or write before post-lock revalidation");
      for (const predicate of guards) assert.ok(guard[1].includes(`private.${predicate}(`));
    }
    assert.ok(body.indexOf("denied after lock") < body.indexOf("select * into v_"), "Operation receipt lookup must follow revalidation");
  });
}
test("migration is additive, transactional and does not replace admission or grant new access", () => {
  assert.match(source, /\nbegin;\n/u);
  assert.match(source, /\ncommit;\n$/u);
  assert.doesNotMatch(source, /(?:create|replace)\s+function\s+(?:private|public)\.(?:is_active_user|is_staff_login_allowed|has_permission)/iu);
  assert.doesNotMatch(source, /^\s*(?:grant\s+|alter\s+table|disable\s+row\s+level)/imu);
  assert.match(source, /independent reviewer required/u);
  assert.match(source, /monthly data changed/u);
  assert.match(source, /reviewed evidence changed/u);
});
