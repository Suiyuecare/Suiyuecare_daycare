"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseSocialWorkActionError,
  parseSocialWorkActionSuccess,
  type SocialWorkActionExpectation,
} from "@/lib/social-work-records/parser";
import type {
  SocialWorkRecordSnapshot,
  SocialWorkServiceRecord,
} from "@/lib/social-work-records/types";

import styles from "./social-work-records.module.css";

type ActionKind =
  | "create_draft"
  | "revise_draft"
  | "sign"
  | "correct"
  | "track"
  | "complete_follow_up"
  | "cancel_follow_up";

const labels: Record<ActionKind, string> = {
  create_draft: "新增服務草稿",
  revise_draft: "建立草稿新版",
  sign: "簽署紀錄",
  correct: "建立更正版",
  track: "建立追蹤",
  complete_follow_up: "完成追蹤",
  cancel_follow_up: "取消追蹤",
};

function taipeiLocal(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return "";
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isFinite(parsed.getTime()) && taipeiLocal(parsed.toISOString()) === value
    ? parsed.toISOString() : "";
}

function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.startsWith("API:")) {
    return error.message.slice(4);
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，操作結果未知；請保留內容，未修改時可使用同一操作鍵重試。";
  }
  return "操作結果未知；請先重新載入，未修改內容時可使用同一操作鍵重試。";
}

function SocialWorkActionForm({
  action,
  canManage,
  canSign,
  hasRecentAal2,
  record,
  snapshot,
}: {
  action: ActionKind;
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  record?: SocialWorkServiceRecord;
  snapshot: SocialWorkRecordSnapshot;
}) {
  const router = useRouter();
  const serviceTypesId = useId();
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
    const common = record ? {
      clientId: record.clientId,
      recordKey: record.recordKey,
      previousVersionId: record.versionId,
      expectedVersion: record.recordVersion,
    } : null;
    let body: Record<string, unknown>;
    let expectation: SocialWorkActionExpectation;
    if (action === "create_draft") {
      body = {
        action,
        clientId: data.get("clientId"),
        occurredAt: taipeiLocalToIso(String(data.get("occurredAt") ?? "")),
        serviceType: data.get("serviceType"),
        serviceContent: data.get("serviceContent"),
        serviceResult: data.get("serviceResult"),
      };
      expectation = { action };
    } else if (action === "revise_draft" || action === "correct") {
      body = {
        action,
        ...common,
        occurredAt: taipeiLocalToIso(String(data.get("occurredAt") ?? "")),
        serviceType: data.get("serviceType"),
        serviceContent: data.get("serviceContent"),
        serviceResult: data.get("serviceResult"),
        ...(action === "correct" ? { correctionReason: data.get("correctionReason") } : {}),
      };
      expectation = {
        action, recordKey: record!.recordKey, expectedVersion: record!.recordVersion,
      };
    } else if (action === "sign") {
      body = { action, ...common };
      expectation = {
        action, recordKey: record!.recordKey, expectedVersion: record!.recordVersion,
      };
    } else {
      body = {
        action,
        clientId: record!.clientId,
        recordKey: record!.recordKey,
        serviceVersionId: record!.versionId,
        expectedSequence: record!.followUpSequence,
        ...(action === "track" ? {
          dueOn: data.get("dueOn"), followUpPlan: data.get("followUpPlan"),
        } : action === "complete_follow_up" ? {
          followUpOutcome: data.get("followUpOutcome"),
        } : { transitionReason: data.get("transitionReason") }),
      };
      expectation = {
        action,
        recordKey: record!.recordKey,
        expectedFollowUpSequence: record!.followUpSequence,
      };
    }

    const response = await fetchWithTimeout("/api/social-work-records", {
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
      const parsed = parseSocialWorkActionError(payload);
      if (parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parseSocialWorkActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  return (
    <details className={styles.actionDetails}>
      <summary>{labels[action]}</summary>
      <form onChange={() => {
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
          setMessage(`${labels[action]}已確認完成；原版本仍完整保留。`);
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
          {action === "create_draft" ? (
            <label><span>個案</span><select defaultValue="" name="clientId" required>
              <option value="">請選擇</option>
              {snapshot.clientOptions.map((client) => (
                <option key={client.clientId} value={client.clientId}>{client.displayName}</option>
              ))}
            </select></label>
          ) : null}
          {["create_draft", "revise_draft", "correct"].includes(action) ? (
            <>
              <label><span>實際發生時間（台北）</span><input
                defaultValue={taipeiLocal(record?.occurredAt ?? snapshot.generatedAt)}
                max={taipeiLocal(snapshot.generatedAt)} name="occurredAt" required
                type="datetime-local" /></label>
              <label><span>服務類型</span><input defaultValue={record?.serviceType ?? ""}
                list={serviceTypesId} maxLength={120} name="serviceType" required /></label>
              <label className={styles.full}><span>服務內容</span><textarea
                defaultValue={record?.serviceContent ?? ""} maxLength={5000}
                name="serviceContent" required /></label>
              <label className={styles.full}><span>服務結果</span><textarea
                defaultValue={record?.serviceResult ?? ""} maxLength={3000}
                name="serviceResult" required /></label>
              <datalist id={serviceTypesId}>
                {snapshot.serviceTypeOptions.map((type) => <option key={type} value={type} />)}
              </datalist>
            </>
          ) : null}
          {action === "correct" ? <label className={styles.full}><span>更正理由</span>
            <textarea maxLength={1000} name="correctionReason" required /></label> : null}
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
            將簽署目前 v{record?.recordVersion} 草稿；簽署後只能建立有理由且連回本版的更正版。
          </p> : null}
          <button className="button button--primary" disabled={pending || (signing && !hasRecentAal2)} type="submit">
            {pending ? "確認中…" : labels[action]}
          </button>
        </fieldset>
        {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
      </form>
    </details>
  );
}

export function NewSocialWorkRecordForm({
  canManage,
  snapshot,
}: {
  canManage: boolean;
  snapshot: SocialWorkRecordSnapshot;
}) {
  if (snapshot.demo) {
    return <button className="button button--primary" disabled type="button">新增服務草稿（展示唯讀）</button>;
  }
  return <SocialWorkActionForm action="create_draft" canManage={canManage}
    canSign={false} hasRecentAal2={false} snapshot={snapshot} />;
}

export function SocialWorkRecordActions({
  canManage,
  canSign,
  hasRecentAal2,
  record,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  record: SocialWorkServiceRecord;
  snapshot: SocialWorkRecordSnapshot;
}) {
  if (snapshot.demo) return <span className={styles.readOnly}>合成資料唯讀</span>;
  return <div className={styles.actions}>
    {record.recordState === "draft" ? <>
      <SocialWorkActionForm action="revise_draft" canManage={canManage} canSign={canSign}
        hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
      <SocialWorkActionForm action="sign" canManage={canManage} canSign={canSign}
        hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
    </> : <>
      <SocialWorkActionForm action="correct" canManage={canManage} canSign={canSign}
        hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
      {record.followUpStatus === "pending" ? <>
        <SocialWorkActionForm action="complete_follow_up" canManage={canManage} canSign={canSign}
          hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
        <SocialWorkActionForm action="cancel_follow_up" canManage={canManage} canSign={canSign}
          hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
      </> : <SocialWorkActionForm action="track" canManage={canManage} canSign={canSign}
        hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />}
    </>}
  </div>;
}

export function SocialWorkRecordFreshness({
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
  const expired = observedAt >= new Date(staleAfter).getTime();
  return expired
    ? <span className={styles.stale} role="status">資料已過期，請重新載入</span>
    : <span>資料為目前快照</span>;
}
