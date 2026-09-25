import { ArrowRight, ClipboardList, FileWarning } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import type { ExternalAssessmentInstrument } from "@/lib/external-assessment-results/contract";
import { ExternalAssessmentResultsWorkspace } from "@/components/external-assessment-results/external-assessment-results-workspace";

import styles from "./assessment-entry-workspace.module.css";

export function AssessmentEntryWorkspace({
  clients,
  error,
  pages,
  unavailablePages,
  selectedClientId,
  initialExternalInstrument = null,
  canReadExternalResults = false,
  canWriteExternalResults = false,
}: {
  clients: readonly ClientMasterItem[];
  error: boolean;
  pages: readonly PageCatalogEntry[];
  unavailablePages: readonly PageCatalogEntry[];
  selectedClientId: string | null;
  initialExternalInstrument?: ExternalAssessmentInstrument | null;
  canReadExternalResults?: boolean;
  canWriteExternalResults?: boolean;
}) {
  if (error) return <section className="empty-card" role="alert">
    <span className="empty-card__icon empty-card__icon--warning"><FileWarning aria-hidden="true" /></span>
    <h1>個案清單載入失敗</h1>
    <p>資料沒有變更。請重新載入。</p>
    <Link className="button button--secondary" href="/app/staff/assessments/swallowing">重新載入</Link>
  </section>;

  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId) ?? null
    : null;
  const candidateDraftNumbers = new Set([11, 12, 13, 14, 15, 16, 17, 18, 36]);
  const candidateDrafts = pages.filter((page) => candidateDraftNumbers.has(page.number));
  const observationDrafts = pages.filter((page) => [35].includes(page.number));
  const manualRecords = pages.filter((page) =>
    !candidateDraftNumbers.has(page.number) && ![14, 35].includes(page.number));

  function unavailableReason(number: number) {
    if ([11, 12, 13, 14, 15, 16, 17, 18, 36].includes(number)) return "逐題作答、固定版本計分預覽與草稿保存已提供；結果仍需人員判讀";
    return "完整逐題表單與安全保存流程尚未接通";
  }

  function candidateDescription(number: number) {
    const labels: Record<number, string> = {
      11: "SPMSQ・10 題",
      12: "GDS-15・15 題",
      13: "臺北市 B12 跌倒風險・12 項",
      14: "NSI DETERMINE・10 題",
      15: "Barthel ADL・10 項",
      16: "IADL・8 領域",
      17: "EAT-10 吞嚥篩檢・10 題",
      18: "BSRS-5 心情溫度計・含安全關懷題",
      36: "MNA-SF・6 題",
    };
    return labels[number] ?? "可填寫草稿；正式簽署仍須人工覆核";
  }

  return <div className={styles.workspace}>
    <header className="page-heading">
      <div><p className="eyebrow">評估工作入口</p><h1>先選個案</h1></div>
    </header>
    <form action="/app/staff/assessments/swallowing" className={styles.picker} method="get">
      <label htmlFor="assessment-client">個案</label>
      <select defaultValue={selectedClientId ?? ""} id="assessment-client" name="client" required>
        <option disabled value="">選擇個案</option>
        {clients.map((client) => <option key={client.id} value={client.id}>
          {client.displayName} · {client.clientCode}
        </option>)}
      </select>
      <button className="button button--primary" type="submit">開始<ArrowRight aria-hidden="true" /></button>
    </form>
    {clients.length === 0 ? <div className={styles.empty} role="status">目前沒有可查看的個案。</div> : null}
    {selectedClient ? <section aria-labelledby="assessment-shortcuts-title" className={styles.results}>
      <div className={styles.selected}><span>目前個案</span><strong>{selectedClient.displayName}</strong>
        <small>{selectedClient.clientCode}</small></div>
      <div className={styles.sectionTitle}><ClipboardList aria-hidden="true" />
        <h2 id="assessment-shortcuts-title">開始評估</h2></div>
      {pages.length ? <>
        {candidateDrafts.length ? <section aria-label="候選量表草稿">
          <h3 className={styles.groupTitle}>可填寫量表草稿</h3>
          <ul className={styles.cards}>{candidateDrafts.map((page) => <li key={page.slug}>
            <Link href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`}>
              <span>{page.title}<small>{candidateDescription(page.number)}</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </li>)}</ul>
        </section> : null}
        {observationDrafts.length ? <section aria-label="人工觀察草稿">
          <h3 className={styles.groupTitle}>人工觀察草稿</h3>
          <ul className={styles.cards}>{observationDrafts.map((page) => <li key={page.slug}>
            <Link href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`}>
              <span>{page.title}<small>人工觀察・不自動計分</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </li>)}</ul>
        </section> : null}
        {manualRecords.length ? <section aria-label="人工評估紀錄">
          <h3 className={styles.groupTitle}>人工評估與照顧紀錄</h3>
          <ul className={styles.cards}>{manualRecords.map((page) => <li key={page.slug}>
            <Link href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`}>
              <span>{page.title}<small>人工紀錄 · 不自動計分</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </li>)}</ul>
        </section> : null}
      </> : <p className={styles.empty} role="status">此帳號目前沒有可開啟的評估表單。</p>}
      {unavailablePages.length ? <section aria-label="尚未開放的正式量表">
        <h3 className={styles.groupTitle}>尚未開放正式填寫</h3>
        <ul className={`${styles.cards} ${styles.unavailableCards}`}>{unavailablePages.map((page) => <li key={page.slug}>
          <Link className={styles.unavailable} href={`/app/staff/assessments/swallowing?client=${encodeURIComponent(selectedClient.id)}&externalInstrument=${instrumentForPage(page.number)}#external-result-entry`}>
            <span>{page.title}<small>{unavailableReason(page.number)}</small></span>
            <span className={styles.lockedLabel}>登錄外部結果</span>
          </Link>
        </li>)}</ul>
      </section> : null}
      <p className={styles.note}>答案會以草稿版本保存；請核對每題與結果，再由具權限人員作專業判讀及後續決定。</p>
      {canReadExternalResults
        ? <ExternalAssessmentResultsWorkspace clientId={selectedClient.id} initialInstrument={initialExternalInstrument}
          canWrite={canWriteExternalResults} />
        : <p className={styles.note}>外部結果登錄需具備日常照顧紀錄查閱權限。</p>}
    </section> : <p className={styles.prompt} role="status">選取個案後，這裡會列出可用表單。</p>}
  </div>;
}

function instrumentForPage(number: number): ExternalAssessmentInstrument {
  const byPage: Record<number, ExternalAssessmentInstrument> = {
    11: "spmsq", 12: "gds", 13: "fall_risk", 14: "nsi", 15: "barthel_adl",
    16: "iadl", 17: "swallowing", 18: "bsrs", 35: "chewing", 36: "mna",
  };
  return byPage[number] ?? "barthel_adl";
}
