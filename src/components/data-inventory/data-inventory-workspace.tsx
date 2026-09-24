"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { roleDisplayName } from "@/lib/domain/roles";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import {
  DATA_INVENTORY_ITEMS, INVENTORY_OWNERS, INVENTORY_REASONS, INVENTORY_SOURCES,
  RECONCILIATION_STATES, dataInventoryReviewBlockers, emptyDataInventoryContent,
  type DataInventoryContent, type DataInventoryItemKey, type DataInventorySnapshot,
  type DataInventoryVersion,
} from "@/lib/data-inventory/types";
import { parseDataInventoryMutation } from "@/lib/data-inventory/parser";
import {
  ConfirmedInventoryFailure, sendDataInventoryOperation, type InventoryOperation,
} from "./data-inventory-request";
import styles from "./data-inventory.module.css";

const statusLabels = { missing: "尚未取得", received: "已取得・待補齊", pending_review: "待人工覆核",
  verified: "已人工覆核", not_applicable: "不適用" } as const;
type DisplayStatus = keyof typeof statusLabels;
const sourceLabels: Record<DataInventoryContent["source"], string> = {
  unknown: "尚未確認", central_html: "中央 HTML", previous_system: "舊系統匯出", spreadsheet: "試算表",
  paper: "紙本紀錄", organization_file: "機構文件",
};
const ownerLabels: Record<DataInventoryContent["accountableRole"], string> = {
  unassigned: "尚未指派", organization_manager: roleDisplayName("organization_manager"), branch_supervisor: roleDisplayName("branch_supervisor"),
  case_manager_social_worker: roleDisplayName("case_manager_social_worker"), nurse: roleDisplayName("nurse"), finance_claims: roleDisplayName("finance_claims"),
};
const reasonLabels: Record<DataInventoryContent["reasonCode"], string> = {
  none: "無／首次登錄", out_of_scope: "不在本次盤點範圍", no_historical_data: "無該類歷史資料",
  data_correction: "更正盤點內容", source_updated: "來源已更新",
};
const reconciliationLabels: Record<DataInventoryContent["keyFields"], string> = {
  pending: "尚未核對", passed: "人工核對通過", not_applicable: "不適用",
};
const countFields = [
  ["expectedCount", "來源應有筆數"], ["actualCount", "實際取得筆數"],
  ["missingRequired", "必要欄位缺漏數"], ["unmapped", "未映射欄位數"],
  ["conflicts", "待處理衝突數"], ["criticalDifferences", "重大差異數"],
] as const;
const reconciliationFields = [["keyFields", "關鍵欄位"], ["amounts", "金額"], ["attachments", "附件"]] as const;
const categories = [...new Set(DATA_INVENTORY_ITEMS.map((item) => item.category))];

export function inventoryDisplayStatus(itemKey: DataInventoryItemKey, version?: DataInventoryVersion): DisplayStatus {
  if (!version || version.content.status === "missing") return "missing";
  if (version.content.status === "not_applicable") return "not_applicable";
  if (version.reviewState === "manually_verified") return "verified";
  return dataInventoryReviewBlockers(itemKey, version.content).length ? "received" : "pending_review";
}
function dateTime(value: string | null) {
  if (!value) return "尚未紀錄";
  return formatCareTaipeiTime(value);
}
function countText(value: number | null) { return value === null ? "尚未盤點（不是 0）" : value.toLocaleString("zh-TW"); }
function isExpired(snapshot: DataInventorySnapshot | null) { return !snapshot || (!snapshot.demo && Date.now() >= Date.parse(snapshot.staleAfter)); }

function InventoryFacts({ version, content }: { version?: DataInventoryVersion; content: DataInventoryContent }) {
  return <>
    <dl className={styles.facts}>
      <div><dt>資料來源</dt><dd>{sourceLabels[content.source]}</dd></div>
      <div><dt>資料負責角色（非具名承辦人）</dt><dd>{ownerLabels[content.accountableRole]}</dd></div>
      <div><dt>涵蓋期間</dt><dd>{content.status === "not_applicable" ? "不適用" : `${content.periodStart ?? "起日未填"} ～ ${content.periodEnd ?? "迄日未填"}`}</dd></div>
      {reconciliationFields.map(([key, label]) => <div key={key}><dt>{label}人工核對</dt><dd>{reconciliationLabels[content[key]]}</dd></div>)}
      <div><dt>原因代碼</dt><dd>{reasonLabels[content.reasonCode]}</dd></div>
      <div><dt>證據參照碼</dt><dd>{content.evidenceReference ?? "尚未提供"}</dd></div>
      <div><dt>覆核狀態</dt><dd>{version?.reviewState === "manually_verified" ? "人工盤點覆核完成（非正式驗收）" : "尚未人工覆核"}</dd></div>
    </dl>
    <p className={styles.muted}>此處僅保存人工盤點中繼資料；證據參照碼不會上傳、下載或自動查驗原始檔案。</p>
  </>;
}

function InventoryContentFields({ itemKey, content, setContent, revision }: {
  itemKey: DataInventoryItemKey; content: DataInventoryContent;
  setContent: (content: DataInventoryContent) => void; revision: boolean;
}) {
  const notApplicable = content.status === "not_applicable";
  return <>
    <fieldset><legend>1. 資料取得狀態與負責角色</legend><div className={styles.grid}>
      <label className={styles.field}>取得狀態<select value={content.status} onChange={(event) => {
        const status = event.target.value as DataInventoryContent["status"];
        setContent(status === "not_applicable" ? { ...content, status, periodStart: null, periodEnd: null,
          expectedCount: null, actualCount: null, missingRequired: null, unmapped: null, conflicts: null, criticalDifferences: null,
          keyFields: "not_applicable", amounts: "not_applicable", attachments: "not_applicable", reasonCode: "out_of_scope" }
          : { ...content, status, keyFields: notApplicable ? "pending" : content.keyFields,
            amounts: notApplicable ? "pending" : content.amounts, attachments: notApplicable ? "pending" : content.attachments,
            reasonCode: notApplicable ? (revision ? "data_correction" : "none") : content.reasonCode });
      }}><option value="missing">尚未取得</option><option value="received">已取得</option><option value="not_applicable">不適用（須記錄原因）</option></select></label>
      <label className={styles.field}>來源類別<select value={content.source} onChange={(event) => setContent({ ...content, source: event.target.value as DataInventoryContent["source"] })}>
        {INVENTORY_SOURCES.map((value) => <option key={value} value={value}>{sourceLabels[value]}</option>)}</select></label>
      <label className={styles.field}>資料負責角色（非具名承辦人）<select value={content.accountableRole} onChange={(event) => setContent({ ...content, accountableRole: event.target.value as DataInventoryContent["accountableRole"] })}>
        {INVENTORY_OWNERS.map((value) => <option key={value} value={value}>{ownerLabels[value]}</option>)}</select></label>
      <label className={styles.field}>{notApplicable ? "不適用原因（必填）" : revision ? "修訂原因（必填）" : "盤點原因"}<select value={content.reasonCode}
        onChange={(event) => setContent({ ...content, reasonCode: event.target.value as DataInventoryContent["reasonCode"] })}>
        {INVENTORY_REASONS.filter((value) => notApplicable ? ["out_of_scope", "no_historical_data"].includes(value)
          : revision ? value !== "none" : true).map((value) => <option key={value} value={value}>{reasonLabels[value]}</option>)}</select></label>
    </div></fieldset>
    {!notApplicable ? <fieldset><legend>2. 涵蓋期間與人工盤點數量</legend>
      <p className={styles.muted}>未知數量請留空；輸入 0 表示已查核且確實為零。這些數量由人員填寫，並非系統已自動對帳。</p>
      <div className={styles.grid}>
        <label className={styles.field}>涵蓋起日<input type="date" min="1900-01-01" max={content.periodEnd ?? "2200-12-31"} value={content.periodStart ?? ""}
          onChange={(event) => setContent({ ...content, periodStart: event.target.value || null })}/></label>
        <label className={styles.field}>涵蓋迄日<input type="date" min={content.periodStart ?? "1900-01-01"} max="2200-12-31" value={content.periodEnd ?? ""}
          onChange={(event) => setContent({ ...content, periodEnd: event.target.value || null })}/></label>
        {countFields.map(([key, label]) => <label className={styles.field} key={key}>{label}<input type="number" inputMode="numeric" min="0" max="1000000000" step="1" value={content[key] ?? ""}
          onChange={(event) => setContent({ ...content, [key]: event.target.value === "" ? null : Number(event.target.value) })}/></label>)}
      </div>
    </fieldset> : <p className={styles.notice}>不適用與缺漏分開保存；此版本的期間與數量會清空，核對項目記為不適用。舊版本仍保留。</p>}
    <fieldset><legend>3. 人工核對與證據</legend>
      <p className={styles.muted}>只能引用去識別化的內部證據 UUID；不得填寫姓名、身分證字號、原始檔名或網址。</p>
      <div className={styles.grid}>
        {!notApplicable ? reconciliationFields.map(([key, label]) => <label className={styles.field} key={key}>{label}核對<select value={content[key]}
          onChange={(event) => setContent({ ...content, [key]: event.target.value as DataInventoryContent[typeof key] })}>
          {RECONCILIATION_STATES.filter((value) => value !== "not_applicable" || (key !== "keyFields" && !(key === "amounts" && ["billing", "claims"].includes(itemKey))
            && !(key === "attachments" && itemKey === "history_attachments"))).map((value) => <option key={value} value={value}>{reconciliationLabels[value]}</option>)}</select></label>) : null}
        <label className={`${styles.field} ${styles.full}`}>證據參照碼（UUID）<input type="text" maxLength={36} autoComplete="off" spellCheck={false}
          pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          title="請填寫 UUID 格式的內部證據參照碼，不接受姓名、檔名或網址。" value={content.evidenceReference ?? ""}
          onChange={(event) => setContent({ ...content, evidenceReference: event.target.value || null })}/></label>
      </div>
    </fieldset>
  </>;
}

export function DataInventoryWorkspace({ snapshot, canManage, canReview, hasRecentAal2, actorUserId, loadError = false }: {
  snapshot: DataInventorySnapshot | null; canManage: boolean; canReview: boolean; hasRecentAal2: boolean;
  actorUserId?: string; loadError?: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<DisplayStatus | "all">("all");
  const [editor, setEditor] = useState<{ itemKey: DataInventoryItemKey; mode: "save" | "verify"; generatedAt: string; expectedVersion: number } | null>(null);
  const [content, setContent] = useState<DataInventoryContent>(() => emptyDataInventoryContent());
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState<InventoryOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const check = () => { setOffline(!navigator.onLine); setStale(isExpired(snapshot)); };
    check(); const timer = window.setInterval(check, 10000);
    window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, [snapshot]);
  useEffect(() => { if (editor) editorHeading.current?.focus(); }, [editor]);
  if (loadError || !snapshot) return <section id="data-inventory" className={styles.workspace} aria-labelledby="data-inventory-heading">
    <h2 id="data-inventory-heading">資料盤點與缺漏追蹤</h2><div className={styles.error} role="alert"><p>盤點資料暫時無法載入。</p>
      <p>請確認目前分支與盤點查閱權限後重試；不會改用合成資料代替正式紀錄。</p>
      <button className="button button--secondary" onClick={() => router.refresh()}>重新載入盤點資料</button></div>
  </section>;
  const currentSnapshot = snapshot;
  const rows = DATA_INVENTORY_ITEMS.map((item) => {
    const record = currentSnapshot.records.find((record) => record.itemKey === item.key);
    const itemContent = record?.current.content ?? emptyDataInventoryContent();
    return { item, record, content: itemContent, displayStatus: inventoryDisplayStatus(item.key, record?.current), blockers: dataInventoryReviewBlockers(item.key, itemContent) };
  });
  const filteredRows = rows.filter((row) => (category === "all" || row.item.category === category) && (status === "all" || row.displayStatus === status));
  const counts = Object.fromEntries(Object.keys(statusLabels).map((value) => [value, rows.filter((row) => row.displayStatus === value).length])) as Record<DisplayStatus, number>;
  const pendingScopeChanged = pending !== null && (pending.organizationId !== snapshot.organizationId || pending.branchId !== snapshot.branchId || pending.actorUserId !== actorUserId);
  const unavailable = snapshot.demo || !actorUserId || stale || offline || busy || pending !== null;
  const filtersLocked = editor !== null || pending !== null || busy;
  function closeEditor() {
    const itemKey = editor?.itemKey; setEditor(null); setAcknowledged(false); setError("");
    if (itemKey) window.requestAnimationFrame(() => document.getElementById(`inventory-edit-${itemKey}`)?.focus());
  }
  function openEditor(itemKey: DataInventoryItemKey, mode: "save" | "verify") {
    if (unavailable || isExpired(currentSnapshot) || (mode === "save" ? !canManage : !canReview)) return;
    const version = currentSnapshot.records.find((record) => record.itemKey === itemKey)?.current;
    const nextContent = structuredClone(version?.content ?? emptyDataInventoryContent());
    if (mode === "save" && version && nextContent.status !== "not_applicable"
      && nextContent.amounts !== "not_applicable" && nextContent.attachments !== "not_applicable") nextContent.reasonCode = "data_correction";
    setContent(nextContent); setAcknowledged(false); setError(""); setMessage("");
    setEditor({ itemKey, mode, generatedAt: currentSnapshot.generatedAt, expectedVersion: version?.version ?? 0 });
  }
  async function execute(operation: InventoryOperation) {
    if (inFlight.current || currentSnapshot.demo || !navigator.onLine || !actorUserId
      || operation.organizationId !== currentSnapshot.organizationId || operation.branchId !== currentSnapshot.branchId
      || operation.actorUserId !== actorUserId || (operation.request.action === "save" ? !canManage : (!canReview || !hasRecentAal2))) return;
    inFlight.current = true; setBusy(true); setPending(operation); setError(""); setMessage("");
    try {
      await sendDataInventoryOperation(operation);
      setPending(null); setEditor(null); setStale(true);
      setMessage(operation.request.action === "verify" ? "人工盤點覆核已追加版本；這不代表正式資料已匯入或上線驗收通過。正在更新資料。" : "盤點資料已追加保存版本，正在更新資料。");
      router.refresh();
    } catch (caught) {
      if (caught instanceof ConfirmedInventoryFailure) setPending(null);
      setError(caught instanceof Error ? caught.message : "未能確認操作結果；請保留相同內容重試。");
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || unavailable || isExpired(currentSnapshot) || !actorUserId) return;
    if (editor.generatedAt !== currentSnapshot.generatedAt) {
      setError("畫面版本已更新，不能直接套用舊的編輯內容。請取消後重新開啟最新版本核對。"); return;
    }
    const current = currentSnapshot.records.find((record) => record.itemKey === editor.itemKey)?.current;
    if (editor.mode === "verify" && (!acknowledged || !canReview || !hasRecentAal2 || !current
      || current.contentRecordedBy === actorUserId || current.reviewState === "manually_verified"
      || dataInventoryReviewBlockers(editor.itemKey, current.content).length)) return;
    if (editor.mode === "save" && !canManage) return;
    try {
      const parsed = parseDataInventoryMutation({ idempotency_key: crypto.randomUUID(),
        ...(editor.mode === "save" ? { action: "save", itemKey: editor.itemKey, expectedVersion: editor.expectedVersion, content: structuredClone(content) }
          : { action: "verify", itemKey: editor.itemKey, expectedVersion: editor.expectedVersion,
            expectedVersionId: current!.versionId, expectedContentHash: current!.contentHash }) });
      void execute({ ...parsed, organizationId: currentSnapshot.organizationId, branchId: currentSnapshot.branchId, actorUserId });
    } catch { setError("請檢查成對的起訖日期、非負整數、原因及 UUID 證據參照碼；尚未送出。不得填寫個資。"); }
  }
  return <section id="data-inventory" className={styles.workspace} aria-labelledby="data-inventory-heading">
    <header className={styles.heading}><p className={styles.eyebrow}>整合與稽核中心 · 六類來源資料</p>
      <h2 id="data-inventory-heading">資料盤點與缺漏追蹤</h2><p>先確認資料在哪裡、由誰負責、還缺什麼，再安排人工核對。</p></header>
    <div className={styles.notice}><strong>盤點完成 ≠ 正式資料完整 ≠ 89 頁驗收完成</strong>
      <p>以下是 12 項來源資料的人工盤點清單，不會自動讀取原始檔、判定法律合規，或把資料寫入個案、用藥、財務與申報頁面。</p>
      <p>正式欄位轉入、七年資料移轉、附件封存及自動對帳尚未設定；不可用本頁覆核取代這些驗收。</p>
      <Link href="/app/staff/governance/central-html-import">前往中央 HTML 匯入查看映射與缺漏</Link></div>
    {snapshot.demo ? <div className={styles.notice} role="status"><strong>唯讀合成示例</strong><p>數量、證據參照碼與版本均為合成資料；不能編輯、覆核或上傳真實個資。</p></div> : null}
    {!canManage && !snapshot.demo ? <p className={styles.notice}>目前沒有盤點編輯權限；可依授權查看紀錄，不能改動來源資料。</p> : null}
    <dl className={styles.summary} aria-label="十二項盤點狀態統計">{Object.entries(statusLabels).map(([value, label]) => <div key={value}><dt>{label}</dt><dd>{counts[value as DisplayStatus]} 項</dd></div>)}</dl>
    <p className={styles.muted}>統計範圍：本分支 12 項來源資料，非個案或服務筆數。不適用項目獨立計數，仍需人工覆核。<br/>
      {snapshot.demo ? "合成示例快照" : "盤點快照"}：{dateTime(snapshot.generatedAt)}（臺北時間）{snapshot.demo ? "；非正式資料更新時間" : ` · 有效至 ${dateTime(snapshot.staleAfter)}`}</p>
    {(offline || stale) ? <div className={styles.error} role="status"><p>{offline ? "目前離線，不能保存或覆核；未送出的內容僅存在此畫面，關閉後不會保留。" : "資料已過期或剛完成操作，請重新載入最新盤點後再開始新操作。"}</p></div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {message ? <div className={styles.success} role="status">{message}</div> : null}
    {pending ? <div className={styles.notice} role="status"><p>{busy ? "正在確認操作結果，請勿關閉此頁。" : "本次操作結果仍待確認；內容與識別碼已固定，請勿另建重複操作。"}</p>
      {pendingScopeChanged ? <p>目前機構、分支或帳號已變更，不能在此範圍重送原操作；請回原範圍核對。</p> : null}
      <button className="button button--primary" disabled={busy || offline || snapshot.demo || pendingScopeChanged
        || (pending.request.action === "save" ? !canManage : (!canReview || !hasRecentAal2))}
        onClick={() => void execute(pending)}>{busy ? "確認中…" : "以相同內容與識別碼重試"}</button></div> : null}
    <div className={styles.toolbar}>
      <label>資料類別<select value={category} disabled={filtersLocked} onChange={(event) => setCategory(event.target.value)}><option value="all">全部六類</option>
        {categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>盤點狀態<select value={status} disabled={filtersLocked} onChange={(event) => setStatus(event.target.value as DisplayStatus | "all")}><option value="all">全部狀態</option>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button button--secondary" disabled={busy || pending !== null || offline} onClick={() => router.refresh()}>重新載入盤點資料</button>
    </div>
    <p className={styles.muted} role="status">符合篩選 {filteredRows.length}／12 項。編輯中的內容不會自動保存；目前篩選不會改變統計口徑。</p>
    {filteredRows.length === 0 ? <div className={styles.empty}><h3>此篩選沒有盤點項目</h3><p>請切換類別或清除篩選，查看仍需補齊的資料。</p>
      <button className="button button--secondary" onClick={() => { setCategory("all"); setStatus("all"); }}>清除篩選</button></div> : null}
    <ul className={styles.list}>{filteredRows.map(({ item, record, content: itemContent, displayStatus, blockers }) => {
      const version = record?.current;
      const ownRecord = version?.contentRecordedBy === actorUserId;
      const reviewBlocked = !version || ownRecord || blockers.length > 0 || version.reviewState === "manually_verified";
      const isEditing = editor?.itemKey === item.key;
      const mismatch = itemContent.expectedCount !== null && itemContent.actualCount !== null && itemContent.expectedCount !== itemContent.actualCount;
      const nextStep = version?.reviewState === "manually_verified" ? "盤點已人工覆核；接續安排原始證據查驗與正式移轉對帳，不代表已可營運。"
        : blockers[0] ? `${blockers[0]}；請由資料負責角色補齊盤點後，再交由另一位授權人員覆核。`
          : "已符合人工盤點覆核條件，請由非原登錄者的授權人員核對證據。";
      return <li className={styles.card} key={item.key}>
        <div className={styles.cardHeader}><div><p className={styles.eyebrow}>{item.category}</p><h3>{item.label}</h3></div><span className={styles.badge}>{statusLabels[displayStatus]}</span></div>
        <p className={styles.muted}>建議來源：{item.source} · 負責：{ownerLabels[itemContent.accountableRole]} · {version ? `v${version.version}` : "尚未登錄"}</p>
        <p className={styles.nextStep}><strong>下一步：</strong>{nextStep}</p>
        {itemContent.status !== "not_applicable" ? <dl className={styles.counts}>{countFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{countText(itemContent[key])}</dd></div>)}</dl>
          : <p>不適用原因：{reasonLabels[itemContent.reasonCode]} · {version?.reviewState === "manually_verified" ? "已人工覆核" : "尚未人工覆核"}；不列為缺漏數量 0。</p>}
        {mismatch ? <p className={styles.mismatch}>筆數不一致：來源應有 {itemContent.expectedCount} 筆，實際取得 {itemContent.actualCount} 筆；差異未解決前不能覆核。</p> : null}
        <details className={styles.detail}><summary>來源、核對條件與版本證據</summary><InventoryFacts version={version} content={itemContent}/>
          {blockers.length ? <><h4>尚未符合的人工覆核條件</h4><ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></> : <p>盤點欄位已符合人工覆核條件，原始證據仍須人工查驗。</p>}
          {version ? <><p className={styles.muted}>目前版本：{version.versionId}<br/>內容登錄者 ID：{version.contentRecordedBy}<br/>版本建立：{dateTime(version.createdAt)}<br/>
            內容雜湊：{version.contentHash}<br/>前版：{version.previousVersionId ?? "首版"}<br/>
            {version.reviewedBy ? `已由：${version.reviewedBy} · ${dateTime(version.reviewedAt)}` : "覆核尚未完成"}</p>
            <h4>保留版本</h4><ol className={styles.history}>{record!.history.map((history) => <li key={history.versionId}>v{history.version} · {dateTime(history.createdAt)} · {history.reviewState === "manually_verified" ? "人工覆核版本" : "盤點登錄版本"}<br/>
              <span className={styles.muted}>版本 ID：{history.versionId} · 原因：{reasonLabels[history.content.reasonCode]}</span></li>)}</ol>
            {record!.historyTruncated ? <p role="status">目前顯示最近 {record!.history.length} 個／共 {record!.historyTotal} 個版本；更早版本未載入，完整歷程仍保留。</p> : null}</> : <p>尚未登錄盤點版本；固定清單不代表已有來源檔案。</p>}
        </details>
        {!isEditing ? <div className={styles.actions}>
          <button id={`inventory-edit-${item.key}`} className="button button--secondary" disabled={unavailable || !canManage || editor !== null}
            onClick={() => openEditor(item.key, "save")}>{version ? "更新盤點" : "登錄盤點"}<span className="sr-only">：{item.label}</span></button>
          <button className="button button--primary" disabled={unavailable || !canReview || !hasRecentAal2 || reviewBlocked || editor !== null}
            onClick={() => openEditor(item.key, "verify")}>人工覆核<span className="sr-only">：{item.label}</span></button>
        </div> : null}
        {!snapshot.demo && !hasRecentAal2 && canReview && version?.reviewState !== "manually_verified" ? <p>覆核需最近 15 分鐘完成雙因素驗證。<Link href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link></p> : null}
        {!snapshot.demo && ownRecord && version?.reviewState !== "manually_verified" ? <p className={styles.muted}>您是本版內容登錄者，須由另一位具權限人員覆核。</p> : null}
        {isEditing ? <form className={styles.form} onSubmit={submit} aria-labelledby={`inventory-form-${item.key}`}>
          <h4 ref={editorHeading} tabIndex={-1} id={`inventory-form-${item.key}`}>{editor.mode === "save" ? "登錄／更新人工盤點" : "覆核人工盤點中繼資料"}：{item.label}</h4>
          <fieldset disabled={busy || pending !== null || snapshot.demo || offline}><legend>{editor.mode === "save" ? "新增版本，不覆寫歷史" : "核對目前版本"}</legend>
            {editor.mode === "save" ? <InventoryContentFields itemKey={item.key} content={content} setContent={setContent} revision={editor.expectedVersion > 0}/>
              : <><InventoryFacts content={itemContent} version={version}/><p>此操作僅表示您人工確認盤點欄位與證據參照，不會執行原始檔對帳或正式資料匯入。</p>
                <label className={styles.checkbox}><input type="checkbox" checked={acknowledged} required onChange={(event) => setAcknowledged(event.target.checked)}/>
                  <span>我已人工核對這一版資料及來源證據，理解此覆核不代表 89 頁、正式移轉或上線驗收通過。</span></label></>}
          </fieldset>
          <div className={styles.actions}><button type="submit" className="button button--primary" disabled={unavailable || (editor.mode === "save" ? !canManage : (!canReview || !hasRecentAal2 || !acknowledged || reviewBlocked))}>
            {editor.mode === "save" ? "保存盤點新版本" : "確認人工覆核並追加版本"}</button>
            <button type="button" className="button button--secondary" disabled={busy || pending !== null} onClick={closeEditor}>取消編輯</button></div>
        </form> : null}
      </li>;
    })}</ul>
  </section>;
}
