import {
  ChevronRight,
  CircleAlert,
  Clock3,
  FileWarning,
  History,
  LockKeyhole,
  MessageSquareText,
  Search,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  CareCommunicationFilters,
  CareCommunicationItem,
  CareCommunicationSnapshot,
} from "@/lib/care-communications/types";

import {
  CareCommunicationCorrectionAction,
  CareCommunicationCreateAction,
} from "./care-communication-actions";
import styles from "./care-communications.module.css";

function formatTime(value: string | null) {
  if (!value) return "無";
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

function VersionLabel({ item }: { item: CareCommunicationItem }) {
  return (
    <div className={styles.versionLine}>
      <span className={item.current ? "status-pill status-pill--success" : "status-pill"}>
        v{item.version}・{item.current ? "目前版本" : "歷史版本"}
      </span>
      <span>{item.recordKind === "correction" ? "更正版" : "原始版"}</span>
    </div>
  );
}

function BoundaryStatus() {
  return (
    <div className={styles.boundaryStatus}>
      <strong>待送（未送達）</strong>
      <span>傳送 worker：未設定</span>
      <span>家屬端收件：未設定</span>
      <span>已讀回條：未設定</span>
      <span>家屬確認：未設定</span>
      <span>離線 consumer：未設定</span>
    </div>
  );
}

function RecipientSnapshot({ item }: { item: CareCommunicationItem }) {
  return (
    <ul className={styles.recipientList}>
      {item.recipients.map((recipient, index) => (
        <li key={`${item.versionId}-${recipient.consentDocumentVersion}-${index}`}>
          <strong>{recipient.displayName}</strong>
          <span>{recipient.relationship}・messages.read</span>
          <span>同意版本 {recipient.consentDocumentVersion}</span>
          <span>同意時間 {formatTime(recipient.consentedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function MobileCard({
  hasRecentAal2,
  item,
  snapshot,
}: {
  hasRecentAal2: boolean;
  item: CareCommunicationItem;
  snapshot: CareCommunicationSnapshot;
}) {
  return (
    <article className={styles.mobileCard}>
      <header>
        <div><VersionLabel item={item} /><h3>{item.subject}</h3></div>
        <span>{formatTime(item.occurredAt)}</span>
      </header>
      <p className={styles.messageBody}>{item.body}</p>
      <dl>
        <div><dt>個案</dt><dd>{item.clientDisplayName}<small>{item.clientCode}</small></dd></div>
        <div><dt>作者</dt><dd>{item.authorDisplayName}<small>送出 {formatTime(item.submittedAt)}</small></dd></div>
        <div><dt>收件快照</dt><dd><RecipientSnapshot item={item} /></dd></div>
        <div><dt>附件</dt><dd>無附件<small>掃毒管線未設定</small></dd></div>
        <div><dt>狀態</dt><dd><BoundaryStatus /></dd></div>
        {item.correctionReason ? <div><dt>更正理由</dt><dd>{item.correctionReason}</dd></div> : null}
      </dl>
      <CareCommunicationCorrectionAction
        canCorrect={snapshot.canCorrect}
        demo={snapshot.demo}
        hasRecentAal2={hasRecentAal2}
        item={item}
      />
    </article>
  );
}

export function CareCommunicationsWorkspace({
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  filters: CareCommunicationFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: CareCommunicationSnapshot | null;
}) {
  if (loadError || !snapshot) return (
    <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
      <h1>溝通紀錄暫時無法載入</h1>
      <p>系統不會改查顧問訊息、其他分支、未指派個案、直接資料表或展示資料；請確認權限後重試。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>
  );
  const hasFilters = Boolean(
    filters.query || filters.clientId || filters.authorUserId ||
    filters.dateFrom || filters.dateTo || filters.deliveryStatus !== "all" ||
    filters.confirmationStatus !== "all",
  );
  const loadedLabel = snapshot.itemsTruncated
    ? `顯示最近 ${snapshot.items.length}／符合 ${snapshot.metrics.matching} 個版本`
    : `顯示 ${snapshot.items.length}／符合 ${snapshot.metrics.matching} 個版本`;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>安心照顧與溝通</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">照顧溝通專屬入口・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            只顯示「照顧溝通」類別；作者、時間、家屬授權快照、待送證據與更正歷程均不可覆寫。
          </p>
        </div>
        <CareCommunicationCreateAction
          canManage={snapshot.canManage}
          clients={snapshot.clientOptions}
          demo={snapshot.demo}
          hasRecentAal2={hasRecentAal2}
        />
      </header>

      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span><strong>展示模式：</strong>以下都是合成資料且完全唯讀；不會寫入、傳送或建立回條。</span>
        </div>
      ) : (
        <div className={`callout ${styles.securityCallout}`}>
          <ShieldCheck aria-hidden="true" />
          <span>每次查閱使用單一受權限限制快照，稽核只保存範圍、數量與互動類型，不保存搜尋字或訊息敘事。</span>
        </div>
      )}
      <div className={`callout ${styles.consentCallout}`}>
        <UserRoundCheck aria-hidden="true" />
        <span><strong>家屬範圍：</strong>建立當下只凍結同一機構、分支、個案且具有效 messages.read 同意的家屬；沒有有效授權就拒絕建立。</span>
      </div>
      <div className={`callout ${styles.boundaryCallout}`} role="status">
        <LockKeyhole aria-hidden="true" />
        <span><strong>傳遞邊界：</strong>目前僅建立系統內「待送」證據；家屬端收件、provider worker 與離線 consumer 均未設定，因此一律不宣稱已送達、已讀或已確認。</span>
      </div>
      <div className={`callout ${styles.attachmentCallout}`} role="status">
        <FileWarning aria-hidden="true" />
        <span><strong>附件三態：</strong>本版訊息只能是「無附件」；未來可信管線才可進入「待掃描／已驗證安全」。目前 UI 與 API 都拒絕任意檔案、網址或裝置路徑。</span>
      </div>

      <section aria-label="溝通紀錄摘要" className={`metric-grid ${styles.metrics}`}>
        {[
          ["符合版本", snapshot.metrics.matching, "個", <MessageSquareText aria-hidden="true" key="matching" />],
          ["訊息主線", snapshot.metrics.threads, "條", <History aria-hidden="true" key="threads" />],
          ["更正版", snapshot.metrics.corrections, "個", <History aria-hidden="true" key="corrections" />],
          ["目前待送", snapshot.metrics.queued, "條", <Clock3 aria-hidden="true" key="queued" />],
          ["今日建立", snapshot.metrics.today, "個", <Clock3 aria-hidden="true" key="today" />],
          ["可信附件", snapshot.metrics.attachments, "份", <FileWarning aria-hidden="true" key="attachments" />],
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
          <div className="panel__title"><h2>不可變溝通歷程</h2><p>{loadedLabel}；更新 {formatTime(snapshot.generatedAt)}。</p></div>
        </div>
        {snapshot.itemsTruncated ? (
          <div className={`callout ${styles.truncatedCallout}`} role="status">
            <CircleAlert aria-hidden="true" />
            <span>符合歷史超過 100 個版本；目前只顯示最近 100 個，所有摘要仍由同一完整快照計算。</span>
          </div>
        ) : null}
        <form className={`filter-bar ${styles.filters}`} method="get">
          <label className="filter-search">
            <Search aria-hidden="true" /><span className="sr-only">搜尋溝通紀錄</span>
            <input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋主旨、內容或作者…" type="search" />
          </label>
          <label className="field field--compact">
            <span>個案</span>
            <select defaultValue={filters.clientId ?? ""} name="client">
              <option value="">全部可查看個案</option>
              {snapshot.clientOptions.map((option) => (
                <option key={option.clientId} value={option.clientId}>{option.displayName}（{option.clientCode}）</option>
              ))}
            </select>
          </label>
          <label className="field field--compact"><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
          <label className="field field--compact"><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
          <label className="field field--compact">
            <span>作者</span>
            <select defaultValue={filters.authorUserId ?? ""} name="author">
              <option value="">全部作者</option>
              {snapshot.authorOptions.map((option) => <option key={option.userId} value={option.userId}>{option.displayName}</option>)}
            </select>
          </label>
          <label className="field field--compact"><span>傳送狀態</span><select defaultValue={filters.deliveryStatus} name="delivery"><option value="all">全部</option><option value="queued">待送（未送達）</option></select></label>
          <label className="field field--compact"><span>確認狀態</span><select defaultValue={filters.confirmationStatus} name="confirmation"><option value="all">全部</option><option value="not_configured">未設定</option></select></label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? <Link className="button button--quiet" href="?">清除</Link> : null}
        </form>

        {snapshot.items.length ? (
          <>
            <div aria-label="溝通紀錄表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
              <table className="data-table">
                <thead><tr>{["版本／時間", "個案／作者", "訊息內容", "家屬授權快照", "附件／回條狀態", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>{snapshot.items.map((item) => (
                  <tr key={item.versionId}>
                    <td><VersionLabel item={item} /><strong>{formatTime(item.occurredAt)}</strong><small className="data-table__secondary">送出 {formatTime(item.submittedAt)}</small>{item.previousVersionId ? <small className="data-table__secondary">連結前一版本</small> : null}</td>
                    <td><strong>{item.clientDisplayName}</strong><small className="data-table__secondary">{item.clientCode}</small><small className="data-table__secondary">作者：{item.authorDisplayName}</small></td>
                    <td className={styles.messageCell}><span className="status-pill">照顧溝通</span><strong>{item.subject}</strong><p>{item.body}</p>{item.correctionReason ? <small className={styles.correctionReason}>更正理由：{item.correctionReason}</small> : null}</td>
                    <td><RecipientSnapshot item={item} /></td>
                    <td><span className="data-table__secondary">無附件（管線未設定）</span><BoundaryStatus /></td>
                    <td><CareCommunicationCorrectionAction canCorrect={snapshot.canCorrect} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} item={item} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <section aria-label="溝通紀錄卡片" className={styles.mobileCards}>
              {snapshot.items.map((item) => <MobileCard hasRecentAal2={hasRecentAal2} item={item} key={item.versionId} snapshot={snapshot} />)}
            </section>
          </>
        ) : (
          <div className="empty-card">
            <span className="empty-card__icon"><MessageSquareText aria-hidden="true" /></span>
            <h3>目前沒有符合的照顧溝通紀錄</h3>
            <p>{hasFilters ? "請調整或清除篩選；系統不會改查顧問訊息。" : "可在完成近期 AAL2 且有有效家屬訊息授權後建立第一筆待送紀錄。"}</p>
          </div>
        )}
      </section>
    </>
  );
}
