import Link from "next/link";

import type { OperationalReportLink, ReportEntry, ReportPeriods } from "@/lib/reports/entry";
import styles from "./reports.module.css";

export function ReportsWorkspace({ entries, periods, invalid, demo, operationalLinks = [] }: {
  entries: ReportEntry[];
  periods: ReportPeriods;
  invalid: boolean;
  demo: boolean;
  operationalLinks?: OperationalReportLink[];
}) {
  return <div className={styles.workspace}>
    <header className="page-heading">
      <div>
        <p className="eyebrow">機構營運管理 · 頁面 70</p>
        <h1>統計報表</h1>
        <p className="page-heading__description">先選日期，再開啟有權限的來源彙整。明細、公式與匯出都留在同一份來源快照。</p>
      </div>
    </header>
    <aside className={styles.notice} aria-label="目前報表範圍">
      <strong>{demo ? "合成展示 · 報表入口試用" : "報表入口 · 部分功能已接線"}</strong>
      <p>提供每日／每月來源彙整，以及依權限開放的收案補件、員工資格與出缺勤月報；尚未提供自訂統計、跨分支合併、正式財務／申報報表或此頁直接匯出。</p>
      <p>本頁不載入個案資料、不重新計算總數，也不以頁面開啟時間假充資料更新時間。</p>
    </aside>
    <form action="/app/staff/operations/reports" method="get" className={styles.filters} aria-label="選擇報表期間">
      <label>每日報表日期（臺北時間）<input type="date" name="date" required
        min="2000-01-01" max="2200-12-31" defaultValue={periods.date} /></label>
      <label>每月報表月份（臺北時間）<input type="month" name="month" required
        min="2000-01" max="2200-12" defaultValue={periods.month} /></label>
      <button className="button button--primary" type="submit">套用期間</button>
    </form>
    {invalid ? <section className={styles.notice} role="alert">
      <h2>期間或查詢條件無效</h2>
      <p>日期必須是真實日期、月份必須有效；不接受重複或未支援的條件。本次未建立報表連結，請修正後重新套用。</p>
    </section> : <section className={styles.grid} aria-label="可用報表來源">
      {entries.map((entry) => <article className={styles.card} key={entry.pageNumber}>
        <p className="eyebrow">來源頁 {entry.pageNumber} · {entry.href ? "可開啟來源" : "缺少來源查閱權限"}</p>
        <h2>{entry.title}</h2>
        <p><strong>期間：{entry.period}</strong> · Asia/Taipei</p>
        <p>{entry.description}</p>
        <details>
          <summary>資料來源、計算口徑與限制</summary>
          <dl>
            <dt>資料來源</dt><dd>{entry.source}</dd>
            <dt>計算口徑</dt><dd>{entry.definition}</dd>
            <dt>使用限制</dt><dd>{entry.limitation}</dd>
            <dt>更新時間與版本</dt><dd>開啟來源後顯示實際快照時間、版本及有效期限；重新開啟可能取得新快照。</dd>
            <dt>明細與匯出</dt><dd>在來源頁查看明細及匯出同一快照；匯出另須權限與最近 15 分鐘內雙重驗證。展示下載只含合成資料。</dd>
          </dl>
        </details>
        {entry.href ? <Link className="button button--secondary" href={entry.href} prefetch={false}>
          開啟{entry.title}
        </Link> : <p role="status">目前帳號沒有此來源的完整查閱權限，請聯絡機構權限管理員。</p>}
      </article>)}
      {entries.length === 0 && <p role="status">沒有可用的報表入口。請確認報表查閱權限。</p>}
    </section>}
    {!invalid && operationalLinks.length > 0 && <section aria-labelledby="operational-follow-up-reports">
      <h2 id="operational-follow-up-reports">補件與營運追蹤</h2>
      <div className={styles.grid}>{operationalLinks.map((entry) => <article className={styles.card} key={entry.id}>
        <h3>{entry.title}</h3><p>{entry.description}</p><p>{entry.periodNote}</p>
        <Link className="button button--secondary" href={entry.href} prefetch={false}>開啟{entry.title}</Link>
      </article>)}</div>
    </section>}
    <section className={styles.notice} aria-label="尚未啟用的統計能力">
      <h2>正式統計仍待驗收</h2>
      <p>自訂分子／分母、跨分支比較、小樣本遮蔽與官方報表須先建立核准版本。目前不產生這些統計；不會將缺值當成 0，也不會自行決定遮蔽門檻。</p>
      <p>報表及匯出需要連線，不在離線保存範圍內。</p>
    </section>
  </div>;
}
