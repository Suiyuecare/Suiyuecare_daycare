// Public, unauthenticated denial probes only. No credentials, client data,
// successful writes, OAuth automation, or response-body logging.
import assert from "node:assert/strict";
import { load } from "cheerio";

const base = new URL(process.env.COMPLETION_ACCESS_BASE_URL ?? "http://127.0.0.1:3184");
assert.ok(!base.username && !base.password && !base.search && !base.hash);
assert.ok(base.protocol === "https:" || base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname));
const pages = ["/app/intake-completeness", "/app/staff-qualification-readiness", "/app/store-attendance-month"];
const probes = [
  { path: "/api/intake-completeness" },
  { path: "/api/staff-qualification-readiness" },
  { path: "/api/forms/drafts/00000000-0000-4000-8000-000000000000" },
  // Authorization must occur before input parsing. This is not a valid draft.
  { path: "/api/forms/drafts", method: "POST", body: {} },
];
async function request(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options, credentials: "omit", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    assert.ok(size <= 512_000, "Response exceeds denial-probe size limit");
    chunks.push(chunk);
  }
  return { response, text: Buffer.concat(chunks).toString("utf8") };
}
const failures = [];
for (const path of pages) {
  try {
    const { response, text } = await request(path);
    const $ = load(text);
    const location = response.headers.get("location") ?? $("meta#__next-page-redirect").attr("content")?.match(/^\d+;url=(.+)$/)?.[1];
    const target = location ? new URL(location, base) : null;
    assert.ok([200, 302, 303, 307, 308].includes(response.status));
    assert.equal(target?.origin, base.origin);
    assert.equal(target?.pathname, "/login");
    assert.equal(target?.searchParams.get("audience"), "staff");
    assert.equal($(".app-shell,h1").length, 0);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  } catch { failures.push({ path, check: "Expected staff login redirect, no protected content and no-store" }); }
}
for (const { path, method = "GET", body } of probes) {
  try {
    const { response, text } = await request(path, {
      method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const result = JSON.parse(text);
    assert.equal(response.status, 401);
    assert.equal(result.status, "error");
    assert.equal(result.data, null);
    assert.ok(result.errors?.some((error) => error.code === "AUTH_REQUIRED"));
    assert.match(result.requestId, /^[a-f0-9-]{36}$/i);
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/i);
    assert.equal(result.stack, undefined);
  } catch { failures.push({ path, method, check: "Expected 401/AUTH_REQUIRED, no data, request ID and private/no-store" }); }
}
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", origin: base.origin,
  checked: pages.length + probes.length, failures,
  scope: "Anonymous denial only, not authenticated workflows, Google login or cross-branch acceptance" }));
if (failures.length) process.exitCode = 1;
