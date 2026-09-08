"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseOccupationalTherapyServiceActionError,
  parseOccupationalTherapyServiceActionSuccess,
  type OccupationalTherapyServiceActionExpectation,
} from "@/lib/occupational-therapy-services/parser";
import type {
  OccupationalTherapyServiceRecord,
  OccupationalTherapyServiceSnapshot,
  OccupationalTherapyServiceValue,
  OccupationalTherapyServiceValueState,
} from "@/lib/occupational-therapy-services/types";

import styles from "./occupational-therapy-services.module.css";

type ActionKind = "create_draft" | "revise_draft" | "sign" | "correct";

const actionLabels: Record<ActionKind, string> = {
  create_draft: "新增服務草稿",
  revise_draft: "建立草稿新版",
  sign: "簽署服務紀錄",
  correct: "建立有理由更正版",
};

function localDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const item = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${item("year")}-${item("month")}-${item("day")}T${item("hour")}:${item("minute")}`;
}

function asTaipeiInstant(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  const parsed = new Date(`${text}:00+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text;
}

function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.startsWith("API:")) {
    return error.message.slice(4);
  }
  return "結果未知；請保留內容，未修改時使用同一操作鍵重試。";
}

function readValue(data: FormData, prefix: string): OccupationalTherapyServiceValue {
  const state = String(data.get(`${prefix}.state`)) as
    OccupationalTherapyServiceValueState;
  const text = String(data.get(`${prefix}.text`) ?? "").trim();
  const reason = String(data.get(`${prefix}.reason`) ?? "").trim();
  return state === "recorded"
    ? { state, text, reason: null }
    : { state, text: null, reason };
}

function ValueEditor({
  defaultValue,
  label,
  name,
}: {
  defaultValue: OccupationalTherapyServiceValue;
  label: string;
  name: string;
}) {
  const [state, setState] = useState(defaultValue.state);
  return <fieldset className={`${styles.full} ${styles.measurementEditor}`}>
    <legend>{label}</legend>
    <label>
      <span>資料狀態</span>
      <select
        name={`${name}.state`}
        onChange={(event) => setState(
          event.currentTarget.value as OccupationalTherapyServiceValueState,
        )}
        value={state}
      >
        <option value="recorded">已記錄</option>
        <option value="missing">缺值／尚未取得</option>
        <option value="not_applicable">不適用</option>
      </select>
    </label>
    {state === "recorded" ? <label>
      <span>{label}內容</span>
      <textarea
        defaultValue={defaultValue.state === "recorded"
          ? defaultValue.text ?? "" : ""}
        maxLength={5000}
        name={`${name}.text`}
        required
      />
    </label> : <label>
      <span>{state === "missing" ? "缺值理由" : "不適用理由"}</span>
      <textarea
        defaultValue={defaultValue.state === state
          ? defaultValue.reason ?? "" : ""}
        maxLength={1000}
        name={`${name}.reason`}
        required
      />
    </label>}
  </fieldset>;
}

function ActionForm({
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
  record: OccupationalTherapyServiceRecord | null;
  snapshot: OccupationalTherapyServiceSnapshot;
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
    const clientId = record?.clientId ?? String(data.get("clientId") ?? "");
    const common = record ? {
      clientId: record.clientId,
      recordKey: record.recordKey,
      previousVersionId: record.versionId,
      expectedVersion: record.recordVersion,
    } : null;
    let body: Record<string, unknown>;
    if (action === "sign") {
      body = { action, ...common };
    } else {
      body = {
        action,
        ...(action === "create_draft" ? { clientId } : common),
        occurredAt: asTaipeiInstant(data.get("occurredAt")),
        serviceContent: readValue(data, "serviceContent"),
        clientReaction: readValue(data, "clientReaction"),
        recommendation: readValue(data, "recommendation"),
        ...(action === "correct"
          ? { correctionReason: data.get("correctionReason") }
          : {}),
      };
    }
    const expectation: OccupationalTherapyServiceActionExpectation = {
      action,
      organizationId: snapshot.organizationId,
      branchId: snapshot.branchId,
      clientId,
      ...(record ? {
        recordKey: record.recordKey,
        expectedVersion: record.recordVersion,
      } : {}),
    };
    const response = await fetchWithTimeout("/api/occupational-therapy-services", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        "x-occupational-therapy-service-operation": action,
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
      const parsed = parseOccupationalTherapyServiceActionError(payload);
      if (response.status < 500 && parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("RESULT_UNKNOWN");
    }
    parseOccupationalTherapyServiceActionSuccess(
      payload,
      expectation,
      response.status,
    );
    operationKey.current = null;
    uncertain.current = false;
  }

  const initial = record ?? {
    occurredAt: snapshot.generatedAt,
    serviceContent: { state: "recorded", text: null, reason: null },
    clientReaction: { state: "missing", text: null, reason: null },
    recommendation: { state: "not_applicable", text: null, reason: null },
  };
  const editable = action !== "sign";
  return <details className={styles.actionDetails}>
    <summary>{actionLabels[action]}</summary>
    <form
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
          setMessage(`${actionLabels[action]}已確認完成；正在重新載入。`);
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
        {action === "create_draft" ? <label className={styles.full}>
          <span>指派個案</span>
          <select name="clientId" required>
            <option value="">請選擇精確個案</option>
            {snapshot.clientOptions.map((client) => <option
              key={client.clientId}
              value={client.clientId}
            >{client.displayName}</option>)}
          </select>
        </label> : record ? <p className={styles.fixedClient}>
          <strong>已鎖定個案：{record.clientDisplayName}</strong>
          <small>以本筆穩定 ID 操作，不依姓名模糊比對。</small>
        </p> : null}
        {editable ? <>
          <label className={styles.full}>
            <span>服務發生日期與時間（台北時間）</span>
            <input
              defaultValue={localDateTime(initial.occurredAt)}
              max={localDateTime(snapshot.generatedAt)}
              name="occurredAt"
              required
              type="datetime-local"
            />
          </label>
          <ValueEditor
            defaultValue={initial.serviceContent}
            label="服務內容"
            name="serviceContent"
          />
          <ValueEditor
            defaultValue={initial.clientReaction}
            label="個案反應"
            name="clientReaction"
          />
          <ValueEditor
            defaultValue={initial.recommendation}
            label="人工建議"
            name="recommendation"
          />
        </> : null}
        {action === "correct" ? <label className={styles.full}>
          <span>更正理由</span>
          <textarea maxLength={1000} name="correctionReason" required />
        </label> : null}
        {signing && !hasRecentAal2 ? <p
          className={styles.warning}
          role="alert"
        >
          簽署或更正前，請先完成最近 15 分鐘同一工作階段的雙因素驗證。
        </p> : null}
        {action === "sign" && record ? <p className={styles.full}>
          將簽署 v{record.recordVersion} 草稿；簽署後禁止覆寫或刪除，只能追加有理由的更正版。
        </p> : null}
        <button
          className="button button--primary"
          disabled={pending || signing && !hasRecentAal2}
          type="submit"
        >{pending ? "確認中…" : actionLabels[action]}</button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function OccupationalTherapyServiceCreateAction(props: {
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  snapshot: OccupationalTherapyServiceSnapshot;
}) {
  if (props.snapshot.demo) {
    return <button className="button button--primary" disabled type="button">
      新增服務草稿（展示唯讀）
    </button>;
  }
  return <ActionForm action="create_draft" record={null} {...props} />;
}

export function OccupationalTherapyServiceRecordActions(props: {
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  record: OccupationalTherapyServiceRecord;
  snapshot: OccupationalTherapyServiceSnapshot;
}) {
  if (props.snapshot.demo) {
    return <button className="button button--secondary" disabled type="button">
      正式操作（展示唯讀）
    </button>;
  }
  return <div className={styles.actions}>
    {props.record.recordState === "draft" ? <>
      <ActionForm action="revise_draft" {...props} />
      <ActionForm action="sign" {...props} />
    </> : <ActionForm action="correct" {...props} />}
  </div>;
}

export function OccupationalTherapyServiceFreshness({
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
