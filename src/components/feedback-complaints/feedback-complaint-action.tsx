"use client";

import {
  CheckCircle2, ClipboardEdit, MessageSquarePlus, RefreshCw,
  Send, UserRoundCheck, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseFeedbackComplaintActionError,
  parseFeedbackComplaintActionSuccess,
} from "@/lib/feedback-complaints/parser";
import type {
  FeedbackAction,
  FeedbackAssigneeOption,
  FeedbackComplaintItem,
  FeedbackComplaintMutationInput,
  FeedbackDeadlineRuleOption,
} from "@/lib/feedback-complaints/types";

import styles from "./feedback-complaints.module.css";

const LABELS: Record<FeedbackAction, string> = {
  create: "建立案件",
  assign: "指派承辦",
  progress: "更新處理",
  correct: "追加更正",
  close: "完成結案",
};

function icon(action: FeedbackAction) {
  if (action === "create") return <MessageSquarePlus aria-hidden="true" />;
  if (action === "assign") return <UserRoundCheck aria-hidden="true" />;
  if (action === "progress") return <Send aria-hidden="true" />;
  if (action === "correct") return <ClipboardEdit aria-hidden="true" />;
  return <CheckCircle2 aria-hidden="true" />;
}

function taipeiLocal(value: Date | string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return "";
  const instant = new Date(`${value}:00+08:00`);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : "";
}

function payload(input: FeedbackComplaintMutationInput): Record<string, unknown> {
  if (input.action === "create") return {
    action: input.action, deadline_rule_id: input.deadlineRuleId,
    received_at: input.receivedAt, reporter_name: input.reporterName,
    reporter_contact: input.reporterContact, subject: input.subject,
    description: input.description,
  };
  const base = { action: input.action, case_id: input.caseId,
    expected_version: input.expectedVersion };
  if (input.action === "assign") return { ...base,
    assignee_membership_id: input.assigneeMembershipId, note: input.note };
  if (input.action === "progress") return { ...base, note: input.note };
  if (input.action === "correct") return { ...base,
    corrected_event_id: input.correctedEventId,
    correction_reason: input.correctionReason,
    reporter_name: input.reporterName,
    reporter_contact: input.reporterContact,
    subject: input.subject, description: input.description };
  return { ...base, resolution: input.resolution };
}

function requestIdSuffix(value: unknown) {
  if (!value || typeof value !== "object" || !("requestId" in value) ||
    typeof value.requestId !== "string") return "";
  return `（請求 ${value.requestId}）`;
}

export function FeedbackComplaintAction({
  action,
  assignees,
  canClose,
  canCorrect,
  canManage,
  complaint,
  deadlineRules,
  demo,
  hasRecentAal2,
  instance,
}: {
  action: FeedbackAction;
  assignees: readonly FeedbackAssigneeOption[];
  canClose: boolean;
  canCorrect: boolean;
  canManage: boolean;
  complaint?: FeedbackComplaintItem;
  deadlineRules: readonly FeedbackDeadlineRuleOption[];
  demo: boolean;
  hasRecentAal2: boolean;
  instance: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const retainedAttempt = useRef<{
    input: FeedbackComplaintMutationInput;
    body: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receivedLocal, setReceivedLocal] = useState("");
  const [ruleId, setRuleId] = useState(deadlineRules[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState(
    complaint?.assigneeMembershipId ?? assignees[0]?.membershipId ?? "",
  );
  const closed = complaint?.status === "closed";
  const latestCorrectable = complaint?.timeline.at(-1)?.id ?? "";
  const permitted = action === "close" ? canClose && hasRecentAal2
    : action === "correct" ? canCorrect && hasRecentAal2 && !complaint?.sensitiveMasked
      : canManage;
  const prerequisite = action === "create" ? deadlineRules.length > 0
    : action === "assign" ? assignees.length > 0
      : action === "progress" || action === "close"
        ? Boolean(complaint?.assigneeMembershipId) : Boolean(latestCorrectable);
  const enabled = !demo && permitted && prerequisite && !closed && !pending;
  const label = LABELS[action];
  const dialogId = `feedback-${action}-${instance}-${complaint?.id ?? "new"}`;
  const descriptionId = `${dialogId}-description`;
  const disabledReason = demo ? "展示模式不會寫入資料"
    : closed ? "案件已結案，事件鏈不可追加"
      : action === "create" && deadlineRules.length === 0
        ? "尚無已發布的精確期限規則，建立功能採失敗即關閉"
        : action === "assign" && assignees.length === 0
          ? "目前沒有同範圍且具處理權限的有效承辦人"
          : (action === "progress" || action === "close") && !complaint?.assigneeMembershipId
            ? "案件須先指派承辦人"
            : action === "correct" && complaint?.sensitiveMasked
              ? "敏感內容已遮蔽，無法建立完整更正版"
              : (action === "correct" || action === "close") && !hasRecentAal2
                ? "須在同一工作階段完成最近 15 分鐘 AAL2 驗證"
                : !permitted ? "目前角色沒有此操作權限" : undefined;

  function open() {
    if (!enabled) return;
    setReceivedLocal(taipeiLocal(new Date()));
    setRuleId(deadlineRules[0]?.id ?? "");
    setAssigneeId(complaint?.assigneeMembershipId ?? assignees[0]?.membershipId ?? "");
    setError(null);
    setNotice(null);
    setCompleted(false);
    setUnknownOutcome(false);
    idempotencyKey.current = crypto.randomUUID();
    retainedAttempt.current = null;
    dialog.current?.showModal();
  }

  function close() {
    if (!pendingRef.current && !unknownOutcome) dialog.current?.close();
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first ||
      !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || completed || (!complaint && action !== "create")) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const form = new FormData(event.currentTarget);
    let input: FeedbackComplaintMutationInput;
    let body: string;
    if (unknownOutcome && retainedAttempt.current) {
      ({ input, body } = retainedAttempt.current);
    } else if (action === "create") {
      const receivedAt = taipeiLocalToIso(receivedLocal);
      if (!receivedAt) {
        setError("受理時間格式無效。");
        pendingRef.current = false; setPending(false); return;
      }
      input = {
        action, deadlineRuleId: ruleId, receivedAt,
        reporterName: String(form.get("reporterName") ?? "").trim() || null,
        reporterContact: String(form.get("reporterContact") ?? "").trim() || null,
        subject: String(form.get("subject") ?? ""),
        description: String(form.get("description") ?? ""),
        idempotencyKey: idempotencyKey.current,
      };
      body = JSON.stringify(payload(input));
    } else if (action === "assign") {
      input = { action, caseId: complaint!.id,
        expectedVersion: complaint!.chainVersion,
        assigneeMembershipId: assigneeId,
        note: String(form.get("note") ?? "").trim() || null,
        idempotencyKey: idempotencyKey.current };
      body = JSON.stringify(payload(input));
    } else if (action === "progress") {
      input = { action, caseId: complaint!.id,
        expectedVersion: complaint!.chainVersion,
        note: String(form.get("note") ?? ""),
        idempotencyKey: idempotencyKey.current };
      body = JSON.stringify(payload(input));
    } else if (action === "correct") {
      input = { action, caseId: complaint!.id,
        expectedVersion: complaint!.chainVersion,
        correctedEventId: String(form.get("correctedEventId") ?? ""),
        correctionReason: String(form.get("correctionReason") ?? ""),
        reporterName: String(form.get("reporterName") ?? "").trim() || null,
        reporterContact: String(form.get("reporterContact") ?? "").trim() || null,
        subject: String(form.get("subject") ?? ""),
        description: String(form.get("description") ?? ""),
        idempotencyKey: idempotencyKey.current };
      body = JSON.stringify(payload(input));
    } else {
      input = { action: "close", caseId: complaint!.id,
        expectedVersion: complaint!.chainVersion,
        resolution: String(form.get("resolution") ?? ""),
        idempotencyKey: idempotencyKey.current };
      body = JSON.stringify(payload(input));
    }
    retainedAttempt.current = { input, body };
    try {
      const response = await fetchWithTimeout("/api/feedback-complaints", {
        method: action === "create" ? "POST" : "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          "X-Feedback-Operation": action,
        },
        body,
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parseFeedbackComplaintActionError(raw);
        const uncertain = response.status >= 500 ||
          envelope?.errors[0]?.code === "FEEDBACK_SAVE_FAILED";
        setUnknownOutcome(uncertain);
        setError(`${envelope?.errors[0]?.message ?? (uncertain
          ? "操作結果尚未確認；請保留內容並以原操作重試。"
          : "操作尚未完成；請檢查內容後再送出。")} ${requestIdSuffix(raw)}`.trim());
        return;
      }
      let success;
      try { success = parseFeedbackComplaintActionSuccess(raw, input); }
      catch {
        setUnknownOutcome(true);
        setError(`伺服器回覆不完整，結果未知；請保留內容並以原操作重試。${requestIdSuffix(raw)}`);
        return;
      }
      const receipt = success.data;
      if (!receipt) {
        setUnknownOutcome(true);
        setError(`伺服器未提供完成憑證，結果未知；請以原操作重試。${requestIdSuffix(raw)}`);
        return;
      }
      const expectedStatus = action === "create"
        ? (receipt.replayed ? 200 : 201) : 200;
      if (response.status !== expectedStatus) {
        setUnknownOutcome(true);
        setError(`HTTP 狀態與完成憑證不一致，結果未知；請以原操作重試。${requestIdSuffix(raw)}`);
        return;
      }
      setCompleted(true);
      setUnknownOutcome(false);
      retainedAttempt.current = null;
      setNotice(receipt.replayed
        ? "已確認先前相同操作，沒有建立重複事件。"
        : action === "create" ? `案件 ${receipt.caseNumber} 已建立。`
          : action === "close" ? "已追加不可修改的結案事件。"
            : "已追加不可修改的案件事件。");
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setUnknownOutcome(true);
      setError(isClientFetchTimeoutError(caught)
        ? "連線逾時，結果未知；內容與操作識別碼已鎖定，請直接重試。"
        : "網路狀態不明，結果未知；內容與操作識別碼已鎖定，請直接重試。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <div className={styles.actionSlot}>
    <button aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
      className={`button ${action === "create" || action === "close"
        ? "button--primary" : "button--secondary"} ${styles.actionButton}`}
      disabled={!enabled} onClick={open} ref={trigger}
      title={!enabled ? disabledReason : undefined} type="button">
      {icon(action)}{label}
    </button>
    {notice ? <span className="sr-only" role="status">{notice}</span> : null}
    <dialog aria-describedby={descriptionId} aria-labelledby={dialogId}
      className={`core-dialog ${styles.dialog}`}
      onCancel={(event) => { if (pendingRef.current || unknownOutcome) event.preventDefault(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onClose={() => trigger.current?.focus()} onKeyDown={keepFocusInside} ref={dialog}>
      <form className="core-dialog__surface" onSubmit={submit}>
        <header className="drawer__header"><div>
          <p className="eyebrow">意見與申訴・不可變事件鏈</p>
          <h2 id={dialogId}>{label}</h2>
          <p id={descriptionId}>{action === "create"
            ? "期限只由已發布的精確規則產生，畫面不能自填或放寬。"
            : action === "correct" ? "更正會新增完整內容版本並連回被更正事件，不覆寫原值。"
              : action === "close" ? "結案會追加結果，原案件與歷次處理仍保留。"
                : "每次操作綁定目前案件版本；版本已變更時不會靜默覆蓋。"}</p>
        </div><button aria-label="關閉" className="icon-button"
          disabled={pending || unknownOutcome} onClick={close} type="button">
          <X aria-hidden="true" /></button></header>
        <div className="drawer__body"><fieldset className={styles.fields}
          disabled={pending || completed || unknownOutcome}>
          {action === "create" ? <>
            <label className={`field ${styles.full}`}><span>已發布期限規則 *</span>
              <select onChange={(event) => setRuleId(event.target.value)} required value={ruleId}>
                {deadlineRules.map((rule) => <option key={rule.id} value={rule.id}>
                  {rule.label}（{rule.responseHours} 小時）
                </option>)}</select></label>
            <label className="field"><span>受理時間（台北）*</span>
              <input max={taipeiLocal(new Date())} onChange={(event) =>
                setReceivedLocal(event.target.value)} required type="datetime-local"
                value={receivedLocal} /></label>
            <label className="field"><span>陳述人（可留空）</span>
              <input maxLength={160} name="reporterName" /></label>
            <label className={`field ${styles.full}`}><span>聯絡方式（可留空）</span>
              <input autoComplete="off" maxLength={240} name="reporterContact" /></label>
            <label className={`field ${styles.full}`}><span>主旨 *</span>
              <input maxLength={240} name="subject" required /></label>
            <label className={`field ${styles.full}`}><span>陳述內容 *</span>
              <textarea maxLength={4000} name="description" required rows={6} /></label>
          </> : <>
            <div className={styles.caseContext}><strong>{complaint?.caseNumber}</strong>
              <span>目前狀態：{complaint?.status}・版本 v{complaint?.chainVersion}</span>
              <span>期限：{complaint?.dueAt}</span></div>
            {action === "assign" ? <>
              <label className={`field ${styles.full}`}><span>承辦人 *</span>
                <select onChange={(event) => setAssigneeId(event.target.value)}
                  required value={assigneeId}>{assignees.map((person) =>
                    <option key={person.membershipId} value={person.membershipId}>
                      {person.displayName}（{person.scope === "branch" ? "分支" : "機構"}）
                    </option>)}</select></label>
              <label className={`field ${styles.full}`}><span>指派說明（可留空）</span>
                <textarea maxLength={1000} name="note" rows={3} /></label>
            </> : action === "progress" ?
              <label className={`field ${styles.full}`}><span>處理進度與證據 *</span>
                <textarea maxLength={2000} name="note" required rows={5} /></label>
              : action === "correct" ? <>
                <label className={`field ${styles.full}`}><span>被更正事件 *</span>
                  <select defaultValue={latestCorrectable} name="correctedEventId" required>
                    {complaint?.timeline.map((entry) => <option key={entry.id} value={entry.id}>
                      v{entry.version}・{entry.eventType}
                    </option>)}</select></label>
                <label className={`field ${styles.full}`}><span>更正理由 *</span>
                  <textarea maxLength={1000} name="correctionReason" required rows={3} /></label>
                <label className="field"><span>陳述人（可留空）</span>
                  <input defaultValue={complaint?.reporterName ?? ""} maxLength={160}
                    name="reporterName" /></label>
                <label className="field"><span>聯絡方式（可留空）</span>
                  <input autoComplete="off" defaultValue={complaint?.reporterContact ?? ""}
                    maxLength={240} name="reporterContact" /></label>
                <label className={`field ${styles.full}`}><span>完整更正後主旨 *</span>
                  <input defaultValue={complaint?.subject ?? ""} maxLength={240}
                    name="subject" required /></label>
                <label className={`field ${styles.full}`}><span>完整更正後內容 *</span>
                  <textarea defaultValue={complaint?.description ?? ""} maxLength={4000}
                    name="description" required rows={6} /></label>
              </> : <>
                <label className={`field ${styles.full}`}><span>結案結果與回覆證據 *</span>
                  <textarea maxLength={4000} name="resolution" required rows={6} /></label>
                <label className={`check-field ${styles.full}`}>
                  <input required type="checkbox" />
                  <span>我已在同一工作階段完成最近 15 分鐘 AAL2，並確認結案不會覆寫歷史。</span>
                </label>
              </>}
          </>}
        </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {unknownOutcome ? <div className={styles.unknown} role="status">
            <RefreshCw aria-hidden="true" />內容與冪等鍵已鎖定；請直接使用原操作重試。
          </div> : null}
        </div>
        <footer className="drawer__footer">
          <button className="button button--secondary" disabled={pending || unknownOutcome}
            onClick={close} type="button">取消</button>
          <button className="button button--primary" disabled={pending || completed} type="submit">
            {pending ? "確認中…" : unknownOutcome ? "使用原操作重試" : label}
          </button>
        </footer>
      </form>
    </dialog>
  </div>;
}
