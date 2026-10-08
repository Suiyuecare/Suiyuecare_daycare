import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, FileText } from "lucide-react";
import Link from "next/link";

import { ASSESSMENT_MATRIX_FORMS, ASSESSMENT_MATRIX_PATH, ASSESSMENT_MATRIX_TITLE, assessmentFormHref } from "@/lib/assessment-matrix/config";
import { assessmentMatrixHref, type AssessmentMatrixFilters } from "@/lib/assessment-matrix/query";
import type { AssessmentMatrixCell, AssessmentMatrixSnapshot } from "@/lib/assessment-matrix/types";

import styles from "./assessment-matrix.module.css";

function formatSnapshotTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function adjacentMonth(month: string, offset: number) {
  const [year, part] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, part - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function MatrixStatus({
  cell,
  formKey,
  clientId,
  clientName,
  formName,
}: {
  cell: AssessmentMatrixCell | undefined;
  formKey: (typeof ASSESSMENT_MATRIX_FORMS)[number]["key"];
  clientId: string;
  clientName: string;
  formName: string;
}) {
  const href = assessmentFormHref(formKey, clientId);
  if (!cell || !href) return <span className={styles.statusNone}>—</span>;
  return <Link
    aria-label={`開啟 ${clientName} 的${formName}；${cell.state === "draft" ? `本月有草稿，評估日 ${cell.assessedOn}` : "本月未記錄"}`}
    className={`${styles.statusLink} ${cell.state === "draft" ? styles.statusDraft : styles.statusNone}`}
    href={href}
    prefetch={false}
  >
    <span>{cell.state === "draft" ? "有草稿" : "未記錄"}</span>
    {cell.state === "draft" ? <small>{cell.assessedOn.slice(5).replace("-", "/")}</small> : null}
    <ArrowUpRight aria-hidden="true" size={14} />
  </Link>;
}

export function AssessmentMatrixWorkspace({
  filters,
  snapshot,
  invalidQuery,
  loadError = false,
}: {
  filters?: AssessmentMatrixFilters;
  snapshot?: AssessmentMatrixSnapshot;
  invalidQuery?: string;
  loadError?: boolean;
}) {
  const forms = snapshot?.forms.flatMap((key) => {
    const form = ASSESSMENT_MATRIX_FORMS.find((entry) => entry.key === key);
    return form ? [form] : [];
  }) ?? [];
  const totalPages = snapshot ? Math.max(1, Math.ceil(snapshot.totalClients / snapshot.pageSize)) : 1;
  const todayMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  const currentMonth = `${todayMonth.find((part) => part.type === "year")?.value}-${todayMonth.find((part) => part.type === "month")?.value}`;
  const previous = filters && adjacentMonth(filters.month, -1);
  const next = filters && adjacentMonth(filters.month, 1);

  return <div className={styles.workspace}>
    <header className={styles.heading}>
      <div>
        <p className="eyebrow">評估量表</p>
        <h1><ClipboardList aria-hidden="true" />{ASSESSMENT_MATRIX_TITLE}</h1>
        <p>按月份查看個案草稿，點選狀態開啟量表。</p>
      </div>
      {snapshot ? <span className={styles.refreshTime}>更新於 {formatSnapshotTime(snapshot.generatedAt)}</span> : null}
    </header>

    {invalidQuery || loadError ? <section className={styles.message} role="alert">
      <FileText aria-hidden="true" />
      <div><h2>{invalidQuery ? "篩選條件無效" : "資料暫時讀取失敗"}</h2>
        <p>{invalidQuery ?? "請重試；系統不會顯示其他分支或未授權個案資料。"}</p></div>
      <a className="button button--secondary" href={invalidQuery ? ASSESSMENT_MATRIX_PATH : assessmentMatrixHref(filters!)}>
        {invalidQuery ? "回本月" : "重新載入"}
      </a>
    </section> : null}

    {filters && snapshot ? <>
      <section aria-label="月份與狀態說明" className={styles.toolbar}>
        <div className={styles.monthControl}>
          {previous && previous >= "2000-01" ? <Link aria-label="上一個月" className={styles.monthArrow} href={assessmentMatrixHref({ month: previous, page: 1 })}><ChevronLeft aria-hidden="true" /></Link> : <span aria-hidden="true" className={styles.monthArrowDisabled}><ChevronLeft /></span>}
          <span className={styles.monthName}><CalendarDays aria-hidden="true" size={18} />{formatMonth(filters.month)}</span>
          {next && next <= currentMonth ? <Link aria-label="下一個月" className={styles.monthArrow} href={assessmentMatrixHref({ month: next, page: 1 })}><ChevronRight aria-hidden="true" /></Link> : <span aria-hidden="true" className={styles.monthArrowDisabled}><ChevronRight /></span>}
        </div>
        <form action={ASSESSMENT_MATRIX_PATH} className={styles.monthForm} method="get" noValidate>
          <label htmlFor="assessment-month">跳至月份</label>
          <input defaultValue={filters.month} id="assessment-month" max={currentMonth} min="2000-01" name="month" type="month" />
          <button className="button button--secondary" type="submit">查詢</button>
        </form>
      </section>

      <div className={styles.summary}>
        <span><strong>{snapshot.totalClients}</strong> 位可查看個案</span>
        <span><strong>{forms.length}</strong> 種有權限量表</span>
        <span className={styles.legend}><i aria-hidden="true" />有草稿 <b aria-hidden="true" />未記錄</span>
      </div>

      {snapshot.demo ? <p className={styles.demoNote}>合成展示模式；此處不顯示真實個案紀錄。</p> : null}
      {!snapshot.clients.length ? <section className={styles.empty}>
        <ClipboardList aria-hidden="true" />
        <h2>目前沒有可查看的個案</h2>
        <p>請確認個案指派；未記錄不代表已完成評估。</p>
      </section> : <section className={styles.tableSection} aria-labelledby="matrix-heading">
        <div className={styles.tableHeader}>
          <h2 id="matrix-heading">個案 × 量表</h2>
          <span>左右滑動查看全部量表</span>
        </div>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="量表進度表，可水平捲動">
          <table className={styles.table}>
            <caption className="sr-only">{formatMonth(filters.month)}個案量表草稿狀態；僅顯示目前有權限查看的個案及量表。</caption>
            <thead><tr><th scope="col">個案</th>{forms.map((form) => <th key={form.key} scope="col">{form.label}</th>)}</tr></thead>
            <tbody>{snapshot.clients.map((client) => <tr key={client.clientId}>
              <th scope="row"><span className={styles.clientName}>{client.displayName}</span><small>{client.clientCode}{client.serviceStatus === "suspended" ? " · 暫停" : ""}</small></th>
              {forms.map((form) => <td key={form.key}><MatrixStatus cell={client.cells[form.key]} clientId={client.clientId} clientName={client.displayName} formKey={form.key} formName={form.label} /></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <span>第 {snapshot.page}／{totalPages} 頁 · 每頁最多 {snapshot.pageSize} 位</span>
          <div>
            {snapshot.page > 1 ? <Link className="button button--secondary" href={assessmentMatrixHref({ ...filters, page: snapshot.page - 1 })}>上一頁</Link> : null}
            {snapshot.page < totalPages ? <Link className="button button--secondary" href={assessmentMatrixHref({ ...filters, page: snapshot.page + 1 })}>下一頁</Link> : null}
          </div>
        </div>
      </section>}
      <p className={styles.disclaimer}>此頁只統計本月量表草稿；不代表已簽署、完成正式評估或已到複評期限。</p>
    </> : null}
  </div>;
}
