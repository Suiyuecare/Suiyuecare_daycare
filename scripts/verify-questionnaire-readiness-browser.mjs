#!/usr/bin/env node
// Explicit isolated, synthetic loopback session. No cloud/profile/credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const url = new URL(process.argv[2]);
assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
const output = "/Users/seniorlifepr/.codex/verification/daycare-20260926";
const executable = "/Users/seniorlifepr/Library/pnpm/bin/agent-browser";
const session = "daycare-readiness-20260927";
const region = '[aria-label="已保存評估完成檢查"]';
const results = [];
function browser(...args) { return execFileSync(executable, ["--session", session, ...args], { encoding: "utf8", timeout: 35_000 }); }
function evaluate(source) { const value = JSON.parse(browser("eval", `JSON.stringify(${source})`).trim()); return typeof value === "string" ? JSON.parse(value) : value; }
function verify(name, source) { const result = evaluate(source); assert.equal(result, true, name); results.push({ name, passed: true }); }
function screenshot(name) { browser("screenshot", resolve(output, `questionnaire-readiness-${name}.png`)); }
function open(parameters = "") {
  browser("open", `${url.origin}/?${parameters}`);
  verify("meaningful page without overlay/errors", 'document.body.innerText.trim().length>0 && !document.querySelector(".vite-error-overlay,[data-nextjs-dialog]") && window.fixture.errors.length===0');
}
function check() { browser("click", `${region} button`); }
const text = `document.querySelector(${JSON.stringify(region)})?.innerText ?? ""`;

browser("set", "viewport", "1440", "1000"); open(); check();
verify("exact saved-version trial only; no POST", `(${text}).includes("題目已填齊") && (${text}).includes("非正式分數") && (${text}).includes("尚不可正式簽署") && window.fixture.reads===1 && window.fixture.writes===0`);
verify("technical settings collapsed by default", `!document.querySelector(${JSON.stringify(`${region} details`)})?.open`);
verify("canonical content geometry and input size", `getComputedStyle(document.querySelector(${JSON.stringify(region)})).borderRadius==="10px" && document.querySelector(${JSON.stringify(`${region} button`)}).getBoundingClientRect().height>=44 && parseFloat(getComputedStyle(document.querySelector('[aria-label="評估日期"]')).fontSize)>=16`);
screenshot("desktop-complete");
browser("set", "viewport", "390", "844"); browser("scrollintoview", region);
verify("390px no horizontal overflow", "document.documentElement.scrollWidth<=innerWidth"); screenshot("mobile-after");
browser("focus", `${region} summary`); browser("press", "Enter");
verify("keyboard disclosure opens with focus retained", `document.querySelector(${JSON.stringify(`${region} details`)})?.open && document.activeElement===document.querySelector(${JSON.stringify(`${region} summary`)})`);
screenshot("mobile-keyboard-details"); browser("press", "Enter");
browser("set", "viewport", "390", "560"); browser("scrollintoview", `${region} button`);
verify("short mobile action remains visible and 44px", `(()=>{const r=document.querySelector(${JSON.stringify(`${region} button`)}).getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight})()`); screenshot("mobile-short");
browser("eval", 'document.documentElement.style.zoom="2"'); browser("scrollintoview", region);
verify("CSS 200 percent reflow no nested overflow", "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.main-stage').scrollWidth<=document.querySelector('.main-stage').clientWidth"); screenshot("mobile-css-200pct"); browser("eval", 'document.documentElement.style.zoom=""');
browser("set", "viewport", "390", "844");

// CDP is scoped to this session's freshly launched browser and exact loopback
// page. It is not the user's Chrome profile or a production login session.
const endpoint = browser("get", "cdp-url").trim();
assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//u);
const socket = new WebSocket(endpoint); let sequence = 0;
await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
async function cdp(method, params = {}, sessionId) {
  const id = ++sequence;
  return await new Promise((done, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener("message", receive); reject(new Error("Scoped CDP timeout")); }, 5000);
    function receive(event) { const packet = JSON.parse(String(event.data)); if (packet.id !== id) return;
      clearTimeout(timeout); socket.removeEventListener("message", receive); if (packet.error) reject(new Error("Scoped CDP failed")); else done(packet.result); }
    socket.addEventListener("message", receive); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  const targets = await cdp("Target.getTargets");
  const owned = targets.targetInfos.filter(target => target.type === "page" && target.url.startsWith(`${url.origin}/`)); assert.equal(owned.length, 1);
  const attached = await cdp("Target.attachToTarget", { targetId: owned[0].targetId, flatten: true });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }, { name: "prefers-reduced-motion", value: "reduce" }] }, attached.sessionId);
  verify("actual forced colors and reduced motion", 'matchMedia("(forced-colors: active)").matches && matchMedia("(prefers-reduced-motion: reduce)").matches');
  browser("scrollintoview", region);
  screenshot("mobile-forced-colors");
  await cdp("Emulation.setEmulatedMedia", { features: [] }, attached.sessionId);
} finally { socket.close(); }

open("answers=missing"); check();
verify("missing answer is not a zero score or completion", `!(${text}).includes("題目已填齊") && (${text}).includes("未填") && !(${text}).includes("候選試算：0 分")`);
browser("scrollintoview", region); screenshot("mobile-missing");
open("mode=superseded"); check();
verify("superseded version not passed as current", `(${text}).includes("已有較新版本") && window.fixture.writes===0`);
browser("scrollintoview", region); screenshot("mobile-superseded");
open("form=bsrs5&answers=risk"); check();
verify("critical alert visible, no automatic handling", '([...document.querySelectorAll("[role=alert]")].filter(n=>n.innerText.includes("安全")||n.innerText.includes("即時關懷"))).length>=2 && window.fixture.writes===0');
browser("scrollintoview", region); screenshot("mobile-bsrs-risk");
open("mode=offline"); check();
verify("transport error preserves authorized editor", `(${text}).includes("暫時無法檢查") && !!document.querySelector('[aria-label="評估日期"]') && window.fixture.writes===0`);
browser("scrollintoview", region); screenshot("mobile-offline");
browser("eval", 'window.fixture.mode="complete"'); check();
verify("explicit retry only one additional GET", `(${text}).includes("題目已填齊") && window.fixture.reads===2 && window.fixture.writes===0`);
open("mode=body-timeout"); check();
verify("body decoding is visibly pending", `document.querySelector(${JSON.stringify(`${region} button`)}).disabled && (${text}).includes("正在檢查")`);
browser("scrollintoview", region); screenshot("mobile-loading");
browser("wait", "21000");
verify("hung JSON has bounded retry and no POST", `!document.querySelector(${JSON.stringify(`${region} button`)}).disabled && (${text}).includes("暫時無法檢查") && window.fixture.writes===0`); screenshot("mobile-timeout");
open("mode=denied"); check();
verify("denial hides entire clinical editor", `!document.querySelector(${JSON.stringify(region)}) && !document.querySelector('[aria-label="評估日期"]') && !document.querySelector(".main-stage").innerText.includes("合成個案（非真實資料）") && window.fixture.writes===0`);
screenshot("mobile-denied");
console.log(JSON.stringify({ syntheticOnly: true, isolatedSession: session, url: url.origin,
  scope: "Actual browser UI and in-memory synthetic responses only; not hosted Auth, persistence, signatures or complete manual WCAG. CSS 200% is reflow simulation, not browser zoom.", results }, null, 2));
