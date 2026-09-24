// No credentials, sessions, real client identifiers, uploads or response-body logs.
// Run only against a normal authenticated app, never the read-only demo server.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";

const base = new URL(process.env.INTAKE_ACCESS_BASE_URL ?? "http://127.0.0.1:3150");
assert.ok(!base.username && !base.password && !base.search && !base.hash);
assert.ok(base.protocol === "https:" || base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const synthetic = "00000000-0000-4000-8000-000000000000";
const profile = { displayName: "Synthetic anonymous denial probe", clientCode: "ANON-DENIED-PROBE",
  dateOfBirth: null, identityNumber: null, sex: "unknown", phone: null, registeredAddress: null,
  residentialAddress: null, cmsLevel: null, disability: null, contacts: [],
  consent: { status: "pending", confirmedOn: null }, notes: "" };
const probes = [
  { path: "/api/clients/transitions", method: "POST", headers: { "idempotency-key": randomUUID() }, body: { client_id: synthetic, event_kind: "admit", effective_on: "2026-09-15", reason: "Synthetic anonymous denial probe", handoff_note: null, expected_row_version: 1 } },
  { path: "/api/care-roster", method: "POST", headers: { "x-care-roster-action": "approve_assignment" }, body: {} },
  { path: `/api/client-intake?client=${synthetic}` },
  { path: `/api/client-intake/imports?batch=${synthetic}` },
  { path: `/api/client-weekly?client=${synthetic}&from=2026-09-14` },
  { path: `/api/client-documents?client=${synthetic}` },
  { path: `/api/client-documents/history?client=${synthetic}&category=medication_bag&limit=50` },
  { path: "/api/client-documents/lifecycle", method: "POST", body: { clientId: synthetic, documentId: synthetic, category: "medication_bag", expectedReviewRevision: 0, disposition: "inactive", reason: "Synthetic anonymous denial probe", idempotency_key: randomUUID() } },
  { path: `/api/taipei-abcd/drafts?clientId=${synthetic}&form=A&usageYear=115` },
  { path: "/api/client-intake", method: "POST", body: { action: "create", idempotency_key: randomUUID(), profile } },
  { path: "/api/client-intake/imports", method: "POST", headers: { "idempotency-key": randomUUID() } },
  { path: "/api/client-intake/imports/approve", method: "POST", body: { batchId: synthetic, idempotency_key: randomUUID(), payloadSha256: "a".repeat(64), clientId: null, expectedVersion: 0, expectedClientVersion: 0, clientCode: "ANON-DENIED-PROBE", sourceReviewReason: null, decisions: [] } },
  // This action validates its client-scoped input before authorization. Send a
  // structurally valid, non-existent synthetic client, not an invalid {} body.
  { path: "/api/client-weekly", method: "POST", headers: { "x-client-weekly-action": "save" }, body: {
    action: "save_plan", clientId: synthetic, expectedVersion: 0, idempotency_key: randomUUID(),
    plan: { effectiveFrom: "2026-09-14", effectiveTo: null, reason: "Synthetic anonymous denial probe",
      days: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, attending: false, startsAt: null, endsAt: null, outbound: null, inbound: null })) },
  } },
  { path: "/api/client-documents", method: "POST", headers: { "x-client-document-action": "upload" }, body: {} },
  { path: "/api/client-documents", method: "POST", headers: { "x-client-document-action": "download" }, body: {} },
  { path: "/api/client-documents", method: "PATCH", headers: { "x-client-document-action": "review" }, body: {} },
  { path: "/api/taipei-abcd/drafts", method: "POST", body: {} },
  { path: "/api/taipei-abcd/workflow", method: "POST", body: {} },
  { path: "/api/taipei-abcd/exports", method: "POST", body: {} },
];
async function boundedText(response, max = 512_000) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > max) throw new Error("Response size exceeds anonymous probe limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const failures = [];
for (const probe of probes) {
  const method = probe.method ?? "GET";
  try {
    const response = await fetch(new URL(probe.path, base), { method, credentials: "omit", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(20_000), headers: { ...(probe.body ? { "content-type": "application/json" } : {}), ...probe.headers },
      ...(probe.body ? { body: JSON.stringify(probe.body) } : {}) });
    const result = JSON.parse(await boundedText(response, 8192));
    assert.equal(response.status, 401); assert.equal(result.status, "error"); assert.equal(result.data, null);
    assert.ok(result.errors?.some((error) => error.code === "AUTH_REQUIRED"));
    assert.match(result.requestId, /^[a-f0-9-]{36}$/i);
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/i);
    assert.equal(result.stack, undefined);
  } catch { failures.push({ method, path: probe.path.split("?")[0], check: "Expected 401/AUTH_REQUIRED, no data, request ID and private/no-store" }); }
}
try {
  const response = await fetch(new URL("/app/client-intake", base), { credentials: "omit", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const $ = load(await boundedText(response));
  const location = response.headers.get("location") ?? $('meta#__next-page-redirect[http-equiv="refresh"]').attr("content")?.match(/^\d+;url=(.+)$/)?.[1];
  const target = location ? new URL(location, base) : null;
  assert.ok([200, 302, 303, 307, 308].includes(response.status));
  assert.equal(target?.origin, base.origin); assert.equal(target?.pathname, "/login"); assert.equal(target?.searchParams.get("audience"), "staff");
  assert.equal($(".app-shell,h1").length, 0);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
} catch { failures.push({ method: "GET", path: "/app/client-intake", check: "Expected staff login redirect with no protected content or cache" }); }
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", origin: base.origin, checked: probes.length + 1, failures,
  scope: "Anonymous denial only; no authenticated workflow, real upload, or role-grant claim" }));
if (failures.length) process.exitCode = 1;
