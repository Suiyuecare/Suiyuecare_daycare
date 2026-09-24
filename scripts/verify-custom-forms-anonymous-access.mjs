// Anonymous release probes only: no cookies, credentials, valid mutation bodies,
// real client IDs, OAuth automation, token logging, or response-body logging.
// This proves denial at the public boundary, not an authenticated workflow.
import assert from "node:assert/strict";
import { load } from "cheerio";

const fakeId = "00000000-0000-4000-8000-000000000000";
const pages = ["/app/client-forms", "/app/staff/governance/form-rule-versions"];
const probes = [
  { name: "publication-review-read-missing-query", path: "/api/forms/publications/review" },
  { name: "publication-review-read-fake-version", path: `/api/forms/publications/review?version=${fakeId}` },
  { name: "publication-review-write-empty", path: "/api/forms/publications/review", method: "POST", body: "{}" },
  { name: "publication-review-write-invalid-json", path: "/api/forms/publications/review", method: "POST", body: "{" },
  ...["request", "approve", "withdraw", "return"].map((action) => ({
    name: `publication-review-${action}-incomplete`, path: "/api/forms/publications/review", method: "POST",
    body: JSON.stringify({ formVersionId: fakeId, action }),
  })),
  { name: "lifecycle-read-missing-query", path: "/api/forms/lifecycle" },
  { name: "lifecycle-read-fake-version", path: `/api/forms/lifecycle?version=${fakeId}` },
  { name: "lifecycle-write-empty", path: "/api/forms/lifecycle", method: "POST", body: "{}" },
  { name: "lifecycle-write-invalid-json", path: "/api/forms/lifecycle", method: "POST", body: "{" },
  { name: "responses-read-missing-query", path: "/api/forms/responses" },
  { name: "responses-read-fake-client", path: `/api/forms/responses?clientId=${fakeId}` },
  { name: "responses-write-empty", path: "/api/forms/responses", method: "POST", body: "{}" },
  { name: "responses-write-invalid-json", path: "/api/forms/responses", method: "POST", body: "{" },
  // All three actions share POST /responses. These deliberately incomplete
  // bodies cannot save, sign or correct a record even if authorization regresses.
  ...["save", "sign", "correct"].map((action) => ({
    name: `responses-${action}-incomplete`, path: "/api/forms/responses", method: "POST",
    body: JSON.stringify({ clientId: fakeId, input: { action } }),
  })),
  { name: "print-prepare-empty", path: "/api/forms/responses/prints", method: "POST", body: "{}" },
  { name: "print-prepare-invalid-json", path: "/api/forms/responses/prints", method: "POST", body: "{" },
  { name: "print-download-missing-token", path: `/api/forms/responses/prints/${fakeId}/pdf` },
  { name: "print-download-invalid-token", path: `/api/forms/responses/prints/${fakeId}/pdf?token=anonymous-denial-probe` },
];
const scope = "Anonymous denial only; not authenticated workflows, valid downloads, Google login, MFA, or cross-branch acceptance";

async function verify() {
  const base = new URL(process.env.CUSTOM_FORMS_ACCESS_BASE_URL ?? "http://127.0.0.1:3184");
  assert.ok(!base.username && !base.password && !base.search && !base.hash && base.pathname === "/");
  assert.ok(base.protocol === "https:" || base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
  const deadline = AbortSignal.timeout(90_000);
  const failures = [];
  const evidence = [];

  async function request(path, options = {}, maxBytes = 64_000) {
    const response = await fetch(new URL(path, base), {
      ...options, credentials: "omit", redirect: "manual", cache: "no-store",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      assert.ok(size <= maxBytes, "Denial response size limit exceeded");
      chunks.push(chunk);
    }
    return { response, text: Buffer.concat(chunks).toString("utf8") };
  }

  for (const path of pages) {
    let status = null;
    try {
      const { response, text } = await request(path, {}, 512_000);
      status = response.status;
      const $ = load(text);
      const location = response.headers.get("location") ?? $("meta#__next-page-redirect").attr("content")?.match(/^\d+;url=(.+)$/)?.[1];
      const target = location ? new URL(location, base) : null;
      assert.ok([200, 302, 303, 307, 308].includes(response.status));
      assert.equal(target?.origin, base.origin);
      assert.equal(target?.pathname, "/login");
      assert.equal(target?.searchParams.get("audience"), "staff");
      assert.equal($(".app-shell,h1").length, 0);
      assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:\s*,|$)/i);
      evidence.push({ name: path, method: "GET", status, result: "PASS" });
    } catch {
      failures.push({ name: path, method: "GET", status, check: "Staff login redirect, no protected content, no-store" });
    }
  }

  for (const { name, path, method = "GET", body } of probes) {
    let status = null;
    try {
      const { response, text } = await request(path, {
        method, ...(body !== undefined ? { headers: { "content-type": "application/json" }, body } : {}),
      });
      status = response.status;
      assert.equal(status, 401);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:;|$)/i);
      const result = JSON.parse(text);
      assert.deepEqual(Object.keys(result).sort(), ["data", "errors", "requestId", "status"]);
      assert.equal(result.status, "error");
      assert.equal(result.data, null);
      assert.match(result.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
      assert.equal(result.errors?.length, 1);
      assert.deepEqual(Object.keys(result.errors[0]).sort(), ["code", "message"]);
      assert.equal(result.errors[0].code, "AUTH_REQUIRED");
      assert.equal(typeof result.errors[0].message, "string");
      const cacheControl = response.headers.get("cache-control") ?? "";
      assert.match(cacheControl, /(?:^|,)\s*private(?:\s*,|$)/i);
      assert.match(cacheControl, /(?:^|,)\s*no-store(?:\s*,|$)/i);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      evidence.push({ name, method, status, result: "PASS" });
    } catch {
      // Never include URL queries, headers, response bodies, assertion values,
      // stack traces, or transport error messages in release evidence.
      failures.push({ name, method, status, check: "401/AUTH_REQUIRED before parsing, null data, safe envelope, private/no-store and nosniff" });
    }
  }
  console.log(JSON.stringify({
    status: failures.length ? "FAIL" : "PASS", origin: base.origin,
    checked: pages.length + probes.length, passed: evidence.length, failures, evidence, scope,
  }));
  if (failures.length) process.exitCode = 1;
}

try {
  await verify();
} catch {
  console.log(JSON.stringify({
    status: "FAIL", checked: 0, passed: 0,
    failures: [{ check: "Base URL must be an HTTPS origin or HTTP loopback origin, without credentials, path, query or fragment" }],
    evidence: [], scope,
  }));
  process.exitCode = 1;
}
