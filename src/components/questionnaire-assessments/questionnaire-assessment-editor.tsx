"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { scoreAssessment } from "@/lib/assessments/engine";
import type { AssessmentAnswers } from "@/lib/assessments/types";
import type {
  QuestionnaireAnswers,
  QuestionnaireClient,
  QuestionnaireFormDefinition,
  QuestionnaireSnapshot,
} from "@/lib/questionnaire-assessments/types";

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
}: {
  assessorName: string;
  canManage: boolean;
  client: QuestionnaireClient;
  form: QuestionnaireFormDefinition;
}) {
  const router = useRouter();
  const latest = client.latest;
  const [answers, setAnswers] = useState(() => initialAnswers(form, latest));
  const [context, setContext] = useState(() => initialContext(form, latest));
  const [assessedOn, setAssessedOn] = useState(latest?.assessedOn ?? taipeiToday());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const missingCount = Object.values(answers).filter((answer) => answer.state === "missing").length;
  const suicideAnswer = form.key === "bsrs5" ? answers.bsrs_suicide : null;
  const suicideConcern = suicideAnswer?.state === "answered" && Number(suicideAnswer.value) > 0;
  const scoringContext: Record<string, string> = form.key === "spmsq" && context.education_adjustment
    ? { education_adjustment: context.education_adjustment }
    : {};
  const scorePreview = form.scoreVersionId ? scoreAssessment({
    versionId: form.scoreVersionId,
    answers: answers as AssessmentAnswers,
    context: scoringContext,
  }) : null;
  const height = Number(context.height_cm);
  const weight = Number(context.weight_kg);
  const bmi = height > 0 && weight > 0 ? weight / ((height / 100) ** 2) : null;

  function setResponse(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: { state: "answered", value } }));
    if (uncertain.current) {
      operationKey.current = null;
      uncertain.current = false;
    }
    setMessage("");
  }

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
    const response = await fetchWithTimeout(
      `/api/questionnaire-assessments?form_key=${form.key}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      },
    );
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error("回應內容無法確認，請保留表單並稍後重試。"); }
    if (!response.ok) {
      operationKey.current = null;
      uncertain.current = false;
      throw new Error(errorText(payload));
    }
    const data = (payload as { data?: unknown }).data as { recordState?: unknown } | null;
    if (!data || data.recordState !== "draft") throw new Error("無法確認草稿保存狀態，請保留內容並重新載入確認。");
    operationKey.current = null;
    uncertain.current = false;
  }

  return <form
    className={styles.formPanel}
    onChange={() => {
      if (uncertain.current) {
        operationKey.current = null;
        uncertain.current = false;
      }
    }}
    onSubmit={async (event) => {
      event.preventDefault();
      if (!canManage || pending) return;
      setPending(true);
      setMessage("");
      try {
        await save();
        setMessage("草稿已保存；重新載入最新版本中。尚未簽署，也未產生正式分數或臨床判讀。");
        router.refresh();
      } catch (error) {
        uncertain.current = operationKey.current !== null;
        setMessage(error instanceof Error ? error.message : "保存失敗，請保留內容後重試。");
      } finally {
        setPending(false);
      }
    }}
  >
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
      <span className={styles.draftBadge}>{latest ? `草稿 v${latest.version}` : "新草稿"}</span>
    </div>

    <div className={styles.meta}>
      <label>評估日期
        <input
          max={taipeiToday()}
          onChange={(event) => {
            setAssessedOn(event.currentTarget.value);
            setMessage("");
            if (uncertain.current) { operationKey.current = null; uncertain.current = false; }
          }}
          required
          type="date"
          value={assessedOn}
        />
      </label>
      <label>評估人員
        <span className={styles.assessor}>{assessorName}</span>
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
      <small>依固定版本 {scorePreview.versionId} 重算；篩檢分數不等於診斷、醫囑或自動處置。</small>
    </section> : null}

    <div className={styles.actions}>
      <span>已填 {form.questions.length - missingCount}／{form.questions.length} 題</span>
      <button className="button button--primary" disabled={!canManage || pending} type="submit">
        {pending ? "保存中…" : latest ? "保存為新版本" : "保存草稿"}
      </button>
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

    <form action={formRef} className={styles.selection} method="get">
      <label htmlFor="questionnaire-client">個案
        <select defaultValue={selectedClientId ?? ""} id="questionnaire-client" name="client" required>
          <option disabled value="">請選擇個案</option>
          {snapshot.clients.map((client) => <option key={client.clientId} value={client.clientId}>
            {client.displayName}{client.serviceStatus === "suspended" ? "・暫停服務" : ""}
          </option>)}
        </select>
      </label>
      <button className="button button--secondary" type="submit">選取個案</button>
    </form>

    {chosenClient ? <QuestionnaireEditor
      assessorName={assessorName}
      canManage={canManage}
      client={chosenClient}
      form={form}
      key={`${chosenClient.clientId}-${chosenClient.latest?.versionId ?? "new"}`}
    /> : <div className={styles.empty}>
      {snapshot.clients.length ? "請先選一位個案，量表會直接在此展開。" : "目前沒有可指派給此帳號的有效個案。請確認個案指派與分支權限。"}
    </div>}
  </main>;
}
