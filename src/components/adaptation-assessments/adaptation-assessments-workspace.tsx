import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  ClockAlert,
  FilePenLine,
  Search,
  ShieldCheck,
  UserRoundSearch,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type {
  AdaptationAssessmentFilters,
  AdaptationAssessmentListItem,
  AdaptationAssessmentSnapshot,
} from "@/lib/adaptation-assessments/types";
import type { PageCatalogEntry } from "@/lib/catalog";

import {
  AdaptationAssessmentActions,
  AdaptationAssessmentFreshness,
} from "./adaptation-assessment-actions";
import styles from "./adaptation-assessments.module.css";

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function serviceStatusText(value: AdaptationAssessmentListItem["serviceStatus"]) {
  return {
    active: "服務中",
    suspended: "暫停服務",
    transferred: "已轉出",
    closed: "已結案",
    deceased: "死亡結案",
  }[value];
}

function assessmentStateText(item: AdaptationAssessmentListItem) {
  if (item.recordState === null) return "尚未評估";
  if (item.recordState === "draft") return "草稿待簽";
  if (item.recordState === "corrected") return "已簽更正版";
  return "已簽署";
}

function adaptationStatusText(item: AdaptationAssessmentListItem) {
  if (item.adaptationStatus === "settled") return "人工判定：已適應";
  if (item.adaptationStatus === "adjusting") return "人工判定：適應中";
  if (item.adaptationStatus === "support_requested") return "人工判定：需要支持";
  return "尚無人工狀態";
}

function followUpText(item: AdaptationAssessmentListItem) {
  if (item.followUpOverdue) return "追蹤逾期";
  if (item.currentFollowUpStatus === "pending") return "待追蹤";
  if (item.currentFollowUpStatus === "completed") return "追蹤完成";
  if (item.currentFollowUpStatus === "cancelled") return "追蹤取消";
  if (item.currentFollowUpStatus === "not_started") return "需追蹤・尚未建立";
  if (item.currentFollowUpStatus === "not_required") return "不需追蹤";
  return "待建立評估";
}

function AssessmentHistory({ item }: { item: AdaptationAssessmentListItem }) {
  if (item.versionHistoryTotal + item.followUpHistoryTotal === 0) return null;
  return <details className={styles.history}>
    <summary>版本與追蹤歷程（{item.versionHistoryTotal + item.followUpHistoryTotal} 筆）</summary>
    {item.versionHistoryTruncated || item.followUpHistoryTruncated ? <p role="status">
      歷程超過單鏈 50 筆，畫面顯示最早 50 筆；正式鏈仍完整保留。
    </p> : null}
    <ol>
      {item.versionHistory.map((version) => <li key={version.versionId}>
        <strong>評估 v{version.assessmentVersion}・{
          version.recordState === "draft" ? "草稿" :
            version.recordState === "signed" ? "簽署" : "更正"
        }</strong>
        <span>{formatTimestamp(version.createdAt)}・{version.assessorDisplayName}</span>
        <p>{version.assessmentSummary}</p>
        <p>人工適應狀態：{adaptationStatusText({
          ...item, adaptationStatus: version.adaptationStatus,
        })}</p>
        <p>人工複評期限：{formatDate(version.reassessmentDueOn)}</p>
        {version.correctionReason ? <p><strong>更正理由：</strong>{version.correctionReason}</p> : null}
      </li>)}
      {item.followUpHistory.map((event) => <li key={event.eventId}>
        <strong>追蹤 #{event.sequence}・{
          event.status === "pending" ? "待追蹤" :
            event.status === "completed" ? "完成" : "取消"
        }</strong>
        <span>{formatTimestamp(event.committedAt)}・{event.committerDisplayName}</span>
        <p>{event.plan ?? event.outcome ?? event.transitionReason}</p>
        {event.dueOn ? <p>期限：{formatDate(event.dueOn)}</p> : null}
      </li>)}
    </ol>
  </details>;
}

export function AdaptationAssessmentsWorkspace({
  canManage,
  canSign,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  filters: AdaptationAssessmentFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: AdaptationAssessmentSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
      <h1>適應評估暫時無法載入</h1>
      <p>正式快照採失敗即關閉；系統沒有擴大機構、分支或個案指派範圍，也沒有改用展示資料。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>社工服務</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">指派個案清單・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          每位個案顯示最近一份人工評估、目前服務狀態、人工輸入複評期限與追蹤狀態；從該列快速新增會鎖定精確個案。
        </p>
      </div>
    </header>

    <div className={`callout ${styles.manual}`} role="note">
      <UserRoundSearch aria-hidden="true" /><span><strong>第一版是人工、非標準化評估：</strong>只保存人工摘要與人工適應狀態，使用 <code>manual-adaptation-v1</code> 技術參照；不宣稱官方或機構量表，不計分、不套公式、不自動診斷。</span>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>個案、評估者與內容皆為合成示例；所有正式寫入按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" /><span>只載入目前機構、分支及被指派個案。簽署與更正需最近 15 分鐘 AAL2；已簽評估只能追加帶理由且連回原版的更正版。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardList aria-hidden="true" /><span><strong>離線正式同步尚未設定：</strong>本頁不會宣稱離線草稿已送達；網路中斷時請保留內容並用同一操作鍵重試。</span>
    </div>
    {!snapshot.demo && !canManage ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" /><span>目前角色只有查看權限；快速新增、修訂、簽署、更正與追蹤均由 API 及資料庫拒絕。</span>
    </div> : null}

    <section aria-label="適應評估摘要" className="metric-grid">
      {[
        ["已完成評估", snapshot.metrics.completed, "人", `另有 ${snapshot.metrics.drafts} 份草稿待簽`, <CheckCircle2 aria-hidden="true" key="complete" />],
        ["尚未評估", snapshot.metrics.notAssessed, "人", "每位個案只計一次", <FilePenLine aria-hidden="true" key="missing" />],
        ["複評到期", snapshot.metrics.reassessmentDue, "人", "依人工輸入期限與台北日期", <CalendarClock aria-hidden="true" key="due" />],
        ["需要追蹤", snapshot.metrics.needsFollowUp, "人", `待追蹤 ${snapshot.metrics.openFollowUp}・逾期 ${snapshot.metrics.overdueFollowUp}`, <ClockAlert aria-hidden="true" key="follow" />],
      ].map(([label, value, unit, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>個案適應評估清單</h2>
        <p>{snapshot.matchingTotal} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<AdaptationAssessmentFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client"><option value="">全部指派個案</option>{snapshot.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
        <label className="field field--compact"><span>目前服務狀態</span><select defaultValue={filters.serviceStatus ?? ""} name="service"><option value="">全部狀態</option><option value="active">服務中</option><option value="suspended">暫停服務</option><option value="transferred">已轉出</option><option value="closed">已結案</option><option value="deceased">死亡結案</option></select></label>
        <label className="field field--compact"><span>評估狀態</span><select defaultValue={filters.assessmentPresence} name="assessment"><option value="all">全部</option><option value="assessed">已有評估</option><option value="not_assessed">尚未評估</option></select></label>
        <label className="field field--compact"><span>複評期限</span><select defaultValue={filters.reassessmentStatus} name="reassessment"><option value="all">全部</option><option value="due">今日以前到期</option><option value="upcoming">尚未到期</option></select></label>
        <label className="field field--compact"><span>人工適應狀態</span><select defaultValue={filters.adaptationStatus ?? ""} name="adaptation"><option value="">全部</option><option value="settled">已適應</option><option value="adjusting">適應中</option><option value="support_requested">需要支持</option></select></label>
        <label className="field field--compact"><span>追蹤狀態</span><select defaultValue={filters.followUpFilter} name="follow"><option value="all">全部</option><option value="needs_follow_up">需要追蹤</option><option value="no_follow_up">不需追蹤</option><option value="open">待追蹤</option><option value="overdue">追蹤逾期</option></select></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?">清除</Link>
      </form>
      {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" /><span>結果超過 200 位，畫面依個案名稱顯示前 200 位；摘要仍採相同完整快照。請縮小個案或狀態篩選。</span>
      </div> : null}
      {snapshot.clientOptionsTruncated || snapshot.assessorOptionsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" /><span>選項超過 200 筆，畫面只顯示前 200 筆；系統不會把未載入選項誤判為不存在。</span>
      </div> : null}

      {snapshot.items.length ? <>
        <div aria-label="適應評估清單，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table"><thead><tr>{["個案／服務狀態", "最近評估", "人工摘要", "複評期限", "追蹤狀態", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{snapshot.items.map((item) => <tr key={item.clientId}>
              <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{item.clientDisplayName.slice(0, 1)}</span><span>{item.clientDisplayName}<small className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</small></span></span></td>
              <td><div className={styles.statuses}><StatusPill status={assessmentStateText(item)} /><StatusPill status={adaptationStatusText(item)} />{item.assessedOn ? <small>{formatDate(item.assessedOn)}・v{item.assessmentVersion}</small> : null}</div></td>
              <td className={styles.narrative}>{item.assessmentSummary ?? "尚無人工評估摘要"}<AssessmentHistory item={item} /></td>
              <td><div className={styles.statuses}>{item.reassessmentDue ? <StatusPill status="複評到期" /> : null}<span>{formatDate(item.reassessmentDueOn)}</span>{item.formVersionReference ? <small>{item.formVersionReference}</small> : null}</div></td>
              <td><div className={styles.statuses}><StatusPill status={followUpText(item)} />{item.followUpDueOn ? <small>追蹤期限 {formatDate(item.followUpDueOn)}</small> : null}</div></td>
              <td><AdaptationAssessmentActions canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} /></td>
            </tr>)}</tbody></table>
        </div>
        <div className="mobile-records core-care-mobile">{snapshot.items.map((item) => <article className={`record-card ${styles.card}`} key={item.clientId}>
          <div className="record-card__top"><div><h3>{item.clientDisplayName}</h3><span className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</span></div><StatusPill status={assessmentStateText(item)} /></div>
          <dl><div><dt>人工適應狀態</dt><dd>{adaptationStatusText(item)}</dd></div><div><dt>最近評估日</dt><dd>{formatDate(item.assessedOn)}</dd></div><div><dt>人工評估摘要</dt><dd>{item.assessmentSummary ?? "尚無"}</dd></div><div><dt>人工複評期限</dt><dd>{formatDate(item.reassessmentDueOn)}{item.reassessmentDue ? "・已到期" : ""}</dd></div><div><dt>追蹤</dt><dd>{followUpText(item)}{item.followUpDueOn ? `・${formatDate(item.followUpDueOn)}` : ""}</dd></div></dl>
          <AssessmentHistory item={item} />
          <AdaptationAssessmentActions canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
        </article>)}</div>
      </> : <div className="panel__body"><section className="empty-card core-care-state">
        <Search aria-hidden="true" /><h2>沒有符合條件的指派個案</h2><p>請調整服務、評估、複評或追蹤條件；系統不會擴大到其他分支或未指派個案。</p><Link className="button button--secondary" href="?">清除篩選</Link>
      </section></div>}
    </section>
  </>;
}
