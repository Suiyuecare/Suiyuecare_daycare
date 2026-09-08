"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parsePsychosocialActionError,
  parsePsychosocialActionSuccess,
  type PsychosocialActionExpectation,
} from "@/lib/psychosocial-assessments/parser";
import type {
  PsychosocialAssessmentListItem,
  PsychosocialAssessmentSnapshot,
  PsychosocialDimensions,
  PsychosocialDomainKey,
  PsychosocialDomainState,
} from "@/lib/psychosocial-assessments/types";

import styles from "./psychosocial-assessments.module.css";

type ActionKind = "create_draft" | "revise_draft" | "sign" | "correct";

const actionLabels: Record<ActionKind, string> = {
  create_draft: "快速新增評估草稿",
  revise_draft: "建立草稿新版",
  sign: "簽署評估",
  correct: "建立更正版",
};

const domainLabels: Record<PsychosocialDomainKey, string> = {
  family_relationships: "家庭／關係人互動",
  social_support: "社會支持",
  social_participation: "社交／活動參與",
  communication_context: "溝通情境與偏好",
  resource_access: "資源取得情形",
};

const domainKeys = Object.keys(domainLabels) as PsychosocialDomainKey[];

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.startsWith("API:")) {
    return error.message.slice(4);
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，結果未知；請保留內容，未修改時使用同一操作鍵重試。";
  }
  return "操作結果未知；請先重新載入，未修改內容時可使用同一操作鍵重試。";
}

function defaultDimensions(
  value: PsychosocialDimensions | null,
): PsychosocialDimensions {
  if (value) return value;
  return {
    family_relationships: { state: "missing", detail: null },
    social_support: { state: "missing", detail: null },
    social_participation: { state: "missing", detail: null },
    communication_context: { state: "missing", detail: null },
    resource_access: { state: "missing", detail: null },
  };
}

function readDimensions(data: FormData): PsychosocialDimensions {
  return Object.fromEntries(domainKeys.map((key) => {
    const state = String(data.get(`${key}.state`)) as PsychosocialDomainState;
    const detail = String(data.get(`${key}.detail`) ?? "").trim();
    return [key, { state, detail: state === "provided" ? detail : null }];
  })) as PsychosocialDimensions;
}

function DomainInput({
  domainKey,
  value,
}: {
  domainKey: PsychosocialDomainKey;
  value: PsychosocialDimensions[PsychosocialDomainKey];
}) {
  const [state, setState] = useState(value.state);
  return <fieldset className={styles.domainFieldset}>
    <legend>{domainLabels[domainKey]}</legend>
    <label>
      <span>紀錄狀態</span>
      <select
        defaultValue={value.state}
        name={`${domainKey}.state`}
        onChange={(event) =>
          setState(event.currentTarget.value as PsychosocialDomainState)}
        required
      >
        <option value="provided">已記錄</option>
        <option value="missing">未知／尚未取得</option>
        <option value="not_applicable">不適用</option>
      </select>
    </label>
    {state === "provided" ? <label>
      <span>人工敘事</span>
      <textarea
        defaultValue={value.detail ?? ""}
        maxLength={2000}
        name={`${domainKey}.detail`}
        required
      />
    </label> : <p className={styles.domainHint}>
      已明確標示為{state === "missing" ? "未知／尚未取得" : "不適用"}；系統不會把它當成空白或 0 分。
    </p>}
  </fieldset>;
}

function AssessmentActionForm({
  action,
  canManage,
  canSign,
  hasRecentAal2,
  item,
  snapshot,
}: {
  action: ActionKind;
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  item: PsychosocialAssessmentListItem;
  snapshot: PsychosocialAssessmentSnapshot;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signing = action === "sign" || action === "correct";
  const allowed = signing ? canSign : canManage;
  if (!allowed) return null;

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const key = operationKey.current ?? crypto.randomUUID();
    operationKey.current = key;
    const common = item.versionId && item.assessmentKey && item.assessmentVersion
      ? {
        clientId: item.clientId,
        assessmentKey: item.assessmentKey,
        previousVersionId: item.versionId,
        expectedVersion: item.assessmentVersion,
      }
      : null;
    let body: Record<string, unknown>;
    let expectation: PsychosocialActionExpectation;
    if (action === "create_draft") {
      body = {
        action,
        clientId: item.clientId,
        assessedOn: data.get("assessedOn"),
        reassessmentDueOn: data.get("reassessmentDueOn"),
        dueBasis: data.get("dueBasis"),
        dimensions: readDimensions(data),
        assessmentSummary: data.get("assessmentSummary"),
        formVersionReference: "manual-psychosocial-v1",
      };
      expectation = { action, clientId: item.clientId };
    } else if (action === "revise_draft" || action === "correct") {
      body = {
        action,
        ...common,
        assessedOn: data.get("assessedOn"),
        reassessmentDueOn: data.get("reassessmentDueOn"),
        dueBasis: data.get("dueBasis"),
        dimensions: readDimensions(data),
        assessmentSummary: data.get("assessmentSummary"),
        formVersionReference: "manual-psychosocial-v1",
        ...(action === "correct"
          ? { correctionReason: data.get("correctionReason") }
          : {}),
      };
      expectation = {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    } else {
      body = { action, ...common };
      expectation = {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    }

    const response = await fetchWithTimeout("/api/psychosocial-assessments", {
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
      const parsed = parsePsychosocialActionError(payload);
      if (parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parsePsychosocialActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  const editable = action !== "sign";
  const initialDimensions = defaultDimensions(item.dimensions);
  return <details className={styles.actionDetails}>
    <summary>{actionLabels[action]}</summary>
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
        const form = event.currentTarget;
        try {
          await submit(form);
          setMessage(`${actionLabels[action]}已確認完成；最新狀態正在重新載入。`);
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
        <input name="clientId" type="hidden" value={item.clientId} />
        {action === "create_draft" ? <p className={styles.fixedClient}>
          <strong>已鎖定個案：{item.clientDisplayName}</strong>
          <small>以本列精確個案識別碼建立，不依姓名猜測或模糊比對。</small>
        </p> : null}
        {editable ? <>
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
            <span>人工輸入複評期限</span>
            <input
              defaultValue={item.reassessmentDueOn ?? ""}
              name="reassessmentDueOn"
              required
              type="date"
            />
          </label>
          <label className={styles.full}>
            <span>期限來源／依據</span>
            <textarea
              defaultValue={item.dueBasis ?? ""}
              maxLength={1000}
              name="dueBasis"
              required
            />
          </label>
          <div className={styles.domainGrid}>
            {domainKeys.map((domainKey) => <DomainInput
              domainKey={domainKey}
              key={domainKey}
              value={initialDimensions[domainKey]}
            />)}
          </div>
          <label className={styles.full}>
            <span>人工評估摘要</span>
            <textarea
              defaultValue={item.assessmentSummary ?? ""}
              maxLength={5000}
              name="assessmentSummary"
              required
            />
          </label>
          <p className={styles.formReference}>
            表單參照：<code>manual-psychosocial-v1</code>（人工、非標準化；不計分、不診斷）
          </p>
        </> : null}
        {action === "correct" ? <label className={styles.full}>
          <span>更正理由</span>
          <textarea maxLength={1000} name="correctionReason" required />
        </label> : null}
        {signing && !hasRecentAal2 ? <p className={styles.warning} role="alert">
          簽署或更正前，請先在最近 15 分鐘內重新完成雙因素驗證。
        </p> : null}
        {action === "sign" ? <p className={styles.full}>
          將簽署目前 v{item.assessmentVersion} 草稿；簽署後只能追加有理由且連回原版的更正版。
        </p> : null}
        <button
          className="button button--primary"
          disabled={pending || signing && !hasRecentAal2}
          type="submit"
        >
          {pending ? "確認中…" : actionLabels[action]}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function PsychosocialAssessmentActions({
  canManage,
  canSign,
  hasRecentAal2,
  item,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  item: PsychosocialAssessmentListItem;
  snapshot: PsychosocialAssessmentSnapshot;
}) {
  if (snapshot.demo) {
    return <button className="button button--secondary" disabled type="button">
      正式操作（展示唯讀）
    </button>;
  }
  return <div className={styles.actions}>
    <AssessmentActionForm
      action="create_draft"
      canManage={canManage}
      canSign={canSign}
      hasRecentAal2={hasRecentAal2}
      item={item}
      snapshot={snapshot}
    />
    {item.recordState === "draft" ? <>
      <AssessmentActionForm
        action="revise_draft"
        canManage={canManage}
        canSign={canSign}
        hasRecentAal2={hasRecentAal2}
        item={item}
        snapshot={snapshot}
      />
      <AssessmentActionForm
        action="sign"
        canManage={canManage}
        canSign={canSign}
        hasRecentAal2={hasRecentAal2}
        item={item}
        snapshot={snapshot}
      />
    </> : item.recordState === "signed" || item.recordState === "corrected"
      ? <AssessmentActionForm
        action="correct"
        canManage={canManage}
        canSign={canSign}
        hasRecentAal2={hasRecentAal2}
        item={item}
        snapshot={snapshot}
      />
      : null}
  </div>;
}

export function PsychosocialAssessmentFreshness({
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
