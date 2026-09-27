"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ClientJsonReadError, fetchJsonWithTimeout, fetchWithTimeout } from "@/lib/api/client-fetch";
import { careDiaryDataSchema, diaryActionSchema, diaryRecordSchema, observationsFromForm, type DiaryRecord } from "@/lib/care-diary/schema";
import { DiaryObservationsFields } from "./diary-observations";
import { useCareWriteAttempt } from "./use-care-write-attempt";
import { isDefiniteCareRejection } from "@/lib/core-care/write-attempt";
import { withCareRequestDeadline } from "@/lib/core-care/request-deadline";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { CoreDraftConfirmation, useCoreDraftGuard } from "./client-continuation";
import { requestUnsavedExit } from "@/lib/navigation/unsaved-changes";
import { hasPendingOperations, hasViewTransition } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { DailyFieldError, DailyValidationSummary, useDailyFormValidation } from "./daily-form-validation";
import styles from "./care-diary-lifecycle.module.css";

type DiaryAction = "edit" | "submit" | "sign" | "correct" | "reopen";
type DiaryMutation = { record: DiaryRecord; kind: DiaryAction; body: string };
type ReadbackConfirmation = { record: DiaryRecord; notice: string };
type ActionProposal = { mutation: DiaryMutation; epoch: number; valid: () => boolean };
const actionLabels = { submit: "確認提交", sign: "以本人身分簽署", correct: "確認建立更正草稿", reopen: "確認退回草稿" } as const;
const actionTitles = { submit: "提交這個已儲存版本", sign: "確認內容並簽署", correct: "建立同一事件的更正草稿", reopen: "退回草稿修訂" } as const;
const actionConsequences = {
  submit: "提交後不可直接修改，仍須本人確認簽署；提交不算正式完成。",
  sign: "我已閱讀這個版本，確認是本次實際觀察與處置，並以本人身分簽署。簽署後原內容不可覆寫。",
  correct: "原簽署版本完整保留；更正草稿仍須逐項確認、重新提交與簽署。建立草稿不算正式完成。",
  reopen: "原提交版本與退回理由保留在歷程；退回後可修訂，仍須再次提交與簽署。",
} as const;
const navigationLocked = () => hasPendingOperations() || hasViewTransition();

const statusLabels = { draft: "草稿", submitted: "待簽署", signed: "正式完成", corrected: "更正版已完成" } as const;
const snapshotSchema = z.object({ status: z.literal("ok"), requestId: z.string().min(1), data: z.object({
  records: z.array(diaryRecordSchema), demo: z.boolean(), persisted: z.boolean(),
  history: z.array(z.object({ id: z.uuid(), record_key: z.uuid(), version: z.number(), status: z.string(), correction_reason: z.string().nullable() })),
}) });
const receiptSchema = z.object({ status: z.literal("ok"), requestId: z.string().min(1), errors: z.array(z.never()).length(0), data: z.object({ record: diaryRecordSchema, replayed: z.boolean(), demo: z.literal(false), persisted: z.literal(true) }) });

function DiaryEditor({ record, sourceRevision, pending, locked, enabled, onSave, onCancel }: { record: DiaryRecord; sourceRevision?: string; pending: boolean; locked: boolean; enabled: boolean; onSave: (fields: unknown) => Promise<boolean>; onCancel: () => void }) {
  const validation = useDailyFormValidation();
  const draft = useCoreDraftGuard({ scopeKey: record.client_id, revisionKey: `${record.id}:${record.version}:${enabled}:${sourceRevision ?? ""}`,
    canPrompt: enabled, isBlocked: () => pending || locked, onDiscard: onCancel });
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validation.composing.current || pending || locked || !enabled || navigationLocked()) return;
    if (!validation.validate(event.currentTarget)) { setError(null); return; }
    if (!draft.begin()) return;
    try {
      const form = new FormData(event.currentTarget);
      const fields = careDiaryDataSchema.safeParse({ shift: form.get("shift"), care_item: form.get("care_item"), note: form.get("note"), follow_up: form.get("follow_up"), abnormal: form.get("abnormal") === "on", observations: observationsFromForm(form) });
      if (!fields.success) { setError("請確認照顧項目與本次觀察結果，內容尚未送出。"); return; }
      setError(null);
      if (await onSave(fields.data)) draft.saved();
    } catch { setError("請檢查本次觀察結果，內容仍保留在畫面，尚未送出。");
    } finally { draft.finish(); }
  }
  return <><form data-core-care-draft noValidate onChange={(event) => { if (pending || locked) return; validation.clearChanged(event.target); draft.changed(); }} onSubmit={save}
    onCompositionStart={validation.onCompositionStart} onCompositionEnd={validation.onCompositionEnd} onKeyDown={validation.onKeyDown}><fieldset disabled={pending || locked || !enabled} className="core-dialog__fields">
    <legend>繼續編輯這筆草稿</legend>
    <label className="field"><span id={validation.labelId("shift")}>班別</span><select name="shift" defaultValue={record.fields.shift} {...validation.field("shift")}><option value="morning">上午</option><option value="afternoon">下午</option><option value="full_day">全日</option></select><DailyFieldError validation={validation} name="shift" /></label>
    <label className="field"><span id={validation.labelId("care_item")}>照顧項目</span><input name="care_item" required maxLength={120} defaultValue={record.fields.care_item} {...validation.field("care_item")} /><DailyFieldError validation={validation} name="care_item" /></label>
    <DiaryObservationsFields initial={record.fields.observations} validation={validation} />
    <label className="field"><span id={validation.labelId("note")}>紀錄摘要</span><textarea className="resize-none" name="note" rows={4} maxLength={2000} defaultValue={record.fields.note} {...validation.field("note")} /><DailyFieldError validation={validation} name="note" /></label>
    <label className="field"><span id={validation.labelId("follow_up")}>後續行動</span><textarea className="resize-none" name="follow_up" rows={3} maxLength={1000} defaultValue={record.fields.follow_up} {...validation.field("follow_up")} /><DailyFieldError validation={validation} name="follow_up" /></label>
    <label className="check-field"><input name="abnormal" type="checkbox" defaultChecked={record.fields.abnormal} />標記為需留意</label>
    <div className={styles.actions}><button type="submit" aria-busy={pending} className="button button--primary">{pending ? "儲存中…" : "儲存草稿修訂"}</button>
    <button type="button" className="button button--secondary" onClick={() => draft.requestExit(onCancel)}>取消編輯</button></div>
    <DailyValidationSummary validation={validation} />
    {error ? <p role="alert">{error}</p> : null}
  </fieldset></form>
    <CoreDraftConfirmation draft={draft} />
  </>;
}

function RevisionReason({ record, kind, disabled, onPropose }: { record: DiaryRecord; kind: "reopen" | "correct"; disabled: boolean;
  onPropose: (record: DiaryRecord, kind: DiaryAction, extra: Record<string, unknown>, valid: () => boolean) => void }) {
  const validation = useDailyFormValidation();
  const label = kind === "reopen" ? "退回理由" : "更正理由";
  return <form data-core-care-draft noValidate onCompositionStart={validation.onCompositionStart} onCompositionEnd={validation.onCompositionEnd} onKeyDown={validation.onKeyDown}
    onChange={(event) => validation.clearChanged(event.target)} onSubmit={(event) => {
      event.preventDefault();
      if (disabled || validation.composing.current || !validation.validate(event.currentTarget)) return;
      const form = event.currentTarget; const reason = String(new FormData(form).get("reason") ?? "");
      onPropose(record, kind, { reason }, () => form.isConnected && String(new FormData(form).get("reason") ?? "") === reason);
    }}>
    <label className="field"><span id={validation.labelId("reason")}>{label}</span><input name="reason" required maxLength={1000} disabled={disabled} {...validation.field("reason")} /><DailyFieldError validation={validation} name="reason" /></label>
    <button className="button button--secondary" disabled={disabled} type="submit">{kind === "reopen" ? "退回草稿修訂" : "建立更正草稿"}</button>
    <DailyValidationSummary validation={validation} />
  </form>;
}

type LifecycleProps = { clientId?: string; clientName?: string; sourceRevision?: string; readEnabled?: boolean; enabled: boolean; canSign: boolean; canRevise?: boolean; demo: boolean };
export function CareDiaryLifecycle(props: LifecycleProps) {
  if (props.readEnabled === false) return <section className="panel" aria-labelledby="diary-read-mode-title">
    <h2 id="diary-read-mode-title">日誌操作目前為查看模式</h2>
    <p>可在下方查看既有日誌摘要；編輯、提交與簽署需要對應權限及身分驗證。</p>
  </section>;
  return <CareDiaryClientLifecycle key={`${props.clientId ?? "none"}:${props.demo}`} {...props} />;
}

function CareDiaryClientLifecycle({ clientId, clientName, sourceRevision, enabled, canSign, canRevise = canSign, demo }: LifecycleProps) {
  const router = useRouter();
  const [records, setRecords] = useState<DiaryRecord[]>([]);
  const [history, setHistory] = useState<z.infer<typeof snapshotSchema>["data"]["history"]>([]);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [readDenied, setReadDenied] = useState(false);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const readDeniedRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editingRecord, setEditingRecord] = useState<DiaryRecord | null>(null);
  const editingId = editingRecord?.id ?? null;
  const [proposal, setProposal] = useState<ActionProposal | null>(null);
  const [retryKind, setRetryKind] = useState<DiaryAction | null>(null);
  const proposalRef = useRef<ActionProposal | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const anchor = useRef<HTMLHeadingElement | null>(null);
  const attempt = useCareWriteAttempt<DiaryMutation>();
  const attemptAdapter = useRef(attempt);
  const readback = useRef<ReadbackConfirmation | null>(null);
  const inFlight = useRef(false);
  const lifecycle = useRef({ mounted: true, epoch: 0 });
  const writeController = useRef<AbortController | null>(null);
  const currentRecords = useRef(records);
  const sourceReady = useRef(false);
  const priorRevision = useRef(sourceRevision);
  const authority = useRef({ clientId, enabled, canSign, canRevise, demo });
  useLayoutEffect(() => { attemptAdapter.current = attempt; });

  useLayoutEffect(() => {
    lifecycle.current.epoch += 1;
    if (priorRevision.current !== sourceRevision) {
      sourceReady.current = false;
      // The new source starts a real GET below; mark its stale rows before paint.
      setLoading(Boolean(clientId));
      setError(null);
    }
    priorRevision.current = sourceRevision;
    authority.current = { clientId, enabled, canSign, canRevise, demo };
    proposalRef.current = null;
    // Invalidate the old confirmation before paint when a capability changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProposal(null);
    // A changed capability cannot authorize an old response after an ABA.
    if (inFlight.current) attemptAdapter.current.failed();
    writeController.current?.abort();
  }, [clientId, enabled, canSign, canRevise, demo, sourceRevision]);
  useEffect(() => {
    const owner = lifecycle.current; owner.mounted = true;
    const removeGuard = installPendingNavigationGuard({ hasPendingOperation: () => inFlight.current || attemptAdapter.current.current() !== null,
      permittedFormAttribute: "data-core-care-draft", onBlocked: () => setNotice("上一筆日誌結果尚待確認；請回原操作核對，不要另建相同紀錄。") });
    return () => { owner.mounted = false; owner.epoch += 1; writeController.current?.abort(); removeGuard(); };
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    sourceReady.current = false;
    if (!clientId) return;
    void fetchJsonWithTimeout(`/api/records?client=${encodeURIComponent(clientId)}`, { signal: controller.signal }).then(({ response, payload }) => {
      const data = snapshotSchema.safeParse(payload);
      if (!response.ok || !data.success || data.data.data.demo !== demo || data.data.data.persisted === demo) throw new Error("LOAD_FAILED");
      if (data.data.data.records.some((record) => record.client_id !== clientId)
        || data.data.data.history.some((entry) => !data.data.data.records.some((record) => record.record_key === entry.record_key))) throw new Error("CLIENT_MISMATCH");
      if (current) {
        const expected = readback.current;
        if (expected && ![...data.data.data.records, ...data.data.data.history].some((entry) => entry.id === expected.record.id && entry.record_key === expected.record.record_key && entry.version === expected.record.version && entry.status === expected.record.status)) {
          throw new Error("READBACK_NOT_CONFIRMED");
        }
        currentRecords.current = data.data.data.records;
        sourceReady.current = true;
        readDeniedRef.current = false; setReadDenied(false); setReadUnavailable(false); setError(null);
        const queued = proposalRef.current;
        if (queued && !currentRecords.current.some((row) => JSON.stringify(row) === JSON.stringify(queued.mutation.record))) {
          proposalRef.current = null; setProposal(null); setNotice("日誌來源已更新，請重新核對目前版本再選擇操作。");
        }
        setRecords(data.data.data.records); setHistory(data.data.data.history);
        if (expected) { setNotice(expected.notice); readback.current = null; }
      }
    }).catch((caught: unknown) => {
      if (!current) return;
      setReadUnavailable(true);
      if (caught instanceof ClientJsonReadError && (caught.status === 401 || caught.status === 403)) {
        readDeniedRef.current = true; setReadDenied(true);
        currentRecords.current = []; setRecords([]); setHistory([]); setEditingRecord(null);
        proposalRef.current = null; setProposal(null);
        setError("目前登入或日誌查看權限已變更，舊內容已隱藏。請重新讀取核對；已送出的原操作仍待確認，不會另建相同紀錄。");
      } else setError(readback.current ? "系統已回覆儲存，但尚未重新讀回這個版本。請按「重新讀取」核對，不要另建相同紀錄。" : `目前無法載入日誌，請檢查連線或重新登入後重試。這不代表沒有紀錄。${currentRecords.current.length ? "下方保留先前內容，尚未核對最新來源；請重新讀取後再保存。" : ""}`);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [clientId, reload, demo, sourceRevision]);

  function mayAct(record: DiaryRecord, kind: DiaryAction) {
    const current = authority.current;
    return lifecycle.current.mounted && !readDeniedRef.current && !current.demo && !!current.clientId && record.client_id === current.clientId &&
      (kind === "sign" ? current.canSign : current.enabled) &&
      (!(kind === "correct" || kind === "reopen") || current.canRevise);
  }

  function propose(record: DiaryRecord, kind: DiaryAction, extra: Record<string, unknown> = {}, valid: () => boolean = () => true) {
    if (inFlight.current || attempt.current() || !sourceReady.current || editingId !== null || navigationLocked() || !mayAct(record, kind)) return;
    const body = diaryActionSchema.safeParse({ action: kind, base_version: record.version, ...extra, ...(kind === "sign" ? { confirmed: true } : {}) });
    if (!body.success) { setError("請確認本次操作與理由，內容尚未送出。"); return; }
    const epoch = lifecycle.current.epoch;
    const isCurrent = () => lifecycle.current.mounted && lifecycle.current.epoch === epoch && mayAct(record, kind) && valid() &&
      currentRecords.current.some((row) => JSON.stringify(row) === JSON.stringify(record));
    const open = () => {
      if (!isCurrent() || inFlight.current || attempt.current() || navigationLocked()) return;
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next = { mutation: { record, kind, body: JSON.stringify(body.data) }, epoch, valid: isCurrent };
      proposalRef.current = next; setProposal(next); setError(null); setNotice(null);
    };
    if (!requestUnsavedExit(open, isCurrent)) open();
  }

  async function action(mutation: DiaryMutation, confirmation?: ActionProposal) {
    const { record, kind } = mutation;
    if (inFlight.current || !mayAct(record, kind)) return false;
    if (navigationLocked()) { setError("請先完成目前的保存核對或清單更新，再送出這筆日誌操作。"); return false; }
    const prior = attempt.current();
    if (prior && (prior.body.record.id !== record.id || prior.body.kind !== kind)) return false;
    if (!prior && (!sourceReady.current || !currentRecords.current.some((row) => JSON.stringify(row) === JSON.stringify(record)) ||
      kind !== "edit" && (confirmation !== proposalRef.current || !confirmation?.valid()))) {
      proposalRef.current = null; setProposal(null); setNotice("原內容或權限已變更，請重新核對版本與理由再選擇操作。"); return false;
    }
    const frozen = prior ?? attempt.prepare(mutation, crypto.randomUUID());
    setRetryKind(frozen.body.kind);
    const controller = new AbortController(); writeController.current = controller;
    const epoch = lifecycle.current.epoch;
    const isCurrent = () => lifecycle.current.mounted && lifecycle.current.epoch === epoch && !controller.signal.aborted;
    inFlight.current = true; setPending(true); setError(null); setNotice(null);
    try {
      const { response, raw, rejected } = await withCareRequestDeadline(async (signal) => {
        signal.throwIfAborted();
        const response = await fetchWithTimeout(`/api/records/${frozen.body.record.id}/actions`, { method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json", "Idempotency-Key": frozen.key }, body: frozen.body.body });
        signal.throwIfAborted();
        const rejected = !response.ok && await isDefiniteCareRejection(response);
        signal.throwIfAborted();
        const raw: unknown = await response.json().catch(() => null);
        signal.throwIfAborted();
        return { response, raw, rejected };
      }, { signal: controller.signal });
      if (!isCurrent()) return false;
      if (rejected && !attempt.failed(response.status)) setRetryKind(null);
      const parsed = receiptSchema.safeParse(raw);
      if (!response.ok || !parsed.success) {
        const failure = z.object({ errors: z.array(z.object({ message: z.string() })) }).safeParse(raw);
        throw new Error(failure.success && failure.data.errors.length ? failure.data.errors[0]!.message : "回覆不完整；請保留內容並重試同一次操作。");
      }
      const receipt = parsed.data.data;
      const expectedStatus = kind === "edit" || kind === "correct" || kind === "reopen" ? "draft" : kind === "submit" ? "submitted" : record.correction_source_id ? "corrected" : "signed";
      if (receipt.record.client_id !== clientId || receipt.record.record_key !== record.record_key || receipt.record.version !== record.version + 1 || receipt.record.previous_version_id !== record.id || receipt.record.status !== expectedStatus || response.status !== (receipt.replayed ? 200 : 201) || (kind === "correct" && receipt.record.correction_source_id !== record.id)) throw new Error("回覆版本或簽署狀態不一致，請保留內容並重新確認。");
      const expectedFields = careDiaryDataSchema.safeParse(kind === "edit" ? (JSON.parse(frozen.body.body) as { data: unknown }).data : frozen.body.record.fields);
      if (!expectedFields.success || JSON.stringify(receipt.record.fields) !== JSON.stringify(expectedFields.data)
        || new Date(receipt.record.occurred_at).getTime() !== new Date(frozen.body.record.occurred_at).getTime()) {
        throw new Error("回覆內容或發生時間與原操作不一致，請保留內容並重試原操作。");
      }
      readback.current = { record: receipt.record, notice: kind === "sign" ? "已重新讀回這個正式簽署版本。" : kind === "submit" ? "已重新讀回提交版本，仍待簽署，不會計為正式完成。" : kind === "correct" ? "已重新讀回更正草稿。請逐項檢查同一事件的內容，再提交簽署。" : "已重新讀回草稿修訂；尚未正式完成。" };
      setNotice("系統已回覆儲存，正在重新讀取確認；尚未完成讀回核對。");
      attempt.confirmed(); setRetryKind(null); proposalRef.current = null; setProposal(null); setLoading(true); setRecords([]); setHistory([]); setEditingRecord(null); setReload((value) => value + 1); router.refresh(); return true;
    } catch (caught) {
      attempt.failed();
      if (isCurrent()) setError(caught instanceof Error && !(caught instanceof TypeError) ? caught.message : "尚未確認完成，請保留內容並重試同一次操作。");
      return false;
    } finally { if (writeController.current === controller) writeController.current = null; inFlight.current = false; if (lifecycle.current.mounted) setPending(false); }
  }

  const visibleRecords = editingRecord ? records.some((row) => row.id === editingRecord.id)
    ? records.map((row) => row.id === editingRecord.id ? editingRecord : row) : [editingRecord, ...records] : records;
  return <section className={`panel ${styles.workspace}`} aria-labelledby="diary-lifecycle-title"><div className="panel__header"><div><p className="eyebrow">草稿 → 確認 → 簽署</p><h2 id="diary-lifecycle-title" tabIndex={-1} data-governance-focus-anchor ref={anchor}>接續完成照顧日誌</h2></div><button type="button" className="button button--secondary" disabled={loading || pending || !clientId || (editingId !== null && !readUnavailable) || (attempt.locked && !readDenied) || proposal !== null} onClick={() => { if (navigationLocked()) return; setLoading(true); setError(null); setRecords([]); setHistory([]); setReload((value) => value + 1); }}>重新讀取</button></div>
    {!clientId ? <p>請先選擇一位個案，查看與接續完成他的日誌。</p> : null}
    {loading ? <p role="status">{records.length ? "正在更新日誌；下方仍是先前讀取的內容，請等待核對。" : "正在讀取日誌…"}</p> : null}{error && proposal === null ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {attempt.locked && !pending && proposal === null ? <div className="callout core-care-callout"><p role="status">上一筆操作結果尚未確認，內容已鎖定。請重試原操作；不要修改內容或另建相同紀錄。若持續被拒絕，請聯絡主管核對。</p><button type="button" className="button button--primary" disabled={loading || readDenied || demo || (retryKind === "sign" ? !canSign : !enabled) || ((retryKind === "correct" || retryKind === "reopen") && !canRevise)} onClick={() => { const original = attempt.current(); if (original) void action(original.body); }}>重試原操作</button></div> : null}
    {clientId && !loading && !error && records.length === 0 ? <p>{demo ? "展示模式不保存日誌或簽署。正式登入並選擇個案後，這裡會顯示可接續的草稿。" : "這位個案目前沒有日誌。可從上方新增日誌草稿。"}</p> : null}
    {visibleRecords.map((record) => <article key={record.id} className="today-work-card"><header><h3>{record.fields.care_item}</h3><p>{new Date(record.occurred_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · 第 {record.version} 版 · {statusLabels[record.status]}</p></header>
      <p>{record.fields.note || "未填寫文字摘要，請確認本次快速紀錄。"}</p>
      {record.fields.abnormal ? <p>需留意：{record.fields.follow_up || "請補充後續行動"}</p> : null}
      {record.fields.observations ? <details><summary>查看本次快速紀錄</summary><DiaryObservationSummary observations={record.fields.observations} /></details> : null}
      {record.signed_at ? <p>簽署時間：{new Date(record.signed_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}。原內容不可覆寫。</p> : null}
      {editingId === record.id ? <><p className="muted">修訂以這個原版本為基準；若來源已更新，請先保留內容並核對，不會自動改成新版本。</p><DiaryEditor key={record.id} record={record} sourceRevision={sourceRevision} pending={pending} locked={attempt.locked} enabled={enabled && !demo && !loading && !readUnavailable} onSave={(fields) => action({ record, kind: "edit", body: JSON.stringify({ action: "edit", base_version: record.version, data: fields }) })} onCancel={() => { if (!attempt.current()) setEditingRecord(null); }} /></> : null}
      <div className="action-row">{record.status === "draft" ? <><button className="button button--secondary" disabled={loading || readUnavailable || pending || attempt.locked || !enabled || demo || editingId !== null || proposal !== null} onClick={() => { if (!navigationLocked() && sourceReady.current) setEditingRecord(record); }} type="button">繼續編輯草稿</button><button className="button button--primary" disabled={loading || readUnavailable || pending || attempt.locked || !enabled || demo || editingId !== null || proposal !== null} onClick={() => propose(record, "submit")} type="button">提交已儲存版本</button></> : record.status === "submitted" ? <><button className="button button--primary" disabled={loading || readUnavailable || pending || attempt.locked || !canSign || demo || editingId !== null || proposal !== null} onClick={() => propose(record, "sign")} type="button">確認內容並簽署</button><RevisionReason record={record} kind="reopen" disabled={loading || readUnavailable || pending || attempt.locked || !enabled || !canRevise || demo || editingId !== null} onPropose={propose} /></> : <RevisionReason record={record} kind="correct" disabled={loading || readUnavailable || pending || attempt.locked || !enabled || !canRevise || demo || editingId !== null} onPropose={propose} />}</div>
      <details><summary>版本與更正歷程</summary><ol>{history.filter((item) => item.record_key === record.record_key).map((item) => <li key={item.id}>第 {item.version} 版 · {statusLabels[item.status as keyof typeof statusLabels] ?? item.status}{item.correction_reason ? ` · ${item.correction_reason}` : ""}</li>)}</ol></details>
    </article>)}
    <GovernanceDialog open={proposal !== null} title={proposal && proposal.mutation.kind !== "edit" ? actionTitles[proposal.mutation.kind] : "確認日誌操作"}
      busy={pending} returnFocusRef={trigger} fallbackFocusRef={anchor} onRequestClose={() => { if (!pending) { proposalRef.current = null; setProposal(null); } }}>
      {proposal && proposal.mutation.kind !== "edit" ? <>
        <p>{clientName ? `${clientName}的` : "目前選定個案的"}「{proposal.mutation.record.fields.care_item}」 · 第 {proposal.mutation.record.version} 版 · {statusLabels[proposal.mutation.record.status]}</p>
        <p>{new Date(proposal.mutation.record.occurred_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}（臺北時間） · {{ morning: "上午", afternoon: "下午", full_day: "全日" }[proposal.mutation.record.fields.shift]}</p>
        <details><summary>核對個案與原紀錄</summary><p>個案識別：{proposal.mutation.record.client_id}<br />原紀錄：{proposal.mutation.record.id}</p></details>
        <p>{actionConsequences[proposal.mutation.kind]}</p>
        <p>{proposal.mutation.record.fields.note || "未填寫文字摘要；請核對本次快速紀錄。"}</p>
        <p>{proposal.mutation.record.fields.abnormal ? "本次標記為需留意。" : "本次未標記為需留意。"}</p>
        {proposal.mutation.record.fields.follow_up ? <p>後續行動：{proposal.mutation.record.fields.follow_up}</p> : null}
        {proposal.mutation.record.fields.observations ? <DiaryObservationSummary observations={proposal.mutation.record.fields.observations} /> : null}
        {proposal.mutation.kind === "correct" || proposal.mutation.kind === "reopen" ? <p>本次理由：{(JSON.parse(proposal.mutation.body) as { reason: string }).reason}</p> : null}
        {pending ? <p role="status">正在送出這個原版本；請等待回覆，不要重複操作。</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {attempt.locked && !pending ? <p role="status">原操作結果尚待確認。重試只使用原內容及原操作鍵；關閉視窗不等於取消已送出操作。</p> : null}
        <div className={styles.actions}><button type="button" className="button button--primary" disabled={pending} aria-busy={pending}
          onClick={() => { if (proposal === proposalRef.current) void action(proposal.mutation, proposal); }}>{pending ? "處理中…" : attempt.locked ? "重試原操作" : actionLabels[proposal.mutation.kind]}</button></div>
      </> : null}
    </GovernanceDialog>
  </section>;
}

function DiaryObservationSummary({ observations }: { observations: NonNullable<DiaryRecord["fields"]["observations"]> }) {
  const labels = { meal: "本次進食量", water: "本次飲水量", toileting: "本次如廁", activity: "本次活動參與" };
  const values: Record<string, string> = { none: "未進食", quarter: "約四分之一", half: "約一半", three_quarters: "約四分之三", all: "全部", independent: "自行完成", assisted: "協助完成", not_needed: "當時無需求", concern: "需留意", participated: "參與", partial: "部分參與", declined: "婉拒", resting: "休息" };
  return <dl>{Object.entries(observations).map(([key, entry]) => <div key={key}><dt>{labels[key as keyof typeof labels]}</dt><dd>{entry.state === "unknown" ? "尚未觀察／不清楚" : entry.state === "not_applicable" ? "本次不適用" : key === "water" ? `${entry.value} 毫升` : values[String(entry.value)]}</dd></div>)}</dl>;
}
