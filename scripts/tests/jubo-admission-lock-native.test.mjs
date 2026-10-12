import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const native = await readFile(new URL("../test-admission-native.mjs", import.meta.url), "utf8");
const start = native.indexOf("const juboSource =");
const end = native.indexOf("// Reuse only synthetic Auth fixture setup.", start);
const jubo = native.slice(start, end);

test("JUBO races reuse native OAuth/source fixture without predicate overrides", () => {
  assert.ok(start > 0 && end > start);
  assert.match(jubo, /supabase\/tests\/jubo_admission_preparation.test.sql/u);
  assert.match(jubo, /pg_temp.login\(1\)/u);
  assert.match(jubo, /pg_temp.login\(2\)/u);
  assert.doesNotMatch(jubo, /create(?: or replace)? function (?:private|public)\./iu);
  assert.doesNotMatch(jubo, /service_role|https:\/\/|fetch\(/u);
});
test("proposal/review new writes and replays cover session branch AAL2 and independent role", () => {
  assert.match(jubo, /\["session", "branch", "aal2"\] : \["session", "branch", "aal2", "director"\]/u);
  assert.match(jubo, /for \(const replay of \[false, true\]\)/u);
  assert.match(jubo, /auth.sessions set aal='aal1'/u);
  assert.match(jubo, /public.jubo_admission_preparation_snapshot[\s\S]+select not private.jubo_admission_independent_director/u);
  assert.doesNotMatch(jubo, /update private.reauth_events|update private.reauth_challenges/u);
});
test("race is observed before revocation and demands 42501 no receipt or aggregate changes", () => {
  const observed = jubo.indexOf("await waitForBlocked([name])");
  const revoke = jubo.indexOf("await holder.release(`${boundary.disable}commit;`)");
  assert.ok(observed > 0 && revoke > observed);
  assert.match(jubo, /result.stderr.includes\("42501"\)/u);
  assert.match(jubo, /result.stdout.includes\("NATIVE_JUBO_RECEIPT="\)/u);
  assert.match(jubo, /juboCounts\(\) !== juboBaseline/u);
  assert.match(jubo, /admissionEnabled !== false/u);
});
