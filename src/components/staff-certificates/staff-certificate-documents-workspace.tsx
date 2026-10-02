import Link from "next/link";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { loadStaffCertificateDocumentWorkspace } from "@/lib/staff-certificate-documents/workspace-source";
import styles from "./staff-certificates.module.css";

const route = "/app/staff/operations/staff-certificates";
const clearHref = `${route}?view=documents`;
const scanLabels = { reserved: "上傳待確認", clean: "檔案檢查通過", infected: "檔案檢查未通過", failed: "檔案檢查失敗" };

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function ReadBoundary({ title, message, href = clearHref, label = "清除篩選並重試" }: {
  title: string; message: string; href?: string; label?: string;
}) {
  return <section className="empty-card" aria-labelledby="staff-documents-boundary" role="alert">
    <h1 id="staff-documents-boundary">{title}</h1><p>{message}</p>
    <Link className="button button--secondary" href={href} prefetch={false}>{label}</Link>
  </section>;
}

/** Read-only variant of page 72. Its source is independent of the legacy
 * executive record writer; document permissions never become writer grants. */
export async function StaffCertificateDocumentsWorkspace({ context, query, page }: {
  context: TenantContext; query: Record<string, string | string[] | undefined>; page: PageCatalogEntry;
}) {
  if (context.demo) return <ReadBoundary title="展示模式不讀取員工附件"
    message="正式員工文件不會混入示範資料。" href={route} label="回員工證照" />;
  if (!context.branchId || !context.scopes.includes("staff_certificates.read")) return <ReadBoundary
    title="沒有員工證照查閱權限" message="請洽機構管理員確認職務與資料範圍；系統未讀取員工資料。"
    href="/app/staff/workspace/dashboard" label="回今日工作" />;
  if (context.assuranceLevel !== "aal2") return <ReadBoundary title="請先確認身分"
    message="員工證照屬敏感資料，確認身分後再回到此頁查看。"
    href="/mfa?purpose=sensitive-action" label="確認身分" />;

  let result;
  try { result = await loadStaffCertificateDocumentWorkspace(context, query); }
  catch (error) {
    if (error instanceof IntegrationError && error.httpStatus === 400) return <ReadBoundary title="請重新選擇證照"
      message="員工、清單頁數或證照版本無法辨識。此入口只支援員工與清單頁數，尚未載入附件。" />;
    if (error instanceof IntegrationError && error.httpStatus === 403) return <ReadBoundary title="目前無法查看這份資料"
      message="資料範圍或授權已變更，請回到目前分支重新選擇；不會顯示其他員工的資料。" />;
    return <ReadBoundary title="員工證照資料暫時無法載入"
      message="請稍後重新載入。系統不會用示範資料或未核對的舊資料補位。" />;
  }
  const { sources, selected, documents } = result;
  const listHref = (targetPage: number) => {
    const params = new URLSearchParams({ view: "documents", page: String(targetPage) });
    if (sources.staffMembershipId) params.set("staff", sources.staffMembershipId);
    return `${route}?${params}`;
  };

  return <div className={styles.documentWorkspace}>
    <header className="page-heading"><div><p className="eyebrow">員工證照 · {context.branchName}</p>
      <h1>{page.title}</h1><p className="page-heading__description">選擇證照，查看原版本與附件狀態。</p>
    </div></header>
    <p className={styles.documentHint} role="note">此入口只供查閱，不提供上傳、核驗或下載；附件狀態不代表已核准服務資格。</p>

    <section className={`panel ${styles.documentSection}`} aria-labelledby="staff-document-selection">
      <h2 id="staff-document-selection">選擇證照</h2>
      <p>{sources.canManageDocuments ? "目前授權分支的證照" : "本人可見的證照"} · 共 {sources.total} 筆</p>
      {sources.rows.length ? <form action={route} method="get" noValidate className={styles.documentSelection}>
        <input type="hidden" name="view" value="documents" /><input type="hidden" name="page" value={sources.page} />
        {sources.staffMembershipId ? <input type="hidden" name="staff" value={sources.staffMembershipId} /> : null}
        {/* Named platform-owned select exception; reuse shared .field/.button
            geometry rather than introducing an authored popup or form owner. */}
        <label className="field"><span>員工與證照</span><select name="version" defaultValue={selected?.recordVersionId ?? ""} required>
          <option value="" disabled>請選擇證照</option>{sources.rows.map(row => <option key={row.recordVersionId} value={row.recordVersionId}>
            {row.displayName} · {row.certificateType} · 第 {row.version} 版{row.recordStatus === "voided" ? "（已作廢）" : ""}
          </option>)}</select></label>
        <button className="button button--primary" type="submit">查看附件</button>
      </form> : <><p role="status">{sources.total ? "這一頁沒有證照，請回到第一頁。" : "目前沒有可見的證照紀錄，請洽主管確認建檔。"}</p>
        {sources.total ? <Link className="button button--secondary" href={listHref(1)} prefetch={false}>回第一頁</Link> : null}</>}
      <nav aria-label="證照清單分頁" className={styles.documentPagination}>
        {sources.page > 1 ? <Link className="button button--secondary" href={listHref(sources.page - 1)} prefetch={false}>上一頁</Link>
          : <button className="button button--secondary" type="button" disabled>上一頁</button>}
        <span aria-current="page">第 {sources.page} 頁 · 本頁 {sources.rows.length} 筆</span>
        {sources.hasMore ? <Link className="button button--secondary" href={listHref(sources.page + 1)} prefetch={false}>下一頁</Link>
          : <button className="button button--secondary" type="button" disabled>下一頁</button>}
      </nav>
      <p className={styles.documentHint}>每頁 50 筆。更新：<time dateTime={sources.generatedAt}>{formatTime(sources.generatedAt)}</time></p>
    </section>

    {selected && documents ? <section className={`panel ${styles.documentSection}`} aria-labelledby="staff-document-history">
      <header><h2 id="staff-document-history">{selected.displayName} · {selected.certificateType}</h2>
        <p>第 {selected.version} 版 · {selected.recordStatus === "voided" ? "已作廢" : "選取版本"}</p></header>
      <dl className={styles.documentDates}><div><dt>生效日</dt><dd>{selected.effectiveOn}</dd></div>
        <div><dt>到期日</dt><dd>{selected.expiresOn ?? "未填，請洽主管確認"}</dd></div></dl>
      <p>附件共 {documents.total} 份{documents.truncated ? "，僅顯示最近 50 份，不代表完整歷程" : ""}。</p>
      {documents.documents.length ? <ul className={styles.documentList}>{documents.documents.map(document => <li key={document.documentId}>
        <h3>{scanLabels[document.scanStatus]}</h3>
        <p>{document.review?.decision === "verified" ? "已由獨立人員核驗" : document.review?.decision === "rejected"
          ? "人工核驗不通過" : document.scanStatus === "clean" ? "待第二人核驗" : "尚未核驗"}</p>
        <p>檔案：{document.mimeType === "application/pdf" ? "PDF" : document.mimeType === "image/png" ? "PNG" : "JPEG"}
          {" · "}{Math.ceil(document.fileSizeBytes / 1024)} KB</p>
        <p>{document.scanStatus === "reserved" ? "預留時間" : "原預留時間"}：<time dateTime={document.uploadedAt}>{formatTime(document.uploadedAt)}</time></p>
        {document.scanStatus === "reserved" ? <p className={styles.documentHint}>只確認已預留，尚未確認原檔已保存或檢查完成。</p> : null}
        {document.review ? <p>核驗時間：<time dateTime={document.review.reviewedAt}>{formatTime(document.review.reviewedAt)}</time></p> : null}
      </li>)}</ul> : <p role="status">這個版本尚無附件紀錄。</p>}
      <p className={styles.documentHint}>狀態更新：<time dateTime={documents.generatedAt}>{formatTime(documents.generatedAt)}</time>。重新載入才會取得最新查閱授權與狀態。</p>
    </section> : <section className={`panel ${styles.documentSection}`} aria-labelledby="staff-document-not-selected">
      <h2 id="staff-document-not-selected">先選擇一份證照</h2><p>選取後才會讀取該版本的附件，不會自動展開其他員工資料。</p>
    </section>}
  </div>;
}
