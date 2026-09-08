"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseStaffLabReportRecordApiEnvelope,
  parseStaffLabReportRecordInput,
} from "@/lib/staff-lab-reports/parser";
import type {
  StaffLabReportRecord,
  StaffLabReportSnapshot,
} from "@/lib/staff-lab-reports/types";

import styles from "./staff-lab-reports.module.css";

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

async function sendRecord(
  input: ReturnType<typeof parseStaffLabReportRecordInput>,
  snapshot: StaffLabReportSnapshot,
) {
  const body = input.action === "void" ? {
    action: "void", report_key: input.reportKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    staff_membership_id: input.staffMembershipId,
    correction_reason: input.correctionReason,
  } : {
    action: input.action, report_key: input.reportKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    staff_membership_id: input.staffMembershipId,
    report_type: input.reportType, tested_on: input.testedOn,
    provider_name: input.providerName, result_text: input.resultText,
    valid_through: input.validThrough, validity_basis: input.validityBasis,
    evidence_status: input.evidenceStatus, attachment_reference: null,
    attachment_sha256: null, correction_reason: input.correctionReason,
  };
  const response = await fetchWithTimeout("/api/staff-lab-reports", {
    method: "POST",
    headers: { "content-type": "application/json",
      "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff lab report save failed");
  return parseStaffLabReportRecordApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function LabReportFields({ record }: { record?: StaffLabReportRecord }) {
  return <>
    <label><span>檢驗類型</span><input name="reportType" maxLength={160}
      defaultValue={record?.reportType ?? ""} required /></label>
    <label><span>檢驗日期</span><input name="testedOn" type="date"
      defaultValue={record?.testedOn ?? ""} required /></label>
    <label><span>院所／檢驗單位</span><input name="providerName" maxLength={200}
      defaultValue={record?.providerName ?? ""} required /></label>
    <label className={styles.wide}><span>結果文字（依來源照錄）</span>
      <textarea name="resultText" rows={4} maxLength={2_000}
        defaultValue={record?.resultText ?? ""} required /></label>
    <label><span>人工輸入有效至</span><input name="validThrough" type="date"
      defaultValue={record?.validThrough ?? ""} required /></label>
    <label className={styles.wide}><span>效期依據</span>
      <textarea name="validityBasis" rows={3} maxLength={500}
        defaultValue={record?.validityBasis ?? ""}
        placeholder="照錄文件、機構制度或人工確認依據" required /></label>
    <label><span>證明狀態</span><select name="evidenceStatus"
      defaultValue={record?.evidenceStatus === "not_applicable"
        ? "not_applicable" : "missing"} required>
      <option value="missing">缺證明</option>
      <option value="not_applicable">不適用</option>
    </select></label>
    <p className={styles.inlineNote}>正式附件儲存與掃毒尚未配置，故此表單不接受裝置路徑或自行貼入的參照。</p>
  </>;
}

function successMessage(
  receipt: Awaited<ReturnType<typeof sendRecord>>,
  action: "create" | "correct" | "void",
) {
  const base = action === "create" ? "原始版本已追加保存。" :
    action === "correct" ? "已追加更正版；原版本未被覆寫。" :
      "已追加作廢版本；原紀錄完整保留。";
  if (!receipt.duplicateWarning) return base;
  const detail = receipt.exactDuplicateCount > 0
    ? `另有 ${receipt.exactDuplicateCount} 筆內容完全相同；相同關鍵欄位共 ${receipt.keyFieldDuplicateCount} 筆。`
    : `另有 ${receipt.keyFieldDuplicateCount} 筆員工、檢驗類型、日期與院所相同。`;
  return `${base}${detail} 系統只提示，未自動合併。`;
}

export function StaffLabReportCreateForm({
  canManage, snapshot,
}: {
  canManage: boolean;
  snapshot: StaffLabReportSnapshot;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useOperationKey();
  if (!canManage) return null;
  return <details className={styles.composer}><summary>新增檢驗報告</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        try {
          const input = parseStaffLabReportRecordInput({
            action: "create", report_key: operation.getRecordKey(),
            previous_version_id: null, expected_base_version: 0,
            staff_membership_id: data.get("staffMembershipId"),
            report_type: data.get("reportType"), tested_on: data.get("testedOn"),
            provider_name: data.get("providerName"), result_text: data.get("resultText"),
            valid_through: data.get("validThrough"),
            validity_basis: data.get("validityBasis"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: null,
          }, operation.getOrCreate());
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded(); setMessage(successMessage(receipt, "create"));
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
        <LabReportFields />
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加原始版本"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function StaffLabReportRevisionForm({
  canManage, snapshot,
}: {
  canManage: boolean;
  snapshot: StaffLabReportSnapshot;
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
        value={item.recordVersionId}>{item.staffDisplayName} · {item.reportType} · {item.testedOn} · v{item.version}</option>)}</select>
    </label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        try {
          const input = parseStaffLabReportRecordInput(action === "void" ? {
            action: "void", report_key: record.reportKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            correction_reason: data.get("reason"),
          } : {
            action: "correct", report_key: record.reportKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            report_type: data.get("reportType"), tested_on: data.get("testedOn"),
            provider_name: data.get("providerName"), result_text: data.get("resultText"),
            valid_through: data.get("validThrough"),
            validity_basis: data.get("validityBasis"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: data.get("reason"),
          }, operation.getOrCreate());
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded(); setMessage(successMessage(receipt, input.action));
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
        {action === "correct" ? <LabReportFields record={record} /> : null}
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
