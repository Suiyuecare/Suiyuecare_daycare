import {
  Building2,
  ChevronRight,
  CircleAlert,
  Database,
  FileLock2,
  LockKeyhole,
  Search,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import { filterClientMasterItems } from "@/lib/clients/master";
import type {
  ClientMasterItem,
  ClientMasterServiceState,
  ClientMasterSnapshot,
  ClientMasterSourceFilter,
  ClientMasterStatusFilter,
} from "@/lib/clients/master-types";

import { ClientMasterAction } from "./client-master-action";
import styles from "./client-master.module.css";

const statusLabels: Record<ClientMasterServiceState, string> = {
  pending_admission: "待收案",
  active: "在案",
  suspended: "暫停",
  transferred: "已轉出",
  closed: "已結案",
  deceased: "死亡結案",
};

function formatBirthDate(value: string | null, readable: boolean) {
  if (!readable) return "依角色遮罩";
  if (!value) return "未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function formatTimestamp(value: string | null) {
  if (!value) return "未提供";
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

function sourceLabel(client: ClientMasterItem) {
  return client.sourceAuthority === "local" ? "本機可編輯" : "中央主權";
}

function LockedAction({ client }: { client: ClientMasterItem }) {
  const message =
    client.editBlockReason === "central_authority"
      ? "中央匯入更新"
      : "終止狀態鎖定";
  return (
    <span className={styles.lockedAction} title={message}>
      <LockKeyhole aria-hidden="true" />{message}
    </span>
  );
}

function RowAction({
  client,
  instance,
  canManage,
  hasRecentAal2,
  demo,
  today,
}: {
  client: ClientMasterItem;
  instance: string;
  canManage: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
  today: string;
}) {
  if (!client.editable) return <LockedAction client={client} />;
  return (
    <ClientMasterAction
      canManage={canManage}
      client={client}
      demo={demo}
      hasRecentAal2={hasRecentAal2}
      instance={instance}
      kind="edit"
      today={today}
    />
  );
}

export function ClientMasterWorkspace({
  page,
  snapshot,
  query,
  status,
  source,
  canManage,
  canCreate,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: ClientMasterSnapshot | null;
  query: string;
  status: ClientMasterStatusFilter;
  source: ClientMasterSourceFilter;
  canManage: boolean;
  canCreate: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>個案主檔暫時無法載入</h1>
        <p>正式資料讀取採失敗即關閉；系統沒有擴大分支或指派範圍，也沒有改用展示資料。</p>
        <a className="button button--secondary" href="?status=all&source=all">重新載入</a>
      </section>
    );
  }

  const clients = filterClientMasterItems(snapshot, { query, status, source });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(snapshot.generatedAt));

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>機構營運管理</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">資料主權個案主檔・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            目前垂直片管理最小必要身分欄位；中央系統資料只讀，本機資料使用版本鎖、UUID 冪等鍵與最近 15 分鐘 AAL2 更新。
          </p>
        </div>
        <div className="page-heading__actions">
          <ClientMasterAction
            canCreate={canCreate}
            canManage={canManage}
            demo={snapshot.demo}
            hasRecentAal2={hasRecentAal2}
            instance="header"
            kind="create"
            today={today}
          />
        </div>
      </header>

      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span><strong>展示模式：</strong>以下全是合成資料。新增與修改按鈕保持停用，API 也會拒絕寫入，不會持久化到正式或本機資料庫。</span>
        </div>
      ) : (
        <div className="callout core-care-callout">
          <ShieldCheck aria-hidden="true" />
          <span>正式最小快照會核對目前機構／分支、clients.read 與逐位個案指派範圍；每次查看或搜尋都只以互動類型與筆數留下不含個資的稽核紀錄。權限、範圍、筆數或回傳格式不符時，整頁停止載入。</span>
        </div>
      )}

      {!snapshot.demo && canManage && !hasRecentAal2 ? (
        <div className={`callout ${styles.reauthCallout}`} role="status">
          <ShieldCheck aria-hidden="true" />
          <span>目前可安全檢視，但新增或修改屬高風險操作，需要最近 15 分鐘內完成 AAL2 重新驗證。</span>
          <Link className={styles.buttonLink} href="/mfa?audience=staff">
            <ShieldCheck aria-hidden="true" />前往重新驗證
          </Link>
        </div>
      ) : null}

      <section aria-label="資料主權說明" className={styles.authorityLegend}>
        <article>
          <Building2 aria-hidden="true" />
          <div><strong>中央主權欄位</strong><span>身分、官方資格與核定資料只能經中央 HTML 預覽、衝突覆核及核准交易更新；本頁不直接覆寫。</span></div>
        </article>
        <article>
          <Database aria-hidden="true" />
          <div><strong>本機可編輯欄位</strong><span>此版只開放個案代碼、顯示姓名、出生日期；來源、分支、狀態、建立人、密文與版本都不能由瀏覽器指定。</span></div>
        </article>
      </section>

      <section aria-label="個案主檔摘要" className="metric-grid">
        {[
          ["符合條件", clients.length, "人", "目前篩選結果", <Search aria-hidden="true" key="filtered" />],
          ["在案", snapshot.metrics.active, "人", "目前權威狀態", <UserRoundCheck aria-hidden="true" key="active" />],
          ["待收案", snapshot.metrics.pendingAdmission, "人", "已建檔、尚未收案", <UserRoundCheck aria-hidden="true" key="pending" />],
          ["本機可編輯", snapshot.metrics.localEditable, "人", "在案或暫停", <Database aria-hidden="true" key="local" />],
          ["中央主權", snapshot.metrics.centralAuthority, "人", "只能走中央匯入", <FileLock2 aria-hidden="true" key="central" />],
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
            <h2>最小必要個案主檔</h2>
            <p>{clients.length} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}</p>
          </div>
        </div>
        <form className="filter-bar" method="get">
          <label className="filter-search">
            <Search aria-hidden="true" />
            <span className="sr-only">搜尋個案代碼或姓名</span>
            <input defaultValue={query} maxLength={120} name="q" placeholder="搜尋個案代碼或姓名…" type="search" />
          </label>
          <label className="field field--compact">
            <span>服務狀態</span>
            <select defaultValue={status} name="status">
              <option value="all">全部狀態</option>
              <option value="pending_admission">待收案</option>
              <option value="active">在案</option>
              <option value="suspended">暫停</option>
              <option value="transferred">已轉出</option>
              <option value="closed">已結案</option>
              <option value="deceased">死亡結案</option>
            </select>
          </label>
          <label className="field field--compact">
            <span>資料主權</span>
            <select defaultValue={source} name="source">
              <option value="all">全部來源</option>
              <option value="central">中央主權</option>
              <option value="local">本機可編輯</option>
            </select>
          </label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          <Link className="button button--quiet" href="?status=all&source=all">清除</Link>
        </form>

        {clients.length ? (
          <>
            <div
              aria-label="個案主檔表格，可左右捲動"
              className={`table-wrap ${styles.table}`}
              role="region"
              tabIndex={0}
            >
              <table className="data-table">
                <thead><tr>{["個案", "出生日期", "服務狀態", "資料主權", "版本與更新", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id}>
                      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{client.displayName.slice(0, 1)}</span><span>{client.displayName}<small className="data-table__secondary">{client.clientCode}</small></span></span></td>
                      <td>{formatBirthDate(client.dateOfBirth, snapshot.demographicsReadable)}</td>
                      <td><StatusPill status={statusLabels[client.serviceState]} /></td>
                      <td><span className={styles.authority}><StatusPill status={sourceLabel(client)} /><small>{client.sourceAuthority === "central" ? `來源 ${client.sourceSystem}・更新 ${formatTimestamp(client.sourceUpdatedAt)}` : "僅三個本機欄位可更新"}</small></span></td>
                      <td>v{client.rowVersion}<small className="data-table__secondary">{formatTimestamp(client.updatedAt)}</small></td>
                      <td className={styles.actionCell}><RowAction canManage={canManage} client={client} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} instance={`desktop-${client.id}`} today={today} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-records core-care-mobile">
              {clients.map((client) => (
                <article className="record-card" key={client.id}>
                  <div className="record-card__top"><div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode}</span></div><StatusPill status={statusLabels[client.serviceState]} /></div>
                  <dl className="core-care-card-grid">
                    <div><dt>出生日期</dt><dd>{formatBirthDate(client.dateOfBirth, snapshot.demographicsReadable)}</dd></div>
                    <div><dt>資料版本</dt><dd>v{client.rowVersion}</dd></div>
                    <div><dt>資料主權</dt><dd>{sourceLabel(client)}</dd></div>
                    <div><dt>最後更新</dt><dd>{formatTimestamp(client.updatedAt)}</dd></div>
                  </dl>
                  <div className={styles.cardAction}><RowAction canManage={canManage} client={client} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} instance={`mobile-${client.id}`} today={today} /></div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="panel__body">
            <section className="empty-card core-care-state">
              <Search aria-hidden="true" /><h2>沒有符合條件的個案</h2>
              <p>請調整關鍵字、狀態或資料主權；系統不會擴大到其他分支或未指派個案。</p>
              <Link className="button button--secondary" href="?status=all&source=all">清除篩選</Link>
            </section>
          </div>
        )}
      </section>
    </>
  );
}
