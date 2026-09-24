import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Clock3,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  OrganizationProfileFilters,
  OrganizationProfileProposal,
  OrganizationProfileSnapshot,
  OrganizationProfileVersion,
} from "@/lib/organization-profile/types";

import {
  OrganizationProfileDecisionForm,
  OrganizationProfileProposalForm,
} from "./organization-profile-actions";
import styles from "./organization-profile.module.css";
import { PilotConfigurationSummary } from "./pilot-configuration-summary";

const statusLabels = { pending: "待審", approved: "已核准", rejected: "已駁回" };

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function period(from: string, to: string | null) {
  return `${from} ～ ${to ?? "未設定迄日"}`;
}

function versionDetails(value: OrganizationProfileVersion) {
  return <dl className={styles.details}>
    <div><dt>發證單位</dt><dd>{value.permitIssuingAuthority}</dd></div>
    <div><dt>許可狀態</dt><dd>{value.permitStatusText}</dd></div>
    <div><dt>許可日期</dt><dd>{value.permitIssuedOn} ～ {value.permitValidThrough ?? "未設定迄日"}</dd></div>
    <div><dt>機構類型</dt><dd>{value.organizationTypeText}</dd></div>
    <div><dt>核定容量</dt><dd>{value.approvedCapacity} {value.capacityUnitText}</dd></div>
    <div><dt>聯絡窗口</dt><dd>{value.contactName} · {value.contactPhone}</dd></div>
    <div><dt>聯絡信箱</dt><dd>{value.contactEmail ?? "未提供"}</dd></div>
    <div><dt>聯絡地址</dt><dd>{value.contactAddress}</dd></div>
  </dl>;
}

function ContentLists({ value }: {
  value: OrganizationProfileVersion | OrganizationProfileProposal;
}) {
  return <div className={styles.contentLists}>
    <section><h4>服務項目</h4>{value.serviceItems.length === 0 ? <p>未列服務項目</p> :
      <ul>{value.serviceItems.map((item) => <li key={item.serviceKey}>
        <strong>{item.name}</strong>{item.description ? `：${item.description}` : ""}
      </li>)}</ul>}</section>
    <section><h4>費率</h4>{value.rateItems.length === 0 ? <p>未列費率</p> :
      <ul>{value.rateItems.map((item) => <li key={item.rateKey}>
        <strong>{item.label}</strong>：{item.amountDecimalText} {item.currencyCode}
        <small>{period(item.effectiveFrom, item.effectiveTo)}</small>
      </li>)}</ul>}</section>
  </div>;
}

export function OrganizationProfileWorkspace({
  canApprove, canManage, currentUserId, filters, hasRecentAal2,
  loadError, page, snapshot, openingReadiness,
}: {
  canApprove: boolean;
  canManage: boolean;
  currentUserId: string;
  filters: OrganizationProfileFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: OrganizationProfileSnapshot | null;
  openingReadiness?: ReactNode;
}) {
  if (loadError || !snapshot) return <>{openingReadiness}<section className="empty-card"
    aria-labelledby="organization-profile-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗、無權限或篩選有誤</p>
    <h1 id="organization-profile-load-error">無法取得機構資料快照</h1>
    <p>系統不會顯示未完成機構、分支與頁面權限核對的局部資料。請確認網路、登入保證等級與資料範圍後重試。</p>
    <Link className="button button--secondary"
      href="/app/staff/operations/organization">重新載入</Link>
  </section></>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>{page.description} 每次異動先凍結提案，再由不同授權人員核准或駁回。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>超過 5 分鐘請重新載入後再審核</span>
    </div></header>

    {openingReadiness}
    <PilotConfigurationSummary demo={snapshot.demo} />
    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下均為合成機構、許可、費率與聯絡資料，只能檢視，不會送出或生效。
    </div> : null}
    <div className={styles.warning} role="alert">
      正式許可、機構類型、服務與費率代碼表尚未發布（未設定）。目前只保存人工未標準化文字，不會推論法規狀態、官方服務代碼或正確費率。
    </div>
    <div className={styles.notice} role="note">
      許可到期提醒天數、正式附件／掃毒、匯出、離線與主管機關同步皆未設定或停用。畫面只計算已明確過期的許可；不會宣稱已完成即將到期提醒。
    </div>

    <section className={styles.metrics} aria-label="機構資料統計">
      <article><BadgeCheck aria-hidden="true" /><span>今日有效版本</span>
        <strong>{snapshot.activeVersionTotal}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>待審異動</span>
        <strong>{snapshot.pendingProposalTotal}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>已明確過期許可</span>
        <strong>{snapshot.expiredPermitTotal}</strong></article>
      <article><UsersRound aria-hidden="true" /><span>目前核定容量</span>
        <strong>{snapshot.activeCapacity ?? "無有效版本"}</strong></article>
    </section>

    <OrganizationProfileProposalForm canManage={canManage && !snapshot.demo}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
    <OrganizationProfileDecisionForm canApprove={canApprove && !snapshot.demo}
      currentUserId={currentUserId} hasRecentAal2={hasRecentAal2}
      snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選機構資料">
      <label><span>提案狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部提案</option><option value="pending">待審</option>
        <option value="approved">已核准</option><option value="rejected">已駁回</option>
      </select></label>
      <label><span>指定生效日</span><input name="effectiveOn" type="date"
        defaultValue={filters.effectiveOn ?? ""} /></label>
      <label><span>搜尋</span><input name="q" maxLength={120}
        defaultValue={filters.query} placeholder="許可、類型、服務或聯絡資料" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/operations/organization">清除</Link>
    </form>

    <section className={styles.records} aria-labelledby="effective-versions-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">不可變終端投影</p>
        <h2 id="effective-versions-heading">生效版本</h2></div>
        <p>顯示 {snapshot.visibleVersions.length} / {snapshot.versionTotal} 個邏輯期間。</p></div>
      {snapshot.versionsTruncated ? <p role="status">版本清單上限 100 筆，請縮小查詢條件。</p> : null}
      {snapshot.visibleVersions.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><Building2 aria-hidden="true" /></span>
        <h3>沒有符合條件的生效版本</h3><p>可清除指定生效日或搜尋條件；待審提案不會出現在生效版本。</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的機構資料版本表格">
          <table className={styles.table}><thead><tr><th>許可／版本</th><th>生效期間</th>
            <th>類型／服務</th><th>容量</th><th>聯絡</th><th>核准</th></tr></thead>
          <tbody>{snapshot.visibleVersions.map((version) => <tr key={version.versionId}>
            <td><strong>{version.permitNumber}</strong><br /><small>v{version.version}</small></td>
            <td>{period(version.effectiveFrom, version.effectiveTo)}</td>
            <td>{version.organizationTypeText}<br /><small>{version.serviceItems.length} 個人工服務項目</small></td>
            <td>{version.approvedCapacity} {version.capacityUnitText}</td>
            <td>{version.contactName}<br /><small>{version.contactPhone}</small></td>
            <td>{version.approvedByDisplayName}<br /><small>{formatTaipei(version.approvedAt)}</small></td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.desktopDetails} role="group"
          aria-label="桌機版生效版本完整內容">
          {snapshot.visibleVersions.map((version) => <details key={version.versionId}>
            <summary>核對 {version.permitNumber} · v{version.version} 的完整服務、費率與聯絡資料</summary>
            {versionDetails(version)}<ContentLists value={version} />
            <p><strong>容量核定依據：</strong>{version.capacityBasisText}</p>
            <p><strong>異動理由：</strong>{version.changeReason}</p>
          </details>)}
        </div>
        <div className={styles.mobileCards}>{snapshot.visibleVersions.map((version) =>
          <article key={version.versionId}><h3>{version.permitNumber} · v{version.version}</h3>
            <p className={styles.status}>生效期間：{period(version.effectiveFrom, version.effectiveTo)}</p>
            {versionDetails(version)}<ContentLists value={version} />
            <p><strong>異動理由：</strong>{version.changeReason}</p>
            <small>由 {version.approvedByDisplayName} 於 {formatTaipei(version.approvedAt)} 獨立核准</small>
          </article>)}</div>
      </>}
    </section>

    <section className={styles.records} aria-labelledby="proposals-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">提案與決議</p>
        <h2 id="proposals-heading">異動提案</h2></div>
        <p>顯示 {snapshot.visibleProposals.length} / {snapshot.proposalTotal} 筆。</p></div>
      {snapshot.proposalsTruncated ? <p role="status">提案清單上限 100 筆。</p> : null}
      {snapshot.visibleProposals.length === 0 ? <p>沒有符合狀態或搜尋條件的提案。</p> :
        <div className={styles.proposalGrid}>{snapshot.visibleProposals.map((proposal) =>
          <article key={proposal.proposalId}>
            <div className={styles.cardHeading}><div><p className="eyebrow">提案 #{proposal.proposalNumber}</p>
              <h3>{proposal.permitNumber}</h3></div>
              <span className={`${styles.pill} ${styles[`pill_${proposal.status}`]}`}>
                {statusLabels[proposal.status]}</span></div>
            <p>{proposal.action === "create" ? "新增生效期間" :
              `更正基準 v${proposal.expectedBaseVersion}`} · {period(proposal.effectiveFrom, proposal.effectiveTo)}</p>
            <dl className={styles.details}><div><dt>提案人</dt>
              <dd>{proposal.proposedByDisplayName}</dd></div>
              <div><dt>提案時間</dt><dd>{formatTaipei(proposal.proposedAt)}</dd></div>
              <div><dt>類型</dt><dd>{proposal.organizationTypeText}</dd></div>
              <div><dt>容量</dt><dd>{proposal.approvedCapacity} {proposal.capacityUnitText}</dd></div>
              <div><dt>異動理由</dt><dd>{proposal.changeReason}</dd></div>
              <div><dt>決議</dt><dd>{proposal.decisionReason ?? "尚未決議"}</dd></div></dl>
            <ContentLists value={proposal} />
            {proposal.decidedByDisplayName && proposal.decidedAt ? <small>
              由 {proposal.decidedByDisplayName} 於 {formatTaipei(proposal.decidedAt)}
              {proposal.status === "approved" ? "核准" : "駁回"}
            </small> : <small>待另一位具完整欄位權限的人員審核</small>}
          </article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="profile-history-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">不可覆寫</p>
        <h2 id="profile-history-heading">完整版本歷程</h2></div>
        <p>{snapshot.history.length} / {snapshot.historyTotal} 個版本</p></div>
      {snapshot.historyTruncated ? <p role="status">歷程上限 300 筆。</p> : null}
      {snapshot.history.length === 0 ? <p>尚無已核准版本。</p> :
        <ol className={styles.historyList}>{snapshot.history.map((history) => <li
          key={history.versionId}><div><strong>v{history.version}</strong>
            <span>{period(history.effectiveFrom, history.effectiveTo)}</span></div>
          <p>{history.changeReason}</p><small>{history.approvedByDisplayName} · {formatTaipei(history.approvedAt)} · 雜湊 {history.contentHash.slice(0, 12)}…</small>
        </li>)}</ol>}
    </section>
  </div>;
}
