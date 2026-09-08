"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseStaffVitalSignRecordApiEnvelope,
  parseStaffVitalSignRecordInput,
} from "@/lib/staff-vital-signs/parser";
import { taipeiLocalInputToIso, toTaipeiLocalInput } from "@/lib/staff-vital-signs/date";
import type {
  StaffVitalSignRecord,
  StaffVitalSignSnapshot,
  StaffVitalSignValueStatus,
} from "@/lib/staff-vital-signs/types";

import styles from "./staff-vital-signs.module.css";

function messageFor(error: unknown) {
  if (isClientFetchTimeoutError(error) ||
    (error instanceof Error && error.message.includes("fetch"))) {
    return "連線中斷或逾時，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return "操作未確認完成；請重新檢查資料，內容未修改時可使用原操作鍵重試。";
}

function useOperationKey() {
  const key = useRef<string | null>(null);
  const recordKey = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    getOrCreate() { key.current ??= crypto.randomUUID(); return key.current; },
    getRecordKey() { recordKey.current ??= crypto.randomUUID(); return recordKey.current; },
    markFailed() { failed.current = true; },
    markSucceeded() { key.current = null; recordKey.current = null; failed.current = false; },
    handleChange(clear: () => void) {
      if (failed.current) {
        key.current = null; recordKey.current = null; failed.current = false; clear();
      }
    },
  };
}

function optionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value : null;
}

async function sendRecord(
  input: ReturnType<typeof parseStaffVitalSignRecordInput>,
  snapshot: StaffVitalSignSnapshot,
) {
  const body = input.action === "void" ? {
    action: "void", vital_sign_key: input.vitalSignKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    staff_membership_id: input.staffMembershipId,
    correction_reason: input.correctionReason,
  } : {
    action: input.action, vital_sign_key: input.vitalSignKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    staff_membership_id: input.staffMembershipId,
    measurement_type: input.measurementType, value_status: input.valueStatus,
    value_decimal_text: input.valueDecimalText, unit: input.unit,
    status_reason: input.statusReason, occurred_at: input.occurredAt,
    source: input.source, note: input.note,
    correction_reason: input.correctionReason,
  };
  const response = await fetchWithTimeout("/api/staff-vital-signs", {
    method: "POST",
    headers: { "content-type": "application/json",
      "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff vital sign save failed");
  return parseStaffVitalSignRecordApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function VitalSignFields({ record }: { record?: StaffVitalSignRecord }) {
  const [valueStatus, setValueStatus] = useState<StaffVitalSignValueStatus>(
    record?.valueStatus ?? "measured",
  );
  const measured = valueStatus === "measured";
  return <>
    <label><span>量測種類</span><input name="measurementType" maxLength={120}
      defaultValue={record?.measurementType ?? ""} required /></label>
    <label><span>值狀態</span><select name="valueStatus" value={valueStatus}
      onChange={(event) => setValueStatus(
        event.target.value as StaffVitalSignValueStatus,
      )} required>
      <option value="measured">已量</option>
      <option value="missing">缺值</option>
      <option value="not_applicable">不適用</option>
    </select></label>
    {measured ? <>
      <label><span>精確 decimal 文字</span><input name="valueDecimalText"
        inputMode="decimal" maxLength={32}
        defaultValue={record?.valueDecimalText ?? ""}
        placeholder="例如 120.00（保留尾端零）" required /></label>
      <label><span>單位</span><input name="unit" maxLength={40}
        defaultValue={record?.unit ?? ""} required /></label>
    </> : <label className={styles.wide}><span>
      {valueStatus === "missing" ? "缺值原因" : "不適用原因"}
    </span><textarea name="statusReason" rows={3} maxLength={500}
      defaultValue={record?.statusReason ?? ""} required /></label>}
    <label><span>發生時間（台北時間）</span><input name="occurredAt"
      type="datetime-local" defaultValue={record
        ? toTaipeiLocalInput(record.occurredAt) : ""} required /></label>
    <label><span>來源</span><input name="source" maxLength={160}
      defaultValue={record?.source ?? ""}
      placeholder="例如人工輸入或已確認來源名稱" required /></label>
    <label className={styles.wide}><span>備註（選填）</span>
      <textarea name="note" rows={3} maxLength={1_000}
        defaultValue={record?.note ?? ""} /></label>
    <p className={styles.inlineNote}>本頁不接受附件、裝置路徑或匯出請求；門檻規則未發布前不產生警示或醫療判定。</p>
  </>;
}

function parseFormContent(data: FormData) {
  const status = data.get("valueStatus");
  const measured = status === "measured";
  const occurredAt = typeof data.get("occurredAt") === "string"
    ? taipeiLocalInputToIso(String(data.get("occurredAt"))) : null;
  return {
    measurement_type: data.get("measurementType"), value_status: status,
    value_decimal_text: measured ? data.get("valueDecimalText") : null,
    unit: measured ? data.get("unit") : null,
    status_reason: measured ? null : data.get("statusReason"),
    occurred_at: occurredAt, source: data.get("source"),
    note: optionalText(data.get("note")),
  };
}

export function StaffVitalSignCreateForm({
  canManage, snapshot,
}: {
  canManage: boolean;
  snapshot: StaffVitalSignSnapshot;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useOperationKey();
  if (!canManage) return null;
  return <details className={styles.composer}><summary>新增生命徵象紀錄</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        try {
          const input = parseStaffVitalSignRecordInput({
            action: "create", vital_sign_key: operation.getRecordKey(),
            previous_version_id: null, expected_base_version: 0,
            staff_membership_id: data.get("staffMembershipId"),
            ...parseFormContent(data), correction_reason: null,
          }, operation.getOrCreate());
          await sendRecord(input, snapshot);
          operation.markSucceeded();
          setMessage(input.valueStatus === "measured"
            ? "原始版本已追加保存；decimal 文字格式完整保留。"
            : `原始版本已追加保存；「${input.valueStatus === "missing"
              ? "缺值" : "不適用"}」已與量測值分開保存。`);
          form.reset(); router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>員工</span><select name="staffMembershipId" required
          defaultValue="">
          <option value="" disabled>請選擇</option>
          {snapshot.staffOptions.filter((staff) => staff.isCurrent).map((staff) =>
            <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
              {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            </option>)}</select></label>
        <VitalSignFields />
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加原始版本"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function StaffVitalSignRevisionForm({
  canManage, snapshot,
}: {
  canManage: boolean;
  snapshot: StaffVitalSignSnapshot;
}) {
  const router = useRouter();
  const active = snapshot.records.filter((record) => record.recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.recordVersionId ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useOperationKey();
  if (!canManage || active.length === 0) return null;
  const record = active.find((item) => item.recordVersionId === selected) ?? active[0]!;
  return <details className={styles.composer}><summary>建立更正或作廢版本</summary>
    <label className={styles.topControl}><span>選擇終端版本</span>
      <select value={record.recordVersionId} onChange={(event) => {
        setSelected(event.target.value); operation.handleChange(() => setMessage(null));
      }}>{active.map((item) => <option key={item.recordVersionId}
        value={item.recordVersionId}>{item.staffDisplayName} · {item.measurementType} · {toTaipeiLocalInput(item.occurredAt).replace("T", " ")} · v{item.version}</option>)}</select>
    </label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        try {
          const input = parseStaffVitalSignRecordInput(action === "void" ? {
            action: "void", vital_sign_key: record.vitalSignKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            correction_reason: data.get("reason"),
          } : {
            action: "correct", vital_sign_key: record.vitalSignKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            ...parseFormContent(data), correction_reason: data.get("reason"),
          }, operation.getOrCreate());
          await sendRecord(input, snapshot);
          operation.markSucceeded();
          setMessage(input.action === "void"
            ? "已追加作廢版本；原紀錄完整保留。"
            : "已追加更正版；原紀錄未被覆寫。");
          router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>操作</span><select value={action}
          onChange={(event) => setAction(event.target.value as "correct" | "void")}>
          <option value="correct">建立更正版</option>
          <option value="void">追加作廢版本</option>
        </select></label>
        {action === "correct" ? <VitalSignFields record={record} /> : null}
        <label className={styles.wide}><span>更正／作廢理由</span>
          <textarea name="reason" rows={3} maxLength={1_000} required /></label>
        <button className="button button--secondary" type="submit" disabled={pending}>
          {pending ? "保存中…" : action === "void" ? "追加作廢版本" : "追加更正版"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
