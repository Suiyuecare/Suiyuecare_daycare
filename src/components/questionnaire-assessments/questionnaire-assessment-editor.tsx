"use client";

import { useEffect, useRef, useState } from "react";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { questionnairePreview } from "@/lib/questionnaire-assessments/preview";
import { parseQuestionnaireAssessmentPage, parseQuestionnaireHistoryPage, questionnaireReceiptSchema } from "@/lib/questionnaire-assessments/contract";
import { tryAcquirePendingOperation, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
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

import styles from "./questionnaire-assessments.module.css";

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

function QuestionnaireEditor({
  assessorName,
  canManage,
  client,
  form,
  baseline,
  readOnly = false,
  reading = false,
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
  onSaved: (assessmentKey: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onLockChange: (locked: boolean) => void;
}) {
  const latest = baseline;
  const [answers, setAnswers] = useState(() => initialAnswers(form, latest));
  const [context, setContext] = useState(() => initialContext(form, latest));
  const [assessedOn, setAssessedOn] = useState(latest?.assessedOn ?? taipeiToday());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const releaseOperation = useRef<(() => void) | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [committed, setCommitted] = useState(false);
  const frozenBody = useRef<string | null>(null);
  const dirty = useRef(false);
  const viewTransitionPending = useViewTransitionPending();
  const releaseDirty = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    // A known unsubmitted draft may be discarded by an explicit navigation.
    // An unresolved write is never released merely because of unmount.
    if (!operationKey.current) { releaseDirty.current?.(); releaseDirty.current = null; }
  }, []);
  useEffect(() => {
    onLockChange(pending || retryPending || committed);
  }, [pending, retryPending, committed, onLockChange]);
  useEffect(() => {
    // This page owns its navigation protection. Capture runs before Next Link
    // handlers, including sidebar, brand, notification and mobile navigation.
    const pageUrl = window.location.href;
    const pageHistoryState = window.history.state;
    function canLeave() {
      if (operationKey.current) {
        setMessage("保存結果尚未確認，請留在本表單並以相同內容重試，確認後再離開。");
        return false;
      }
      if (!dirty.current) return true;
      if (!window.confirm("本次修改尚未保存。確定放棄修改並離開這份評估嗎？")) return false;
      dirty.current = false;
      releaseDirty.current?.(); releaseDirty.current = null;
      onDirtyChange(false);
      return true;
    }
    function guard(event: BeforeUnloadEvent) {
      if (dirty.current || operationKey.current) { event.preventDefault(); }
    }
    function guardLink(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const logoutButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.app-shell button[aria-label="登出"], .topbar__actions button') : null;
      if ((logoutButton?.getAttribute("aria-label") === "登出" || logoutButton?.textContent?.trim() === "登出") && operationKey.current) {
        // Explicit security exit is the only exception to the unresolved
        // navigation lock. The user acknowledges that replay is abandoned and
        // must read the ledger after login. No shared logout policy is changed.
        if (!window.confirm("保存結果尚未確認。登出會停止本頁重試；重新登入後，請先回查此個案的評估紀錄，確認是否已保存，再新增或修訂。確定安全登出嗎？")) {
          event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        dirty.current = false;
        operationKey.current = null; frozenBody.current = null;
        releaseOperation.current?.(); releaseOperation.current = null;
        releaseDirty.current?.(); releaseDirty.current = null;
        onDirtyChange(false);
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!canLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    function guardHistory(event: PopStateEvent) {
      if (canLeave()) return;
      event.stopImmediatePropagation();
      // Restore this entry before Next's non-capture popstate listener can
      // unmount the editor. Preserve Next's opaque history state in full.
      // No request bodies, keys or answers are stored in browser history.
      window.history.pushState(pageHistoryState, "", pageUrl);
    }
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", guardLink, true);
    window.addEventListener("popstate", guardHistory, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("click", guardLink, true);
      window.removeEventListener("popstate", guardHistory, true);
    };
  }, [onDirtyChange]);
  const missingCount = Object.values(answers).filter((answer) => answer.state === "missing").length;
  const suicideAnswer = form.key === "bsrs5" ? answers.bsrs_suicide : null;
  const suicideConcern = suicideAnswer?.state === "answered" && Number(suicideAnswer.value) > 0;
  const { result: scorePreview, measurementIssue } = questionnairePreview(form, answers, context);
  const height = Number(context.height_cm);
  const weight = Number(context.weight_kg);
  const bmi = height > 0 && weight > 0 ? weight / ((height / 100) ** 2) : null;

  function setResponse(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: { state: "answered", value } }));
    setMessage("");
  }

  async function save() {
    if (!releaseOperation.current) {
      releaseOperation.current = tryAcquirePendingOperation();
      if (!releaseOperation.current) throw new Error("目前正在切換工作畫面，請稍後再保存。");
    }
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
    frozenBody.current ??= JSON.stringify(body);
    const response = await fetchWithTimeout(
      `/api/questionnaire-assessments?form_key=${form.key}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: frozenBody.current,
      },
    );
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error("回應內容無法確認，請保留表單並稍後重試。"); }
    if (!response.ok) {
      if (!uncertain.current && response.status < 500) {
        operationKey.current = null;
        frozenBody.current = null;
        releaseOperation.current?.(); releaseOperation.current = null;
      }
      throw new Error(errorText(payload));
    }
    const parsed = questionnaireReceiptSchema.safeParse((payload as { data?: unknown }).data);
    if (!parsed.success || parsed.data.action !== action || parsed.data.clientId !== client.clientId || parsed.data.formKey !== form.key ||
      parsed.data.assessedOn !== assessedOn || parsed.data.version !== (latest?.version ?? 0) + 1 ||
      (latest && parsed.data.assessmentKey !== latest.assessmentKey)) throw new Error("無法確認草稿保存狀態，請保留內容並以相同操作重試。");
    operationKey.current = null;
    uncertain.current = false;
    frozenBody.current = null;
    releaseOperation.current?.(); releaseOperation.current = null;
    dirty.current = false;
    releaseDirty.current?.(); releaseDirty.current = null;
    onDirtyChange(false);
    setRetryPending(false);
    setCommitted(true);
    setMessage("草稿已保存，正在讀回紀錄。");
    await onSaved(parsed.data.assessmentKey);
  }

  return <form
    className={styles.formPanel}
    noValidate
    aria-busy={pending}
    onChange={() => {
      // Coordinate with the existing header refresh and BranchSwitcher guards.
      // The tab-local lease contains only an opaque Symbol, never draft data.
      releaseDirty.current ??= tryAcquirePendingOperation();
      dirty.current = true;
      onDirtyChange(true);
    }}
    onSubmit={async (event) => {
      event.preventDefault();
      if (!canManage || readOnly || pending || committed || reading || viewTransitionPending) return;
      if (!assessedOn || assessedOn < "2000-01-01" || assessedOn > taipeiToday()) {
        setMessage("請填寫有效評估日期，且不得晚於今天。");
        event.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
        return;
      }
      if (measurementIssue) { setMessage(measurementIssue); return; }
      setPending(true);
      setMessage("");
      try {
        await save();
      } catch (error) {
        uncertain.current = operationKey.current !== null;
        setRetryPending(uncertain.current);
        setMessage(error instanceof Error ? error.message : "保存失敗，請保留內容後重試。");
      } finally {
        setPending(false);
      }
    }}
  >
    <fieldset className={styles.editorFields} disabled={pending || retryPending || committed || readOnly || reading || viewTransitionPending}>
    <div className={styles.formHeader}>
      <div>
        <h2>{form.title}</h2>
        <p>{form.instructions}</p>
        <p className={styles.source}>
          題目來源：{form.sourceUrl
            ? <a href={form.sourceUrl} rel="noreferrer" target="_blank">{form.sourceLabel}</a>
            : form.sourceLabel}
        </p>
      </div>
      <span className={styles.draftBadge}>{readOnly ? latest ? `查看 v${latest.version}` : "僅供檢視" : latest ? `修訂草稿 v${latest.version}` : "新增一次評估"}</span>
    </div>

    <div className={styles.meta}>
      <label>評估日期
        <input
          max={taipeiToday()}
          onChange={(event) => {
            setAssessedOn(event.currentTarget.value);
            setMessage("");
          }}
          required
          type="date"
          value={assessedOn}
        />
      </label>
      <label>評估人員
        <span className={styles.assessor}>{readOnly ? latest?.authorDisplayName : assessorName}</span>
      </label>
    </div>

    {suicideConcern ? <div className={styles.urgent} role="alert">
      安全提醒：此題有記錄到困擾。請依機構危機處理流程立即轉知護理／主管並陪同關懷；本系統不會自動通知或代替專業處置。
    </div> : null}

    {form.contextFields?.length ? <fieldset className={styles.measurements}>
      <legend>評估條件</legend>
      {form.contextFields.map(({ key, label, required, choices }) => <label key={key}>
        {label}{required ? "（計分必要）" : ""}
        <select
          onChange={(event) => setContext((current) => ({ ...current, [key]: event.currentTarget.value }))}
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
          onChange={(event) => setContext((current) => ({ ...current, [key]: event.currentTarget.value }))}
          step="0.1"
          type="number"
          value={context[key] ?? ""}
        />
      </label>)}
      {bmi !== null ? <p>依輸入身高與體重計算 BMI：{bmi.toFixed(1)}。請確認 F 題選擇的區間相符；若無法取得 BMI，改輸入小腿圍並選擇小腿圍選項。</p> : <p>輸入可取得的身高與體重；若無法取得 BMI，請改填小腿圍並依 F 題指示作答。</p>}
    </fieldset> : null}

    {form.allowQualitativeNotes ? <label className={styles.notes}>
      補充觀察與後續事項
      <textarea
        maxLength={3000}
        onChange={(event) => setContext((current) => ({ ...current, qualitative_note: event.currentTarget.value }))}
        placeholder="選填；記錄本次觀察或需由人員追蹤的事項"
        rows={4}
        value={context.qualitative_note ?? ""}
      />
      <small>選填，最多 3,000 字；內容不會加入量表分數。</small>
    </label> : null}

    <fieldset className={styles.questions} disabled={pending}>
      <legend className="sr-only">{form.title}題目</legend>
      {form.questions.map((question, index) => {
        const answer = answers[question.id] ?? { state: "missing" as const };
        const value = answer.state === "answered" ? answer.value : "";
        return <section className={styles.questionCard} key={question.id}>
          <h3 className={styles.questionTitle}>{index + 1}. {question.prompt}</h3>
          {question.helpText ? <p className={styles.questionHelp}>{question.helpText}</p> : null}
          <div className={styles.choiceGrid} role="radiogroup" aria-label={`第 ${index + 1} 題`}>
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
          </div>
        </section>;
      })}
    </fieldset>

    {scorePreview ? <section className={styles.score} aria-live="polite" aria-label="量表計分預覽">
      <strong>{scorePreview.status === "complete" && scorePreview.score
        ? `計分預覽 ${scorePreview.score.adjusted ?? scorePreview.score.raw}／${scorePreview.score.max}`
        : "計分預覽：尚未完整作答"}</strong>
      {scorePreview.status === "complete" && scorePreview.classification
        ? <span>{scorePreview.classification.label}</span> : null}
      <small>篩檢分數需由人員判讀。</small>
      {measurementIssue ? <p role="alert">{measurementIssue}</p> : null}
      {scorePreview.rule?.reviewRequired || !scorePreview.rule?.activatedAt ? <details className={styles.ruleNotice}>
        <summary>僅供草稿核對，正式計分尚未啟用</summary>
        <p>此版本的正式計分規則仍待業務覆核；保存答案不代表完成正式簽署。</p>
        <p>計分版本：{scorePreview.versionId}。篩檢分數不等於診斷、醫囑或自動處置。</p>
        <p>待業務完成規則覆核與正式計分啟用後，才能作為正式紀錄使用。</p>
      </details> : null}
    </section> : null}
    </fieldset>
    <div className={styles.actions}>
      <span>已填 {form.questions.length - missingCount}／{form.questions.length} 題</span>
      {!readOnly ? <button className="button button--primary" disabled={!canManage || pending || committed || reading || viewTransitionPending} type="submit">
        {pending ? "保存中…" : retryPending ? "以相同內容重試" : latest ? "保存修訂版本" : "保存本次評估"}
      </button> : <span>{latest ? "歷史版本僅供查看；修訂請選擇該次評估的最新草稿。" : "此量表僅供檢視，尚無已保存紀錄。"}</span>}
      {!canManage ? <span>目前帳號只有檢視權限</span> : null}
    </div>
    {message ? <p aria-live="polite" className={styles.message} role="status">{message}</p> : null}
    {latest ? <p className={styles.message}>
      最近保存：{latest.authorDisplayName}・{new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short",
      }).format(new Date(latest.createdAt))}・僅草稿
    </p> : null}
  </form>;
}

function QuestionnaireRecords({ assessorName, canManage, client, form, onNavigationBlockChange }: {
  assessorName: string; canManage: boolean; client: QuestionnaireClient; form: QuestionnaireFormDefinition;
  onNavigationBlockChange: (blocked: boolean) => void;
}) {
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
  const [switchIntent, setSwitchIntent] = useState<(() => void) | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const requestSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryRead = useRef<(() => void) | null>(null);
  useEffect(() => {
    onNavigationBlockChange(dirty || locked);
  }, [dirty, locked, onNavigationBlockChange]);
  useEffect(() => () => { controller.current?.abort(); }, []);

  function requestSwitch(operation: () => void) {
    if (locked || reading) return;
    if (dirty) { setSwitchIntent(() => operation); return; }
    setEditorEpoch((current) => current + 1);
    operation();
  }
  function startNew() {
    controller.current?.abort(); requestSequence.current++;
    setBaseline(null); setSelectedKey(""); setReadOnly(!canManage);
    setVersions([]); setDirty(false); setFeedback(""); setReadError("");
  }
  async function read(mode: "assessments" | "versions", key?: string, older = false) {
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
      const response = await fetchWithTimeout(`/api/questionnaire-assessments?${query}`, { signal: controller.current.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorText(payload));
      if (sequence !== requestSequence.current) return;
      if (mode === "versions") {
        const page = parseQuestionnaireHistoryPage(payload.data, form.key, client.clientId, key!);
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
        const page = parseQuestionnaireAssessmentPage(payload.data, form.key, client.clientId);
        setAssessments((current) => older ? [...current, ...page.assessments.filter((item) => !current.some((entry) => entry.assessmentKey === item.assessmentKey))] : page.assessments);
        setTotal(page.total); setCursor(page.nextCursor);
      }
    } catch (error) {
      if (sequence === requestSequence.current) setReadError(error instanceof Error ? error.message : "歷程暫時無法載入，請重試。");
    } finally { if (sequence === requestSequence.current) setReading(false); }
  }
  async function saved(key: string) {
    setReloadKey(key);
    setReading(true);
    setFeedback("本次草稿已保存。正在讀回最新紀錄。");
    try {
      const query = new URLSearchParams({ form_key: form.key, client_id: client.clientId, mode: "versions", assessment_key: key });
      const response = await fetchWithTimeout(`/api/questionnaire-assessments?${query}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(errorText(payload));
      const page = parseQuestionnaireHistoryPage(payload.data, form.key, client.clientId, key);
      const latest = page.versions[0];
      if (!latest) throw new Error("保存已確認，最新版本暫時無法讀回。");
      setBaseline(latest); setSelectedKey(key); setReadOnly(!canManage); setVersions(page.versions);
      setVersionTotal(page.total); setBeforeVersion(page.nextBeforeVersion); setReloadKey(null); setLocked(false); setDirty(false);
      setFeedback("草稿已保存並讀回；尚未簽署。");
      await read("assessments");
    } catch (error) {
      setFeedback("草稿已保存，最新紀錄暫時無法讀回。請重新讀取，避免重複新增。");
      throw error;
    } finally { setReading(false); }
  }
  const currentLatest = assessments.find((item) => item.assessmentKey === selectedKey) ??
    (versions[0]?.assessmentKey === selectedKey ? versions[0] : client.latest?.assessmentKey === selectedKey ? client.latest : null);
  const disabled = locked || reading;
  return <>
    <section className={styles.records} aria-label="已保存的評估">
      <div className={styles.recordsHeading}><h2>評估紀錄</h2>
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
      </> : <p>{canManage ? "尚無評估紀錄，請填寫下方量表保存本次評估。" : "尚無已保存評估；目前帳號僅能檢視量表。"}</p>}
      {switchIntent ? <div className={styles.switchNotice} role="region" aria-label="尚未保存的內容">
        <p>本次修改尚未保存。切換後，這些修改將不會保留。</p>
        <button className="button button--secondary" disabled={disabled} onClick={() => setSwitchIntent(null)} type="button">繼續填寫</button>
        <button className="button button--quiet" disabled={disabled} onClick={() => { if (disabled) return; const next = switchIntent; setSwitchIntent(null); setDirty(false); setEditorEpoch((current) => current + 1); next(); }} type="button">放棄修改並切換</button>
      </div> : null}
      {reading ? <p role="status">正在讀取評估紀錄…</p> : null}
      {readError ? <p role="alert">{readError} <button className="button button--quiet" disabled={disabled} onClick={() => retryRead.current?.()} type="button">重新讀取歷程</button></p> : null}
      {feedback ? <p role="status">{feedback}</p> : null}
      {reloadKey ? <button className="button button--secondary" disabled={reading} onClick={() => { void saved(reloadKey).catch(() => {}); }} type="button">重新讀取已保存紀錄</button> : null}
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
    <QuestionnaireEditor
      assessorName={assessorName} baseline={baseline} canManage={canManage} client={client} form={form}
      key={`${baseline?.versionId ?? "new"}-${readOnly ? "view" : "edit"}-${editorEpoch}`}
      onDirtyChange={setDirty} onLockChange={setLocked} onSaved={saved} readOnly={readOnly} reading={reading}
    />
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
}: {
  assessorName: string;
  canManage: boolean;
  form: QuestionnaireFormDefinition;
  loadError: boolean;
  pageTitle: string;
  selectedClientId: string | null;
  snapshot: QuestionnaireSnapshot | null;
}) {
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  if (loadError || !snapshot) return <section className="empty-card core-care-state" role="alert">
    <h1>{pageTitle}暫時無法載入</h1>
    <p>正式個案清單未能確認；沒有切換到展示資料或擴大查閱範圍。</p>
    <a className="button button--secondary" href="?">重新載入</a>
  </section>;

  const chosenClient = selectedClientId
    ? snapshot.clients.find((client) => client.clientId === selectedClientId) ?? null
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
  return <main className={styles.workspace}>
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
    </header>

    {snapshot.demo ? <div className="callout" role="status">
      展示用合成個案；不能寫入真實評估資料。
    </div> : null}

    <form action={formRef} className="client-selection-form" method="get" onSubmit={(event) => {
      if (navigationBlocked) event.preventDefault();
    }}>
      <ClientSelectionCard
        id="questionnaire-client"
        label="個案"
        defaultValue={selectedClientId ?? ""}
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
    {chosenClient ? <QuestionnaireRecords
      assessorName={assessorName}
      canManage={canManage}
      client={chosenClient}
      form={form}
      key={chosenClient.clientId}
      onNavigationBlockChange={setNavigationBlocked}
    /> : <div className={styles.empty}>
      {snapshot.clients.length ? "請先選一位個案，量表會直接在此展開。" : "目前沒有可指派給此帳號的有效個案。請確認個案指派與分支權限。"}
    </div>}
  </main>;
}
