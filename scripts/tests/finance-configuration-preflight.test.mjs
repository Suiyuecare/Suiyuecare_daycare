import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../preflight-finance-configuration.mjs", import.meta.url));
const networkGuard = `
  import http from "node:http";
  import https from "node:https";
  import net from "node:net";
  import tls from "node:tls";
  import dns from "node:dns";
  import { syncBuiltinESMExports } from "node:module";
  let attempts = 0;
  const denied = () => { attempts += 1; throw new Error("TEST_NETWORK_DENIED"); };
  globalThis.fetch = denied;
  for (const module of [http, https]) for (const key of ["get", "request"]) module[key] = denied;
  net.connect = denied;
  net.createConnection = denied;
  net.Socket.prototype.connect = denied;
  tls.connect = denied;
  for (const module of [dns, dns.promises]) for (const key of ["lookup", "resolve", "resolve4", "resolve6", "reverse"]) module[key] = denied;
  syncBuiltinESMExports();
  process.on("exit", () => {
    process.stderr.write(JSON.stringify({ networkAttempts: attempts }) + "\\n");
    if (attempts !== 0) process.exitCode = 97;
  });
`;
const preload = `data:text/javascript,${encodeURIComponent(networkGuard)}`;
const fields = [
  "FINANCE_STORE_SUMMARY_URL", "FINANCE_STORE_SUMMARY_TOKEN", "FINANCE_STORE_ORGANIZATION_ID",
  "FINANCE_STORE_BRANCH_ID", "FINANCE_STORE_BINDING_ID", "FINANCE_STORE_ENTITY_ID",
  "FINANCE_STORE_DEPARTMENT_CODE",
];
const configured = {
  FINANCE_STORE_SUMMARY_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/daycare-store-finance-summary",
  FINANCE_STORE_SUMMARY_TOKEN: "c".repeat(64),
  FINANCE_STORE_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  FINANCE_STORE_BRANCH_ID: "22222222-2222-4222-8222-222222222222",
  FINANCE_STORE_BINDING_ID: "33333333-3333-4333-8333-333333333333",
  FINANCE_STORE_ENTITY_ID: "E6",
  FINANCE_STORE_DEPARTMENT_CODE: "J1101",
};

function runPreflight(environment = {}, args = []) {
  const result = spawnSync(process.execPath, ["--import", preload, script, ...args], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...environment, NODE_NO_WARNINGS: "1" },
    encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const usage = args.length ? "Usage: node scripts/preflight-finance-configuration.mjs (reads injected server environment only)\n" : "";
  assert.equal(result.stderr, `${usage}{"networkAttempts":0}\n`);
  for (const value of Object.values(environment)) assert.ok(!`${result.stdout}${result.stderr}`.includes(value), "Configuration values must not reach output");
  return result;
}

test("native CLI executes missing-settings preflight with no network or private values", () => {
  const result = runPreflight({ UNRELATED_PRIVATE_TOKEN: "TEST_PRIVATE_UNRELATED_VALUE" });
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "missing", missing: fields, invalid: [], connectionVerified: false,
    externalRequests: 0, writes: 0,
  });
});

test("native CLI executes complete configuration without claiming approval or connection", () => {
  const result = runPreflight(configured);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "configured_unverified", missing: [], invalid: [], connectionVerified: false,
    externalRequests: 0, writes: 0,
  });
});

test("invalid settings expose allowlisted field names only", () => {
  const result = runPreflight({ ...configured, FINANCE_STORE_SUMMARY_TOKEN: "TEST_PRIVATE_INVALID_TOKEN" });
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "invalid", missing: [], invalid: ["FINANCE_STORE_SUMMARY_TOKEN"], connectionVerified: false,
    externalRequests: 0, writes: 0,
  });
});

test("an unapproved store binding cannot pass syntax preflight", () => {
  const result = runPreflight({ ...configured, FINANCE_STORE_DEPARTMENT_CODE: "C1100" });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, "scope_mismatch");
});

test("unexpected arguments produce usage only and make no request", () => {
  const result = runPreflight(configured, ["--connect"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
});

test("network instrumentation rejects an attempted request before any external access", () => {
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e",
    'try { await fetch("https://example.invalid/"); } catch {}'], {
    env: { NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 97);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"networkAttempts":1}\n');
});
