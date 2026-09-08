"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseChewingActionError,
  parseChewingActionSuccess,
  type ChewingActionExpectation,
} from "@/lib/chewing-assessments/parser";
import {
  CHEWING_ITEM_IDS,
  CHEWING_OBSERVATION_LABELS,
  CHEWING_RULE_VERSION,
  type ChewingAnswer,
  type ChewingAnswers,
  type ChewingAssessmentListItem,
  type ChewingAssessmentSnapshot,
} from "@/lib/chewing-assessments/types";

import styles from "./chewing-assessments.module.css";

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function initialAnswers(item: ChewingAssessmentListItem): ChewingAnswers {
  if (item.answers) return structuredClone(item.answers);
  return Object.fromEntries(CHEWING_ITEM_IDS.map((id) => [
    id,
    { state: "missing" },
  ])) as unknown as ChewingAnswers;
}

function controlValue(answer: ChewingAnswer) {
  return answer.state === "answered" ? answer.value : answer.state;
}

function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.startsWith("API:")) {
    return error.message.slice(4);
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，結果未知；內容未修改時請使用同一冪等鍵重試。";
  }
  return "操作結果未知；請保留內容，未修改時可使用同一冪等鍵重試。";
}

function ChewingDraftEditor({
  canManage,
  hasRecentAal2,
  item,
  snapshot,
}: {
  canManage: boolean;
  hasRecentAal2: boolean;
  item: ChewingAssessmentListItem;
  snapshot: ChewingAssessmentSnapshot;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<ChewingAnswers>(() => initialAnswers(item));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const action = item.versionId === null ? "create_draft" : "revise_draft";

  if (!canManage) return null;

  function setAnswer(id: (typeof CHEWING_ITEM_IDS)[number], value: string) {
    setAnswers((current) => ({
      ...current,
      [id]: value === "present" || value === "absent"
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
      ruleVersionId: CHEWING_RULE_VERSION,
    };
    const expectation: ChewingActionExpectation = action === "create_draft"
      ? { action, clientId: item.clientId }
      : {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    const response = await fetchWithTimeout("/api/chewing-assessments", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        ...(action === "revise_draft"
          ? { "x-chewing-operation": "revise_draft" } : {}),
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
      const parsed = parseChewingActionError(payload);
      if (parsed) {
        if (response.status >= 400 && response.status < 500) {
          operationKey.current = null;
          uncertain.current = false;
        }
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parseChewingActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  return <details className={styles.actionDetails}>
    <summary>{action === "create_draft"
      ? "開始人工觀察草稿" : "建立人工觀察草稿新版"}</summary>
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
          setMessage("人工咀嚼觀察草稿已確認保存；最新版本正在重新載入。");
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
          <span>觀察日期</span>
          <input
            defaultValue={item.assessedOn ?? taipeiDate(snapshot.generatedAt)}
            max={taipeiDate(snapshot.generatedAt)}
            name="assessedOn"
            required
            type="date"
          />
        </label>
        <p className={styles.formReference}>
          人工未標準化候選欄位快照：<code>{CHEWING_RULE_VERSION}</code>。正式咀嚼評估工具、題目文字、授權來源、權重與能力分級皆未配置；這不是正式咀嚼評估工具。
        </p>
        <fieldset className={`${styles.full} ${styles.questionSet}`}>
          <legend>六項人工咀嚼觀察</legend>
          <p>欄位名稱與完整性規則固定在本版快照；任一缺值或不適用都不產生「已出現」項目數。項目數不是分數，也沒有能力分級或診斷意義。</p>
          {CHEWING_ITEM_IDS.map((id) => {
            const answer = answers[id];
            return <div className={styles.questionRow} key={id}>
              <label>
                <span>{CHEWING_OBSERVATION_LABELS[id]}</span>
                <select
                  aria-label={`${CHEWING_OBSERVATION_LABELS[id]}答案狀態`}
                  onChange={(event) => setAnswer(id, event.currentTarget.value)}
                  value={controlValue(answer)}
                >
                  <option value="missing">缺值／未確認</option>
                  <option value="present">已出現</option>
                  <option value="absent">未出現</option>
                  <option value="not_applicable">不適用</option>
                </select>
              </label>
              {answer.state === "not_applicable" ? <label>
                <span>{CHEWING_OBSERVATION_LABELS[id]}不適用理由</span>
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
        <p className={styles.warning}>
          只保存不可變人工觀察草稿，不是正式分數、能力分級、診斷或照顧決策；系統不會自動建立或通知營養或吞嚥轉介。
        </p>
        {!hasRecentAal2 ? <p className={styles.warning} role="alert">
          最近 15 分鐘內未完成 AAL2；API 會在讀取內容前拒絕寫入。
        </p> : null}
        <button className="button button--primary" disabled={!hasRecentAal2}
          type="submit">
          {pending ? "保存中…" : action === "create_draft"
            ? "保存人工觀察草稿" : "保存為不可變新版"}
        </button>
      </fieldset>
      {message ? <p aria-live="polite" className={styles.formMessage}>{message}</p> : null}
    </form>
  </details>;
}

export function ChewingAssessmentActions(props: {
  canManage: boolean;
  hasRecentAal2: boolean;
  item: ChewingAssessmentListItem;
  snapshot: ChewingAssessmentSnapshot;
}) {
  if (props.snapshot.demo) {
    return <div className={styles.actions}>
      <button className="button button--quiet" disabled type="button">
        展示唯讀
      </button>
      <button className="button button--quiet" disabled type="button">
        正式簽署（正式工具未發布）
      </button>
      <button className="button button--quiet" disabled type="button">
        正式更正（尚無已簽紀錄）
      </button>
    </div>;
  }
  return <div className={styles.actions}>
    <ChewingDraftEditor {...props} />
    <button className="button button--quiet" disabled type="button">
      正式簽署（正式工具未發布）
    </button>
    <button className="button button--quiet" disabled type="button">
      正式更正（尚無已簽紀錄）
    </button>
  </div>;
}
