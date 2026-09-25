import { ArrowRight, ClipboardList, FileWarning } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";

import styles from "./assessment-entry-workspace.module.css";

export function AssessmentEntryWorkspace({
  clients,
  error,
  pages,
  unavailablePages,
  selectedClientId,
}: {
  clients: readonly ClientMasterItem[];
  error: boolean;
  pages: readonly PageCatalogEntry[];
  unavailablePages: readonly PageCatalogEntry[];
  selectedClientId: string | null;
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
  const candidateDraftNumbers = new Set([11, 12, 13, 21]);
  const candidateDrafts = pages.filter((page) => candidateDraftNumbers.has(page.number));
  const observationDrafts = pages.filter((page) => [14, 35].includes(page.number));
  const manualRecords = pages.filter((page) =>
    !candidateDraftNumbers.has(page.number) && ![14, 35].includes(page.number));

  function unavailableReason(number: number) {
    if (number === 36) return "MNA 電子題本授權與正式填寫流程尚未確認";
    if (number === 17) return "尚未核定本機構採用的吞嚥評估工具與流程";
    return "正式題本／版本與安全保存流程尚未核准";
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
          <h3 className={styles.groupTitle}>候選草稿・非正式量表</h3>
          <ul className={styles.cards}>{candidateDrafts.map((page) => <li key={page.slug}>
            <Link href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`}>
              <span>{page.title}<small>題文／規則尚未核准・不計正式分數</small></span>
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
          <div aria-disabled="true" className={styles.unavailable}>
            <span>{page.title}<small>{unavailableReason(page.number)}</small></span>
            <span className={styles.lockedLabel}>待核准</span>
          </div>
        </li>)}</ul>
      </section> : null}
      <p className={styles.note}>正式量表仍待核定題本、計分版本與保存驗收；目前草稿不作正式評估或照顧決策。</p>
    </section> : <p className={styles.prompt} role="status">選取個案後，這裡會列出可用表單。</p>}
  </div>;
}
