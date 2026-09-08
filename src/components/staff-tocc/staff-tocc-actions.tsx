"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseStaffToccRecordApiEnvelope,
  parseStaffToccRecordInput,
} from "@/lib/staff-tocc/parser";
import type {
  StaffToccDispositionStatus,
  StaffToccRecord,
  StaffToccSnapshot,
} from "@/lib/staff-tocc/types";

import styles from "./staff-tocc.module.css";

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
  input: ReturnType<typeof parseStaffToccRecordInput>,
  snapshot: StaffToccSnapshot,
) {
  const response = await fetchWithTimeout("/api/staff-tocc", {
    method: "POST",
    headers: { "content-type": "application/json",
      "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input.action === "void" ? {
      action: "void", tocc_key: input.toccKey,
      previous_version_id: input.previousVersionId,
      expected_base_version: input.expectedBaseVersion,
      staff_membership_id: input.staffMembershipId,
      correction_reason: input.correctionReason,
    } : {
      action: input.action, tocc_key: input.toccKey,
      previous_version_id: input.previousVersionId,
      expected_base_version: input.expectedBaseVersion,
      staff_membership_id: input.staffMembershipId,
      assessed_on: input.assessedOn, valid_through: input.validThrough,
      validity_source: input.validitySource, result_text: input.resultText,
      manual_attention_flag: input.manualAttentionFlag,
      attention_note: input.attentionNote,
      evidence_status: input.evidenceStatus,
      attachment_reference: null, attachment_sha256: null,
      disposition_status: input.dispositionStatus,
      disposition_note: input.dispositionNote,
      correction_reason: input.correctionReason,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff TOCC save failed");
  return parseStaffToccRecordApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function ToccFields({ record }: { record?: StaffToccRecord }) {
  const [attention, setAttention] = useState(record?.manualAttentionFlag ?? false);
  const [disposition, setDisposition] = useState(
    record?.dispositionStatus ?? "not_recorded",
  );
  return <>
    <label><span>評估日期</span><input name="assessedOn" type="date"
      defaultValue={record?.assessedOn ?? ""} required /></label>
    <label><span>人工輸入有效至</span><input name="validThrough" type="date"
      defaultValue={record?.validThrough ?? ""} required /></label>
    <label><span>效期來源</span><input name="validitySource" maxLength={240}
      defaultValue={record?.validitySource ?? ""}
      placeholder="照錄文件、制度或人工確認來源" required /></label>
    <label className={styles.wide}><span>結果（依機構來源照錄）</span>
      <textarea name="resultText" rows={3} maxLength={1_000}
        defaultValue={record?.resultText ?? ""} required /></label>
    <label className={styles.checkLabel}><input name="manualAttentionFlag"
      type="checkbox" checked={attention}
      onChange={(event) => setAttention(event.target.checked)} />
      <span>由授權人員人工標記異常／positive-like，需要提示</span></label>
    {attention ? <label className={styles.wide}><span>人工標記理由</span>
      <textarea name="attentionNote" rows={3} maxLength={1_000}
        defaultValue={record?.attentionNote ?? ""} required /></label> : null}
    <label><span>證明狀態</span><select name="evidenceStatus"
      defaultValue={record?.evidenceStatus === "not_applicable"
        ? "not_applicable" : "missing"} required>
      <option value="missing">缺證明</option>
      <option value="not_applicable">不適用</option>
    </select></label>
    <label><span>處置狀態</span><select name="dispositionStatus"
      value={disposition} onChange={(event) => setDisposition(
        event.target.value as StaffToccDispositionStatus,
      )}>
      <option value="not_recorded">尚未登記</option>
      <option value="pending">待處置</option>
      <option value="in_progress">處置中</option>
      <option value="completed">已完成</option>
    </select></label>
    {disposition !== "not_recorded" ? <label className={styles.wide}>
      <span>處置內容</span><textarea name="dispositionNote" rows={3}
        maxLength={1_000} defaultValue={record?.dispositionNote ?? ""} required />
    </label> : null}
  </>;
}

function successMessage(
  receipt: Awaited<ReturnType<typeof sendRecord>>,
  action: "create" | "correct" | "void",
) {
  const base = action === "create" ? "TOCC 原始版本已追加保存。" :
    action === "correct" ? "已追加更正版；原版本未被覆寫。" :
      "已追加作廢版本；原紀錄完整保留。";
  if (action === "void") return base;
  const warnings = [
    receipt.expiryWarning ? "人工輸入的有效至早於保存當日" : null,
    receipt.manualAttentionWarning ? "本筆已由人員人工標記需注意" : null,
  ].filter(Boolean);
  return warnings.length ? `${base} 提示：${warnings.join("；")}。此提示不是診斷。` : base;
}

export function StaffToccCreateForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffToccSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  return <details className={styles.composer} open>
    <summary>新增員工 TOCC 紀錄</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const key = operation.getOrCreate();
        try {
          const attention = data.get("manualAttentionFlag") === "on";
          const disposition = String(data.get("dispositionStatus") ?? "");
          const input = parseStaffToccRecordInput({
            action: "create", tocc_key: key, previous_version_id: null,
            expected_base_version: 0, staff_membership_id: data.get("staff"),
            assessed_on: data.get("assessedOn"),
            valid_through: data.get("validThrough"),
            validity_source: data.get("validitySource"),
            result_text: data.get("resultText"), manual_attention_flag: attention,
            attention_note: attention ? data.get("attentionNote") : null,
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            disposition_status: disposition,
            disposition_note: disposition === "not_recorded"
              ? null : data.get("dispositionNote"),
            correction_reason: null,
          }, key);
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded();
          setMessage(successMessage(receipt, input.action)); router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>員工（穩定人員識別）</span><select name="staff" required
          defaultValue=""><option value="">請選擇在職員工</option>
          {snapshot.staffOptions.filter((staff) => staff.isCurrent).map((staff) =>
            <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
              {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            </option>)}</select></label>
        <ToccFields />
        <p className={styles.wide} role="note">有效至與異常標記皆由人員依來源輸入；系統只產生可解釋提示，不推算醫療效期、不解析結果文字，也不作診斷。附件管線未配置，因此不接受瀏覽器路徑或任意附件參照。</p>
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加 TOCC 版本"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function StaffToccRevisionForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffToccSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const active = snapshot.records.filter((record) => record.recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.toccKey ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const record = active.find((item) => item.toccKey === selected) ?? null;
  if (!canManage || !record) return null;
  return <details className={styles.composer}>
    <summary>建立更正版或作廢版本</summary>
    <label className={styles.topControl}><span>目前終端版本</span>
      <select value={selected} disabled={pending} onChange={(event) => {
        setSelected(event.target.value); operation.handleChange(() => setMessage(null));
      }}>{active.map((item) => <option key={item.toccKey} value={item.toccKey}>
        {item.staffDisplayName} · {item.assessedOn} · v{item.version}
      </option>)}</select></label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        const key = operation.getOrCreate();
        try {
          const attention = data.get("manualAttentionFlag") === "on";
          const disposition = String(data.get("dispositionStatus") ?? "");
          const input = parseStaffToccRecordInput(action === "void" ? {
            action: "void", tocc_key: record.toccKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            correction_reason: data.get("reason"),
          } : {
            action: "correct", tocc_key: record.toccKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            assessed_on: data.get("assessedOn"),
            valid_through: data.get("validThrough"),
            validity_source: data.get("validitySource"),
            result_text: data.get("resultText"), manual_attention_flag: attention,
            attention_note: attention ? data.get("attentionNote") : null,
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            disposition_status: disposition,
            disposition_note: disposition === "not_recorded"
              ? null : data.get("dispositionNote"),
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
          <option value="correct">建立更正版</option>
          <option value="void">追加作廢版本</option>
        </select></label>
        {action === "correct" ? <ToccFields record={record} /> : null}
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
