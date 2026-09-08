"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseStaffTrainingRecordApiEnvelope,
  parseStaffTrainingRecordInput,
  parseStaffTrainingRuleApiEnvelope,
  parseStaffTrainingRuleInput,
} from "@/lib/staff-training/parser";
import type {
  StaffTrainingRecord,
  StaffTrainingSnapshot,
} from "@/lib/staff-training/types";

import styles from "./staff-training.module.css";

function localDateTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

function messageFor(error: unknown) {
  if (isClientFetchTimeoutError(error)) {
    return "連線逾時，操作結果未知；內容未修改時請使用原操作鍵重試。";
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，操作結果未知；內容未修改時請使用原操作鍵重試。";
  }
  return "操作未確認完成；請重新檢查資料，內容未修改時可使用原操作鍵重試。";
}

function useOperationKey() {
  const key = useRef<string | null>(null);
  const failed = useRef(false);
  const fingerprint = useRef<string | null>(null);
  return {
    getOrCreate(nextFingerprint: string | null = null) {
      if (key.current !== null && fingerprint.current !== nextFingerprint) {
        key.current = null;
        failed.current = false;
      }
      key.current ??= crypto.randomUUID();
      fingerprint.current = nextFingerprint;
      return key.current;
    },
    markFailed() { failed.current = true; },
    markSucceeded() { key.current = null; fingerprint.current = null; failed.current = false; },
    handleChange(clear: () => void) {
      if (failed.current) {
        key.current = null;
        fingerprint.current = null;
        failed.current = false;
        clear();
      }
    },
  };
}

async function sendRecord(input: ReturnType<typeof parseStaffTrainingRecordInput>,
  snapshot: StaffTrainingSnapshot) {
  const response = await fetchWithTimeout("/api/staff-training/records", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({
      action: input.action,
      training_key: input.trainingKey,
      previous_version_id: input.previousVersionId,
      expected_base_version: input.expectedBaseVersion,
      staff_membership_id: input.staffMembershipId,
      ...(input.action === "void" ? {
        correction_reason: input.correctionReason,
      } : {
        course_title: input.courseTitle,
        training_date: input.trainingDate,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        course_type: input.courseType,
        hours: input.hours,
        credits: input.credits,
        provider_name: input.providerName,
        evidence_status: input.evidenceStatus,
        attachment_reference: null,
        attachment_sha256: null,
        correction_reason: input.correctionReason,
      }),
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("staff training save failed");
  return parseStaffTrainingRecordApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId,
  );
}

export function StaffTrainingRecordCreateForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffTrainingSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  return <details className={styles.composer} open>
    <summary>新增教育訓練紀錄</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const operationKey = operation.getOrCreate();
        try {
          const startsAt = toIso(String(data.get("startsAt")));
          const input = parseStaffTrainingRecordInput({
            action: "create", training_key: operationKey,
            previous_version_id: null, expected_base_version: 0,
            staff_membership_id: data.get("staff"),
            course_title: data.get("courseTitle"),
            training_date: String(data.get("startsAt")).slice(0, 10),
            starts_at: startsAt, ends_at: toIso(String(data.get("endsAt"))),
            course_type: data.get("courseType"), hours: data.get("hours"),
            credits: String(data.get("credits") ?? "").trim() || null,
            provider_name: data.get("provider"),
            evidence_status: data.get("evidenceStatus"),
            attachment_reference: null, attachment_sha256: null,
            correction_reason: null,
          }, operationKey);
          await sendRecord(input, snapshot);
          operation.markSucceeded(); form.reset();
          setMessage("教育訓練紀錄已追加保存。"); router.refresh();
        } catch (error) {
          operation.markFailed(); setMessage(messageFor(error));
        } finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>員工（穩定人員識別）</span><select name="staff" required defaultValue="">
          <option value="">請選擇在職員工</option>
          {snapshot.staffOptions.filter((staff) => staff.isCurrent).map((staff) =>
            <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
              {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            </option>)}</select></label>
        <label><span>課程名稱</span><input name="courseTitle" maxLength={240} required /></label>
        <label><span>課程類型（機構命名）</span><input name="courseType" maxLength={120} required /></label>
        <label><span>辦理單位</span><input name="provider" maxLength={200} required /></label>
        <label><span>開始時間（台北）</span><input name="startsAt" type="datetime-local"
          max={localDateTime(snapshot.generatedAt)} required /></label>
        <label><span>結束時間（台北）</span><input name="endsAt" type="datetime-local"
          max={localDateTime(snapshot.generatedAt)} required /></label>
        <label><span>時數（最多四位小數）</span><input name="hours" inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,4})?" required /></label>
        <label><span>積分（未核定請留空）</span><input name="credits" inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,4})?" /></label>
        <label><span>證明狀態</span><select name="evidenceStatus" defaultValue="missing" required>
          <option value="missing">缺證明</option>
          <option value="not_applicable">不適用</option>
        </select></label>
        <p className={styles.wide} role="note">附件上傳、掃毒與可信伺服器參照尚未配置；本版不能把檔案冒充為已提供證明。</p>
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "保存中…" : "追加訓練紀錄"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function StaffTrainingRecordRevisionForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: StaffTrainingSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const active = snapshot.records.filter((record) => record.recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.trainingKey ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const record = active.find((item) => item.trainingKey === selected) ?? null;
  if (!canManage || active.length === 0) return null;
  return <details className={styles.composer}>
    <summary>建立更正版或作廢版本</summary>
    <label className={styles.topControl}><span>目前有效紀錄</span><select value={selected}
      disabled={pending} onChange={(event) => { setSelected(event.target.value);
        operation.handleChange(() => setMessage(null)); }}>
      {active.map((item) => <option key={item.trainingKey} value={item.trainingKey}>
        {item.staffDisplayName} · {item.courseTitle} · v{item.version}
      </option>)}</select></label>
    {record ? <RevisionForm key={`${record.recordVersionId}:${action}`} action={action}
      operation={operation} pending={pending} record={record} setAction={setAction}
      setMessage={setMessage} setPending={setPending} snapshot={snapshot}
      onSuccess={() => router.refresh()} /> : null}
    {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
  </details>;
}

function RevisionForm({ action, onSuccess, operation, pending, record, setAction,
  setMessage, setPending, snapshot }: {
  action: "correct" | "void";
  onSuccess: () => void;
  operation: ReturnType<typeof useOperationKey>;
  pending: boolean;
  record: StaffTrainingRecord;
  setAction: (action: "correct" | "void") => void;
  setMessage: (message: string | null) => void;
  setPending: (pending: boolean) => void;
  snapshot: StaffTrainingSnapshot;
}) {
  return <form onChange={() => operation.handleChange(() => setMessage(null))}
    onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      const data = new FormData(event.currentTarget);
      const operationKey = operation.getOrCreate();
      try {
        const input = parseStaffTrainingRecordInput(action === "void" ? {
          action: "void", training_key: record.trainingKey,
          previous_version_id: record.recordVersionId,
          expected_base_version: record.version,
          staff_membership_id: record.staffMembershipId,
          correction_reason: data.get("reason"),
        } : {
          action: "correct", training_key: record.trainingKey,
          previous_version_id: record.recordVersionId,
          expected_base_version: record.version,
          staff_membership_id: record.staffMembershipId,
          course_title: data.get("courseTitle"),
          training_date: String(data.get("startsAt")).slice(0, 10),
          starts_at: toIso(String(data.get("startsAt"))),
          ends_at: toIso(String(data.get("endsAt"))),
          course_type: data.get("courseType"), hours: data.get("hours"),
          credits: String(data.get("credits") ?? "").trim() || null,
          provider_name: data.get("provider"),
          evidence_status: data.get("evidenceStatus"),
          attachment_reference: null, attachment_sha256: null,
          correction_reason: data.get("reason"),
        }, operationKey);
        await sendRecord(input, snapshot);
        operation.markSucceeded();
        setMessage(action === "void" ? "已追加作廢版本；原紀錄仍完整保留。" :
          "已追加更正版；原紀錄未被覆寫。");
        onSuccess();
      } catch (error) {
        operation.markFailed(); setMessage(messageFor(error));
      } finally { setPending(false); }
    }}>
    <fieldset className={styles.formGrid} disabled={pending}>
      <label><span>操作</span><select value={action}
        onChange={(event) => setAction(event.target.value as "correct" | "void")}>
        <option value="correct">建立更正版</option><option value="void">追加作廢版本</option>
      </select></label>
      {action === "correct" ? <>
        <label><span>課程名稱</span><input name="courseTitle" maxLength={240}
          defaultValue={record.courseTitle} required /></label>
        <label><span>課程類型</span><input name="courseType" maxLength={120}
          defaultValue={record.courseType} required /></label>
        <label><span>辦理單位</span><input name="provider" maxLength={200}
          defaultValue={record.providerName} required /></label>
        <label><span>開始時間（台北）</span><input name="startsAt" type="datetime-local"
          max={localDateTime(snapshot.generatedAt)} defaultValue={localDateTime(record.startsAt)} required /></label>
        <label><span>結束時間（台北）</span><input name="endsAt" type="datetime-local"
          max={localDateTime(snapshot.generatedAt)} defaultValue={localDateTime(record.endsAt)} required /></label>
        <label><span>時數</span><input name="hours" inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,4})?" defaultValue={record.hours} required /></label>
        <label><span>積分</span><input name="credits" inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,4})?" defaultValue={record.credits ?? ""} /></label>
        <label><span>證明狀態</span><select name="evidenceStatus"
          defaultValue={record.evidenceStatus === "provided" ? "missing" : record.evidenceStatus}>
          <option value="missing">缺證明</option><option value="not_applicable">不適用</option>
        </select></label>
      </> : null}
      <label className={styles.wide}><span>更正／作廢理由</span>
        <textarea name="reason" maxLength={1000} required /></label>
      <button className="button button--secondary" type="submit" disabled={pending}>
        {pending ? "保存中…" : action === "void" ? "確認追加作廢版本" : "確認建立更正版"}
      </button>
    </fieldset>
  </form>;
}

export function StaffTrainingRuleForms({ canRules, hasRecentAal2, snapshot }: {
  canRules: boolean;
  hasRecentAal2: boolean;
  snapshot: StaffTrainingSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canRules) return null;
  async function submit(value: unknown) {
    const key = operation.getOrCreate(JSON.stringify(value));
    const input = parseStaffTrainingRuleInput(value, key);
    const response = await fetchWithTimeout("/api/staff-training/rules", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(input.action === "propose" ? {
        action: "propose", effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo, window_years: input.windowYears,
        required_credits: input.requiredCredits,
        expiry_notice_days: input.expiryNoticeDays,
      } : { action: "publish", proposal_id: input.proposalId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error("staff training rule failed");
    parseStaffTrainingRuleApiEnvelope(payload, input,
      snapshot.organizationId, snapshot.branchId);
  }
  return <section className={styles.ruleGovernance} aria-labelledby="training-rules-heading">
    <h2 id="training-rules-heading">機構規則治理</h2>
    {!hasRecentAal2 ? <p className={styles.warning} role="alert">
      提案與發布前，請在 15 分鐘內重新完成雙因素驗證。
    </p> : null}
    <details className={styles.composer}>
      <summary>建立待第二人發布的規則提案</summary>
      <form onChange={() => operation.handleChange(() => setMessage(null))}
        onSubmit={async (event) => {
          event.preventDefault(); setPending(true); setMessage(null);
          const data = new FormData(event.currentTarget);
          try {
            await submit({ action: "propose", effective_from: data.get("effectiveFrom"),
              effective_to: String(data.get("effectiveTo") ?? "").trim() || null,
              window_years: Number(data.get("windowYears")),
              required_credits: data.get("requiredCredits"),
              expiry_notice_days: Number(data.get("expiryNoticeDays")) });
            operation.markSucceeded(); setMessage("規則提案已保存，須由另一位授權人員發布。");
            router.refresh();
          } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
          finally { setPending(false); }
        }}>
        <fieldset className={styles.formGrid} disabled={pending || !hasRecentAal2}>
          <label><span>生效日</span><input name="effectiveFrom" type="date"
            min={snapshot.snapshotDate} required /></label>
          <label><span>失效日（選填）</span><input name="effectiveTo" type="date"
            min={snapshot.snapshotDate} /></label>
          <label><span>滾動視窗年數</span><input name="windowYears" type="number"
            min={1} max={50} required /></label>
          <label><span>機構要求積分</span><input name="requiredCredits" inputMode="decimal"
            pattern="[0-9]+([.][0-9]{1,4})?" required /></label>
          <label><span>到期提醒天數</span><input name="expiryNoticeDays" type="number"
            min={0} max={3650} required /></label>
          <button className="button button--secondary" type="submit"
            disabled={pending || !hasRecentAal2}>{pending ? "保存中…" : "建立規則提案"}</button>
        </fieldset>
      </form>
    </details>
    {snapshot.pendingRuleProposals.map((proposal) => <form key={proposal.proposalId}
      className={styles.publishRow}
      onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        try {
          await submit({ action: "publish", proposal_id: proposal.proposalId });
          operation.markSucceeded(); setMessage("規則版本已由第二人發布，不回溯改算舊快照。");
          router.refresh();
        } catch (error) { operation.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset disabled={pending || !hasRecentAal2}>
        <span>{proposal.effectiveFrom} 起 · {proposal.windowYears} 年 · {proposal.requiredCredits} 點 · 提案人 {proposal.proposerDisplayName}</span>
        <button className="button button--secondary" type="submit"
          disabled={pending || !hasRecentAal2}>由第二人發布</button>
      </fieldset>
    </form>)}
    {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
  </section>;
}
