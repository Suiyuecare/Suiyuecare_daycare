"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseNsiNutritionActionError,
  parseNsiNutritionActionSuccess,
  type NsiNutritionActionExpectation,
} from "@/lib/nsi-nutrition-screenings/parser";
import {
  NSI_NUTRITION_ITEM_IDS,
  NSI_NUTRITION_OBSERVATION_LABELS,
  NSI_NUTRITION_RULE_VERSION,
  type NsiNutritionAnswer,
  type NsiNutritionAnswers,
  type NsiNutritionScreeningListItem,
  type NsiNutritionScreeningSnapshot,
} from "@/lib/nsi-nutrition-screenings/types";

import styles from "./nsi-nutrition-screenings.module.css";

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function initialAnswers(item: NsiNutritionScreeningListItem): NsiNutritionAnswers {
  if (item.answers) return structuredClone(item.answers);
  return Object.fromEntries(NSI_NUTRITION_ITEM_IDS.map((id) => [
    id,
    { state: "missing" },
  ])) as unknown as NsiNutritionAnswers;
}

function controlValue(answer: NsiNutritionAnswer) {
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

function NsiNutritionDraftEditor({
  canManage,
  item,
  snapshot,
}: {
  canManage: boolean;
  item: NsiNutritionScreeningListItem;
  snapshot: NsiNutritionScreeningSnapshot;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<NsiNutritionAnswers>(() => initialAnswers(item));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const action = item.versionId === null ? "create_draft" : "revise_draft";

  if (!canManage) return null;

  function setAnswer(id: (typeof NSI_NUTRITION_ITEM_IDS)[number], value: string) {
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
      ruleVersionId: NSI_NUTRITION_RULE_VERSION,
    };
    const expectation: NsiNutritionActionExpectation = action === "create_draft"
      ? { action, clientId: item.clientId }
      : {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    const response = await fetchWithTimeout("/api/nsi-nutrition-screenings", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        ...(action === "revise_draft"
          ? { "x-nsi-nutrition-operation": "revise_draft" } : {}),
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
      const parsed = parseNsiNutritionActionError(payload);
      if (parsed) {
        if (response.status >= 400 && response.status < 500) {
          operationKey.current = null;
          uncertain.current = false;
        }
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parseNsiNutritionActionSuccess(payload, expectation, response.status);
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
          setMessage("人工營養觀察草稿已確認保存；最新版本正在重新載入。");
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
          人工未標準化候選欄位快照：<code>{NSI_NUTRITION_RULE_VERSION}</code>。正式 NSI 題本、題目文字、授權來源、權重與風險分類皆未配置；這不是正式 NSI。
        </p>
        <fieldset className={`${styles.full} ${styles.questionSet}`}>
          <legend>六項人工營養觀察</legend>
          <p>欄位名稱與完整性規則固定在本版快照；任一缺值或不適用都不產生「已出現」項目數。項目數不是分數，也沒有風險意義。</p>
          {NSI_NUTRITION_ITEM_IDS.map((id) => {
            const answer = answers[id];
            return <div className={styles.questionRow} key={id}>
              <label>
                <span>{NSI_NUTRITION_OBSERVATION_LABELS[id]}</span>
                <select
                  aria-label={`${NSI_NUTRITION_OBSERVATION_LABELS[id]}答案狀態`}
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
                <span>{NSI_NUTRITION_OBSERVATION_LABELS[id]}不適用理由</span>
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
          只保存不可變人工觀察草稿，不是正式 NSI、分數、風險分類、診斷或照顧決策；系統不會自動建立營養追蹤、轉介或通知。
        </p>
        <p className={styles.warning}>只保存人工候選草稿；正式題本與簽署尚未啟用。</p>
        <button className="button button--primary" type="submit">
          {pending ? "保存中…" : action === "create_draft"
            ? "保存人工觀察草稿" : "保存為不可變新版"}
        </button>
      </fieldset>
      {message ? <p aria-live="polite" className={styles.formMessage}>{message}</p> : null}
    </form>
  </details>;
}

export function NsiNutritionScreeningActions(props: {
  canManage: boolean;
  item: NsiNutritionScreeningListItem;
  snapshot: NsiNutritionScreeningSnapshot;
}) {
  if (props.snapshot.demo) {
    return <div className={styles.actions}>
      <button className="button button--quiet" disabled type="button">
        展示唯讀
      </button>
      <button className="button button--quiet" disabled type="button">
        正式簽署（正式題本未發布）
      </button>
    </div>;
  }
  return <div className={styles.actions}>
    <NsiNutritionDraftEditor {...props} />
    <button className="button button--quiet" disabled type="button">
      正式簽署（正式題本未發布）
    </button>
  </div>;
}
