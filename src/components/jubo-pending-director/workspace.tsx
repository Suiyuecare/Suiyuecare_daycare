"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardCheck, FilePenLine, ShieldAlert, RefreshCw } from "lucide-react";
import { requestCoreDraftLeave, useCoreDraftGuard } from "@/components/app/core-draft-guard";
import { StatusPill } from "@/components/ui/status-pill";
import { intakeErrorMessage, intakeRequest, isDefiniteIntakeRejection } from "@/lib/client-intake/client";
import { directorDirectorySchema, directorDraftInputSchema, directorDraftReceiptSchema, directorWorkspaceSchema, type DirectorDirectory, type DirectorDraftInput, type DirectorWorkspace } from "@/lib/jubo-pending-director/contract";
import styles from "./workspace.module.css";

const FORM_OPTIONS = [
  ["spmsq", "SPMSQ"], ["gds", "GDS"], ["fall_risk", "跌倒風險"], ["nsi", "NSI"],
  ["barthel", "Barthel ADL"], ["iadl", "IADL"], ["swallowing", "吞嚥"],
  ["bsrs", "BSRS"], ["body", "身體"], ["abcd", "ABCD"],
] as const;
type FormKey = typeof FORM_OPTIONS[number][0];
type PendingOperation = { input: DirectorDraftInput; body: string };

function summaryValue(value: string | null) { return value?.trim() || "未提供"; }
function newestPreparation(workspace: DirectorWorkspace, formKey: FormKey) {
  return workspace.assessmentPreparations.find((item) => item.formKey === formKey) ?? null;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function PendingIntakeDirectorWorkspace({ branchName, initialDirectory, initialWorkspace, initialError, today }: {
  branchName: string; initialDirectory: DirectorDirectory | null; initialWorkspace: DirectorWorkspace | null;
  initialError: boolean; today: string;
}) {
  const localGuard = useCoreDraftGuard();
  const assessmentGuard = useCoreDraftGuard();
  const initialPreparation = initialWorkspace ? newestPreparation(initialWorkspace, "spmsq") : null;
  const [directory, setDirectory] = useState(initialDirectory);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [selectedId, setSelectedId] = useState(initialWorkspace?.clientId ?? "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initialError ? "待收案資料無法核對；請確認分支權限後重試。" : "");
  const [notice, setNotice] = useState("");
  const [contactPreference, setContactPreference] = useState<"unknown" | "phone" | "in_person" | "written">(
    initialWorkspace?.localSupplement?.payload.contactPreference ?? "unknown");
  const [visitPlanningNote, setVisitPlanningNote] = useState(initialWorkspace?.localSupplement?.payload.visitPlanningNote ?? "");
  const [followUpNote, setFollowUpNote] = useState(initialWorkspace?.localSupplement?.payload.followUpNote ?? "");
  const [formKey, setFormKey] = useState<FormKey>("spmsq");
  const [assessmentDate, setAssessmentDate] = useState(initialPreparation?.payload.assessmentDate ?? today);
  const [qualitativeNote, setQualitativeNote] = useState(initialPreparation?.payload.qualitativeNote ?? "");
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const firstError = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) firstError.current?.focus(); }, [error]);

  function discardAll(action: () => void) {
    requestCoreDraftLeave(() => {
      localGuard.saved(); assessmentGuard.saved();
      action();
    });
  }

  const populate = useCallback((data: DirectorWorkspace, form?: DirectorDraftInput["kind"]) => {
    setWorkspace(data);
    if (!form || form === "local_supplement") {
      setContactPreference(data.localSupplement?.payload.contactPreference ?? "unknown");
      setVisitPlanningNote(data.localSupplement?.payload.visitPlanningNote ?? "");
      setFollowUpNote(data.localSupplement?.payload.followUpNote ?? "");
    }
    if (!form || form === "assessment_preparation") {
      const draft = newestPreparation(data, formKey);
      setAssessmentDate(draft?.payload.assessmentDate ?? today);
      setQualitativeNote(draft?.payload.qualitativeNote ?? "");
    }
  }, [formKey, today]);

  async function loadDirectory() {
    if (loading || saving || pending) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const parsed = directorDirectorySchema.parse(await intakeRequest("/api/jubo-pending-director"));
      setDirectory(parsed);
      if (selectedId && !parsed.clients.some((item) => item.clientId === selectedId)) {
        setWorkspace(null); setSelectedId("");
        window.history.replaceState(window.history.state, "", "/app/pending-intake-review");
      }
    } catch (cause) { setDirectory(null); setWorkspace(null); setError(intakeErrorMessage(cause)); }
    finally { setLoading(false); }
  }

  async function choose(clientId: string) {
    if (loading || saving || pending) return;
    discardAll(() => { void loadSelected(clientId); });
  }

  async function loadSelected(clientId: string) {
    setSelectedId(clientId); setWorkspace(null); setError(""); setNotice("");
    if (!clientId) {
      window.history.replaceState(window.history.state, "", "/app/pending-intake-review");
      return;
    }
    setLoading(true);
    try {
      const parsed = directorWorkspaceSchema.parse(await intakeRequest(`/api/jubo-pending-director?client=${encodeURIComponent(clientId)}`));
      if (parsed.clientId !== clientId || parsed.formalOperationsAllowed !== false) throw new Error("回覆個案不一致，請重新選擇。 ");
      populate(parsed);
      window.history.replaceState(window.history.state, "", `/app/pending-intake-review?client=${encodeURIComponent(clientId)}`);
    } catch (cause) { setError(intakeErrorMessage(cause)); setWorkspace(null); }
    finally { setLoading(false); }
  }

  function draftConfirmed(data: DirectorWorkspace, operation: PendingOperation) {
    const { input } = operation;
    const row = input.kind === "local_supplement" ? data.localSupplement
      : newestPreparation(data, input.formKey);
    return row?.revision === input.expectedRevision + 1 && canonicalJson(row.payload) === canonicalJson(input.payload);
  }

  async function reconcilePending() {
    if (!pending || saving || loading) return;
    setLoading(true); setError("");
    try {
      const data = directorWorkspaceSchema.parse(await intakeRequest(`/api/jubo-pending-director?client=${encodeURIComponent(pending.input.clientId)}`));
      if (data.clientId !== pending.input.clientId || !draftConfirmed(data, pending)) {
        setError("原次操作仍未核對。請使用下方按鈕以相同內容重試，不要另建一筆。");
        return;
      }
      populate(data, pending.input.kind); setPending(null);
      (pending.input.kind === "local_supplement" ? localGuard : assessmentGuard).saved();
      setNotice("草稿已核對，尚未成為正式紀錄。");
    } catch (cause) { setError(intakeErrorMessage(cause)); }
    finally { setLoading(false); }
  }

  async function send(operation: PendingOperation) {
    if (saving || loading) return;
    const guard = operation.input.kind === "local_supplement" ? localGuard : assessmentGuard;
    if (!guard.begin()) return;
    setSaving(true); setError(""); setNotice(""); setPending(operation);
    try {
      const response = await intakeRequest("/api/jubo-pending-director", {
        method: "POST", headers: { "content-type": "application/json" }, body: operation.body,
      }) as { receipt: unknown; workspace: unknown };
      const receipt = directorDraftReceiptSchema.parse(response.receipt);
      const data = directorWorkspaceSchema.parse(response.workspace);
      if (receipt.revision !== operation.input.expectedRevision + 1 || !draftConfirmed(data, operation)) {
        throw new Error("草稿回條與最新內容不一致，請核對原次操作。 ");
      }
      populate(data, operation.input.kind); setPending(null); guard.saved(); setNotice("草稿已保存，未簽署、未計分。");
    } catch (cause) {
      setError(intakeErrorMessage(cause));
      if (isDefiniteIntakeRejection(cause)) { setPending(null); guard.unhold(); }
      else guard.hold();
      firstError.current?.focus();
    } finally { setSaving(false); guard.finish(); }
  }

  function saveLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || pending) return;
    const parsed = directorDraftInputSchema.safeParse({
      clientId: workspace.clientId, kind: "local_supplement", formKey: "intake_local",
      expectedRevision: workspace.localSupplement?.revision ?? 0,
      payload: { contactPreference, visitPlanningNote: visitPlanningNote.trim(), followUpNote: followUpNote.trim() },
      idempotency_key: crypto.randomUUID(),
    });
    if (!parsed.success) { setError("請檢查聯絡方式及補件內容。"); firstError.current?.focus(); return; }
    void send({ input: parsed.data, body: JSON.stringify(parsed.data) });
  }

  function saveAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || pending) return;
    if (assessmentDate > today || !assessmentDate) { setError("評估日期不得晚於今天。 "); firstError.current?.focus(); return; }
    if (!qualitativeNote.trim()) { setError("請先填寫觀察與待確認內容。 "); firstError.current?.focus(); return; }
    const parsed = directorDraftInputSchema.safeParse({
      clientId: workspace.clientId, kind: "assessment_preparation", formKey,
      expectedRevision: newestPreparation(workspace, formKey)?.revision ?? 0,
      payload: { formVersion: "preparation-v1", assessmentDate, answers: {}, qualitativeNote: qualitativeNote.trim() },
      idempotency_key: crypto.randomUUID(),
    });
    if (!parsed.success) { setError("請檢查觀察日期及草稿內容。"); firstError.current?.focus(); return; }
    void send({ input: parsed.data, body: JSON.stringify(parsed.data) });
  }

  return <main className={styles.root}>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>{branchName}・主任工作</p><h1>待收案核對</h1><p>選擇個案、核對 JUBO 來源；缺資料先記草稿。</p></div>
      <StatusPill status="正式服務未開放" tone="warning" />
    </header>
    <section className={styles.bar} aria-label="選擇待收案個案">
      <label htmlFor="director-pending-client">個案</label>
      <select id="director-pending-client" value={selectedId} disabled={loading || saving || Boolean(pending) || !directory}
        onChange={(event) => void choose(event.target.value)}>
        <option value="">請選擇</option>{directory?.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName} · {client.clientCode}</option>)}
      </select>
      <button type="button" onClick={() => discardAll(() => { void loadDirectory(); })} disabled={loading || saving || Boolean(pending)} aria-label="重新核對待收案名單"><RefreshCw aria-hidden="true" />重新核對</button>
      <span role="status">{directory ? `${directory.total} 位待收案` : loading ? "核對中…" : "名單未取得"}</span>
    </section>
    {error ? <p className={styles.error} role="alert" tabIndex={-1} ref={firstError}>{error}</p> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {pending ? <section className={styles.unknown} role="alert"><ShieldAlert aria-hidden="true" /><div><strong>這次儲存結果待核對</strong><p>內容已鎖定；可先讀回核對，或用同一請求重試。</p></div><button type="button" disabled={loading || saving} onClick={() => void reconcilePending()}>讀回核對</button><button type="button" disabled={loading || saving} onClick={() => void send(pending)}>重試原操作</button></section> : null}
    {loading && !workspace ? <section className={styles.empty} role="status">正在核對來源…</section> : null}
    {!selectedId && !loading && directory && <section className={styles.empty}><ClipboardCheck aria-hidden="true" /><h2>{directory.total ? "先選一位個案" : "目前沒有待收案個案"}</h2><p>{directory.total ? "名單只含目前分支、已匯入且尚未收案的 JUBO 個案。" : "請先由資料移轉負責人完成來源與建檔核對。"}</p></section>}
    {workspace && <>
      <section className={styles.summary} aria-label="個案狀態"><div><strong>{workspace.displayName}</strong><span>{workspace.clientCode}</span></div><div><StatusPill status="待收案" tone="warning" /><span>JUBO 來源：{workspace.sourceStatus}</span></div><div><StatusPill status="來源映射已人工覆核" tone="success" /><span>第 {workspace.humanReview.version} 版</span></div></section>
      <section className={styles.panel} aria-labelledby="source-title"><div className={styles.sectionTitle}><ClipboardCheck aria-hidden="true" /><div><h2 id="source-title">來源核對</h2><p>左邊是原始欄位，右邊是建檔顯示；識別碼僅顯示末四碼。</p></div></div>
        <div className={styles.tableScroll}><table><thead><tr><th scope="col">資料</th><th scope="col">JUBO 原值</th><th scope="col">建檔顯示</th></tr></thead><tbody>{workspace.fields.map((field) => <tr key={field.key}><th scope="row">{field.label}</th><td>{summaryValue(field.original)}</td><td>{summaryValue(field.display)}</td></tr>)}</tbody></table></div>
        <p className={styles.caution}>來源首服務日：{workspace.sourceFirstServiceOn ?? "未提供"}。這不是正式收案日；服務資格與收案日未核准前，不得出勤、給藥、排車、簽署或申報。</p>
      </section>
      <div className={styles.forms}>
        <form className={styles.panel} noValidate onSubmit={saveLocal}><div className={styles.sectionTitle}><FilePenLine aria-hidden="true" /><div><h2>補件說明草稿</h2><p>僅記錄聯絡與待補事項，不修改 JUBO 原值。</p></div></div>
          <label>聯絡方式<select value={contactPreference} disabled={saving || Boolean(pending)} onChange={(event) => { localGuard.changed(); setContactPreference(event.target.value as typeof contactPreference); }}><option value="unknown">待確認</option><option value="phone">電話</option><option value="in_person">當面</option><option value="written">書面</option></select></label>
          <label>到站規劃<textarea className="resize-none" value={visitPlanningNote} maxLength={1000} disabled={saving || Boolean(pending)} onChange={(event) => { localGuard.changed(); setVisitPlanningNote(event.target.value); }} /></label>
          <label>缺件與追蹤<textarea className="resize-none" value={followUpNote} maxLength={1000} disabled={saving || Boolean(pending)} onChange={(event) => { localGuard.changed(); setFollowUpNote(event.target.value); }} /></label>
          <p className={styles.meta}>草稿第 {workspace.localSupplement?.revision ?? 0} 版。這不是正式基本資料變更或收案核准。</p>
          <button className="button button--primary" type="submit" disabled={saving || loading || Boolean(pending)}>{saving ? "儲存中…" : "保存補件草稿"}</button>
        </form>
        <form className={styles.panel} noValidate onSubmit={saveAssessment}><div className={styles.sectionTitle}><FilePenLine aria-hidden="true" /><div><h2>評估準備草稿</h2><p>先記觀察內容；不計分、不簽署、不進正式量表。</p></div></div>
          <label>量表<select value={formKey} disabled={saving || Boolean(pending)} onChange={(event) => { const next = event.target.value as FormKey; assessmentGuard.discard(() => { setFormKey(next); const draft = workspace.assessmentPreparations.find((item) => item.formKey === next); setAssessmentDate(draft?.payload.assessmentDate ?? today); setQualitativeNote(draft?.payload.qualitativeNote ?? ""); }); }}>{FORM_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>觀察日期<input type="date" value={assessmentDate} max={today} disabled={saving || Boolean(pending)} onChange={(event) => { assessmentGuard.changed(); setAssessmentDate(event.target.value); }} /></label>
          <label>觀察與待確認內容<textarea className="resize-none" value={qualitativeNote} maxLength={2000} disabled={saving || Boolean(pending)} onChange={(event) => { assessmentGuard.changed(); setQualitativeNote(event.target.value); }} /></label>
          <p className={styles.meta}>草稿第 {newestPreparation(workspace, formKey)?.revision ?? 0} 版。正式評估須完成收案與獨立授權。</p>
          <button className="button button--primary" type="submit" disabled={saving || loading || Boolean(pending)}>{saving ? "儲存中…" : "保存評估準備草稿"}</button>
        </form>
      </div>
    </>}
  </main>;
}
