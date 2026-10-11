import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertEnvelope, assertSnapshot, loadSessionSecrets, percentile95, runHttpLoad, validateManifest, validateOrigins } from "../lib/http-load.mjs";

const now = Date.parse("2026-10-12T03:00:00Z");
const uid = (category, index = 1) => `${String(category).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
const origin = "https://daycare-loadtest.example.invalid";
const auth = "https://abcdefghijklmnopqrst.supabase.co";
const optionsFor = (m) => ({ allowOrigin: m.appOrigin, allowAuthOrigin: m.authOrigin, confirmFixture: m.fixtureId });
function fixture() {
  const branches = Array.from({ length: 5 }, (_, i) => ({ organizationId: uid(1), branchId: uid(2, i + 1) }));
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const clients = branches.flatMap((branch, b) => Array.from({ length: 100 }, (_, i) => ({
    ...branch, clientId: uid(3, b * 100 + i + 1), active: true, admittedOn: "2020-01-01",
    historyCounts: Object.fromEntries(years.map((year) => [year, 240])),
  })));
  const sessions = branches.flatMap((branch, b) => Array.from({ length: 40 }, (_, i) => ({
    ...branch, actorId: uid(4, b * 40 + i + 1), sessionId: uid(5, b * 40 + i + 1),
    accessTokenEnv: `DAYCARE_LOAD_ACCESS_${b * 40 + i}`, cookieEnv: `DAYCARE_LOAD_COOKIE_${b * 40 + i}`,
    assignedClientIds: [clients[b * 100 + i].clientId, clients[b * 100 + 40 + i].clientId,
      clients[b * 100 + 80 + (i % 20)].clientId],
  })));
  return { version: 1, environment: "isolated-staging", dataClass: "synthetic-only", fixtureId: uid(6),
    appOrigin: origin, authOrigin: auth, stagingAttestation: { notConnectedToProduction: true,
      sourceCommit: "a".repeat(40), verifiedAt: new Date(now).toISOString(), reviewReference: "LOCAL-MOCK-CONTRACT-ONLY" },
    historyYears: years, branches, clients, sessions, foreignClient: { organizationId: uid(8), branchId: uid(9), clientId: uid(10) } };
}
function secretEnvironment(m) {
  const environment = { DAYCARE_LOAD_PUBLISHABLE_KEY: "sb_publishable_mock_contract_only" };
  for (const session of m.sessions) {
    // Mock fixtures only; this is NOT a valid signed JWT and the tool never
    // creates one. Production GoTrue must reject these fabricated credentials.
    const claims = { sub: session.actorId, session_id: session.sessionId, iss: `${auth}/auth/v1`,
      role: "authenticated", aud: "authenticated", aal: "aal1", exp: now / 1000 + 7200, amr: [{ method: "oauth" }] };
    environment[session.accessTokenEnv] = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.MOCK_NOT_A_SIGNATURE`;
    environment[session.cookieEnv] = `sb-mock-auth-token=${session.sessionId}; daycare_branch=${session.branchId}`;
  }
  return environment;
}
const expectCode = (work, code) => assert.throws(work, (error) => error.code === code);

test("hard denial cannot be overridden by exact CLI allowlist", () => {
  for (const prod of ["https://daycare.suiyuecare.com", "https://finance.suiyuecare.com", "https://apm.suiyuecare.com"])
    expectCode(() => validateOrigins(prod, auth, prod, auth), "PRODUCTION_ORIGIN_DENIED");
  for (const ref of ["mmxqxsokpcdvuzmdhptg", "diompsnswchpfguvryan"])
    expectCode(() => validateOrigins(origin, `https://${ref}.supabase.co`, origin, `https://${ref}.supabase.co`), "PRODUCTION_ORIGIN_DENIED");
});
test("origin must be staging-labelled, exactly allowlisted, HTTPS and credential free", () => {
  expectCode(() => validateOrigins("https://daycare.example.invalid", auth, "https://daycare.example.invalid", auth), "STAGING_ORIGIN_REQUIRED");
  expectCode(() => validateOrigins(origin, auth, "https://other-loadtest.example.invalid", auth), "EXACT_ORIGIN_ALLOWLIST_REQUIRED");
  expectCode(() => validateOrigins(origin, auth, origin, "https://other.supabase.co"), "EXACT_ORIGIN_ALLOWLIST_REQUIRED");
  expectCode(() => validateOrigins(`${origin}/path`, auth, `${origin}/path`, auth), "ORIGIN_INVALID");
  expectCode(() => validateOrigins("https://user:secret@daycare-loadtest.example.invalid", auth, origin, auth), "ORIGIN_INVALID");
  expectCode(() => validateOrigins(origin, "http://abcdefghijklmnopqrst.supabase.co", origin, auth), "ISOLATED_GOTRUE_ORIGIN_REQUIRED");
  expectCode(() => validateOrigins(origin, "https://local.test", origin, "https://local.test"), "ISOLATED_GOTRUE_ORIGIN_REQUIRED");
  validateOrigins("http://127.0.0.1:3919", auth, "http://127.0.0.1:3919", auth);
});
test("complete 5/500/200/seven-year manifest passes and does not contain credentials", () => {
  const m = fixture(); assert.equal(validateManifest(m, optionsFor(m), now), m);
  assert.equal(m.clients.length, 500); assert.equal(m.sessions.length, 200);
  assert.ok(!JSON.stringify(m).includes("MOCK_NOT_A_SIGNATURE"));
});
test("fixture confirmation and fresh configuration review are mandatory", () => {
  const m = fixture(); expectCode(() => validateManifest(m, { ...optionsFor(m), confirmFixture: uid(99) }, now), "FIXTURE_CONFIRMATION_REQUIRED");
  m.stagingAttestation.notConnectedToProduction = false;
  expectCode(() => validateManifest(m, optionsFor(m), now), "STAGING_CONFIGURATION_REVIEW_REQUIRED");
  m.stagingAttestation.notConnectedToProduction = true; m.stagingAttestation.verifiedAt = new Date(now - 3600001).toISOString();
  expectCode(() => validateManifest(m, optionsFor(m), now), "STAGING_ATTESTATION_STALE");
});
test("count, branch distribution, duplicate identities and assignment coverage fail closed", () => {
  for (const [field, code] of [["branches", "FIVE_BRANCHES_REQUIRED"], ["clients", "FIVE_HUNDRED_CLIENTS_REQUIRED"], ["sessions", "TWO_HUNDRED_REAL_SESSIONS_REQUIRED"], ["historyYears", "SEVEN_YEAR_FIXTURE_REQUIRED"]]) {
    const m = fixture(); m[field].pop(); expectCode(() => validateManifest(m, optionsFor(m), now), code);
  }
  let m = fixture(); m.sessions[1].actorId = m.sessions[0].actorId;
  expectCode(() => validateManifest(m, optionsFor(m), now), "SESSION_IDENTITY_DUPLICATE");
  m = fixture(); m.clients[1].clientId = m.clients[0].clientId;
  expectCode(() => validateManifest(m, optionsFor(m), now), "CLIENT_DUPLICATE");
  m = fixture(); m.sessions[0].assignedClientIds = [m.clients[100].clientId];
  expectCode(() => validateManifest(m, optionsFor(m), now), "SESSION_ASSIGNMENT_INVALID");
  m = fixture(); m.sessions[0].assignedClientIds = m.sessions[0].assignedClientIds.slice(1);
  expectCode(() => validateManifest(m, optionsFor(m), now), "CLIENT_ASSIGNMENT_COVERAGE_MISSING");
});
test("unknown manifest fields, inline secrets, undersized years and foreign-tenant alias rejected", () => {
  let m = fixture(); m.access_token = "DO_NOT_LOG";
  expectCode(() => validateManifest(m, optionsFor(m), now), "MANIFEST_KEYS_INVALID");
  m = fixture(); m.sessions[0].cookie = "DO_NOT_LOG";
  expectCode(() => validateManifest(m, optionsFor(m), now), "SESSION_KEYS_INVALID");
  m = fixture(); m.clients[0].historyCounts[2020] = 239;
  expectCode(() => validateManifest(m, optionsFor(m), now), "REPRESENTATIVE_HISTORY_VOLUME_REQUIRED");
  m = fixture(); m.foreignClient.organizationId = m.branches[0].organizationId;
  expectCode(() => validateManifest(m, optionsFor(m), now), "FOREIGN_TENANT_PROBE_REQUIRED");
});
test("secret references are memory-only and reject reused, expired, anonymous or wrong-issuer credentials", () => {
  const m = fixture(); const env = secretEnvironment(m);
  assert.equal(loadSessionSecrets(m, env, 600000, now).length, 200);
  const first = m.sessions[0]; const missing = { ...env }; delete missing[first.cookieEnv];
  expectCode(() => loadSessionSecrets(m, missing, 600000, now), "SESSION_SECRET_MISSING_OR_INVALID");
  const injected = { ...env, [first.cookieEnv]: `${env[first.cookieEnv]}\r\nAuthorization: bad` };
  expectCode(() => loadSessionSecrets(m, injected, 600000, now), "SESSION_SECRET_MISSING_OR_INVALID");
  const duplicate = { ...env, [m.sessions[1].cookieEnv]: env[first.cookieEnv] };
  expectCode(() => loadSessionSecrets(m, duplicate, 600000, now), "SESSION_CREDENTIAL_REUSE_DENIED");
  for (const patch of [{ exp: now / 1000 }, { role: "service_role" }, { iss: "https://diompsnswchpfguvryan.supabase.co/auth/v1" }, { sub: uid(99) }, { amr: [{ method: "password" }] }]) {
    const pieces = env[first.accessTokenEnv].split(".");
    const claims = { ...JSON.parse(Buffer.from(pieces[1], "base64url")), ...patch };
    const replaced = { ...env, [first.accessTokenEnv]: `${pieces[0]}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${pieces[2]}` };
    expectCode(() => loadSessionSecrets(m, replaced, 600000, now), "REAL_GOTRUE_SESSION_REQUIRED");
  }
});
test("p95 is nearest-rank and empty samples cannot pass", () => {
  assert.equal(percentile95([]), null); assert.equal(percentile95([2001]), 2001);
  assert.equal(percentile95(Array.from({ length: 100 }, (_, i) => i + 1)), 95);
});
test("snapshots deny leak, fake demo, duplicate, missing history and unmarked private text", () => {
  const m = fixture(); const record = { id: uid(11), record_key: uid(12), version: 1, client_id: m.clients[0].clientId,
    fields: { care_item: `LOADTEST_FIXTURE:${m.fixtureId}`, note: "LOADTEST_ONLY", abnormal: false } };
  const valid = { demo: false, persisted: true, records: [record], history: [{ id: record.id, record_key: record.record_key, version: 1 }] };
  assertSnapshot(valid, record.client_id, m.fixtureId, uid(13));
  expectCode(() => assertSnapshot({ ...valid, demo: true }, record.client_id, m.fixtureId, uid(13)), "SNAPSHOT_INVALID");
  expectCode(() => assertSnapshot(valid, m.clients[1].clientId, m.fixtureId, uid(13)), "CROSS_SCOPE_LEAK_DETECTED");
  expectCode(() => assertSnapshot({ ...valid, records: [record, record] }, record.client_id, m.fixtureId, uid(13)), "DUPLICATE_RECORD_DETECTED");
  expectCode(() => assertSnapshot({ ...valid, history: [] }, record.client_id, m.fixtureId, uid(13)), "MISSING_HISTORY_DETECTED");
  expectCode(() => assertSnapshot({ ...valid, records: [{ ...record, fields: { ...record.fields, note: "private health content" } }] }, record.client_id, m.fixtureId, uid(13)), "NON_SYNTHETIC_DATA_DETECTED");
  expectCode(() => assertEnvelope({ requestId: uid(11), status: "ok", data: null, errors: [] }), "API_ENVELOPE_INVALID");
});

function mockHttp(m, behavior = {}) {
  let clock = 0; const saved = new Map(); const byKey = new Map(); const calls = { auth: 0, writes: 0, peak: 0, active: 0 };
  const seedIds = m.historyYears.flatMap((year, yi) => Array.from({ length: 240 }, (_, n) => ({ year, offset: yi * 240 + n })));
  const success = (data, status = 200) => new Response(JSON.stringify({ requestId: randomUUID(), status: "ok", data, errors: [] }),
    { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  const denied = (status, code) => new Response(JSON.stringify({ requestId: randomUUID(), status: "error", data: null, errors: [{ code, message: "mock" }] }),
    { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  const fetch = async (url, input) => {
    calls.active += 1; calls.peak = Math.max(calls.peak, calls.active);
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const parsed = new URL(url);
      if (parsed.origin === auth) {
        calls.auth += 1; const token = input.headers.authorization.slice(7);
        const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
        return new Response(JSON.stringify({ id: claims.sub, is_anonymous: false, identities: [{ provider: "google" }] }), { status: behavior.rejectAuth ? 401 : 200 });
      }
      const index = m.sessions.findIndex((session) => input.headers.cookie.includes(session.sessionId));
      assert.ok(index >= 0); const actor = m.sessions[index];
      if (input.method === "GET") {
        const clientId = parsed.searchParams.get("client"); const c = m.clients.find((client) => client.clientId === clientId);
        if (!c || c.branchId !== actor.branchId) return behavior.leak ? success({ demo: false, persisted: true, records: [], history: [] }) : denied(403, "DIARY_READ_FAILED");
        const clientIndex = m.clients.indexOf(c);
        const records = seedIds.slice(0, behavior.missingHistory ? 1 : seedIds.length).map(({ year, offset }) => ({
          id: uid(20, clientIndex * 10000 + offset + 1), record_key: uid(21, clientIndex * 10000 + offset + 1), version: 1,
          client_id: clientId, occurred_at: `${year}-01-01T08:00:00Z`, fields: { care_item: `LOADTEST_FIXTURE:${m.fixtureId}`, note: "LOADTEST_ONLY", abnormal: false },
        }));
        const history = records.map((record) => ({ id: record.id, record_key: record.record_key, version: 1 }));
        for (const chain of saved.values()) if (chain[0].client_id === clientId) {
          records.push(chain.at(-1)); history.push(...chain.map((record) => ({ id: record.id, record_key: record.record_key, version: record.version })));
        }
        return success({ demo: false, persisted: true, records, history });
      }
      calls.writes += 1; clock += 1;
      const body = JSON.parse(input.body); const key = `${index}:${input.headers["idempotency-key"]}`;
      if (parsed.pathname === "/api/records") {
        if (byKey.has(key)) {
          const old = byKey.get(key); if (old.input !== input.body) return denied(409, "IDEMPOTENCY_CONFLICT");
          const record = behavior.duplicate ? { ...old.record, id: randomUUID() } : old.record;
          return success({ persisted: true, demo: false, replayed: true, record }, 200);
        }
        const record = { id: randomUUID(), record_key: randomUUID(), version: 1, status: "draft", client_id: body.client_id,
          created_by: actor.actorId, fields: body.data, occurred_at: body.occurred_at, previous_version_id: null };
        saved.set(record.record_key, [record]); byKey.set(key, { record, input: input.body });
        return success({ persisted: true, demo: false, replayed: false, record }, 201);
      }
      const recordId = parsed.pathname.split("/")[3]; const chain = [...saved.values()].find((chain) => chain.some((r) => r.id === recordId));
      if (chain.at(-1).version !== body.base_version) return denied(409, "VERSION_CONFLICT");
      const record = { ...chain.at(-1), id: randomUUID(), version: 2, previous_version_id: recordId, fields: body.data };
      chain.push(record); return success({ persisted: true, demo: false, replayed: false, record }, 201);
    } finally { calls.active -= 1; }
  };
  return { fetch, calls, monotonic: () => clock };
}
test("mock HTTP refuses unverified GoTrue sessions before any app request or write", async () => {
  const m = fixture(); const mock = mockHttp(m, { rejectAuth: true });
  const result = await runHttpLoad({ manifest: m, options: optionsFor(m), environment: secretEnvironment(m), fetchImpl: mock.fetch, wallNow: () => now, monotonic: mock.monotonic, durationMs: 1 });
  assert.equal(result.accepted, false); assert.equal(result.violations.errorCodes.GOTRUE_SESSION_REJECTED, 1);
  assert.equal(mock.calls.writes, 0); assert.equal(result.proofLevel, "mock-http-tool-contract-only");
});
test("declared history is checked by HTTP and mismatch stops all writes", async () => {
  const m = fixture(); const mock = mockHttp(m, { missingHistory: true });
  const result = await runHttpLoad({ manifest: m, options: optionsFor(m), environment: secretEnvironment(m), fetchImpl: mock.fetch, wallNow: () => now, monotonic: mock.monotonic, durationMs: 1 });
  assert.equal(result.accepted, false); assert.equal(result.violations.errorCodes.LIVE_HISTORY_COUNT_MISMATCH, 1);
  assert.equal(mock.calls.writes, 0); assert.equal(mock.calls.auth, 200);
});
test("50 HTTP requests mixed with drafts replay conflicts and exact readback; report contains no secrets or IDs", async () => {
  const m = fixture(); const env = secretEnvironment(m); const mock = mockHttp(m);
  const result = await runHttpLoad({ manifest: m, options: optionsFor(m), environment: env, fetchImpl: mock.fetch, wallNow: () => now, monotonic: mock.monotonic, durationMs: 1 });
  assert.equal(result.proofLevel, "mock-http-tool-contract-only"); assert.equal(result.productionVerified, false);
  assert.equal(result.workload.peakInFlight, 50); assert.ok(mock.calls.peak <= 50);
  assert.equal(result.workload.completedFlows, 50); assert.equal(result.workload.exactReplays, 50);
  assert.equal(result.workload.expectedIdempotencyConflicts, 50); assert.equal(result.workload.expectedCasConflicts, 50);
  assert.deepEqual(result.violations.errorCodes, {}); assert.equal(result.gates.reconciled, true);
  assert.equal(result.accepted, false); // deliberately short, not all users/clients/sample threshold
  const report = JSON.stringify(result);
  for (const session of m.sessions) {
    assert.ok(!report.includes(session.actorId) && !report.includes(session.sessionId)
      && !report.includes(env[session.accessTokenEnv]) && !report.includes(env[session.cookieEnv]));
  }
  for (const client of m.clients) assert.ok(!report.includes(client.clientId));
  assert.ok(!report.includes("LOADTEST_ONLY") && !report.includes("authorization") && !report.includes(origin));
});
