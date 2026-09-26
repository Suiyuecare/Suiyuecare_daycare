#!/usr/bin/env node
// Local synthetic UI only; never reads .env, saves browser state or calls cloud.
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsToParse = process.argv.slice(2);
if (argumentsToParse.length > 1 || argumentsToParse.length === 1 && !["--body", "--questionnaire", "--announcements", "--announcements-before", "--announcements-write", "--announcements-write-before", "--announcements-receipt-before"].includes(argumentsToParse[0])) {
  throw new Error("Only a named synthetic fixture is accepted.");
}
const bodyFixture = argumentsToParse[0] === "--body";
const questionnaireFixture = argumentsToParse[0] === "--questionnaire";
const announcementFixture = argumentsToParse[0]?.startsWith("--announcements");
const baselineAnnouncement = argumentsToParse[0] === "--announcements-before";
const baselineReceipt = argumentsToParse[0] === "--announcements-receipt-before";
const announcementWrite = argumentsToParse[0]?.startsWith("--announcements-write") || baselineReceipt;
const baselineWrite = argumentsToParse[0] === "--announcements-write-before";
const route = bodyFixture ? "/app/staff/assessments/physical" : questionnaireFixture ? "/app/staff/assessments/barthel-adl" : announcementFixture ? "/app/staff/operations/announcements" : "/app/staff/service-management/claims";
const require = createRequire(import.meta.url);
const vitePath = require.resolve("vite", { paths: [dirname(require.resolve("vitest/package.json"))] });
const tailwindPath = require.resolve("@tailwindcss/postcss");
const postcssPath = require.resolve("postcss", { paths: [dirname(tailwindPath)] });
const { build } = await import(pathToFileURL(vitePath).href);
const { default: postcss } = await import(pathToFileURL(postcssPath).href);
const { default: tailwind } = await import(pathToFileURL(tailwindPath).href);
const runtime = await mkdtemp(resolve(tmpdir(), "daycare-claim-ui-synthetic."));
const stubs = {
  name: "isolated-synthetic-next-stubs", enforce: "pre",
  resolveId(id, importer) {
    if (baselineWrite && id === "./staff-announcement-actions" && importer?.endsWith("staff-announcements-workspace.tsx")) return resolve(repo, "src/components/staff-announcements/staff-announcement-actions.tsx");
    if (["next/navigation", "next/link", "next/image"].includes(id)) return `\0fixture:${id}`;
    return null;
  },
  load(id) {
    if (baselineReceipt && ["src/components/staff-announcements/staff-announcement-controller.tsx", "src/lib/staff-announcements/pending.ts"].some((name) => id === resolve(repo, name))) return execFileSync("git", ["show", `d3df299:${id.slice(repo.length + 1)}`], { cwd: repo, encoding: "utf8" });
    if (baselineWrite && ["staff-announcement-actions.tsx", "staff-announcements-workspace.tsx", "staff-announcements.module.css"].some((name) => id === resolve(repo, `src/components/staff-announcements/${name}`))) return execFileSync("git", ["show", `03ecf2d:${id.slice(repo.length + 1)}`], { cwd: repo, encoding: "utf8" });
    if (baselineAnnouncement && id === resolve(repo, "src/components/staff-announcements/staff-announcements-workspace.tsx")) return execFileSync("git", ["show", "3738dfe:src/components/staff-announcements/staff-announcements-workspace.tsx"], { cwd: repo, encoding: "utf8" });
    if (id === "\0fixture:next/navigation") return `const router={refresh(){window.fixture.refreshes++},replace(){},push(){}}; export function useRouter(){return router} export function usePathname(){return ${JSON.stringify(route)}}`;
    if (id === "\0fixture:next/link") return 'import {createElement} from "react"; export function useLinkStatus(){return {pending:false}} export default function Link({href,children,prefetch,...props}){return createElement("a",{...props,href},children)}';
    if (id === "\0fixture:next/image") return 'import {createElement} from "react"; export default function Image({priority,unoptimized,...props}){return createElement("img",props)}';
    return null;
  },
};
await build({ root: repo, configFile: false, envFile: false, logLevel: "error", plugins: [stubs],
  resolve: { alias: { "@": resolve(repo, "src") } },
  define: { "process.env": "{}", "process.env.NODE_ENV": JSON.stringify("production") }, build: { outDir: runtime, emptyOutDir: false, minify: false,
    target: "es2022", lib: { entry: resolve(repo, bodyFixture ? "scripts/fixtures/body-assessment-ui.tsx" : questionnaireFixture ? "scripts/fixtures/questionnaire-state-ui.tsx" : announcementWrite ? "scripts/fixtures/announcement-operation-ui.tsx" : announcementFixture ? "scripts/fixtures/announcement-page-ui.tsx" : "scripts/fixtures/claim-validation-ui.tsx"),
      name: "SyntheticClaims", formats: ["iife"], fileName: () => "fixture.js" } } });
const css = await postcss([tailwind({ base: repo })]).process(await readFile(resolve(repo, "src/app/globals.css"), "utf8"),
  { from: resolve(repo, "src/app/globals.css") });
await writeFile(resolve(runtime, "global.css"), css.css);
const files = { "/fixture.js": [resolve(runtime, "fixture.js"), "text/javascript"],
  "/global.css": [resolve(runtime, "global.css"), "text/css"],
  "/daycare-management-system.css": [resolve(runtime, "daycare-management-system.css"), "text/css"],
  "/icon.png": [resolve(repo, "public/icon.png"), "image/png"] };
files["/suiyue-logo-transparent.png"] = [resolve(repo, "public/suiyue-logo-transparent.png"), "image/png"];
const bundled = (await import("node:fs/promises")).readdir;
const cssFiles = (await bundled(runtime)).filter((name) => name.endsWith(".css") && name !== "global.css");
for (const name of cssFiles) files[`/${name}`] = [resolve(runtime, name), "text/css"];
const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LOCAL SYNTHETIC · ${bodyFixture ? "身體評估安全重試" : questionnaireFixture ? "量表答案狀態" : announcementFixture ? "公告分頁" : "申報安全重試"}</title><link rel="stylesheet" href="/global.css">${cssFiles.map((name) => `<link rel="stylesheet" href="/${name}">`).join("")}</head><body><div id="fixture-root"></div><script src="/fixture.js" defer></script></body></html>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  response.setHeader("Cache-Control", "private, no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
  if (path === "/" || announcementFixture && path === route) { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
  const asset = files[path];
  if (asset) { try { response.setHeader("Content-Type", asset[1]); response.end(await readFile(asset[0])); return; } catch { /* missing local asset */ } }
  response.writeHead(404); response.end("Synthetic fixture route not found");
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
console.log(JSON.stringify({ syntheticOnly: true, url: `http://127.0.0.1:${server.address().port}/`, runtime,
  scope: announcementWrite ? "Actual AppShell/announcement actions/shared confirmation/CSS; bounded in-memory fake requests, not Auth/RLS/production DB proof." : announcementFixture ? "Actual AppShell/announcement workspace/CSS; synthetic fixed paging dataset, not real Auth/DB/write evidence." : questionnaireFixture
    ? "Actual AppShell/questionnaire editor/CSS, fixed synthetic N/A draft and fetch/router; not real Auth, persistence, scoring activation or SQL evidence."
    : "Actual AppShell/composer/shared modal/CSS, synthetic fetch/router; not real Auth, routing or SQL evidence." }));
function stop() { server.close(); server.closeAllConnections(); process.exitCode = 0; }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
