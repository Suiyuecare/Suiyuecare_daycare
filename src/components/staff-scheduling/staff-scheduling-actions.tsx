"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseDecideStaffScheduleApiEnvelope,
  parseDecideStaffScheduleInput,
  parseSubmitStaffScheduleApiEnvelope,
  parseSubmitStaffScheduleInput,
  STAFF_SCHEDULING_ACTION_HEADER,
} from "@/lib/staff-scheduling/parser";
import type {
  DecideStaffScheduleInput,
  StaffScheduleRecord,
  StaffSchedulingSnapshot,
} from "@/lib/staff-scheduling/types";

import styles from "./staff-scheduling.module.css";

function resultUnknown(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof Error &&
    (error.message.includes("fetch") || error.message.includes("request failed"))) {
    return "連線中斷、逾時或伺服器未回傳可核對回執，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return "回執與送出內容不一致，結果未知；請先重新核對快照，內容未修改時保留相同操作鍵重試。";
}

function useKeys() {
  const operation = useRef<string | null>(null);
  const entity = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    operation() { operation.current ??= crypto.randomUUID(); return operation.current; },
    entity() { entity.current ??= crypto.randomUUID(); return entity.current; },
    failed() { failed.current = true; },
    succeeded() { operation.current = null; entity.current = null; failed.current = false; },
    changed(clear: () => void) {
      if (!failed.current) return;
      operation.current = null; entity.current = null; failed.current = false; clear();
    },
  };
}

async function readResponse(response: Response) {
  const value: unknown = await response.json();
  if (!response.ok) throw new Error("staff scheduling request failed");
  return value;
}

function taipeiLocal(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function parseTaipeiLocal(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) {
    throw new Error("invalid datetime");
  }
  return new Date(`${value}:00+08:00`).toISOString();
}

function Reauth({ title }: { title: string }) {
  return <section className={styles.reauth}><h2>{title}</h2>
    <p>建立、發布、駁回或衝突覆核，都必須使用同一工作階段最近 15 分鐘內的雙重驗證。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">
      前往雙重驗證
    </Link></section>;
}

export function StaffScheduleDraftForm({ canManage, hasRecentAal2, snapshot }: {
  canManage: boolean;
  hasRecentAal2: boolean;
  snapshot: StaffSchedulingSnapshot;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("new");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useKeys();
  if (!canManage || snapshot.demo) return null;
  if (snapshot.ruleConfigurationStatus === "not_configured") return <section
    className={styles.blocked} role="alert"><h2>規則未完整配置，停止建立班表</h2>
    <p>資格、工時、休息、場地、車輛與容量必須由機構發布同一有效版本後才可建立草稿。</p>
  </section>;
  if (!hasRecentAal2) return <Reauth title="建立或更正班表前需重新驗證" />;
  const revisable = snapshot.records.filter((record) =>
    record.status === "draft_ready" || record.status === "draft_conflicted");
  const existing = revisable.find((record) => record.scheduleKey === selected) ?? null;
  const rule = snapshot.ruleVersion!;
  const defaultStart = existing ? taipeiLocal(existing.startsAt) :
    `${snapshot.filters.periodStart}T09:00`;
  const defaultEnd = existing ? taipeiLocal(existing.endsAt) :
    `${snapshot.filters.periodStart}T17:00`;
  return <details className={styles.composer}><summary>建立規則檢查草稿／建立更正版</summary>
    <form key={existing?.scheduleVersionId ?? "new"}
      onInput={() => keys.changed(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        try {
          const data = new FormData(event.currentTarget);
          const input = parseSubmitStaffScheduleInput({
            action: existing ? "revise" : "create",
            schedule_key: existing?.scheduleKey ?? keys.entity(),
            previous_version_id: existing?.scheduleVersionId ?? null,
            expected_version: existing?.version ?? 0,
            expected_content_hash: existing?.contentHash ?? null,
            staff_membership_id: data.get("staff"),
            starts_at: parseTaipeiLocal(data.get("startsAt")),
            ends_at: parseTaipeiLocal(data.get("endsAt")),
            role_text: data.get("role"), service_need_text: data.get("serviceNeed"),
            facility_code: data.get("facility"), vehicle_code: data.get("vehicle"),
            planned_clients: Number(data.get("plannedClients")),
            revision_reason: data.get("reason"),
          }, keys.operation());
          const response = await fetchWithTimeout("/api/staff-scheduling", {
            method: "POST", cache: "no-store", headers: {
              "content-type": "application/json", "idempotency-key": input.idempotencyKey,
              [STAFF_SCHEDULING_ACTION_HEADER]: "submit_schedule",
            }, body: JSON.stringify({ action: input.action,
              schedule_key: input.scheduleKey,
              previous_version_id: input.previousVersionId,
              expected_version: input.expectedVersion,
              expected_content_hash: input.expectedContentHash,
              staff_membership_id: input.staffMembershipId,
              starts_at: input.startsAt, ends_at: input.endsAt,
              role_text: input.roleText, service_need_text: input.serviceNeedText,
              facility_code: input.facilityCode, vehicle_code: input.vehicleCode,
              planned_clients: input.plannedClients,
              revision_reason: input.revisionReason }),
          });
          const receipt = parseSubmitStaffScheduleApiEnvelope(await readResponse(response),
            input, snapshot.organizationId, snapshot.branchId, response.status);
          keys.succeeded(); setMessage(receipt.conflictCount === 0
            ? "規則檢查草稿已凍結，沒有偵測到衝突；仍須由另一位授權人員核准。"
            : `草稿已凍結並保留 ${receipt.conflictCount} 項可解釋衝突；不會自動發布。`);
          router.refresh();
        } catch (error) { keys.failed(); setMessage(resultUnknown(error)); }
        finally { setPending(false); }
      }}><fieldset className={styles.formGrid} disabled={pending}>
      <label className={styles.wide}><span>操作</span><select value={selected}
        onChange={(event) => { setSelected(event.target.value); keys.changed(() => setMessage(null)); }}>
        <option value="new">建立新班表草稿</option>{revisable.map((record) =>
          <option key={record.scheduleKey} value={record.scheduleKey}>
            更正：{record.staffDisplayName} · {taipeiLocal(record.startsAt)} · v{record.version}
          </option>)}</select></label>
      <label><span>員工</span><select name="staff" required
        defaultValue={existing?.staffMembershipId ?? ""}>
        <option value="" disabled>選擇本分支在職員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.displayName}{staff.employeeCode ? ` · ${staff.employeeCode}` : ""}
          </option>)}</select></label>
      <label><span>職務（機構人工規則）</span><select name="role" required
        defaultValue={existing?.roleText ?? ""}><option value="" disabled>選擇職務</option>
        {rule.qualificationRules.map((item) => <option key={item.roleText}
          value={item.roleText}>{item.roleText} · 需 {item.requiredCertificateType}</option>)}</select></label>
      <label><span>開始時間（台北）</span><input name="startsAt" type="datetime-local"
        defaultValue={defaultStart} required /></label>
      <label><span>結束時間（台北）</span><input name="endsAt" type="datetime-local"
        defaultValue={defaultEnd} required /></label>
      <label><span>場地</span><select name="facility" required
        defaultValue={existing?.facilityCode ?? ""}><option value="" disabled>選擇場地</option>
        {rule.facilities.map((item) => <option key={item.code} value={item.code}>
          {item.name} · 容量 {item.capacity}</option>)}</select></label>
      <label><span>車輛</span><select name="vehicle" required
        defaultValue={existing?.vehicleCode ?? ""}><option value="" disabled>選擇車輛</option>
        {rule.vehicles.map((item) => <option key={item.code} value={item.code}>
          {item.name} · 容量 {item.capacity}</option>)}</select></label>
      <label><span>預計服務人數</span><input name="plannedClients" type="number" min={1}
        max={10000} defaultValue={existing?.plannedClients ?? 1} required /></label>
      <label className={styles.wide}><span>服務需求（人工文字）</span>
        <textarea name="serviceNeed" maxLength={500} required
          defaultValue={existing?.serviceNeedText ?? ""} /></label>
      <label className={styles.wide}><span>{existing ? "更正理由" : "建立理由"}</span>
        <textarea name="reason" maxLength={1000} required
          defaultValue={existing ? "依最新服務安排建立不可變更正版。" : "依已發布人工規則建立班表草稿。"} /></label>
      <button className="button button--primary" type="submit">
        {pending ? "檢查並凍結中…" : existing ? "檢查並建立更正版" : "檢查並建立草稿"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}

function decisionOptions(record: StaffScheduleRecord, canOverride: boolean) {
  if (record.conflictCount === 0) return ["publish", "reject"] as const;
  return canOverride ? ["override", "reject"] as const : ["reject"] as const;
}

export function StaffScheduleDecisionForm({
  canApprove, canOverride, currentUserId, hasRecentAal2, snapshot,
}: {
  canApprove: boolean;
  canOverride: boolean;
  currentUserId: string;
  hasRecentAal2: boolean;
  snapshot: StaffSchedulingSnapshot;
}) {
  const router = useRouter();
  const reviewable = snapshot.records.filter((record) =>
    (record.status === "draft_ready" || record.status === "draft_conflicted") &&
    record.createdBy !== currentUserId);
  const [selectedId, setSelectedId] = useState(reviewable[0]?.scheduleVersionId ?? "");
  const [decision, setDecision] = useState<DecideStaffScheduleInput["decision"]>(
    reviewable[0]?.conflictCount ? canOverride ? "override" : "reject" : "publish",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useKeys();
  if (!canApprove || snapshot.demo || reviewable.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="獨立審核班表前需重新驗證" />;
  const selected = reviewable.find((item) => item.scheduleVersionId === selectedId) ?? reviewable[0]!;
  const options = decisionOptions(selected, canOverride);
  const safeDecision = options.includes(decision as never) ? decision : options[0];
  return <details className={styles.composer}><summary>獨立發布、駁回或衝突覆核</summary>
    <form onInput={() => keys.changed(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        try {
          const data = new FormData(event.currentTarget);
          const choice = data.get("decision");
          const input = parseDecideStaffScheduleInput({ action: "decide",
            schedule_version_id: selected.scheduleVersionId,
            expected_schedule_key: selected.scheduleKey,
            expected_version: selected.version,
            expected_content_hash: selected.contentHash,
            expected_conflict_count: selected.conflictCount,
            expected_rule_version_id: selected.ruleVersionId,
            decision: choice, reason: data.get("reason"),
          }, keys.operation(), choice as DecideStaffScheduleInput["decision"]);
          const response = await fetchWithTimeout("/api/staff-scheduling", {
            method: "PATCH", cache: "no-store", headers: {
              "content-type": "application/json", "idempotency-key": input.idempotencyKey,
              [STAFF_SCHEDULING_ACTION_HEADER]: `${input.decision}_schedule`,
            }, body: JSON.stringify({ action: "decide",
              schedule_version_id: input.scheduleVersionId,
              expected_schedule_key: input.expectedScheduleKey,
              expected_version: input.expectedVersion,
              expected_content_hash: input.expectedContentHash,
              expected_conflict_count: input.expectedConflictCount,
              expected_rule_version_id: input.expectedRuleVersionId,
              decision: input.decision, reason: input.reason }),
          });
          parseDecideStaffScheduleApiEnvelope(await readResponse(response), input,
            snapshot.organizationId, snapshot.branchId, response.status);
          keys.succeeded(); setMessage(input.decision === "publish" ? "班表已獨立核准發布。" :
            input.decision === "override" ? "衝突與覆核理由已保留，班表以例外覆核發布。" :
              "草稿已以不可變作廢版本駁回。");
          router.refresh();
        } catch (error) { keys.failed(); setMessage(resultUnknown(error)); }
        finally { setPending(false); }
      }}><fieldset className={styles.formGrid} disabled={pending}>
      <label className={styles.wide}><span>待審草稿</span><select value={selected.scheduleVersionId}
        onChange={(event) => {
          const next = reviewable.find((item) => item.scheduleVersionId === event.target.value);
          setSelectedId(event.target.value);
          setDecision(next?.conflictCount ? canOverride ? "override" : "reject" : "publish");
          keys.changed(() => setMessage(null));
        }}>{reviewable.map((record) => <option key={record.scheduleVersionId}
          value={record.scheduleVersionId}>{record.staffDisplayName} · v{record.version} ·
          {record.conflictCount ? ` ${record.conflictCount} 項衝突` : " 無衝突"}</option>)}</select></label>
      <label><span>決定</span><select name="decision" value={safeDecision}
        onChange={(event) => setDecision(event.target.value as DecideStaffScheduleInput["decision"])}>
        {options.includes("publish" as never) ? <option value="publish">發布無衝突班表</option> : null}
        {options.includes("override" as never) ? <option value="override">有理由覆核衝突並發布</option> : null}
        <option value="reject">駁回並建立作廢版本</option>
      </select></label>
      <p className={styles.wide}>{selected.conflictCount === 0
        ? "無衝突草稿仍不會自動發布，必須由非建立人核准。"
        : `此草稿保留 ${selected.conflictCount} 項衝突；一般發布被禁止，只有具覆核權限者可寫明理由例外發布。`}</p>
      <label className={styles.wide}><span>審核／覆核理由</span>
        <textarea name="reason" maxLength={1000} required /></label>
      <button className="button button--primary" type="submit">
        {pending ? "核對並送出中…" : "送出獨立審核"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}
