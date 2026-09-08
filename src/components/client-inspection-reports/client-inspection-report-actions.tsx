"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseClientInspectionReportApiEnvelope,
  parseClientInspectionReportInput,
} from "@/lib/client-inspection-reports/parser";
import type {
  ClientInspectionReportRecord,
  ClientInspectionReportSnapshot,
} from "@/lib/client-inspection-reports/types";

import styles from "./client-inspection-reports.module.css";

type ValueState = "present" | "missing" | "not_applicable";
type AttachmentState = "provided" | "missing" | "not_applicable";

function messageFor(error: unknown) {
  if (isClientFetchTimeoutError(error) ||
    (error instanceof Error && error.message.includes("fetch"))) {
    return "連線中斷或逾時，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return "操作未確認完成；請重新檢查資料，內容未修改時可使用原操作鍵重試。";
}

function useOperationKey() {
  const key = useRef<string | null>(null);
  const reportKey = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    getOrCreate() { key.current ??= crypto.randomUUID(); return key.current; },
    getReportKey() { reportKey.current ??= crypto.randomUUID(); return reportKey.current; },
    markFailed() { failed.current = true; },
    markSucceeded() { key.current = null; reportKey.current = null; failed.current = false; },
    handleChange(clear: () => void) {
      if (failed.current) {
        key.current = null; reportKey.current = null; failed.current = false; clear();
      }
    },
  };
}

async function sendReport(
  input: ReturnType<typeof parseClientInspectionReportInput>,
  snapshot: ClientInspectionReportSnapshot,
) {
  const body = input.action === "void" ? {
    action: input.action, report_key: input.reportKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    client_id: input.clientId, correction_reason: input.correctionReason,
  } : {
    action: input.action, report_key: input.reportKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    client_id: input.clientId, report_type: input.reportType,
    examined_on: input.examinedOn, result_status: input.resultStatus,
    result_text: input.resultText, result_reason: input.resultReason,
    source_status: input.sourceStatus, source_text: input.sourceText,
    source_reason: input.sourceReason, attachment_status: input.attachmentStatus,
    attachment_id: input.attachmentId,
    attachment_sha256: input.attachmentSha256,
    attachment_source_filename: input.attachmentSourceFilename,
    correction_reason: input.correctionReason,
  };
  const response = await fetchWithTimeout("/api/client-inspection-reports", {
    method: "POST",
    headers: { "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
      "x-client-inspection-report-operation": input.action },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("client inspection report save failed");
  return parseClientInspectionReportApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function TriStateField({ id, label, maximum, initialStatus = "present",
  initialText = "", initialReason = "",
}: {
  id: "result" | "source";
  label: string;
  maximum: number;
  initialStatus?: ValueState;
  initialText?: string;
  initialReason?: string;
}) {
  const [status, setStatus] = useState<ValueState>(initialStatus);
  return <div className={styles.stateField}>
    <label><span>{label}狀態</span><select name={`${id}Status`} value={status}
      onChange={(event) => setStatus(event.target.value as ValueState)} required>
      <option value="present">已提供</option>
      <option value="missing">缺值</option>
      <option value="not_applicable">不適用</option>
    </select></label>
    {status === "present" ? <label className={styles.wide}>
      <span>{label}文字（依來源照錄）</span>
      <textarea name={`${id}Text`} rows={3} maxLength={maximum}
        defaultValue={initialText} required />
    </label> : <label className={styles.wide}>
      <span>{status === "missing" ? "缺值" : "不適用"}理由（至少 8 字）</span>
      <textarea name={`${id}Reason`} rows={3} minLength={8} maxLength={1_000}
        defaultValue={initialReason} required />
    </label>}
  </div>;
}

function ReportFields({ record }: { record?: ClientInspectionReportRecord }) {
  const [attachment, setAttachment] = useState<AttachmentState>(
    record?.attachmentStatus ?? "missing",
  );
  return <>
    <label><span>檢查類型</span><input name="reportType" maxLength={160}
      defaultValue={record?.reportType ?? ""} required /></label>
    <label><span>檢查日期</span><input name="examinedOn" type="date"
      defaultValue={record?.examinedOn ?? ""} required /></label>
    <TriStateField id="result" label="結果" maximum={4_000}
      initialStatus={record?.resultStatus}
      initialText={record?.resultText ?? ""}
      initialReason={record?.resultReason ?? ""} />
    <TriStateField id="source" label="來源" maximum={1_000}
      initialStatus={record?.sourceStatus}
      initialText={record?.sourceText ?? ""}
      initialReason={record?.sourceReason ?? ""} />
    <label><span>附件狀態</span><select name="attachmentStatus" value={attachment}
      onChange={(event) => setAttachment(event.target.value as AttachmentState)} required>
      {record?.attachmentStatus === "provided"
        ? <option value="provided">沿用既有可信附件證據</option> : null}
      <option value="missing">缺附件</option>
      <option value="not_applicable">不適用</option>
    </select></label>
    <p className={styles.inlineNote}>附件上傳、掃毒與私有下載尚未配置；本頁不接受檔案路徑、任意附件 ID 或自行宣稱已保存。</p>
    <input type="hidden" name="trustedAttachmentId"
      value={attachment === "provided" ? record?.attachmentId ?? "" : ""} />
    <input type="hidden" name="trustedAttachmentSha256"
      value={attachment === "provided" ? record?.attachmentSha256 ?? "" : ""} />
    <input type="hidden" name="trustedAttachmentFilename"
      value={attachment === "provided" ? record?.attachmentSourceFilename ?? "" : ""} />
  </>;
}

function contentFromForm(data: FormData) {
  const resultStatus = data.get("resultStatus");
  const sourceStatus = data.get("sourceStatus");
  const attachmentStatus = data.get("attachmentStatus");
  return {
    report_type: data.get("reportType"), examined_on: data.get("examinedOn"),
    result_status: resultStatus,
    result_text: resultStatus === "present" ? data.get("resultText") : null,
    result_reason: resultStatus === "present" ? null : data.get("resultReason"),
    source_status: sourceStatus,
    source_text: sourceStatus === "present" ? data.get("sourceText") : null,
    source_reason: sourceStatus === "present" ? null : data.get("sourceReason"),
    attachment_status: attachmentStatus,
    attachment_id: attachmentStatus === "provided"
      ? data.get("trustedAttachmentId") : null,
    attachment_sha256: attachmentStatus === "provided"
      ? data.get("trustedAttachmentSha256") : null,
    attachment_source_filename: attachmentStatus === "provided"
      ? data.get("trustedAttachmentFilename") : null,
  };
}

function successMessage(receipt: Awaited<ReturnType<typeof sendReport>>,
  action: "create" | "correct" | "void") {
  const base = action === "create" ? "原始版本已追加保存。" :
    action === "correct" ? "已追加更正版；原版本未被覆寫。" :
      "已追加作廢終端；全部舊版本仍保留。";
  if (!receipt.duplicateWarning) return base;
  return `${base} 系統發現重複提示：內容 ${receipt.exactDuplicateCount}、` +
    `關鍵欄位 ${receipt.keyFieldDuplicateCount}、附件雜湊 ${receipt.attachmentDuplicateCount} 筆；` +
    "只提出警示，未自動合併。";
}

export function ClientInspectionReportCreateForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: ClientInspectionReportSnapshot;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useOperationKey();
  if (!canManage) return null;
  return <details className={styles.composer}><summary>新增個案檢查報告</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        try {
          const input = parseClientInspectionReportInput({
            action: "create", report_key: operation.getReportKey(),
            previous_version_id: null, expected_base_version: 0,
            client_id: data.get("clientId"), ...contentFromForm(data),
            correction_reason: null,
          }, operation.getOrCreate());
          const receipt = await sendReport(input, snapshot);
          operation.markSucceeded(); setMessage(successMessage(receipt, "create"));
          form.reset(); router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>個案</span><select name="clientId" defaultValue="" required>
          <option value="" disabled>請選擇已授權個案</option>
          {snapshot.clientOptions.map((client) => <option key={client.clientId}
            value={client.clientId}>{client.clientCode} · {client.displayName}</option>)}
        </select></label>
        <ReportFields />
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加原始版本"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function ClientInspectionReportRevisionForm({ canRevise, snapshot }: {
  canRevise: boolean;
  snapshot: ClientInspectionReportSnapshot;
}) {
  const router = useRouter();
  const active = snapshot.records.filter(({ recordStatus }) => recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.recordVersionId ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useOperationKey();
  if (!canRevise || active.length === 0) return null;
  const record = active.find(({ recordVersionId }) => recordVersionId === selected) ?? active[0]!;
  return <details className={styles.composer}><summary>建立更正或作廢終端版本</summary>
    <label className={styles.topControl}><span>選擇目前終端版本</span>
      <select value={record.recordVersionId} onChange={(event) => {
        setSelected(event.target.value); operation.handleChange(() => setMessage(null));
      }}>{active.map((item) => <option key={item.recordVersionId}
        value={item.recordVersionId}>{item.clientDisplayName} · {item.reportType} · {item.examinedOn} · v{item.version}</option>)}</select>
    </label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        try {
          const input = parseClientInspectionReportInput(action === "void" ? {
            action: "void", report_key: record.reportKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version, client_id: record.clientId,
            correction_reason: data.get("reason"),
          } : {
            action: "correct", report_key: record.reportKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version, client_id: record.clientId,
            ...contentFromForm(data), correction_reason: data.get("reason"),
          }, operation.getOrCreate());
          const receipt = await sendReport(input, snapshot);
          operation.markSucceeded(); setMessage(successMessage(receipt, input.action));
          router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>操作</span><select value={action}
          onChange={(event) => setAction(event.target.value as "correct" | "void")}>
          <option value="correct">建立更正版</option>
          <option value="void">追加作廢終端</option>
        </select></label>
        {action === "correct" ? <ReportFields record={record} /> : null}
        <label className={styles.wide}><span>更正／作廢理由（至少 8 字）</span>
          <textarea name="reason" rows={3} minLength={8} maxLength={1_000} required />
        </label>
        <button className="button button--secondary" type="submit" disabled={pending}>
          {pending ? "保存中…" : action === "void" ? "追加作廢終端" : "追加更正版"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
