"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { CHECK_KEYS, CHECK_LABELS, FILTERS, FILTER_LABELS, STATE_LABELS, filterRows, hasFreshReportTimestamp, intakeDrilldown, isResolved, reportCounts, snapshotSchema, type CheckKey, type IntakeCompletenessSnapshot, type ReportFilter } from "@/lib/intake-completeness/model";
import styles from "./report.module.css";

export function IntakeCompletenessWorkspace({ initialSnapshot, branchName, scope, demo, initialError = null }: { initialSnapshot: IntakeCompletenessSnapshot | null; branchName: string; scope: { organizationId: string; branchId: string }; demo: boolean; initialError?: string | null }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState(initialError);
  const [filter, setFilter] = useState<ReportFilter>("attention");
  const [query, setQuery] = useState("");
  const [item, setItem] = useState<CheckKey | "all">("all");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); request.current?.abort(); };
  }, []);
  useEffect(() => {
    const check = () => setStale(Boolean(snapshot && Date.now() - Date.parse(snapshot.generatedAt) > 5 * 60_000));
    check(); const timer = window.setInterval(check, 30_000); return () => window.clearInterval(timer);
  }, [snapshot]);
  async function refresh() {
    if (busy || offline || demo) return;
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/intake-completeness", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const envelope: unknown = await response.json();
      const body = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : null;
      const parsed = snapshotSchema.safeParse(body);
      if (!response.ok || !parsed.success || parsed.data.organizationId !== scope.organizationId || parsed.data.branchId !== scope.branchId || !hasFreshReportTimestamp(parsed.data.generatedAt)) throw new Error("unverified report");
      setSnapshot(parsed.data);
    } catch {
      setSnapshot(null); setError(controller.signal.aborted ? "核對逾時，請檢查連線後再試一次。" : "本次無法核對資料或查閱權限，請重新整理或聯絡主管。未確認的資料不會算作完成。");
    } finally { clearTimeout(timer); if (request.current === controller) request.current = null; setBusy(false); }
  }
  const counts = snapshot ? reportCounts(snapshot, query, item) : null;
  const rows = snapshot ? filterRows(snapshot, filter, query, item) : [];
  const generated = snapshot ? formatCareTaipeiTime(snapshot.generatedAt) : null;
  return <section className={styles.workspace} aria-labelledby="intake-report-title">
    <header className={styles.heading}><div><p className={styles.eyebrow}>{branchName}・收案追蹤</p><h1 id="intake-report-title">收案與補件表</h1><p>先看哪位個案還需要補資料，直接進入該個案繼續處理。</p></div><div className={styles.actions}><Link prefetch={false} href="/app/client-intake">前往個案收案</Link><button type="button" onClick={refresh} disabled={busy || offline || demo}>{busy ? "正在核對…" : "重新核對"}</button></div></header>
    <p className={styles.notice}>這是收案作業提醒，不是法定缺件清單、臨床核准或正式收案許可。文件是否適用須由有權限的人員確認；「已處理」不代表文件內容或醫療決策已驗證。資料僅在本頁記憶體顯示，不提供離線保存或批次匯出。</p>
    {demo && <p className={styles.notice}>合成資料試看：不連接正式個案，所有檢查保留為待核對。</p>}
    {offline && <p role="status" className={styles.notice}>目前離線，畫面是先前核對結果；連線後請重新核對再作業。</p>}
    {stale && !offline && <p role="status" className={styles.notice}>這份結果已超過 5 分鐘，請重新核對最新異動。</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {snapshot && counts && <>
      <p className={styles.meta}>更新時間 {generated}（臺北時間）・核對日期 {snapshot.asOf}・僅含目前分支與可查閱個案。基本資料以最新保存版本核對；日期用於文件效期及週表。</p>
      <nav className={styles.cards} aria-label="收案狀態篩選">{FILTERS.map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}><span>{FILTER_LABELS[key]}</span><strong>{counts[key]}<small> 人</small></strong></button>)}</nav>
      <div className={styles.filters}><label>搜尋姓名或案號<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="輸入姓名或案號" autoComplete="off" /></label><label>狀態<select value={filter} onChange={(event) => setFilter(event.target.value as ReportFilter)}>{FILTERS.map((key) => <option key={key} value={key}>{FILTER_LABELS[key]}</option>)}</select></label><label>尚待處理的項目<select value={item} onChange={(event) => setItem(event.target.value as CheckKey | "all")}><option value="all">不限項目</option>{CHECK_KEYS.map((key) => <option key={key} value={key}>{CHECK_LABELS[key]}</option>)}</select></label></div>
      <p role="status" aria-live="polite">符合條件 {rows.length} 人／本次可查閱 {snapshot.rows.length} 人。卡片數字套用目前搜尋與項目條件；各狀態可重疊，不可直接相加。</p>
      {!rows.length ? <div className={styles.empty}><h2>{snapshot.rows.length ? "目前篩選沒有符合個案" : "目前沒有可查閱個案"}</h2><p>{snapshot.rows.length ? "可切換全部個案，或清除搜尋與項目條件。" : "可前往收案建檔；若個案已存在，請主管確認分支與個案指派。這不代表全機構沒有個案。"}</p><button type="button" onClick={() => { setFilter("all"); setQuery(""); setItem("all"); }}>查看全部授權個案</button></div> : <div className={styles.list}>{rows.map((row) => <article className={styles.client} key={row.clientId}><header><div><h2>{row.displayName}</h2><p>{row.clientCode}・{({ active: "服務中／待收案", suspended: "暫停", transferred: "已轉出", closed: "已結案", deceased: "已歿" })[row.clientStatus]}</p></div><span>{row.checks.filter((check) => !isResolved(check.state)).length} 項待處理／核對</span></header><ul>{row.checks.filter((check) => !isResolved(check.state)).map((check) => <li key={check.key}><div><strong>{CHECK_LABELS[check.key]}</strong><span>{STATE_LABELS[check.state]}</span>{check.state === "missing" && CHECK_KEYS.indexOf(check.key) >= 6 && check.key !== "weekly" && <small>尚未提供；若不適用，請在文件頁填寫理由。</small>}</div>{check.state !== "denied" && <Link prefetch={false} href={intakeDrilldown(row.clientId, check.key)} aria-label={`處理${row.displayName}的${CHECK_LABELS[check.key]}`}>前往處理</Link>}</li>)}</ul><details><summary>查看全部 {row.checks.length} 項狀態</summary><ul>{row.checks.map((check) => <li key={check.key}><span>{CHECK_LABELS[check.key]}</span><span>{STATE_LABELS[check.state]}</span></li>)}</ul></details></article>)}</div>}
    </>}
  </section>;
}
