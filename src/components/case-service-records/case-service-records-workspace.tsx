"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { SnapshotFreshness } from "@/components/ui/snapshot-freshness";
import type { PageCatalogEntry } from "@/lib/catalog";
import { parseCaseServiceRecordMutation } from "@/lib/case-service-records/parser";
import type { CaseServiceRecord, CaseServiceRecordFilters, CaseServiceRecordSnapshot,
  CaseServiceRecordVersion } from "@/lib/case-service-records/types";

import { ConfirmedRecordFailure, type RecordOperation, sendRecordOperation } from "./case-service-record-request";
import styles from "./case-service-records.module.css";

const STATUS = { draft: "草稿", signed: "已簽署", corrected: "已簽更正版" } as const;
const EXECUTION = { not_linked: "未連結執行來源", verified_completed: "已核對完成的執行來源",
  changed_or_unavailable: "執行來源已變更或不可用" } as const;
type Editor = { mode: "create"; record: null } |
  { mode: "revise" | "sign" | "correct"; record: CaseServiceRecord };
type State = { kind: "idle" | "working" | "error" | "unknown" | "success"; message: string };

function taipei(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  // Explicit separators avoid Node/Chromium ICU whitespace differences during hydration.
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
function localInput(value: string | undefined) {
  return value ? new Date(Date.parse(value) + 8 * 60 * 60 * 1_000).toISOString().slice(0, 19) : "";
}

function VersionContent({ record }: { record: CaseServiceRecordVersion }) {
  return <dl><div><dt>服務期間（台北）</dt><dd>{taipei(record.startedAt)} ～ {taipei(record.endedAt)}</dd></div>
    <div><dt>紀錄作者</dt><dd>{record.authorDisplayName}</dd></div>
    <div className={styles.wide}><dt>人工服務內容</dt><dd>{record.serviceContent}</dd></div>
    <div className={styles.wide}><dt>人工服務結果</dt><dd>{record.serviceResult}</dd></div>
    <div><dt>執行來源核對</dt><dd>{EXECUTION[record.executionReferenceVerification]}</dd></div>
    <div><dt>簽署人／時間</dt><dd>{record.signedAt ?
      `${record.signerDisplayName}・${taipei(record.signedAt)}` : "尚未簽署"}</dd></div></dl>;
}
function History({ record }: { record: CaseServiceRecord }) {
  return <details className={styles.history}><summary>檢視版本、理由與簽署證據（{record.historyTotal} 版）</summary>
    {record.historyTruncated ? <p role="status">目前僅列出最近 {record.history.length} 版；歷史仍保存，但本頁關閉此紀錄的變更操作。</p> : null}
    <ol>{record.history.map((version) => <li key={version.versionId}>
      <strong>v{version.version}・{STATUS[version.recordState]}</strong><VersionContent record={version} />
      <p>本版理由：{version.correctionReason ?? version.revisionReason ?? "原內容核對後簽署"}</p>
      <p>簽署目的：{version.signaturePurpose ?? "未簽署"}</p>
      <p>簽署角色：{version.signerRoleKeys?.join("、") ?? "未簽署"}</p>
      <p className={styles.hash}>版本 ID：{version.versionId}</p>
      <p className={styles.hash}>前版 ID：{version.previousVersionId ?? "起始版本"}</p>
      <p className={styles.hash}>內容 SHA-256：{version.contentHash}</p>
      {version.signatureReauthChallengeId ? <p className={styles.hash}>重新驗證證據：{version.signatureReauthChallengeId}</p> : null}
      {version.executionReferenceId ? <><p className={styles.hash}>執行來源：{version.executionReferenceId}</p>
        <p className={styles.hash}>來源 SHA-256：{version.executionReferenceContentHash}</p></> : null}
    </li>)}</ol></details>;
}

function RecordFields({ record }: { record: CaseServiceRecord | null }) {
  return <div className={styles.fields}>
    <label><span>開始時間（台北）</span><input name="started_at" type="datetime-local" step="1" required defaultValue={localInput(record?.startedAt)} /></label>
    <label><span>結束時間（台北）</span><input name="ended_at" type="datetime-local" step="1" required defaultValue={localInput(record?.endedAt)} /></label>
    <label><span>機構自訂服務類型</span><input name="service_type" maxLength={120} required defaultValue={record?.serviceType ?? ""} /></label>
    <label className={styles.wide}><span>人工服務內容</span><textarea name="service_content" maxLength={8000} required defaultValue={record?.serviceContent ?? ""} /></label>
    <label className={styles.wide}><span>人工服務結果</span><textarea name="service_result" maxLength={4000} required defaultValue={record?.serviceResult ?? ""} /></label>
    <label className={styles.wide}><span>執行來源 UUID（選填）</span><input name="execution_reference_id" maxLength={36} defaultValue={record?.executionReferenceId ?? ""} autoComplete="off" />
      <small className={styles.hint}>只接受同機構、分支及個案的已完成執行紀錄；此處不建立服務、核定項目或申報資格。</small></label>
  </div>;
}

function recordFields(data: FormData, clientId: string) {
  const read = (key: string) => String(data.get(key) ?? "");
  return { client_id: clientId, started_at: `${read("started_at")}+08:00`,
    ended_at: `${read("ended_at")}+08:00`, service_type: read("service_type"),
    service_content: read("service_content"), service_result: read("service_result"),
    execution_reference_id: read("execution_reference_id").trim() || null };
}

function expectedPayload(record: CaseServiceRecord) {
  return { client_id: record.clientId, started_at: record.startedAt, ended_at: record.endedAt,
    service_type: record.serviceType, service_content: record.serviceContent, service_result: record.serviceResult,
    execution_reference_id: record.executionReferenceId, execution_reference_status: record.executionReferenceStatus,
    execution_reference_content_hash: record.executionReferenceContentHash, author_user_id: record.authorUserId,
    source_kind: record.sourceKind, schema_kind: record.schemaKind, statutory_rule_status: record.statutoryRuleStatus,
    claim_eligibility_status: record.claimEligibilityStatus };
}

export function CaseServiceRecordsWorkspace({ page, snapshot, filters, loadError, actorUserId,
  canManage, canSign, hasRecentAal2 }: {
  page: PageCatalogEntry; snapshot: CaseServiceRecordSnapshot | null;
  filters: CaseServiceRecordFilters; loadError: boolean; actorUserId: string;
  canManage: boolean; canSign: boolean; hasRecentAal2: boolean;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [clientId, setClientId] = useState("");
  const [pending, setPending] = useState<RecordOperation | null>(null);
  const [state, setState] = useState<State>({ kind: "idle", message: "" });
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (editor) { editorHeading.current?.focus(); editorHeading.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }
  }, [editor]);

  const ready = !!snapshot && !loadError && !snapshot.demo;
  const canDraft = ready && canManage;
  const canSignNow = ready && canSign && hasRecentAal2;
  const pendingAllowed = !!pending && ready && online && pending.organizationId === snapshot?.organizationId &&
    pending.branchId === snapshot?.branchId && pending.actorUserId === actorUserId &&
    (pending.input.action === "save_record" ? canDraft : canSignNow);
  const currentRecord = editor?.record && snapshot?.records.find((row) => row.recordKey === editor.record!.recordKey);
  const editorCurrent = editor?.mode === "create" ? !!snapshot && !snapshot.clientsTruncated &&
    snapshot.clients.some((client) => client.clientId === clientId) :
    !!currentRecord && currentRecord.versionId === editor?.record?.versionId &&
    currentRecord.contentHash === editor.record.contentHash && !currentRecord.historyTruncated;
  const editorAllowed = !!editor && online && editorCurrent &&
    (editor.mode === "create" || editor.mode === "revise" ? canDraft : canSignNow) &&
    (editor.mode !== "revise" || currentRecord?.authorUserId === actorUserId) &&
    (editor.mode !== "sign" || currentRecord?.executionReferenceVerification !== "changed_or_unavailable");

  async function execute(operation: RecordOperation) {
    if (inFlight.current) return;
    inFlight.current = true;
    const wasUnconfirmed = pending !== null;
    setPending(operation); setState({ kind: "working", message: "正在核對權限、版本與保存證據…" });
    try {
      const receipt = await sendRecordOperation(operation);
      setPending(null); setEditor(null); setClientId("");
      setState({ kind: "success", message: `已核對保存回執：v${receipt.version}・${STATUS[receipt.recordState]}。此紀錄仍不具申報資格。` });
      router.refresh();
    } catch (error) {
      if (error instanceof ConfirmedRecordFailure && !wasUnconfirmed) {
        setPending(null); setState({ kind: "error", message: error.message });
      } else {
        setState({ kind: "unknown", message: "原操作結果仍待核對，內容與操作鍵已凍結。請勿重建另一筆或離開此頁；恢復相同身分與權限後精確重試。" });
      }
    } finally { inFlight.current = false; }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || pending || !editorAllowed || !editor || !snapshot || !navigator.onLine) return;
    const data = new FormData(event.currentTarget);
    const record = editor.record;
    const baseline = { record_key: record?.recordKey ?? null, previous_version_id: record?.versionId ?? null,
      expected_version: record?.version ?? 0, expected_content_hash: record?.contentHash ?? null };
    try {
      if ((editor.mode === "sign" || editor.mode === "correct") && data.get("consent") !== "on") {
        setState({ kind: "error", message: "請先逐項核對本版內容並確認簽署目的。" }); return;
      }
      const body = editor.mode === "sign" ? { ...baseline, action: "sign_record", client_id: record!.clientId,
        expected_record_payload: expectedPayload(record!) } : editor.mode === "correct" ?
        { ...baseline, ...recordFields(data, record!.clientId), action: "correct_record",
          expected_author_user_id: record!.authorUserId, reason: String(data.get("reason") ?? "") } :
        { ...baseline, ...recordFields(data, record?.clientId ?? clientId), action: "save_record", mode: editor.mode,
          revision_reason: String(data.get("reason") ?? "") };
      const input = parseCaseServiceRecordMutation(body, crypto.randomUUID());
      await execute({ input, organizationId: snapshot.organizationId, branchId: snapshot.branchId, actorUserId });
    } catch {
      setState({ kind: "error", message: "請檢查個案、真實日期、起訖時間、必要內容、UUID 與理由；尚未送出。" });
    }
  }

  const pendingCard = pending ? <section className={styles.pending} aria-label="原操作結果待核對">
    <h2>原操作結果待核對</h2><p role="status">{state.message}</p>
    <p className={styles.hash}>原操作鍵：{pending.input.idempotencyKey}</p>
    <p>只在此頁記憶體保留原請求，不寫入裝置快取。離開或登出前請交由主管依此操作鍵查核，勿另建同一紀錄。</p>
    {state.kind === "unknown" ? <button type="button" className="button button--primary" disabled={!pendingAllowed}
      onClick={() => { if (pendingAllowed && navigator.onLine) void execute(pending); }}>以原內容及相同操作鍵重試</button> : null}
    {!pendingAllowed ? <p>目前無法核對；請恢復原機構、分支、帳號、必要權限與連線。簽署／更正還需近期 MFA。</p> : null}
  </section> : null;

  if (!snapshot || loadError) return <div className="workspace-page">{pendingCard}
    <section className="empty-card"><h1>{page.title}</h1><p role="alert">篩選無效或正式快照無法取得，不會改用展示資料。</p>
      <Link prefetch={false} className="button button--secondary" href={`/app/${page.slug}`}>清除篩選並重試</Link></section></div>;
  const basePath = `/app/${page.slug}`;
  const title = editor?.mode === "create" ? "新增人工服務草稿" : editor?.mode === "revise" ? "修訂草稿（建立新版）" :
    editor?.mode === "sign" ? "核對並簽署本版" : "建立並簽署更正版";
  return <div className={`workspace-page ${styles.page}`}>
    <header className="page-heading"><div><p className="eyebrow">服務管理・Page 50</p><h1>{page.title}</h1>
      <p className="page-heading__description">逐筆保存人工服務內容、結果與簽署證據；修訂及更正都保留原版。</p></div>
      <div className={styles.actions}>{canDraft ? <button className="button button--primary" type="button"
        disabled={!!pending || !online || snapshot.clientsTruncated || !snapshot.clients.length}
        onClick={() => { setClientId(""); setEditor({ mode: "create", record: null }); setState({ kind: "idle", message: "" }); }}>新增服務紀錄</button> : null}</div>
    </header>
    <section className={styles.boundary} aria-label="個案服務紀錄範圍"><strong>人工敘事版本已建置；法定表單與申報資格尚未配置</strong>
      <p>這是獨立的個案服務紀錄，不取代照顧日誌。簽署只證明本版人工紀錄，不會建立核定項目、改寫執行紀錄或產生申報。</p>
      <p>正式附件、列印匯出、離線寫入與通知尚未開放；法定必要欄位仍待主管機關格式及業務驗收。</p></section>
    {snapshot.demo ? <p className="demo-banner">合成展示資料；新增、修訂、簽署與更正均關閉，不會寫入正式資料。</p> : null}
    {!online ? <p role="alert" className={styles.boundary}>目前離線，本頁不能寫入或簽署；未送出內容僅在本頁記憶體，請保持頁面開啟。</p> : null}
    <SnapshotFreshness expiresAt={snapshot.staleAfter} demo={snapshot.demo} />
    {pendingCard}
    {!pending && state.message ? <p role={state.kind === "error" ? "alert" : "status"} className={styles.status}>{state.message}</p> : null}
    {canSign && !hasRecentAal2 ? <aside className={styles.boundary}><p>簽署與更正須在最近 15 分鐘完成 MFA；目前操作已關閉。</p>
      <Link prefetch={false} href="/mfa?audience=staff&purpose=sensitive-action" className="button button--secondary">立即重新驗證</Link></aside> : null}
    {editor && ready ? <section className={styles.editor} aria-label="服務紀錄編輯區">
      <h2 ref={editorHeading} tabIndex={-1}>{title}</h2>
      {editor.record ? <p>{editor.record.clientDisplayName}・原版 v{editor.record.version}・{editor.record.serviceType}</p> : null}
      <form onSubmit={submit} aria-label={title}>
        <fieldset disabled={!!pending || !online}><legend>{editor.mode === "sign" ? "核對原版" : "人工輸入欄位"}</legend>
          {editor.mode === "create" ? <div className={styles.fields}><label><span>個案（切換後清空未送出內容）</span>
            <select required value={clientId} onChange={(event) => setClientId(event.target.value)} name="client_id">
              <option value="">請先選擇個案</option>{snapshot.clients.map((client) =>
                <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label></div> : null}
          {editor.mode === "sign" ? <div className={styles.card}><VersionContent record={editor.record} />
            <p className={styles.hash}>本版 SHA-256：{editor.record.contentHash}</p></div> :
            <div key={`${editor.record?.versionId ?? clientId}:${editor.mode}`}><RecordFields record={editor.record} />
              <div className={styles.fields}><label className={styles.wide}><span>{editor.mode === "correct" ? "更正理由（至少 8 字）" : "建立／修訂理由"}</span>
                <textarea name="reason" required minLength={editor.mode === "correct" ? 8 : 1} maxLength={1000} /></label></div></div>}
          {editor.mode === "sign" || editor.mode === "correct" ? <label className={styles.check}>
            <input name="consent" type="checkbox" required /><span>我已核對個案、時間、內容與來源；同意以本人身分{editor.mode === "correct" ? "簽署更正版並保留原版" : "簽署此版本"}。</span></label> : null}
        </fieldset>
        {!editorAllowed && !pending ? <p className={styles.hint}>請先選擇個案並確認版本、完整歷史、權限及連線；簽署／更正須近期 MFA。</p> : null}
        <div className={styles.actions}><button className="button button--primary" disabled={!editorAllowed || !!pending} type="submit">{title}</button>
          <button className="button button--secondary" type="button" disabled={!!pending} onClick={() => setEditor(null)}>取消編輯</button></div>
      </form></section> : null}
    <section className={styles.metrics} aria-label="個案服務紀錄統計">
      {[ ["符合紀錄", snapshot.metrics.serviceTotal], ["草稿", snapshot.metrics.draftTotal],
        ["已簽署", snapshot.metrics.signedTotal], ["已簽更正版", snapshot.metrics.correctedTotal] ].map(([label, value]) =>
        <article key={label}><span>{label}</span><strong>{value}</strong><p>完整符合集合</p></article>)}
    </section>
    <form action={basePath} method="get" className={styles.filters} aria-label="服務紀錄篩選">
      <label><span>起日（含當日）</span><input name="from" type="date" defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>迄日（含當日）</span><input name="to" type="date" defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>篩選個案</span><select name="client" defaultValue={filters.clientId ?? ""}><option value="">全部授權個案</option>
        {snapshot.clients.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName}</option>)}</select></label>
      <label><span>篩選服務類型</span><select name="type" defaultValue={filters.serviceType ?? ""}><option value="">全部類型</option>
        {snapshot.serviceTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>篩選紀錄作者</span><select name="author" defaultValue={filters.authorUserId ?? ""}><option value="">全部作者</option>
        {snapshot.authors.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select></label>
      <label><span>紀錄狀態</span><select name="status" defaultValue={filters.recordState}><option value="all">全部狀態</option>
        {Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className={`${styles.actions} ${styles.wide}`}><button className="button button--secondary" disabled={!!pending} type="submit">套用篩選</button>
        {!pending ? <Link prefetch={false} className="button button--quiet" href={basePath}>清除篩選</Link> : null}</div>
    </form>
    {snapshot.clientsTruncated || snapshot.serviceTypesTruncated || snapshot.authorsTruncated ? <p role="status" className={styles.boundary}>
      篩選選項已達上限，未顯示的選項不代表不存在；請縮小日期範圍。個案選項不完整時禁止新增。</p> : null}
    <section className={styles.records} aria-labelledby="case-service-record-list"><div className={styles.sectionHeading}>
      <h2 id="case-service-record-list">個案服務紀錄清單</h2><p>符合 {snapshot.matchingTotal} 筆，顯示 {snapshot.records.length} 筆</p></div>
      <p className={styles.hint}>已連結執行來源 {snapshot.metrics.linkedExecutionTotal} 筆；來源變更或不可用 {snapshot.metrics.changedExecutionTotal} 筆。連結不等於可申報。</p>
      {snapshot.recordsTruncated ? <p className={styles.boundary} role="status">清單已截斷，最多顯示 200 筆；統計仍使用完整符合集合，請縮小日期或個案範圍。</p> : null}
      {!snapshot.records.length ? <section className="empty-card"><h3>沒有符合條件的服務紀錄</h3><p>請調整日期、個案、作者、類型或狀態；授權人員可建立新的人工草稿。</p></section> :
        snapshot.records.map((record) => <article className={styles.card} key={record.recordKey} aria-label={`${record.clientDisplayName} ${record.serviceType}`}>
          <header className={styles.cardHeading}><div><h3>{record.clientDisplayName}・{record.serviceType}</h3><span>目前 v{record.version}</span></div>
            <span className={styles.pill}>{STATUS[record.recordState]}</span></header>
          <VersionContent record={record} /><History record={record} />
          <div className={styles.actions}>{canDraft && record.recordState === "draft" && record.authorUserId === actorUserId ? <button type="button" className="button button--secondary"
            disabled={!!pending || record.historyTruncated || !online} onClick={() => setEditor({ mode: "revise", record })}>修訂草稿</button> : null}
            {canSign && record.recordState === "draft" && !snapshot.demo ? <button type="button" className="button button--primary"
              disabled={!!pending || !canSignNow || !online || record.historyTruncated || record.executionReferenceVerification === "changed_or_unavailable"}
              onClick={() => setEditor({ mode: "sign", record })}>核對並簽署</button> : null}
            {canSign && record.recordState !== "draft" && !snapshot.demo ? <button type="button" className="button button--secondary"
              disabled={!!pending || !canSignNow || !online || record.historyTruncated} onClick={() => setEditor({ mode: "correct", record })}>建立更正版</button> : null}</div>
        </article>)}
    </section>
  </div>;
}
