import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { CaseCenterHistory } from "@/components/core-care/case-center-history";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import { caseCenterHref } from "@/lib/case-center/query";
import { caseCenterServiceStatus } from "@/lib/case-center/projection";
import type {
  CaseCenterClient,
  CaseCenterFilters,
  CaseCenterLifecycleFilter,
  CaseCenterServiceStatus,
  CaseCenterSnapshot,
} from "@/lib/case-center/types";
import { dailyWorkflowHref } from "@/lib/core-care/workflow-links";

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

function clientSummaryHref(client: CaseCenterClient, date: string) {
  const params = new URLSearchParams({ date, client: client.id });
  return `/app/staff/service-management/daily-summary?${params.toString()}`;
}

function canStartClientWork(client: CaseCenterClient, date: string) {
  return (
    client.lifecycleStatus === "active" &&
    client.lifecycleState === "active" &&
    client.serviceStatus === "serving" &&
    caseCenterServiceStatus({
      status: client.lifecycleStatus,
      admitted_on: client.admittedOn,
      ended_on: client.endedOn,
    }, date) === "serving"
  );
}

function clientWorkNote(client: CaseCenterClient, date: string) {
  if (client.lifecycleState === "pending_admission" || !client.admittedOn) {
    return "尚未收案，請先完成收案。";
  }
  if (client.lifecycleState === "suspended" || client.serviceStatus === "paused") {
    return "目前暫停服務，不開啟當日照顧。";
  }
  if (["transferred", "closed", "deceased"].includes(client.lifecycleState) ||
      client.serviceStatus === "ended" || (client.endedOn && client.endedOn <= date)) {
    return "服務已結束，僅供查閱紀錄。";
  }
  if (client.serviceStatus === "pending" || client.admittedOn > date) {
    return "此日期尚未開始服務。";
  }
  return "當日工作尚未開放，請洽主管確認。";
}

function ClientWorkActions({
  client,
  date,
  canOpenAttendance,
  canViewSummary,
}: {
  client: CaseCenterClient;
  date: string;
  canOpenAttendance: boolean;
  canViewSummary: boolean;
}) {
  const canStart = canOpenAttendance && canStartClientWork(client, date);
  return (
    <div className="case-center-actions">
      {canStart ? (
        <a
          aria-label={`開始 ${client.displayName} 的當日工作（${formatDate(date)}）`}
          className="button button--primary"
          data-case-client-id={client.id}
          href={dailyWorkflowHref(46, date, client.id)}
        >
          開始當日工作<ArrowRight aria-hidden="true" />
        </a>
      ) : (
        <p className="case-center-action-note">{clientWorkNote(client, date)}</p>
      )}
      {!canStart && canViewSummary && (
        <a
          aria-label={`查看 ${client.displayName} 的當日紀錄（${formatDate(date)}）`}
          className="button button--secondary"
          data-case-client-id={client.id}
          href={clientSummaryHref(client, date)}
        >
          查看當日紀錄
        </a>
      )}
    </div>
  );
}

function paginationHref(filters: CaseCenterFilters, page: number) {
  return caseCenterHref({ ...filters, page });
}

export function CaseCenterWorkspace({
  page,
  snapshot,
  filters,
  loadError = false,
  allowedDailyPages = [],
  canViewSummary = false,
}: {
  page: PageCatalogEntry;
  snapshot: CaseCenterSnapshot | null;
  filters: CaseCenterFilters;
  loadError?: boolean;
  allowedDailyPages?: readonly number[];
  canViewSummary?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning">
          <CircleAlert aria-hidden="true" />
        </span>
        <h1>個案清單暫時無法載入</h1>
        <p>請重新載入；若仍無法開啟，請聯絡主管確認存取權限。</p>
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
  const canOpenAttendance = allowedDailyPages.includes(46) && snapshot.serviceDate === filters.date;

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
          <p className="eyebrow">日常照顧</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            先選擇個案，再接續當日的出勤、量測與照顧日誌。
          </p>
          <p className="data-table__secondary">服務日期：{formatDate(filters.date)}</p>
        </div>
      </header>

      <div className="callout core-care-callout">
        <ShieldCheck aria-hidden="true" />
        <span>
          {snapshot.access.assignments === "self_only"
            ? "可依「我」篩選自己的個案；負責人顯示「權限受限」時，請向主管確認，不代表尚未指派。"
            : snapshot.access.profileLabels === "names"
              ? "服務中的個案可接續當日照顧；待收案、暫停或服務結束的個案，請先確認狀態或查看紀錄。"
              : "負責人以人員代碼顯示；如需確認承辦人，請洽主管。"}
        </span>
      </div>

      <section aria-label="個案摘要" className="metric-grid">
        <article className="metric-card">
          <div className="metric-card__top"><span>符合條件</span></div>
          <div className="metric-card__value">
            <strong>{snapshot.access.responsibleFilterRestricted ? "受限" : snapshot.total}</strong>
            {!snapshot.access.responsibleFilterRestricted && <span>人</span>}
          </div>
          <p className="metric-card__foot">搜尋與篩選後的個案數</p>
        </article>
        <article className="metric-card">
          <div className="metric-card__top"><span>可見個案</span></div>
          <div className="metric-card__value"><strong>{snapshot.visibleTotal}</strong><span>人</span></div>
          <p className="metric-card__foot">本分支可查看的個案</p>
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
          <p className="metric-card__foot">此日期暫停或已結束服務</p>
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
              <p>目前只能依自己的指派篩選。請改選「我」或清除負責人條件。</p>
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
                        <ClientWorkActions
                          canOpenAttendance={canOpenAttendance}
                          canViewSummary={canViewSummary}
                          client={client}
                          date={filters.date}
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
                  <ClientWorkActions
                    canOpenAttendance={canOpenAttendance}
                    canViewSummary={canViewSummary}
                    client={client}
                    date={filters.date}
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
              <p>請調整姓名、個案代碼或篩選條件，再試一次。</p>
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
