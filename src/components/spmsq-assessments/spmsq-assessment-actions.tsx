"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseSpmsqActionError,
  parseSpmsqActionSuccess,
  type SpmsqActionExpectation,
} from "@/lib/spmsq-assessments/parser";
import {
  SPMSQ_ITEM_IDS,
  SPMSQ_RULE_VERSION,
  type EducationValue,
  type SpmsqAnswer,
  type SpmsqAnswers,
  type SpmsqAssessmentListItem,
  type SpmsqAssessmentSnapshot,
  type SpmsqCulturalContext,
  type SpmsqEducationContext,
} from "@/lib/spmsq-assessments/types";

import styles from "./spmsq-assessments.module.css";

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function initialAnswers(item: SpmsqAssessmentListItem): SpmsqAnswers {
  if (item.answers) return structuredClone(item.answers);
  return Object.fromEntries(SPMSQ_ITEM_IDS.map((id) => [
    id,
    { state: "missing" },
  ])) as unknown as SpmsqAnswers;
}

function answerControlValue(answer: SpmsqAnswer) {
  return answer.state === "answered" ? answer.value : answer.state;
}

function educationControlValue(context: SpmsqEducationContext | null) {
  if (!context) return "missing";
  return context.state === "answered" ? context.value : context.state;
}

type EducationControlValue = ReturnType<typeof educationControlValue>;

function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.startsWith("API:")) {
    return error.message.slice(4);
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，結果未知；請保留內容，未修改時使用同一冪等鍵重試。";
  }
  return "操作結果未知；請先保留內容，未修改時可使用同一冪等鍵重試。";
}

function readEducationContext(data: FormData): SpmsqEducationContext {
  const value = String(data.get("educationState"));
  if (value === "missing") return { state: "missing" };
  if (value === "not_applicable") {
    return {
      state: "not_applicable",
      reason: String(data.get("educationReason") ?? "").trim(),
    };
  }
  return { state: "answered", value: value as EducationValue };
}

function readCulturalContext(data: FormData): SpmsqCulturalContext {
  const state = String(data.get("culturalState"));
  if (state === "missing") return { state: "missing" };
  if (state === "not_applicable") {
    return {
      state: "not_applicable",
      reason: String(data.get("culturalReason") ?? "").trim(),
    };
  }
  return {
    state: "recorded",
    note: String(data.get("culturalNote") ?? "").trim(),
  };
}

function SpmsqDraftEditor({
  canManage,
  item,
  snapshot,
}: {
  canManage: boolean;
  item: SpmsqAssessmentListItem;
  snapshot: SpmsqAssessmentSnapshot;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<SpmsqAnswers>(() =>
    initialAnswers(item));
  const [educationState, setEducationState] = useState(() =>
    educationControlValue(item.educationContext));
  const [culturalState, setCulturalState] = useState(
    item.culturalContext?.state ?? "missing",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const action = item.versionId === null ? "create_draft" : "revise_draft";

  if (!canManage) return null;

  function setAnswer(id: (typeof SPMSQ_ITEM_IDS)[number], value: string) {
    setAnswers((current) => ({
      ...current,
      [id]: value === "correct" || value === "incorrect"
        ? { state: "answered", value }
        : value === "not_applicable"
          ? { state: "not_applicable", reason: "" }
          : { state: "missing" },
    }));
  }

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const key = operationKey.current ?? crypto.randomUUID();
    operationKey.current = key;
    const body = {
      action,
      clientId: item.clientId,
      ...(action === "revise_draft" ? {
        assessmentKey: item.assessmentKey,
        previousVersionId: item.versionId,
        expectedVersion: item.assessmentVersion,
      } : {}),
      assessedOn: data.get("assessedOn"),
      answers,
      educationContext: readEducationContext(data),
      culturalContext: readCulturalContext(data),
      ruleVersionId: SPMSQ_RULE_VERSION,
    };
    const expectation: SpmsqActionExpectation = action === "create_draft"
      ? { action, clientId: item.clientId }
      : {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    const response = await fetchWithTimeout("/api/spmsq-assessments", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("INVALID_RESPONSE");
    }
    if (!response.ok) {
      const parsed = parseSpmsqActionError(payload);
      if (parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parseSpmsqActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  return <details className={styles.actionDetails}>
    <summary>{action === "create_draft" ? "開始候選草稿" : "建立候選草稿新版"}</summary>
    <form
      data-client-id={item.clientId}
      onChange={() => {
        if (uncertain.current) {
          operationKey.current = null;
          uncertain.current = false;
          setMessage(null);
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        try {
          await submit(event.currentTarget);
          setMessage("候選草稿已確認保存；最新版本正在重新載入。");
          router.refresh();
        } catch (error) {
          uncertain.current = operationKey.current !== null;
          setMessage(failureMessage(error));
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className={styles.actionGrid} disabled={pending}>
        <p className={styles.fixedClient}>
          <strong>已鎖定個案：{item.clientDisplayName}</strong>
          <small>使用本列精確個案 ID；不依姓名模糊比對。</small>
        </p>
        <label>
          <span>評估日期</span>
          <input
            defaultValue={item.assessedOn ?? taipeiDate(snapshot.generatedAt)}
            max={taipeiDate(snapshot.generatedAt)}
            name="assessedOn"
            required
            type="date"
          />
        </label>
        <label>
          <span>教育程度調整脈絡</span>
          <select
            name="educationState"
            onChange={(event) => setEducationState(
              event.currentTarget.value as EducationControlValue,
            )}
            value={educationState}
          >
            <option value="missing">缺值／尚未確認</option>
            <option value="grade_school_or_less">小學或以下（候選 -1）</option>
            <option value="middle_or_high_school">國高中（候選不調整）</option>
            <option value="beyond_high_school">高中以上（候選 +1）</option>
            <option value="not_applicable">不適用</option>
          </select>
        </label>
        {educationState === "not_applicable" ? <label className={styles.full}>
          <span>教育脈絡不適用理由</span>
          <textarea
            defaultValue={item.educationContext?.state === "not_applicable"
              ? item.educationContext.reason : ""}
            maxLength={500}
            name="educationReason"
            required
          />
        </label> : null}

        <fieldset className={`${styles.full} ${styles.questionSet}`}>
          <legend>十個受治理答案欄位</legend>
          <p>此版本只保存題位與對／錯／缺值／不適用狀態，不在此頁重製未核准的量表題文。</p>
          {SPMSQ_ITEM_IDS.map((id, index) => {
            const answer = answers[id];
            return <div className={styles.questionRow} key={id}>
              <label>
                <span>題位 {String(index + 1).padStart(2, "0")}</span>
                <select
                  aria-label={`題位 ${index + 1} 答案狀態`}
                  onChange={(event) => setAnswer(id, event.currentTarget.value)}
                  value={answerControlValue(answer)}
                >
                  <option value="missing">缺值／未答</option>
                  <option value="correct">正確</option>
                  <option value="incorrect">錯誤</option>
                  <option value="not_applicable">不適用</option>
                </select>
              </label>
              {answer.state === "not_applicable" ? <label>
                <span>題位 {index + 1} 不適用理由</span>
                <input
                  maxLength={500}
                  onChange={(event) => {
                    const reason = event.currentTarget.value;
                    setAnswers((current) => ({
                      ...current,
                      [id]: { state: "not_applicable", reason },
                    }));
                  }}
                  required
                  value={answer.reason}
                />
              </label> : null}
            </div>;
          })}
        </fieldset>

        <label>
          <span>文化／語言脈絡狀態</span>
          <select
            name="culturalState"
            onChange={(event) => setCulturalState(
              event.currentTarget.value as SpmsqCulturalContext["state"],
            )}
            value={culturalState}
          >
            <option value="missing">缺值／尚未記錄</option>
            <option value="recorded">已記錄脈絡</option>
            <option value="not_applicable">不適用</option>
          </select>
        </label>
        {culturalState === "recorded" ? <label className={styles.full}>
          <span>文化／語言脈絡說明</span>
          <textarea
            defaultValue={item.culturalContext?.state === "recorded"
              ? item.culturalContext.note : ""}
            maxLength={2000}
            name="culturalNote"
            required
          />
          <small>此欄只保存脈絡，不會改變候選試算數值。</small>
        </label> : culturalState === "not_applicable" ? <label className={styles.full}>
          <span>文化／語言脈絡不適用理由</span>
          <textarea
            defaultValue={item.culturalContext?.state === "not_applicable"
              ? item.culturalContext.reason : ""}
            maxLength={500}
            name="culturalReason"
            required
          />
        </label> : null}

        <p className={styles.formReference}>
          候選規則快照：<code>{SPMSQ_RULE_VERSION}</code>。尚未正式 activated，試算不可簽署、不可視為官方結果，也不可驅動照顧決策。
        </p>
        <p className={styles.warning}>
          只保存候選草稿；正式題本與簽署尚未啟用。
        </p>
        <button
          className="button button--primary"
          disabled={pending}
          type="submit"
        >{pending ? "確認中…" : action === "create_draft"
          ? "儲存候選草稿" : "建立候選草稿新版"}</button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function SpmsqAssessmentActions({
  canManage,
  item,
  snapshot,
}: {
  canManage: boolean;
  item: SpmsqAssessmentListItem;
  snapshot: SpmsqAssessmentSnapshot;
}) {
  if (snapshot.demo) {
    return <button className="button button--secondary" disabled type="button">
      正式操作（展示唯讀）
    </button>;
  }
  return <div className={styles.actions}>
    <SpmsqDraftEditor
      canManage={canManage}
      item={item}
      snapshot={snapshot}
    />
    {item.versionId ? <button
      className="button button--secondary"
      disabled
      title="候選規則尚未正式核准生效"
      type="button"
    >正式簽署未開放</button> : null}
  </div>;
}

export function SpmsqAssessmentFreshness({
  demo,
  staleAfter,
}: {
  demo: boolean;
  staleAfter: string;
}) {
  const [observedAt, setObservedAt] = useState(() => Date.now());
  useEffect(() => {
    if (demo) return;
    const timer = window.setTimeout(
      () => setObservedAt(Date.now()),
      Math.max(0, new Date(staleAfter).getTime() - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [demo, staleAfter]);
  if (demo) return <span>合成展示快照</span>;
  return observedAt >= new Date(staleAfter).getTime()
    ? <span className={styles.stale} role="status">資料已過期，請重新載入</span>
    : <span>資料為目前快照</span>;
}
