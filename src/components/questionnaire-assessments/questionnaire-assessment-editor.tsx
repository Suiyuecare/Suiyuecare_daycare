"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { NavigationLink } from "@/components/app/navigation-link";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import { scoreAssessment } from "@/lib/assessments/engine";
import type { AssessmentAnswers, AssessmentRuleSnapshot } from "@/lib/assessments/types";
import type {
  QuestionnaireAnswers,
  QuestionnaireAnswer,
  QuestionnaireClient,
  QuestionnaireFormDefinition,
  QuestionnaireSnapshot,
} from "@/lib/questionnaire-assessments/types";
import { validateMnaAnthropometry, type MnaAnthropometryIssue } from "@/lib/questionnaire-assessments/mna-anthropometry";
import { fullMnaProteinChoice } from "@/lib/assessments/full-mna";
import { fullMnaIssueText, fullMnaScoringContext, validateFullMnaInput, type FullMnaInputIssue } from "@/lib/questionnaire-assessments/full-mna-validation";
import { mnaVariantHref, questionnaireHistoryHref } from "@/lib/questionnaire-assessments/query";
import { readQuestionnaireMutationReceipt } from "@/lib/questionnaire-assessments/receipt";
import { QuestionnaireLifecycleActions } from "./questionnaire-lifecycle-actions";

import styles from "./questionnaire-assessments.module.css";

const historyGuardKey = "__daycareAssessmentUnsavedGuard";

export function canPreviewApprovedScore(
  rule: Pick<AssessmentRuleSnapshot, "activatedAt" | "reviewRequired"> | null | undefined,
  now = Date.now(),
) {
  const activatedAt = rule?.activatedAt ? Date.parse(rule.activatedAt) : NaN;
  return Boolean(rule && !rule.reviewRequired && Number.isFinite(activatedAt) && activatedAt <= now);
}

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

function errorText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "保存失敗，請保留內容後重試。";
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return "保存失敗，請保留內容後重試。";
  const first = errors[0] as { message?: unknown } | undefined;
  return typeof first?.message === "string" ? first.message : "保存失敗，請保留內容後重試。";
}

function mnaIssueText(issue: MnaAnthropometryIssue) {
  if (issue.kind === "invalid_measurement") return "量測值格式或範圍不符，請核對實測值後再保存。";
  if (issue.kind === "missing_measurement") return issue.field === "calf_circumference_cm"
    ? "選擇小腿圍區間前，請先填寫小腿圍。"
    : "選擇 BMI 區間前，請先填寫身高與體重。";
  if (issue.kind === "conflicting_measurement") return "BMI 與小腿圍只能擇一；請清除這次未使用的量測值。";
  return "量測值與所選區間不符；請核對實測值及第 6 題選項。";
}

function QuestionnaireEditor({
  assessorName,
  canManage: permittedToManage,
  canSign,
  client,
  form,
  selectedMonth,
  onDirtyChange,
  onWriteGuardChange,
}: {
  assessorName: string;
  canManage: boolean;
  canSign: boolean;
  client: QuestionnaireClient;
  form: QuestionnaireFormDefinition;
  selectedMonth: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onWriteGuardChange: (busy: boolean, unknown: boolean) => void;
}) {
  const router = useRouter();
  const latest = client.latest;
  const canManage = permittedToManage && (!latest || ((latest.recordState ?? "draft") === "draft" && latest.isLatest !== false));
  const [answers, setAnswers] = useState(() => initialAnswers(form, latest));
  const [context, setContext] = useState(() => initialContext(form, latest));
  const initialDate = latest?.assessedOn ?? (selectedMonth && selectedMonth !== taipeiToday().slice(0, 7) ? `${selectedMonth}-01` : taipeiToday());
  const [assessedOn, setAssessedOn] = useState(initialDate);
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify({
    answers: initialAnswers(form, latest),
    context: initialContext(form, latest),
    assessedOn: initialDate,
  }));
  const [pending, setPending] = useState(false);
  const [saveUnknown, setSaveUnknown] = useState(false);
  const [fullMnaIssue, setFullMnaIssue] = useState<FullMnaInputIssue | null>(null);
  const [message, setMessage] = useState("");
  const [lifecycleDirty, setLifecycleDirty] = useState(false);
  const [lifecycleGuard, setLifecycleGuard] = useState({ busy: false, unknown: false });
  const lifecycleWriteGuardChanged = useCallback((busy: boolean, unknown: boolean) => setLifecycleGuard(current =>
    current.busy === busy && current.unknown === unknown ? current : { busy, unknown }), []);
  const editorLocked = pending || saveUnknown || lifecycleGuard.busy || lifecycleGuard.unknown;
  const [dateError, setDateError] = useState("");
  const [reasonErrorQuestionId, setReasonErrorQuestionId] = useState<string | null>(null);
  const [mnaIssue, setMnaIssue] = useState<MnaAnthropometryIssue | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const operationKey = useRef<string | null>(null);
  const operationBody = useRef<string | null>(null);
  const suicideAlert = useRef<HTMLDivElement>(null);
  const currentDraft = JSON.stringify({ answers, context, assessedOn });
  const dirty = currentDraft !== savedDraft;
  const registerScopeChange = useScopeChangeDraftRegistration();
  useLayoutEffect(() => { registerScopeChange({ dirty: dirty || lifecycleDirty, busy: pending || lifecycleGuard.busy, unknown: saveUnknown || lifecycleGuard.unknown }); }, [dirty, lifecycleDirty, pending, saveUnknown, lifecycleGuard, registerScopeChange]);
  useEffect(() => { onDirtyChange(dirty || lifecycleDirty); }, [dirty, lifecycleDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useLayoutEffect(() => { onWriteGuardChange(pending || lifecycleGuard.busy, saveUnknown || lifecycleGuard.unknown); }, [pending, saveUnknown, lifecycleGuard, onWriteGuardChange]);
  useEffect(() => () => onWriteGuardChange(false, false), [onWriteGuardChange]);
  const answeredCount = Object.values(answers).filter((answer) => answer.state === "answered").length;
  const notApplicableCount = Object.values(answers).filter((answer) => answer.state === "not_applicable").length;
  const pendingReasonQuestions = form.questions.filter((question) => {
    const answer = answers[question.id];
    return answer?.state === "not_applicable" && !answer.reason.trim();
  });
  const pendingReasonCount = pendingReasonQuestions.length;
  const missingCount = form.questions.length - answeredCount - notApplicableCount;
  const firstUnfinishedIndex = form.questions.findIndex((question) => {
    const answer = answers[question.id];
    return !answer || answer.state === "missing" ||
      (answer.state === "not_applicable" && !answer.reason.trim());
  });
  const firstUnfinishedQuestion = form.questions[firstUnfinishedIndex];
  const firstUnfinishedAnswer = firstUnfinishedQuestion ? answers[firstUnfinishedQuestion.id] : null;
  const requiredContextFields = form.contextFields?.filter((field) => field.required) ?? [];
  const pendingContextFields = requiredContextFields.filter((field) => !context[field.key]?.trim());
  const pendingContextLabel = pendingContextFields.map((field) => field.label).join("、");
  const progressTotal = form.questions.length + requiredContextFields.length;
  const progressValue = answeredCount + notApplicableCount - pendingReasonCount +
    requiredContextFields.length - pendingContextFields.length;
  const allowsNotApplicable = form.key === "barthel_adl" || form.key === "lawton_iadl";
  const suicideAnswer = form.key === "bsrs5" ? answers.bsrs_suicide : null;
  const suicideConcern = suicideAnswer?.state === "answered" && Number(suicideAnswer.value) > 0;
  const previousSuicideConcern = useRef(Boolean(suicideConcern));
  useEffect(() => {
    if (suicideConcern && !previousSuicideConcern.current) suicideAlert.current?.scrollIntoView?.({ block: "nearest" });
    previousSuicideConcern.current = Boolean(suicideConcern);
  }, [suicideConcern]);
  const scoringContext: Record<string, string> = form.key === "spmsq" && context.education_adjustment
    ? { education_adjustment: context.education_adjustment }
    : form.key === "full_mna" ? fullMnaScoringContext(context)
    : {};
  const scorePreview = form.scoreVersionId ? scoreAssessment({
    versionId: form.scoreVersionId,
    answers: answers as AssessmentAnswers,
    context: scoringContext,
  }) : null;
  const approvedScorePreview = canPreviewApprovedScore(scorePreview?.rule) ? scorePreview : null;
  const height = Number(context.height_cm);
  const weight = Number(context.weight_kg);
  const bmi = height > 0 && weight > 0 ? weight / ((height / 100) ** 2) : null;

  function setAnswer(questionId: string, answer: QuestionnaireAnswer) {
    if (editorLocked) return;
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    if (form.key === "full_mna" && questionId === "protein_intake" && answer.state === "missing") {
      setContext((current) => ({ ...current, ...Object.fromEntries((form.contextFields ?? [])
        .filter((field) => field.questionId === questionId).map((field) => [field.key, ""])) }));
    }
    if (reasonErrorQuestionId === questionId) setReasonErrorQuestionId(null);
    if (questionId === "anthropometry") setMnaIssue(null);
    setFullMnaIssue(null);
    setMessage("");
  }

  function focusQuestion(questionId: string) {
    const question = document.getElementById(`${form.key}-${questionId}`);
    question?.focus();
    question?.scrollIntoView?.({ block: "start" });
  }

  function focusReason(questionId: string) {
    const reason = document.getElementById(`na-reason-${form.key}-${questionId}`);
    reason?.focus();
    reason?.scrollIntoView?.({ block: "center" });
  }

  function focusContextField(fieldKey: string) {
    const field = document.getElementById(`context-${form.key}-${fieldKey}`);
    field?.focus();
    field?.scrollIntoView?.({ block: "center" });
  }

  function focusNextUnfinished() {
    if (firstUnfinishedQuestion) {
      if (firstUnfinishedAnswer?.state === "not_applicable") focusReason(firstUnfinishedQuestion.id);
      else focusQuestion(firstUnfinishedQuestion.id);
    } else if (pendingContextFields.length) {
      focusContextField(pendingContextFields[0].key);
    }
  }

  const nextUnfinishedLabel = firstUnfinishedQuestion
    ? `第 ${firstUnfinishedIndex + 1} 題${firstUnfinishedAnswer?.state === "not_applicable" ? "不適用原因" : ""}`
    : pendingContextFields.length ? pendingContextFields[0].label : null;

  async function save() {
    const idempotencyKey = operationKey.current ?? crypto.randomUUID();
    operationKey.current = idempotencyKey;
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
    const requestBody = operationBody.current ?? JSON.stringify(body);
    operationBody.current = requestBody;
    const response = await fetchWithTimeout(
      `/api/questionnaire-assessments?form_key=${form.key}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: requestBody,
      },
    );
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error("回應內容無法確認，請保留表單並稍後重試。"); }
    if (!response.ok) {
      const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      const errors = envelope?.errors;
      const first = Array.isArray(errors) ? errors[0] : null;
      const definiteRejection = response.status >= 400 && response.status < 500 &&
        ![408, 409, 425, 429].includes(response.status) && envelope?.status === "error" &&
        envelope.data === null && typeof envelope.requestId === "string" && envelope.requestId.length > 0 &&
        first && typeof first === "object" && typeof first.code === "string" && typeof first.message === "string";
      // A later rejection does not settle an earlier ambiguous write.
      if (definiteRejection && !saveUnknown) { operationKey.current = null; operationBody.current = null; }
      throw new Error(errorText(payload));
    }
    const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    const data = readQuestionnaireMutationReceipt(envelope?.data, { action, clientId: client.clientId, formKey: form.key,
      assessedOn, ...(latest ? { assessmentKey: latest.assessmentKey, expectedVersion: latest.version, previousVersionId: latest.versionId } : {}) });
    if (envelope?.status !== "ok" || !data) throw new Error("無法確認草稿保存狀態，請保留內容並重試同一次保存。");
    operationKey.current = null;
    operationBody.current = null;
    setSaveUnknown(false);
    const url = new URL(window.location.href);
    url.searchParams.set("version", data.versionId); url.searchParams.delete("new");
    if (url.searchParams.get("month") && url.searchParams.get("month") !== assessedOn.slice(0, 7)) url.searchParams.delete("month");
    router.replace(`${url.pathname}${url.search}`);
  }

  return <form
    className={styles.formPanel}
    noValidate
    onSubmit={async (event) => {
      event.preventDefault();
      if (!canManage || pending || lifecycleGuard.busy || lifecycleGuard.unknown || lifecycleDirty) return;
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(assessedOn) ||
        assessedOn < "2000-01-01" || assessedOn > taipeiToday()) {
        setDateError("請選擇 2000 年以後、且不晚於今天的評估日期。");
        dateInput.current?.focus();
        return;
      }
      const invalidReason = form.questions.find((question) => {
        const answer = answers[question.id];
        return answer?.state === "not_applicable" && !answer.reason.trim();
      });
      if (invalidReason) {
        const questionNumber = form.questions.indexOf(invalidReason) + 1;
        setReasonErrorQuestionId(invalidReason.id);
        setMessage(`請填寫第 ${questionNumber} 題的不適用原因。`);
        focusReason(invalidReason.id);
        return;
      }
      const mnaValidation = form.key === "mna_sf"
        ? validateMnaAnthropometry(
          Object.fromEntries(Object.entries(context).filter(([, value]) => value !== "")),
          answers.anthropometry,
        )
        : null;
      if (mnaValidation) {
        setMnaIssue(mnaValidation);
        setMessage("");
        if (mnaValidation.field === "anthropometry") focusQuestion("anthropometry");
        else focusContextField(mnaValidation.field);
        return;
      }
      setMnaIssue(null);
      const fullMnaValidation = form.key === "full_mna" ? validateFullMnaInput(context, answers) : null;
      if (fullMnaValidation) {
        setFullMnaIssue(fullMnaValidation); setMessage("");
        if (["interval_mismatch", "protein_mismatch"].includes(fullMnaValidation.kind)) focusQuestion(fullMnaValidation.questionId);
        else focusContextField(fullMnaValidation.field);
        return;
      }
      setFullMnaIssue(null);
      setPending(true);
      registerScopeChange({ dirty, busy: true, unknown: saveUnknown });
      onWriteGuardChange(true, saveUnknown);
      setMessage("");
      try {
        await save();
        setSavedDraft(currentDraft);
        setMessage("草稿已保存。");
        router.refresh();
      } catch (error) {
        setSaveUnknown(operationKey.current !== null);
        onWriteGuardChange(false, operationKey.current !== null);
        setMessage(error instanceof Error ? error.message : "保存失敗，請保留內容後重試。");
      } finally {
        setPending(false);
      }
    }}
  >
    <div className={styles.formHeader}>
      <h2 className="sr-only">{form.title}填寫表單</h2>
      <span className={styles.draftBadge}>{latest ? `${latest.recordState === "signed" ? "已簽署" : latest.recordState === "submitted" ? "待簽署" : "草稿"} v${latest.version}` : "新草稿"}</span>
      <details className={styles.sourceDetails}>
        <summary>填寫說明與來源</summary>
        <p>{form.instructions}</p>
        <p>{form.sourceUrl
          ? <a href={form.sourceUrl} rel="noreferrer" target="_blank">{form.sourceLabel}</a>
          : form.sourceLabel}</p>
        <p>題本版本：{form.version}{approvedScorePreview ? `・計分規則：${approvedScorePreview.versionId}` : ""}</p>
      </details>
    </div>
    <p className={styles.quickInstruction}>{form.key === "spmsq"
      ? "逐題詢問並核對；篩檢結果不是診斷。"
      : form.key === "full_mna" ? "逐題填寫；量測值與 K 子題在對應題目完成。"
      : form.instructions}</p>

    <div className={styles.progress}>
      <div className={styles.progressText}>
        <strong>{client.displayName}{client.serviceStatus === "pending" ? "・待收案・僅草稿" : client.serviceStatus === "suspended" ? "・暫停服務" : ""}</strong>
        {canManage && nextUnfinishedLabel ? <button aria-label={`從進度前往${nextUnfinishedLabel}`}
          className={styles.progressJump} disabled={editorLocked} onClick={focusNextUnfinished} type="button">
          待補 {progressTotal - progressValue} <span aria-hidden="true">↓</span>
        </button> : <span>填寫進度 {progressValue}／{progressTotal} 項</span>}
      </div>
      <progress aria-label={`${form.title}題目與計分條件進度`} max={progressTotal} value={progressValue} />
      <small>{notApplicableCount ? `不適用 ${notApplicableCount} 題・` : ""}待答 {missingCount} 題{pendingReasonCount ? `・待補不適用原因 ${pendingReasonCount} 題` : ""}{pendingContextFields.length ? form.key === "full_mna" ? `・待補 K 子題 ${pendingContextFields.length} 項` : `・待補計分條件：${pendingContextLabel}` : ""}{suicideConcern ? "・需立即關懷" : ""}</small>
    </div>
    {!canManage ? <p className={styles.readOnly} role="status">{permittedToManage ? "此版本僅供查閱。" : "只有檢視權限；無法編輯或保存草稿。"}</p> : null}
    {saveUnknown ? <p className={styles.readOnly} role="status">上次保存結果尚未確認；欄位已暫時鎖定，請以同一次內容重試。</p> : null}

    <div className={styles.meta}>
      <label>評估日期
        <input
          disabled={!canManage || editorLocked}
          max={taipeiToday()}
          min="2000-01-01"
          onChange={(event) => {
            setAssessedOn(event.currentTarget.value);
            setDateError("");
            setMessage("");
          }}
          aria-describedby={dateError ? "questionnaire-date-error" : undefined}
          aria-invalid={dateError ? true : undefined}
          ref={dateInput}
          required
          type="date"
          value={assessedOn}
        />
        {dateError ? <span className={styles.fieldError} id="questionnaire-date-error">{dateError}</span> : null}
      </label>
      <div className={styles.assessor}><span>評估人員</span><strong>{assessorName}</strong></div>
    </div>

    <fieldset className={styles.questions} disabled={!canManage || editorLocked}>
      <legend className="sr-only">{form.title}題目</legend>
      {form.questions.map((question, index) => {
        const answer = answers[question.id] ?? { state: "missing" as const };
        const value = answer.state === "answered" ? answer.value : "";
        const questionTitleId = `${form.key}-${question.id}-title`;
        const questionHelpId = `${form.key}-${question.id}-help`;
        const reasonId = `na-reason-${form.key}-${question.id}`;
        const measurements = form.measurementFields?.filter((field) => form.key === "full_mna"
          ? field.questionId === question.id : question.id === "anthropometry") ?? [];
        const embeddedContextFields = form.contextFields?.filter((field) => field.questionId === question.id) ?? [];
        return <div className={styles.questionBlock} key={question.id}>
          {measurements.length ? <fieldset className={styles.measurements}>
            <legend>{form.key === "full_mna" ? "本題實測值（請先填，再核對區間）" : "身體測量（請先填，再回答下一題）"}</legend>
            {measurements.map(({ key, label }) => <label key={key}>
              {label}
              <input
                aria-label={label}
                aria-describedby={fullMnaIssue?.field === key ? `full-mna-${key}-error` : mnaIssue?.field === key ? `mna-${key}-error` : undefined}
                aria-invalid={fullMnaIssue?.field === key || mnaIssue?.field === key ? true : undefined}
                disabled={!canManage || editorLocked}
                id={`context-${form.key}-${key}`}
                inputMode="decimal"
                max={key === "height_cm" ? 240 : key === "weight_kg" ? 300 : 80}
                min={key === "height_cm" ? 50 : key === "weight_kg" ? 20 : 10}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setContext((current) => ({ ...current, [key]: value }));
                  setMnaIssue(null);
                  setFullMnaIssue(null);
                  setMessage("");
                }}
                step="0.1"
                type="number"
                value={context[key] ?? ""}
              />
              {mnaIssue?.field === key ? <span className={styles.fieldError} id={`mna-${key}-error`} role="alert">
                {mnaIssueText(mnaIssue)}
              </span> : null}
              {fullMnaIssue?.field === key ? <span className={styles.fieldError} id={`full-mna-${key}-error`} role="alert">
                {fullMnaIssueText(fullMnaIssue)}
              </span> : null}
            </label>)}
            {form.key === "full_mna" ? <p>{question.id === "anthropometry"
              ? bmi !== null ? `依身高體重計算 BMI ${bmi.toFixed(1)}；請核對 F 題區間。` : "完整版本 F 題需要身高與體重；小腿圍另於 R 題記錄。"
              : "請保留本次實測值，並核對本題區間。"}</p> : <p>{bmi !== null
              ? `依身高體重計算 BMI ${bmi.toFixed(1)}；請核對下一題的區間。若改用小腿圍，需先清除身高與體重。`
              : "無法取得 BMI 時，改填小腿圍並依下一題作答。"}</p>}
          </fieldset> : null}
          <section className={styles.questionCard} id={`${form.key}-${question.id}`} tabIndex={-1}>
          <div className={styles.questionHeading}>
            <h3 className={styles.questionTitle} id={questionTitleId}>{index + 1}. {question.prompt}</h3>
            <span className={styles.questionState}>{answer.state === "answered" ? "已答" : answer.state === "not_applicable" ? answer.reason.trim() ? "不適用" : "不適用・待補原因" : "待答"}</span>
          </div>
          {question.helpText ? <p className={styles.questionHelp} id={questionHelpId}>{question.helpText}</p> : null}
          {embeddedContextFields.length ? <fieldset className={styles.measurements}>
            <legend>K 題三個子回答</legend>
            {embeddedContextFields.map(({ key, label, choices }) => <label key={key}>
              {label}
              <select id={`context-${form.key}-${key}`} value={context[key] ?? ""}
                aria-label={label}
                aria-invalid={fullMnaIssue?.field === key ? true : undefined}
                aria-describedby={fullMnaIssue?.field === key ? `full-mna-${key}-error` : undefined}
                onChange={(event) => {
                  const updated = { ...context, [key]: event.currentTarget.value };
                  setContext(updated);
                  const derived = fullMnaProteinChoice(updated);
                  setAnswers((current) => ({ ...current, protein_intake: derived ? { state: "answered", value: derived } : { state: "missing" } }));
                  setFullMnaIssue(null); setMessage("");
                }}>
                <option value="">待答</option>
                {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
              {fullMnaIssue?.field === key ? <span className={styles.fieldError} id={`full-mna-${key}-error`} role="alert">{fullMnaIssueText(fullMnaIssue)}</span> : null}
            </label>)}
          </fieldset> : null}
          {question.id === "bsrs_suicide" && suicideConcern ? <div className={styles.urgent} ref={suicideAlert} role="alert">
            安全提醒：此題有記錄到困擾。請依機構危機處理流程立即轉知護理／主管並陪同關懷；本系統不會自動通知或代替專業處置。
          </div> : null}
          <div className={`${styles.choiceGrid} ${question.choices.length === 2 ? styles.binaryChoices : ""}`} role="radiogroup"
            aria-labelledby={questionTitleId} aria-describedby={[
              question.helpText ? questionHelpId : null,
              fullMnaIssue?.questionId === question.id && ["interval_mismatch", "protein_mismatch"].includes(fullMnaIssue.kind) ? `full-mna-${question.id}-error` : null,
              question.id === "anthropometry" && mnaIssue?.field === "anthropometry" ? "mna-anthropometry-error" : null,
            ].filter(Boolean).join(" ") || undefined}>
            {question.choices.map((choice) => <label className={styles.choice} key={choice.value}>
              <input
                checked={value === choice.value}
                disabled={form.key === "full_mna" && question.id === "protein_intake"}
                name={question.id}
                onChange={() => setAnswer(question.id, { state: "answered", value: choice.value })}
                type="radio"
                value={choice.value}
              />
              <span>{choice.label}</span>
            </label>)}
          </div>
          {question.id === "anthropometry" && mnaIssue?.field === "anthropometry"
            ? <p className={styles.fieldError} id="mna-anthropometry-error" role="alert">{mnaIssueText(mnaIssue)}</p>
            : null}
          {fullMnaIssue?.questionId === question.id && ["interval_mismatch", "protein_mismatch"].includes(fullMnaIssue.kind)
            ? <p className={styles.fieldError} id={`full-mna-${question.id}-error`} role="alert">{fullMnaIssueText(fullMnaIssue)}</p> : null}
          <div className={styles.questionActions}>
            {answer.state !== "missing" ? <button disabled={editorLocked} onClick={() => setAnswer(question.id, { state: "missing" })} type="button">改為待答</button> : null}
            {allowsNotApplicable && answer.state !== "not_applicable"
              ? <button disabled={editorLocked} onClick={() => setAnswer(question.id, { state: "not_applicable", reason: "" })} type="button">此題不適用</button>
              : null}
          </div>
          {answer.state === "not_applicable" ? <div className={styles.reason}>
            <label htmlFor={reasonId}>不適用原因（必填）</label>
            <textarea aria-describedby={reasonErrorQuestionId === question.id ? `${reasonId}-error` : undefined}
              aria-invalid={reasonErrorQuestionId === question.id ? true : undefined}
              id={reasonId} maxLength={500} rows={2} value={answer.reason}
              onChange={(event) => setAnswer(question.id, { state: "not_applicable", reason: event.currentTarget.value })} />
            {reasonErrorQuestionId === question.id ? <span className={styles.fieldError} id={`${reasonId}-error`}>請填寫原因，或改為待答。</span> : null}
          </div> : null}
        </section>
        </div>;
      })}
    </fieldset>

    <div className={styles.review}>
      <div><strong>{missingCount
        ? `還有 ${missingCount} 題待答${pendingReasonCount ? `，並待補 ${pendingReasonCount} 題不適用原因` : ""}${pendingContextFields.length ? `，並待補${pendingContextLabel}` : ""}`
        : pendingReasonCount
          ? `題目已處理，待補 ${pendingReasonCount} 題不適用原因${pendingContextFields.length ? `，並待補${pendingContextLabel}` : ""}`
          : pendingContextFields.length ? `題目已處理，待補${pendingContextLabel}` : "目前沒有待補項目"}</strong>
        <span>可隨時保存草稿；保存不代表簽署或專業判讀。</span></div>
      {firstUnfinishedQuestion ? <button className="button button--secondary" onClick={focusNextUnfinished} type="button">
        前往第 {firstUnfinishedIndex + 1} 題{firstUnfinishedAnswer?.state === "not_applicable" ? "不適用原因" : ""}
      </button> : pendingContextFields.length ? <button className="button button--secondary" onClick={focusNextUnfinished} type="button">
        前往{pendingContextFields[0].label}
      </button> : null}
    </div>

    {form.contextFields?.some((field) => !field.questionId) ? <fieldset className={styles.measurements}>
      <legend>計分條件</legend>
      {form.contextFields.filter((field) => !field.questionId).map(({ key, label, required, choices }) => <label key={key}>
        {label}{required ? "（計分必要）" : ""}
        <select disabled={!canManage || editorLocked} id={`context-${form.key}-${key}`}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setContext((current) => ({ ...current, [key]: value }));
          }}
          value={context[key] ?? ""}>
          <option value="">請選擇</option>
          {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </label>)}
    </fieldset> : null}

    {form.allowQualitativeNotes ? <label className={styles.notes}>
      補充觀察與後續事項
      <textarea disabled={!canManage || editorLocked} maxLength={3000} onChange={(event) => {
        const value = event.currentTarget.value;
        setContext((current) => ({ ...current, qualitative_note: value }));
      }}
        placeholder="選填；記錄本次觀察或需由人員追蹤的事項" rows={4} value={context.qualitative_note ?? ""} />
      <small>選填，最多 3,000 字；內容不會加入量表分數。</small>
    </label> : null}

    {approvedScorePreview ? <section className={styles.score} aria-live="polite" aria-label="量表計分預覽">
      <strong>{approvedScorePreview.status === "complete" && approvedScorePreview.score
        ? `計分預覽 ${approvedScorePreview.score.adjusted ?? approvedScorePreview.score.raw}／${approvedScorePreview.score.max}`
        : "計分預覽：尚未完整作答"}</strong>
      {approvedScorePreview.status === "complete" && approvedScorePreview.classification
        ? <span>{approvedScorePreview.classification.label}</span> : null}
      <small>草稿試算，不等於診斷、醫囑或自動處置。</small>
    </section> : scorePreview && latest?.recordState !== "signed" ? <p className={styles.readOnly} role="status">
      {latest?.ruleAvailable
        ? "此版本的計分規則已核定；分數以簽署後保存的結果為準。"
        : "計分規則尚待核准；此頁只保存填答草稿，不顯示分數或風險分級。"}
    </p> : null}

    <div className={styles.actions}>
      <span>待答 {missingCount} 題{pendingReasonCount ? `・待補 ${pendingReasonCount} 題不適用原因` : ""}{pendingContextFields.length ? `・待補 ${pendingContextFields.length} 項計分條件` : ""}・僅保存草稿</span>
      <button className="button button--primary" disabled={!canManage || pending || lifecycleGuard.busy || lifecycleGuard.unknown || lifecycleDirty} type="submit">
        {pending ? "保存中…" : saveUnknown ? "重試同一次保存" : latest ? "保存為新版本" : "保存草稿"}
      </button>
    </div>
    {lifecycleDirty ? <p className={styles.message}>送審／補正欄位有未送出內容；請完成該操作或清除這些欄位，再保存答案的新版本。</p> : null}
    {latest ? <QuestionnaireLifecycleActions record={latest} clientId={client.clientId} formKey={form.key}
      canManage={permittedToManage} canSign={canSign} draftOnly={client.serviceStatus === "pending"} complete={missingCount === 0 && pendingReasonCount === 0 && pendingContextFields.length === 0}
      dirty={dirty} safetyConcern={Boolean(suicideConcern)} siblingBlocked={pending || saveUnknown}
      onDirtyChange={setLifecycleDirty} onWriteGuardChange={lifecycleWriteGuardChanged} /> : null}
    {message ? <p aria-live="polite" className={styles.message} role="status">{message}</p> : null}
    {latest ? <p className={styles.message}>
      最近保存：{latest.authorDisplayName}・{new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short",
      }).format(new Date(latest.createdAt))}
    </p> : null}
  </form>;
}

export function QuestionnaireAssessmentsWorkspace({
  assessorName,
  canManage,
  form,
  loadError,
  pageTitle,
  selectedClientId,
  snapshot,
}: {
  assessorName: string;
  canManage: boolean;
  form: QuestionnaireFormDefinition;
  loadError: boolean;
  pageTitle: string;
  selectedClientId: string | null;
  snapshot: QuestionnaireSnapshot | null;
}) {
  const router = useRouter();
  const dialogId = useId();
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveTrigger = useRef<HTMLElement | null>(null);
  const selectionButton = useRef<HTMLButtonElement>(null);
  const clientSelect = useRef<HTMLSelectElement>(null);
  const pendingNavigation = useRef<{ kind: "client" | "link" | "history"; destination: string } | null>(null);
  const historyGuardToken = useRef<string | null>(null);
  const historyGuardUrl = useRef<string | null>(null);
  const historyGuardArmed = useRef(false);
  const intentionalLeave = useRef(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [writeGuard, setWriteGuard] = useState({ busy: false, unknown: false });
  const writeGuardRef = useRef({ busy: false, unknown: false });
  const [discardRevision, setDiscardRevision] = useState(0);
  const [leaveError, setLeaveError] = useState("");
  const armHistoryGuard = useCallback(() => {
    const token = historyGuardToken.current ?? crypto.randomUUID();
    const previous = window.history.state;
    const next = previous && typeof previous === "object" ? previous as Record<string, unknown> : {};
    const url = window.location.href;
    window.history.pushState({ ...next, [historyGuardKey]: token }, "", url);
    historyGuardToken.current = token;
    historyGuardUrl.current = url;
    historyGuardArmed.current = true;
  }, []);
  const onWriteGuardChange = useCallback((busy: boolean, unknown: boolean) => {
    writeGuardRef.current = { busy, unknown };
    setWriteGuard({ busy, unknown });
    if ((busy || unknown) && !historyGuardArmed.current && !intentionalLeave.current) armHistoryGuard();
  }, [armHistoryGuard]);
  const leaveProtected = hasUnsavedChanges || writeGuard.busy || writeGuard.unknown;
  const holdMessage = writeGuard.unknown
    ? "上次保存結果尚未確認；請保留畫面，以同一次內容重試，暫時不能離開或更換個案。"
    : "資料保存中，請稍候；暫時不能離開或更換個案。";
  const showLeaveDialog = useCallback(() => {
    if (writeGuardRef.current.busy || writeGuardRef.current.unknown) {
      pendingNavigation.current = null;
      setLeaveError(writeGuardRef.current.unknown
        ? "上次保存結果尚未確認；請保留畫面，以同一次內容重試。"
        : "資料保存中，請稍候再離開。");
      return;
    }
    setLeaveError("");
    try {
      if (!leaveDialog.current?.showModal) throw new Error("dialog unavailable");
      if (!leaveDialog.current.open) leaveDialog.current.showModal();
    } catch {
      if (pendingNavigation.current?.kind === "history") armHistoryGuard();
      pendingNavigation.current = null;
      setLeaveError("此瀏覽器無法安全確認離頁，請先保存草稿再更換個案或離開。");
    }
  }, [armHistoryGuard, setLeaveError]);
  useEffect(() => {
    if (leaveProtected && !historyGuardArmed.current && !intentionalLeave.current && pendingNavigation.current?.kind !== "history") armHistoryGuard();
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges && !writeGuardRef.current.busy && !writeGuardRef.current.unknown) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptHistory = () => {
      if (!hasUnsavedChanges && !writeGuardRef.current.busy && !writeGuardRef.current.unknown) return;
      if (!historyGuardArmed.current || intentionalLeave.current ||
        window.history.state?.[historyGuardKey] === historyGuardToken.current) return;
      if (window.location.href !== historyGuardUrl.current) return;
      historyGuardArmed.current = false;
      if (writeGuardRef.current.busy || writeGuardRef.current.unknown) {
        armHistoryGuard();
        setLeaveError(writeGuardRef.current.unknown
          ? "上次保存結果尚未確認；請保留畫面，以同一次內容重試。"
          : "資料保存中，請稍候再離開。");
        return;
      }
      leaveTrigger.current = selectionButton.current;
      pendingNavigation.current = { kind: "history", destination: "back" };
      showLeaveDialog();
    };
    const interceptLink = (event: MouseEvent) => {
      if (!hasUnsavedChanges && !writeGuardRef.current.busy && !writeGuardRef.current.unknown) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self") ||
        !["http:", "https:"].includes(anchor.protocol)) return;
      if (writeGuardRef.current.busy || writeGuardRef.current.unknown) {
        event.preventDefault();
        event.stopPropagation();
        setLeaveError(writeGuardRef.current.unknown
          ? "上次保存結果尚未確認；請保留畫面，以同一次內容重試。"
          : "資料保存中，請稍候再離開。");
        return;
      }
      if (anchor.origin !== window.location.origin) return;
      const destination = `${anchor.pathname}${anchor.search}${anchor.hash}`;
      if (destination === `${window.location.pathname}${window.location.search}${window.location.hash}` ||
        anchor.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      leaveTrigger.current = anchor;
      pendingNavigation.current = { kind: "link", destination };
      showLeaveDialog();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("popstate", interceptHistory);
    document.addEventListener("click", interceptLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("popstate", interceptHistory);
      document.removeEventListener("click", interceptLink, true);
    };
  }, [armHistoryGuard, hasUnsavedChanges, leaveProtected, showLeaveDialog]);
  useEffect(() => {
    if (leaveProtected || writeGuardRef.current.busy || writeGuardRef.current.unknown || intentionalLeave.current || !historyGuardArmed.current) return;
    if (window.history.state?.[historyGuardKey] !== historyGuardToken.current) return;
    historyGuardArmed.current = false;
    historyGuardToken.current = null;
    historyGuardUrl.current = null;
    window.history.back();
  }, [leaveProtected]);
  useEffect(() => { intentionalLeave.current = false; }, [form.key, selectedClientId]);

  if (loadError || !snapshot) return <section className="empty-card core-care-state" role="alert">
    <h1>{pageTitle}暫時無法載入</h1>
    <p>正式個案清單未能確認；沒有切換到展示資料或擴大查閱範圍。</p>
    <a className="button button--secondary" href="?">重新載入</a>
  </section>;

  const chosenClient = selectedClientId
    ? snapshot.clients.find((client) => client.clientId === selectedClientId) ?? null
    : null;
  const formRef = form.key === "mna_sf" || form.key === "full_mna"
    ? mnaVariantHref(form.key, null)
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
  function confirmNavigation() {
    if (writeGuardRef.current.busy || writeGuardRef.current.unknown) {
      leaveDialog.current?.close();
      setLeaveError(writeGuardRef.current.unknown
        ? "上次保存結果尚未確認；請保留畫面，以同一次內容重試。"
        : "資料保存中，請稍候再離開。");
      return;
    }
    const target = pendingNavigation.current;
    if (!target) return;
    const atHistorySentinel = window.history.state?.[historyGuardKey] === historyGuardToken.current &&
      window.location.href === historyGuardUrl.current;
    pendingNavigation.current = null;
    intentionalLeave.current = true;
    historyGuardArmed.current = false;
    historyGuardToken.current = null;
    historyGuardUrl.current = null;
    // App Router may restore this page from its client cache on Forward. Clear
    // the explicitly discarded in-memory answers before leaving.
    flushSync(() => setDiscardRevision((revision) => revision + 1));
    leaveDialog.current?.close();
    if (target.kind === "history") {
      window.history.go(atHistorySentinel ? -2 : -1);
      return;
    }
    router.replace(target.kind === "client"
      ? questionnaireHistoryHref(formRef, target.destination, { month: snapshot?.selection?.month })
      : target.destination);
  }
  function guardClientChange(event: FormEvent<HTMLFormElement>) {
    const selected = new FormData(event.currentTarget).get("client");
    if (typeof selected !== "string" || !snapshot?.clients.some((client) => client.clientId === selected)) {
      event.preventDefault();
      setLeaveError("請先選擇一位可見個案。");
      clientSelect.current?.focus();
      return;
    }
    if (!hasUnsavedChanges && !writeGuardRef.current.busy && !writeGuardRef.current.unknown) return;
    event.preventDefault();
    if (writeGuardRef.current.busy || writeGuardRef.current.unknown) {
      if (chosenClient && clientSelect.current) clientSelect.current.value = chosenClient.clientId;
      setLeaveError(writeGuardRef.current.unknown
        ? "上次保存結果尚未確認；請保留畫面，以同一次內容重試。"
        : "資料保存中，請稍候再離開。");
      return;
    }
    leaveTrigger.current = selectionButton.current;
    pendingNavigation.current = { kind: "client", destination: selected };
    showLeaveDialog();
  }
  return <div className={styles.workspace}>
    <header className="page-heading core-care-heading">
      <div>
        <h1>{pageTitle}</h1>
        {!chosenClient ? <p className="page-heading__description">選個案、填寫、保存草稿。</p> : null}
      </div>
    </header>

    {form.key === "mna_sf" || form.key === "full_mna" ? <nav aria-label="MNA 版本" className={styles.actions}>
      {(["mna_sf", "full_mna"] as const).map((variant) => <NavigationLink
        aria-current={form.key === variant ? "page" : undefined}
        className={`button ${form.key === variant ? "button--primary" : "button--secondary"}`}
        href={mnaVariantHref(variant, chosenClient?.clientId ?? null, snapshot.selection?.month)}
        key={variant} loadingLabel={variant === "mna_sf" ? "MNA 篩檢" : "MNA 完整評估"} prefetch={false}>
        {variant === "mna_sf" ? "篩檢 · 6 題" : "完整評估 · 18 題"}
      </NavigationLink>)}
    </nav> : null}

    {snapshot.demo ? <div className="callout" role="status">
      展示用合成個案；不能寫入真實評估資料。
    </div> : null}

    <form action={formRef.split("?", 1)[0]} className={`${styles.selection} ${chosenClient ? styles.selectionChosen : ""}`} method="get" noValidate onSubmit={guardClientChange}>
      {form.key === "full_mna" ? <input type="hidden" name="variant" value="full" /> : null}
      {snapshot.selection?.month ? <input type="hidden" name="month" value={snapshot.selection.month} /> : null}
      <label htmlFor="questionnaire-client"><span className={chosenClient ? "sr-only" : undefined}>個案</span>
        <select aria-describedby={leaveError === "請先選擇一位可見個案。" ? `${dialogId}-client-error` : undefined}
          aria-invalid={leaveError === "請先選擇一位可見個案。" ? true : undefined}
          defaultValue={chosenClient?.clientId ?? ""} id="questionnaire-client" key={chosenClient?.clientId ?? "none"} name="client"
          onChange={() => setLeaveError((current) => current === "請先選擇一位可見個案。" ? "" : current)} ref={clientSelect} required>
          <option disabled value="">請選擇個案</option>
          {snapshot.clients.map((client) => <option key={client.clientId} value={client.clientId}>
            {client.displayName}{client.serviceStatus === "pending" ? "・待收案・僅草稿" : client.serviceStatus === "suspended" ? "・暫停服務" : ""}
          </option>)}
        </select>
      </label>
      <button className="button button--secondary" ref={selectionButton} type="submit">{chosenClient ? "更換個案" : "開始填寫"}</button>
    </form>
    {leaveError ? <p className={styles.fieldError} id={`${dialogId}-client-error`} role="alert">{leaveError}</p> : null}
    {writeGuard.unknown ? <p className={styles.fieldError} role="status">{holdMessage}</p> : null}

    <dialog aria-describedby={`${dialogId}-description`} aria-labelledby={`${dialogId}-title`}
      className="core-dialog" onClose={() => {
        if (pendingNavigation.current?.kind === "client" && chosenClient && clientSelect.current) clientSelect.current.value = chosenClient.clientId;
        if (pendingNavigation.current?.kind === "history" && window.location.href === historyGuardUrl.current) {
          if (window.history.state?.[historyGuardKey] === historyGuardToken.current) historyGuardArmed.current = true;
          else armHistoryGuard();
        }
        pendingNavigation.current = null;
        leaveTrigger.current?.focus();
      }} ref={leaveDialog} role="alertdialog">
      <div className="core-dialog__surface">
        <header className="drawer__header"><h2 id={`${dialogId}-title`}>放棄未保存的評估輸入？</h2></header>
        <div className="drawer__body core-dialog__body" id={`${dialogId}-description`}>
          <p>本次輸入尚未保存。更換個案或離開此頁會清除輸入，不會建立草稿。</p>
        </div>
        <footer className="drawer__footer">
          <button autoFocus className="button button--primary" onClick={() => leaveDialog.current?.close()} type="button">繼續填寫</button>
          <button className="button button--danger" onClick={confirmNavigation} type="button">放棄輸入並繼續</button>
        </footer>
      </div>
    </dialog>

    {chosenClient ? <>
    <div className={styles.actions}>
      {canManage ? <a className="button button--secondary" href={questionnaireHistoryHref(formRef, chosenClient.clientId, { newAssessment: true, month: snapshot.selection?.month })}>＋ 新一次評估</a> : null}
      <details><summary>評估歷史（{snapshot.historyTotal ?? snapshot.history?.length ?? 0}）</summary>
        {(snapshot.history ?? []).map((record) => <div className={styles.questionCard} key={record.assessmentKey}>
          <a href={questionnaireHistoryHref(formRef, chosenClient.clientId, { versionId: record.versionId })}>{record.assessedOn} · {record.recordState === "signed" ? "已簽署" : record.recordState === "submitted" ? "待簽署" : "草稿"} · v{record.version}</a>
          <details><summary>歷次版本</summary>{record.versions.map((version) => <p key={version.versionId}><a href={questionnaireHistoryHref(formRef, chosenClient.clientId, { versionId: version.versionId })}>v{version.version} · {version.recordState === "signed" ? "已簽署" : version.recordState === "submitted" ? "待簽署" : "草稿"}</a></p>)}</details>
        </div>)}
        {(snapshot.historyPage ?? 1) > 1 ? <a className="button button--secondary" href={questionnaireHistoryHref(formRef, chosenClient.clientId, { ...snapshot.selection, historyPage: (snapshot.historyPage ?? 1) - 1 })}>較新紀錄</a> : null}
        {(snapshot.historyPage ?? 1) * 10 < (snapshot.historyTotal ?? 0) ? <a className="button button--secondary" href={questionnaireHistoryHref(formRef, chosenClient.clientId, { ...snapshot.selection, historyPage: (snapshot.historyPage ?? 1) + 1 })}>較早紀錄</a> : null}
      </details>
    </div>
    <QuestionnaireEditor
      assessorName={assessorName}
      canManage={canManage}
      canSign={snapshot.canSign ?? false}
      client={chosenClient}
      form={chosenClient.latest?.formSnapshot ?? form}
      selectedMonth={snapshot.selection?.month ?? null}
      key={`${form.key}-${chosenClient.clientId}-${chosenClient.latest?.versionId ?? "new"}-${snapshot.selection?.month ?? "all"}-${discardRevision}`}
      onDirtyChange={setHasUnsavedChanges}
      onWriteGuardChange={onWriteGuardChange}
    /></> : <div className={styles.empty}>
      {snapshot.clients.length ? "請先選一位個案，量表會直接在此展開。" : "目前沒有可指派給此帳號的有效個案。請確認個案指派與分支權限。"}
    </div>}
  </div>;
}
