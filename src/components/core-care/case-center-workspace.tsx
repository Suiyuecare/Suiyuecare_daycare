import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { IntakeEntryLink } from "@/components/client-intake/intake-entry-link";
import { NavigationLink } from "@/components/app/navigation-link";

import { CaseCenterHistory } from "@/components/core-care/case-center-history";
import { StatusPill } from "@/components/ui/status-pill";
import { SearchField } from "@/components/ui/search-field";
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
import { assessmentEntryHref, isAssessmentClientSelectable } from "@/lib/assessment-entry/selection";

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
  canOpenAssessments,
  demoOutsideDailyRoster,
}: {
  client: CaseCenterClient;
  date: string;
  canOpenAttendance: boolean;
  canViewSummary: boolean;
  canOpenAssessments: boolean;
  demoOutsideDailyRoster: boolean;
}) {
  const canStart = canOpenAttendance && !demoOutsideDailyRoster && canStartClientWork(client, date);
  return (
    <div className="case-center-actions">
      {canStart ? (
        <NavigationLink
          aria-label={`開始 ${client.displayName} 的當日工作（${formatDate(date)}）`}
          className="button button--primary"
          data-case-client-id={client.id}
          href={dailyWorkflowHref(46, date, client.id)}
          loadingLabel="當日工作"
          prefetch={false}
        >
          開始當日工作<ArrowRight aria-hidden="true" />
        </NavigationLink>
      ) : (
        <p className="case-center-action-note">{demoOutsideDailyRoster && canStartClientWork(client, date)
          ? "所選日期沒有可接續的照顧工作，可查看紀錄或評估。"
          : clientWorkNote(client, date)}</p>
      )}
      {!canStart && canViewSummary && (
        <NavigationLink
          aria-label={`查看 ${client.displayName} 的當日紀錄（${formatDate(date)}）`}
          className="button button--secondary"
          data-case-client-id={client.id}
          href={clientSummaryHref(client, date)}
          loadingLabel="當日紀錄"
          prefetch={false}
        >
          查看當日紀錄
        </NavigationLink>
      )}
      {canOpenAssessments && isAssessmentClientSelectable(client.lifecycleStatus) ? (
        <NavigationLink
          aria-label={`評估 ${client.displayName}（${client.clientCode}）`}
          className="button button--secondary"
          data-case-client-id={client.id}
          href={assessmentEntryHref(client.id)}
          loadingLabel="評估量表"
          prefetch={false}
        >
          評估這位個案
        </NavigationLink>
      ) : null}
    </div>
  );
}

function paginationHref(filters: CaseCenterFilters, page: number) {
  return caseCenterHref({ ...filters, page });
}

export function CaseCenterWorkspace({
  canOpenIntake = false,
  page,
  snapshot,
  filters,
  loadError = false,
  allowedDailyPages = [],
  canViewSummary = false,
  canOpenAssessments = false,
  demoDailyClientIds,
}: {
  page: PageCatalogEntry;
  snapshot: CaseCenterSnapshot | null;
  filters: CaseCenterFilters;
  loadError?: boolean;
  allowedDailyPages?: readonly number[];
  canOpenIntake?: boolean;
  canViewSummary?: boolean;
  canOpenAssessments?: boolean;
  demoDailyClientIds?: readonly string[];
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
  const activeFilterCount = Number(filters.lifecycle !== "all") + Number(filters.service !== "all") + Number(filters.responsible !== "all");

  return (
    <>
      <CaseCenterHistory readyKey={`${caseCenterHref(filters)}:${snapshot.generatedAt}:${snapshot.clients.map((client) => client.id).join(",")}`} />
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
        <IntakeEntryLink allowed={canOpenIntake} />
      </header>

      <div className="callout core-care-callout">
        <ShieldCheck aria-hidden="true" />
        <span>
          {snapshot.access.assignments === "self_only"
            ? "可依「我」篩選自己的個案；負責人顯示「權限受限」時，請向主管確認，不代表尚未指派。"
            : snapshot.access.profileLabels === "names"
              ? "依服務狀態開啟當日工作或查看紀錄。"
              : "負責人以人員代碼顯示；如需確認承辦人，請洽主管。"}
        </span>
      </div>

      <section className="panel case-center-panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>個案工作清單</h2>
            <p aria-live="polite">
              第 {snapshot.page} / {snapshot.pageCount} 頁，共 {snapshot.total} 位符合條件
            </p>
          </div>
        </div>

        <form className="filter-bar case-center-filters" method="get" noValidate>
          <input name="date" type="hidden" value={filters.date} />
          <SearchField defaultValue={filters.query} lengthUnit="code-units" label="搜尋個案代碼或姓名" placeholder="搜尋個案代碼或姓名…" />
          <button className="button button--primary" type="submit">套用篩選</button>
          <Link className="button button--secondary" href={clearHref}>清除</Link>
          <details className="task-details case-center-filter-details" open={activeFilterCount > 0 || snapshot.access.responsibleFilterRestricted}>
            <summary>更多篩選{activeFilterCount > 0 ? `（已套用 ${activeFilterCount} 項）` : ""}</summary>
            <div className="case-center-filter-details__fields">
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
            </div>
          </details>
        </form>
        <nav className="case-center-quick-filters" aria-label="常用個案篩選">
          <Link className="button button--secondary" aria-current={filters.lifecycle === "all" && filters.service === "all" ? "page" : undefined}
            href={caseCenterHref({ ...filters, lifecycle: "all", service: "all", page: 1 })}>全部</Link>
          <Link className="button button--secondary" aria-current={filters.lifecycle === "all" && filters.service === "serving" ? "page" : undefined}
            href={caseCenterHref({ ...filters, lifecycle: "all", service: "serving", page: 1 })}>服務中</Link>
          <Link className="button button--secondary" aria-current={filters.lifecycle === "pending_admission" && filters.service === "all" ? "page" : undefined}
            href={caseCenterHref({ ...filters, lifecycle: "pending_admission", service: "all", page: 1 })}>待收案</Link>
        </nav>

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
                          canOpenAssessments={canOpenAssessments}
                          demoOutsideDailyRoster={snapshot.demo && !demoDailyClientIds?.includes(client.id)}
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
                    canOpenAssessments={canOpenAssessments}
                    demoOutsideDailyRoster={snapshot.demo && !demoDailyClientIds?.includes(client.id)}
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
      <details className="task-details case-center-summary">
        <summary>個案統計</summary>
        <section aria-label="個案摘要">
          <p className="data-table__secondary">分支統計依 {formatDate(snapshot.serviceDate)} 判定；符合條件人數另依目前搜尋與篩選。</p>
          <dl className="case-center-summary__counts">
            <div><dt>符合條件</dt><dd>{snapshot.access.responsibleFilterRestricted ? "受限" : `${snapshot.total} 人`}</dd></div>
            <div><dt>可見個案</dt><dd>{snapshot.visibleTotal} 人</dd></div>
            <div><dt>服務中</dt><dd>{snapshot.summary.serving} 人</dd></div>
            <div><dt>待收案</dt><dd>{snapshot.summary.pending} 人</dd></div>
            <div><dt>暫停／結束</dt><dd>{snapshot.summary.paused + snapshot.summary.ended} 人</dd></div>
          </dl>
        </section>
      </details>
    </>
  );
}
