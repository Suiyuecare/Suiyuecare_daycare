import { ArrowRight, ClipboardList, FileWarning } from "lucide-react";
import Link from "next/link";

import { NavigationLink } from "@/components/app/navigation-link";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import { AssessmentClientPicker } from "./assessment-client-picker";

import styles from "./assessment-entry-workspace.module.css";

export function AssessmentEntryWorkspace({
  clients,
  error,
  pages,
  selectedClientId,
  selectionRejected = false,
  demo = false,
}: {
  clients: readonly Pick<ClientMasterItem, "id" | "displayName" | "clientCode">[];
  error: boolean;
  pages: readonly PageCatalogEntry[];
  selectedClientId: string | null;
  selectionRejected?: boolean;
  demo?: boolean;
}) {
  if (error) return <section className="empty-card" role="alert">
    <span className="empty-card__icon empty-card__icon--warning"><FileWarning aria-hidden="true" /></span>
    <h1>個案清單載入失敗</h1>
    <p>資料沒有變更。請重新載入。</p>
    <Link className="button button--secondary" href="/app/assessments">重新載入</Link>
  </section>;

  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId) ?? null
    : null;
  const candidateDraftNumbers = new Set([11, 12, 13, 14, 15, 16, 17, 18, 36]);
  const candidateDrafts = pages.filter((page) => candidateDraftNumbers.has(page.number));
  const observationDrafts = pages.filter((page) => [35].includes(page.number));
  const manualRecords = pages.filter((page) =>
    !candidateDraftNumbers.has(page.number) && ![14, 35].includes(page.number));

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
    <AssessmentClientPicker clients={clients.map(({ id, displayName, clientCode }) => ({ id, displayName, clientCode }))}
      key={`${selectedClient?.id ?? "none"}:${clients.map((client) => client.id).join(",")}`}
      selectedClientId={selectedClient?.id ?? null}>
    {selectionRejected ? <p className={styles.rejected} role="alert">這位個案目前無法選取。請從可查看的名單重新選擇。</p> : null}
    {clients.length === 0 ? <div className={styles.empty} role="status">目前沒有可查看的個案。</div> : null}
    {selectedClient ? <section aria-labelledby="assessment-shortcuts-title" className={styles.results}>
      <div className={styles.selected}><span>目前個案</span><strong>{selectedClient.displayName}</strong>
        <small>{selectedClient.clientCode}</small></div>
      <div className={styles.sectionTitle}><ClipboardList aria-hidden="true" />
        <h2 id="assessment-shortcuts-title">開始評估</h2></div>
      {pages.length ? <>
        {candidateDrafts.length ? <section aria-label="題目式量表">
          <h3 className={styles.groupTitle}>{demo ? "展示量表（不可保存）" : "題目式量表"}</h3>
          <ul className={styles.cards}>{candidateDrafts.map((page) => <li key={page.slug}>
            <NavigationLink href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`} loadingLabel={page.title} prefetch={false}>
              <span>{page.title}<small>{candidateDescription(page.number)}</small></span>
              <ArrowRight aria-hidden="true" />
            </NavigationLink>
          </li>)}</ul>
        </section> : null}
        {observationDrafts.length ? <details className={styles.moreForms}>
          <summary>人工觀察草稿 <span>{observationDrafts.length}</span></summary>
          <ul className={styles.cards}>{observationDrafts.map((page) => <li key={page.slug}>
            <NavigationLink href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`} loadingLabel={page.title} prefetch={false}>
              <span>{page.title}<small>人工觀察・不自動計分</small></span>
              <ArrowRight aria-hidden="true" />
            </NavigationLink>
          </li>)}</ul>
        </details> : null}
        {manualRecords.length ? <details className={styles.moreForms}>
          <summary>人工評估與照顧紀錄 <span>{manualRecords.length}</span></summary>
          <ul className={styles.cards}>{manualRecords.map((page) => <li key={page.slug}>
            <NavigationLink href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`} loadingLabel={page.title} prefetch={false}>
              <span>{page.title}<small>人工紀錄 · 不自動計分</small></span>
              <ArrowRight aria-hidden="true" />
            </NavigationLink>
          </li>)}</ul>
        </details> : null}
      </> : <p className={styles.empty} role="status">此帳號目前沒有可開啟的評估表單。</p>}
      {demo ? <p className={styles.demoNote} role="status">展示資料僅供試看；不可保存或簽署。</p> : null}
      <details className={styles.guidance}><summary>填寫前須知</summary>
        <p>{demo ? "僅供合成資料試看。" : "保存與簽署依您的個案分工與表單權限；結果仍須專業判讀。"}</p>
        <p>外部評估結果登錄尚未開放，請勿在此輸入敏感資料。</p>
      </details>
    </section> : clients.length ? <p className={styles.prompt} role="status">選取個案後，這裡會列出可用表單。</p> : null}
    </AssessmentClientPicker>
  </div>;
}
