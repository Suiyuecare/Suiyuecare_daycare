"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseGdsActionError,
  parseGdsActionSuccess,
  type GdsActionExpectation,
} from "@/lib/gds-assessments/parser";
import {
  GDS_ITEM_IDS,
  GDS_RULE_VERSION,
  type GdsAnswer,
  type GdsAnswers,
  type GdsAssessmentListItem,
  type GdsAssessmentSnapshot,
} from "@/lib/gds-assessments/types";

import styles from "./gds-assessments.module.css";

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function initialAnswers(item: GdsAssessmentListItem): GdsAnswers {
  if (item.answers) return structuredClone(item.answers);
  return Object.fromEntries(GDS_ITEM_IDS.map((id) => [
    id,
    { state: "missing" },
  ])) as unknown as GdsAnswers;
}

function controlValue(answer: GdsAnswer) {
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

function GdsDraftEditor({
  canManage,
  item,
  snapshot,
}: {
  canManage: boolean;
  item: GdsAssessmentListItem;
  snapshot: GdsAssessmentSnapshot;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<GdsAnswers>(() => initialAnswers(item));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const action = item.versionId === null ? "create_draft" : "revise_draft";

  if (!canManage) return null;

  function setAnswer(id: (typeof GDS_ITEM_IDS)[number], value: string) {
    setAnswers((current) => ({
      ...current,
      [id]: value === "yes" || value === "no"
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
      ruleVersionId: GDS_RULE_VERSION,
    };
    const expectation: GdsActionExpectation = action === "create_draft"
      ? { action, clientId: item.clientId }
      : {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    const response = await fetchWithTimeout("/api/gds-assessments", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        ...(action === "revise_draft"
          ? { "x-gds-operation": "revise_draft" } : {}),
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
      const parsed = parseGdsActionError(payload);
      if (parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parseGdsActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  return <details className={styles.actionDetails}>
    <summary>{action === "create_draft"
      ? "開始候選草稿" : "建立候選草稿新版"}</summary>
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
        <p className={styles.formReference}>
          候選規則快照：<code>{GDS_RULE_VERSION}</code>。規則尚未啟用，所有數值僅供試算覆核。
        </p>
        <fieldset className={`${styles.full} ${styles.questionSet}`}>
          <legend>十五個受治理答案欄位</legend>
          <p>此頁只顯示題位與是／否／缺值／不適用狀態，不重製尚未由機構發布的正式題文。</p>
          {GDS_ITEM_IDS.map((id, index) => {
            const answer = answers[id];
            return <div className={styles.questionRow} key={id}>
              <label>
                <span>題位 {String(index + 1).padStart(2, "0")}</span>
                <select
                  aria-label={`題位 ${index + 1} 答案狀態`}
                  onChange={(event) => setAnswer(id, event.currentTarget.value)}
                  value={controlValue(answer)}
                >
                  <option value="missing">缺值／未答</option>
                  <option value="yes">是</option>
                  <option value="no">否</option>
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
        <p className={styles.warning}>
          儲存的是不可變候選草稿，不是官方量表結果、診斷、正式風險分類或照顧決策。
        </p>
        <p className={styles.warning}>只保存候選草稿；正式題本與簽署尚未啟用。</p>
        <button className="button button--primary" type="submit">
          {pending ? "保存中…" : action === "create_draft"
            ? "保存候選草稿" : "保存為不可變新版"}
        </button>
      </fieldset>
      {message ? <p aria-live="polite" className={styles.formMessage}>{message}</p> : null}
    </form>
  </details>;
}

export function GdsAssessmentActions(props: {
  canManage: boolean;
  item: GdsAssessmentListItem;
  snapshot: GdsAssessmentSnapshot;
}) {
  if (props.snapshot.demo) {
    return <div className={styles.actions}>
      <button className="button button--quiet" disabled type="button">
        展示唯讀
      </button>
      <button className="button button--quiet" disabled type="button">
        正式簽署（規則未啟用）
      </button>
    </div>;
  }
  return <div className={styles.actions}>
    <GdsDraftEditor {...props} />
    <button className="button button--quiet" disabled type="button">
      正式簽署（規則未啟用）
    </button>
  </div>;
}
