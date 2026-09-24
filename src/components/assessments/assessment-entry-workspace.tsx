import { ArrowRight, ClipboardList, FileWarning } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";

import styles from "./assessment-entry-workspace.module.css";

export function AssessmentEntryWorkspace({
  clients,
  error,
  pages,
  selectedClientId,
}: {
  clients: readonly ClientMasterItem[];
  error: boolean;
  pages: readonly PageCatalogEntry[];
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

  return <div className={styles.workspace}>
    <header className="page-heading">
      <div><p className="eyebrow">評估</p><h1>選個案</h1></div>
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
        <h2 id="assessment-shortcuts-title">可開啟的評估與紀錄</h2></div>
      {pages.length ? <ul className={styles.cards}>{pages.map((page) => <li key={page.slug}>
        <Link href={`/app/${page.slug}?client=${encodeURIComponent(selectedClient.id)}`}>
          <span>{page.title}<small>候選草稿</small></span><ArrowRight aria-hidden="true" />
        </Link>
      </li>)}</ul> : <p className={styles.empty} role="status">此帳號目前沒有可開啟的評估表單。</p>}
      <p className={styles.note}>草稿不等同正式量表結果；正式題本與簽署尚未啟用。</p>
    </section> : <p className={styles.prompt} role="status">選取個案後，這裡會列出可用表單。</p>}
  </div>;
}
