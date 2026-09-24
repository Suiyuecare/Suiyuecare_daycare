import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Read-only browser checks against an explicitly synthetic local server only.
const base = new URL(process.env.ROUTE_SMOKE_BASE_URL ?? "http://127.0.0.1:3107");
if (base.hostname !== "127.0.0.1" || base.protocol !== "http:") throw new Error("Local demo server required");
const session = "daycare-completion-20260922";
const output = await mkdtemp(join(tmpdir(), "daycare-browser-acceptance-"));
function browser(...args) {
  const result = spawnSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) throw new Error(`Browser command failed: ${args[0]} ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function decode(value) { const parsed = JSON.parse(value); return typeof parsed === "string" ? JSON.parse(parsed) : parsed; }
const selection = "?date=2026-09-22&client=a1111111-1111-4111-8111-111111111111";
const routes = [
  ["dashboard", "/app/dashboard"],
  ["attendance", `/app/staff/service-management/attendance${selection}`],
  ["vitals", `/app/staff/daily-care/vital-signs${selection}`],
  ["diary", `/app/staff/daily-care/care-diary${selection}`],
  ["admission", "/app/staff/operations/client-transitions"],
  ["transport", "/app/staff/service-management/transport-plans"],
  ["custom-forms", "/app/client-forms"],
  ["form-governance", "/app/staff/governance/form-rule-versions"],
];
const results = [];
try {
  for (const width of [390, 1440]) {
    browser("set", "viewport", String(width), "1000");
    for (const [name, path] of routes) {
      browser("open", new URL(path, base).href); browser("wait", "--load", "networkidle");
      const result = decode(browser("eval", `JSON.stringify({heading:document.querySelector('h1')?.textContent,content:document.body.innerText.length,synthetic:document.querySelector('.user-summary__text small')?.textContent.includes('展示模式')===true,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,main:document.querySelectorAll('main').length,closedDialogVisible:[...document.querySelectorAll('dialog:not([open])')].some(e=>getComputedStyle(e).display!=='none'),overlay:!!document.querySelector('[data-nextjs-dialog],.vite-error-overlay')})`));
      if (!result.synthetic || !result.heading || result.content < 100 || result.scrollWidth > width || result.main !== 1 || result.closedDialogVisible || result.overlay) throw new Error(`Browser acceptance failed: ${name} ${width} ${JSON.stringify(result)}`);
      browser("screenshot", join(output, `${name}-${width}.png`));
      results.push({ name, path, ...result });
      if (name === "custom-forms") {
        browser("find", "role", "button", "click", "--name", "載入個案表單"); browser("snapshot", "-i");
        browser("find", "role", "button", "click", "--name", "查看／接續處理"); browser("snapshot", "-i");
        const form = decode(browser("eval", `JSON.stringify({print:!!document.querySelector('[aria-label="保存版本列印"]'),disabled:[...document.querySelectorAll('main button')].filter(b=>/儲存填答|本人確認|準備 PDF/.test(b.innerText)).every(b=>b.disabled),font:[...document.querySelectorAll('main input,main select')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16),targets:[...document.querySelectorAll('main button,main input,main select')].every(e=>e.getBoundingClientRect().height>=44),overflow:document.documentElement.scrollWidth>innerWidth})`));
        if (!form.print || !form.disabled || !form.font || !form.targets || form.overflow) throw new Error(`Saved form controls failed: ${JSON.stringify(form)}`);
        browser("eval", `document.querySelector('[aria-label="保存版本列印"]').scrollIntoView({block:'center'})`);
        browser("screenshot", join(output, `custom-form-print-${width}.png`));
        results.push({ name: "custom-form-print-controls", width, ...form });
      }
    }
  }
  const errors = browser("errors");
  if (errors) throw new Error(`Browser runtime errors: ${errors}`);
  await writeFile(join(output, "report.json"), JSON.stringify({ scope: "synthetic local route/layout checks, not authenticated production E2E", results }, null, 2));
  console.log(`Browser acceptance: ${routes.length * 2}/${routes.length * 2} synthetic route/viewport checks and 2 saved-form interaction checks passed. Evidence: ${output}`);
} finally { browser("close"); }
