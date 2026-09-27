#!/usr/bin/env node
// Actual owners + loopback synthetic responses only, never hosted credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const [origin, evidenceDirectory] = process.argv.slice(2), url = new URL(origin);
assert.equal(process.argv.length, 4); assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
assert.ok(url.port); assert.equal(url.pathname, "/"); assert.equal(url.search + url.hash + url.username + url.password, "");
assert.equal(evidenceDirectory, "/Users/seniorlifepr/.codex/verification/daycare-20260926/cms-upload-browser");
const session = "daycare-cms-upload-20260928", results = [], region = '[aria-label="CMS 原檔上傳"]';
const accessibility = [];
function browser(...args) { return execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 35_000, maxBuffer: 5_000_000 }); }
function evaluate(code) { const raw = JSON.parse(browser("eval", `JSON.stringify(${code})`).trim()); return typeof raw === "string" ? JSON.parse(raw) : raw; }
function action(code) { browser("eval", `(()=>{${code}})()`); }
function check(name, code) { assert.equal(evaluate(code), true, name); results.push({ name, passed: true }); }
function click(name) { action(`const b=[...document.querySelectorAll("button")].find(x=>x.textContent===${JSON.stringify(name)}&&!x.disabled);if(!b)throw Error("Missing enabled action");b.click()`); }
function open() { browser("open", url.href); check("meaningful page, no framework overlay", 'document.body.innerText.length>0&&!document.querySelector(".vite-error-overlay,[data-nextjs-dialog]")&&window.fixture.errors.length===0'); }
function select(changed = false) { action(`const input=document.querySelector('input[type=file]'), data=new DataTransfer();data.items.add(new File([${JSON.stringify(changed ? "<html>synthetic changed byte!</html>" : "<html>synthetic original only</html>")}],"synthetic.html",{type:"text/html"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));`); browser("wait", `${region} ${changed ? "[role=alert]" : "[role=status]"}`); }
function lostAck() { select(); click("上傳並核對資料"); browser("wait", '[aria-label="CMS 原檔上傳"] [role=alert]'); }
function screenshot(name) { browser("screenshot", resolve(evidenceDirectory, `${name}.png`)); }
function audit(name) {
  const source = readFileSync(resolve(process.cwd(), "node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js"), "utf8");
  execFileSync("agent-browser", ["--session", session, "eval", "--stdin"], { input: source, encoding: "utf8", timeout: 20_000, maxBuffer: 5_000_000 });
  const raw = JSON.parse(browser("eval", `(async()=>{const r=await axe.run(document.querySelector(${JSON.stringify(region)}),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}});return JSON.stringify({name:${JSON.stringify(name)},violations:r.violations,incomplete:r.incomplete,version:r.testEngine.version})})()`).trim());
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (result.violations.length || result.incomplete.length) console.error(JSON.stringify(result));
  assert.equal(result.violations.length, 0, "Narrow automatic accessibility findings");
  assert.equal(result.incomplete.length, 0, "Narrow accessibility findings need manual review");
  accessibility.push(result);
}
async function verifyMedia() {
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
    check("actual forced colors and reduced motion", 'matchMedia("(forced-colors: active)").matches&&matchMedia("(prefers-reduced-motion: reduce)").matches');
    browser("scrollintoview", region); screenshot("mobile-forced-colors");
    check("forced colors controls retain visible borders", `[...document.querySelector(${JSON.stringify(region)}).querySelectorAll("button,input")].filter(x=>x.getClientRects().length).every(x=>parseFloat(getComputedStyle(x).borderTopWidth)>0)`);
    await cdp("Emulation.setEmulatedMedia", { features: [] }, attached.sessionId);
  } finally { socket.close(); }
}
try {
  browser("set", "viewport", "1440", "1000"); open(); select(); audit("desktop-selected-enabled-primary"); click("上傳並核對資料"); browser("wait", `${region} [role=alert]`); screenshot("desktop-unknown"); audit("desktop-unknown");
  check("one original POST, manual and refresh fenced", 'window.fixture.writes.length===1&&[...document.querySelectorAll("button")].filter(x=>["重新整理","沒有 CMS 檔？手動建檔"].includes(x.textContent)).every(x=>x.disabled)');
  action('window.fixture.remount()');
  check("remount never resends, new file picker empty", 'window.fixture.writes.length===1&&document.querySelector("input[type=file]").files.length===0&&[...document.querySelectorAll("button")].find(x=>x.textContent==="繼續原上傳").disabled');
  select(true); check("changed file rejected, original retained", 'window.fixture.writes.length===1&&document.querySelector("input[type=file]").value===""&&document.body.innerText.includes("檔案與原上傳不同")');
  action('window.fixture.lookup="null"'); click("確認上傳結果");
  check("null is not rollback or automatic replay", 'window.fixture.writes.length===1&&window.fixture.reads.length===1&&document.body.innerText.includes("尚未查到原操作")&&[...document.querySelectorAll("button")].find(x=>x.textContent==="重新整理").disabled');
  action('window.fixture.lookup="completed";window.fixture.previewMode="offline"'); click("確認上傳結果");
  check("completed receipt with failed preview retains guard", 'window.fixture.writes.length===1&&[...document.querySelectorAll("button")].find(x=>x.textContent==="重新載入核對資料")&&!document.body.innerText.includes("合成個案（非真實資料）")');
  action('window.fixture.previewMode="ok"'); click("重新載入核對資料");
  check("preview-only retry, not formal intake", 'window.fixture.writes.length===1&&window.fixture.saved===0&&document.body.innerText.includes("合成個案（非真實資料）")&&document.body.innerText.includes("尚未完成收案")');
  check("lookup header preserves exact original key and no query", 'window.fixture.reads.filter(x=>x.url.endsWith("operations")).every(x=>x.key===window.fixture.writes[0].key&&!x.url.includes("?"))');
  screenshot("desktop-preview");
  audit("desktop-preview");
  browser("set", "viewport", "390", "844");
  check("390px no page horizontal overflow", 'document.documentElement.scrollWidth<=innerWidth');
  check("input and select touch targets and typography", '[...document.querySelectorAll("input:not([type=checkbox]),select")].filter(x=>x.getClientRects().length).every(x=>parseFloat(getComputedStyle(x).fontSize)>=16&&x.getBoundingClientRect().height>=44)');
  browser("scrollintoview", region); screenshot("mobile-preview");
  audit("mobile-preview");
  await verifyMedia();
  action('document.documentElement.style.zoom="2"'); browser("scrollintoview", region);
  check("200 percent CSS reflow without hidden main overflow", 'document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".main-stage").scrollWidth<=document.querySelector(".main-stage").clientWidth');
  screenshot("mobile-200pct"); action('document.documentElement.style.zoom=""');
  browser("focus", 'summary'); browser("press", "Enter");
  check("keyboard disclosure opens without losing focus", 'document.querySelector("details").open&&document.activeElement.tagName==="SUMMARY"');
  browser("press", "Enter");
  action('window.fixture.foreign(true)'); check("scope change hides clinical source", '!document.body.innerText.includes("合成個案（非真實資料）")');
  action('window.fixture.foreign(false)'); check("ABA does not resurrect prior preview", '!document.body.innerText.includes("合成個案（非真實資料）")');
  open(); lostAck(); action('window.fixture.lookup="body-timeout"'); click("確認上傳結果");
  check("body decoding visibly pending", '[...document.querySelectorAll("button")].find(x=>x.textContent==="確認上傳結果").disabled&&window.fixture.writes.length===1');
  browser("wait", "21000");
  check("noncooperative JSON timeout permits only explicit read retry", '[...document.querySelectorAll("button")].find(x=>x.textContent==="確認上傳結果").disabled===false&&window.fixture.writes.length===1&&document.body.innerText.includes("結果尚未確認")');
  screenshot("mobile-timeout"); action('window.fixture.lookup="denied"'); click("確認上傳結果");
  check("403 quarantines picker and original data", 'document.querySelector("input[type=file]").disabled&&!document.body.innerText.includes("合成個案（非真實資料）")&&window.fixture.writes.length===1');
  action('window.fixture.remount()'); check("remount cannot resurrect denied authority", 'document.querySelector("input[type=file]").disabled&&window.fixture.writes.length===1');
  screenshot("mobile-denied");
  check("no stored sensitive content", 'localStorage.length===0&&sessionStorage.length===0');
  audit("mobile-denied");
  check("no application JS errors", 'window.fixture.errors.length===0');
  console.log(JSON.stringify({ syntheticOnly: true, scope: "Actual routine CMS UI, file/WebCrypto and scoped fake HTTP only; not hosted Auth/RLS/WORM, actual formal intake, physical IME, all 89 pages, complete WCAG or deployment proof.", results, accessibility }, null, 2));
} finally { browser("close"); }
