#!/usr/bin/env node
// Browser UI evidence only. Requires the bounded loopback fixture; this script
// cannot accept a hosted origin, production session, arbitrary path or secrets.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const [origin, evidenceDirectory] = process.argv.slice(2);
const url = new URL(origin);
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Only the loopback fixture origin is accepted");
if (!evidenceDirectory?.startsWith("/Users/seniorlifepr/.codex/verification/daycare-20260926/")) throw new Error("Use the known synthetic evidence directory");
const session = "social-work-ui-proof";
function browser(...args) { return execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 20_000 }); }
function inspect(source) {
  const raw = browser("eval", `JSON.stringify(${source})`).trim();
  const outer = JSON.parse(raw); return typeof outer === "string" ? JSON.parse(outer) : outer;
}
function run(source) { browser("eval", `(()=>{${source}})()`); }
function clickText(text, index = 0) { run(`const surface=document.querySelector("dialog[open]")??document;const buttons=[...surface.querySelectorAll("button")].filter(x=>x.textContent===${JSON.stringify(text)}&&!x.disabled&&x.getClientRects().length); if(!buttons[${index}]) throw Error("Missing enabled button");buttons[${index}].click()`); }
function field(key, value, page) {
  const attribute = page === 29 ? "data-social-work-field" : "data-psychosocial-field";
  run(`const input=document.querySelector(${JSON.stringify(`[${attribute}="${key}"]`)});if(!input)throw Error("Missing field");const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))`);
}
function open(page) { const target = new URL(url); target.searchParams.set("page", String(page)); browser("open", target.href); }
function modalOpen(page) { clickText(page === 29 ? "新增服務草稿" : "快速新增評估草稿"); }
function fill(page) {
  if (page === 29) { field("clientId", "29020000-0000-4000-8000-000000000002", page); field("serviceType", "合成會談", page);
    field("serviceContent", "本機合成內容，不是真實個案", page); field("serviceResult", "本機合成結果", page); }
  else { field("reassessmentDueOn", "2026-10-26", page); field("dueBasis", "本機合成期限依據", page); field("assessmentSummary", "本機合成摘要，不是真實個案", page); }
}
const submitText = (page) => page === 29 ? "新增服務草稿" : "保存評估草稿";
const retryText = (page) => page === 29 ? "以相同內容重試" : "重試同一評估操作";
const record = { syntheticOnly: true, scope: "Actual UI/CSS/dialogs and fake loopback HTTP only; not hosted Auth/RLS/persistence, physical IME or deployment evidence.", pages: [] };
try {
  for (const page of [29, 28]) {
    browser("set", "viewport", "1440", "1000"); open(page); modalOpen(page);
    clickText(submitText(page));
    const empty = inspect(`({writes:window.fixture.writes.length,focus:document.activeElement?.getAttribute(${JSON.stringify(page === 29 ? "data-social-work-field" : "data-psychosocial-field")}),invalid:document.querySelectorAll("[aria-invalid=true]").length})`);
    assert.equal(empty.writes, 0); assert.equal(empty.focus, page === 29 ? "clientId" : "reassessmentDueOn"); assert.ok(empty.invalid > 0);
    fill(page);
    // Event-level composition regression; not a physical Chinese keyboard test.
    run('document.querySelector("dialog form").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))');
    clickText(submitText(page)); assert.equal(inspect("window.fixture.writes.length"), 0);
    run('document.querySelector("dialog form").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))');
    browser("screenshot", resolve(evidenceDirectory, `page-${page}-editor-desktop.png`));
    const desktop = inspect('({overflow:document.documentElement.scrollWidth>innerWidth,fields:[...document.querySelectorAll("dialog input,dialog select,dialog textarea")].map(x=>({font:Number.parseFloat(getComputedStyle(x).fontSize),height:x.getBoundingClientRect().height})),modal:document.querySelectorAll("dialog[open]").length})');
    assert.equal(desktop.overflow, false); assert.equal(desktop.modal, 1); assert.ok(desktop.fields.every((value) => value.font >= 16 && value.height >= 44));
    // Native dialog blocks focusable application background controls. Chrome
    // may move focus to browser chrome at the wrap boundary (activeElement is
    // then BODY); that is not evidence of a complete manual keyboard audit.
    const keyboard = [];
    for (let index = 0; index < 12; index++) { browser("press", "Tab"); const value = inspect('({inside:!!document.activeElement?.closest("dialog[open]"),browserBoundary:document.activeElement===document.body})');
      assert.equal(value.inside || value.browserBoundary, true); keyboard.push(value); }
    run('window.fixture.mode="unknown"'); clickText(submitText(page));
    assert.equal(inspect("window.fixture.writes.length"), 1);
    assert.equal(inspect('!!document.querySelector("dialog fieldset[disabled]")'), true);
    run('window.fixture.mode="denied"'); clickText(page === 29 ? "重試同一社工操作" : "重試同一評估操作");
    assert.equal(inspect("window.fixture.writes.length"), 2); run("window.fixture.remount()");
    assert.equal(inspect('[...document.querySelectorAll("button")].find(x=>x.textContent==="重新整理").disabled'), true);
    run('[...document.querySelectorAll("button")].find(x=>x.textContent==="重新整理").click()'); assert.equal(inspect("window.fixture.refreshes"), 0);
    run('window.fixture.mode="success"'); clickText(retryText(page));
    const recovered = inspect('({writes:window.fixture.writes,same:window.fixture.writes.every(x=>x.key===window.fixture.writes[0].key&&x.body===window.fixture.writes[0].body),refreshes:window.fixture.refreshes,text:document.body.innerText})');
    assert.equal(recovered.writes.length, 3); assert.equal(recovered.same, true); assert.equal(recovered.refreshes, 0); assert.match(recovered.text, /清單尚未確認更新/u);
    run("window.fixture.fresh(false)"); assert.match(inspect("document.body.innerText"), /清單尚未確認更新/u);
    run("window.fixture.fresh(true)"); assert.match(inspect("document.body.innerText"), /清單已確認更新/u);
    // Separate fresh document for privacy ABA / late receipt; no claim of
    // full-page reload durability of the module-memory operation journal.
    open(page); modalOpen(page); fill(page); run('window.fixture.mode="deferred"'); clickText(submitText(page));
    assert.equal(inspect("window.fixture.writes.length"), 1);
    run("window.fixture.offpage(true)"); run("window.fixture.foreign(true)"); run("window.fixture.foreign(false)"); run("window.fixture.offpage(false)");
    assert.equal(inspect('document.body.innerText.includes("本機合成內容，不是真實個案")||document.body.innerText.includes("本機合成摘要，不是真實個案")'), false);
    run("window.fixture.resolve()"); assert.doesNotMatch(inspect("document.body.innerText"), /清單已確認更新/u);
    assert.equal(inspect("window.fixture.refreshes"), 0);
    const privacy = inspect('({hidden:!document.querySelector("dialog[open]"),writes:window.fixture.writes.length,refreshes:window.fixture.refreshes})');
    if (page === 29) {
      open(page); modalOpen(page); fill(page); run('window.fixture.mode="unknown"'); clickText(submitText(page));
      run('window.fixture.assignment(false)'); run('window.fixture.assignment(true)'); run('window.fixture.remount()');
      assert.equal(inspect('!!document.querySelector("dialog[open]")'), false);
      assert.equal(inspect('document.body.innerText.includes("本機合成內容，不是真實個案")'), false);
      assert.equal(inspect('window.fixture.writes.length'), 1);
      run('window.fixture.fresh(false)'); run('window.fixture.mode="success"'); clickText(retryText(page));
      assert.equal(inspect('window.fixture.writes.length'), 2);
      assert.equal(inspect('window.fixture.writes[0].key===window.fixture.writes[1].key&&window.fixture.writes[0].body===window.fixture.writes[1].body'), true);
    }
    // Mobile and browser console checks use a fresh, non-pending fixture.
    open(page); browser("set", "viewport", "390", "844"); modalOpen(page); fill(page);
    browser("screenshot", resolve(evidenceDirectory, `page-${page}-editor-mobile.png`));
    const mobile = inspect('({overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth,modal:document.querySelectorAll("dialog[open]").length,fields:[...document.querySelectorAll("dialog input,dialog select,dialog textarea")].map(x=>({font:Number.parseFloat(getComputedStyle(x).fontSize),height:x.getBoundingClientRect().height}))})');
    assert.equal(mobile.overflow, false); assert.equal(mobile.width, 390); assert.equal(mobile.modal, 1); assert.ok(mobile.fields.every((value) => value.font >= 16 && value.height >= 44));
    const errors = browser("errors"); assert.doesNotMatch(errors, /Error:|Uncaught|TypeError|ReferenceError/u);
    record.pages.push({ page, empty, desktop, keyboard, unknown403RemountSameKeyAndBody: recovered.same, receiptAndListSeparated: true, privacy, mobile, browserErrors: errors.trim() });
  }
  console.log(JSON.stringify(record, null, 2));
} finally { browser("close"); }
