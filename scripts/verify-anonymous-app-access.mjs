// Read-only anonymous checks. Never send credentials, follow redirects, or log
// response bodies. This does not replace authenticated role/MFA/RLS tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "cheerio";

const base = new URL(process.env.ACCESS_SMOKE_BASE_URL ?? "http://127.0.0.1:3126");
assert.ok(!base.username && !base.password && !base.search && !base.hash,
  "Use a base URL without credentials, query parameters or fragments");
assert.ok(base.protocol === "https:" ||
  (base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)),
"HTTP is permitted only for a local test server");

const matrix = await readFile(resolve(import.meta.dirname, "../docs/R0_PAGE_ACCEPTANCE_MATRIX.md"), "utf8");
const pages = matrix.split("\n").flatMap((line) => {
  const cells = line.split("|").map((cell) => cell.trim());
  if (!/^\d+$/u.test(cells[1] ?? "") || !/^(staff|family)\//u.test(cells[2] ?? "")) return [];
  const family = cells[2].startsWith("family/");
  return [{ path: family ? `/${cells[2]}` : `/app/${cells[2]}`, audience: family ? "family" : "staff" }];
});
assert.equal(pages.length, 89, "Expected 89 catalog routes");
assert.equal(new Set(pages.map((page) => page.path)).size, 89, "Catalog paths must be unique");

async function request(path) {
  const response = await fetch(new URL(path, base), {
    method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  // Next.js streaming redirects use an HTTP 200 response with a redirect meta
  // element. Parse statically in memory only; never execute or persist the HTML.
  let bytes = 0;
  const chunks = [];
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 512_000) throw new Error("Response exceeds smoke-check size limit");
      chunks.push(chunk);
    }
  }
  const $ = load(Buffer.concat(chunks).toString("utf8"));
  const refresh = $('meta#__next-page-redirect[http-equiv="refresh"]');
  const metaTarget = refresh.length === 1
    ? refresh.attr("content")?.match(/^\d+;url=(.+)$/u)?.[1] : null;
  const protectedContent = $(".app-shell, .family-shell, .family-main, h1").length > 0;
  return { response, metaTarget, protectedContent };
}

const failures = [];
const { response: login } = await request("/login");
if (login.status !== 200) failures.push({ path: "/login", check: "normal login page must be reachable", status: login.status });
if (login.headers.get("x-daycare-mode") === "synthetic-read-only") {
  failures.push({ path: "/login", check: "synthetic preview is not a normal authenticated deployment" });
}

for (let index = 0; index < pages.length; index += 4) {
  await Promise.all(pages.slice(index, index + 4).map(async ({ path, audience }) => {
    try {
      const { response, metaTarget, protectedContent } = await request(path);
      const httpRedirect = [302, 303, 307, 308].includes(response.status);
      const streamingRedirect = response.status === 200 && Boolean(metaTarget) && !protectedContent;
      const location = httpRedirect ? response.headers.get("location") : metaTarget;
      const destination = location ? new URL(location, base) : null;
      if (!(httpRedirect || streamingRedirect) ||
          destination?.origin !== base.origin || destination?.pathname !== "/login" ||
          destination?.searchParams.get("audience") !== audience) {
        failures.push({ path, check: "anonymous request must redirect to its login audience", status: response.status });
      }
      if (!/\bno-store\b/iu.test(response.headers.get("cache-control") ?? "")) {
        failures.push({ path, check: "protected route must not be cached" });
      }
    } catch {
      failures.push({ path, check: "request failed; sensitive error details suppressed" });
    }
  }));
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    status: "PASS", origin: base.origin, anonymousPagesDenied: pages.length,
    scope: "Anonymous GET HTTP/streaming redirects and no-store only; no authenticated MFA or cross-tenant E2E claim",
  }) + "\n");
}
