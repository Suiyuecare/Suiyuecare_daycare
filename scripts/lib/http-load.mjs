// Isolated staging only. This module never signs JWTs, creates users, or uses a
// database/service-role key. Cookie/access-token material stays in memory.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENV = /^DAYCARE_LOAD_[A-Z0-9_]{1,100}$/;
const PRODUCTION_REFS = new Set(["mmxqxsokpcdvuzmdhptg", "diompsnswchpfguvryan"]);
const FORBIDDEN_HOSTS = new Set(["suiyuecare.com", "www.suiyuecare.com", "daycare.suiyuecare.com", "finance.suiyuecare.com", "apm.suiyuecare.com"]);
export const LOAD_CONCURRENCY = 50;
export class LoadFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new LoadFailure(code); };
const unique = (values) => new Set(values).size === values.length;
const id = (value) => typeof value === "string" && UUID.test(value);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const exactKeys = (value, keys, code) => check(value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), code);

export function validateOrigins(appOrigin, authOrigin, allowOrigin, allowAuthOrigin) {
  let app; let auth;
  try { app = new URL(appOrigin); auth = new URL(authOrigin); } catch { throw new LoadFailure("ORIGIN_INVALID"); }
  check(app.origin === appOrigin && auth.origin === authOrigin && !app.username && !auth.username, "ORIGIN_INVALID");
  check(!FORBIDDEN_HOSTS.has(app.hostname) && ![...PRODUCTION_REFS].some((ref) => app.hostname.includes(ref) || auth.hostname.includes(ref)), "PRODUCTION_ORIGIN_DENIED");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(app.hostname);
  check((local && app.protocol === "http:") || (app.protocol === "https:" && /(?:^|[-.])(?:staging|preview|loadtest)(?:[-.]|$)/.test(app.hostname)), "STAGING_ORIGIN_REQUIRED");
  check(auth.protocol === "https:" && /^[a-z]{20}\.supabase\.co$/.test(auth.hostname), "ISOLATED_GOTRUE_ORIGIN_REQUIRED");
  check(appOrigin === allowOrigin && authOrigin === allowAuthOrigin, "EXACT_ORIGIN_ALLOWLIST_REQUIRED");
}

export function validateManifest(manifest, options, now = Date.now()) {
  exactKeys(manifest, ["version", "environment", "dataClass", "fixtureId", "appOrigin", "authOrigin", "stagingAttestation", "historyYears", "branches", "clients", "sessions", "foreignClient"], "MANIFEST_KEYS_INVALID");
  check(manifest.version === 1 && manifest.environment === "isolated-staging" && manifest.dataClass === "synthetic-only" && id(manifest.fixtureId), "SYNTHETIC_STAGING_MANIFEST_REQUIRED");
  check(options.confirmFixture === manifest.fixtureId, "FIXTURE_CONFIRMATION_REQUIRED");
  validateOrigins(manifest.appOrigin, manifest.authOrigin, options.allowOrigin, options.allowAuthOrigin);
  const attestation = manifest.stagingAttestation;
  exactKeys(attestation, ["notConnectedToProduction", "sourceCommit", "verifiedAt", "reviewReference"], "ATTESTATION_INVALID");
  check(attestation.notConnectedToProduction === true && /^[a-f0-9]{40}$/.test(attestation.sourceCommit)
    && /^[A-Za-z0-9._:-]{8,120}$/.test(attestation.reviewReference), "STAGING_CONFIGURATION_REVIEW_REQUIRED");
  const verified = Date.parse(attestation.verifiedAt);
  check(Number.isFinite(verified) && verified <= now && now - verified <= 3600000, "STAGING_ATTESTATION_STALE");
  const year = new Date(now).getUTCFullYear();
  check(Array.isArray(manifest.historyYears) && manifest.historyYears.length === 7
    && manifest.historyYears.every((value, i) => value === year - 6 + i), "SEVEN_YEAR_FIXTURE_REQUIRED");
  check(Array.isArray(manifest.branches) && manifest.branches.length === 5, "FIVE_BRANCHES_REQUIRED");
  for (const branch of manifest.branches) {
    exactKeys(branch, ["organizationId", "branchId"], "BRANCH_KEYS_INVALID");
    check(id(branch.organizationId) && id(branch.branchId), "BRANCH_SCOPE_INVALID");
  }
  check(unique(manifest.branches.map((branch) => branch.branchId)), "BRANCH_SCOPE_DUPLICATE");
  check(Array.isArray(manifest.clients) && manifest.clients.length === 500, "FIVE_HUNDRED_CLIENTS_REQUIRED");
  const today = new Date(now).toISOString().slice(0, 10);
  const dayOfYear = Math.floor((now - Date.UTC(year, 0, 1)) / 86400000) + 1;
  for (const client of manifest.clients) {
    exactKeys(client, ["clientId", "organizationId", "branchId", "active", "admittedOn", "historyCounts"], "CLIENT_KEYS_INVALID");
    check(id(client.clientId) && client.active === true && /^\d{4}-\d{2}-\d{2}$/.test(client.admittedOn)
      && Number.isFinite(Date.parse(client.admittedOn)) && new Date(client.admittedOn).toISOString().slice(0, 10) === client.admittedOn
      && client.admittedOn <= today, "ACTIVE_ADMITTED_CLIENT_REQUIRED");
    check(manifest.branches.some((branch) => branch.organizationId === client.organizationId && branch.branchId === client.branchId), "CLIENT_BRANCH_INVALID");
    exactKeys(client.historyCounts, manifest.historyYears.map(String), "HISTORY_INVENTORY_INVALID");
    for (const historyYear of manifest.historyYears) {
      const minimum = historyYear === year ? Math.max(1, Math.floor(dayOfYear * 240 / 365)) : 240;
      check(Number.isInteger(client.historyCounts[historyYear]) && client.historyCounts[historyYear] >= minimum, "REPRESENTATIVE_HISTORY_VOLUME_REQUIRED");
    }
  }
  check(unique(manifest.clients.map((client) => client.clientId)), "CLIENT_DUPLICATE");
  check(Array.isArray(manifest.sessions) && manifest.sessions.length === 200, "TWO_HUNDRED_REAL_SESSIONS_REQUIRED");
  for (const session of manifest.sessions) {
    exactKeys(session, ["actorId", "sessionId", "organizationId", "branchId", "accessTokenEnv", "cookieEnv", "assignedClientIds"], "SESSION_KEYS_INVALID");
    check(id(session.actorId) && id(session.sessionId) && ENV.test(session.accessTokenEnv) && ENV.test(session.cookieEnv)
      && session.accessTokenEnv !== session.cookieEnv, "SESSION_REFERENCE_INVALID");
    check(Array.isArray(session.assignedClientIds) && session.assignedClientIds.length > 0 && unique(session.assignedClientIds)
      && session.assignedClientIds.every((clientId) => manifest.clients.some((client) => client.clientId === clientId
        && client.organizationId === session.organizationId && client.branchId === session.branchId)), "SESSION_ASSIGNMENT_INVALID");
  }
  check(unique(manifest.sessions.map((s) => s.actorId)) && unique(manifest.sessions.map((s) => s.sessionId))
    && unique(manifest.sessions.flatMap((s) => [s.accessTokenEnv, s.cookieEnv])), "SESSION_IDENTITY_DUPLICATE");
  for (const branch of manifest.branches) {
    check(manifest.clients.filter((client) => client.branchId === branch.branchId).length === 100, "BRANCH_CLIENT_DISTRIBUTION_INVALID");
    check(manifest.sessions.filter((session) => session.branchId === branch.branchId && session.organizationId === branch.organizationId).length === 40, "BRANCH_STAFF_DISTRIBUTION_INVALID");
  }
  check(manifest.clients.every((client) => manifest.sessions.some((session) => session.assignedClientIds.includes(client.clientId))), "CLIENT_ASSIGNMENT_COVERAGE_MISSING");
  exactKeys(manifest.foreignClient, ["clientId", "organizationId", "branchId"], "FOREIGN_SCOPE_PROBE_INVALID");
  check(id(manifest.foreignClient.clientId) && id(manifest.foreignClient.organizationId) && id(manifest.foreignClient.branchId)
    && !manifest.clients.some((client) => client.clientId === manifest.foreignClient.clientId)
    && !manifest.branches.some((branch) => branch.organizationId === manifest.foreignClient.organizationId || branch.branchId === manifest.foreignClient.branchId), "FOREIGN_TENANT_PROBE_REQUIRED");
  return manifest;
}

export function loadSessionSecrets(manifest, environment, durationMs, now = Date.now()) {
  const secrets = manifest.sessions.map((session) => {
    const accessToken = environment[session.accessTokenEnv]; const cookie = environment[session.cookieEnv];
    check(typeof accessToken === "string" && accessToken.length < 16384 && typeof cookie === "string"
      && cookie.length > 20 && cookie.length < 32768 && !/[\r\n]/.test(cookie), "SESSION_SECRET_MISSING_OR_INVALID");
    let claims; let header;
    try { const parts = accessToken.split("."); check(parts.length === 3, "SESSION_TOKEN_INVALID");
      header = JSON.parse(Buffer.from(parts[0], "base64url")); claims = JSON.parse(Buffer.from(parts[1], "base64url"));
    } catch { throw new LoadFailure("SESSION_TOKEN_INVALID"); }
    // Decoding is only a consistency check. GoTrue /user must verify the token
    // before any app reads/writes; no decoded claim alone grants authority.
    check(["HS256", "RS256", "ES256"].includes(header.alg) && claims.sub === session.actorId && claims.session_id === session.sessionId
      && claims.iss === `${manifest.authOrigin}/auth/v1` && claims.role === "authenticated" && claims.aud === "authenticated"
      && ["aal1", "aal2"].includes(claims.aal) && claims.exp * 1000 > now + durationMs + 300000
      && Array.isArray(claims.amr) && claims.amr.some((claim) => claim.method === "oauth"), "REAL_GOTRUE_SESSION_REQUIRED");
    return { accessToken, cookie };
  });
  check(unique(secrets.map((secret) => digest(secret.accessToken))) && unique(secrets.map((secret) => digest(secret.cookie))), "SESSION_CREDENTIAL_REUSE_DENIED");
  return secrets;
}

export const percentile95 = (values) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;
export function assertEnvelope(value, status = "ok") {
  check(value && id(value.requestId) && value.status === status && Array.isArray(value.errors), "API_ENVELOPE_INVALID");
  check(status === "ok" ? value.errors.length === 0 && value.data !== null : value.data === null && value.errors.length > 0, "API_ENVELOPE_INVALID");
  return value.data;
}

export function assertSnapshot(data, clientId, fixtureId, runId) {
  check(data && data.persisted === true && data.demo === false && Array.isArray(data.records) && Array.isArray(data.history), "SNAPSHOT_INVALID");
  check(unique(data.records.map((record) => record.id)) && unique(data.history.map((record) => record.id)), "DUPLICATE_RECORD_DETECTED");
  check(unique(data.records.map((record) => record.record_key)), "DUPLICATE_TERMINAL_DETECTED");
  // Seven-year fixtures contain thousands of rows per snapshot. Indexed
  // identity checks preserve exact matching without quadratic client work.
  const historyById = new Map(data.history.map((record) => [record.id, record]));
  const terminalKeys = new Set(data.records.map((record) => record.record_key));
  const fixtureMarker = `LOADTEST_FIXTURE:${fixtureId}`; const runMarker = `LOADTEST_RUN:${runId}`;
  for (const record of data.records) {
    check(record.client_id === clientId, "CROSS_SCOPE_LEAK_DETECTED");
    check(record.fields && [fixtureMarker, runMarker].includes(record.fields.care_item), "NON_SYNTHETIC_DATA_DETECTED");
    check(record.status === "draft" && record.correction_reason === null && record.signed_at === null
      && record.signed_by === null && record.content_hash === null
      && (record.correction_source_id === undefined || record.correction_source_id === null), "NON_SYNTHETIC_DATA_DETECTED");
    check(Object.keys(record.fields).every((field) => ["shift", "care_item", "note", "abnormal", "follow_up"].includes(field))
      && ["morning", "afternoon", "full_day"].includes(record.fields.shift), "NON_SYNTHETIC_DATA_DETECTED");
    check(record.fields.note === "LOADTEST_ONLY" && record.fields.abnormal === false
      && (!Object.hasOwn(record.fields, "follow_up") || record.fields.follow_up === "LOADTEST_ONLY"), "NON_SYNTHETIC_DATA_DETECTED");
    const history = historyById.get(record.id);
    check(history && history.record_key === record.record_key && history.version === record.version, "MISSING_HISTORY_DETECTED");
  }
  check(data.history.every((history) => terminalKeys.has(history.record_key)), "CROSS_SCOPE_LEAK_DETECTED");
  check(data.history.every((history) => history.status === "draft" && history.correction_reason === null
    && history.signed_at === null && history.signed_by === null && history.content_hash === null), "NON_SYNTHETIC_DATA_DETECTED");
  return data;
}

function semaphore(limit) {
  let active = 0; const pending = [];
  return async (work) => {
    if (active >= limit) await new Promise((resolve) => pending.push(resolve));
    else active += 1;
    try { return await work(); } finally {
      // Transfer the held permit directly, so a new caller cannot race a
      // resumed waiter into a 51st HTTP request.
      const waiting = pending.shift(); if (waiting) waiting(); else active -= 1;
    }
  };
}
async function pool(items, concurrency, work) {
  let next = 0; let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !failure) {
      const index = next++;
      try { await work(items[index], index); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}
const fieldsFor = (marker, shift = "morning") => ({ shift, care_item: marker, note: "LOADTEST_ONLY", abnormal: false });

export async function runHttpLoad({ manifest, options, environment = process.env, fetchImpl = globalThis.fetch,
  durationMs = 600000, monotonic = () => performance.now(), wallNow = () => Date.now() }) {
  validateManifest(manifest, options, wallNow());
  const secrets = loadSessionSecrets(manifest, environment, durationMs, wallNow());
  const publishableKey = environment.DAYCARE_LOAD_PUBLISHABLE_KEY;
  check(typeof publishableKey === "string" && /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey), "ISOLATED_PUBLISHABLE_KEY_REQUIRED");
  const runId = randomUUID(); const salt = randomBytes(32).toString("hex");
  const scopeHash = (branch) => digest(`${salt}:${branch.organizationId}:${branch.branchId}`);
  const stats = { read: [], write: [], readSuccess: [], writeSuccess: [], errorCodes: {}, leaks: 0, duplicates: 0, missing: 0,
    completed: 0, replays: 0, conflicts: 0, casConflicts: 0, actors: new Set(), clients: new Set(), peak: 0, active: 0 };
  const actorProgress = Array.from({ length: 200 }, () => 0);
  const withinLimit = semaphore(LOAD_CONCURRENCY);
  let measured = false; let fatal = null;
  const failure = (error) => {
    const code = error instanceof LoadFailure ? error.code : "TRANSPORT_FAILED";
    stats.errorCodes[code] = (stats.errorCodes[code] ?? 0) + 1;
    if (["CROSS_SCOPE_LEAK_DETECTED", "NON_SYNTHETIC_DATA_DETECTED"].includes(code)) stats.leaks += 1;
    if (code.includes("DUPLICATE")) stats.duplicates += 1;
    if (code.includes("MISSING")) stats.missing += 1;
    fatal ??= code;
  };
  const request = (index, pathname, method = "GET", body, key) => withinLimit(async () => {
    check(!fatal, "RUN_ABORTED_AFTER_FAILURE");
    const headers = { "accept": "application/json", "cookie": secrets[index].cookie, "cache-control": "no-store",
      "x-care-organization": manifest.sessions[index].organizationId, "x-care-branch": manifest.sessions[index].branchId,
      "x-care-user": manifest.sessions[index].actorId };
    if (body) headers["content-type"] = "application/json";
    if (key) headers["idempotency-key"] = key;
    const start = monotonic(); const count = measured;
    let responseStatus = 0;
    if (count) { stats.active += 1; stats.peak = Math.max(stats.peak, stats.active); }
    try {
      const response = await fetchImpl(`${manifest.appOrigin}${pathname}`, { method, headers,
        body: body ? JSON.stringify(body) : undefined, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) });
      responseStatus = response.status;
      check(response.headers.get("content-type")?.includes("application/json"), "API_CONTENT_TYPE_INVALID");
      check(/(?:private|no-store)/i.test(response.headers.get("cache-control") ?? "") && /no-store/i.test(response.headers.get("cache-control") ?? ""), "SENSITIVE_CACHE_POLICY_INVALID");
      const reader = response.body?.getReader(); check(reader, "API_BODY_MISSING");
      const parts = []; let bytes = 0;
      while (true) { const item = await reader.read(); if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new LoadFailure("SNAPSHOT_SIZE_LIMIT_EXCEEDED"); }
        parts.push(Buffer.from(item.value));
      }
      let envelope;
      try { envelope = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new LoadFailure("API_JSON_INVALID"); }
      // SSR refreshes are retained only in memory, separately for every actor.
      const updated = response.headers.getSetCookie?.() ?? [];
      if (updated.length) {
        const jar = new Map(secrets[index].cookie.split(/;\s*/).map((entry) => { const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)]; }));
        for (const entry of updated) { const pair = entry.split(";", 1)[0]; const at = pair.indexOf("=");
          if (at > 0 && !/[\r\n]/.test(pair)) jar.set(pair.slice(0, at), pair.slice(at + 1)); }
        secrets[index].cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
      }
      return { status: response.status, envelope };
    } finally {
      if (count) { stats.active -= 1; const group = method === "GET" ? stats.read : stats.write;
        check(group.length < 1000000, "SAMPLE_CAP_REACHED"); const elapsed = monotonic() - start; group.push(elapsed);
        if (responseStatus >= 200 && responseStatus < 300) (method === "GET" ? stats.readSuccess : stats.writeSuccess).push(elapsed); }
    }
  });
  const read = async (index, clientId) => {
    const response = await request(index, `/api/records?client=${clientId}`);
    check(response.status === 200, "SNAPSHOT_HTTP_FAILED");
    return assertSnapshot(assertEnvelope(response.envelope), clientId, manifest.fixtureId, runId);
  };
  const expectDenied = async (index, clientId) => {
    const response = await request(index, `/api/records?client=${clientId}`);
    check(response.status === 403, "CROSS_SCOPE_LEAK_DETECTED");
    assertEnvelope(response.envelope, "error");
  };
  const successful = (response, replayed) => {
    check(response.status === (replayed ? 200 : 201), "WRITE_HTTP_FAILED");
    const data = assertEnvelope(response.envelope);
    check(data.demo === false && data.persisted === true && data.replayed === replayed && data.record?.status === "draft", "WRITE_RECEIPT_INVALID");
    return data.record;
  };
  try {
    // Verify all 200 credentials with the pinned, distinct GoTrue project before
    // the app receives any workload. Never manufacture or refresh credentials.
    await pool(manifest.sessions, 10, async (session, index) => {
      const response = await fetchImpl(`${manifest.authOrigin}/auth/v1/user`, { headers: { authorization: `Bearer ${secrets[index].accessToken}`, apikey: publishableKey },
        redirect: "error", signal: AbortSignal.timeout(10000) });
      check(response.status === 200, "GOTRUE_SESSION_REJECTED");
      const user = await response.json();
      check(user.id === session.actorId && user.is_anonymous === false && Array.isArray(user.identities)
        && user.identities.some((identity) => identity.provider === "google"), "GOTRUE_IDENTITY_MISMATCH");
    });
    // Verify actual seven-year fixture counts from authorized API snapshots, not
    // declared row counts alone. Every client must be readable by its assignee.
    await pool(manifest.clients, 10, async (client) => {
      const index = manifest.sessions.findIndex((session) => session.assignedClientIds.includes(client.clientId));
      const snapshot = await read(index, client.clientId);
      for (const year of manifest.historyYears) check(snapshot.records.filter((record) => record.fields.care_item === `LOADTEST_FIXTURE:${manifest.fixtureId}`
        && record.occurred_at.startsWith(`${year}-`)).length === client.historyCounts[year], "LIVE_HISTORY_COUNT_MISMATCH");
    });
    await pool(manifest.sessions, 10, async (session, index) => {
      const other = manifest.clients.find((client) => client.branchId !== session.branchId);
      await expectDenied(index, other.clientId); await expectDenied(index, manifest.foreignClient.clientId);
    });
    measured = true;
    const began = monotonic(); const deadline = began + durationMs;
    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, async (_, worker) => {
      let cycle = 0;
      while (monotonic() < deadline && !fatal) {
        const index = worker + (cycle++ % 4) * LOAD_CONCURRENCY;
        const session = manifest.sessions[index];
        const clientId = session.assignedClientIds[actorProgress[index]++ % session.assignedClientIds.length];
        stats.actors.add(session.actorId); stats.clients.add(clientId);
        try {
          await read(index, clientId);
          const key = randomUUID(); const fields = fieldsFor(`LOADTEST_RUN:${runId}`);
          const body = { client_id: clientId, page_slug: "staff/daily-care/care-diary", occurred_at: new Date(wallNow()).toISOString(), data: fields };
          const initial = successful(await request(index, "/api/records", "POST", body, key), false);
          check(id(initial.id) && initial.version === 1, "WRITE_RECEIPT_INVALID");
          // The create API returns only id/version/status. Read the original
          // persisted fields before an edit can hide a wrong first write.
          const createdSnapshot = await read(index, clientId);
          const created = createdSnapshot.records.filter((record) => record.id === initial.id);
          check(created.length === 1, "MISSING_OR_CHANGED_WRITE_DETECTED");
          const original = created[0];
          check(original.client_id === clientId && original.created_by === session.actorId, "CROSS_SCOPE_LEAK_DETECTED");
          check(original.version === 1 && original.previous_version_id === null
            && typeof original.occurred_at === "string" && Number.isFinite(Date.parse(original.occurred_at))
            && new Date(original.occurred_at).toISOString() === body.occurred_at
            && canonical(original.fields) === canonical(fields), "MISSING_OR_CHANGED_WRITE_DETECTED");
          check(createdSnapshot.records.filter((record) => record.record_key === original.record_key).length === 1
            && createdSnapshot.history.filter((record) => record.record_key === original.record_key).length === 1,
          "DUPLICATE_RECORD_DETECTED");
          const replay = successful(await request(index, "/api/records", "POST", body, key), true);
          check(replay.id === initial.id && replay.version === 1, "DUPLICATE_RECORD_DETECTED"); stats.replays += 1;
          const mismatch = await request(index, "/api/records", "POST", { ...body, data: { ...fields, shift: "afternoon" } }, key);
          check(mismatch.status === 409 && mismatch.envelope.errors?.[0]?.code === "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT_MISSING");
          assertEnvelope(mismatch.envelope, "error"); stats.conflicts += 1;
          const alternatives = ["afternoon", "full_day"].map((shift) => ({ action: "edit", base_version: 1, data: fieldsFor(`LOADTEST_RUN:${runId}`, shift) }));
          const competing = await Promise.all(alternatives.map((body) => request(index, `/api/records/${initial.id}/actions`, "POST", body, randomUUID())));
          check(competing.filter((response) => response.status === 201).length === 1
            && competing.filter((response) => response.status === 409).length === 1, "CAS_CONFLICT_MISSING");
          const winnerIndex = competing.findIndex((response) => response.status === 201);
          const winner = successful(competing[winnerIndex], false);
          const denied = competing.find((response) => response.status === 409);
          check(denied.envelope.errors?.[0]?.code === "VERSION_CONFLICT", "CAS_CONFLICT_CODE_INVALID"); assertEnvelope(denied.envelope, "error");
          check(winner.client_id === clientId && winner.created_by === session.actorId, "CROSS_SCOPE_LEAK_DETECTED");
          check(winner.previous_version_id === initial.id && winner.version === 2
            && winner.record_key === original.record_key
            && canonical(winner.fields) === canonical(alternatives[winnerIndex].data), "WRITE_RECEIPT_INVALID"); stats.casConflicts += 1;
          const current = await read(index, clientId);
          const terminal = current.records.filter((record) => record.record_key === winner.record_key);
          const chain = current.history.filter((record) => record.record_key === winner.record_key);
          check(terminal.length > 0 && chain.length >= 2, "MISSING_HISTORY_DETECTED");
          check(terminal.length === 1 && chain.length === 2, "DUPLICATE_RECORD_DETECTED");
          check(terminal[0].created_by === session.actorId, "CROSS_SCOPE_LEAK_DETECTED");
          check(terminal[0].id === winner.id && terminal[0].version === 2 && canonical(terminal[0].fields) === canonical(winner.fields)
            && chain.some((record) => record.id === initial.id), "MISSING_OR_CHANGED_WRITE_DETECTED");
          stats.completed += 1;
          // Mixed reads dominate ordinary use; expected rejection probes remain
          // separately counted and are not misreported as application failures.
          for (let n = 0; n < 4; n++) await read(index, clientId);
          await expectDenied(index, manifest.clients.find((client) => client.branchId !== session.branchId).clientId);
        } catch (error) { failure(error); }
      }
    }));
    stats.elapsedMs = monotonic() - began;
  } catch (error) { failure(error); }
  const readP95 = percentile95(stats.read); const writeP95 = percentile95(stats.write);
  const successfulReadP95 = percentile95(stats.readSuccess); const successfulWriteP95 = percentile95(stats.writeSuccess);
  const gates = { preflight: measured, exactConcurrency: stats.peak === LOAD_CONCURRENCY, actorsCovered: stats.actors.size === 200,
    clientsCovered: stats.clients.size === 500, minimumSamples: stats.read.length >= 1000 && stats.write.length >= 1000,
    readP95: readP95 !== null && readP95 <= 2000 && successfulReadP95 !== null && successfulReadP95 <= 2000,
    writeP95: writeP95 !== null && writeP95 <= 1500 && successfulWriteP95 !== null && successfulWriteP95 <= 1500,
    errors: Object.keys(stats.errorCodes).length === 0, isolation: stats.leaks === 0, duplicates: stats.duplicates === 0,
    missing: stats.missing === 0, reconciled: stats.completed > 0 && stats.completed === stats.replays && stats.completed === stats.conflicts && stats.completed === stats.casConflicts };
  return { version: 1, runId, proofLevel: fetchImpl === globalThis.fetch ? "isolated-staging-http" : "mock-http-tool-contract-only",
    productionVerified: false, generatedAt: new Date(wallNow()).toISOString(), fixtureDigest: digest(canonical(manifest)),
    originHash: digest(`${salt}:${manifest.appOrigin}`), scopes: manifest.branches.map((branch) => ({ scopeHash: scopeHash(branch), clients: 100, employees: 40 })),
    dataset: { branches: 5, clients: 500, employees: 200, years: 7, historicalRecords: manifest.clients.reduce((sum, client) => sum + Object.values(client.historyCounts).reduce((a, b) => a + b, 0), 0) },
    workload: { requestedConcurrency: 50, peakInFlight: stats.peak, durationMs: stats.elapsedMs ?? 0, actorsCovered: stats.actors.size, clientsCovered: stats.clients.size,
      readSamples: stats.read.length, writeSamples: stats.write.length, readP95Ms: readP95, writeP95Ms: writeP95, completedFlows: stats.completed,
      successfulReadSamples: stats.readSuccess.length, successfulWriteSamples: stats.writeSuccess.length,
      successfulReadP95Ms: successfulReadP95, successfulWriteP95Ms: successfulWriteP95,
      exactReplays: stats.replays, expectedIdempotencyConflicts: stats.conflicts, expectedCasConflicts: stats.casConflicts },
    violations: { errorCodes: stats.errorCodes, leaks: stats.leaks, duplicates: stats.duplicates, missing: stats.missing }, gates,
    accepted: Object.values(gates).every(Boolean), limitations: ["Not production acceptance", "Only unsigned care diary workflow; medication, claims, Finance, uploads and downloads need independent validation", "Fixture audit and GoTrue verification do not certify DPA, PITR, backup or penetration testing"] };
}
