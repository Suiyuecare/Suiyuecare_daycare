import {
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  MessageSquareText,
  Paperclip,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ConsultantMessageFilters,
  ConsultantMessageItem,
  ConsultantMessageSnapshot,
} from "@/lib/consultant-messages/types";

import {
  ConsultantMessageCreateAction,
  ConsultantMessageReceiptAction,
} from "./consultant-message-actions";
import styles from "./consultant-messages.module.css";

function formatTime(value: string | null) {
  if (!value) return "尚未留下回條";
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

function receiptLabel(item: ConsultantMessageItem) {
  if (item.confirmedCount === item.recipientCount) return "全部已確認";
  if (item.readCount === item.recipientCount) return "全部已讀，仍待確認";
  return `未讀 ${item.recipientCount - item.readCount} 人`;
}

function ReceiptActions({
  canReceive,
  demo,
  item,
}: {
  canReceive: boolean;
  demo: boolean;
  item: ConsultantMessageItem;
}) {
  if (!item.actorIsRecipient) return <span className="data-table__secondary">管理檢視不代替收件人回條</span>;
  return (
    <div className={styles.receiptActions}>
      <ConsultantMessageReceiptAction
        action="read"
        canReceive={canReceive}
        demo={demo}
        message={item}
      />
      <ConsultantMessageReceiptAction
        action="confirm"
        canReceive={canReceive}
        demo={demo}
        message={item}
      />
    </div>
  );
}

export function ConsultantMessagesWorkspace({
  canReceive,
  filters,
  loadError = false,
  page,
  snapshot,
}: {
  canReceive: boolean;
  filters: ConsultantMessageFilters;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: ConsultantMessageSnapshot | null;
}) {
  if (loadError || !snapshot) return (
    <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>顧問訊息暫時無法載入</h1>
      <p>系統不會改查一般訊息、其他分支、直接資料表或展示資料；請確認權限後重試。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>
  );
  const hasFilters = Boolean(
    filters.query || filters.consultantUserId || filters.dateFrom ||
    filters.dateTo || filters.status !== "all",
  );
  const loadedLabel = snapshot.itemsTruncated
    ? `顯示最近 ${snapshot.items.length}／符合 ${snapshot.metrics.messages} 則`
    : `顯示 ${snapshot.items.length}／符合 ${snapshot.metrics.messages} 則`;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>機構營運管理</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">顧問專屬入口・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            只顯示「顧問訊息」類別的不可變內容，收件者、已讀與確認均保留獨立證據。
          </p>
        </div>
        <ConsultantMessageCreateAction
          canManage={snapshot.canManage}
          demo={snapshot.demo}
          recipients={snapshot.recipientOptions}
        />
      </header>

      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span><strong>展示模式：</strong>以下全為合成資料；建立、已讀與確認都會停用，不會假裝寫入成功。</span>
        </div>
      ) : (
        <div className={`callout ${styles.securityCallout}`}>
          <ShieldCheck aria-hidden="true" />
          <span>本頁由單一受稽核快照載入；每次檢視只記錄最小化範圍與數量，不記錄訊息內容。</span>
        </div>
      )}
      <div className={`callout ${styles.boundaryCallout}`}>
        <MessageSquareText aria-hidden="true" />
        <span><strong>傳遞邊界：</strong>目前僅是系統內訊息與實際回條，不代表 LINE、簡訊、Email、PWA 或任何外部送達。</span>
      </div>
      <div className={`callout ${styles.attachmentCallout}`} role="status">
        <Paperclip aria-hidden="true" />
        <span><strong>附件管線：未設定。</strong>在可信上傳、雜湊與掃毒流程完成前，UI 與 API 均拒絕附件，且不接受瀏覽器路徑或外部網址。</span>
      </div>

      <section aria-label="顧問訊息摘要" className={`metric-grid ${styles.metrics}`}>
        {[
          ["符合訊息", snapshot.metrics.messages, "則", <MessageSquareText aria-hidden="true" key="messages" />],
          ["實際未讀", snapshot.metrics.unread, "人次", <Eye aria-hidden="true" key="unread" />],
          ["今日訊息", snapshot.metrics.today, "則", <Clock3 aria-hidden="true" key="today" />],
          ["可信附件", snapshot.metrics.attachments, "份", <Paperclip aria-hidden="true" key="attachments" />],
          ["待確認", snapshot.metrics.pendingConfirmations, "人次", <CheckCheck aria-hidden="true" key="pending" />],
        ].map(([label, value, unit, icon]) => (
          <article className="metric-card" key={String(label)}>
            <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
            <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
            <p className="metric-card__foot">同一受權限限制快照</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>顧問訊息歷史</h2>
            <p>{loadedLabel}；更新 {formatTime(snapshot.generatedAt)}。</p>
          </div>
        </div>
        {snapshot.itemsTruncated ? (
          <div className={`callout ${styles.truncatedCallout}`} role="status">
            <CircleAlert aria-hidden="true" />
            <span>符合歷史超過 100 則；目前只顯示最近 100 則，完整總數仍由同一快照計算。</span>
          </div>
        ) : null}
        <form className={`filter-bar ${styles.filters}`} method="get">
          <label className="filter-search">
            <Search aria-hidden="true" />
            <span className="sr-only">搜尋顧問訊息</span>
            <input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋主旨、內容或作者…" type="search" />
          </label>
          <label className="field field--compact">
            <span>顧問</span>
            <select defaultValue={filters.consultantUserId ?? ""} disabled={!snapshot.canManage} name="consultant">
              <option value="">全部可查看顧問</option>
              {snapshot.recipientOptions.map((option) => (
                <option key={option.userId} value={option.userId}>{option.displayName}</option>
              ))}
            </select>
          </label>
          <label className="field field--compact"><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
          <label className="field field--compact"><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
          <label className="field field--compact">
            <span>回條狀態</span>
            <select defaultValue={filters.status} name="status">
              <option value="all">全部</option>
              <option value="unread">仍有未讀</option>
              <option value="read">全部已讀</option>
              <option value="confirmed">全部已確認</option>
              <option value="unconfirmed">仍待確認</option>
            </select>
          </label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? <Link className="button button--quiet" href="?">清除</Link> : null}
        </form>

        {snapshot.items.length ? (
          <>
            <div aria-label="顧問訊息表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
              <table className="data-table">
                <thead><tr>{["時間／作者", "主旨與內容", "顧問收件快照", "已讀／確認", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>{snapshot.items.map((item) => (
                  <tr key={item.messageId}>
                    <td><strong>{formatTime(item.occurredAt)}</strong><small className="data-table__secondary">發布：{formatTime(item.publishedAt)}</small><small className="data-table__secondary">作者：{item.authorDisplayName}</small></td>
                    <td className={styles.messageCell}><span className="status-pill">顧問類別</span><strong>{item.subject}</strong><p>{item.body}</p><small className="data-table__secondary">附件 {item.attachmentCount}（管線未設定）</small></td>
                    <td><strong>{item.recipientCount} 位</strong><ul className={styles.recipientList}>{item.recipients.map((recipient) => <li key={recipient.userId}>{recipient.displayName}<small>{recipient.roleNames.join("、")}</small></li>)}</ul></td>
                    <td><strong>{receiptLabel(item)}</strong><small className="data-table__secondary">已讀 {item.readCount}/{item.recipientCount}</small><small className="data-table__secondary">確認 {item.confirmedCount}/{item.recipientCount}</small></td>
                    <td><ReceiptActions canReceive={canReceive} demo={snapshot.demo} item={item} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <section aria-label="顧問訊息卡片" className={`mobile-records core-care-mobile ${styles.mobileCards}`}>
              {snapshot.items.map((item) => (
                <article className="record-card" key={item.messageId}>
                  <div className="record-card__top"><div><h3>{item.subject}</h3><span>{formatTime(item.occurredAt)}</span></div><span className="status-pill">顧問類別</span></div>
                  <p>{item.body}</p>
                  <dl>
                    <div><dt>作者</dt><dd>{item.authorDisplayName}</dd></div>
                    <div><dt>顧問</dt><dd>{item.recipients.map((recipient) => recipient.displayName).join("、")}</dd></div>
                    <div><dt>回條</dt><dd>{receiptLabel(item)}</dd></div>
                    <div><dt>附件</dt><dd>{item.attachmentCount}（未設定）</dd></div>
                  </dl>
                  <ReceiptActions canReceive={canReceive} demo={snapshot.demo} item={item} />
                </article>
              ))}
            </section>
          </>
        ) : (
          <div className="panel__body">
            <section className="empty-card">
              <Users aria-hidden="true" />
              <h2>沒有符合條件的顧問訊息</h2>
              <p>請調整顧問、日期或回條狀態；系統不會擴大到一般訊息或其他分支。</p>
              {hasFilters ? <Link className="button button--secondary" href="?">清除篩選</Link> : null}
            </section>
          </div>
        )}
      </section>
    </>
  );
}
