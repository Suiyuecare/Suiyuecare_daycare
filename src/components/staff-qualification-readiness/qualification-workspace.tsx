import Link from "next/link";
import { QUALIFICATION_ISSUES, QUALIFICATION_LABELS, type QualificationReport } from "@/lib/staff-qualification-readiness/model";
import { QualificationFreshness } from "./qualification-freshness";
import styles from "./qualification.module.css";

export function QualificationWorkspace({ report }: { report: QualificationReport }) {
  const filters = report.filters;
  return <div className={styles.workspace}>
    <header><p className="eyebrow">人員管理 · {report.branchName}</p>
      <h1>員工證照到期與補件</h1>
      <p>先處理已過期、即將到期與缺少證明的紀錄，再回到員工證照補齊資料。</p>
      <nav aria-label="相關人員工作"><Link className="button button--secondary" href="/app/staff/operations/staff-certificates">開啟員工證照</Link></nav>
    </header>
    {report.demo && <p className="notice">目前是合成示範資料，不會更動正式員工資料。</p>}
    <section className={`panel ${styles.notice}`} aria-label="資料與判定範圍">
      <strong>這是補件與到期提醒，不是可執行服務的資格核准。</strong>
      <p>範圍為本分支、你有權限查看的有效員工帳號；未包含疫苗、TOCC 或檢驗內容。已存證照與例外覆核均不代表可排入受限制服務。</p>
      <p>以臺北日期 {report.snapshotDate} 為準；30 日內含今天至 {report.dueThrough}，到期日當天仍未過期。未填到期日不會自動視為永久有效。</p>
    </section>
    <QualificationFreshness generatedAt={report.generatedAt} staleAfter={report.staleAfter} />
    {report.incomplete && <p role="alert" className="notice">目前來源超過單次讀取上限，只顯示已讀取資料；以下不是分支完整總數。請依員工縮小範圍後再核對，不能以「沒有列出」判斷已完成。{!report.missingRecordsKnown && " 未建紀錄的完整人數尚無法確認。"}</p>}
    <section className={styles.metrics} aria-label="各類待辦數量">
      {QUALIFICATION_ISSUES.map((issue) => {
        const query = new URLSearchParams({ issue });
        if (filters.staff) query.set("staff", filters.staff);
        if (filters.query) query.set("q", filters.query);
        return <Link key={issue} className={`panel ${styles.metric}`} aria-label={`${QUALIFICATION_LABELS[issue]}：${issue === "missing_record" && !report.missingRecordsKnown ? "待確認" : report.counts[issue]}${issue === "missing_record" ? "人" : "筆紀錄"}${report.incomplete ? "，僅已讀範圍" : ""}`} href={`/app/staff-qualification-readiness?${query}`}>
          <span>{QUALIFICATION_LABELS[issue]}</span><strong>{issue === "missing_record" && !report.missingRecordsKnown ? "待確認" : report.counts[issue]}</strong>
          <span>{issue === "missing_record" ? "人" : "筆紀錄"}{report.incomplete ? "（已讀範圍）" : ""}</span>
        </Link>;
      })}
    </section>
    <p className={styles.hint}>同一筆紀錄可能有多個待辦，卡片數量不可相加當成人數。證照需求仍須依員工職務與核准規則確認。</p>
    <form key={JSON.stringify(filters)} className={`panel ${styles.filters}`} action="/app/staff-qualification-readiness" method="get">
      <label>員工<select name="staff" defaultValue={filters.staff ?? "all"}><option value="all">所有可見有效員工</option>{report.staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>
      <label>待辦分類<select name="issue" defaultValue={filters.issue}>
        <option value="all">全部紀錄</option>{QUALIFICATION_ISSUES.map((issue) => <option key={issue} value={issue}>{QUALIFICATION_LABELS[issue]}</option>)}
      </select></label>
      <label>搜尋員工或證照<input name="q" type="search" maxLength={120} defaultValue={filters.query} placeholder="姓名、員工編號、證照類型" /></label>
      <button type="submit" className="button button--primary">篩選</button>
      <Link className="button button--ghost" href="/app/staff-qualification-readiness">清除篩選</Link>
    </form>
    <section aria-labelledby="qualification-results">
      <h2 id="qualification-results">待辦明細 · {report.rows.length} 筆</h2>
      <p>本次可見有效員工 {report.visibleCurrentStaff} 人；證照來源讀取 {report.sourceRecordCount}／{report.sourceRecordTotal} 筆。卡片與明細套用相同員工及文字搜尋；點選卡片可查看該類待辦。</p>
      {report.rows.length === 0 ? <div className="panel"><h3>此篩選下沒有紀錄</h3><p>{report.incomplete ? "資料尚未完整載入，不能據此判斷沒有待辦。" : "可清除篩選，或前往員工證照建檔；沒有待辦不等於已核准服務資格。"}</p></div> :
        <ul className={styles.rows}>{report.rows.map((row) => <li className={`panel ${styles.row}`} key={row.key}>
          <div><h3>{row.staffName}<span className={styles.code}>{row.employeeCode ?? "員工編號未填"}</span></h3>
            <p>{row.certificateType ?? "尚無有效證照紀錄"}{row.certificateVersion !== null && ` · 第 ${row.certificateVersion} 版`}</p>
            <div className={styles.tags}>{row.issues.length ? row.issues.map((issue) => <span key={issue}>{QUALIFICATION_LABELS[issue]}</span>) : <span>目前沒有日期／補件待辦</span>}</div>
            <dl className={styles.dates}><div><dt>生效日</dt><dd>{row.effectiveOn ?? "尚無紀錄"}</dd></div>
              <div><dt>到期日</dt><dd>{row.expiresOn ?? (row.certificateType === null ? "尚無紀錄" : "未填，待確認")}</dd></div>
              {row.daysToExpiry !== null && <div><dt>距到期</dt><dd>{row.daysToExpiry < 0 ? `已過期 ${-row.daysToExpiry} 天` : row.daysToExpiry === 0 ? "今天到期" : `${row.daysToExpiry} 天`}</dd></div>}
            </dl>
          </div>
          <Link className="button button--secondary" href={row.actionHref}>查看{row.staffName}的證照</Link>
        </li>)}</ul>}
    </section>
  </div>;
}
