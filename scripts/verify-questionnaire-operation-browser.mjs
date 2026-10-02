#!/usr/bin/env node
// Actual Chrome in an owned isolated loopback session, synthetic responses only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const url = new URL(process.argv[2]);
assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
const output = "/Users/seniorlifepr/.codex/verification/daycare-20260926";
const executable = "/Users/seniorlifepr/Library/pnpm/bin/agent-browser";
const session = "daycare-questionnaire-original-ui-20260927";
const settings = await mkdtemp(resolve(tmpdir(), "daycare-questionnaire-browser-config."));
const config = resolve(settings, "config.json"); await writeFile(config, "{}");
const browserEnvironment = { ...process.env };
for (const key of Object.keys(browserEnvironment)) if (key.startsWith("AGENT_BROWSER_")) delete browserEnvironment[key];
const results = [], screenshots = [];
const fixture = "window.fixture";
const editor = "form[data-questionnaire-write]";
const readiness = '[aria-label="已保存評估完成檢查"]';
function browser(...args) {
  return execFileSync(executable, ["--session", session, "--config", config, "--restore-save", "never", "--allowed-domains", "127.0.0.1", ...args],
    { encoding: "utf8", timeout: 35_000, env: browserEnvironment });
}
function evaluate(source) { const result = JSON.parse(browser("eval", `JSON.stringify(${source})`).trim()); return typeof result === "string" ? JSON.parse(result) : result; }
function verify(name, source) {
  assert.equal(evaluate(source), true, name); results.push({ name, passed: true }); console.log(`PASS ${name}`);
}
function screenshot(name) { const path = resolve(output, `questionnaire-ui-recovery-${name}.png`); browser("screenshot", path); screenshots.push(path); }
function snapshot() { browser("snapshot", "-i"); }
function wait(source) { browser("wait", "--fn", source); snapshot(); }
function open(parameters = "") {
  browser("open", `${url.origin}/?${parameters}`); wait(`!!document.querySelector(${JSON.stringify(editor)})`);
  verify("page meaningful without overlay or uncaught errors", `${fixture}.syntheticOnly && document.body.innerText.trim().length>0 &&
    !document.querySelector('.vite-error-overlay,[data-nextjs-dialog]') && ${fixture}.errors.length===0`);
}
function button(name) { return `Array.from(document.querySelectorAll('button')).find(node=>node.textContent.trim()===${JSON.stringify(name)})`; }
function click(name) { browser("find", "role", "button", "click", "--name", name, "--exact"); snapshot(); }
function edit() {
  browser("click", `${editor} input[name="spmsq_01"][value="incorrect"]`);
  browser("fill", `${editor} textarea`, "合成原操作備註（非真實資料）"); snapshot();
}
function original() { return `document.querySelector('${editor} input[name="spmsq_01"][value="incorrect"]').checked &&
  document.querySelector('${editor} textarea').value==='合成原操作備註（非真實資料）'`; }
function unknown() { edit(); click("保存修訂版本"); wait(`!!(${button("確認保存結果")})`); }
const clinicalHidden = `!document.querySelector(${JSON.stringify(editor)}) && !document.querySelector(${JSON.stringify(readiness)}) &&
  !document.querySelector('.main-stage').innerText.includes('合成個案（非真實資料）') && !document.querySelector('.main-stage').innerText.includes('合成原紀錄作者')`;
const report = { syntheticOnly: true, isolatedSession: session, url: url.origin,
  scope: "Actual Chrome/AppShell/editor/journal/shared dialog/global CSS with in-memory synthetic loopback responses only. Not hosted Auth, database persistence, signatures, routing acceptance or a full WCAG audit. CSS200% simulates reflow, not native browser zoom.", results, screenshots };
let failure = null;
try {
  browser("set", "viewport", "1440", "1000"); open(); screenshot("desktop-initial");
  verify("canonical shell remains present", "!!document.querySelector('.topbar') && !!document.querySelector('.sidebar') && document.querySelectorAll('.main-stage').length===1");
  verify("real proper AAL1 saved draft is rendered", "document.body.innerText.includes('修訂草稿 v1') && !!document.querySelector('[aria-label=評估日期]')");
  const shellStyles = evaluate("(()=>{const p=selector=>{const n=document.querySelector(selector),s=getComputedStyle(n);return [s.fontSize,s.borderRadius,s.backgroundColor]};return {header:p('.topbar'),sidebar:p('.sidebar')}})()");
  edit(); browser("eval", `${fixture}.refreshSource()`); snapshot();
  verify("same-owner newer real source preserves dirty original answers without POST", `(${original()}) && ${fixture}.posts.length===0`);
  const trigger = button("新增一次評估"); browser("eval", `${trigger}.focus()`); click("新增一次評估");
  wait("!!document.querySelector('dialog[open]')");
  verify("native modal cancel has initial focus and no window confirm", "document.querySelector('dialog[open]').matches(':modal') && document.activeElement.textContent.trim()==='繼續填寫' && window.fixture.nativeConfirms===0");
  screenshot("desktop-unsaved-dialog"); browser("press", "Tab");
  verify("keyboard focus stays in native dialog", "document.querySelector('dialog[open]').contains(document.activeElement)");
  browser("press", "Escape"); wait("!document.querySelector('dialog[open]')");
  verify("Escape cancel preserves answers and returns trigger focus", `(${original()}) && document.activeElement.textContent.trim()==='新增一次評估' && ${fixture}.posts.length===0`);
  click("新增一次評估"); wait("!!document.querySelector('dialog[open]')");
  const bounds = evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {x:Math.max(1,r.left-12),y:Math.max(1,r.top-12)}})()");
  browser("mouse", "move", String(Math.round(bounds.x)), String(Math.round(bounds.y))); browser("mouse", "down"); browser("mouse", "up");
  wait("!document.querySelector('dialog[open]')"); verify("backdrop cancel preserves original draft", original());
  click("保存修訂版本"); wait(`!!(${button("確認保存結果")})`);
  verify("unknown retains original owner with no automatic replay", `${fixture}.posts.length===1 && ${fixture}.pending() && (${original()})`);
  browser("eval", `${fixture}.remount()`); wait(`!!(${button("確認保存結果")})`);
  verify("remount restores original answers without auto POST", `${fixture}.posts.length===1 && ${fixture}.pending() && (${original()})`);
  click("確認保存結果"); wait("document.body.innerText.includes('尚未查到這次保存')");
  verify("manual not_found one GET holds unknown write lease", `${fixture}.lookups.length===1 && ${fixture}.posts.length===1 && ${fixture}.pending() && !${fixture}.viewPending() && ${button("新增一次評估")}.disabled`);
  click("以相同內容重試"); wait(`${fixture}.posts.length===2 && !!(${button("確認保存結果")})`);
  verify("explicit retry uses byte-identical original body and key", `${fixture}.posts[0].body===${fixture}.posts[1].body && ${fixture}.posts[0].key===${fixture}.posts[1].key && ${fixture}.lookups[0].key===${fixture}.posts[0].key`);
  browser("scrollintoview", editor); screenshot("desktop-unknown-remount");
  verify("unknown did not alter canonical header/sidebar styling", `JSON.stringify((()=>{const p=selector=>{const n=document.querySelector(selector),s=getComputedStyle(n);return [s.fontSize,s.borderRadius,s.backgroundColor]};return {header:p('.topbar'),sidebar:p('.sidebar')}})())===${JSON.stringify(JSON.stringify(shellStyles))}`);
  browser("set", "viewport", "390", "844"); browser("scrollintoview", `${editor} button[type=submit]`);
  verify("390px has no page or nested main overflow", "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.main-stage').scrollWidth<=document.querySelector('.main-stage').clientWidth");
  screenshot("mobile-unknown"); browser("set", "viewport", "390", "560"); browser("scrollintoview", `${editor} button[type=submit]`);
  verify("short mobile retry remains44px and visible", `(()=>{const r=${button("以相同內容重試")}.getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight})()`);
  screenshot("mobile-short"); browser("eval", 'document.documentElement.style.zoom="2"'); browser("scrollintoview", editor);
  report.css200Geometry = evaluate("(()=>{const main=document.querySelector('.main-stage');return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,overflow:Array.from(main.querySelectorAll('*')).filter(n=>n.scrollWidth>n.clientWidth+1).slice(0,15).map(n=>({tag:n.tagName,class:n.className,width:n.clientWidth,scroll:n.scrollWidth}))}})()");
  verify("CSS200 percent reflow has no horizontal or nested overflow", "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.main-stage').scrollWidth<=document.querySelector('.main-stage').clientWidth");
  screenshot("mobile-css200"); browser("eval", 'document.documentElement.style.zoom=""'); browser("set", "viewport", "390", "844");
  const endpoint = browser("get", "cdp-url").trim(); assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//u);
  const socket = new WebSocket(endpoint); let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  async function cdp(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { socket.removeEventListener("message", receive); reject(new Error("Owned CDP deadline")); }, 5000);
      function receive(event) { const packet = JSON.parse(String(event.data)); if (packet.id !== id) return;
        clearTimeout(timer); socket.removeEventListener("message", receive); if (packet.error) reject(new Error("Owned CDP failed")); else done(packet.result); }
      socket.addEventListener("message", receive); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  try {
    const targets = await cdp("Target.getTargets"); const owned = targets.targetInfos.filter(target => target.type === "page" && target.url.startsWith(`${url.origin}/`)); assert.equal(owned.length, 1);
    const attached = await cdp("Target.attachToTarget", { targetId: owned[0].targetId, flatten: true });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }, { name: "prefers-reduced-motion", value: "reduce" }] }, attached.sessionId);
    verify("actual forced colors and reduced motion match", 'matchMedia("(forced-colors: active)").matches&&matchMedia("(prefers-reduced-motion: reduce)").matches');
    browser("scrollintoview", `${editor} button[type=submit]`); screenshot("mobile-forced-colors");
    await cdp("Emulation.setEmulatedMedia", { features: [] }, attached.sessionId);
  } finally { socket.close(); }
  browser("eval", `${fixture}.receiptMode='committed'`); click("確認保存結果"); wait("document.body.innerText.includes('尚未包含原保存版本')");
  verify("committed proof without original history forbids new write", `${fixture}.posts.length===2 && ${button("新增一次評估")}.disabled && !!(${button("重新讀取已保存紀錄")})`);
  screenshot("mobile-history-missing"); browser("eval", `${fixture}.historyMode='present'`); click("重新讀取已保存紀錄");
  wait(`!${button("新增一次評估")}.disabled`);
  verify("exact original history releases new work without another POST", `${fixture}.posts.length===2 && !${fixture}.pending() && document.body.innerText.includes('修訂草稿 v2')`);
  verify("positive original history returns focus to connected records anchor", "document.activeElement.matches('[data-governance-focus-anchor]') && document.activeElement.textContent==='評估紀錄'");
  open("mode=success"); edit(); click("保存修訂版本"); wait("document.body.innerText.includes('尚未包含原保存版本')");
  verify("thin201 success alone keeps exact history guard", `${fixture}.posts.length===1 && ${button("新增一次評估")}.disabled`);
  open("mode=body-timeout"); edit(); click("保存修訂版本");
  wait("document.body.innerText.includes('保存中…')"); const timeoutStarted = Date.now(); screenshot("mobile-json-pending");
  wait(`!!(${button("確認保存結果")})`);
  const elapsed = Date.now() - timeoutStarted; assert.ok(elapsed >= 15_000 && elapsed <= 25_000, "independent20sec hungJSON bounded");
  results.push({ name: "hung POST JSON settles unknown within20sec bound", passed: true, elapsedMs: elapsed });
  verify("timeout retains original write and makes no extra POST", `${fixture}.posts.length===1 && ${fixture}.pending() && (${original()})`); screenshot("mobile-json-timeout");
  open(); unknown(); browser("eval", `${fixture}.receiptMode='denied'`); click("確認保存結果"); wait("document.body.innerText.includes('評估資料需要重新確認')");
  verify("403 hides entire clinical workspace but retains opaque unknown", `(${clinicalHidden}) && ${fixture}.pending() && ${fixture}.posts.length===1`); screenshot("mobile403-hidden");
  open(); unknown(); browser("eval", `${fixture}.authority(true,false)`); wait(`!!(${button("確認保存結果")})`);
  verify("read-only AAL1 still offers original lookup without write rights", `(${original()}) && !!(${button("確認保存結果")}) && !(${button("保存修訂版本")}) && ${fixture}.posts.length===1`);
  click("確認保存結果"); wait("document.body.innerText.includes('尚未查到這次保存')");
  verify("manage withdrawal lookup madeGET not POST", `${fixture}.lookups.length===1&&${fixture}.posts.length===1&&${fixture}.pending()`);
  open(); unknown(); browser("eval", `${fixture}.receiptMode='late'`); click("確認保存結果"); wait(`${fixture}.resolveLate!==null`);
  browser("eval", `${fixture}.authority(false)`); wait("document.body.innerText.includes('評估資料需要重新確認')");
  verify("authority withdrawal immediately hides clinical data", clinicalHidden);
  browser("eval", `${fixture}.resolveLate()`); verify("late original proof cannot revive withdrawn view", `(${clinicalHidden}) && ${fixture}.posts.length===1`);
  open(); unknown(); browser("eval", `${fixture}.receiptMode='late'`); click("確認保存結果"); wait(`${fixture}.resolveLate!==null`);
  browser("find", "role", "button", "click", "--name", "更多功能", "--exact"); snapshot();
  browser("click", '.sidebar button[aria-label="登出"]'); wait("!document.querySelector('.app-shell')");
  browser("eval", `${fixture}.resolveLate()`);
  verify("safe logout before late proof clears journal and never restores clinical DOM", `!${fixture}.pending() && !${fixture}.viewPending() && !document.querySelector(${JSON.stringify(editor)}) &&
    !document.body.innerText.includes('合成個案（非真實資料）') && ${fixture}.nativeConfirms===0 && ${fixture}.posts.length===1`);
  screenshot("mobile-safe-logout"); verify("final synthetic page has no uncaught errors", `${fixture}.errors.length===0`);
} catch (error) {
  failure = error; report.failure = error instanceof Error ? error.message : "Browser verification failed";
  try { screenshot("failure"); } catch { /* Keep original actionable failure. */ }
} finally {
  try { browser("close"); report.browserClosed = true; } catch { report.browserClosed = false; }
  await writeFile(resolve(output, "questionnaire-ui-recovery-browser.json"), JSON.stringify(report, null, 2));
}
if (failure) throw failure;
console.log(JSON.stringify(report, null, 2));
