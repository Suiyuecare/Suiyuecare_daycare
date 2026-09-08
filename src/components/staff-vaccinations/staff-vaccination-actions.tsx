"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseStaffVaccinationRecordApiEnvelope,
  parseStaffVaccinationRecordInput,
} from "@/lib/staff-vaccinations/parser";
import type {
  StaffVaccinationRecord,
  StaffVaccinationSnapshot,
} from "@/lib/staff-vaccinations/types";

import styles from "./staff-vaccinations.module.css";

function messageFor(error: unknown) {
  if (isClientFetchTimeoutError(error)) {
    return "連線逾時，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return "操作未確認完成；請重新檢查資料，內容未修改時可使用原操作鍵重試。";
}

function useOperationKey() {
  const key = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    getOrCreate() { key.current ??= crypto.randomUUID(); return key.current; },
    markFailed() { failed.current = true; },
    markSucceeded() { key.current = null; failed.current = false; },
    handleChange(clear: () => void) {
      if (failed.current) { key.current = null; failed.current = false; clear(); }
    },
  };
}

async function sendRecord(
  input: ReturnType<typeof parseStaffVaccinationRecordInput>,
  snapshot: StaffVaccinationSnapshot,
) {
  const response = await fetchWithTimeout("/api/staff-vaccinations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input.action === "void" ? {
      action: "void", vaccination_key: input.vaccinationKey,
      previous_version_id: input.previousVersionId,
      expected_base_version: input.expectedBaseVersion,
      staff_membership_id: input.staffMembershipId,
      correction_reason: input.correctionReason,
    } : {
      action: input.action, vaccination_key: input.vaccinationKey,
      previous_version_id: input.previousVersionId,
      expected_base_version: input.expectedBaseVersion,
      staff_membership_id: input.staffMembershipId,
      vaccine_name: input.vaccineName, dose_number: input.doseNumber,
      vaccinated_on: input.vaccinatedOn, lot_number: input.lotNumber,
      provider_name: input.providerName, evidence_status: input.evidenceStatus,
      attachment_reference: null, attachment_sha256: null,
      correction_reason: input.correctionReason,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff vaccination save failed");
  return parseStaffVaccinationRecordApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function VaccinationFields({ record }: { record?: StaffVaccinationRecord }) {
  return <>
    <label><span>疫苗名稱（依來源照錄）</span><input name="vaccineName"
      maxLength={160} defaultValue={record?.vaccineName ?? ""} required /></label>
    <label><span>劑次（依來源照錄）</span><input name="doseNumber"
      maxLength={80} defaultValue={record?.doseNumber ?? ""} required /></label>
    <label><span>接種日期</span><input name="vaccinatedOn" type="date"
      defaultValue={record?.vaccinatedOn ?? ""} required /></label>
    <label><span>批號（未提供可留空）</span><input name="lotNumber" maxLength={160}
      autoComplete="off" defaultValue={record?.lotNumber ?? ""} /></label>
    <label><span>接種院所</span><input name="providerName" maxLength={200}
      defaultValue={record?.providerName ?? ""} required /></label>
    <label><span>證明狀態</span><select name="evidenceStatus"
      defaultValue={record?.evidenceStatus === "not_applicable" ? "not_applicable" : "missing"}
      required><option value="missing">缺證明</option>
      <option value="not_applicable">不適用</option></select></label>
  </>;
}

function successMessage(receipt: Awaited<ReturnType<typeof sendRecord>>, action: string) {
  const base = action === "create" ? "疫苗原始版本已追加保存。" :
    action === "correct" ? "已追加更正版；原版本未被覆寫。" :
      "已追加作廢版本；原紀錄完整保留。";
  return receipt.duplicateWarning
    ? `${base} 系統找到 ${receipt.duplicateCount} 筆同一員工，且疫苗名稱與劑次經去除前後空白、忽略大小寫後相同的其他終端紀錄；已保留各筆，不會自動合併。`
    : base;
}

export function StaffVaccinationCreateForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffVaccinationSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  return <details className={styles.composer} open>
    <summary>新增員工疫苗紀錄</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const key = operation.getOrCreate();
        try {
          const input = parseStaffVaccinationRecordInput({
            action: "create", vaccination_key: key,
            previous_version_id: null, expected_base_version: 0,
            staff_membership_id: data.get("staff"),
            vaccine_name: data.get("vaccineName"),
            dose_number: data.get("doseNumber"),
            vaccinated_on: data.get("vaccinatedOn"),
            lot_number: String(data.get("lotNumber") ?? "").trim() || null,
            provider_name: data.get("providerName"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: null,
          }, key);
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded(); form.reset();
          setMessage(successMessage(receipt, input.action)); router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>員工（穩定人員識別）</span><select name="staff" required defaultValue="">
          <option value="">請選擇在職員工</option>
          {snapshot.staffOptions.filter((staff) => staff.isCurrent).map((staff) =>
            <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
              {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            </option>)}</select></label>
        <VaccinationFields />
        <p className={styles.wide} role="note">本頁只保存來源事實，不判定疫苗是否適用、有效或需要下一劑。附件上傳與掃毒尚未配置，因此不接受瀏覽器路徑或任意附件參照。</p>
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加疫苗版本"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function StaffVaccinationRevisionForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffVaccinationSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const active = snapshot.records.filter((record) => record.recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.vaccinationKey ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const record = active.find((item) => item.vaccinationKey === selected) ?? null;
  if (!canManage || !record) return null;
  return <details className={styles.composer}>
    <summary>建立更正版或作廢版本</summary>
    <label className={styles.topControl}><span>目前終端版本</span>
      <select value={selected} disabled={pending} onChange={(event) => {
        setSelected(event.target.value); operation.handleChange(() => setMessage(null));
      }}>{active.map((item) => <option key={item.vaccinationKey} value={item.vaccinationKey}>
        {item.staffDisplayName} · {item.vaccineName} · {item.doseNumber} · v{item.version}
      </option>)}</select></label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        const key = operation.getOrCreate();
        try {
          const input = parseStaffVaccinationRecordInput(action === "void" ? {
            action: "void", vaccination_key: record.vaccinationKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            correction_reason: data.get("reason"),
          } : {
            action: "correct", vaccination_key: record.vaccinationKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            vaccine_name: data.get("vaccineName"), dose_number: data.get("doseNumber"),
            vaccinated_on: data.get("vaccinatedOn"),
            lot_number: String(data.get("lotNumber") ?? "").trim() || null,
            provider_name: data.get("providerName"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: data.get("reason"),
          }, key);
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded(); setMessage(successMessage(receipt, input.action));
          router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>操作</span><select value={action}
          onChange={(event) => setAction(event.target.value as "correct" | "void")}>
          <option value="correct">建立更正版</option><option value="void">追加作廢版本</option>
        </select></label>
        {action === "correct" ? <VaccinationFields record={record} /> : null}
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
