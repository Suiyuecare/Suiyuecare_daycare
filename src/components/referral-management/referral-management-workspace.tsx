import {
  AlertTriangle, CheckCircle2, ClipboardPenLine, Clock3, Inbox,
  Send, UserRoundSearch, UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ReferralManagementFilters,
  ReferralManagementItem,
  ReferralManagementSnapshot,
  ReferralReceivingUnitState,
  ReferralStatus,
} from "@/lib/referral-management/types";

import {
  ReferralCorrectionForm,
  ReferralCreateForm,
  ReferralTransitionForm,
} from "./referral-actions";
import styles from "./referral-management.module.css";

const statusLabel: Record<ReferralStatus, string> = {
  draft: "草稿",
  submitted: "已送出",
  received: "已人工收件",
  responded: "已回覆",
  closed: "已結案",
};
const unitStateLabel: Record<ReferralReceivingUnitState, string> = {
  manual_unstandardized: "人工輸入／未標準化",
  missing: "缺值",
  not_applicable: "不適用",
};
const eventLabel: Record<ReferralManagementItem["eventKind"], string> = {
  created: "建立草稿",
  submitted: "送出院內版本",
  receipt_registered: "人工登記收件",
  response_recorded: "登記回覆",
  closed: "結案",
  corrected: "狹義更正",
};

function formatTaipei(value: string) {
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

function Unit({ item }: { item: ReferralManagementItem }) {
  if (item.receivingUnitState !== "manual_unstandardized") {
    return <span className={styles.deadlineState}>{unitStateLabel[item.receivingUnitState]}</span>;
  }
  return <><strong>{item.receivingUnitName}</strong>
    <span>{item.receivingUnitCode} · manual_unstandardized</span></>;
}

function ActionPanel({ item, snapshot }: {
  item: ReferralManagementItem;
  snapshot: ReferralManagementSnapshot;
}) {
  if (snapshot.demo) return null;
  return <div className={styles.actions}>
    <ReferralTransitionForm item={item} snapshot={snapshot} />
    <ReferralCorrectionForm item={item} snapshot={snapshot} />
  </div>;
}

function History({ item }: { item: ReferralManagementItem }) {
  return <details className={styles.history}>
    <summary>不可變事件歷程（{item.history.length}）</summary>
    <ol>{item.history.map((entry) => <li key={entry.eventId}>
      <strong>#{entry.sequence} · {eventLabel[entry.eventKind]}</strong>
      <span>{formatTaipei(entry.occurredAt)} · {entry.actorDisplayName}</span>
      <span>狀態：{statusLabel[entry.status]} · 站內 queued × {entry.notificationRecipientCount}</span>
      {entry.entryContent ? <p>{entry.entryContent}</p> : null}
      {entry.correctionReason ? <p>更正理由：{entry.correctionReason}</p> : null}
      {entry.correctsEventId ? <span>更正來源：{entry.correctsEventId.slice(0, 8)}…</span> : null}
      <code>{entry.contentHash.slice(0, 12)}…</code>
    </li>)}</ol>
  </details>;
}

function MobileCard({ item, snapshot }: {
  item: ReferralManagementItem;
  snapshot: ReferralManagementSnapshot;
}) {
  return <article className={styles.card} data-referral-card={item.referralKey}>
    <header><div><p className="eyebrow">{item.clientCode} · #{item.sequence}</p>
      <h2>{item.clientDisplayName}</h2></div>
      <span className={styles.status}>{statusLabel[item.status]}</span></header>
    <p className={styles.summary}>{item.referralReason}</p>
    <dl>
      <div><dt>接收單位</dt><dd><Unit item={item} /></dd></div>
      <div><dt>負責人</dt><dd>{item.ownerDisplayName}</dd></div>
      <div><dt>轉介日期</dt><dd>{formatTaipei(item.referralDate)}</dd></div>
      <div><dt>最近事件</dt><dd>{formatTaipei(item.occurredAt)}</dd></div>
    </dl>
    <div className={styles.queueEvidence}>站內 <strong>queued</strong> × {item.notification.recipientCount}；外部送達 <strong>not_configured</strong></div>
    <ActionPanel item={item} snapshot={snapshot} />
    <History item={item} />
  </article>;
}

export function ReferralManagementWorkspace({
  filters, loadError, page, snapshot,
}: {
  filters: ReferralManagementFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: ReferralManagementSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="referral-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗、反向日期、逾時或無權限</p>
    <h1 id="referral-load-error">無法取得轉介管理快照</h1>
    <p>系統沒有顯示未通過機構、分支、個案指派與角色驗證的局部資料。</p>
    <Link className="button button--secondary"
      href="/app/staff/professional-care/referrals">重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 專業服務</p>
      <h1>{page.title}</h1>
      <p>{page.description} 所有狀態與更正只新增事件，不覆寫既有內容。</p>
    </div><div className={styles.snapshotMeta}>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>{snapshot.branchName}</span>
      <span>快照 {snapshot.snapshotToken.slice(0, 12)}…</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：全部為合成資料，草稿、送出、收件、回覆、結案與更正均唯讀。
    </div> : null}
    <div className={styles.notice} role="note">
      接收單位正式字典、附件掃毒、匯出、外部送達與通知 provider 均為 <strong>not_configured</strong>。
      「送出」只凍結院內版本；「人工登記收件」也不是 provider 回執，不宣稱外部 delivered、read 或 confirmed。
    </div>

    <section className={styles.metrics} aria-label="轉介統計">
      <article><UserRoundSearch aria-hidden="true" /><span>符合轉介</span><strong>{snapshot.metrics.matching}</strong></article>
      <article><ClipboardPenLine aria-hidden="true" /><span>草稿</span><strong>{snapshot.metrics.draft}</strong></article>
      <article><Send aria-hidden="true" /><span>已送出</span><strong>{snapshot.metrics.submitted}</strong></article>
      <article><Inbox aria-hidden="true" /><span>已人工收件</span><strong>{snapshot.metrics.received}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>已回覆</span><strong>{snapshot.metrics.responded}</strong></article>
      <article><CheckCircle2 aria-hidden="true" /><span>已結案</span><strong>{snapshot.metrics.closed}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>單位缺值／不適用</span>
        <strong>{snapshot.metrics.unitMissing}／{snapshot.metrics.unitNotApplicable}</strong></article>
    </section>

    <ReferralCreateForm canCreate={snapshot.canCreate && !snapshot.demo}
      branchId={snapshot.branchId} clients={snapshot.clientOptions}
      organizationId={snapshot.organizationId} referenceTime={snapshot.generatedAt} />

    <form className={styles.filters} method="get" aria-label="篩選轉介管理">
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}>
        <option value="all">全部個案</option>
        {snapshot.clientOptions.map((option) => <option key={option.clientId}
          value={option.clientId}>{option.displayName}</option>)}
      </select></label>
      <label><span>接收單位</span><select name="unit"
        defaultValue={filters.receivingUnitMode === "specific"
          ? filters.receivingUnitCode! : filters.receivingUnitMode}>
        <option value="all">全部</option>
        <option value="manual_unstandardized">全部人工單位</option>
        <option value="missing">缺值</option>
        <option value="not_applicable">不適用</option>
        {snapshot.receivingUnitOptions.map((option) => <option key={option.code}
          value={option.code}>{option.name} · {option.code}</option>)}
      </select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option>
        <option value="draft">草稿</option>
        <option value="submitted">已送出</option>
        <option value="received">已人工收件</option>
        <option value="responded">已回覆</option>
        <option value="closed">已結案</option>
      </select></label>
      <label><span>最近事件起日</span><input type="date" name="from"
        defaultValue={filters.recentFrom ?? ""} /></label>
      <label><span>最近事件迄日</span><input type="date" name="to"
        defaultValue={filters.recentTo ?? ""} /></label>
      <label className={styles.wide}><span>關鍵字</span><input name="q" maxLength={120}
        defaultValue={filters.query} placeholder="搜尋轉介原因" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/professional-care/referrals">清除</Link>
    </form>

    {snapshot.itemsTruncated ? <p className={styles.warning} role="status">
      明細只顯示前 200 筆；上方統計仍由完整結果集合計算。
    </p> : null}
    {snapshot.items.length === 0 ? <section className="empty-card">
      <span className="empty-card__icon"><UsersRound aria-hidden="true" /></span>
      <h2>沒有符合條件的轉介</h2>
      <p>可調整個案、接收單位、狀態、最近事件日期或關鍵字。</p>
    </section> : <>
      <div className={styles.tableWrap}><table>
        <caption>轉介管理不可變快照</caption>
        <thead><tr><th>個案／轉介日</th><th>接收單位</th><th>轉介原因</th>
          <th>負責人／最近事件</th><th>狀態</th><th>事件與站內佇列</th></tr></thead>
        <tbody>{snapshot.items.map((item) => <tr key={item.referralKey}
          data-referral-row={item.referralKey}>
          <td><strong>{item.clientDisplayName}</strong><span>{item.clientCode}</span>
            <span>{formatTaipei(item.referralDate)}</span></td>
          <td><Unit item={item} /></td>
          <td><p>{item.referralReason}</p></td>
          <td><span>{item.ownerDisplayName}</span><span>{formatTaipei(item.occurredAt)}</span></td>
          <td><span className={styles.status}>{statusLabel[item.status]}</span></td>
          <td><span>#{item.sequence} · {eventLabel[item.eventKind]}</span>
            <span>queued × {item.notification.recipientCount}</span>
            <details><summary>操作與歷程</summary>
              <ActionPanel item={item} snapshot={snapshot} /><History item={item} />
            </details></td>
        </tr>)}</tbody>
      </table></div>
      <div className={styles.cards}>{snapshot.items.map((item) =>
        <MobileCard key={item.referralKey} item={item} snapshot={snapshot} />)}</div>
    </>}
  </div>;
}
