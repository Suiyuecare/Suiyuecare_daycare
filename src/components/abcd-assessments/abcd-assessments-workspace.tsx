import { AlertTriangle, Brain, CalendarClock, Clock3, FileWarning, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { AbcdAssessment, AbcdAssessmentFilters, AbcdAssessmentSnapshot } from "@/lib/abcd-assessments/types";

import { AbcdAssessmentActions, CreateAbcdAssessment } from "./abcd-assessment-actions";
import { AbcdClientPicker } from "./abcd-client-picker";
import { AbcdOperationRecovery } from "./abcd-operation-recovery";
import { AbcdRecoveryGateProvider } from "./abcd-recovery-gate";
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
  return <div className={styles.manual}>
    <div className={styles.quickFacts}>
      <span>人工結果：<strong>{VALUE[assessment.result.state]}</strong></span>
      <span>複評：<strong>{assessment.reassessment.date ?? VALUE[assessment.reassessment.state]}</strong></span>
    </div>
    <details className={styles.manualDisclosure}><summary>查看人工內容與版本</summary><div className={styles.manualContent}>
      <p className={styles.manualSummary}>{assessment.manualSummary}</p><dl>
        <div><dt>人工結果 <span className={`${styles.fieldState} ${styles[`field_${assessment.result.state}`]}`}>
          {VALUE[assessment.result.state]}</span></dt><dd>{assessment.result.text ?? assessment.result.reason}</dd></div>
        <div><dt>人工複評日期 <span className={`${styles.fieldState} ${styles[`field_${assessment.reassessment.state}`]}`}>
          {VALUE[assessment.reassessment.state]}</span></dt><dd>{assessment.reassessment.date ?? "未設定日期"}・依據：{assessment.reassessment.basis}</dd></div>
      </dl><p className={styles.noInference}><Brain aria-hidden="true" /> 無正式分數、診斷或自動照顧決策。</p>
      <History assessment={assessment} />
    </div></details>
  </div>;
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
  const selectedClient = snapshot.clients.find((client) => client.clientId === filters.clientId);
  const hasAdvancedFilters = filters.assessmentYear !== null || filters.assessmentType !== "all" ||
    filters.reassessmentState !== "all" || filters.status !== "all" || Boolean(filters.query);
  return <div className="workspace-page"><header className="page-heading core-care-heading"><div>
    <p className="eyebrow">評估量表</p><h1>{page.title}</h1>
    <p className="page-heading__description">選個案，建立或查看 A／B／C／D 人工評估。</p></div>
    <p className={styles.updatedAt}><Clock3 aria-hidden="true" /> 更新 {taipei(snapshot.generatedAt)}</p></header>
    <section aria-labelledby="abcd-select-client" className={styles.taskPanel}><div className={styles.taskHeading}>
      <h2 id="abcd-select-client">先選個案</h2><span><ShieldCheck aria-hidden="true" /> 僅顯示授權個案</span></div>
      <form action={basePath} className={styles.filters} method="get" noValidate>
        <div className={styles.primaryFilters}><input name="client" type="hidden" value={filters.clientId ?? ""} />
          <AbcdClientPicker basePath={basePath} branchId={snapshot.branchId} demo={snapshot.demo}
            demoClients={snapshot.clients} filters={filters} organizationId={snapshot.organizationId}
            selectedClientName={selectedClient?.displayName ?? null} />
          {filters.clientId || hasAdvancedFilters ? <Link className="button button--quiet" href={basePath}>清除篩選</Link> : null}</div>
        <details className={styles.advancedFilters} open={hasAdvancedFilters || undefined}><summary>更多篩選{hasAdvancedFilters ? "（已套用）" : ""}</summary>
          <div className={styles.advancedGrid}>
            <label><span>年度</span><select defaultValue={filters.assessmentYear ?? ""} name="year"><option value="">全部年度</option>
              {snapshot.years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>類型</span><select defaultValue={filters.assessmentType} name="type"><option value="all">全部</option>
              {(["A", "B", "C", "D"] as const).map((value) => <option key={value} value={value}>{value} 類</option>)}</select></label>
            <label><span>複評狀態</span><select defaultValue={filters.reassessmentState} name="reassessment"><option value="all">全部</option>
              {Object.entries(VALUE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>紀錄狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部</option>
              {Object.entries(STATE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.searchFilter}><span>個案名稱或評估代碼</span><input defaultValue={filters.query ?? ""} maxLength={120} name="q" type="search" /></label>
          </div><div className={styles.filterActions}><button className="button button--secondary" type="submit">套用篩選</button></div>
        </details>
      </form></section>
    <section aria-label="ABCD 評估規則邊界" className={styles.boundary}><AlertTriangle aria-hidden="true" />
      <div><strong>人工、非標準化候選紀錄</strong><p>不是正式 ABCD 量表；沒有正式分數、診斷、自動複評或照顧決策。</p>
      <details className={styles.boundaryDetails}><summary>查看尚未開通的正式功能</summary>
        <p>正式 A／B／C／D 題本、公式、代碼與授權來源尚未配置；目前只保存人工摘要、結果三態／理由及人工複評日期三態／依據。</p>
        <p>附件、通知、匯出與離線功能也尚未配置，不能當成正式評估結果。</p>
      </details></div></section>
    {snapshot.demo ? <p className="demo-banner">目前為合成展示資料；所有正式寫入操作均關閉。</p> : null}
    <AbcdRecoveryGateProvider scope={`${snapshot.organizationId}:${snapshot.branchId}:${filters.clientId ?? "all"}:${canManage && !snapshot.demo}`}>
    <AbcdOperationRecovery branchId={snapshot.branchId} clients={snapshot.clients} enabled={canManage && !snapshot.demo}
      hasRecentAal2={hasRecentAal2} key={`${snapshot.organizationId}:${snapshot.branchId}:${filters.clientId ?? "all"}`}
      organizationId={snapshot.organizationId} selectedClientId={filters.clientId} />
    <CreateAbcdAssessment canManage={canManage} selectedClientId={filters.clientId} snapshot={snapshot} />
    <section aria-labelledby="abcd-assessment-list" className={styles.records}><div className={styles.sectionHeading}><div>
      <h2 id="abcd-assessment-list">{selectedClient ? `${selectedClient.displayName}的評估` : "人工候選評估"}</h2></div>
      <p>{snapshot.assessments.length} / {snapshot.matchingTotal} 筆</p></div>
      {snapshot.assessmentsTruncated ? <p role="status">清單只顯示最新 200 筆；統計仍使用完整符合集合，請縮小篩選。</p> : null}
      {!snapshot.assessments.length ? <section className="empty-card"><CalendarClock aria-hidden="true" /><h3>沒有符合條件的候選評估</h3>
        <p>請選其他個案，或展開「更多篩選」調整條件。</p></section> : <>
        <div className={styles.recordCards}>{snapshot.assessments.map((assessment) => <article
          className={styles.recordCard} key={assessment.assessmentKey}>
          <div className={styles.cardHeading}><div><h3>{assessment.clientDisplayName}</h3>
            <small>{assessment.assessmentDate}・{assessment.assessmentYear} 年・{assessment.assessmentType} 類</small></div>
            <span className={`${styles.pill} ${styles[`pill_${assessment.assessmentState}`]}`}>{STATE[assessment.assessmentState]}</span></div>
          <p className={styles.recordMeta}>v{assessment.version}・{assessment.authorDisplayName}</p>
          <div className={styles.recordBody}><ManualDetails assessment={assessment} /></div>
          <div className={styles.recordAction}><AbcdAssessmentActions assessment={assessment}
            branchId={snapshot.branchId} canManage={canManage} hasRecentAal2={hasRecentAal2}
            organizationId={snapshot.organizationId} /></div></article>)}</div></>}
    </section>
    </AbcdRecoveryGateProvider>
    <details className={styles.metricsDisclosure}><summary>完整統計（{snapshot.metrics.assessmentTotal} 筆）</summary>
      <section aria-label="ABCD 候選評估統計" className={`metric-grid ${styles.metrics}`}>{metrics.map((item) =>
        <article className="metric-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</section>
    </details></div>;
}
