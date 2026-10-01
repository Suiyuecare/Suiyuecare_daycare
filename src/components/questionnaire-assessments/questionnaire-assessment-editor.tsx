"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { ClientJsonReadError, fetchJsonWithTimeout } from "@/lib/api/client-fetch";
import { questionnairePreview } from "@/lib/questionnaire-assessments/preview";
import { parseQuestionnaireAssessmentPage, parseQuestionnaireHistoryPage } from "@/lib/questionnaire-assessments/contract";
import { useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { QuestionnaireOperationClientError, readQuestionnaireOperationReceipt, writeQuestionnaireDraft } from "@/lib/questionnaire-assessments/operation-client";
import { beginQuestionnairePending, cancelQuestionnaireRecoveryRead, getQuestionnairePending, getQuestionnaireRecoveryReadLease, isQuestionnairePendingOwnerAdmitted, isQuestionnairePendingSourceAdmitted, isQuestionnaireRecoveryReadCurrent, markQuestionnairePendingCommitted, markQuestionnairePendingDenied, markQuestionnairePendingUnknown, observeQuestionnairePendingSource, reconcileQuestionnairePendingExactHistory, retryQuestionnairePending, settleQuestionnaireRecoveryRead, useQuestionnairePending, type QuestionnairePendingScope } from "@/lib/questionnaire-assessments/pending";
import type {
  QuestionnaireAnswers,
  QuestionnaireAssessment,
  QuestionnaireAssessmentCursor,
  QuestionnaireClient,
  QuestionnaireDraft,
  QuestionnaireFormDefinition,
  QuestionnaireSnapshot,
} from "@/lib/questionnaire-assessments/types";
import { ClientSelectionCard } from "@/components/clients/client-selection-card";
import { NavigationLink } from "@/components/app/navigation-link";
import { assessmentEntryHref } from "@/lib/assessment-entry/selection";
import type { TenantContext } from "@/lib/domain/types";
import { admitQuestionnaireViewSource, canAdmitQuestionnaireViewSource, canReadQuestionnaireView, getQuestionnaireViewState, questionnaireViewAuthority, quarantineQuestionnaireView, useQuestionnaireViewState } from "@/lib/questionnaire-assessments/readiness-view";
import { QuestionnaireReadinessPanel } from "./questionnaire-readiness-panel";

import styles from "./questionnaire-assessments.module.css";

// HTTP 200 and an otherwise valid row are not successful read evidence when
// the API's own envelope reports an error. Never settle a saved-history guard
// from contradictory or malformed top-level metadata.
const historyEnvelopeSchema = z.object({
  requestId: z.string().uuid().refine(value => value === value.toLowerCase()),
  status: z.literal("ok"), data: z.unknown(), errors: z.tuple([]),
}).strict();

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function initialAnswers(form: QuestionnaireFormDefinition, item: QuestionnaireClient["latest"]): QuestionnaireAnswers {
  return Object.fromEntries(form.questions.map(({ id }) => [
    id,
    item?.answers[id] ?? { state: "missing" },
  ])) as QuestionnaireAnswers;
}

function initialContext(form: QuestionnaireFormDefinition, item: QuestionnaireClient["latest"]) {
  return Object.fromEntries([
    ...(form.contextFields ?? []).map(({ key }) => key),
    ...(form.measurementFields ?? []).map(({ key }) => key),
    ...(form.allowQualitativeNotes ? ["qualitative_note"] : []),
  ].map((key) => [key, item?.context[key] ?? ""]));
}

type EditorRequest = { action: "create" | "revise"; clientId: string; formKey: QuestionnaireFormDefinition["key"];
  formVersion: string; assessedOn: string; answers: QuestionnaireAnswers; context: Record<string, string>;
  assessmentKey?: string; previousVersionId?: string; expectedVersion?: number };

function QuestionnaireEditor({
  assessorName,
  canManage,
  client,
  form,
  baseline,
  readOnly = false,
  reading = false,
  scope,
  sourceAt,
  onSaved,
  onDirtyChange,
  onLockChange,
}: {
  assessorName: string;
  canManage: boolean;
  client: QuestionnaireClient;
  form: QuestionnaireFormDefinition;
  baseline: QuestionnaireDraft | null;
  readOnly?: boolean;
  reading?: boolean;
  scope: QuestionnairePendingScope | null;
  sourceAt: string;
  onSaved: (assessmentKey: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onLockChange: (locked: boolean) => void;
}) {
  const latest = baseline;
  const questionIdPrefix = useId();
  const journal = useQuestionnairePending(scope);
  const recovered = (journal.operation?.input.request ?? journal.confirmed[0]?.operation.input.request) as EditorRequest | undefined;
  const [answers, setAnswers] = useState(() => recovered?.answers ?? initialAnswers(form, latest));
  const [context, setContext] = useState(() => recovered?.context ?? initialContext(form, latest));
  const [assessedOn, setAssessedOn] = useState(recovered?.assessedOn ?? latest?.assessedOn ?? taipeiToday());
  const [dateError, setDateError] = useState("");
  const dateField = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [reasonErrors, setReasonErrors] = useState<Record<string, string>>({});
  const reasonFields = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const retryPending = journal.operation?.phase === "unknown";
  const committed = journal.confirmed.length > 0;
  const [checking, setChecking] = useState(false);
  const composing = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const activeAttempt = useRef<ReturnType<typeof beginQuestionnairePending>>(null);
  const viewTransitionPending = useViewTransitionPending();
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; controller.current?.abort();
      if (activeAttempt.current) markQuestionnairePendingUnknown(activeAttempt.current);
    };
  }, []);
  useEffect(() => {
    onLockChange(pending || Boolean(journal.operation) || committed || checking);
  }, [pending, journal.operation, committed, checking, onLockChange]);
  const responses = form.questions.map(({ id }) => answers[id] ?? { state: "missing" as const });
  const answeredCount = responses.filter((answer) => answer.state === "answered").length;
  const notApplicableCount = responses.filter((answer) => answer.state === "not_applicable").length;
  const missingCount = responses.filter((answer) => answer.state === "missing").length;
  const allowsNotApplicable = form.key === "barthel_adl" || form.key === "lawton_iadl";
  const suicideAnswer = form.key === "bsrs5" ? answers.bsrs_suicide : null;
  const suicideConcern = suicideAnswer?.state === "answered" && Number(suicideAnswer.value) > 0;
  const { result: scorePreview, measurementIssue } = questionnairePreview(form, answers, context);
  const height = Number(context.height_cm);
  const weight = Number(context.weight_kg);
  const bmi = height > 0 && weight > 0 ? weight / ((height / 100) ** 2) : null;

  function setResponse(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: { state: "answered", value } }));
    clearReasonError(questionId);
  }

  function clearReasonError(questionId: string) {
    setReasonErrors((current) => {
      if (!current[questionId]) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setMessage("");
  }

  function markDirty() {
    onDirtyChange(true);
  }

  async function save() {
    if (!scope) throw new Error("請重新登入並載入授權個案後再保存。");
    const action = latest ? "revise" : "create";
    const body = {
      action,
      clientId: client.clientId,
      formKey: form.key,
      formVersion: form.version,
      assessedOn,
      answers,
      context: Object.fromEntries(Object.entries(context).filter(([, value]) => value !== "")),
      ...(latest ? {
        assessmentKey: latest.assessmentKey,
        previousVersionId: latest.versionId,
        expectedVersion: latest.version,
      } : {}),
    };
    const existing = getQuestionnairePending(scope).operation;
    const operation = existing ? retryQuestionnairePending(existing.token, scope) :
      beginQuestionnairePending(scope, { request: body, idempotencyKey: crypto.randomUUID() }, sourceAt);
    if (!operation) throw new Error("請先確認原筆保存結果，或等待其他作業完成。");
    activeAttempt.current = operation;
    controller.current?.abort(); controller.current = new AbortController();
    try {
      const receipt = await writeQuestionnaireDraft(operation.body, operation.input.idempotencyKey, form.key, controller.current.signal);
      if (!mounted.current) return;
      if (!markQuestionnairePendingCommitted(operation, receipt)) {
        markQuestionnairePendingUnknown(operation);
        setMessage("保存結果尚未確認；請先確認原筆結果，不要重複新增。"); return;
      }
      activeAttempt.current = null;
      onDirtyChange(false);
      setMessage("草稿已保存，正在讀回紀錄。");
      await onSaved(receipt.assessmentKey);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof QuestionnaireOperationClientError && error.code === "REJECTED") markQuestionnairePendingDenied(operation);
      else markQuestionnairePendingUnknown(operation);
      if (error instanceof QuestionnaireOperationClientError && (error.status === 401 || error.status === 403 || error.code === "INVALID_RESPONSE")) {
        quarantineQuestionnaireView(scope.authority); return;
      }
      throw error;
    }
  }

  async function checkResult() {
    if (!scope || checking || pending || reading) return;
    const check = getQuestionnaireRecoveryReadLease(scope);
    if (!check) { setMessage("請等待其他作業完成，再確認保存結果。"); return; }
    controller.current?.abort(); controller.current = new AbortController();
    setChecking(true); setMessage("");
    try {
      const operation = check.operation;
      const proof = await readQuestionnaireOperationReceipt({ organizationId: scope.organizationId, branchId: scope.branchId,
        actorUserId: scope.actorUserId, clientId: scope.clientId, formKey: scope.formKey,
        action: (operation.input.request as EditorRequest).action, idempotencyKey: operation.input.idempotencyKey,
        nonce: check.nonce, request: operation.input.request }, controller.current.signal);
      if (!mounted.current || !isQuestionnaireRecoveryReadCurrent(check)) return;
      const result = settleQuestionnaireRecoveryRead(check, proof);
      if (result === "confirmed" && proof.status === "committed") {
        onDirtyChange(false); setMessage("本次草稿已保存；正在讀回紀錄。");
        await onSaved(proof.receipt.assessmentKey);
      } else if (result === "not_found") setMessage("尚未查到這次保存；原內容已保留。請稍後再確認，或以相同內容重試。");
      else setMessage("保存結果尚未確認，請保留原內容後再試。");
    } catch (error) {
      if (!mounted.current || !isQuestionnaireRecoveryReadCurrent(check)) return;
      if (error instanceof QuestionnaireOperationClientError && (error.status === 401 || error.status === 403 || error.code === "INVALID_RESPONSE")) {
        quarantineQuestionnaireView(scope.authority); return;
      }
      setMessage("暫時無法確認保存結果；原內容已保留，請稍後再試。");
    } finally {
      cancelQuestionnaireRecoveryRead(check);
      if (mounted.current) setChecking(false);
    }
  }

  return <form
    data-questionnaire-write
    className={styles.formPanel}
    noValidate
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={(event) => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}
    aria-busy={pending}
    onChange={markDirty}
    onSubmit={async (event) => {
      event.preventDefault();
      if (!canManage || !scope || readOnly || pending || checking || committed || reading || viewTransitionPending || composing.current) return;
      if (!z.iso.date().safeParse(assessedOn).success || assessedOn < "2000-01-01" || assessedOn > taipeiToday()) {
        setDateError("請填寫有效評估日期（YYYY-MM-DD），且不得晚於今天。");
        setMessage("請修正評估日期後再保存；答案已保留。");
        dateField.current?.focus();
        return;
      }
      if (measurementIssue) { setMessage(measurementIssue); return; }
      const errors: Record<string, string> = {};
      for (const { id } of form.questions) {
        const answer = answers[id];
        if (answer?.state !== "not_applicable") continue;
        // Match the persisted trimmed, Unicode-character limit. The API still
        // owns normalization, so validation never mutates the replay body.
        const reason = answer.reason.trim();
        if (!reason) errors[id] = "請填寫不適用原因（1–500 字）。";
        else if (Array.from(reason).length > 500) errors[id] = "不適用原因去除頭尾空白後不得超過 500 字。";
        else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) errors[id] = "請移除不適用原因中的控制字元。";
      }
      setReasonErrors(errors);
      const firstInvalid = form.questions.find(({ id }) => errors[id]);
      if (firstInvalid) {
        setMessage("請修正不適用原因後再保存；其他答案已保留。");
        reasonFields.current[firstInvalid.id]?.focus();
        return;
      }
      setPending(true);
      onLockChange(true);
      setMessage("");
      try {
        await save();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "保存失敗，請保留內容後重試。");
      } finally {
        setPending(false);
      }
    }}
  >
    {retryPending ? <section className={styles.recovery} aria-label="保存結果待確認">
      <p role="status">保存結果待確認；請先核對原筆，勿重複新增。</p>
      <button className="button button--secondary" disabled={checking || pending || reading || viewTransitionPending} onClick={() => void checkResult()} type="button">{checking ? "確認中…" : "確認保存結果"}</button>
    </section> : null}
    <fieldset className={styles.editorFields} disabled={pending || retryPending || checking || committed || readOnly || reading || viewTransitionPending}>
    <div className={styles.formHeader}>
      <div>
        <h2>{form.title}</h2>
        <p>{form.instructions}</p>
      </div>
      <div className={styles.formStatus}>
        <span className={styles.draftBadge}>{readOnly ? latest ? `查看草稿 v${latest.version}` : "僅供檢視" : latest ? `修訂草稿 v${latest.version}` : "新增草稿"}</span>
        <span className={styles.formGate}>尚不可簽署</span>
      </div>
    </div>

    <div className={styles.meta}>
      <label>評估日期
        <input
          aria-label="評估日期"
          aria-describedby={`${form.key}-date-hint${dateError ? ` ${form.key}-date-error` : ""}`}
          aria-invalid={Boolean(dateError)}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          onChange={(event) => {
            setAssessedOn(event.currentTarget.value);
            setDateError("");
            setMessage("");
          }}
          ref={dateField}
          required
          type="text"
          value={assessedOn}
        />
        <small id={`${form.key}-date-hint`}>西元年－月－日，例如 2026-09-27。</small>
        {dateError ? <small id={`${form.key}-date-error`} role="alert">{dateError}</small> : null}
      </label>
      <div className={styles.assessorField}>
        <span>{readOnly ? "此版本記錄人員" : "本次記錄人員"}</span>
        <span className={styles.assessor}>{readOnly ? latest?.authorDisplayName : assessorName}</span>
        <small>{readOnly ? "顯示此草稿的原保存人員。" : "由目前登入人員保存；不代表已簽署。"}</small>
      </div>
    </div>

    <p className={styles.progress} aria-label="作答進度" aria-live="polite">已作答 {answeredCount}／{form.questions.length} 題 · 不適用 {notApplicableCount} 題 · 未填 {missingCount} 題</p>

    {suicideConcern ? <div className={styles.urgent} role="alert">
      安全提醒：此題有記錄到困擾。請依機構危機處理流程立即轉知護理／主管並陪同關懷；本系統不會自動通知或代替專業處置。
    </div> : null}

    {form.contextFields?.length ? <fieldset className={styles.measurements}>
      <legend>評估條件</legend>
      {form.contextFields.map(({ key, label, required, choices }) => <label key={key}>
        {label}{required ? "（計分必要）" : ""}
        <select
          onChange={(event) => { const value = event.currentTarget.value; setContext((current) => ({ ...current, [key]: value })); }}
          value={context[key] ?? ""}
        >
          <option value="">請選擇</option>
          {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </label>)}
    </fieldset> : null}

    {form.measurementFields?.length ? <fieldset className={styles.measurements}>
      <legend>身體測量（MNA-SF）</legend>
      {form.measurementFields.map(({ key, label }) => <label key={key}>
        {label}
        <input
          inputMode="decimal"
          max={key === "height_cm" ? 240 : key === "weight_kg" ? 300 : 80}
          min={key === "height_cm" ? 50 : key === "weight_kg" ? 20 : 10}
          onChange={(event) => { const value = event.currentTarget.value; setContext((current) => ({ ...current, [key]: value })); }}
          step="0.1"
          type="number"
          value={context[key] ?? ""}
        />
      </label>)}
      {bmi !== null ? <p>依輸入身高與體重計算 BMI：{bmi.toFixed(1)}。請確認 F 題選擇的區間相符；若無法取得 BMI，改輸入小腿圍並選擇小腿圍選項。</p> : <p>輸入可取得的身高與體重；若無法取得 BMI，請改填小腿圍並依 F 題指示作答。</p>}
    </fieldset> : null}

    <fieldset className={styles.questions} disabled={pending}>
      <legend className="sr-only">{form.title}題目</legend>
      {form.questions.map((question, index) => {
        const answer = answers[question.id] ?? { state: "missing" as const };
        const value = answer.state === "answered" ? answer.value : "";
        const reasonId = `${form.key}-${question.id}-reason`;
        const reasonHintId = `${reasonId}-hint`;
        const reasonErrorId = `${reasonId}-error`;
        const promptId = `${questionIdPrefix}-${question.id}-prompt`;
        const helpId = `${questionIdPrefix}-${question.id}-help`;
        return <section className={styles.questionCard} key={question.id}>
          <h3 className={styles.questionTitle} id={promptId}>{index + 1}. {question.prompt}</h3>
          {question.helpText ? <p className={styles.questionHelp} id={helpId}>{question.helpText}</p> : null}
          <div className={styles.questionActions}>
            <span>{answer.state === "answered" ? "已作答" : answer.state === "not_applicable" ? "不適用" : "未填"}</span>
            {answer.state !== "missing" ? <button
              aria-label={`清除第 ${index + 1} 題答案`}
              className="button button--quiet"
              onClick={() => {
                setAnswers((current) => ({ ...current, [question.id]: { state: "missing" } }));
                clearReasonError(question.id);
                markDirty();
              }}
              type="button"
            >清除答案</button> : null}
          </div>
          <div className={styles.choiceGrid} role="radiogroup" aria-labelledby={promptId}
            aria-describedby={question.helpText ? helpId : undefined}>
            {question.choices.map((choice) => <label className={styles.choice} key={choice.value}>
              <input
                checked={value === choice.value}
                name={question.id}
                onChange={() => setResponse(question.id, choice.value)}
                type="radio"
                value={choice.value}
              />
              <span>{choice.label}</span>
            </label>)}
            {allowsNotApplicable ? <label className={styles.choice}>
              <input
                checked={answer.state === "not_applicable"}
                name={question.id}
                onChange={() => {
                  setAnswers((current) => ({ ...current, [question.id]: { state: "not_applicable", reason: "" } }));
                  clearReasonError(question.id);
                }}
                type="radio"
                value="not_applicable"
              />
              <span>不適用（需原因）</span>
            </label> : null}
          </div>
          {answer.state === "not_applicable" ? <div className={styles.notes}>
            <label htmlFor={reasonId}>第 {index + 1} 題不適用原因</label>
            <textarea
              className="resize-none"
              aria-describedby={`${reasonHintId}${reasonErrors[question.id] ? ` ${reasonErrorId}` : ""}`}
              aria-invalid={Boolean(reasonErrors[question.id])}
              id={reasonId}
              onChange={(event) => {
                const reason = event.currentTarget.value;
                setAnswers((current) => ({ ...current, [question.id]: { state: "not_applicable", reason } }));
                clearReasonError(question.id);
              }}
              ref={(field) => { reasonFields.current[question.id] = field; }}
              required
              rows={3}
              value={answer.reason}
            />
            <small id={reasonHintId}>必填，去除頭尾空白後 1–500 字；不列入分數。</small>
            {reasonErrors[question.id] ? <p id={reasonErrorId} role="alert">{reasonErrors[question.id]}</p> : null}
          </div> : null}
        </section>;
      })}
    </fieldset>

    {form.allowQualitativeNotes ? <label className={styles.notes}>
      補充觀察與後續事項
      <textarea
        className="resize-none"
        maxLength={3000}
        onChange={(event) => { const value = event.currentTarget.value; setContext((current) => ({ ...current, qualitative_note: value })); }}
        placeholder="選填；記錄本次觀察或需由人員追蹤的事項"
        rows={4}
        value={context.qualitative_note ?? ""}
      />
      <small>選填，最多 3,000 字；內容不會加入量表分數。</small>
    </label> : null}

    {scorePreview ? <section className={styles.score} aria-live="polite" aria-label="量表計分預覽">
      <strong>{scorePreview.status === "complete" && scorePreview.score
        ? `計分預覽 ${scorePreview.score.adjusted ?? scorePreview.score.raw}／${scorePreview.score.max}`
        : "計分預覽：尚未完整作答"}</strong>
      {scorePreview.status === "complete" && scorePreview.classification
        ? <span>{scorePreview.classification.label}</span> : null}
      <small>篩檢分數需由人員判讀。</small>
      {measurementIssue ? <p role="alert">{measurementIssue}</p> : null}
      {scorePreview.rule?.reviewRequired || !scorePreview.rule?.activatedAt ? <p className={styles.formGate}>僅供草稿核對，正式計分尚未啟用</p> : null}
    </section> : null}
    <details className={styles.ruleNotice}>
      <summary>題目來源與計分說明</summary>
      <p className={styles.source}>
        題目來源：{form.sourceUrl
          ? <a href={form.sourceUrl} rel="noreferrer" target="_blank">{form.sourceLabel}</a>
          : form.sourceLabel}
      </p>
      {scorePreview && (scorePreview.rule?.reviewRequired || !scorePreview.rule?.activatedAt) ? <>
        <p>此版本的正式計分規則仍待業務覆核；保存答案不代表完成正式簽署。</p>
        <p>計分版本：{scorePreview.versionId}。篩檢分數不等於診斷、醫囑或自動處置。</p>
        <p>待業務完成規則覆核與正式計分啟用後，才能作為正式紀錄使用。</p>
      </> : null}
    </details>
    </fieldset>
    <div className={`${styles.actions}${!readOnly && canManage && scope ? ` ${styles.mobileSaveActions}` : ""}`}>
      {!readOnly ? <button className="button button--primary" disabled={!canManage || !scope || pending || checking || committed || reading || viewTransitionPending} type="submit">
        {pending ? "保存中…" : retryPending ? "以相同內容重試" : latest ? "保存修訂版本" : "保存本次評估"}
      </button> : <span>{latest ? "歷史版本僅供查看；修訂請選擇該次評估的最新草稿。" : "此量表僅供檢視，尚無已保存紀錄。"}</span>}
      {!canManage ? <span>目前帳號只有檢視權限</span> : null}
      {message ? <p aria-live="polite" className={styles.message} role="status">{message}</p> : null}
    </div>
    {latest ? <p className={styles.message}>
      最近保存：{latest.authorDisplayName}・{new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short",
      }).format(new Date(latest.createdAt))}・僅草稿
    </p> : null}
  </form>;
}

function QuestionnaireRecords({ assessorName, canManage, client, form, onNavigationBlockChange, context, sourceKey, sourceAt }: {
  assessorName: string; canManage: boolean; client: QuestionnaireClient; form: QuestionnaireFormDefinition;
  onNavigationBlockChange: (blocked: boolean) => void;
  context?: TenantContext; sourceKey: string; sourceAt: string;
}) {
  const view = useQuestionnaireViewState();
  const authority = context ? questionnaireViewAuthority(context) : null;
  const scope: QuestionnairePendingScope | null = useMemo(() => context && !context.demo ? { authority: authority!, epoch: view.epoch,
    organizationId: context.organizationId, branchId: context.branchId, actorUserId: context.userId, clientId: client.clientId, formKey: form.key } : null,
  [context, authority, view.epoch, client.clientId, form.key]);
  const journal = useQuestionnairePending(scope);
  // The parent already synchronously gates a newer same-owner SSR source.
  // Keep its admitted editor mounted while layout admits that exact source;
  // otherwise a legitimate refresh would discard unsent answers. This does
  // not admit a new owner or bypass the exact source check before writing.
  const sourceReady = !scope || isQuestionnairePendingSourceAdmitted(scope, sourceAt) || isQuestionnairePendingOwnerAdmitted(scope);
  const [assessments, setAssessments] = useState<readonly QuestionnaireAssessment[]>(client.assessments ?? []);
  const [total, setTotal] = useState(client.assessmentTotal ?? (client.latest ? 1 : 0));
  const [cursor, setCursor] = useState<QuestionnaireAssessmentCursor | null>(client.nextAssessmentCursor ?? null);
  const [baseline, setBaseline] = useState<QuestionnaireDraft | null>(client.latest);
  const [selectedKey, setSelectedKey] = useState(client.latest?.assessmentKey ?? "");
  const [readOnly, setReadOnly] = useState(!canManage);
  const [versions, setVersions] = useState<readonly QuestionnaireDraft[]>([]);
  const [versionTotal, setVersionTotal] = useState(0);
  const [beforeVersion, setBeforeVersion] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reloadKey, setReloadKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [locked, setLocked] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const requestSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryRead = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  const ownerEpoch = getQuestionnaireViewState().epoch;
  const originalSourceKey = useRef(sourceKey);
  const recordHeading = useRef<HTMLHeadingElement>(null);
  const ownerCurrent = () => mounted.current && (!authority ||
    getQuestionnaireViewState().signature === authority && getQuestionnaireViewState().epoch === ownerEpoch);
  useLayoutEffect(() => { if (scope) observeQuestionnairePendingSource(scope, sourceAt); }, [scope, sourceAt]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    onNavigationBlockChange(dirty || locked || journal.navigationBlocked || journal.confirmed.length > 0);
  }, [dirty, locked, journal, onNavigationBlockChange]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const exit = useUnsavedChanges({ dirty: dirty || Boolean(journal.operation), scopeKey: `${authority}-${ownerEpoch}`,
    revisionKey: sourceKey, canPrompt: !locked && !reading && !journal.operation,
    permittedFormAttribute: "data-questionnaire-write", onDiscard: () => {
      setDirty(false); setEditorEpoch((current) => current + 1);
    } });

  // A newer verified SSR snapshot is ordinary background refresh when there
  // is no local work to preserve. Rebase the clean editor before paint; never
  // replace unsent answers, a write attempt, or an exact-history readback.
  useLayoutEffect(() => {
    if (originalSourceKey.current === sourceKey || dirty || locked || reading || exit.open ||
        journal.operation || journal.confirmed.length > 0 || journal.navigationBlocked ||
        (scope && !isQuestionnairePendingSourceAdmitted(scope, sourceAt))) return;
    controller.current?.abort(); requestSequence.current += 1;
    setAssessments(client.assessments ?? []);
    setTotal(client.assessmentTotal ?? (client.latest ? 1 : 0));
    setCursor(client.nextAssessmentCursor ?? null);
    setBaseline(client.latest);
    setSelectedKey(client.latest?.assessmentKey ?? "");
    setReadOnly(!canManage);
    setVersions([]); setVersionTotal(0); setBeforeVersion(null);
    setReadError(""); setFeedback(""); setReloadKey(null);
    setEditorEpoch((current) => current + 1);
    originalSourceKey.current = sourceKey;
  }, [sourceKey, sourceAt, scope, client, canManage, dirty, locked, reading, exit.open, journal]);

  function requestSwitch(operation: () => void) {
    if (!ownerCurrent() || locked || reading || journal.operation || journal.confirmed.length) return;
    exit.requestExit(() => {
      if (!ownerCurrent()) return;
      setEditorEpoch((current) => current + 1); operation();
    });
  }
  function startNew() {
    controller.current?.abort(); requestSequence.current++;
    setBaseline(null); setSelectedKey(""); setReadOnly(!canManage);
    setVersions([]); setDirty(false); setFeedback(""); setReadError("");
  }
  async function read(mode: "assessments" | "versions", key?: string, older = false) {
    if (!ownerCurrent()) return;
    retryRead.current = () => { void read(mode, key, older); };
    controller.current?.abort(); controller.current = new AbortController();
    const sequence = ++requestSequence.current;
    const query = new URLSearchParams({ form_key: form.key, client_id: client.clientId, mode });
    if (mode === "versions") {
      query.set("assessment_key", key!);
      if (older && beforeVersion) query.set("before_version", String(beforeVersion));
    } else if (older && cursor) {
      query.set("before_created_at", cursor.createdAt); query.set("before_assessment_key", cursor.assessmentKey);
    }
    setReading(true); setReadError("");
    try {
      const { payload } = await fetchJsonWithTimeout(`/api/questionnaire-assessments?${query}`, { signal: controller.current.signal });
      if (sequence !== requestSequence.current || !ownerCurrent()) return;
      const data = historyEnvelopeSchema.parse(payload).data;
      if (mode === "versions") {
        const page = parseQuestionnaireHistoryPage(data, form.key, client.clientId, key!);
        if (older && page.versions.some((version) => version.version >= beforeVersion!)) throw new Error("版本順序未確認，請重新載入歷程。");
        setVersions((current) => older ? [...current, ...page.versions.filter((item) => !current.some((entry) => entry.versionId === item.versionId))] : page.versions);
        setVersionTotal(page.total); setBeforeVersion(page.nextBeforeVersion);
        if (!older) {
          const latest = page.versions[0];
          if (!latest) throw new Error("找不到這次評估的版本，請重新載入。");
          setSelectedKey(key!); setBaseline(latest); setReadOnly(true); setDirty(false);
          setAssessments((current) => current.map((item) => item.assessmentKey === key ? { ...latest, assessmentCreatedAt: item.assessmentCreatedAt } : item));
        }
      } else {
        const page = parseQuestionnaireAssessmentPage(data, form.key, client.clientId);
        setAssessments((current) => older ? [...current, ...page.assessments.filter((item) => !current.some((entry) => entry.assessmentKey === item.assessmentKey))] : page.assessments);
        setTotal(page.total); setCursor(page.nextCursor);
      }
    } catch (error) {
      if (sequence === requestSequence.current && ownerCurrent()) {
        if (authority && (!(error instanceof ClientJsonReadError) || error.status === 401 || error.status === 403 || error.code === "INVALID_RESPONSE")) quarantineQuestionnaireView(authority);
        else setReadError("歷程暫時無法載入，請重試。");
      }
    } finally { if (sequence === requestSequence.current && ownerCurrent()) setReading(false); }
  }
  async function saved(key: string) {
    if (!ownerCurrent()) return;
    controller.current?.abort(); controller.current = new AbortController();
    const sequence = ++requestSequence.current;
    setReloadKey(key);
    const originalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReading(true);
    setFeedback("本次草稿已保存。正在讀回最新紀錄。");
    try {
      const query = new URLSearchParams({ form_key: form.key, client_id: client.clientId, mode: "versions", assessment_key: key });
      const { payload } = await fetchJsonWithTimeout(`/api/questionnaire-assessments?${query}`, { signal: controller.current.signal });
      if (sequence !== requestSequence.current || !ownerCurrent()) return;
      const page = parseQuestionnaireHistoryPage(historyEnvelopeSchema.parse(payload).data, form.key, client.clientId, key);
      const expected = scope ? getQuestionnairePending(scope).confirmed.find(item => item.receipt.assessmentKey === key) : null;
      let reconciled = !scope || reconcileQuestionnairePendingExactHistory(scope, page.versions, sourceAt);
      // Superseded does not mean absent. Fetch the exact original version's
      // bounded history window without substituting a newer latest receipt.
      if (!reconciled && expected && expected.receipt.version < 1_000_000) {
        const originalQuery = new URLSearchParams(query);
        originalQuery.set("before_version", String(expected.receipt.version + 1));
        const exact = await fetchJsonWithTimeout(`/api/questionnaire-assessments?${originalQuery}`, { signal: controller.current.signal });
        if (sequence !== requestSequence.current || !ownerCurrent()) return;
        const originalPage = parseQuestionnaireHistoryPage(historyEnvelopeSchema.parse(exact.payload).data, form.key, client.clientId, key);
        reconciled = reconcileQuestionnairePendingExactHistory(scope!, originalPage.versions, sourceAt);
      }
      if (!reconciled) {
        setFeedback("本次草稿已保存，但這份歷程尚未包含原保存版本；請繼續回查，勿重複新增。");
        return;
      }
      const latest = page.versions[0];
      if (!latest) throw new Error("保存已確認，最新版本暫時無法讀回。");
      setBaseline(latest); setSelectedKey(key); setReadOnly(!canManage); setVersions(page.versions);
      originalSourceKey.current = sourceKey;
      setVersionTotal(page.total); setBeforeVersion(page.nextBeforeVersion); setReloadKey(null); setLocked(false); setDirty(false);
      setFeedback("草稿已保存並讀回；尚未簽署。");
      await read("assessments");
      if (ownerCurrent() && originalFocus && (document.activeElement === originalFocus ||
        document.activeElement === document.body && !originalFocus.isConnected)) recordHeading.current?.focus();
    } catch (error) {
      if (sequence !== requestSequence.current || !ownerCurrent()) return;
      if (authority && (!(error instanceof ClientJsonReadError) || error.status === 401 || error.status === 403 || error.code === "INVALID_RESPONSE")) { quarantineQuestionnaireView(authority); return; }
      setFeedback("草稿已保存，最新紀錄暫時無法讀回。請重新讀取，避免重複新增。");
      throw error;
    } finally { if (sequence === requestSequence.current && ownerCurrent()) setReading(false); }
  }
  const currentLatest = assessments.find((item) => item.assessmentKey === selectedKey) ??
    (versions[0]?.assessmentKey === selectedKey ? versions[0] : client.latest?.assessmentKey === selectedKey ? client.latest : null);
  const disabled = locked || reading || Boolean(journal.operation) || journal.confirmed.length > 0;
  const confirmedKey = journal.confirmed[0]?.receipt.assessmentKey ?? null;
  const retainedSource = originalSourceKey.current !== sourceKey &&
    (dirty || locked || exit.open || Boolean(journal.operation) || journal.confirmed.length > 0 || journal.navigationBlocked);
  return <>
    {exit.notice || reading || readError || feedback || reloadKey || confirmedKey || retainedSource ? <section className={styles.recovery} aria-label="評估紀錄狀態">
      {retainedSource ? <p role="status">資料已有更新；本次填寫與原筆待確認操作已保留。請先完成保存或回查，再查看版本歷程。</p> : null}
      {exit.notice ? <p role="status">{exit.notice}</p> : null}
      {reading ? <p role="status">正在讀取評估紀錄…</p> : null}
      {readError ? <p role="alert">{readError} <button className="button button--quiet" disabled={disabled} onClick={() => retryRead.current?.()} type="button">重新讀取歷程</button></p> : null}
      {feedback ? <p role="status">{feedback}</p> : null}
      {reloadKey || confirmedKey ? <button className="button button--secondary" disabled={reading} onClick={() => { void saved(reloadKey ?? confirmedKey!).catch(() => {}); }} type="button">重新讀取已保存紀錄</button> : null}
    </section> : null}
    {sourceReady ? <QuestionnaireEditor
      assessorName={assessorName} baseline={baseline} canManage={canManage} client={client} form={form}
      key={`${baseline?.versionId ?? "new"}-${readOnly ? "view" : "edit"}-${editorEpoch}`}
      onDirtyChange={setDirty} onLockChange={setLocked} onSaved={saved} readOnly={readOnly} reading={reading}
      scope={scope} sourceAt={sourceAt}
    /> : <p role="status">正在確認個案查閱範圍；原筆保存內容不會自動重送。</p>}
    {context && !context.demo ? <QuestionnaireReadinessPanel context={context} form={form} clientId={client.clientId}
      draft={baseline} sourceKey={sourceKey} blockedReason={locked || journal.operation || journal.confirmed.length ? "保存結果仍待確認，請先完成原筆回查。" :
        reading ? "請等待評估紀錄讀取完成。" : dirty || exit.open ? "內容已修改；請先保存，再檢查新版本。" : ""} /> : null}
    <section className={styles.records} aria-label="已保存的評估">
      <div className={styles.recordsHeading}><h2 ref={recordHeading} tabIndex={-1} data-governance-focus-anchor>評估紀錄</h2>
        {canManage ? <button className="button button--secondary" disabled={disabled} onClick={() => requestSwitch(startNew)} type="button">新增一次評估</button> : null}
      </div>
      <p>已保存 {total} 次評估；每次評估與修訂版本分開保留。</p>
      {total ? <>
        <label className={styles.recordPicker}>選擇已保存評估
          {/* Popup geometry is platform-owned, consistent with ClientSelectionCard. */}
          <select disabled={disabled} value={selectedKey} onChange={(event) => {
            const key = event.currentTarget.value;
            requestSwitch(() => { void read("versions", key); });
          }}>
            <option disabled value="">正在新增一次評估</option>
            {selectedKey && !assessments.some((item) => item.assessmentKey === selectedKey) && baseline ?
              <option value={selectedKey}>{baseline.assessedOn} · 草稿 v{currentLatest?.version ?? baseline.version}</option> : null}
            {assessments.map((item) => <option key={item.assessmentKey} value={item.assessmentKey}>
              {item.assessedOn} · 草稿 v{item.version} · {item.authorDisplayName}
            </option>)}
          </select>
        </label>
        <div className={styles.actions}>
          {selectedKey ? <button className="button button--secondary" disabled={disabled} onClick={() => requestSwitch(() => { void read("versions", selectedKey); })} type="button">查看版本歷程</button> : null}
          {currentLatest && canManage ? <button className="button button--secondary" disabled={disabled} onClick={() => requestSwitch(() => {
            setBaseline(currentLatest); setReadOnly(false); setDirty(false); setFeedback("");
          })} type="button">修訂此草稿</button> : null}
          {cursor ? <button className="button button--secondary" disabled={disabled} onClick={() => void read("assessments", undefined, true)} type="button">載入較早評估</button> : null}
        </div>
      </> : <p>{canManage ? "尚無評估紀錄，請填寫量表保存本次評估。" : "尚無已保存評估；目前帳號僅能檢視量表。"}</p>}
      <GovernanceDialog open={exit.open} title="放棄尚未保存的修改？" cancelLabel="繼續填寫"
        busy={locked || reading || Boolean(journal.operation)} onRequestClose={exit.cancel} returnFocusRef={exit.returnFocusRef} fallbackFocusRef={recordHeading}>
        <p>切換後，本次尚未保存的修改不會保留。</p>
        <button className="button button--danger" disabled={locked || reading || Boolean(journal.operation)} onClick={exit.confirmDiscard}
          onCompositionStart={exit.compositionStart} onCompositionEnd={exit.compositionEnd} type="button">放棄修改並切換</button>
      </GovernanceDialog>
      {versions.length ? <details className={styles.versionHistory} open>
        <summary>版本歷程（顯示 {versions.length}／共 {versionTotal} 版）</summary>
        <ol>{versions.map((version) => <li key={version.versionId}>
          <span>v{version.version} · {version.assessedOn} · {version.authorDisplayName} · {new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(version.createdAt))}</span>
          <button className="button button--quiet" disabled={disabled} type="button" onClick={() => requestSwitch(() => {
            setBaseline(version); setReadOnly(true); setDirty(false);
          })}>查看 v{version.version}</button>
        </li>)}</ol>
        {beforeVersion ? <button className="button button--secondary" disabled={disabled} type="button" onClick={() => void read("versions", selectedKey, true)}>載入較早版本</button> : null}
      </details> : null}
    </section>
  </>;
}

export function QuestionnaireAssessmentsWorkspace({
  assessorName,
  canManage,
  form,
  loadError,
  pageTitle,
  selectedClientId,
  snapshot,
  context,
}: {
  assessorName: string;
  canManage: boolean;
  form: QuestionnaireFormDefinition;
  loadError: boolean;
  pageTitle: string;
  selectedClientId: string | null;
  snapshot: QuestionnaireSnapshot | null;
  context?: TenantContext;
}) {
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const view = useQuestionnaireViewState();
  const authority = context ? questionnaireViewAuthority(context) : null;
  const revision = useRef(0);
  const [admission, setAdmission] = useState<{ source: QuestionnaireSnapshot; authority: string; epoch: number; revision: number; selectedClientId: string | null } | null>(null);
  // A requested client is not the active editor owner while an unsaved draft
  // or uncertain write remains. Never carry that owner's answers into B.
  const activeClientId = navigationBlocked && admission?.source.formKey === form.key && admission.selectedClientId
    ? admission.selectedClientId : selectedClientId;
  useLayoutEffect(() => {
    if (!context || !authority) return;
    const current = getQuestionnaireViewState();
    if (snapshot && admission?.authority === authority && admission.epoch === current.epoch &&
      admission.source.formKey === snapshot.formKey && admission.selectedClientId === activeClientId &&
      admission.source.generatedAt === snapshot.generatedAt && JSON.stringify(admission.source) !== JSON.stringify(snapshot)) {
      quarantineQuestionnaireView(authority); return;
    }
    if (snapshot && admission?.authority === authority && admission.epoch === current.epoch &&
      admission.selectedClientId === activeClientId && JSON.stringify(admission.source) === JSON.stringify(snapshot)) return;
    if (!loadError && snapshot?.formKey === form.key && (context.demo || canReadQuestionnaireView(context, form.key)) &&
      admitQuestionnaireViewSource(authority, snapshot.generatedAt)) {
      setAdmission({ source: snapshot, authority, epoch: current.epoch, revision: ++revision.current, selectedClientId: activeClientId });
    } else setAdmission(null);
    // Context values are represented by the complete canonical signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authority, snapshot, loadError, form.key, activeClientId, view.epoch]);
  // A legitimate same-actor SSR update must not unmount the draft/unknown-write
  // owner while the layout effect admits its new source. Privacy failures and
  // stale/withdrawn sources still remove clinical content immediately.
  const sameOwner = !!admission && admission.authority === authority && admission.epoch === view.epoch &&
    view.signature === authority && admission.source.formKey === form.key && admission.selectedClientId === activeClientId;
  const sameSource = !!snapshot && !!admission && JSON.stringify(admission.source) === JSON.stringify(snapshot);
  const admissibleUpdate = !!context && !!authority && !loadError && snapshot?.formKey === form.key &&
    (context.demo || canReadQuestionnaireView(context, form.key)) &&
    canAdmitQuestionnaireViewSource(authority, snapshot.generatedAt) &&
    (snapshot.generatedAt !== admission?.source.generatedAt || sameSource);
  const admitted = !context || sameOwner && !loadError && !!snapshot &&
    snapshot.formKey === form.key && (sameSource || admissibleUpdate) &&
    (!activeClientId || snapshot.clients.some(client => client.clientId === activeClientId));
  if (context && !admitted) return <section className="empty-card core-care-state" role="alert">
    <h1>評估資料需要重新確認</h1>
    <p>登入或個案查閱範圍已變更，舊內容已隱藏。請使用上方「登出」，重新登入後回查原個案紀錄，再繼續作業。</p>
    <p>登出或完整重新載入會清除本分頁的待確認內容；請先由主管協助核對已保存紀錄，不要重複新增。</p>
  </section>;
  if (loadError || !snapshot) return <section className="empty-card core-care-state" role="alert">
    <h1>{pageTitle}暫時無法載入</h1>
    <p>正式個案清單未能確認；沒有切換到展示資料或擴大查閱範圍。</p>
    <a className="button button--secondary" href="?">重新載入</a>
  </section>;

  const chosenClient = activeClientId
    ? snapshot.clients.find((client) => client.clientId === activeClientId) ?? null
    : null;
  const formRef = form.key === "mna_sf"
    ? "/app/staff/professional-care/mna"
    : `/app/staff/assessments/${{
    spmsq: "spmsq",
    gds_15: "gds",
    barthel_adl: "barthel-adl",
    lawton_iadl: "iadl",
    eat10_swallowing: "swallowing",
    bsrs5: "bsrs",
    fall_risk_taipei_115: "fall-risk",
    nsi_determine: "nsi",
  }[form.key]}`;
  return <section className={styles.workspace} aria-label={pageTitle}>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">評估量表・頁面 {{
          spmsq: 11,
          gds_15: 12,
          fall_risk_taipei_115: 13,
          nsi_determine: 14,
          barthel_adl: 15,
          lawton_iadl: 16,
          eat10_swallowing: 17,
          bsrs5: 18,
          mna_sf: 36,
        }[form.key]}</p>
        <h1>{pageTitle}</h1>
        <p className="page-heading__description">選個案後直接填表；未簽署的答案以版本草稿保存。</p>
      </div>
      {chosenClient && context && (context.demo || context.scopes.includes("clients.read")) ? (
        <div className="page-heading__actions">
          <NavigationLink className="button button--secondary" href={assessmentEntryHref(chosenClient.clientId)}
            loadingLabel="評估量表" prefetch={false}>返回這位個案的評估清單</NavigationLink>
        </div>
      ) : null}
    </header>

    {snapshot.demo ? <div className="callout" role="status">
      展示用合成個案；不能寫入真實評估資料。
    </div> : null}

    <form action={formRef} className="client-selection-form" method="get" noValidate key={activeClientId ?? "no-client"} onSubmit={(event) => {
      if (navigationBlocked) event.preventDefault();
    }}>
      <ClientSelectionCard
        id="questionnaire-client"
        label="個案"
        defaultValue={activeClientId ?? ""}
        disabled={navigationBlocked}
        placeholderDisabled
        actionLabel="選取個案"
        options={snapshot.clients.map((client) => ({
          value: client.clientId,
          label: `${client.displayName}${client.serviceStatus === "suspended" ? "・暫停服務" : ""}`,
        }))}
      />
    </form>

    {navigationBlocked ? <p className={styles.message}>請先保存或取消本次修改，再切換個案。</p> : null}
    {activeClientId !== selectedClientId ? <p role="status">仍在處理原個案；請先保存或回查原筆，再切換個案。</p> : null}
    {chosenClient ? <QuestionnaireRecords
      assessorName={assessorName}
      canManage={canManage}
      client={chosenClient}
      form={form}
      context={context}
      sourceKey={`${authority ?? "legacy"}-${view.epoch}-${admission?.revision ?? 0}`}
      sourceAt={snapshot.generatedAt}
      key={`${form.key}-${chosenClient.clientId}-${authority ?? "legacy"}-${view.epoch}`}
      onNavigationBlockChange={setNavigationBlocked}
    /> : <div className={styles.empty}>
      {snapshot.clients.length ? "請先選一位個案，量表會直接在此展開。" : "目前沒有可指派給此帳號的有效個案。請確認個案指派與分支權限。"}
    </div>}
  </section>;
}
