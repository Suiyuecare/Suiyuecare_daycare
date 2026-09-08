"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  parseAdaptationActionError,
  parseAdaptationActionSuccess,
  type AdaptationActionExpectation,
} from "@/lib/adaptation-assessments/parser";
import type {
  AdaptationAssessmentListItem,
  AdaptationAssessmentSnapshot,
} from "@/lib/adaptation-assessments/types";
import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";

import styles from "./adaptation-assessments.module.css";

type ActionKind =
  | "create_draft"
  | "revise_draft"
  | "sign"
  | "correct"
  | "track"
  | "complete_follow_up"
  | "cancel_follow_up";

const labels: Record<ActionKind, string> = {
  create_draft: "快速新增評估草稿",
  revise_draft: "建立草稿新版",
  sign: "簽署評估",
  correct: "建立更正版",
  track: "建立追蹤",
  complete_follow_up: "完成追蹤",
  cancel_follow_up: "取消追蹤",
};

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.startsWith("API:")) {
    return error.message.slice(4);
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，操作結果未知；請保留內容，未修改時使用同一操作鍵重試。";
  }
  return "操作結果未知；請先重新載入，未修改內容時可使用同一操作鍵重試。";
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
  item: AdaptationAssessmentListItem;
  snapshot: AdaptationAssessmentSnapshot;
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
      } : null;
    let body: Record<string, unknown>;
    let expectation: AdaptationActionExpectation;
    if (action === "create_draft") {
      body = {
        action,
        clientId: item.clientId,
        assessedOn: data.get("assessedOn"),
        adaptationStatus: data.get("adaptationStatus"),
        assessmentSummary: data.get("assessmentSummary"),
        reassessmentDueOn: data.get("reassessmentDueOn"),
        needsFollowUp: data.get("needsFollowUp") === "on",
        formVersionReference: "manual-adaptation-v1",
      };
      expectation = { action, clientId: item.clientId };
    } else if (action === "revise_draft" || action === "correct") {
      body = {
        action,
        ...common,
        assessedOn: data.get("assessedOn"),
        adaptationStatus: data.get("adaptationStatus"),
        assessmentSummary: data.get("assessmentSummary"),
        reassessmentDueOn: data.get("reassessmentDueOn"),
        needsFollowUp: data.get("needsFollowUp") === "on",
        formVersionReference: "manual-adaptation-v1",
        ...(action === "correct"
          ? { correctionReason: data.get("correctionReason") } : {}),
      };
      expectation = {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    } else if (action === "sign") {
      body = { action, ...common };
      expectation = {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedVersion: item.assessmentVersion!,
      };
    } else {
      body = {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey,
        assessmentVersionId: item.versionId,
        expectedSequence: item.followUpSequence,
        ...(action === "track" ? {
          dueOn: data.get("dueOn"), followUpPlan: data.get("followUpPlan"),
        } : action === "complete_follow_up" ? {
          followUpOutcome: data.get("followUpOutcome"),
        } : { transitionReason: data.get("transitionReason") }),
      };
      expectation = {
        action,
        clientId: item.clientId,
        assessmentKey: item.assessmentKey!,
        expectedFollowUpSequence: item.followUpSequence,
      };
    }

    const response = await fetchWithTimeout("/api/adaptation-assessments", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("INVALID_RESPONSE");
    }
    if (!response.ok) {
      const parsed = parseAdaptationActionError(payload);
      if (parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parseAdaptationActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  const editable = action === "create_draft" || action === "revise_draft" ||
    action === "correct";
  return <details className={styles.actionDetails}>
    <summary>{labels[action]}</summary>
    <form data-client-id={item.clientId} onChange={() => {
      if (uncertain.current) {
        operationKey.current = null;
        uncertain.current = false;
        setMessage(null);
      }
    }} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      const form = event.currentTarget;
      try {
        await submit(form);
        setMessage(`${labels[action]}已確認完成；最新狀態正在重新載入。`);
        if (action === "create_draft") form.reset();
        router.refresh();
      } catch (error) {
        uncertain.current = operationKey.current !== null;
        setMessage(failureMessage(error));
      } finally {
        setPending(false);
      }
    }}>
      <fieldset className={styles.actionGrid} disabled={pending}>
        <input name="clientId" type="hidden" value={item.clientId} />
        {action === "create_draft" ? <p className={styles.fixedClient}>
          <strong>已鎖定個案：</strong>{item.clientDisplayName}
          <small>系統以這一列的精確個案識別碼建立草稿，不使用姓名猜測或模糊比對。</small>
        </p> : null}
        {editable ? <>
          <label><span>評估日期</span><input
            defaultValue={item.assessedOn ?? taipeiDate(snapshot.generatedAt)}
            max={taipeiDate(snapshot.generatedAt)} name="assessedOn" required
            type="date" /></label>
          <label><span>人工適應狀態</span><select
            defaultValue={item.adaptationStatus ?? ""} name="adaptationStatus"
            required>
            <option value="">請人工選擇</option>
            <option value="settled">已適應</option>
            <option value="adjusting">適應中</option>
            <option value="support_requested">需要支持</option>
          </select></label>
          <label className={styles.full}><span>人工評估摘要</span><textarea
            defaultValue={item.assessmentSummary ?? ""} maxLength={5000}
            name="assessmentSummary" required /></label>
          <label><span>人工輸入複評期限</span><input
            defaultValue={item.reassessmentDueOn ?? ""} min={item.assessedOn ?? undefined}
            name="reassessmentDueOn" required type="date" /></label>
          <label className={styles.check}><input
            defaultChecked={item.needsFollowUp} name="needsFollowUp" type="checkbox" />
            <span>此人工評估需要後續追蹤</span></label>
          <p className={styles.formReference}>
            表單參照：<code>manual-adaptation-v1</code>（非官方／非標準量表）
          </p>
        </> : null}
        {action === "correct" ? <label className={styles.full}>
          <span>更正理由</span><textarea maxLength={1000}
            name="correctionReason" required /></label> : null}
        {action === "track" ? <>
          <label><span>追蹤期限</span><input name="dueOn" required type="date" /></label>
          <label className={styles.full}><span>追蹤計畫</span><textarea
            maxLength={2000} name="followUpPlan" required /></label>
        </> : null}
        {action === "complete_follow_up" ? <label className={styles.full}>
          <span>追蹤結果</span><textarea maxLength={2000}
            name="followUpOutcome" required /></label> : null}
        {action === "cancel_follow_up" ? <label className={styles.full}>
          <span>取消理由</span><textarea maxLength={1000}
            name="transitionReason" required /></label> : null}
        {signing && !hasRecentAal2 ? <p className={styles.warning} role="alert">
          簽署或更正前，請先在最近 15 分鐘內重新完成雙因素驗證。
        </p> : null}
        {action === "sign" ? <p className={styles.full}>
          將簽署目前 v{item.assessmentVersion} 人工評估草稿；簽署後只能建立有理由且連回本版的更正版。
        </p> : null}
        <button className="button button--primary"
          disabled={pending || (signing && !hasRecentAal2)} type="submit">
          {pending ? "確認中…" : labels[action]}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function AdaptationAssessmentActions({
  canManage,
  canSign,
  hasRecentAal2,
  item,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  item: AdaptationAssessmentListItem;
  snapshot: AdaptationAssessmentSnapshot;
}) {
  if (snapshot.demo) {
    return <button className="button button--secondary" disabled type="button">
      快速新增（展示唯讀）
    </button>;
  }
  return <div className={styles.actions}>
    <AssessmentActionForm action="create_draft" canManage={canManage}
      canSign={canSign} hasRecentAal2={hasRecentAal2} item={item}
      snapshot={snapshot} />
    {item.recordState === "draft" ? <>
      <AssessmentActionForm action="revise_draft" canManage={canManage}
        canSign={canSign} hasRecentAal2={hasRecentAal2} item={item}
        snapshot={snapshot} />
      <AssessmentActionForm action="sign" canManage={canManage}
        canSign={canSign} hasRecentAal2={hasRecentAal2} item={item}
        snapshot={snapshot} />
    </> : item.recordState === "signed" || item.recordState === "corrected" ? <>
      <AssessmentActionForm action="correct" canManage={canManage}
        canSign={canSign} hasRecentAal2={hasRecentAal2} item={item}
        snapshot={snapshot} />
      {item.followUpStatus === "pending" ? <>
        <AssessmentActionForm action="complete_follow_up" canManage={canManage}
          canSign={canSign} hasRecentAal2={hasRecentAal2} item={item}
          snapshot={snapshot} />
        <AssessmentActionForm action="cancel_follow_up" canManage={canManage}
          canSign={canSign} hasRecentAal2={hasRecentAal2} item={item}
          snapshot={snapshot} />
      </> : item.needsFollowUp ? <AssessmentActionForm action="track"
        canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2}
        item={item} snapshot={snapshot} /> : null}
    </> : null}
  </div>;
}

export function AdaptationAssessmentFreshness({
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
