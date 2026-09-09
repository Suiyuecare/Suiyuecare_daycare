"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseStaffDecisionApiEnvelope,
  parseStaffEmploymentProposalInput,
  parseStaffProposalApiEnvelope,
  parseStaffProposalDecisionInput,
  parseStaffRoleApprovalApiEnvelope,
  parseStaffRoleApprovalInput,
  parseStaffRoleChangeInput,
  parseStaffRoleRequestApiEnvelope,
  parseStaffTerminationProposalInput,
  STAFF_MANAGEMENT_ACTION_HEADER,
} from "@/lib/staff-management/parser";
import type { StaffManagementSnapshot } from "@/lib/staff-management/types";

import styles from "./staff-management.module.css";

function messageFor(error: unknown) {
  if (isClientFetchTimeoutError(error) ||
    error instanceof Error && error.message.includes("fetch")) {
    return "連線中斷或逾時，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return "伺服器未回傳可核對憑證，結果未知；請重新核對快照，內容未修改時請保留相同操作鍵重試。";
}

function useOperationKeys() {
  const operationKey = useRef<string | null>(null);
  const proposalKey = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    operation() { operationKey.current ??= crypto.randomUUID(); return operationKey.current; },
    proposal() { proposalKey.current ??= crypto.randomUUID(); return proposalKey.current; },
    failed() { failed.current = true; },
    succeeded() { operationKey.current = null; proposalKey.current = null; failed.current = false; },
    changed(clear: () => void) {
      if (!failed.current) return;
      operationKey.current = null; proposalKey.current = null; failed.current = false; clear();
    },
  };
}

async function readResponse(response: Response) {
  const value: unknown = await response.json();
  if (!response.ok) throw new Error("staff management request failed");
  return value;
}

function Reauth({ title }: { title: string }) {
  return <section className={styles.reauth}><h2>{title}</h2>
    <p>這項操作必須使用同一工作階段最近 15 分鐘內的雙重驗證。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">
      前往雙重驗證
    </Link></section>;
}

export function StaffEmploymentProposalForm({
  canManage, hasRecentAal2, snapshot,
}: { canManage: boolean; hasRecentAal2: boolean; snapshot: StaffManagementSnapshot }) {
  const router = useRouter();
  const candidates = snapshot.employees.filter((employee) =>
    employee.membershipStatus !== "ended");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (!canManage || candidates.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="建立聘僱異動前需重新驗證" />;
  return <details className={styles.composer}><summary>建立聘僱／職務異動提案</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const data = new FormData(event.currentTarget);
        const employee = candidates.find((item) => item.membershipId === data.get("employee"));
        if (!employee) throw new Error("employee changed");
        const input = parseStaffEmploymentProposalInput({ action: "propose",
          proposal_action: "employment_change", proposal_key: keys.proposal(),
          target_membership_id: employee.membershipId,
          target_profile_id: employee.profileId,
          expected_membership_version: employee.membershipVersion,
          target_membership_status: data.get("status"), starts_on: data.get("startsOn"),
          ends_on: typeof data.get("endsOn") === "string" && data.get("endsOn")
            ? data.get("endsOn") : null,
          employment_type_text: data.get("employmentType"),
          job_title_text: data.get("jobTitle"),
          registration_status_text: data.get("registrationStatus"),
          change_reason: data.get("reason"),
        }, keys.operation());
        const response = await fetchWithTimeout("/api/staff-management/employment", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
            [STAFF_MANAGEMENT_ACTION_HEADER]: "propose_employment" },
          body: JSON.stringify({ action: "propose", proposal_action: input.proposalAction,
            proposal_key: input.proposalKey, target_membership_id: input.targetMembershipId,
            target_profile_id: input.targetProfileId,
            expected_membership_version: input.expectedMembershipVersion,
            target_membership_status: input.targetMembershipStatus,
            starts_on: input.startsOn, ends_on: input.endsOn,
            employment_type_text: input.employmentTypeText,
            job_title_text: input.jobTitleText,
            registration_status_text: input.registrationStatusText,
            change_reason: input.changeReason }),
        });
        parseStaffProposalApiEnvelope(await readResponse(response), input,
          snapshot.organizationId, snapshot.branchId, response.status);
        keys.succeeded(); setMessage("聘僱異動已凍結送審，尚未生效。另一位授權人員核准後才會更新。");
        router.refresh();
      } catch (error) { keys.failed(); setMessage(messageFor(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>員工</span><select name="employee" required defaultValue="">
        <option value="" disabled>選擇員工</option>{candidates.map((employee) =>
          <option key={employee.membershipId} value={employee.membershipId}>
            {employee.displayName} · v{employee.membershipVersion}
          </option>)}</select></label>
      <label><span>聘僱狀態</span><select name="status" defaultValue="active">
        <option value="active">在職</option><option value="suspended">暫停</option>
      </select></label>
      <label><span>到職日</span><input name="startsOn" type="date" required /></label>
      <label><span>聘僱迄日（可留空）</span><input name="endsOn" type="date" /></label>
      <label><span>聘僱類型（人工文字）</span><input name="employmentType" maxLength={120}
        required placeholder="不套用未發布的官方代碼" /></label>
      <label><span>職務（人工文字）</span><input name="jobTitle" maxLength={160} required /></label>
      <label className={styles.wide}><span>登錄狀態（人工文字）</span>
        <input name="registrationStatus" maxLength={160} required /></label>
      <label className={styles.wide}><span>異動理由</span>
        <textarea name="reason" maxLength={1000} required /></label>
      <button className="button button--primary" type="submit">
        {pending ? "送審中…" : "凍結聘僱異動並送審"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}

export function StaffTerminationProposalForm({
  canTerminate, hasRecentAal2, snapshot,
}: { canTerminate: boolean; hasRecentAal2: boolean; snapshot: StaffManagementSnapshot }) {
  const router = useRouter();
  const candidates = snapshot.employees.filter((employee) =>
    employee.membershipStatus === "active" || employee.membershipStatus === "suspended");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (!canTerminate || candidates.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="建立離職停用前需重新驗證" />;
  return <details className={`${styles.composer} ${styles.danger}`}>
    <summary>建立立即離職停用提案</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const data = new FormData(event.currentTarget);
        const employee = candidates.find((item) => item.membershipId === data.get("employee"));
        if (!employee) throw new Error("employee changed");
        const input = parseStaffTerminationProposalInput({ action: "terminate",
          proposal_key: keys.proposal(), target_membership_id: employee.membershipId,
          target_profile_id: employee.profileId,
          expected_membership_version: employee.membershipVersion,
          starts_on: employee.membershipStartsOn,
          termination_effective_on: data.get("effectiveOn"),
          change_reason: data.get("reason"),
        }, keys.operation());
        const response = await fetchWithTimeout("/api/staff-management/termination", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
            [STAFF_MANAGEMENT_ACTION_HEADER]: "propose_termination" },
          body: JSON.stringify({ action: "terminate", proposal_key: input.proposalKey,
            target_membership_id: input.targetMembershipId,
            target_profile_id: input.targetProfileId,
            expected_membership_version: input.expectedMembershipVersion,
            starts_on: input.startsOn,
            termination_effective_on: input.terminationEffectiveOn,
            change_reason: input.changeReason }),
        });
        parseStaffProposalApiEnvelope(await readResponse(response), input,
          snapshot.organizationId, snapshot.branchId, response.status);
        keys.succeeded(); setMessage("離職停用提案已送審；核准後才會立即停用並排入工作階段撤銷佇列。");
        router.refresh();
      } catch (error) { keys.failed(); setMessage(messageFor(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>員工</span><select name="employee" required defaultValue="">
        <option value="" disabled>選擇員工</option>{candidates.map((employee) =>
          <option key={employee.membershipId} value={employee.membershipId}>
            {employee.displayName} · v{employee.membershipVersion}
          </option>)}</select></label>
      <label><span>離職生效日</span><input name="effectiveOn" type="date" required
        max={snapshot.snapshotDate} defaultValue={snapshot.snapshotDate} /></label>
      <label className={styles.wide}><span>停用理由</span>
        <textarea name="reason" maxLength={1000} required /></label>
      <p className={styles.wide}>不接受未來日期。核准交易會立即把本系統 membership 設為離職；遠端 Auth 工作階段供應商尚未設定，系統只會留下可量測的待處理回執。</p>
      <button className="button button--primary" type="submit">
        {pending ? "送審中…" : "送出立即離職停用提案"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}

export function StaffProposalDecisionForm({
  canApproveEmployment, canApproveTermination, currentUserId, hasRecentAal2, snapshot,
}: { canApproveEmployment: boolean; canApproveTermination: boolean;
  currentUserId: string; hasRecentAal2: boolean;
  snapshot: StaffManagementSnapshot }) {
  const router = useRouter();
  const reviewable = snapshot.proposals.filter((proposal) =>
    proposal.status === "pending" && proposal.action !== "onboard" &&
    proposal.requestedBy !== currentUserId &&
    (proposal.action === "terminate" ? canApproveTermination : canApproveEmployment));
  const [selectedId, setSelectedId] = useState(reviewable[0]?.proposalId ?? "");
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (reviewable.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="審核員工異動前需重新驗證" />;
  const selected = reviewable.find((proposal) => proposal.proposalId === selectedId) ?? reviewable[0]!;
  return <details className={styles.composer}><summary>獨立核准或駁回員工異動</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const data = new FormData(event.currentTarget);
        const input = parseStaffProposalDecisionInput({ action: "decide",
          proposal_action: selected.action, proposal_id: selected.proposalId,
          expected_proposal_number: selected.proposalNumber,
          expected_membership_version: selected.expectedMembershipVersion,
          expected_content_hash: selected.contentHash,
          expected_target_membership_id: selected.targetMembershipId,
          expected_target_profile_id: selected.targetProfileId,
          decision, decision_reason: data.get("reason"),
        }, keys.operation(), [selected.action]);
        const path = selected.action === "terminate" ? "termination" : "employment";
        const response = await fetchWithTimeout(`/api/staff-management/${path}`, {
          method: "PATCH", cache: "no-store", headers: { "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
            [STAFF_MANAGEMENT_ACTION_HEADER]: selected.action === "terminate"
              ? "decide_termination" : "decide_employment" },
          body: JSON.stringify({ action: "decide", proposal_action: input.proposalAction,
            proposal_id: input.proposalId,
            expected_proposal_number: input.expectedProposalNumber,
            expected_membership_version: input.expectedMembershipVersion,
            expected_content_hash: input.expectedContentHash,
            expected_target_membership_id: input.expectedTargetMembershipId,
            expected_target_profile_id: input.expectedTargetProfileId,
            decision: input.decision, decision_reason: input.decisionReason }),
        });
        parseStaffDecisionApiEnvelope(await readResponse(response), input,
          snapshot.organizationId, snapshot.branchId, response.status);
        keys.succeeded(); setMessage(decision === "approve" ?
          "已核准並以新版本生效。" : "已駁回；原資料未被修改。"); router.refresh();
      } catch (error) { keys.failed(); setMessage(messageFor(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label className={styles.wide}><span>待審提案</span>
        <select value={selected.proposalId} onChange={(event) => setSelectedId(event.target.value)}>
          {reviewable.map((proposal) => <option key={proposal.proposalId}
            value={proposal.proposalId}>#{proposal.proposalNumber} · {proposal.targetDisplayName} · {
              proposal.action === "terminate" ? "離職停用" : "聘僱異動"}</option>)}</select>
      </label>
      <label><span>決定</span><select value={decision}
        onChange={(event) => setDecision(event.target.value as "approve" | "reject")}>
        <option value="approve">核准</option><option value="reject">駁回</option>
      </select></label>
      <label><span>預期員工版本</span><input readOnly value={`v${selected.expectedMembershipVersion}`} /></label>
      <label className={styles.wide}><span>審核理由</span>
        <textarea name="reason" maxLength={1000} required /></label>
      <button className="button button--primary" type="submit">
        {pending ? "處理中…" : decision === "approve" ? "核准提案" : "駁回提案"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}

export function StaffRoleChangeForm({ canManageRoles, hasRecentAal2, snapshot }: {
  canManageRoles: boolean; hasRecentAal2: boolean; snapshot: StaffManagementSnapshot;
}) {
  const router = useRouter();
  const candidates = snapshot.employees.filter((employee) => employee.membershipStatus === "active");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (!canManageRoles || candidates.length === 0 || snapshot.roleOptions.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="建立角色異動前需重新驗證" />;
  return <details className={styles.composer}><summary>建立角色指派／撤銷申請</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const data = new FormData(event.currentTarget);
        const employee = candidates.find((item) => item.membershipId === data.get("employee"));
        if (!employee) throw new Error("employee changed");
        const input = parseStaffRoleChangeInput({ action: "request_role",
          operation: data.get("operation"), target_membership_id: employee.membershipId,
          target_role_id: data.get("role"),
          expected_membership_version: employee.membershipVersion,
        }, keys.operation());
        const response = await fetchWithTimeout("/api/staff-management/roles", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
            [STAFF_MANAGEMENT_ACTION_HEADER]: "request_role" },
          body: JSON.stringify({ action: "request_role", operation: input.operation,
            target_membership_id: input.targetMembershipId,
            target_role_id: input.targetRoleId,
            expected_membership_version: input.expectedMembershipVersion }),
        });
        parseStaffRoleRequestApiEnvelope(await readResponse(response), input,
          snapshot.organizationId, snapshot.branchId, response.status);
        keys.succeeded(); setMessage("角色異動已送審；另一位授權人員核准後才會改變權限。");
        router.refresh();
      } catch (error) { keys.failed(); setMessage(messageFor(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>員工</span><select name="employee" required defaultValue="">
        <option value="" disabled>選擇員工</option>{candidates.map((employee) =>
          <option key={employee.membershipId} value={employee.membershipId}>
            {employee.displayName} · v{employee.membershipVersion}
          </option>)}</select></label>
      <label><span>異動</span><select name="operation" defaultValue="assign_role">
        <option value="assign_role">指派角色</option><option value="revoke_role">撤銷角色</option>
      </select></label>
      <label className={styles.wide}><span>角色</span><select name="role" required defaultValue="">
        <option value="" disabled>選擇角色</option>{snapshot.roleOptions.map((role) =>
          <option key={role.roleId} value={role.roleId}>{role.roleName}</option>)}</select></label>
      <button className="button button--primary" type="submit">
        {pending ? "送審中…" : "凍結角色異動並送審"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}

export function StaffRoleApprovalForm({ canApproveRoles, currentUserId,
  hasRecentAal2, snapshot }: { canApproveRoles: boolean; currentUserId: string;
  hasRecentAal2: boolean; snapshot: StaffManagementSnapshot }) {
  const router = useRouter();
  const requests = snapshot.roleRequests.filter((request) =>
    request.status === "pending" && request.requestedBy !== currentUserId);
  const [selectedId, setSelectedId] = useState(requests[0]?.requestId ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (!canApproveRoles || requests.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="核准角色異動前需重新驗證" />;
  const selected = requests.find((request) => request.requestId === selectedId) ?? requests[0]!;
  return <details className={styles.composer}><summary>獨立核准角色異動</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const input = parseStaffRoleApprovalInput({ action: "approve_role",
          request_id: selected.requestId,
          expected_membership_version: selected.expectedMembershipVersion,
          expected_operation: selected.operation,
          expected_target_membership_id: selected.targetMembershipId,
          expected_target_role_id: selected.targetRoleId,
        }, keys.operation());
        const response = await fetchWithTimeout("/api/staff-management/roles", {
          method: "PATCH", cache: "no-store", headers: { "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
            [STAFF_MANAGEMENT_ACTION_HEADER]: "approve_role" },
          body: JSON.stringify({ action: "approve_role", request_id: input.requestId,
            expected_membership_version: input.expectedMembershipVersion,
            expected_operation: input.expectedOperation,
            expected_target_membership_id: input.expectedTargetMembershipId,
            expected_target_role_id: input.expectedTargetRoleId }),
        });
        parseStaffRoleApprovalApiEnvelope(await readResponse(response), input,
          snapshot.organizationId, snapshot.branchId, response.status);
        keys.succeeded(); setMessage("角色異動已核准並套用新員工版本。"); router.refresh();
      } catch (error) { keys.failed(); setMessage(messageFor(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label className={styles.wide}><span>待審角色異動</span>
        <select value={selected.requestId} onChange={(event) => setSelectedId(event.target.value)}>
          {requests.map((request) => <option key={request.requestId} value={request.requestId}>
            {request.roleName} · {request.operation === "assign_role" ? "指派" : "撤銷"}
          </option>)}</select></label>
      <p className={styles.wide}>提案人：{selected.requestedByDisplayName} · 預期員工版本 v{selected.expectedMembershipVersion}</p>
      <button className="button button--primary" type="submit">
        {pending ? "核准中…" : "核准角色異動"}
      </button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}
