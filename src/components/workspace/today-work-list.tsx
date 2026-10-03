"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { NavigationLink } from "@/components/app/navigation-link";
import { filterTodayWorkRows, scopeTodayWorkShift, todayWorkAction, type TodayWorkRow, type WorkFilter, type WorkTask } from "@/lib/core-care/today-work";
import { dailyWorkflowHref } from "@/lib/core-care/workflow-links";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import { ROSTER_TASK_LABELS, type CareRosterSnapshot, type RosterShift } from "@/lib/care-roster/types";
import styles from "@/components/care-roster/care-roster.module.css";

const filters: { id: WorkTask; label: string; access: keyof DailyCareSnapshot["sourceAccess"] }[] = [
  { id: "attendance", label: "尚無出勤", access: "attendance" },
  { id: "measurements", label: "尚無量測", access: "measurements" },
  { id: "diary", label: "日誌待完成", access: "careDiaries" },
  { id: "attention", label: "需留意", access: "careDiaries" },
];
const PAGE_SIZE = 20;
const RESUME_STATE_KEY = "__daycareTodayResume";
const RESUME_TTL_MS = 10 * 60_000;
const SESSION_END_EVENT = "daycare:session-ending";

type ResumeState = {
  scope: string;
  filter: WorkFilter;
  search: string;
  page: number;
  shift: RosterShift | "all";
  unassigned: boolean;
  scrollTop: number;
  focusClientId: string | null;
  focusShift?: RosterShift | "all";
  expiresAt: number;
};

// Search may contain a person's name. Keep it in this tab's JS memory only:
// history.state receives an opaque nonce, never the search or a client ID.
const resumeByNonce = new Map<string, ResumeState>();
const latestNonceByScope = new Map<string, string>();
let activeActorScope: string | null = null;
let resumePruneTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityPruneRegistered = false;

function clearResumeState() {
  resumeByNonce.clear(); latestNonceByScope.clear(); activeActorScope = null;
  if (resumePruneTimer !== null) clearTimeout(resumePruneTimer);
  resumePruneTimer = null;
}

function historyNonce(): string | null {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const nonce: unknown = (state as Record<string, unknown>)[RESUME_STATE_KEY];
  return typeof nonce === "string" && /^[0-9a-f-]{36}$/iu.test(nonce) ? nonce : null;
}

function removeExpiredResumeState() {
  const now = Date.now();
  for (const [nonce, state] of resumeByNonce) if (state.expiresAt <= now) resumeByNonce.delete(nonce);
  for (const [scope, nonce] of latestNonceByScope) if (!resumeByNonce.has(nonce)) latestNonceByScope.delete(scope);
}

function scheduleResumePrune() {
  if (resumePruneTimer !== null) clearTimeout(resumePruneTimer);
  resumePruneTimer = null;
  const earliestExpiry = Math.min(...[...resumeByNonce.values()].map((state) => state.expiresAt));
  if (Number.isFinite(earliestExpiry)) {
    resumePruneTimer = setTimeout(() => {
      resumePruneTimer = null;
      removeExpiredResumeState();
      scheduleResumePrune();
    }, Math.max(0, earliestExpiry - Date.now()));
  }
  if (!visibilityPruneRegistered) {
    document.addEventListener("visibilitychange", () => {
      removeExpiredResumeState();
      scheduleResumePrune();
    });
    document.addEventListener(SESSION_END_EVENT, clearResumeState);
    visibilityPruneRegistered = true;
  }
}

function rememberResume(nonce: string, state: ResumeState) {
  resumeByNonce.set(nonce, state);
  latestNonceByScope.set(state.scope, nonce);
  scheduleResumePrune();
}

function renewedExpiry() { return Date.now() + RESUME_TTL_MS; }

function resumeFor(scope: string): ResumeState | null {
  removeExpiredResumeState();
  const nonce = historyNonce();
  const sameEntry = nonce ? resumeByNonce.get(nonce) : null;
  if (sameEntry?.scope === scope) return sameEntry;
  const latest = latestNonceByScope.get(scope);
  return latest ? resumeByNonce.get(latest) ?? null : null;
}

function installHistoryNonce(nonce: string) {
  const state: unknown = window.history.state;
  const existing = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
  if (existing[RESUME_STATE_KEY] === nonce) return;
  window.history.replaceState({ ...existing, [RESUME_STATE_KEY]: nonce }, "", window.location.href);
}

export function TodayWorkList({ rows, serviceDate, access, roster, resumeScopeKey }: {
  rows: readonly TodayWorkRow[]; serviceDate: string; access: DailyCareSnapshot["sourceAccess"];
  roster?: CareRosterSnapshot;
  /** Server-derived opaque actor + tenant + branch key; absent in isolated component tests. */
  resumeScopeKey?: string;
}) {
  const [filter, setFilter] = useState<WorkFilter>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [shift, setShift] = useState<RosterShift | "all">("all");
  const [unassigned, setUnassigned] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const composing = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const firstRow = useRef<HTMLLIElement>(null);
  const resultStatus = useRef<HTMLParagraphElement>(null);
  const list = useRef<HTMLElement>(null);
  const requestedPageFocus = useRef<number | null>(null);
  const resumeNonce = useRef<string | null>(null);
  const pendingReturn = useRef<{ scrollTop: number; focusClientId: string | null; focusShift?: RosterShift | "all" } | null>(null);
  const lastSelection = useRef<string | null>(null);
  const [resumeReady, setResumeReady] = useState(false);
  const resumeScope = resumeScopeKey ? `${resumeScopeKey}:${serviceDate}` : null;
  const rosterReady = roster?.status === "ready" || roster?.status === "empty";
  const rosterManager = rosterReady && roster?.manager === true;
  const eligibleClientIds = rosterReady ? new Set(roster.assignments.filter((slot) => slot.state === "scheduled"
    && slot.isServiceEligible === true && slot.serviceEligibility === "eligible").map((slot) => slot.clientId)) : null;
  const authorizedRows = access.clients ? rows.filter((row) => (!eligibleClientIds || eligibleClientIds.has(row.id))
    && (shift === "all" || row.plannedShifts?.some((s) => s.shift === shift))
    && (!unassigned || row.plannedShifts?.some((s) => !s.staffUserId && (shift === "all" || s.shift === shift)))).map((row) => scopeTodayWorkShift(row, shift)) : [];
  const visibleFilters = filters.map((item) => rosterReady && item.id === "measurements" ? { ...item, label: "量測待完成" } : item);
  const selectedFilter = visibleFilters.find((item) => item.id === filter);
  const filterRestricted = Boolean(selectedFilter && !access[selectedFilter.access]);
  const searching = search.trim().length > 0;
  const filtered = filterRestricted ? [] : filterTodayWorkRows(authorizedRows, filter, search);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useLayoutEffect(() => {
    const requested = requestedPageFocus.current;
    if (requested === null) return;
    requestedPageFocus.current = null;
    if (requested !== currentPage) return;
    const target = firstRow.current ?? resultStatus.current ?? list.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  });
  function changeFilter(next: WorkFilter) {
    if (mobileFiltersOpen) requestedPageFocus.current = 1;
    setFilter(next); setPage(1); setMobileFiltersOpen(false);
  }
  function clearSearchAndShowAll() {
    requestedPageFocus.current = 1;
    changeFilter("all");
    setSearch("");
  }
  function changePage(next: number) { requestedPageFocus.current = next; setPage(next); }
  const displayedSearch = compositionDraft ?? search;
  const activeScope = [shift === "all" ? null : shift === "morning" ? "上午" : "下午", unassigned ? "待指派" : null,
    filter === "all" ? rosterReady ? "全部當班" : "全部在案" : filter === "pending" ? "待處理" : selectedFilter?.label]
    .filter(Boolean).join("・");
  const allListLabel = shift !== "all" || unassigned ? "目前條件名單" : rosterReady ? "全部當班個案" : "全部在案個案";

  useLayoutEffect(() => {
    if (!resumeScopeKey || !resumeScope) { queueMicrotask(() => setResumeReady(true)); return; }
    // A different signed-in actor/tenant/branch must never inherit the prior
    // person's in-memory search, even when both can see the same clients.
    if (activeActorScope !== resumeScopeKey) {
      resumeByNonce.clear(); latestNonceByScope.clear(); activeActorScope = resumeScopeKey;
      scheduleResumePrune();
    }
    const saved = access.clients ? resumeFor(resumeScope) : null;
    const entryNonce = historyNonce();
    const nonce = saved && entryNonce && resumeByNonce.get(entryNonce) === saved ? entryNonce : crypto.randomUUID();
    resumeNonce.current = nonce;
    if (saved) pendingReturn.current = { scrollTop: saved.scrollTop, focusClientId: saved.focusClientId, focusShift: saved.focusShift };
    installHistoryNonce(nonce);
    // Run before the next paint without synchronously cascading a layout effect.
    // The saved query exists only in JS memory, never in HTML or history.state.
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      if (saved) {
        setFilter(saved.filter); setSearch(saved.search); setPage(saved.page);
        setShift(rosterReady && ["all", "morning", "afternoon"].includes(saved.shift) ? saved.shift : "all");
        setUnassigned(rosterManager && saved.unassigned);
      }
      setResumeReady(true);
    });
    return () => { live = false; };
  }, [access.clients, resumeScope, resumeScopeKey, rosterManager, rosterReady]);

  useEffect(() => {
    const nonce = resumeNonce.current;
    if (!resumeReady || !resumeScope || !nonce || !access.clients) return;
    const key = `${filter}\u0000${search}\u0000${page}\u0000${shift}\u0000${unassigned}`;
    const prior = resumeByNonce.get(nonce);
    const changedSelection = lastSelection.current !== null && lastSelection.current !== key;
    rememberResume(nonce, {
      scope: resumeScope, filter, search, page, shift, unassigned,
      scrollTop: changedSelection ? 0 : prior?.scrollTop ?? 0,
      focusClientId: changedSelection ? null : prior?.focusClientId ?? null,
      focusShift: changedSelection ? undefined : prior?.focusShift,
      expiresAt: renewedExpiry(),
    });
    lastSelection.current = key;
  }, [access.clients, filter, page, resumeReady, resumeScope, search, shift, unassigned]);

  useLayoutEffect(() => {
    if (!resumeReady || !pendingReturn.current) return;
    const request = pendingReturn.current;
    pendingReturn.current = null;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const scroller = document.querySelector<HTMLElement>(".main-stage");
        if (!scroller) return;
        const target = request.focusClientId ? [...scroller.querySelectorAll<HTMLElement>("[data-today-client-id]")]
          .find((item) => item.dataset.todayClientId === request.focusClientId &&
            (!request.focusShift || item.dataset.todayShift === request.focusShift) && item.getClientRects().length > 0) : null;
        scroller.scrollTop = request.focusClientId && !target ? 0 : request.scrollTop;
        (target ?? (request.focusClientId ? resultStatus.current : null))?.focus({ preventScroll: true });
        if (target) target.scrollIntoView?.({ block: "nearest" });
      });
    });
    return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
  }, [resumeReady, currentPage, filtered.length]);

  function rememberBeforeNavigation(clientId: string, actionShift?: RosterShift) {
    const nonce = resumeNonce.current;
    if (!resumeScope || !nonce) return;
    const scroller = document.querySelector<HTMLElement>(".main-stage");
    rememberResume(nonce, {
      scope: resumeScope, filter, search, page, shift, unassigned,
      scrollTop: Math.max(0, Math.round(scroller?.scrollTop ?? 0)),
      focusClientId: clientId, focusShift: actionShift ?? "all", expiresAt: renewedExpiry(),
    });
  }

  if (!access.clients) return <section className="empty-card" role="status"><h2>目前無個案查閱權限</h2><p>請由機構管理員確認您的工作指派與資料範圍。</p></section>;
  return <section className="today-work" aria-labelledby="today-list-title" ref={list} tabIndex={-1}>
    <div className="today-find-row">
      <div className="today-search"><label><Search aria-hidden="true" /><span className="sr-only">搜尋今日個案姓名或代碼</span>
        <input ref={searchInput} type="search" autoComplete="off" maxLength={120} placeholder="找個案姓名或代碼" value={displayedSearch}
          onChange={(event) => { if (composing.current) setCompositionDraft(event.target.value); else { setSearch(event.target.value); setPage(1); } }}
          onCompositionStart={() => { composing.current = true; setCompositionDraft(search); }}
          onCompositionEnd={(event) => { composing.current = false; setCompositionDraft(null); setSearch(event.currentTarget.value); setPage(1); }} /></label>
        {displayedSearch && <button className="icon-button today-search__clear" type="button" aria-label="清除搜尋今日個案姓名或代碼"
          disabled={compositionDraft !== null} onClick={() => { setSearch(""); setPage(1); searchInput.current?.focus(); }}><X aria-hidden="true" /></button>}
      </div>
      <button className="today-mobile-filter-toggle" type="button" aria-controls="today-filter-counters today-filter-controls"
        aria-expanded={mobileFiltersOpen} aria-label={`篩選個案與工作，${activeScope}：${filterRestricted ? "目前無查閱權限" : `${filtered.length} 位`}`}
        onClick={() => setMobileFiltersOpen((open) => !open)}>篩選 <strong>{filterRestricted ? "—" : filtered.length}</strong></button>
    </div>
    {(filter !== "pending" || shift !== "all" || unassigned) && <p className="today-mobile-active-scope">{activeScope}・{filterRestricted ? "無查閱權限" : `${filtered.length} 位`}</p>}
    <div className={`today-counters${mobileFiltersOpen ? "" : " today-filters--collapsed"}`} id="today-filter-counters" role="group" aria-label="篩選待處理工作">
      {visibleFilters.map((item) => { const matchingCount = access[item.access] ? filterTodayWorkRows(authorizedRows, item.id, search).length : null;
        return <button key={item.id} type="button" className="today-counter"
        aria-label={`${item.label} ${matchingCount === null ? "無查閱權限" : `${matchingCount} 位${searching ? "（目前搜尋）" : ""}，查看名單`}`}
        disabled={!access[item.access]} aria-pressed={filter === item.id} aria-controls="today-client-list"
        onClick={() => changeFilter(item.id)}>
        <span>{item.label}</span><strong>{matchingCount ?? "—"}</strong>
        <small>{matchingCount === null ? "無查閱權限" : searching ? "位・搜尋內" : "位・查看名單"}</small>
      </button>; })}
    </div>
    <div className="panel today-list-panel">
      <div className="panel__header"><div className="panel__title"><h2 id="today-list-title">{rosterReady ? roster.manager ? "分支當班照顧清單" : "我的當班個案" : "在案工作清單"}</h2><p>{rosterReady ? "依已確認分工顯示；上午、下午工作分別確認。" : roster?.status === "unavailable" ? "每日分工暫時無法取得，以下僅為授權在案名單，不代表今天應到人數。請聯絡主管確認分工。" : "尚未比對今日排程，請先確認個案今天是否接受服務。"}</p></div></div>
      <div className={`today-filter-controls${mobileFiltersOpen ? "" : " today-filters--collapsed"}`} id="today-filter-controls">
      {rosterReady && <div className="today-toolbar"><label className="field"><span>班別</span><select value={shift} onChange={(e) => { setShift(e.target.value as RosterShift | "all"); setPage(1); }}><option value="all">全部班別</option><option value="morning">上午</option><option value="afternoon">下午</option></select></label>{roster.manager && <label className="check-field"><input type="checkbox" checked={unassigned} onChange={(e) => { setUnassigned(e.target.checked); setFilter("all"); setPage(1); }} />只看待指派</label>}</div>}
      <div className="today-toolbar">
        <div className="today-view-buttons" role="group" aria-label="清單範圍">
          <button className="button button--secondary" aria-pressed={filter === "pending"} type="button" onClick={() => changeFilter("pending")}>待處理</button>
          <button className="button button--secondary" aria-pressed={filter === "all"} type="button" onClick={() => changeFilter("all")}>{rosterReady ? "全部當班" : "全部在案"}</button>
        </div>
      </div>
      </div>
      <p className="today-result" role="status" ref={resultStatus} tabIndex={-1}>{filterRestricted
        ? `目前沒有「${selectedFilter?.label}」查閱權限，請切換清單範圍或聯絡管理員。`
        : `${filter === "all" ? rosterReady ? "全部當班" : "全部在案" : filter === "pending" ? "待處理" : selectedFilter?.label}：${filtered.length} 位${searching ? "（搜尋結果）" : ""}${pageCount > 1 ? `・第 ${currentPage} / ${pageCount} 頁` : ""}`}</p>
      <ul className="today-client-list" id="today-client-list">
        {shown.map((row, index) => { const action = todayWorkAction(row, filter);
          const actionPage = action.page;
          const plannedShifts = row.plannedShifts?.filter((slot) => shift === "all" || slot.shift === shift);
          const unassignedShifts = plannedShifts?.filter((slot) => !slot.staffUserId).length ?? 0;
          const diaryContinuation = actionPage === 6 && (filter === "diary" || row.tasks[0] === "diary");
          const pendingDiaryShifts = shift === "all" && diaryContinuation
            ? [...new Set(plannedShifts?.filter((slot) => slot.tasks.some((task) => task.kind === "care_diary" && task.status === "pending"))
              .map((slot) => slot.shift) ?? [])] : [];
          const actionShifts: (RosterShift | undefined)[] = pendingDiaryShifts.length
            ? pendingDiaryShifts : [shift === "all" ? undefined : shift];
          return <li className="today-client" key={row.id} ref={index === 0 ? firstRow : undefined} tabIndex={-1}>
          <div className="today-client__identity"><span className="avatar" aria-hidden="true">{row.name.slice(0, 1)}</span><div><h3>{row.name}</h3><small>{row.code}</small></div>
            {row.tasks.includes("attention") && <span className="today-attention">需留意</span>}</div>
          <dl className="today-client__status"><div><dt>出勤</dt><dd>{row.attendance}</dd></div><div><dt>量測</dt><dd>{row.measurements}</dd></div><div><dt>照顧日誌</dt><dd>{row.diary}</dd></div></dl>
          {actionPage ? <div className="today-client__actions">{actionShifts.map((actionShift) => {
            const shiftLabel = actionShift === "morning" ? "上午・" : actionShift === "afternoon" ? "下午・" : "";
            return <NavigationLink className="button button--secondary today-client__action" loadingLabel={action.label}
              href={dailyWorkflowHref(actionPage, serviceDate, row.id, actionShift)} aria-label={`${row.name}（${row.code}）：${shiftLabel}${action.label}`}
              data-today-client-id={row.id} data-today-shift={actionShift ?? "all"} key={actionShift ?? "all"}
              onClick={() => rememberBeforeNavigation(row.id, actionShift)}>{shiftLabel}{action.label}<ArrowRight aria-hidden="true" /></NavigationLink>;
          })}</div>
            : <p>請聯絡管理員確認工作權限。</p>}
          {plannedShifts && plannedShifts.length > 0 && <details className="today-client__schedule">
            <summary>照顧安排 <span>{plannedShifts.map((slot) => slot.shift === "morning" ? "上午" : "下午").join("、")}{unassignedShifts > 0 ? `・${unassignedShifts} 班待指派` : ""}</span></summary>
            <div className={styles.slots}>{plannedShifts.map((slot) => <section key={slot.id} aria-label={`${slot.shift === "morning" ? "上午" : "下午"}照顧安排`}>
              <h4>{slot.shift === "morning" ? "上午" : "下午"}・{slot.staffName ?? "待指派負責人"}</h4>
              <ul>{slot.tasks.map((task) => <li key={task.kind}>{ROSTER_TASK_LABELS[task.kind]}：{task.status === "recorded" ? task.kind === "care_diary" ? "已簽署" : "已有本班紀錄" : task.status === "restricted" ? "無查閱權限" : "尚待記錄"}{task.evidenceAt && <time dateTime={task.evidenceAt}>（{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(task.evidenceAt))}）</time>}</li>)}</ul>
              {!slot.tasks.length && <p>尚未安排記錄項目，請主管確認。</p>}
            </section>)}</div>
          </details>}
        </li>; })}
      </ul>
      {!shown.length && !filterRestricted && <div className="today-empty"><h3>{searching ? "找不到符合條件的個案" : filter === "all" ? "目前沒有可查閱的在案個案" : "此清單目前沒有待處理個案"}</h3>
        <p>{searching ? "試試其他姓名或代碼，或清除搜尋查看名單。" : "這只代表本清單的結果，其他照顧工作仍請依當日安排確認。"}</p>
        {(searching || filter !== "all") && <button className="button button--secondary" type="button" onClick={searching ? clearSearchAndShowAll : () => changeFilter("all")}>{searching ? "清除搜尋並查看" : "查看"}{allListLabel}</button>}</div>}
      {pageCount > 1 && <nav className="today-pagination" aria-label="今日個案分頁"><button className="button button--secondary" type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一頁</button><span>第 {currentPage} / {pageCount} 頁</span><button className="button button--secondary" type="button" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>下一頁</button></nav>}
    </div>
  </section>;
}
