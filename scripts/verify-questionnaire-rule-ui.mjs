#!/usr/bin/env node
// Bounded local UI fixture. Never loads .env, cloud SDKs, credentials, or PHI.
// Existing Vite/Rolldown replaces esbuild because this lockfile has Vite 8.
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vitestRoot = dirname(require.resolve("vitest/package.json"));
const vitePath = require.resolve("vite", { paths: [vitestRoot] });
const tailwindPath = require.resolve("@tailwindcss/postcss");
const postcssPath = require.resolve("postcss", { paths: [dirname(tailwindPath)] });
const { build } = await import(pathToFileURL(vitePath).href);
const { default: postcss } = await import(pathToFileURL(postcssPath).href);
const { default: tailwind } = await import(pathToFileURL(tailwindPath).href);
const runtime = await mkdtemp(resolve(tmpdir(), "daycare-rule-ui-synthetic."));
const evidencePath = resolve(runtime, "http-evidence.json");
const sourceAlias = { "@": resolve(repo, "src") };
function fixtureStubs(server) {
  return { name: "synthetic-fixture-only-stubs", enforce: "pre",
    resolveId(id) {
      if (server && id === "server-only") return "\0fixture-server-only";
      if (!server && id === "next/link") return "\0fixture-next-link";
      return null;
    },
    load(id) {
      if (id === "\0fixture-server-only") return "export {};";
      if (id === "\0fixture-next-link") return 'import {createElement} from "react"; export default function FixtureLink({href,children,...props}) { return createElement("a",{...props,href},children); }';
      return null;
    },
  };
}
const common = { root: repo, configFile: false, envFile: false, logLevel: "error",
  resolve: { alias: sourceAlias }, define: { "process.env.NODE_ENV": JSON.stringify("production") } };
await build({ ...common, plugins: [fixtureStubs(false)], build: { outDir: runtime,
  emptyOutDir: false, sourcemap: true, minify: false, target: "es2022",
  lib: { entry: resolve(repo, "scripts/fixtures/questionnaire-rule-ui.tsx"), name: "SyntheticQuestionnaireRuleUi",
    formats: ["iife"], fileName: () => "fixture-ui.js" } } });
await build({ ...common, plugins: [fixtureStubs(true)], ssr: { noExternal: true },
  build: { ssr: resolve(repo, "scripts/fixtures/questionnaire-rule-ui-data.ts"), outDir: runtime,
    emptyOutDir: false, minify: false, target: "es2022",
    rollupOptions: { output: { entryFileNames: "fixture-data.mjs" } } } });
const cssSource = await readFile(resolve(repo, "src/app/globals.css"), "utf8");
const css = await postcss([tailwind({ base: repo })]).process(cssSource,
  { from: resolve(repo, "src/app/globals.css"), to: resolve(runtime, "fixture.css") });
await writeFile(resolve(runtime, "fixture.css"), css.css);
const { createSyntheticRuleFixture, verifySyntheticRuleFixtureContracts } = await import(pathToFileURL(resolve(runtime, "fixture-data.mjs")).href);
if (process.argv.includes("--self-test")) {
  console.log(JSON.stringify({ syntheticOnly: true, ...verifySyntheticRuleFixtureContracts(), runtime }));
  process.exit(0);
}
let fixture = createSyntheticRuleFixture(null, null);
const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LOCAL SYNTHETIC · 規則審核 UI</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture-root"></div><script src="/fixture-ui.js" defer></script></body></html>';
async function evidence() { await writeFile(evidencePath, JSON.stringify(fixture.evidence(), null, 2)); }
function sendJson(response, result) {
  if (response.destroyed) return;
  response.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(result.body));
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const routes = { "/api/questionnaire-rule-reviews": "review", "/api/questionnaire-rule-retirements": "retirement" };
    const kind = routes[url.pathname];
    if (kind && request.method === "GET") { const result = fixture.read(kind, url); await evidence(); return sendJson(response, result); }
    if (kind && request.method === "POST") {
      if (!/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"] ?? "")) throw new Error("JSON fixture only");
      let body = "";
      for await (const chunk of request) { body += chunk.toString("utf8"); if (Buffer.byteLength(body) > 8192) throw new Error("Fixture input too large"); }
      const result = fixture.write(kind, JSON.parse(body), request.headers["idempotency-key"]);
      await evidence();
      if (result.delayMs) return setTimeout(() => sendJson(response, result), result.delayMs);
      return sendJson(response, result);
    }
    if (url.pathname === "/__fixture/evidence" && request.method === "GET") {
      await evidence(); return sendJson(response, { status: 200, body: fixture.evidence() });
    }
    if (url.pathname === "/" && request.method === "GET") {
      fixture = createSyntheticRuleFixture(url.searchParams.get("mode"), url.searchParams.get("seed")); await evidence();
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return response.end(html);
    }
    const assets = { "/fixture-ui.js": ["fixture-ui.js", "text/javascript"], "/fixture.css": ["fixture.css", "text/css"] };
    const asset = assets[url.pathname];
    if (asset && request.method === "GET") {
      response.writeHead(200, { "Content-Type": `${asset[1]}; charset=utf-8`, "Cache-Control": "no-store" });
      return response.end(await readFile(resolve(runtime, asset[0])));
    }
    response.writeHead(404, { "Content-Type": "text/plain" }); response.end("Local fixture route not found; Next routing is not exercised.");
  } catch {
    // Intentionally sanitized: never print a raw body or unexpected exception.
    sendJson(response, { status: 400, body: { requestId: "a0000000-0000-4000-8000-999999999999",
      status: "error", data: null, errors: [{ code: "FIXTURE_INVALID_INPUT", message: "Invalid synthetic fixture request." }] } });
  }
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
const address = server.address();
console.log(JSON.stringify({ syntheticOnly: true, url: `http://127.0.0.1:${address.port}/`,
  runtime, evidencePath, availableModes: ["normal", "lost-ack", "invalid-receipt", "read-fail", "timeout"],
  availableSeeds: ["empty", "self", "other", "approved"],
  scope: "Actual React UI + browser adapter + canonical CSS; fake HTTP API, not hosted Auth/RLS/SQL/routing proof." }));
function stop() { server.close(); server.closeAllConnections(); process.exitCode = 0; }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
