"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ClipboardCheck, FileCheck2, ListChecks, RotateCcw } from "lucide-react";
import {
  evaluationPreparationRequestSchema,
  type EvaluationPreparationRequest,
  type EvaluationPreparationSnapshot,
  type EvaluationPreparationVersion,
} from "@/lib/evaluation-preparation/contract";
import {
  ConfirmedPreparationFailure, sendEvaluationPreparationOperation, UnknownPreparationOutcome,
  type EvaluationPreparationOperation,
} from "./evaluation-preparation-request";
import {
  beginEvaluationPreparationOperation,
  markEvaluationPreparationUnknown, retryEvaluationPreparationOperation,
  settleEvaluationPreparationOperation, useHeldEvaluationPreparationOperation,
  useLostEvaluationPreparationOperation,
} from "./evaluation-preparation-pending";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import styles from "./evaluation-preparation.module.css";

type Draft = {
  itemCode: string; ownerUserId: string; dueOn: string; evidenceReference: string;
  progress: EvaluationPreparationRequest["progress"];
  changeReason: EvaluationPreparationRequest["changeReason"];
};
const emptyDraft: Draft = { itemCode: "", ownerUserId: "", dueOn: "", evidenceReference: "",
  progress: "collecting", changeReason: "initial" };
const reasons: { value: EvaluationPreparationRequest["changeReason"]; label: string }[] = [
  { value: "evidence_added", label: "補充證據" }, { value: "owner_changed", label: "更換負責人" },
  { value: "due_date_changed", label: "調整期限" }, { value: "progress_changed", label: "更新進度" },
  { value: "correction", label: "更正資料" },
];

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export function EvaluationPreparationWorkspace({ snapshot, actorUserId, loadError = false }: {
  snapshot: EvaluationPreparationSnapshot | null; actorUserId: string; loadError?: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<EvaluationPreparationVersion | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const held = useHeldEvaluationPreparationOperation();
  const pending = held?.phase === "unknown" ? held.operation : null;
  const busy = held?.phase === "busy";
  const lostOperation = useLostEvaluationPreparationOperation();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const setScopeChangeState = useScopeChangeDraftRegistration();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setScopeChangeState({ dirty: editor !== null && !held, busy, unknown: !!pending || lostOperation });
  }, [editor, held, busy, pending, lostOperation, setScopeChangeState]);
  useEffect(() => {
    if (!held && !lostOperation) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [held, lostOperation]);
  useEffect(() => {
    const check = () => { setOffline(!navigator.onLine); setStale(!snapshot || (!snapshot.demo && Date.now() >= Date.parse(snapshot.staleAfter))); };
    check(); const timer = window.setInterval(check, 10000);
    window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, [snapshot]);
  useEffect(() => { if (editor) heading.current?.focus(); }, [editor]);

  function openEditor(item: EvaluationPreparationVersion | "new") {
    if (held || lostOperation) return;
    setEditor(item); setError(""); setMessage("");
    setDraft(item === "new" ? emptyDraft : { itemCode: item.itemCode,
      ownerUserId: item.ownerUserId ?? "", dueOn: item.dueOn ?? "",
      evidenceReference: item.evidenceReference ?? "", progress: item.progress,
      changeReason: "correction" });
  }
  async function execute(operation: EvaluationPreparationOperation, afterUnknown = false) {
    if (mounted.current) { setError(""); setMessage(""); }
    try {
      const receipt = await sendEvaluationPreparationOperation(operation, afterUnknown);
      settleEvaluationPreparationOperation(operation);
      if (!mounted.current) return;
      setEditor(null); setDraft(emptyDraft);
      setMessage(`${receipt.result.itemCode} 已保存第 ${receipt.result.version} 版${receipt.replayed ? "（重試已確認）" : ""}。`);
      router.refresh();
    } catch (failure) {
      if (failure instanceof ConfirmedPreparationFailure && !afterUnknown) {
        settleEvaluationPreparationOperation(operation);
        if (mounted.current) setError(failure.message);
      } else {
        markEvaluationPreparationUnknown(operation);
        if (mounted.current) setError(failure instanceof UnknownPreparationOutcome ? failure.message
          : "保存結果無法確認；請用同一操作重試。");
      }
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !editor || stale || offline || snapshot.demo || held || lostOperation) return;
    const input = evaluationPreparationRequestSchema.safeParse({
      itemCode: draft.itemCode.toUpperCase(), expectedVersion: editor === "new" ? 0 : editor.version,
      ownerUserId: draft.ownerUserId || null, dueOn: draft.dueOn || null,
      evidenceReference: draft.evidenceReference || null, progress: draft.progress,
      changeReason: editor === "new" ? "initial" : draft.changeReason,
    });
    if (!input.success) { setError("請確認項目代碼、日期及進度；待內部覆核須填負責人、期限與證據參照碼。"); return; }
    const operation = beginEvaluationPreparationOperation(() => ({
      input: input.data, idempotencyKey: crypto.randomUUID(),
      organizationId: snapshot.organizationId, branchId: snapshot.branchId, actorUserId,
    }));
    if (!operation) { setError("畫面正在切換，或無法保留安全恢復狀態；目前不能保存。"); return; }
    void execute(operation);
  }
  function retry() {
    if (!snapshot || !pending || busy || offline ||
      pending.organizationId !== snapshot.organizationId || pending.branchId !== snapshot.branchId ||
      pending.actorUserId !== actorUserId) return;
    if (retryEvaluationPreparationOperation(pending)) void execute(pending, true);
  }

  if (loadError || !snapshot) return <section className={styles.workspace} aria-labelledby="evaluation-heading">
    <h1 id="evaluation-heading">評鑑準備</h1>
    <div className={styles.notice} role="alert"><AlertTriangle aria-hidden="true" />
      <div><strong>目前無法載入資料</strong><p>請確認分支、稽核權限與工作階段後重試；不會顯示替代資料。</p></div></div>
    {(held || lostOperation) && <p className={styles.error} role="alert">先前保存結果尚未確認。請恢復原工作階段及權限再核對；目前不能建立新操作。</p>}
    <button className="button button--secondary" onClick={() => router.refresh()}>重新載入</button>
  </section>;

  const ownerNames = new Map(snapshot.owners.map((owner) => [owner.userId, owner.name]));
  const pendingScopeChanged = held !== null && (held.operation.organizationId !== snapshot.organizationId ||
    held.operation.branchId !== snapshot.branchId || held.operation.actorUserId !== actorUserId);
  const disabled = snapshot.demo || stale || offline || held !== null || lostOperation;
  const maxPage = Math.min(100, Math.max(1, Math.ceil(snapshot.total / snapshot.pageSize)));

  return <main className={styles.workspace} aria-labelledby="evaluation-heading">
    <header className={styles.header}><div><p className="eyebrow">機構營運管理 · #79</p>
      <h1 id="evaluation-heading">評鑑準備</h1><p>整理內部項目、負責人、期限與證據參照。</p></div>
      <button className="button button--primary" onClick={() => openEditor("new")} disabled={disabled}>
        新增準備項目</button></header>
    <div className={styles.notice} role="note"><AlertTriangle aria-hidden="true" /><p>
      適用的官方評鑑版本尚未核定。此頁僅供內部準備，不計分、不上傳證據，也不能送交主管機關。</p></div>
    {snapshot.demo && <p className={styles.notice} role="status">展示模式只能查看，無法保存正式資料。</p>}
    {(offline || stale) && <div className={styles.notice} role="status"><RotateCcw aria-hidden="true" /><p>
      {offline ? "目前離線。連線後重新載入，才能保存。" : "資料已超過五分鐘。重新載入後再編輯。"}</p>
      {!offline && <button className="button button--secondary" onClick={() => router.refresh()}>重新載入</button>}</div>}
    {held && <div className={styles.notice} role="status"><RotateCcw aria-hidden="true" /><p>
      {pendingScopeChanged ? "使用者或分支已變更；請回原工作階段核對，不能重送此操作。"
        : busy ? "正在核對原操作的保存結果，請稍候。"
          : `項目 ${held.operation.input.itemCode} 的保存結果尚未確認；請以原操作核對，勿建立新操作。`}</p>
      {pending && !pendingScopeChanged && <button className="button button--secondary" type="button"
        onClick={retry} disabled={offline}>同一操作核對與重試</button>}</div>}
    {lostOperation && <p className={styles.error} role="alert">前次保存結果尚未確認，原操作因重新載入已無法安全重試。請由管理員核對回執；此頁暫停新增或修訂。</p>}
    <section className={styles.metrics} aria-label="本分支準備狀態">
      <div><ListChecks aria-hidden="true" /><span>準備項目</span><strong>{snapshot.total}</strong></div>
      <div><ClipboardCheck aria-hidden="true" /><span>本頁待內部覆核</span><strong>{snapshot.items.filter((item) => item.progress === "internal_review_requested").length}</strong></div>
      <div><FileCheck2 aria-hidden="true" /><span>本頁有證據參照</span><strong>{snapshot.items.filter((item) => item.evidenceReference).length}</strong></div>
    </section>
    {message && <p className={styles.success} role="status">{message}</p>}
    <section className={styles.list} aria-labelledby="evaluation-list-heading">
      <div className={styles.listHeading}><div><h2 id="evaluation-list-heading">準備清單</h2>
        <p>分支內部資料 · 第 {snapshot.page} 頁／共 {maxPage} 頁 · 更新 {dateTime(snapshot.generatedAt)}</p></div></div>
      {snapshot.items.length ? <ul className={styles.items}>{snapshot.items.map((item) => <li key={item.versionId}>
        <div className={styles.itemTop}><strong>{item.itemCode}</strong>
          <span className={item.progress === "internal_review_requested" ? styles.review : styles.collecting}>
            {item.progress === "internal_review_requested" ? "待內部覆核" : "蒐集中"}</span></div>
        <dl className={styles.facts}><div><dt>負責人</dt><dd>{item.ownerUserId ? ownerNames.get(item.ownerUserId) ?? "原負責人（目前未列入名單）" : "未指派"}</dd></div>
          <div><dt>期限</dt><dd>{item.dueOn ?? "未設定"}</dd></div><div><dt>證據參照</dt>
            <dd>{item.evidenceReference ? "已登記參照碼" : "未登記"}</dd></div><div><dt>版本</dt><dd>{item.version}</dd></div></dl>
        <div className={styles.itemActions}><button type="button" className="button button--secondary"
          disabled={disabled} onClick={() => openEditor(item)} aria-label={`編輯 ${item.itemCode} 準備項目`}>編輯</button></div>
      </li>)}</ul> : <div className={styles.empty}><ListChecks aria-hidden="true" /><h3>尚無準備項目</h3>
        <p>{snapshot.total ? "此頁沒有項目。" : "先建立內部參照碼，再指派負責人與期限。"}</p></div>}
      {maxPage > 1 && <nav className={styles.pagination} aria-label="準備項目分頁">
        {snapshot.page > 1 && <Link className="button button--secondary" href={`/app/staff/operations/evaluations?page=${snapshot.page - 1}`}>上一頁</Link>}
        {snapshot.page < maxPage && <Link className="button button--secondary" href={`/app/staff/operations/evaluations?page=${snapshot.page + 1}`}>下一頁</Link>}
      </nav>}
    </section>
    {editor && !pendingScopeChanged && <section className={styles.editor} aria-labelledby="evaluation-editor-heading">
      <div className={styles.editorHeading}><h2 id="evaluation-editor-heading" ref={heading} tabIndex={-1}>
        {editor === "new" ? "新增準備項目" : `編輯 ${editor.itemCode}`}</h2>
        <button type="button" className="button button--secondary" disabled={!!held}
          onClick={() => { setEditor(null); setError(""); }}>關閉</button></div>
      <form onSubmit={save} noValidate><fieldset className={styles.formFields} disabled={!!held}>
        <legend className={styles.srOnly}>內部評鑑準備欄位</legend><div className={styles.fields}>
        <label>內部項目代碼<input type="text" inputMode="text" maxLength={24} autoComplete="off"
          pattern="[A-Z0-9][A-Z0-9._-]{0,23}" placeholder="例如 WANHUA_01" required
          readOnly={editor !== "new"} value={draft.itemCode}
          onChange={(event) => setDraft({ ...draft, itemCode: event.target.value.toUpperCase() })} /></label>
        <label>負責人<select value={draft.ownerUserId} onChange={(event) => setDraft({ ...draft, ownerUserId: event.target.value })}>
          <option value="">尚未指派</option>
          {editor !== "new" && editor.ownerUserId && !ownerNames.has(editor.ownerUserId) &&
            <option value={editor.ownerUserId}>原負責人（目前未列入名單）</option>}
          {snapshot.owners.map((owner) => <option key={owner.userId} value={owner.userId}>{owner.name}</option>)}</select></label>
        <label>完成期限<input type="date" min="2000-01-01" max="2100-12-31" value={draft.dueOn}
          onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} /></label>
        <label>證據參照碼（UUID）<input type="text" maxLength={36} autoComplete="off" spellCheck={false}
          placeholder="僅填內部 UUID，不填姓名或檔名" value={draft.evidenceReference}
          onChange={(event) => setDraft({ ...draft, evidenceReference: event.target.value })} /></label>
        <label>進度<select value={draft.progress} onChange={(event) => setDraft({ ...draft,
          progress: event.target.value as Draft["progress"] })}>
          <option value="collecting">蒐集中</option><option value="internal_review_requested">待內部覆核</option></select></label>
        {editor !== "new" && <label>修訂原因<select value={draft.changeReason} onChange={(event) => setDraft({ ...draft,
          changeReason: event.target.value as Draft["changeReason"] })}>
          {reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>}
      </div></fieldset>
      <p className={styles.hint}>「待內部覆核」須填負責人、期限與證據參照碼；參照碼不會自動驗證檔案。</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button className="button button--primary" type="submit" disabled={disabled}>保存內部版本</button></div>
      </form></section>}
  </main>;
}
