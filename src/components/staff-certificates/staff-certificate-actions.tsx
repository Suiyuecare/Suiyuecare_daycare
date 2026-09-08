"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseStaffCertificateExceptionApiEnvelope,
  parseStaffCertificateExceptionInput,
  parseStaffCertificateRecordApiEnvelope,
  parseStaffCertificateRecordInput,
} from "@/lib/staff-certificates/parser";
import type {
  StaffCertificateRecord,
  StaffCertificateSnapshot,
} from "@/lib/staff-certificates/types";

import styles from "./staff-certificates.module.css";

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
  input: ReturnType<typeof parseStaffCertificateRecordInput>,
  snapshot: StaffCertificateSnapshot,
) {
  const response = await fetchWithTimeout("/api/staff-certificates/records", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({
      action: input.action, certificate_key: input.certificateKey,
      previous_version_id: input.previousVersionId,
      expected_base_version: input.expectedBaseVersion,
      staff_membership_id: input.staffMembershipId,
      ...(input.action === "void" ? { correction_reason: input.correctionReason } : {
        certificate_type: input.certificateType,
        certificate_number: input.certificateNumber,
        effective_on: input.effectiveOn, expires_on: input.expiresOn,
        registration_status: input.registrationStatus,
        verification_status: input.verificationStatus,
        evidence_status: input.evidenceStatus,
        attachment_reference: null, attachment_sha256: null,
        correction_reason: input.correctionReason,
      }),
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff certificate save failed");
  return parseStaffCertificateRecordApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

async function sendException(
  input: ReturnType<typeof parseStaffCertificateExceptionInput>,
  snapshot: StaffCertificateSnapshot,
) {
  const response = await fetchWithTimeout("/api/staff-certificates/exceptions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input.action === "request" ? {
      action: "request", certificate_key: input.certificateKey,
      certificate_version_id: input.certificateVersionId,
      expected_certificate_version: input.expectedCertificateVersion,
      valid_from: input.validFrom, valid_through: input.validThrough,
      reason: input.reason,
    } : {
      action: "approve", request_id: input.requestId,
      certificate_key: input.certificateKey,
      certificate_version_id: input.certificateVersionId,
      expected_certificate_version: input.expectedCertificateVersion,
      expected_approval_count: input.expectedApprovalCount,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff certificate exception save failed");
  return parseStaffCertificateExceptionApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function CertificateFields({ record }: { record?: StaffCertificateRecord }) {
  return <>
    <label><span>證照類型</span><input name="certificateType" maxLength={120}
      defaultValue={record?.certificateType ?? ""} required /></label>
    <label><span>證號</span><input name="certificateNumber" maxLength={160}
      autoComplete="off" defaultValue={record?.certificateNumber ?? ""} required /></label>
    <label><span>生效日</span><input name="effectiveOn" type="date"
      defaultValue={record?.effectiveOn ?? ""} required /></label>
    <label><span>到期日（無明確期限可留空）</span><input name="expiresOn" type="date"
      min={record?.effectiveOn} defaultValue={record?.expiresOn ?? ""} /></label>
    <label><span>登錄狀態</span><select name="registrationStatus"
      defaultValue={record?.registrationStatus ?? "pending"} required>
      <option value="pending">待登錄</option><option value="registered">已登錄</option>
      <option value="not_required">不適用</option><option value="suspended">暫停</option>
    </select></label>
    <label><span>核驗狀態</span><select name="verificationStatus"
      defaultValue={record?.verificationStatus ?? "pending"} required>
      <option value="pending">待核驗</option><option value="verified">已核驗</option>
      <option value="rejected">核驗不通過</option>
    </select></label>
    <label><span>證明狀態</span><select name="evidenceStatus"
      defaultValue={record?.evidenceStatus === "not_applicable" ? "not_applicable" : "missing"}
      required><option value="missing">缺證明</option>
      <option value="not_applicable">不適用</option></select></label>
  </>;
}

export function StaffCertificateCreateForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffCertificateSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  return <details className={styles.composer} open>
    <summary>新增員工證照</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const key = operation.getOrCreate();
        try {
          const input = parseStaffCertificateRecordInput({
            action: "create", certificate_key: key, previous_version_id: null,
            expected_base_version: 0, staff_membership_id: data.get("staff"),
            certificate_type: data.get("certificateType"),
            certificate_number: data.get("certificateNumber"),
            effective_on: data.get("effectiveOn"),
            expires_on: String(data.get("expiresOn") ?? "").trim() || null,
            registration_status: data.get("registrationStatus"),
            verification_status: data.get("verificationStatus"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: null,
          }, key);
          await sendRecord(input, snapshot); operation.markSucceeded(); form.reset();
          setMessage("證照原始版本已追加保存。"); router.refresh();
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
        <CertificateFields />
        <p className={styles.wide} role="note">附件上傳、掃毒與可信伺服器參照尚未配置；本版不接受瀏覽器路徑或任意附件參照。</p>
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加證照版本"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function StaffCertificateRevisionForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffCertificateSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const active = snapshot.records.filter((record) => record.recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.certificateKey ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const record = active.find((item) => item.certificateKey === selected) ?? null;
  if (!canManage || !record) return null;
  return <details className={styles.composer}>
    <summary>建立更正版或作廢版本</summary>
    <label className={styles.topControl}><span>目前終端版本</span>
      <select value={selected} disabled={pending} onChange={(event) => {
        setSelected(event.target.value); operation.handleChange(() => setMessage(null));
      }}>{active.map((item) => <option key={item.certificateKey} value={item.certificateKey}>
        {item.staffDisplayName} · {item.certificateType} · v{item.version}
      </option>)}</select></label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        const key = operation.getOrCreate();
        try {
          const input = parseStaffCertificateRecordInput(action === "void" ? {
            action: "void", certificate_key: record.certificateKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            correction_reason: data.get("reason"),
          } : {
            action: "correct", certificate_key: record.certificateKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version,
            staff_membership_id: record.staffMembershipId,
            certificate_type: data.get("certificateType"),
            certificate_number: data.get("certificateNumber"),
            effective_on: data.get("effectiveOn"),
            expires_on: String(data.get("expiresOn") ?? "").trim() || null,
            registration_status: data.get("registrationStatus"),
            verification_status: data.get("verificationStatus"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: data.get("reason"),
          }, key);
          await sendRecord(input, snapshot); operation.markSucceeded();
          setMessage(action === "void" ? "已追加作廢版本；原紀錄完整保留。" :
            "已追加更正版；原版本未被覆寫。"); router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>操作</span><select value={action}
          onChange={(event) => setAction(event.target.value as "correct" | "void")}>
          <option value="correct">建立更正版</option><option value="void">追加作廢版本</option>
        </select></label>
        {action === "correct" ? <CertificateFields record={record} /> : null}
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

export function StaffCertificateExceptionForms({
  canExceptions, hasRecentAal2, snapshot,
}: {
  canExceptions: boolean;
  hasRecentAal2: boolean;
  snapshot: StaffCertificateSnapshot;
}) {
  const router = useRouter();
  const requestOperation = useOperationKey();
  const approvalOperation = useOperationKey();
  const eligibleRecords = snapshot.records.filter((record) => record.recordStatus === "active");
  const pendingRequests = snapshot.exceptionRequests.filter((request) =>
    request.exceptionStatus === "pending" && request.approvalCount < 2);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canExceptions) return null;
  return <section className={styles.exceptionForms} aria-labelledby="certificate-exception-heading">
    <h2 id="certificate-exception-heading">有限期間資格例外</h2>
    {!hasRecentAal2 ? <p className={styles.warning} role="alert">
      申請與每次核准都需要最近 15 分鐘的 AAL2 驗證。
      <Link href="/mfa">前往重新驗證</Link>
    </p> : null}
    <p role="note">例外須由兩名不同授權人員核准，申請人不能自批。即使完成兩次核准，受限制服務規則尚未發布，本頁仍不會宣稱可排入任何服務。</p>
    {eligibleRecords.length ? <details className={styles.composer}>
      <summary>申請有限期間例外</summary>
      <form onChange={() => requestOperation.handleChange(() => setMessage(null))}
        onSubmit={async (event) => {
          event.preventDefault(); setPending(true); setMessage(null);
          const data = new FormData(event.currentTarget);
          const record = eligibleRecords.find((item) =>
            item.recordVersionId === data.get("record"));
          const key = requestOperation.getOrCreate();
          try {
            if (!record) throw new Error("record missing");
            const input = parseStaffCertificateExceptionInput({
              action: "request", certificate_key: record.certificateKey,
              certificate_version_id: record.recordVersionId,
              expected_certificate_version: record.version,
              valid_from: data.get("validFrom"),
              valid_through: data.get("validThrough"), reason: data.get("reason"),
            }, key);
            await sendException(input, snapshot); requestOperation.markSucceeded();
            setMessage("例外申請已保存，尚需兩名獨立授權人員核准。"); router.refresh();
          } catch (error) { requestOperation.markFailed(); setMessage(messageFor(error)); }
          finally { setPending(false); }
        }}>
        <fieldset className={styles.formGrid} disabled={pending || !hasRecentAal2}>
          <label className={styles.wide}><span>證照終端版本</span>
            <select name="record" required defaultValue="">
              <option value="">請選擇證照</option>{eligibleRecords.map((record) =>
                <option key={record.recordVersionId} value={record.recordVersionId}>
                  {record.staffDisplayName} · {record.certificateType} · v{record.version}
                </option>)}</select></label>
          <label><span>例外起始日</span><input name="validFrom" type="date" required /></label>
          <label><span>例外截止日</span><input name="validThrough" type="date" required /></label>
          <label className={styles.wide}><span>具體理由</span>
            <textarea name="reason" rows={3} maxLength={1_000} required /></label>
          <button className="button button--secondary" type="submit"
            disabled={pending || !hasRecentAal2}>送出例外申請</button>
        </fieldset>
      </form>
    </details> : null}
    {pendingRequests.length ? <details className={styles.composer}>
      <summary>追加獨立核准</summary>
      <form onChange={() => approvalOperation.handleChange(() => setMessage(null))}
        onSubmit={async (event) => {
          event.preventDefault(); setPending(true); setMessage(null);
          const data = new FormData(event.currentTarget);
          const request = pendingRequests.find((item) => item.requestId === data.get("request"));
          const key = approvalOperation.getOrCreate();
          try {
            if (!request) throw new Error("request missing");
            const input = parseStaffCertificateExceptionInput({
              action: "approve", request_id: request.requestId,
              certificate_key: request.certificateKey,
              certificate_version_id: request.certificateVersionId,
              expected_certificate_version: request.expectedCertificateVersion,
              expected_approval_count: request.approvalCount,
            }, key);
            await sendException(input, snapshot); approvalOperation.markSucceeded();
            setMessage(request.approvalCount === 1 ? "第二次獨立核准已保存。" :
              "第一次獨立核准已保存，尚需另一名授權人員。"); router.refresh();
          } catch (error) { approvalOperation.markFailed(); setMessage(messageFor(error)); }
          finally { setPending(false); }
        }}>
        <fieldset className={styles.formGrid} disabled={pending || !hasRecentAal2}>
          <label className={styles.wide}><span>待核准申請</span>
            <select name="request" required defaultValue="">
              <option value="">請選擇申請</option>{pendingRequests.map((request) =>
                <option key={request.requestId} value={request.requestId}>
                  {request.validFrom}–{request.validThrough} · 已核准 {request.approvalCount}/2 · {request.requesterDisplayName}
                </option>)}</select></label>
          <button className="button button--primary" type="submit"
            disabled={pending || !hasRecentAal2}>追加本人的獨立核准</button>
        </fieldset>
      </form>
    </details> : null}
    {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
  </section>;
}
