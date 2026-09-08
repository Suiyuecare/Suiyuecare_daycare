import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History as HistoryIcon,
  ShieldCheck,
  Syringe,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  InsulinAdministrationItem,
  InsulinAdministrationSnapshot,
  InsulinFilters,
  InsulinState,
} from "@/lib/insulin-administrations/types";

import { InsulinAdministrationActions } from "./insulin-administration-actions";
import styles from "./insulin-administrations.module.css";

const stateLabel: Record<InsulinState, string> = {
  scheduled: "待施打",
  late_authorized: "已授權補登",
  pending_review: "待獨立覆核",
  completed: "雙人完成",
};
const eventLabel = {
  late_authorized: "督導授權補登",
  executed: "執行施打",
  reviewed: "獨立覆核",
} as const;

function formatTaipei(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function ConfigurationNotice({ snapshot }: { snapshot: InsulinAdministrationSnapshot }) {
  const ready = snapshot.governanceStatus === "published" &&
    snapshot.planDesignationStatus === "published" &&
    snapshot.qualificationStatus === "published" &&
    snapshot.doseRuleStatus === "published" &&
    snapshot.lateEntryRuleStatus === "published";
  return <div className={ready ? styles.notice : styles.blocked} role="status">
    <ShieldCheck aria-hidden="true" />
    <div><strong>{ready ? "治理版本已發布" : "正式流程尚未配置完成"}</strong>
      <p>資格 {snapshot.qualificationStatus} · 胰島素計畫指定 {snapshot.planDesignationStatus}
        · 劑量規則 {snapshot.doseRuleStatus} · 補登規則 {snapshot.lateEntryRuleStatus}</p>
      {!ready ? <p>缺少任一項時，正式 API 與資料庫一律拒絕施打、覆核及補登授權。</p> : null}
    </div>
  </div>;
}

function Evidence({ item }: { item: InsulinAdministrationItem }) {
  return <dl className={styles.evidence}>
    <div><dt>計畫版本</dt><dd>v{item.medicationPlanVersion} · {item.medicationPlanContentHash.slice(0, 10)}…</dd></div>
    <div><dt>實際劑量／部位</dt><dd>{item.actualDoseText
      ? `${item.actualDoseText} ${item.actualDoseUnit} · ${item.siteText}` : "尚未執行"}</dd></div>
    <div><dt>執行人／伺服器時間</dt><dd>{item.executorDisplayName ?? "—"} · {formatTaipei(item.executedAt)}</dd></div>
    <div><dt>獨立覆核</dt><dd>{item.reviewerDisplayName ?? "—"} · {formatTaipei(item.reviewedAt)}</dd></div>
    {item.lateEntry ? <div><dt>補登督導／理由</dt><dd>{item.lateAuthorizerDisplayName} · {item.lateReason}</dd></div> : null}
  </dl>;
}

function History({ item }: { item: InsulinAdministrationItem }) {
  return <details className={styles.history}>
    <summary><HistoryIcon aria-hidden="true" />不可變歷程（{item.history.length}）</summary>
    {item.history.length === 0 ? <p>尚無執行事件。</p> : <ol>{item.history.map((entry) =>
      <li key={entry.eventId}><strong>#{entry.eventSequence} {eventLabel[entry.eventKind]}</strong>
        <span>{entry.actorDisplayName} · {formatTaipei(entry.occurredAt)}</span>
        <code>{entry.contentHash.slice(0, 12)}…</code></li>)}</ol>}
  </details>;
}

function MobileCard({ item, snapshot }: {
  item: InsulinAdministrationItem;
  snapshot: InsulinAdministrationSnapshot;
}) {
  return <article className={styles.card} data-insulin-card={item.medicationPlanId}>
    <header><div><p className="eyebrow">{item.clientCode} · {formatTaipei(item.scheduledFor)}</p>
      <h2>{item.clientDisplayName}</h2></div><span className={styles.state}>{stateLabel[item.state]}</span></header>
    <p><strong>{item.medicationName}</strong> · {item.orderedDoseText} {item.doseUnit}</p>
    {item.isLate ? <p className={styles.late}>已超過發布版補登門檻</p> : null}
    <Evidence item={item} /><InsulinAdministrationActions item={item} snapshot={snapshot} />
    <History item={item} />
  </article>;
}

export function InsulinAdministrationsWorkspace({ filters, loadError, page, snapshot }: {
  filters: InsulinFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: InsulinAdministrationSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="insulin-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗、逾時或無權限</p>
    <h1 id="insulin-load-error">無法取得胰島素施打快照</h1>
    <p>系統沒有顯示未通過機構、分支、個案指派、用藥或資格驗證的局部資料。</p>
    <Link className="button button--secondary" href="/app/staff/daily-care/insulin">重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">第 {page.number} 頁 · 日常照顧</p>
      <h1>{page.title}</h1><p>{page.description} Page 8 核准版本是唯一計畫來源，完成必須由不同人員獨立覆核。</p></div>
      <div className={styles.meta}><span>{snapshot.branchName}</span>
        <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
        <span>快照 {snapshot.snapshotToken.slice(0, 12)}…</span></div></header>

    {snapshot.demo ? <div className={styles.demo} role="status">
      展示模式：以下全為合成唯讀流程範例；正式治理、資格、計畫指定與寫入仍是 not_configured。
    </div> : null}
    <ConfigurationNotice snapshot={snapshot} />
    <div className={styles.notice} role="note"><AlertTriangle aria-hidden="true" /><p>
      本頁不支援離線、附件或外部送達；均為 <strong>not_configured</strong>。施打時間、覆核時間只採伺服器時間，
      畫面不作臨床診斷，也不自行發明劑量範圍。
    </p></div>

    <section className={styles.metrics} aria-label="胰島素施打統計">
      <article><Syringe aria-hidden="true" /><span>符合時點</span><strong>{snapshot.metrics.matching}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>待施打</span><strong>{snapshot.metrics.scheduled}</strong></article>
      <article><ShieldCheck aria-hidden="true" /><span>已授權補登</span><strong>{snapshot.metrics.lateAuthorized}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>待覆核</span><strong>{snapshot.metrics.pendingReview}</strong></article>
      <article><CheckCircle2 aria-hidden="true" /><span>雙人完成</span><strong>{snapshot.metrics.completed}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>逾時例外</span><strong>{snapshot.metrics.lateException}</strong></article>
    </section>

    <form className={styles.filters} method="get" aria-label="篩選胰島素施打時點">
      <label><span>日期</span><input name="date" type="date" defaultValue={filters.serviceDate} /></label>
      <label><span>班別</span><select name="shift" defaultValue={filters.shift}>
        <option value="all">全部</option><option value="morning">上午</option>
        <option value="afternoon">下午</option><option value="evening">晚間</option></select></label>
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}>
        <option value="all">全部個案</option>{snapshot.clientOptions.map((option) =>
          <option key={option.clientId} value={option.clientId}>{option.displayName}（{option.clientCode}）</option>)}</select></label>
      <label><span>狀態</span><select name="state" defaultValue={filters.state}>
        <option value="all">全部</option><option value="scheduled">待施打</option>
        <option value="late_authorized">已授權補登</option><option value="pending_review">待覆核</option>
        <option value="completed">雙人完成</option><option value="late">逾時例外</option></select></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/daily-care/insulin">清除</Link>
    </form>

    {snapshot.itemsTruncated ? <p className={styles.warning} role="status">
      明細只顯示前 200 筆；統計仍由完整結果集合計算。
    </p> : null}
    {snapshot.items.length === 0 ? <section className="empty-card">
      <span className="empty-card__icon"><Syringe aria-hidden="true" /></span>
      <h2>沒有可顯示的治理時點</h2><p>可能沒有符合篩選的時點，或正式治理／計畫指定尚未配置。</p>
    </section> : <>
      <div className={styles.tableWrap}><table><caption>胰島素施打不可變快照</caption>
        <thead><tr><th>個案／排程</th><th>Page 8 計畫證據</th><th>狀態</th>
          <th>執行／覆核證據</th><th>操作</th><th>歷程</th></tr></thead>
        <tbody>{snapshot.items.map((item) => <tr key={item.medicationPlanId}
          data-insulin-row={item.medicationPlanId}>
          <td><strong>{item.clientDisplayName}</strong><span>{item.clientCode}</span>
            <time dateTime={item.scheduledFor}>{formatTaipei(item.scheduledFor)}</time></td>
          <td><strong>{item.medicationName}</strong><span>{item.orderedDoseText} {item.doseUnit}</span>
            <span>v{item.medicationPlanVersion} · {item.medicationPlanContentHash.slice(0, 10)}…</span></td>
          <td><span className={styles.state}>{stateLabel[item.state]}</span>
            {item.isLate ? <span className={styles.late}>逾時例外</span> : null}</td>
          <td><Evidence item={item} /></td>
          <td><InsulinAdministrationActions item={item} snapshot={snapshot} /></td>
          <td><History item={item} /></td>
        </tr>)}</tbody></table></div>
      <div className={styles.cards}>{snapshot.items.map((item) => <MobileCard
        key={item.medicationPlanId} item={item} snapshot={snapshot} />)}</div>
    </>}
  </div>;
}
