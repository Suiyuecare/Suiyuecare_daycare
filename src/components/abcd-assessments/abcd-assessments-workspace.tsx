import { AlertTriangle, Brain, CalendarClock, Clock3, FileWarning, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { AbcdAssessment, AbcdAssessmentFilters, AbcdAssessmentSnapshot } from "@/lib/abcd-assessments/types";

import { AbcdAssessmentActions, CreateAbcdAssessment } from "./abcd-assessment-actions";
import styles from "./abcd-assessments.module.css";

const STATE: Record<string, string> = { draft: "草稿", signed: "已簽署", corrected: "更正版" };
const VALUE: Record<string, string> = { recorded: "已記錄", missing: "缺值", not_applicable: "不適用" };
function taipei(value: string) { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

function History({ assessment }: { assessment: AbcdAssessment }) {
  return <details className={styles.history}><summary>版本與簽署證據（{assessment.historyTotal}）</summary>
    {assessment.historyTruncated ? <p>僅顯示最早 50 版；完整歷程仍保存在資料庫。</p> : null}
    <ol>{assessment.history.map((item) => <li key={item.versionId}><strong>v{item.version}・{STATE[item.assessmentState]}</strong>
      <span>{item.assessmentYear} 年・{item.assessmentType} 類・{item.assessmentDate}</span>
      <span>建立 {taipei(item.createdAt)}・{item.authorDisplayName}・內容指紋 {item.contentHash.slice(0, 10)}…</span>
      {item.signedAt && item.signerDisplayName && item.signaturePurpose ? <>
        <span>簽署人：{item.signerDisplayName}（{item.signerRoleKeys?.join("、")}）</span>
        <span>伺服器簽署時間：{taipei(item.signedAt)}・目的：{item.signaturePurpose}</span>
        <span>重驗證證據：{item.signatureReauthChallengeId?.slice(0, 8)}…</span>
      </> : <span>此版尚未簽署</span>}
      {item.revisionReason ? <span>草稿理由：{item.revisionReason}</span> : null}
      {item.correctionReason ? <span>更正理由：{item.correctionReason}</span> : null}</li>)}</ol></details>;
}

function ManualDetails({ assessment }: { assessment: AbcdAssessment }) {
  return <div className={styles.manual}><p className={styles.manualSummary}>{assessment.manualSummary}</p><dl>
    <div><dt>人工結果 <span className={`${styles.fieldState} ${styles[`field_${assessment.result.state}`]}`}>
      {VALUE[assessment.result.state]}</span></dt><dd>{assessment.result.text ?? assessment.result.reason}</dd></div>
    <div><dt>人工複評日期 <span className={`${styles.fieldState} ${styles[`field_${assessment.reassessment.state}`]}`}>
      {VALUE[assessment.reassessment.state]}</span></dt><dd>{assessment.reassessment.date ?? "未設定日期"}・依據：{assessment.reassessment.basis}</dd></div>
  </dl><p className={styles.noInference}><Brain aria-hidden="true" /> 此頁不含正式題目、公式、分數、診斷、自動複評或照顧決策。</p>
    <History assessment={assessment} /></div>;
}

export function AbcdAssessmentsWorkspace({ page, snapshot, filters, loadError, canManage, hasRecentAal2 }: {
  page: PageCatalogEntry; snapshot: AbcdAssessmentSnapshot | null; filters: AbcdAssessmentFilters;
  loadError: boolean; canManage: boolean; hasRecentAal2: boolean;
}) {
  if (loadError || !snapshot) return <div className="workspace-page"><section className="empty-card core-care-state">
    <FileWarning aria-hidden="true" /><h1>{page.title}</h1><p>篩選條件無效，或正式 ABCD 候選評估快照暫時無法取得。</p>
    <Link className="button button--secondary" href="?">清除篩選並重試</Link></section></div>;
  const basePath = `/app/${page.slug}`;
  const metrics = [{ label: "符合評估", value: snapshot.metrics.assessmentTotal },
    { label: "A 類", value: snapshot.metrics.aTotal }, { label: "B 類", value: snapshot.metrics.bTotal },
    { label: "C 類", value: snapshot.metrics.cTotal }, { label: "D 類", value: snapshot.metrics.dTotal },
    { label: "複評日期缺值", value: snapshot.metrics.reassessmentMissingTotal },
    { label: "草稿", value: snapshot.metrics.draftTotal }, { label: "已簽／更正", value: snapshot.metrics.signedTotal }];
  return <div className="workspace-page"><header className="page-heading core-care-heading"><div>
    <p className="eyebrow">評估量表・Page 21</p><h1>{page.title}</h1>
    <p className="page-heading__description">{page.description} 個案、年度與 A／B／C／D 類型共同定義一條獨立且不可變的版本鏈。</p></div>
    <div className={`page-heading__actions ${styles.headerMeta}`}><span><ShieldCheck aria-hidden="true" /> 指派個案隔離</span>
      <span><Clock3 aria-hidden="true" /> 更新 {taipei(snapshot.generatedAt)}</span></div></header>
    <section aria-label="ABCD 評估規則邊界" className={styles.boundary}><AlertTriangle aria-hidden="true" />
      <div><strong>人工、非標準化候選紀錄</strong><p>正式 A／B／C／D 題本、公式、代碼與授權來源尚未配置。</p>
      <p>此頁只保存人工摘要、結果三態／理由及人工複評日期三態／依據；不冒充正式評估，也不產生分數、診斷、自動複評或照顧決策。</p>
      <p>附件、通知、匯出與離線功能也尚未配置；相關正式操作目前不開放。</p></div></section>
    {snapshot.demo ? <p className="demo-banner">目前為合成展示資料；所有正式寫入操作均關閉。</p> : null}
    <CreateAbcdAssessment canManage={canManage} snapshot={snapshot} />
    <section aria-label="ABCD 候選評估統計" className={`metric-grid ${styles.metrics}`}>{metrics.map((item) =>
      <article className="metric-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong>
        <small>完整符合集合</small></article>)}</section>
    <form action={basePath} className={styles.filters} method="get">
      <label><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client"><option value="">全部授權個案</option>
        {snapshot.clients.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName}</option>)}</select></label>
      <label><span>年度</span><select defaultValue={filters.assessmentYear ?? ""} name="year"><option value="">全部年度</option>
        {snapshot.years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>類型</span><select defaultValue={filters.assessmentType} name="type"><option value="all">全部</option>
        {(["A", "B", "C", "D"] as const).map((value) => <option key={value} value={value}>{value} 類</option>)}</select></label>
      <label><span>複評狀態</span><select defaultValue={filters.reassessmentState} name="reassessment"><option value="all">全部</option>
        {Object.entries(VALUE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>紀錄狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部</option>
        {Object.entries(STATE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>個案名稱或評估代碼</span><input defaultValue={filters.query ?? ""} maxLength={120} name="q" type="search" /></label>
      <div className={styles.filterActions}><button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href={basePath}>清除</Link></div></form>
    <section aria-labelledby="abcd-assessment-list" className={styles.records}><div className={styles.sectionHeading}><div>
      <p className="eyebrow">同一不可變快照</p><h2 id="abcd-assessment-list">人工候選評估</h2></div>
      <p>{snapshot.assessments.length} / {snapshot.matchingTotal} 筆</p></div>
      {snapshot.assessmentsTruncated ? <p role="status">清單只顯示最新 200 筆；統計仍使用完整符合集合，請縮小篩選。</p> : null}
      {!snapshot.assessments.length ? <section className="empty-card"><CalendarClock aria-hidden="true" /><h3>沒有符合條件的候選評估</h3>
        <p>請調整個案、年度、類型、複評狀態、紀錄狀態或查詢；系統不會擴大至其他分支或未指派個案。</p></section> : <>
        <div aria-label="可水平捲動的 ABCD 評估表格" className={styles.tableWrap} role="region" tabIndex={0}><table className={styles.table}>
          <thead><tr><th>個案／評估日</th><th>年度／類型／狀態</th><th>人工內容</th><th>版本</th><th>操作</th></tr></thead>
          <tbody>{snapshot.assessments.map((assessment) => <tr key={assessment.assessmentKey}><td><strong>{assessment.clientDisplayName}</strong>
            <small>{assessment.assessmentDate}</small></td><td>{assessment.assessmentYear} 年・{assessment.assessmentType} 類
            <small>{STATE[assessment.assessmentState]}</small></td><td><ManualDetails assessment={assessment} /></td>
            <td>v{assessment.version}<small>{assessment.authorDisplayName}</small></td><td>
              <AbcdAssessmentActions assessment={assessment} branchId={snapshot.branchId}
                canManage={canManage} hasRecentAal2={hasRecentAal2}
                organizationId={snapshot.organizationId} /></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.assessments.map((assessment) => <article key={assessment.assessmentKey}>
          <div className={styles.cardHeading}><div><h3>{assessment.clientDisplayName}</h3>
            <small>{assessment.assessmentDate}・{assessment.assessmentYear} 年・{assessment.assessmentType} 類</small></div>
            <span className={`${styles.pill} ${styles[`pill_${assessment.assessmentState}`]}`}>{STATE[assessment.assessmentState]}</span></div>
          <ManualDetails assessment={assessment} /><AbcdAssessmentActions assessment={assessment}
            branchId={snapshot.branchId} canManage={canManage} hasRecentAal2={hasRecentAal2}
            organizationId={snapshot.organizationId} /></article>)}</div></>}
    </section></div>;
}
