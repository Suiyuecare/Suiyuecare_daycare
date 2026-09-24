// Explicit read-only hosted verification. Never print or persist API keys,
// response bodies, individual records, CLI stdout or CLI error objects.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const projectRef = "mmxqxsokpcdvuzmdhptg";
const baseUrl = `https://${projectRef}.supabase.co`;
assert.equal(
  readFileSync(resolve(projectRoot, "supabase/.temp/project-ref"), "utf8").trim(),
  projectRef,
  "Linked project differs from the approved initialization target",
);

let publicKey;
try {
  const result = JSON.parse(execFileSync("supabase", [
    "projects", "api-keys", "--project-ref", projectRef, "-o", "json",
  ], {
    cwd: projectRoot, encoding: "utf8", timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  }));
  const keys = Array.isArray(result) ? result : result.keys;
  const enabledKeys = keys.filter((key) => key.disabled !== true);
  const entry = enabledKeys.find((key) => key.type === "publishable")
    ?? enabledKeys.find((key) => key.name === "anon");
  publicKey = entry?.api_key;
} catch {
  throw new Error("Could not retrieve a publishable API key; sensitive output suppressed");
}
assert.ok(publicKey, "No enabled publishable/anonymous API key is available");

async function readProbe(table, key) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=id&limit=1`, {
    headers: key ? { apikey: key } : {},
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = await response.json();
  return {
    table,
    status: response.status,
    errorCode: !Array.isArray(body) && typeof body.code === "string" ? body.code : null,
    returnedRows: Array.isArray(body) ? body.length : 0,
  };
}

const missingKey = await readProbe("clients");
assert.equal(missingKey.status, 401, "Requests without an API key must be rejected");
console.log(JSON.stringify({ probe: "no_api_key", ...missingKey }));
for (const table of ["clients", "organizations", "branches"]) {
  const result = await readProbe(table, publicKey);
  assert.ok([401, 403].includes(result.status), `${table}: anonymous read was not denied`);
  assert.equal(result.errorCode, "42501", `${table}: expected database privilege rejection`);
  assert.equal(result.returnedRows, 0, `${table}: unexpected data returned`);
  console.log(JSON.stringify({ probe: "publishable_key_without_user", ...result }));
}
console.log("PASS: anonymous HTTP checks only; this is not authenticated or frontend E2E verification.");
