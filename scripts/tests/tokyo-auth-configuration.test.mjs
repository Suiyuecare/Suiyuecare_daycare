import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { configuredAuthOrigin } from "../../src/lib/auth/origin-policy.mjs";
import { inspectTokyoAuthConfiguration, TOKYO_AUTH_CONFIGURATION_FIELDS } from "../lib/tokyo-auth-configuration.mjs";

const fixture = Object.freeze({
  NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.suiyuecare.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://diompsnswchpfguvryan.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_configuration_only",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic_configuration_only",
  GOOGLE_LOGIN_ENABLED: "true", PORTAL_DAYCARE_HANDOFF_SECRET: "synthetic_dedicated_handoff_fixture_1234567890",
});

test("missing configuration reports names only and all external proof remains false", () => {
  const result = inspectTokyoAuthConfiguration({});
  assert.equal(result.status, "missing");
  assert.deepEqual(result.missing, [...TOKYO_AUTH_CONFIGURATION_FIELDS]);
  assert.deepEqual(result.invalid, []);
  for (const field of ["connectionVerified", "keyProjectBindingVerified", "googleLoginVerified", "portalSsoVerified", "productionReady"])
    assert.equal(result[field], false);
  assert.equal(result.externalRequests, 0); assert.equal(result.writes, 0);
});

test("complete synthetic syntax never claims real Google, SSO, key binding or production readiness", () => {
  const result = inspectTokyoAuthConfiguration(fixture);
  assert.equal(result.status, "configured_unverified");
  assert.equal(result.proofLevel, "configuration-syntax-and-origins-only");
  assert.deepEqual(result.missing, []); assert.deepEqual(result.invalid, []);
  assert.equal(result.productionReady, false);
  assert.ok(result.pendingExternalChecks.includes("GOOGLE_PROVIDER_AND_CALLBACK_ALLOWLIST"));
  for (const value of Object.values(fixture).filter(value => value.length > 10))
    assert.ok(!JSON.stringify(result).includes(JSON.stringify(value)));
});

for (const [field, value] of [
  ["NODE_ENV", "development"], ["GOOGLE_LOGIN_ENABLED", "false"],
  ["NEXT_PUBLIC_APP_ORIGIN", "https://attacker.invalid"],
  ["NEXT_PUBLIC_APP_ORIGIN", "https://daycare.suiyuecare.com/"],
  ["NEXT_PUBLIC_APP_ORIGIN", "https://daycare.suiyuecare.com/path"],
  ["NEXT_PUBLIC_APP_ORIGIN", "https://user:password@daycare.suiyuecare.com"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://mmxqxsokpcdvuzmdhptg.supabase.co"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://diompsnswchpfguvryan.supabase.co?extra=1"],
  ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_synthetic_wrong_key_type"],
  ["SUPABASE_SECRET_KEY", "sb_publishable_synthetic_wrong_key_type"],
  ["PORTAL_DAYCARE_HANDOFF_SECRET", "too-short"],
  ["PORTAL_DAYCARE_HANDOFF_SECRET", `${"a".repeat(32)}\n`],
  ["PORTAL_DAYCARE_HANDOFF_SECRET", fixture.SUPABASE_SECRET_KEY],
  ["PORTAL_DAYCARE_HANDOFF_SECRET", fixture.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
]) {
  test(`rejects ${field} syntax/expected destination without echoing supplied value`, () => {
    const result = inspectTokyoAuthConfiguration({ ...fixture, [field]: value });
    assert.equal(result.status, "invalid"); assert.deepEqual(result.invalid, [field]);
    assert.ok(!JSON.stringify(result).includes(JSON.stringify(value)));
  });
}

for (const field of ["DEMO_MODE", "SYNTHETIC_PREVIEW", "NEXT_PUBLIC_SYNTHETIC_PREVIEW",
  "SYNTHETIC_PREVIEW_PURPOSE", "SYNTHETIC_PREVIEW_PROJECT_ID",
  "NEXT_PUBLIC_SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_PORTAL_DAYCARE_HANDOFF_SECRET", "NEXT_PUBLIC_PORTAL_HANDOFF_SECRET"]) {
  test(`rejects active/public secret configuration ${field}`, () => {
    const result = inspectTokyoAuthConfiguration({ ...fixture, [field]: "synthetic_private_value_do_not_echo" });
    assert.equal(result.status, "invalid"); assert.deepEqual(result.invalid, [field]);
    assert.ok(!JSON.stringify(result).includes("synthetic_private_value_do_not_echo"));
  });
}

test("shared runtime guard retains loopback development support but refuses insecure production origins", () => {
  assert.equal(configuredAuthOrigin("http://127.0.0.1:3000", true), "http://127.0.0.1:3000");
  assert.equal(configuredAuthOrigin("http://127.0.0.1:3000", false), null);
  for (const value of ["http://attacker.invalid", "https://a.invalid/p", "https://a.invalid?q=1",
    "https://a.invalid#fragment", "https://user:secret@a.invalid", "invalid"])
    assert.equal(configuredAuthOrigin(value, true), null);
});

test("CLI uses only explicitly injected synthetic environment and returns review limits", () => {
  const script = new URL("../preflight-tokyo-auth-configuration.mjs", import.meta.url);
  const empty = spawnSync(process.execPath, [script.pathname], { env: {}, encoding: "utf8", timeout: 10000 });
  assert.equal(empty.status, 2); assert.equal(empty.stderr, "");
  assert.equal(JSON.parse(empty.stdout).status, "missing");
  const configured = spawnSync(process.execPath, [script.pathname], { env: fixture, encoding: "utf8", timeout: 10000 });
  assert.equal(configured.status, 0); assert.equal(configured.stderr, "");
  const result = JSON.parse(configured.stdout);
  assert.equal(result.status, "configured_unverified"); assert.equal(result.productionReady, false);
  assert.equal(result.externalRequests, 0); assert.equal(result.writes, 0);
});

test("CLI refuses file/value arguments without opening files or echoing the argument", () => {
  const result = spawnSync(process.execPath, [new URL("../preflight-tokyo-auth-configuration.mjs", import.meta.url).pathname,
    "--configuration-file=synthetic-private-argument"], { env: {}, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 2); assert.equal(result.stdout, "");
  assert.ok(!result.stderr.includes("synthetic-private-argument"));
});
