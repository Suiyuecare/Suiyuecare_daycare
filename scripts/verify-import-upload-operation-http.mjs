#!/usr/bin/env node
// Denial-only checks on a separately started, credential-free production build.
// No hosted URL, browser profile, redirects, writes or accepted auth claims.
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:4177";
const key = "f2800000-0000-4000-8000-000000000001";
const sentinel = "SYNTHETIC_OPERATION_SECRET_NOT_TO_ECHO";
const results = [], requestIds = new Set();
async function verify(path, label, status, code, headers = {}) {
  const response = await fetch(origin + path, { headers, credentials: "omit", cache: "no-store",
    redirect: "error", signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, status, label); assert.equal(response.redirected, false);
  assert.match(response.headers.get("cache-control") ?? "", /private/u);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:;|$)/u);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("set-cookie"), null);
  const text = await response.text(); assert.ok(Buffer.byteLength(text) < 16 * 1024);
  assert.doesNotMatch(text, /SYNTHETIC_OPERATION_SECRET_NOT_TO_ECHO|"(?:stack|receipt|operation|authorization_claims|archive_reference|parsed_payload|payload_sha256|service_role|access_token|refresh_token|cookie)"|Bearer\s|\beyJ[A-Za-z0-9_-]{12,}/u);
  const value = JSON.parse(text);
  assert.deepEqual(Object.keys(value).sort(), ["data", "errors", "requestId", "status"]);
  assert.equal(value.data, null); assert.equal(value.status, "error");
  assert.match(value.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(requestIds.has(value.requestId), false); requestIds.add(value.requestId);
  assert.deepEqual(Object.keys(value.errors[0]).sort(), ["code", "message"]);
  assert.equal(value.errors.length, 1); assert.equal(value.errors[0].code, code);
  assert.equal(typeof value.errors[0].message, "string");
  results.push({ path, label, status, code, privateNoStore: true, uniqueRequestId: true, pass: true });
}
for (const path of ["/api/imports/operations", "/api/client-intake/imports/operations"]) {
  for (const query of [`key=${key}`, `key=${key}&key=${key}`, `extra=${sentinel}`, "mode=general"]) {
    await verify(`${path}?${query}`, "unsupported query denied before auth", 400, "INVALID_IMPORT_QUERY", { "idempotency-key": key });
  }
  // This HTTP transport/framework normalizes a trailing empty '?'. Direct
  // Request handler tests preserve that spelling and reject it; this probe
  // can only establish fail-closed configuration after normalization.
  await verify(`${path}?`, "normalized empty query still fails closed", 503, "IMPORT_AUTH_NOT_CONFIGURED", { "idempotency-key": key });
  await verify(path, "missing original key", 400, "IMPORT_OPERATION_INVALID_REQUEST");
  await verify(path, "empty original key", 400, "IMPORT_OPERATION_INVALID_REQUEST", { "idempotency-key": "" });
  await verify(path, "duplicate-combined original key", 400, "IMPORT_OPERATION_INVALID_REQUEST", { "idempotency-key": `${key},${sentinel}` });
  await verify(path, "oversized original key", 400, "IMPORT_OPERATION_INVALID_REQUEST", { "idempotency-key": "x".repeat(201) });
  await verify(path, "legal key fails closed without production configuration", 503, "IMPORT_AUTH_NOT_CONFIGURED", { "idempotency-key": key });
}
assert.equal(results.length, 20);
console.log(JSON.stringify({ syntheticOnly: true, productionArtifact: true, hosted: false,
  authenticatedSuccessTested: false, formalImportTested: false, cloudRequests: 0, credentialsUsed: false,
  scope: "Actual Next production HTTP negative contracts only; actual handler/SQL tests separately cover authorized synthetic reads. Not deployment, staff login, WORM or formal intake proof.", results }, null, 2));
