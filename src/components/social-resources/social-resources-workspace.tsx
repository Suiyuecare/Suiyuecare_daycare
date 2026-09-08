import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleOff,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  SocialResourceFilters,
  SocialResourceInformationState,
  SocialResourceItem,
  SocialResourceSnapshot,
} from "@/lib/social-resources/types";

import {
  SocialResourceAction,
  SocialResourceFreshness,
} from "./social-resource-action";
import styles from "./social-resources.module.css";

function formatDate(value: string | null) {
  if (!value) return "—";
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

function stateText(state: SocialResourceInformationState, detail: string | null) {
  if (state === "not_applicable") return "不適用";
  if (state === "missing") return "缺值";
  return detail!;
}

function validityText(resource: SocialResourceItem) {
  if (resource.validityState === "missing") return "缺值";
  if (resource.validityState === "not_applicable") return "不適用";
  if (resource.validityState === "open_ended") {
    return `${formatDate(resource.validFrom)} 起，未設截止日`;
  }
  return resource.validFrom
    ? `${formatDate(resource.validFrom)}－${formatDate(resource.validUntil)}`
    : `截至 ${formatDate(resource.validUntil)}`;
}

function statusText(resource: SocialResourceItem) {
  if (resource.status === "inactive") return "已停用";
  if (resource.expired) return "已到期";
  if (!resource.effective && resource.validFrom) return "尚未生效";
  if (resource.validityState === "missing") return "待補有效期限";
  return "有效";
}

function RowActions({
  resource,
  instance,
  canManage,
  demo,
  defaultYear,
}: {
  resource: SocialResourceItem;
  instance: string;
  canManage: boolean;
  demo: boolean;
  defaultYear: number;
}) {
  if (resource.status === "inactive") {
    return <span className={styles.locked}><CircleOff aria-hidden="true" />歷史版本鎖定</span>;
  }
  return (
    <div className={styles.rowActions}>
      <SocialResourceAction canManage={canManage} defaultYear={defaultYear} demo={demo} instance={`${instance}-edit`} kind="edit" resource={resource} />
      <SocialResourceAction canManage={canManage} defaultYear={defaultYear} demo={demo} instance={`${instance}-confirm`} kind="confirm" resource={resource} />
      <SocialResourceAction canManage={canManage} defaultYear={defaultYear} demo={demo} instance={`${instance}-deactivate`} kind="deactivate" resource={resource} />
    </div>
  );
}

export function SocialResourcesWorkspace({
  page,
  snapshot,
  filters,
  canManage,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: SocialResourceSnapshot | null;
  filters: SocialResourceFilters;
  canManage: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>社會資源暫時無法載入</h1>
        <p>正式快照採失敗即關閉；系統沒有擴大機構或分支範圍，也沒有改用展示資料。</p>
        <a className="button button--secondary" href="?status=all">重新載入</a>
      </section>
    );
  }

  const generatedYear = Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(new Date(snapshot.generatedAt)));

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>社工服務</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">分支資源主檔・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            維護機構人工確認的資源名稱、類型、適用對象、資格、聯絡方式及有效期間；不自動判定個案是否符合外部補助資格。
          </p>
        </div>
        <div className="page-heading__actions">
          <SocialResourceAction canManage={canManage} defaultYear={generatedYear} demo={snapshot.demo} instance="header" kind="create" />
        </div>
      </header>

      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span><strong>展示模式：</strong>下列名稱、電話與條件都是合成示例。所有寫入按鈕及 API 都維持停用，不會保存資料。</span>
        </div>
      ) : (
        <div className={`callout ${styles.securityCallout}`}>
          <ShieldCheck aria-hidden="true" />
          <span>讀取只回傳目前機構與分支的 200 筆上限稽核快照；寫入使用目前 AAL2、資料版本與使用者專屬冪等鍵。停用後只能保留歷史，不可直接刪除或改寫。</span>
        </div>
      )}

      {!snapshot.demo && !canManage ? (
        <div className="callout" role="status"><ShieldCheck aria-hidden="true" /><span>目前角色只有查看權限；新增、編輯、確認及停用均由資料庫與 API 拒絕。</span></div>
      ) : null}

      <section aria-label="社會資源摘要" className="metric-grid">
        {[
          ["有效資源", snapshot.metrics.effective, "筆", "已啟用、已開始且未到期", <CheckCircle2 aria-hidden="true" key="effective" />],
          ["即將到期", "—", "", "期限門檻尚未由機構發布，不自動推算", <CalendarClock aria-hidden="true" key="expiring" />],
          ["待確認", snapshot.metrics.pendingConfirmation, "筆", "僅計啟用中且從未確認；未設定確認週期", <CalendarClock aria-hidden="true" key="confirm" />],
          ["已停用", snapshot.metrics.inactive, "筆", `另有 ${snapshot.metrics.expired} 筆有效期限已過；兩者可重疊`, <CircleOff aria-hidden="true" key="inactive" />],
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
            <h2>資源清單</h2>
            <p>{snapshot.itemTotal} 筆符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<SocialResourceFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
          </div>
        </div>
        <form className={`filter-bar ${styles.filters}`} method="get">
          <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋資源名稱、類型、對象、資格或聯絡方式</span><input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋資源、類型或聯絡方式…" type="search" /></label>
          <label className="field field--compact"><span>年度</span><input defaultValue={filters.referenceYear ?? ""} max={2200} min={2000} name="year" placeholder="全部年度" type="number" /></label>
          <label className="field field--compact"><span>資源類型</span><select defaultValue={filters.resourceType ?? ""} name="type"><option value="">全部類型</option>{snapshot.typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label className="field field--compact"><span>狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部狀態</option><option value="active">啟用</option><option value="inactive">已停用</option></select></label>
          <label className="field field--compact"><span>適用對象</span><select defaultValue={filters.audience ?? ""} name="audience"><option value="">全部對象</option><option value="__missing__">缺值</option><option value="__not_applicable__">不適用</option>{snapshot.audienceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          <Link className="button button--quiet" href="?status=all">清除</Link>
        </form>

        {snapshot.itemsTruncated ? (
          <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>結果超過 200 筆，畫面只顯示排序後前 200 筆；摘要仍使用完整篩選集合。請縮小年度、類型、狀態、對象或關鍵字。</span></div>
        ) : null}
        {snapshot.typeOptionsTruncated || snapshot.audienceOptionsTruncated ? (
          <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>類型或適用對象選項超過 200 個，選單只載入前 200 個。仍可使用關鍵字搜尋；系統不會把未載入選項誤判為不存在。</span></div>
        ) : null}

        {snapshot.items.length ? (
          <>
            <div aria-label="社會資源表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
              <table className="data-table">
                <thead><tr>{["資源", "類型／對象", "資格", "聯絡方式", "有效期限", "最後確認", "狀態", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>{snapshot.items.map((resource) => (
                  <tr key={resource.id}>
                    <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{resource.name.slice(0, 1)}</span><span>{resource.name}<small className="data-table__secondary">{resource.referenceYear} 年度・v{resource.rowVersion}</small></span></span></td>
                    <td>{resource.resourceType}<small className="data-table__secondary">{stateText(resource.audienceState, resource.audienceDetail)}</small></td>
                    <td className={styles.longText}>{stateText(resource.eligibilityState, resource.eligibilityDetail)}</td>
                    <td className={styles.longText}>{stateText(resource.contactState, resource.contactDetail)}</td>
                    <td>{validityText(resource)}</td>
                    <td>{resource.lastConfirmedOn ? formatDate(resource.lastConfirmedOn) : <strong className={styles.missing}>缺值</strong>}</td>
                    <td><StatusPill status={statusText(resource)} /></td>
                    <td><RowActions canManage={canManage} defaultYear={generatedYear} demo={snapshot.demo} instance={`desktop-${resource.id}`} resource={resource} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mobile-records core-care-mobile">{snapshot.items.map((resource) => (
              <article className="record-card" key={resource.id}>
                <div className="record-card__top"><div><h3>{resource.name}</h3><span className="data-table__secondary">{resource.resourceType}・{resource.referenceYear} 年</span></div><StatusPill status={statusText(resource)} /></div>
                <dl className={styles.cardGrid}>
                  <div><dt>適用對象</dt><dd>{stateText(resource.audienceState, resource.audienceDetail)}</dd></div>
                  <div><dt>資格</dt><dd>{stateText(resource.eligibilityState, resource.eligibilityDetail)}</dd></div>
                  <div><dt>聯絡方式</dt><dd>{stateText(resource.contactState, resource.contactDetail)}</dd></div>
                  <div><dt>有效期限</dt><dd>{validityText(resource)}</dd></div>
                  <div><dt>最後確認日</dt><dd>{resource.lastConfirmedOn ? formatDate(resource.lastConfirmedOn) : <strong className={styles.missing}>缺值</strong>}</dd></div>
                  <div><dt>版本／更新</dt><dd>v{resource.rowVersion}・{formatTimestamp(resource.updatedAt)}</dd></div>
                </dl>
                <RowActions canManage={canManage} defaultYear={generatedYear} demo={snapshot.demo} instance={`mobile-${resource.id}`} resource={resource} />
              </article>
            ))}</div>
          </>
        ) : (
          <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的資源</h2><p>請調整年度、類型、狀態、適用對象或關鍵字；系統不會擴大到其他分支。</p><Link className="button button--secondary" href="?status=all">清除篩選</Link></section></div>
        )}
      </section>
    </>
  );
}
