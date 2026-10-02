import { ArrowRight, ClipboardList, FileWarning } from "lucide-react";
import Link from "next/link";

import { NavigationLink } from "@/components/app/navigation-link";
import { assessmentQuestionnaireFormKey } from "@/lib/assessment-entry/selection";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import type { QuestionnaireResumeSummary } from "@/lib/questionnaire-assessments/resume-summary";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import { AssessmentClientPicker } from "./assessment-client-picker";

import styles from "./assessment-entry-workspace.module.css";

function taipeiSavedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function AssessmentEntryWorkspace({
  clients,
  error,
  pages,
  selectedClientId,
  selectionRejected = false,
  demo = false,
  resume,
  resumeError = false,
  manageableFormKeys = [],
}: {
  clients: readonly Pick<ClientMasterItem, "id" | "displayName" | "clientCode">[];
  error: boolean;
  pages: readonly PageCatalogEntry[];
  selectedClientId: string | null;
  selectionRejected?: boolean;
  demo?: boolean;
  resume?: QuestionnaireResumeSummary | null;
  resumeError?: boolean;
  manageableFormKeys?: readonly QuestionnaireFormKey[];
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
  const candidateDrafts = pages.filter((page) => assessmentQuestionnaireFormKey(page.number) !== null);
  const observationDrafts = pages.filter((page) => [35].includes(page.number));
  const manualRecords = pages.filter((page) =>
    assessmentQuestionnaireFormKey(page.number) === null && page.number !== 35);

  const verifiedResume = !demo && selectedClient !== null && !resumeError && resume?.clientId === selectedClient.id &&
    taipeiSavedAt(resume.generatedAt)
    ? resume : null;
  const resumeUnavailable = !demo && selectedClient !== null && !verifiedResume;

  function candidatePresentation(page: PageCatalogEntry) {
    const formKey = assessmentQuestionnaireFormKey(page.number)!;
    const basicHref = `/app/${page.slug}?${new URLSearchParams({ client: selectedClient!.id })}`;
    if (demo) return { href: basicHref, status: "展示資料不可保存", action: "查看量表" };
    const matches = verifiedResume?.forms.filter((item) => item.formKey === formKey) ?? [];
    if (matches.length !== 1) return { href: basicHref, status: "草稿狀態無法確認", action: "開啟量表" };
    const canManage = manageableFormKeys.includes(formKey);
    const latest = matches[0]!.latest;
    if (!latest) return { href: basicHref, status: "尚無已保存草稿", action: canManage ? "開始填寫" : "開啟量表" };
    const savedAt = taipeiSavedAt(latest.savedAt);
    if (!savedAt) return { href: basicHref, status: "草稿狀態無法確認", action: "開啟量表" };
    const params = new URLSearchParams({
      client: selectedClient!.id,
      assessment: latest.assessmentKey,
      version: latest.versionId,
    });
    return {
      href: `/app/${page.slug}?${params}`,
      status: `草稿 · 最近保存 ${savedAt}`,
      action: canManage ? "接續填寫" : "查看草稿",
    };
  }

  return <div className={styles.workspace}>
    <header className="page-heading">
      <div><p className="eyebrow">評估工作入口</p><h1>{selectedClient ? "選擇評估表" : "先選個案"}</h1></div>
    </header>
    <AssessmentClientPicker clients={clients.map(({ id, displayName, clientCode }) => ({ id, displayName, clientCode }))}
      key={`${selectedClient?.id ?? "none"}:${clients.map((client) => client.id).join(",")}`}
      selectedClientId={selectedClient?.id ?? null}>
    {selectionRejected ? <p className={styles.rejected} role="alert">這位個案目前無法選取。請從可查看的名單重新選擇。</p> : null}
    {clients.length === 0 ? <div className={styles.empty} role="status">目前沒有可查看的個案。</div> : null}
    {selectedClient ? <section aria-labelledby="assessment-shortcuts-title" className={styles.results} id="assessment-forms" tabIndex={-1}>
      <div className={styles.sectionTitle}><ClipboardList aria-hidden="true" />
        <h2 id="assessment-shortcuts-title">{selectedClient.displayName}的評估表</h2>
        <span className={styles.clientCode}>{selectedClient.clientCode}</span></div>
      {pages.length ? <>
        {candidateDrafts.length ? <section aria-label="題目式量表">
          <h3 className={styles.groupTitle}>{demo ? "展示量表（不可保存）" : "題目式量表"}</h3>
          {verifiedResume ? <p className={styles.resumeAsOf}>資料截至 {taipeiSavedAt(verifiedResume.generatedAt)}</p> : null}
          {resumeUnavailable ? <p className={styles.resumeUnavailable} role="status">草稿狀態暫時無法確認。可開啟量表核對。</p> : null}
          <ul className={styles.cards}>{candidateDrafts.map((page) => {
            const entry = candidatePresentation(page);
            return <li key={page.slug}>
              <NavigationLink href={entry.href} loadingLabel={page.title} prefetch={false}>
                <span className={styles.cardMain}><strong>{page.title}</strong><small>{entry.status}</small>
                  {page.number === 18 ? <small>含安全關懷題</small> : null}</span>
                <span className={styles.cardAction}>{entry.action}</span>
                <ArrowRight aria-hidden="true" />
              </NavigationLink>
            </li>;
          })}</ul>
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
