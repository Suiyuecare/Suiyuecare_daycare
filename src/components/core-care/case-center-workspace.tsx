import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import {
  CaseCenterHistory,
  CaseCenterWorkLink,
} from "@/components/core-care/case-center-history";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import { caseCenterHref } from "@/lib/case-center/query";
import type {
  CaseCenterClient,
  CaseCenterFilters,
  CaseCenterLifecycleFilter,
  CaseCenterServiceStatus,
  CaseCenterSnapshot,
} from "@/lib/case-center/types";

const lifecycleLabels: Record<CaseCenterLifecycleFilter, string> = {
  all: "全部生命週期",
  pending_admission: "待收案",
  active: "在案",
  suspended: "暫停",
  transferred: "轉出",
  closed: "結案",
  deceased: "死亡",
};

const serviceLabels: Record<"all" | CaseCenterServiceStatus, string> = {
  all: "全部服務狀態",
  serving: "服務中",
  paused: "暫停服務",
  pending: "尚未生效",
  ended: "服務結束",
};

function formatDate(value: string | null) {
  if (!value) return "未設定";
  return value.replaceAll("-", "/");
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function responsibility(client: CaseCenterClient) {
  if (client.responsibility.state === "restricted") return "權限受限";
  if (!client.responsibility.people.length) return "尚未指派";
  return client.responsibility.people.map((person) => person.label).join("、");
}

function clientWorkHref(client: CaseCenterClient, date: string) {
  const params = new URLSearchParams({ date, client: client.id });
  return `/app/staff/service-management/daily-summary?${params.toString()}`;
}

function paginationHref(filters: CaseCenterFilters, page: number) {
  return caseCenterHref({ ...filters, page });
}

export function CaseCenterWorkspace({
  page,
  snapshot,
  filters,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: CaseCenterSnapshot | null;
  filters: CaseCenterFilters;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning">
          <CircleAlert aria-hidden="true" />
        </span>
        <h1>個案清單暫時無法載入</h1>
        <p>系統不會改查其他分支，也不會把無權限或讀取失敗偽裝成 0 位。</p>
        <a className="button button--secondary" href={caseCenterHref(filters)}>
          重新載入
        </a>
      </section>
    );
  }

  const currentUser = snapshot.responsibleOptions.find(
    (person) => person.currentUser,
  );
  const responsibleValue =
    filters.responsible === currentUser?.userId
      ? "me"
      : filters.responsible;
  const selectedResponsibleMissing =
    filters.responsible !== "all" &&
    filters.responsible !== "me" &&
    !snapshot.responsibleOptions.some(
      (person) => person.userId === filters.responsible,
    );
  const clearHref = caseCenterHref({
    ...filters,
    query: "",
    lifecycle: "all",
    service: "all",
    responsible: "all",
    page: 1,
  });

  return (
    <>
      <CaseCenterHistory />
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">
          個案中心
        </span>
      </nav>

      <header className="page-heading">
        <div>
          <p className="eyebrow">穩定個案 ID・分支資料範圍</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            每位個案只顯示一次；日期、篩選與頁碼保存在網址，返回時會還原位置。
          </p>
        </div>
        <div className="page-heading__actions">
          <button
            className="button button--primary"
            disabled
            title="收案與新增個案屬第 60、61 頁流程，尚未接線"
            type="button"
          >
            新增個案（尚未開放）
          </button>
        </div>
      </header>

      <div className="callout core-care-callout">
        <ShieldCheck aria-hidden="true" />
        <span>
          清單只使用目前機構、分支與資料列權限可見的個案。責任人資料
          {snapshot.access.assignments === "self_only"
            ? "僅能確認自己的指派；其他指派會標示為權限受限。"
            : snapshot.access.profileLabels === "names"
              ? "可顯示授權範圍內的姓名。"
              : "以人員代碼顯示，未擴張個資權限。"}
        </span>
      </div>

      <section aria-label="個案摘要" className="metric-grid">
        <article className="metric-card">
          <div className="metric-card__top"><span>符合條件</span></div>
          <div className="metric-card__value">
            <strong>{snapshot.access.responsibleFilterRestricted ? "受限" : snapshot.total}</strong>
            {!snapshot.access.responsibleFilterRestricted && <span>人</span>}
          </div>
          <p className="metric-card__foot">目前網址中的組合篩選</p>
        </article>
        <article className="metric-card">
          <div className="metric-card__top"><span>可見個案</span></div>
          <div className="metric-card__value"><strong>{snapshot.visibleTotal}</strong><span>人</span></div>
          <p className="metric-card__foot">目前分支，以穩定 ID 去重</p>
        </article>
        <article className="metric-card">
          <div className="metric-card__top"><span>服務中</span></div>
          <div className="metric-card__value"><strong>{snapshot.summary.serving}</strong><span>人</span></div>
          <p className="metric-card__foot">依 {snapshot.serviceDate} 判定</p>
        </article>
        <article className="metric-card">
          <div className="metric-card__top"><span>待收案</span></div>
          <div className="metric-card__value"><strong>{snapshot.summary.pending}</strong><span>人</span></div>
          <p className="metric-card__foot">已建檔但尚未開始服務</p>
        </article>
        <article className="metric-card">
          <div className="metric-card__top"><span>暫停／結束</span></div>
          <div className="metric-card__value"><strong>{snapshot.summary.paused + snapshot.summary.ended}</strong><span>人</span></div>
          <p className="metric-card__foot">生命週期與服務日期一致判定</p>
        </article>
      </section>

      <section className="panel case-center-panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>個案工作清單</h2>
            <p aria-live="polite">
              第 {snapshot.page} / {snapshot.pageCount} 頁，共 {snapshot.total} 位符合條件
            </p>
          </div>
        </div>

        <form className="filter-bar case-center-filters" method="get">
          <input name="date" type="hidden" value={filters.date} />
          <label className="filter-search">
            <Search aria-hidden="true" />
            <span className="sr-only">搜尋個案代碼或姓名</span>
            <input
              autoComplete="off"
              defaultValue={filters.query}
              maxLength={120}
              name="q"
              placeholder="搜尋個案代碼或姓名…"
              type="search"
            />
          </label>
          <label className="field case-center-filter-field">
            <span>生命週期</span>
            <select defaultValue={filters.lifecycle} name="lifecycle">
              {Object.entries(lifecycleLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field case-center-filter-field">
            <span>服務狀態</span>
            <select defaultValue={filters.service} name="service">
              {Object.entries(serviceLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field case-center-filter-field">
            <span>負責人</span>
            <select defaultValue={responsibleValue} name="responsible">
              <option value="all">全部可見指派</option>
              {currentUser && <option value="me">{currentUser.label}</option>}
              {snapshot.responsibleOptions
                .filter((person) => !person.currentUser)
                .map((person) => (
                  <option key={person.userId} value={person.userId}>{person.label}</option>
                ))}
              {selectedResponsibleMissing && (
                <option value={filters.responsible}>
                  人員代碼 {filters.responsible.slice(-6).toUpperCase()}（受限）
                </option>
              )}
            </select>
          </label>
          <button className="button button--primary" type="submit">套用篩選</button>
          <Link className="button button--secondary" href={clearHref}>清除</Link>
        </form>

        {snapshot.access.responsibleFilterRestricted ? (
          <div className="panel__body">
            <section className="empty-card core-care-state" role="alert">
              <CircleAlert aria-hidden="true" />
              <h2>無法使用這位責任人篩選</h2>
              <p>目前角色只能查看自己的指派，系統不會把受限結果顯示為 0 位個案。</p>
              <Link
                className="button button--secondary"
                href={caseCenterHref({ ...filters, responsible: "all", page: 1 })}
              >
                清除責任人篩選
              </Link>
            </section>
          </div>
        ) : snapshot.clients.length ? (
          <>
            <div className="table-wrap case-center-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">個案</th>
                    <th scope="col">生命週期</th>
                    <th scope="col">服務狀態</th>
                    <th scope="col">負責人</th>
                    <th scope="col">收案／異動</th>
                    <th scope="col"><span className="sr-only">動作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.clients.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <span className="data-table__primary">
                          <span className="avatar" aria-hidden="true">{client.displayName.slice(0, 1)}</span>
                          <span>{client.displayName}<small className="data-table__secondary">{client.clientCode}</small></span>
                        </span>
                      </td>
                      <td><StatusPill status={lifecycleLabels[client.lifecycleState]} /></td>
                      <td><StatusPill status={serviceLabels[client.serviceStatus]} /></td>
                      <td className="case-center-responsibility">{responsibility(client)}</td>
                      <td>
                        <span>{formatDate(client.admittedOn)}</span>
                        <small className="data-table__secondary">更新 {formatTimestamp(client.updatedAt)}</small>
                      </td>
                      <td>
                        <CaseCenterWorkLink
                          clientId={client.id}
                          clientName={client.displayName}
                          href={clientWorkHref(client, filters.date)}
                          iconOnly
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-records core-care-mobile">
              {snapshot.clients.map((client) => (
                <article className="record-card" key={client.id}>
                  <div className="record-card__top">
                    <div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode}</span></div>
                    <StatusPill status={serviceLabels[client.serviceStatus]} />
                  </div>
                  <dl className="core-care-card-grid">
                    <div><dt>生命週期</dt><dd>{lifecycleLabels[client.lifecycleState]}</dd></div>
                    <div><dt>收案日</dt><dd>{formatDate(client.admittedOn)}</dd></div>
                    <div className="case-center-card-wide"><dt>負責人</dt><dd>{responsibility(client)}</dd></div>
                  </dl>
                  <CaseCenterWorkLink
                    clientId={client.id}
                    clientName={client.displayName}
                    href={clientWorkHref(client, filters.date)}
                  />
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="panel__body">
            <section className="empty-card core-care-state">
              <UsersRound aria-hidden="true" />
              <h2>沒有符合條件的個案</h2>
              <p>調整搜尋或組合篩選；系統不會跨分支擴大查詢。</p>
              <Link className="button button--secondary" href={clearHref}>清除篩選</Link>
            </section>
          </div>
        )}

        {!snapshot.access.responsibleFilterRestricted && snapshot.pageCount > 1 && (
          <nav aria-label="個案清單分頁" className="pagination case-center-pagination">
            {snapshot.page > 1 ? (
              <Link className="button button--secondary" href={paginationHref(filters, snapshot.page - 1)}>
                <ChevronLeft aria-hidden="true" />上一頁
              </Link>
            ) : <span aria-hidden="true" />}
            <span aria-live="polite">第 {snapshot.page} 頁，共 {snapshot.pageCount} 頁</span>
            {snapshot.page < snapshot.pageCount ? (
              <Link className="button button--secondary" href={paginationHref(filters, snapshot.page + 1)}>
                下一頁<ChevronRight aria-hidden="true" />
              </Link>
            ) : <span aria-hidden="true" />}
          </nav>
        )}
      </section>
    </>
  );
}
