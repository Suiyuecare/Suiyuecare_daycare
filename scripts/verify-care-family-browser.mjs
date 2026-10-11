import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const demo = new URL(process.env.ROUTE_SMOKE_BASE_URL ?? "http://127.0.0.1:3114");
const fixture = new URL("http://127.0.0.1:3115/completion-fixture.html");
if (demo.hostname !== "127.0.0.1" || demo.protocol !== "http:") throw new Error("Only the isolated local synthetic server is accepted");
const evidenceRoot = resolve("private/browser-acceptance");
await mkdir(evidenceRoot, { recursive: true });
const output = await mkdtemp(join(evidenceRoot, "care-family-"));
const session = "daycare-care-family-completion-qa";
function browser(...args) {
  const result = spawnSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Browser ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function evaluate(script) { const value = JSON.parse(browser("eval", "-b", Buffer.from(`JSON.stringify(${script})`).toString("base64"))); return typeof value === "string" ? JSON.parse(value) : value; }
function evaluateAsync(script) { const value = JSON.parse(browser("eval", "-b", Buffer.from(`(async () => {const value=await (${script});return JSON.stringify(value===undefined?null:value);})()`).toString("base64"))); return typeof value === "string" ? JSON.parse(value) : value; }
function check(condition, message) { if (!condition) throw new Error(message); }
function open(url) { browser("open", url); browser("wait", "--load", "networkidle"); }
function action(role, verb, name, ...extra) {
  if (verb === "fill") return browser("find", "label", name, "fill", ...extra, "--exact");
  if (verb === "select") {
    const id = evaluate(`[...document.querySelectorAll('label')].find(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()===${JSON.stringify(name)})?.htmlFor`);
    check(Boolean(id), `Select label not found: ${name}`);
    return browser("select", `[id=${JSON.stringify(id)}]`, ...extra);
  }
  return browser("find", "role", role, verb, "--name", name, "--exact", ...extra);
}
// Chromium can report a 44px control as 43.99997px after a transform.
const metrics = `({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, mains:document.querySelectorAll('main').length, headings:[...document.querySelectorAll('main h1')].map(e=>e.textContent.trim()), overlay:!!document.querySelector('[data-nextjs-dialog],.vite-error-overlay'), dialogs:[...document.querySelectorAll('dialog:not([open])')].some(e=>getComputedStyle(e).display!=='none'), inputFonts:[...document.querySelectorAll('section input:not([type=checkbox]),section select,section textarea')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height>0).map(e=>parseFloat(getComputedStyle(e).fontSize)), smallTargets:[...document.querySelectorAll('section button,section summary')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height>0&&e.getBoundingClientRect().height<43.9).map(e=>({text:e.textContent.trim(),height:e.getBoundingClientRect().height})) })`;
const routes = [
  ["case-center", "/app/staff/workspace/case-center"], ["family-43", "/app/staff/communication/care-communication"],
  ["family-home", "/family/home"], ...["communication", "care-summary", "schedule", "billing-documents", "notifications-settings"].map(path => [`family-${path}`, `/family/${path}`]),
  ["vitals", "/app/staff/daily-care/vital-signs"], ["diary", "/app/staff/daily-care/care-diary"], ["body", "/app/staff/assessments/physical"],
];
const results = [];
try {
  for (const width of [390, 1440]) {
    const resumeNewFeatures = process.env.BROWSER_QA_RESUME === "390-new-features" && width === 390;
    browser("set", "viewport", String(width), "844");
    for (const [name, path] of resumeNewFeatures ? [] : routes) {
      open(new URL(path, demo).href);
      const result = evaluate(metrics);
      check(result.scrollWidth <= width && result.mains === 1 && result.headings.length === 1 && !result.overlay && !result.dialogs, `${name} ${width} layout failed: ${JSON.stringify(result)}`);
      browser("screenshot", join(output, `${name}-${width}.png`));
      results.push({ scope: "synthetic demo route", name, ...result });
    }
    open(new URL("/app/staff/workspace/case-center", demo).href);
    if (width === 390 && !resumeNewFeatures) {
      for (const selector of [".topbar .mobile-menu-button", ".mobile-primary-nav button"]) {
        browser("eval", `document.querySelector(${JSON.stringify(selector)}).focus()`); browser("press", "Enter");
        check(evaluate(`!!document.querySelector('.sidebar[role=dialog][aria-modal=true]') && document.querySelector('.app-main').inert && document.querySelector('.mobile-primary-nav').inert`), "Mobile menu did not isolate background");
        browser("press", "Escape");
        check(evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)}) && !document.querySelector('.app-main').inert && !document.querySelector('.sidebar[role=dialog]')`), `Escape failed exact opener focus: ${selector}`);
        results.push({ name: "mobile-menu-escape-focus", width, selector, backgroundIsolated: true, exactOpenerRestored: true });
      }
    } else if (width !== 390) {
      check(evaluate(`!document.querySelector('.sidebar').inert && !document.querySelector('.sidebar[role=dialog]') && !!document.querySelector('.sidebar a[aria-current=page]')`), "Desktop navigation current state missing");
      results.push({ name: "desktop-navigation-current-state", width, modal: false, currentPageMarked: true });
    }
    // These separately mount the actual live components with all network calls
    // intercepted, because production guards correctly exclude them in demo.
    for (const view of resumeNewFeatures ? [] : ["43", "85", "86", "87", "88", "89", "attachments", "caregiver"]) {
      open(`${fixture.href}?view=${view}`);
      const result = evaluate(metrics);
      check(result.scrollWidth <= width && result.mains === 1 && result.headings.length === 1 && !result.overlay && result.inputFonts.every(size => size >= 16) && result.smallTargets.length === 0, `fixture ${view} ${width} controls failed: ${JSON.stringify(result)}`);
      browser("screenshot", join(output, `live-component-${view}-${width}.png`));
      results.push({ scope: "synthetic mocked component only", name: view, ...result });
    }
    if (!resumeNewFeatures) {
    open(`${fixture.href}?view=85`);
    browser("select", "#fixture-scenario", "retry-once");
    action("textbox", "fill", "給機構的訊息", "合成重試訊息"); action("button", "click", "送出");
    browser("wait", "--text", "結果尚未確認");
    check(evaluate(`({frozen:document.querySelector('textarea').disabled,refresh:[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='更新').disabled})`).frozen, "Family message was editable while unresolved");
    action("button", "click", "重試原操作"); browser("wait", "--text", "訊息已送出");
    const retry = evaluate(`window.completionRequests.filter(r=>r.method==='POST')`);
    check(retry.length === 2 && retry[0].body === retry[1].body, "Family retry changed idempotency key or payload");
    browser("select", "#fixture-scenario", "revoked"); action("button", "click", "更新"); browser("wait", "--text", "此個案目前沒有有效授權，已隱藏資料。");
    check(!evaluate(`document.body.innerText.includes('今天參與音樂活動')`), "Revoked family data stayed visible");
    results.push({ name: "family-retry-and-revoke", width, samePayload: true, revokedDataHidden: true });
    }

    open(`${fixture.href}?view=85`); browser("click", "details summary"); browser("wait", "--text", "合成待檢照片");
    const familyAttachment = evaluate(`({requests:window.completionRequests.filter(r=>r.url.startsWith('/api/clinical-attachments')),download:[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='查看'),layout:${metrics}})`);
    check(familyAttachment.requests.length === 1 && familyAttachment.requests[0].url.includes("audience=family") && familyAttachment.requests[0].url.includes("kind=family_message") && !familyAttachment.download && familyAttachment.layout.smallTargets.length === 0, "Family attachment source binding or unscanned UI failed");
    results.push({ name: "family-message-private-pending-attachment", width, exactFamilySource: true, unscannedCannotDownload: true });

    open(`${fixture.href}?view=87`); browser("wait", "--text", "合成到站接送");
    check(evaluate(`document.body.innerText.includes('已上車')`), "Authorized schedule state missing");
    action("button", "click", "月曆");
    const calendar = evaluate(metrics);
    check(calendar.scrollWidth <= width && calendar.smallTargets.length === 0 && evaluate(`document.body.innerText.includes('合成到站接送') && document.body.innerText.includes('已上車')`), "Calendar differs from list or overflows");
    browser("screenshot", join(output, `family-monthly-calendar-${width}.png`));
    action("button", "click", "列表");
    results.push({ name: "family-monthly-list-calendar-same-source", width, status: "boarded", sameItem: true, overflow: false });

    open(`${fixture.href}?view=offline`); evaluateAsync(`window.completionOffline.clear()`);
    action("textbox", "fill", "給機構的訊息", "合成裝置草稿：保留原版本"); action("button", "click", "保存草稿"); browser("wait", "--text", "草稿已保存");
    const stored = evaluateAsync(`window.completionOffline.load()`);
    check(stored.length === 1 && stored[0].kind === "family-message" && stored[0].baseVersion === 1 && Date.parse(stored[0].expiresAt) - Date.parse(stored[0].createdAt) === 86400000, "Stored synthetic draft lost its baseline or TTL");
    const encrypted = evaluateAsync(`new Promise((resolve,reject)=>{const request=indexedDB.open('daycare-offline-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const read=db.transaction('drafts').objectStore('drafts').getAll();read.onerror=()=>reject(read.error);read.onsuccess=()=>{resolve(read.result.map(row=>({ciphertextBytes:row.ciphertext.byteLength,hasPlaintext:'payload' in row||'clientRef' in row,containsBody:JSON.stringify(row).includes('合成裝置草稿')})));db.close();};};})`);
    check(encrypted.length === 1 && encrypted[0].ciphertextBytes > 0 && !encrypted[0].hasPlaintext && !encrypted[0].containsBody, "IndexedDB exposed plaintext message/client fields");
    open(`${fixture.href}?view=offline`); browser("wait", "--text", "合成裝置草稿：保留原版本");
    action("button", "click", "接續填寫"); check(evaluate(`document.querySelector('textarea').value==='合成裝置草稿：保留原版本'`), "Draft did not survive full browser reload");
    evaluateAsync(`window.completionOffline.clear()`); check(evaluate(`document.querySelector('textarea').value==='' && !document.body.innerText.includes('合成裝置草稿：保留原版本')`), "Logout clear did not purge visible draft");
    browser("eval", "window.syntheticOnline=false;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.syntheticOnline})");
    action("textbox", "fill", "給機構的訊息", "合成離線待同步"); action("button", "click", "送出"); browser("wait", "--text", "已排入待傳送");
    const queued = evaluateAsync(`window.completionOffline.load()`); check(queued.length === 1 && queued[0].payload.state === "queued", "Offline message was not frozen in queue");
    browser("eval", "window.syntheticOnline=true;window.dispatchEvent(new Event('online'))"); browser("wait", "--text", "訊息已送出");
    check(evaluateAsync(`window.completionOffline.load()`).length === 0, "Confirmed original command did not clear its encrypted device draft");
    const offlineRequest = evaluate(`window.completionRequests.filter(r=>r.method==='POST')`);
    check(offlineRequest.length === 1 && offlineRequest[0].body === JSON.stringify(queued[0].payload.command), "Reconnect changed the queued operation");
    const draftMetrics = evaluate(metrics); check(draftMetrics.scrollWidth <= width && draftMetrics.smallTargets.length === 0, "Offline draft UI touch/overflow failed");
    results.push({ name: "family-real-browser-encrypted-draft-reload-clear-reconnect", width, indexedDbEncrypted: true, ttl24h: true, baseVersionPreserved: true, survivesReload: true, logoutClearSignal: true, originalQueuedCommand: true, mockedApiOnly: true });

    open(`${fixture.href}?view=89`); action("textbox", "fill", "聯絡手機", "0912345678");
    check(evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='更新').disabled`), "Dirty preferences did not block refresh");
    action("button", "click", "清除未送出內容");
    check(evaluate(`document.querySelector('input[type=tel]').value===''`), "Preference draft was not discarded");
    results.push({ name: "family-preferences-draft", width, dirtyProtected: true, discardExplicit: true });

    open(`${fixture.href}?view=43`); browser("wait", "--text", "合成授權家屬");
    const before = evaluate(`({inputs:[...document.querySelectorAll('textarea')].length,requests:window.completionRequests})`);
    check(before.inputs === 0 && before.requests.every(row => !row.url.includes(`recipient=${"84000000-0000-4000-8000-000000000003"}`)), "Staff loaded family thread without explicit selection");
    action("combobox", "select", "家屬", "84000000-0000-4000-8000-000000000003"); browser("wait", "--text", "給家屬的訊息");
    browser("select", "#fixture-scenario", "retry-once"); action("textbox", "fill", "給家屬的訊息", "只給已選合成家屬"); action("button", "click", "送出"); browser("wait", "--text", "結果尚未確認");
    check(evaluate(`[...document.querySelectorAll('section select')].every(e=>e.disabled)`), "Staff could switch client/family while unresolved");
    action("button", "click", "重試原操作"); browser("wait", "--text", "訊息已送出");
    const staffRetry = evaluate(`window.completionRequests.filter(r=>r.method==='POST')`);
    check(staffRetry.length === 2 && staffRetry[0].body === staffRetry[1].body, "Staff reply retry changed its operation");
    results.push({ name: "staff-family-explicit-selection-and-retry", width, noImplicitRecipient: true, samePayload: true });

    open(`${fixture.href}?view=attachments`); browser("click", "details summary"); browser("wait", "--text", "合成待檢照片");
    check(evaluate(`!([...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='查看'||e.textContent.trim()==='上傳'))`), "Unscanned attachment offered a download or configured upload");
    browser("select", "#fixture-scenario", "revoked"); action("button", "click", "更新附件"); browser("wait", "--text", "沒有此筆紀錄的附件權限");
    check(!evaluate(`document.body.innerText.includes('合成待檢照片')`), "Attachment remained visible after revoked access");
    results.push({ name: "attachments-pending-and-revoked", width, unscannedCannotDownload: true, revokedDataHidden: true });

    open(`${fixture.href}?view=caregiver`);
    const caregiver = evaluate(`({before:document.querySelectorAll('.today-caregiver-actions[open]').length,summaries:document.querySelectorAll('.today-caregiver-actions summary').length,management:!!document.querySelector('.today-counters')})`);
    check(caregiver.before === 0 && caregiver.summaries > 0 && !caregiver.management, "Caregiver person-first actions were not collapsed/simplified");
    browser("eval", "document.querySelector('.today-caregiver-actions summary[aria-label*=\"開啟照顧工作\"]').focus()"); browser("press", "Enter");
    const actions = evaluate(`({open:document.querySelectorAll('.today-caregiver-actions[open]').length,labels:[...document.querySelectorAll('.today-caregiver-actions[open] a')].map(e=>e.textContent.trim()),overflow:document.documentElement.scrollWidth>innerWidth})`);
    check(actions.open === 1 && !actions.overflow && actions.labels.includes("生命徵象") && actions.labels.some(label => /^喝水[、・]如廁[、・]活動$/u.test(label)), `Caregiver keyboard disclosure/action layout failed: ${JSON.stringify(actions)}`);
    results.push({ name: "caregiver-keyboard-person-first", width, ...actions });
  }
  const runtimeErrors = browser("errors");
  check(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors}`);
  await writeFile(join(output, "report.json"), JSON.stringify({ scope: "Local synthetic route and mocked component UX, not production authentication/persistence acceptance", results, runtimeErrors }, null, 2));
  console.log(`Care/family browser acceptance: ${results.length} checks passed. Evidence: ${output}`);
} catch (failure) {
  await writeFile(join(output, "report.json"), JSON.stringify({ scope: "Local synthetic only; partial failed run, not production acceptance", results, failure: failure instanceof Error ? failure.message : String(failure) }, null, 2));
  throw failure;
} finally { browser("close"); }
