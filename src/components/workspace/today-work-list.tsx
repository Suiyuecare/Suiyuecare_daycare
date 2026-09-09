"use client";

import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { NavigationLink } from "@/components/app/navigation-link";
import { filterTodayWorkRows, todayWorkAction, type TodayWorkRow, type WorkFilter, type WorkTask } from "@/lib/core-care/today-work";
import { dailyWorkflowHref } from "@/lib/core-care/workflow-links";
import type { DailyCareSnapshot } from "@/lib/core-care/types";

const filters: { id: WorkTask; label: string; access: keyof DailyCareSnapshot["sourceAccess"] }[] = [
  { id: "attendance", label: "尚無出勤", access: "attendance" },
  { id: "measurements", label: "尚無量測", access: "measurements" },
  { id: "diary", label: "日誌待完成", access: "careDiaries" },
  { id: "attention", label: "需留意", access: "careDiaries" },
];
const PAGE_SIZE = 20;

export function TodayWorkList({ rows, serviceDate, access }: {
  rows: readonly TodayWorkRow[]; serviceDate: string; access: DailyCareSnapshot["sourceAccess"];
}) {
  const [filter, setFilter] = useState<WorkFilter>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const authorizedRows = access.clients ? rows : [];
  const selectedFilter = filters.find((item) => item.id === filter);
  const filterRestricted = Boolean(selectedFilter && !access[selectedFilter.access]);
  const filtered = filterRestricted ? [] : filterTodayWorkRows(authorizedRows, filter, search);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  function changeFilter(next: WorkFilter) { setFilter(next); setSearch(""); setPage(1); }

  if (!access.clients) return <section className="empty-card" role="status"><h2>目前無個案查閱權限</h2><p>請由機構管理員確認您的工作指派與資料範圍。</p></section>;
  return <section className="today-work" aria-labelledby="today-list-title">
    <div className="today-counters" aria-label="篩選待處理工作">
      {filters.map((item) => <button key={item.id} type="button" className="today-counter"
        aria-label={`${item.label} ${access[item.access] ? `${filterTodayWorkRows(authorizedRows, item.id).length} 位，查看名單` : "無查閱權限"}`}
        disabled={!access[item.access]} aria-pressed={filter === item.id} aria-controls="today-client-list"
        onClick={() => changeFilter(item.id)}>
        <span>{item.label}</span><strong>{access[item.access] ? filterTodayWorkRows(authorizedRows, item.id).length : "—"}</strong>
        <small>{access[item.access] ? "位・查看名單" : "無查閱權限"}</small>
      </button>)}
    </div>
    <div className="panel today-list-panel">
      <div className="panel__header"><div className="panel__title"><h2 id="today-list-title">在案工作清單</h2><p>尚未比對今日排程，請先確認個案今天是否接受服務。</p></div></div>
      <div className="today-toolbar">
        <div className="today-view-buttons" aria-label="清單範圍">
          <button className="button button--secondary" aria-pressed={filter === "pending"} type="button" onClick={() => changeFilter("pending")}>待處理</button>
          <button className="button button--secondary" aria-pressed={filter === "all"} type="button" onClick={() => changeFilter("all")}>全部在案</button>
        </div>
        <label className="today-search"><Search aria-hidden="true" /><span className="sr-only">搜尋今日個案姓名或代碼</span>
          <input type="search" autoComplete="off" maxLength={120} placeholder="找個案姓名或代碼" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      </div>
      <p className="today-result" role="status">{filterRestricted
        ? `目前沒有「${selectedFilter?.label}」查閱權限，請切換清單範圍或聯絡管理員。`
        : `${filter === "all" ? "全部在案" : filter === "pending" ? "待處理" : selectedFilter?.label}：${filtered.length} 位${search ? "（搜尋結果）" : ""}。每位個案只列一次。`}</p>
      <ul className="today-client-list" id="today-client-list">
        {shown.map((row) => { const action = todayWorkAction(row, filter); return <li className="today-client" key={row.id}>
          <div className="today-client__identity"><span className="avatar" aria-hidden="true">{row.name.slice(0, 1)}</span><div><h3>{row.name}</h3><small>{row.code}</small></div>
            {row.tasks.includes("attention") && <span className="today-attention">需留意</span>}</div>
          <dl className="today-client__status"><div><dt>出勤</dt><dd>{row.attendance}</dd></div><div><dt>量測</dt><dd>{row.measurements}</dd></div><div><dt>照顧日誌</dt><dd>{row.diary}</dd></div></dl>
          {action.page ? <NavigationLink className="button button--secondary today-client__action" loadingLabel={action.label}
            href={dailyWorkflowHref(action.page, serviceDate, row.id)} aria-label={`${row.name}（${row.code}）：${action.label}`}>{action.label}<ArrowRight aria-hidden="true" /></NavigationLink>
            : <p>請聯絡管理員確認工作權限。</p>}
        </li>; })}
      </ul>
      {!shown.length && !filterRestricted && <div className="today-empty"><h3>{search ? "找不到符合條件的個案" : filter === "all" ? "目前沒有可查閱的在案個案" : "此清單目前沒有待處理個案"}</h3>
        <p>{search ? "試試其他姓名或代碼，或清除搜尋查看名單。" : "這只代表本清單的結果，其他照顧工作仍請依當日安排確認。"}</p>
        {(search || filter !== "all") && <button className="button button--secondary" type="button" onClick={() => changeFilter("all")}>查看全部在案個案</button>}</div>}
      {pageCount > 1 && <nav className="today-pagination" aria-label="今日個案分頁"><button className="button button--secondary" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一頁</button><span>第 {currentPage} / {pageCount} 頁</span><button className="button button--secondary" type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一頁</button></nav>}
    </div>
  </section>;
}
