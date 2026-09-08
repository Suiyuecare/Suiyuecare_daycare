import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  FileWarning,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ProfessionalServiceSummaryFilters,
  ProfessionalServiceSummaryItem,
  ProfessionalServiceSummarySnapshot,
  ProfessionalSummarySourceConfiguration,
} from "@/lib/professional-service-summary/types";

import styles from "./professional-service-summary.module.css";

function formatDate(value: string | null) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function statusText(item: ProfessionalServiceSummaryItem) {
  const frequencyMissing = item.expectationStatus ===
    "existing_records_only_frequency_not_configured";
  if (item.summaryStatus === "completed") {
    return frequencyMissing ? "既有紀錄已完成（頻率未設定）" : "已完成";
  }
  if (item.summaryStatus === "pending") {
    return frequencyMissing ? "既有草稿待完成（頻率未設定）" : "待完成";
  }
  if (item.summaryStatus === "overdue") return "逾期";
  return "規則未設定";
}

function serviceStatusText(status: ProfessionalServiceSummaryItem["serviceStatus"]) {
  return {
    active: "服務中",
    suspended: "暫停",
    transferred: "轉出",
    closed: "結案",
    deceased: "死亡結案",
  }[status];
}

function dataStatusText(config: ProfessionalSummarySourceConfiguration) {
  if (config.dataStatus === "configured") return "資料來源已接線";
  if (config.dataStatus === "candidate_only") return "僅候選預覽，未發布正式規則";
  return "授權與電子化規則未設定";
}

function expectationStatusText(config: ProfessionalSummarySourceConfiguration) {
  return {
    manual_due_date_only: "採來源內人工複評日期",
    not_configured: "正式完成口徑尚未設定",
    manual_deadline_or_explicit_missing_state:
      "採人工期限；缺值與不適用分開顯示",
    action_deadline_only: "依會議行動項目的人工期限",
    due_rule_not_configured: "期限規則尚未設定",
    existing_records_only_frequency_not_configured:
      "只統計既有紀錄；服務頻率尚未設定",
  }[config.expectationStatus];
}

function exportHref(
  snapshot: ProfessionalServiceSummarySnapshot,
  filters: ProfessionalServiceSummaryFilters,
) {
  const params = new URLSearchParams({
    snapshot: snapshot.snapshotId,
    month: filters.month,
    professional: filters.professionalKind,
    status: filters.status,
  });
  if (filters.clientId) params.set("client", filters.clientId);
  return `/api/professional-service-summary/export?${params.toString()}`;
}

function ItemDetails({ item }: { item: ProfessionalServiceSummaryItem }) {
  return <details className={styles.details}>
    <summary>查看計數與來源證據</summary>
    <dl>
      <div><dt>應完成</dt><dd>{item.expectedCount}</dd></div>
      <div><dt>已完成</dt><dd>{item.completedCount}</dd></div>
      <div><dt>待完成</dt><dd>{item.pendingCount}</dd></div>
      <div><dt>逾期</dt><dd>{item.overdueCount}</dd></div>
      <div><dt>來源版本</dt><dd>v{item.sourceVersion}</dd></div>
      <div className={styles.wide}><dt>狀態依據</dt><dd>{item.statusReason}</dd></div>
      <div className={styles.wide}><dt>來源雜湊</dt>
        <dd className={styles.hash}>{item.sourceHash}</dd></div>
    </dl>
  </details>;
}

export function ProfessionalServiceSummaryWorkspace({
  canExport,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canExport: boolean;
  filters: ProfessionalServiceSummaryFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: ProfessionalServiceSummarySnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>專業服務彙整暫時無法載入</h1>
      <p>正式快照採失敗即關閉；不會改用其他分支、未指派個案或展示資料補位。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  const exportReady = snapshot.demo || (canExport && hasRecentAal2);
  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>專業服務</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">單一資料庫快照・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          依月份彙整已授權個案的專業評估、照會、會議、轉介與治療服務，並保留來源下鑽。
        </p>
      </div>
      <div className="page-heading__actions">
        {exportReady ? <a
          className="button button--secondary"
          href={exportHref(snapshot, filters)}
        ><Download aria-hidden="true" />匯出同一快照</a> : <button
          className="button button--secondary"
          disabled
          title={canExport ? "請先完成最近 15 分鐘內雙重驗證" : "目前角色沒有匯出權限"}
          type="button"
        ><Download aria-hidden="true" />{
          canExport ? "重新驗證後匯出" : "無匯出權限"
        }</button>}
      </div>
    </header>

    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>個案、日期、工作量與來源雜湊均為合成資料；可下載合成 CSV 驗證同快照口徑。</span>
    </div> : <div className={`callout ${styles.security}`} role="status">
      <ShieldCheck aria-hidden="true" />
      <span>只彙整目前機構、分支、頁面權限及指派個案；搜尋與匯出均留存不含姓名與篩選值的稽核證據。</span>
    </div>}
    <div className={`callout ${styles.coverage}`} role="note">
      <FileWarning aria-hidden="true" />
      <span><strong>口徑限制：</strong>「應完成」只計已有權威來源的工作單位，不推測尚未建立的評估或服務。咀嚼正式規則、MNA 電子化授權及治療服務頻率未設定時，會明文標示，不會當成 0 或已完成。</span>
    </div>

    <section aria-label="專業服務工作量摘要" className="metric-grid">
      {[
        ["應完成", snapshot.metrics.expected, "工作單位", "只計已有權威來源", <ListChecks aria-hidden="true" key="expected" />],
        ["已完成", snapshot.metrics.completed, "工作單位", "簽署、回覆或結案", <CheckCircle2 aria-hidden="true" key="done" />],
        ["待完成", snapshot.metrics.pending, "工作單位", "草稿或流程待辦", <Clock3 aria-hidden="true" key="pending" />],
        ["逾期", snapshot.metrics.overdue, "工作單位", "依明示期限判定", <FileWarning aria-hidden="true" key="late" />],
      ].map(([label, value, unit, foot, icon]) =>
        <article className="metric-card" key={String(label)}>
          <div className="metric-card__top">
            <span>{label}</span><span className="metric-card__icon">{icon}</span>
          </div>
          <div className="metric-card__value">
            <strong>{value}</strong><span>{unit}</span>
          </div>
          <p className="metric-card__foot">{foot}</p>
        </article>)}
    </section>

    <section className="panel">
      <div className="panel__header">
        <div className="panel__title">
          <h2>{snapshot.month} 專業服務明細</h2>
          <p>
            {snapshot.matchingTotal} 個彙整項目・{snapshot.metrics.serviceRecords} 筆既有治療服務・
            快照 {formatTimestamp(snapshot.generatedAt)}
          </p>
        </div>
      </div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact">
          <span>年月</span>
          <input defaultValue={filters.month} max="2200-12" min="2000-01"
            name="month" required type="month" />
        </label>
        <label className="field field--compact">
          <span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部已授權個案</option>
            {snapshot.clientOptions.map((client) =>
              <option key={client.clientId} value={client.clientId}>
                {client.displayName}
              </option>)}
          </select>
        </label>
        <label className="field field--compact">
          <span>專業／流程</span>
          <select defaultValue={filters.professionalKind} name="professional">
            <option value="all">全部</option>
            <option value="occupational_therapy">職能治療</option>
            <option value="physical_therapy">物理治療</option>
            <option value="chewing">咀嚼能力</option>
            <option value="nutrition">營養</option>
            <option value="consultation">跨專業照會</option>
            <option value="case_conference">個案研討</option>
            <option value="referral">轉介</option>
          </select>
        </label>
        <label className="field field--compact">
          <span>狀態</span>
          <select defaultValue={filters.status} name="status">
            <option value="all">全部</option>
            <option value="completed">已完成</option>
            <option value="pending">待完成</option>
            <option value="overdue">逾期</option>
            <option value="not_configured">規則未設定</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href={`?month=${filters.month}`}>
          清除其他條件
        </Link>
      </form>
      {snapshot.itemsTruncated ? <div
        className={`callout ${styles.truncated}`}
        role="status"
      ><CircleAlert aria-hidden="true" /><span>
        符合項目超過 300 筆；四項指標與 CSV 總數仍取自同一完整集合，但畫面與 CSV 明細均只列本快照前 300 筆。請縮小篩選後重新建立快照以逐筆核對全部來源。
      </span></div> : null}

      {snapshot.items.length ? <>
        <div aria-label="專業服務彙整表，可左右捲動"
          className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table">
            <thead><tr>
              {["個案", "專業／來源", "狀態", "服務次數", "最近日期／期限", "來源"].map(
                (heading) => <th key={heading} scope="col">{heading}</th>,
              )}
            </tr></thead>
            <tbody>{snapshot.items.map((item) => <tr key={item.itemId}>
              <td><span className="data-table__primary">
                <span className="avatar" aria-hidden="true">
                  {item.clientDisplayName.slice(0, 1)}
                </span>
                <span>{item.clientDisplayName}<small className="data-table__secondary">
                  {serviceStatusText(item.serviceStatus)}
                </small></span>
              </span></td>
              <td><div className={styles.stack}>
                <strong>{item.professionalLabel}</strong>
                <span>頁面 {item.sourcePage}・{item.sourcePageTitle}</span>
              </div></td>
              <td><div className={styles.stack}>
                <StatusPill status={statusText(item)} />
                <span>{item.statusReason}</span>
              </div></td>
              <td>{item.serviceCount > 0 ? `${item.serviceCount} 筆` : "不適用"}</td>
              <td><div className={styles.stack}>
                <span>最近：{formatDate(item.latestOn)}</span>
                <span>期限：{formatDate(item.nextDueOn)}</span>
              </div></td>
              <td><div className={styles.sourceActions}>
                <Link className="button button--quiet" href={item.sourceHref}>
                  查看來源<ExternalLink aria-hidden="true" />
                </Link>
                <ItemDetails item={item} />
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records core-care-mobile">
          {snapshot.items.map((item) => <article
            className={`record-card ${styles.card}`}
            key={item.itemId}
          >
            <div className="record-card__top">
              <div><h3>{item.clientDisplayName}</h3>
                <span className="data-table__secondary">
                  {item.professionalLabel}・頁面 {item.sourcePage}
                </span></div>
              <StatusPill status={statusText(item)} />
            </div>
            <p>{item.statusReason}</p>
            <dl>
              <div><dt>來源</dt><dd>{item.sourcePageTitle}</dd></div>
              <div><dt>服務次數</dt><dd>{
                item.serviceCount > 0 ? `${item.serviceCount} 筆` : "不適用"
              }</dd></div>
              <div><dt>最近日期</dt><dd>{formatDate(item.latestOn)}</dd></div>
              <div><dt>下次期限</dt><dd>{formatDate(item.nextDueOn)}</dd></div>
            </dl>
            <ItemDetails item={item} />
            <Link className={`button button--quiet ${styles.mobileSource}`}
              href={item.sourceHref}>
              查看來源<ExternalLink aria-hidden="true" />
            </Link>
          </article>)}
        </div>
      </> : <div className="panel__body">
        <section className="empty-card core-care-state">
          <CalendarDays aria-hidden="true" />
          <h2>這組條件沒有可彙整的權威來源</h2>
          <p>這不代表工作已完成；尚未設定的排程或正式工具不會被推測為零。</p>
          <Link className="button button--secondary"
            href={`?month=${filters.month}`}>清除其他條件</Link>
        </section>
      </div>}
    </section>

    <section className={`panel ${styles.sources}`}>
      <div className="panel__header"><div className="panel__title">
        <h2>來源與規則涵蓋</h2>
        <p>{snapshot.configuredSourceCount} 個已接線來源・{
          snapshot.notConfiguredSourceCount
        } 個治理缺口</p>
      </div></div>
      <div className={styles.sourceGrid}>
        {snapshot.sourceConfiguration.map((source) => <article
          key={source.sourceKind}
        >
          <div><strong>頁面 {source.sourcePage}</strong>
            <StatusPill status={
              source.dataStatus === "configured" ? "已接線" : "未設定"
          } /></div>
          <p>{dataStatusText(source)}</p>
          <small>完成口徑：{expectationStatusText(source)}</small>
        </article>)}
      </div>
    </section>
  </>;
}
