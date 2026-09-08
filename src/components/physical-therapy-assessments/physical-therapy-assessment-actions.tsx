"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parsePhysicalTherapyActionError,
  parsePhysicalTherapyActionSuccess,
  type PhysicalTherapyActionExpectation,
} from "@/lib/physical-therapy-assessments/parser";
import type {
  PhysicalTherapyAssessmentListItem,
  PhysicalTherapyAssessmentSnapshot,
  PhysicalTherapyMeasurement,
  PhysicalTherapyMeasurementState,
} from "@/lib/physical-therapy-assessments/types";

import styles from "./physical-therapy-assessments.module.css";

type ActionKind = "create_draft" | "revise_draft" | "sign" | "correct";
type MeasurementDraft = PhysicalTherapyMeasurement & { key: string };

const actionLabels: Record<ActionKind, string> = {
  create_draft: "開始新評估草稿",
  revise_draft: "建立草稿新版",
  sign: "簽署評估",
  correct: "建立更正版",
};

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

function initialMeasurements(item: PhysicalTherapyAssessmentListItem) {
  if (item.measurements?.length) {
    return item.measurements.map((measurement, index) => ({
      ...measurement,
      key: `${item.versionId ?? item.clientId}-${index}`,
    }));
  }
  return [{
    key: `${item.clientId}-new-0`,
    name: "",
    state: "text" as const,
    value: "",
    unit: null,
    reason: null,
  }];
}

function readMeasurements(data: FormData): PhysicalTherapyMeasurement[] {
  const count = Number(data.get("measurementCount"));
  return Array.from({ length: count }, (_, index) => {
    const state = String(
      data.get(`measurement.${index}.state`),
    ) as PhysicalTherapyMeasurementState;
    const rawValue = String(data.get(`measurement.${index}.value`) ?? "").trim();
    const rawUnit = String(data.get(`measurement.${index}.unit`) ?? "").trim();
    const rawReason = String(data.get(`measurement.${index}.reason`) ?? "").trim();
    return {
      name: String(data.get(`measurement.${index}.name`) ?? "").trim(),
      state,
      value: state === "numeric" || state === "text" ? rawValue : null,
      unit: state === "numeric" ? rawUnit : null,
      reason: state === "missing" || state === "not_applicable"
        ? rawReason
        : null,
    };
  });
}

function MeasurementEditor({ item }: { item: PhysicalTherapyAssessmentListItem }) {
  const [measurements, setMeasurements] = useState<MeasurementDraft[]>(() =>
    initialMeasurements(item));

  function update(index: number, values: Partial<MeasurementDraft>) {
    setMeasurements((current) => current.map((measurement, itemIndex) =>
      itemIndex === index ? { ...measurement, ...values } : measurement));
  }

  return <fieldset className={`${styles.full} ${styles.measurementEditor}`}>
    <legend>人工測量項目</legend>
    <p>
      每項自行命名並保存精確數值文字或觀察文字；缺值與不適用必須填理由。系統不會加總或換算分數。
    </p>
    <input name="measurementCount" type="hidden" value={measurements.length} />
    <div className={styles.measurementList}>
      {measurements.map((measurement, index) => <fieldset
        className={styles.measurementRow}
        key={measurement.key}
      >
        <legend>項目 {index + 1}</legend>
        <label>
          <span>項目名稱</span>
          <input
            maxLength={120}
            name={`measurement.${index}.name`}
            onChange={(event) => update(index, { name: event.currentTarget.value })}
            required
            value={measurement.name}
          />
        </label>
        <label>
          <span>資料狀態</span>
          <select
            name={`measurement.${index}.state`}
            onChange={(event) => {
              const state = event.currentTarget.value as PhysicalTherapyMeasurementState;
              update(index, {
                state,
                value: state === "numeric" || state === "text" ? "" : null,
                unit: state === "numeric" ? "" : null,
                reason: state === "missing" || state === "not_applicable" ? "" : null,
              });
            }}
            value={measurement.state}
          >
            <option value="numeric">精確數值</option>
            <option value="text">文字觀察</option>
            <option value="missing">缺值／尚未取得</option>
            <option value="not_applicable">不適用</option>
          </select>
        </label>
        {measurement.state === "numeric" ? <>
          <label>
            <span>精確數值</span>
            <input
              inputMode="decimal"
              maxLength={20}
              name={`measurement.${index}.value`}
              onChange={(event) => update(index, { value: event.currentTarget.value })}
              pattern="-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?"
              required
              value={measurement.value ?? ""}
            />
          </label>
          <label>
            <span>單位</span>
            <input
              maxLength={40}
              name={`measurement.${index}.unit`}
              onChange={(event) => update(index, { unit: event.currentTarget.value })}
              required
              value={measurement.unit ?? ""}
            />
          </label>
        </> : measurement.state === "text" ? <label className={styles.measurementWide}>
          <span>觀察文字</span>
          <textarea
            maxLength={2000}
            name={`measurement.${index}.value`}
            onChange={(event) => update(index, { value: event.currentTarget.value })}
            required
            value={measurement.value ?? ""}
          />
        </label> : <label className={styles.measurementWide}>
          <span>{measurement.state === "missing" ? "缺值理由" : "不適用理由"}</span>
          <textarea
            maxLength={500}
            name={`measurement.${index}.reason`}
            onChange={(event) => update(index, { reason: event.currentTarget.value })}
            required
            value={measurement.reason ?? ""}
          />
        </label>}
        <button
          className="button button--quiet"
          disabled={measurements.length === 1}
          onClick={() => setMeasurements((current) =>
            current.filter((_, itemIndex) => itemIndex !== index))}
          type="button"
        >移除此項</button>
      </fieldset>)}
    </div>
    <button
      className="button button--secondary"
      disabled={measurements.length >= 50}
      onClick={() => setMeasurements((current) => [...current, {
        key: crypto.randomUUID(),
        name: "",
        state: "text",
        value: "",
        unit: null,
        reason: null,
      }])}
      type="button"
    >新增測量項目</button>
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
  item: PhysicalTherapyAssessmentListItem;
  snapshot: PhysicalTherapyAssessmentSnapshot;
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
    let expectation: PhysicalTherapyActionExpectation;
    if (action === "sign") {
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
        ...(action === "create_draft" ? { clientId: item.clientId } : common),
        assessedOn: data.get("assessedOn"),
        reassessmentDueOn: data.get("reassessmentDueOn"),
        dueBasis: data.get("dueBasis"),
        measurements: readMeasurements(data),
        functionalObservation: data.get("functionalObservation"),
        goals: data.get("goals"),
        recommendations: data.get("recommendations"),
        followUpPlan: data.get("followUpPlan"),
        formVersionReference: "manual-physical-therapy-v1",
        ...(action === "correct"
          ? { correctionReason: data.get("correctionReason") }
          : {}),
      };
      expectation = action === "create_draft"
        ? { action, clientId: item.clientId }
        : {
          action,
          clientId: item.clientId,
          assessmentKey: item.assessmentKey!,
          expectedVersion: item.assessmentVersion!,
        };
    }

    const response = await fetchWithTimeout("/api/physical-therapy-assessments", {
      method: action === "create_draft" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        "x-physical-therapy-operation": action,
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
      const parsed = parsePhysicalTherapyActionError(payload);
      if (parsed) {
        operationKey.current = null;
        uncertain.current = false;
        throw new Error(`API:${parsed.errors[0]!.message}`);
      }
      throw new Error("INVALID_RESPONSE");
    }
    parsePhysicalTherapyActionSuccess(payload, expectation, response.status);
    operationKey.current = null;
    uncertain.current = false;
  }

  const editable = action !== "sign";
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
        try {
          await submit(event.currentTarget);
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
            <textarea defaultValue={item.dueBasis ?? ""} maxLength={1000} name="dueBasis" required />
          </label>
          <MeasurementEditor item={item} />
          {[
            ["functionalObservation", "功能觀察", item.functionalObservation],
            ["goals", "人工設定目標", item.goals],
            ["recommendations", "專業建議", item.recommendations],
            ["followUpPlan", "追蹤計畫", item.followUpPlan],
          ].map(([name, label, value]) => <label className={styles.full} key={name}>
            <span>{label}</span>
            <textarea defaultValue={value ?? ""} maxLength={5000} name={String(name)} required />
          </label>)}
          <p className={styles.formReference}>
            表單參照：<code>manual-physical-therapy-v1</code>（人工、非標準化；不計分、不套公式、不診斷）
          </p>
        </> : null}
        {action === "correct" ? <label className={styles.full}>
          <span>更正理由</span>
          <textarea maxLength={1000} name="correctionReason" required />
        </label> : null}
        {!hasRecentAal2 ? <p className={styles.warning} role="alert">
          新增、修訂、簽署或更正前，請先在最近 15 分鐘內重新完成雙因素驗證。
        </p> : null}
        {action === "sign" ? <p className={styles.full}>
          將以目前物理治療師身分簽署 v{item.assessmentVersion} 草稿；簽署後只能追加有理由且連回原版的更正版。
        </p> : null}
        <button
          className="button button--primary"
          disabled={pending || !hasRecentAal2}
          type="submit"
        >{pending ? "確認中…" : actionLabels[action]}</button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function PhysicalTherapyAssessmentActions({
  canManage,
  canSign,
  hasRecentAal2,
  item,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  hasRecentAal2: boolean;
  item: PhysicalTherapyAssessmentListItem;
  snapshot: PhysicalTherapyAssessmentSnapshot;
}) {
  if (snapshot.demo) {
    return <button className="button button--secondary" disabled type="button">
      正式操作（展示唯讀）
    </button>;
  }
  return <div className={styles.actions}>
    <AssessmentActionForm action="create_draft" canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
    {item.recordState === "draft" ? <>
      <AssessmentActionForm action="revise_draft" canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
      <AssessmentActionForm action="sign" canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
    </> : item.recordState === "signed" || item.recordState === "corrected"
      ? <AssessmentActionForm action="correct" canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
      : null}
  </div>;
}

export function PhysicalTherapyAssessmentFreshness({
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
