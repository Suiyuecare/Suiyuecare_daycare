import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileClock,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ClientToccResultFilter,
  ClientToccResultStatus,
  ClientToccSnapshot,
  ClientToccOption,
  ClientToccValidityFilter,
} from "@/lib/client-tocc/types";

import {
  ClientToccComposer,
} from "./client-tocc-composer";
import styles from "./client-tocc.module.css";

const resultLabels: Record<ClientToccResultStatus, string> = {
  clear: "無需追蹤",
  monitor: "持續觀察",
  action_required: "需處置",
};
const evidenceLabels = {
  not_required: "不需證明",
  pending: "證明待確認",
  verified: "證明已確認",
  rejected: "證明不採認",
} as const;
const actionLabels = {
  none_required: "無需處置",
  pending: "待處置",
  in_progress: "處置中",
  completed: "已完成",
  referred: "已轉介",
} as const;

function formatDate(value: string | null) {
  if (!value) return "—";
  return value.replace(/^(\d{4})-(\d{2})-(\d{2})$/u, "$1/$2/$3");
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

function validityLabel(value: "current" | "expired" | null) {
  if (value === "current") return "有效";
  if (value === "expired") return "已逾期";
  return "無紀錄";
}

export function ClientToccWorkspace({
  page,
  snapshot,
  allClients,
  query,
  validity,
  result,
  canWrite,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: ClientToccSnapshot | null;
  allClients: readonly ClientToccOption[];
  query: string;
  validity: ClientToccValidityFilter;
  result: ClientToccResultFilter;
  canWrite: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning">
          <CircleAlert aria-hidden="true" />
        </span>
        <h1>個案 TOCC 暫時無法載入</h1>
        <p>系統不會改查其他分支、未指派個案、直接資料表或展示資料；請確認權限後重新載入。</p>
        <a className="button button--secondary" href="?validity=all&result=all">重新載入</a>
      </section>
    );
  }

  const hasFilters = Boolean(query || validity !== "all" || result !== "all");
  const generatedAt = formatTimestamp(snapshot.generatedAt);

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>日常照顧</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>

      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">版本化 TOCC 流程・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            單筆與批次使用同一套欄位、個案範圍與效期規則；每次送出只新增不可變版本，不覆寫既有紀錄。
          </p>
        </div>
        <ClientToccComposer
          clients={allClients}
          demo={snapshot.demo}
          enabled={!snapshot.demo && canWrite && hasRecentAal2}
          today={snapshot.todayTaipei}
        />
      </header>

      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span><strong>展示模式：</strong>以下全是合成資料。單筆與批次按鈕保持停用，API 也會拒絕寫入，不會產生任何持久資料。</span>
        </div>
      ) : (
        <div className={`callout ${styles.securityCallout}`}>
          <ShieldCheck aria-hidden="true" />
          <span>姓名只由已稽核且符合目前指派範圍的個案快照帶入；TOCC 只由專用最小快照讀取。任一來源、效期公式或回傳格式不符時，整頁失敗即關閉。快照更新時間 {generatedAt}。</span>
        </div>
      )}

      {!snapshot.demo && canWrite && !hasRecentAal2 ? (
        <div className={`callout ${styles.reauthCallout}`} role="status">
          <ShieldCheck aria-hidden="true" />
          <span>可安全檢視；單筆與批次簽署需要最近 15 分鐘內完成 AAL2 重新驗證。</span>
          <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link>
        </div>
      ) : null}

      <section aria-label="TOCC 規則說明" className={styles.ruleGrid}>
        <article>
          <CalendarClock aria-hidden="true" />
          <div><strong>一個台北日曆月</strong><span>同日推進至下個月；若下個月沒有該日期，就取月底，截止日當天仍有效。</span></div>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <div><strong>人工結果，不自動診斷</strong><span>結果、症狀、風險與處置均由授權人員確認；系統只做技術驗證與到期提示。</span></div>
        </article>
      </section>

      <section aria-label="個案 TOCC 摘要" className="metric-grid">
        {[
          ["有效紀錄", snapshot.counts.current, "人", "截止日含當日", <CheckCircle2 aria-hidden="true" key="current" />],
          ["7 日內到期", snapshot.counts.expiringSoon, "人", "依台北日期計算", <Clock3 aria-hidden="true" key="soon" />],
          ["已逾期", snapshot.counts.expired, "人", `另有 ${snapshot.counts.noRecord} 人無紀錄`, <FileClock aria-hidden="true" key="expired" />],
          ["需處置", snapshot.counts.actionRequired, "人", "由人員選擇的最新結果", <TriangleAlert aria-hidden="true" key="action" />],
        ].map(([label, value, unit, foot, icon]) => (
          <article className="metric-card" key={String(label)}>
            <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
            <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
            <p className="metric-card__foot">{foot}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>最新 TOCC 版本</h2>
            <p>{snapshot.clients.length} 位符合條件・{snapshot.counts.noRecord} 位尚無紀錄・規則 calendar-month-asia-taipei-v1</p>
          </div>
        </div>
        <form className="filter-bar" method="get">
          <label className="filter-search">
            <Search aria-hidden="true" />
            <span className="sr-only">搜尋個案代碼或姓名</span>
            <input defaultValue={query} maxLength={120} name="q" placeholder="搜尋個案代碼或姓名…" type="search" />
          </label>
          <label className="field field--compact">
            <span>有效狀態</span>
            <select defaultValue={validity} name="validity">
              <option value="all">全部狀態</option>
              <option value="current">有效</option>
              <option value="expired">已逾期</option>
              <option value="no_record">無紀錄</option>
            </select>
          </label>
          <label className="field field--compact">
            <span>結果</span>
            <select defaultValue={result} name="result">
              <option value="all">全部結果</option>
              {Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? <Link className="button button--quiet" href="?validity=all&result=all">清除</Link> : null}
        </form>

        {snapshot.clients.length ? (
          <>
            <div aria-label="個案 TOCC 表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
              <table className="data-table">
                <thead><tr>{["個案", "填報日／有效至", "結果與摘要", "證明／處置", "版本／效期規則", "來源／簽署時間"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>
                  {snapshot.clients.map((client) => {
                    const assessment = client.latestAssessment;
                    return (
                      <tr key={client.clientId}>
                        <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{client.displayName.slice(0, 1)}</span><span>{client.displayName}<small className="data-table__secondary">{client.clientCode}</small></span></span></td>
                        <td><span className={styles.validity}><StatusPill status={validityLabel(assessment?.validityStatus ?? null)} /><small>填報 {formatDate(assessment?.assessmentDate ?? null)}<br />有效至 {formatDate(assessment?.validThrough ?? null)}（含）</small></span></td>
                        <td className={styles.summaryCell}>{assessment ? <><strong>{resultLabels[assessment.resultStatus]}</strong><small>{assessment.symptomSummary ?? assessment.riskSummary ?? "未填摘要"}</small></> : "—"}</td>
                        <td>{assessment ? <><StatusPill status={evidenceLabels[assessment.evidenceStatus]} /><small className="data-table__secondary">{actionLabels[assessment.actionStatus]}</small></> : "—"}</td>
                        <td>{assessment ? <>v{assessment.assessmentVersion}<small className="data-table__secondary">{assessment.validityRuleVersion}</small></> : "—"}</td>
                        <td>{assessment ? <>人員簽署<small className="data-table__secondary">{formatTimestamp(assessment.signedAt)}</small></> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-records core-care-mobile">
              {snapshot.clients.map((client) => {
                const assessment = client.latestAssessment;
                return (
                  <article className="record-card" key={client.clientId}>
                    <div className="record-card__top"><div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode}</span></div><StatusPill status={validityLabel(assessment?.validityStatus ?? null)} /></div>
                    <dl className="core-care-card-grid">
                      <div><dt>填報日</dt><dd>{formatDate(assessment?.assessmentDate ?? null)}</dd></div>
                      <div><dt>有效至（含）</dt><dd>{formatDate(assessment?.validThrough ?? null)}</dd></div>
                      <div><dt>結果</dt><dd>{assessment ? resultLabels[assessment.resultStatus] : "—"}</dd></div>
                      <div><dt>處置</dt><dd>{assessment ? actionLabels[assessment.actionStatus] : "—"}</dd></div>
                      <div className={styles.cardWide}><dt>版本與規則</dt><dd>{assessment ? `v${assessment.assessmentVersion}・${assessment.validityRuleVersion}` : "—"}</dd></div>
                      <div className={styles.cardWide}><dt>摘要</dt><dd>{assessment?.symptomSummary ?? assessment?.riskSummary ?? "未填摘要"}</dd></div>
                      <div className={styles.cardWide}><dt>來源與簽署時間</dt><dd>{assessment ? `人員簽署・${formatTimestamp(assessment.signedAt)}` : "—"}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="panel__body">
            <section className="empty-card core-care-state">
              <Search aria-hidden="true" /><h2>沒有符合條件的 TOCC 個案</h2>
              <p>請調整姓名、代碼、有效狀態或結果；系統不會擴大到其他分支或未指派個案。</p>
              <Link className="button button--secondary" href="?validity=all&result=all">清除篩選</Link>
            </section>
          </div>
        )}
      </section>
    </>
  );
}
