"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { FileCheck2, Plus, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseRoleGovernanceApprovalSuccessEnvelope,
  parseRoleGovernanceRequestSuccessEnvelope,
  roleGovernanceErrorMessage,
} from "@/lib/role-governance/parser";
import { profileKindAcceptsRole } from "@/lib/role-governance/projection";
import type {
  RoleGovernanceMembership,
  RoleGovernanceOperation,
  RoleGovernancePermission,
  RoleGovernanceRequest,
  RoleGovernanceRequestPayload,
  RoleGovernanceRole,
} from "@/lib/role-governance/types";

import styles from "./role-governance.module.css";
import { currentGovernanceRoleName } from "./role-labels";

const operationLabels: Record<RoleGovernanceOperation, string> = {
  create_role: "建立機構角色",
  grant_permission: "授予角色權限",
  revoke_permission: "撤銷角色權限",
  assign_role: "指派成員角色",
  revoke_role: "撤銷成員角色",
  deactivate_role: "停用機構角色",
};
const singleSiteScopeMessage = "此職務須先建立指定據點的成員資格，不能指派至全機構範圍。";

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function keepDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true",
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      !event.currentTarget.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function operationBody(payload: RoleGovernanceRequestPayload) {
  if (payload.operation === "create_role") {
    return {
      operation: payload.operation,
      role_key: payload.roleKey,
      role_name: payload.roleName,
      role_description: payload.roleDescription,
    };
  }
  if (
    payload.operation === "grant_permission" ||
    payload.operation === "revoke_permission"
  ) {
    return {
      operation: payload.operation,
      target_role_id: payload.targetRoleId,
      permission_key: payload.permissionKey,
    };
  }
  if (payload.operation === "assign_role" || payload.operation === "revoke_role") {
    return {
      operation: payload.operation,
      target_role_id: payload.targetRoleId,
      target_membership_id: payload.targetMembershipId,
    };
  }
  return {
    operation: payload.operation,
    target_role_id: payload.targetRoleId,
  };
}

export function RoleGovernanceRequestAction({
  roles,
  permissions,
  memberships,
  enabled,
  disabledReason,
}: {
  roles: readonly RoleGovernanceRole[];
  permissions: readonly RoleGovernancePermission[];
  memberships: readonly RoleGovernanceMembership[];
  enabled: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const stableId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [operation, setOperation] = useState<RoleGovernanceOperation>("create_role");
  const [targetRoleId, setTargetRoleId] = useState("");
  const [targetMembershipId, setTargetMembershipId] = useState("");
  const [permissionKey, setPermissionKey] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef("");

  const tenantRoles = useMemo(
    () => roles.filter((role) => !role.system),
    [roles],
  );
  const selectedRole = roles.find((role) => role.id === targetRoleId) ?? null;
  const selectedMembership =
    memberships.find((membership) => membership.id === targetMembershipId) ?? null;
  const singleSiteScopeMismatch = operation === "assign_role" &&
    selectedRole?.system === true &&
    (selectedRole.roleKey === "branch_supervisor" || selectedRole.roleKey === "branch_director") &&
    selectedMembership?.branchId === null;
  const roleOptions = useMemo(() => {
    if (operation === "grant_permission" || operation === "revoke_permission" || operation === "deactivate_role") {
      return tenantRoles.filter((role) => role.active);
    }
    if (operation === "assign_role" && selectedMembership) {
      return roles.filter(
        (role) =>
          role.active &&
          !selectedMembership.roleIds.includes(role.id) &&
          profileKindAcceptsRole(selectedMembership.profileKind, role),
      );
    }
    if (operation === "revoke_role" && selectedMembership) {
      return roles.filter((role) => selectedMembership.roleIds.includes(role.id));
    }
    return roles;
  }, [operation, roles, selectedMembership, tenantRoles]);
  const permissionOptions = useMemo(() => {
    if (!selectedRole) return [];
    return permissions.filter((permission) =>
      operation === "grant_permission"
        ? !selectedRole.permissionKeys.includes(permission.key)
        : selectedRole.permissionKeys.includes(permission.key),
    );
  }, [operation, permissions, selectedRole]);
  const fieldsLocked = pending || completed || uncertain;

  function resetSelections(nextOperation: RoleGovernanceOperation) {
    setOperation(nextOperation);
    setTargetRoleId("");
    setTargetMembershipId("");
    setPermissionKey("");
    setRoleKey("");
    setRoleName("");
    setRoleDescription("");
    setError(null);
    setNotice(null);
    key.current = crypto.randomUUID();
  }

  function changed(action: () => void) {
    if (fieldsLocked) return;
    action();
    setError(null);
    setNotice(null);
    key.current = crypto.randomUUID();
  }

  function open() {
    if (!enabled) return;
    resetSelections("create_role");
    setCompleted(false);
    setUncertain(false);
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function payload(): RoleGovernanceRequestPayload | null {
    if (operation === "create_role") {
      const trimmedName = roleName.trim();
      if (!/^[a-z][a-z0-9_]{1,63}$/u.test(roleKey) || !trimmedName) return null;
      return {
        operation,
        roleKey,
        roleName: trimmedName,
        roleDescription: roleDescription.trim() || null,
      };
    }
    if (operation === "grant_permission" || operation === "revoke_permission") {
      if (!selectedRole || !permissionOptions.some((item) => item.key === permissionKey)) return null;
      return { operation, targetRoleId: selectedRole.id, permissionKey };
    }
    if (operation === "assign_role" || operation === "revoke_role") {
      if (!selectedMembership || !roleOptions.some((role) => role.id === targetRoleId)) return null;
      return { operation, targetRoleId, targetMembershipId: selectedMembership.id };
    }
    if (!selectedRole) return null;
    return { operation, targetRoleId: selectedRole.id };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed || singleSiteScopeMismatch) return;
    const expected = payload();
    if (!expected) {
      setError("請完成這項變更所需的角色、權限或成員欄位。");
      return;
    }
    key.current ||= crypto.randomUUID();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchWithTimeout("/api/role-governance/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key.current,
        },
        body: JSON.stringify(operationBody(expected)),
      });
      const body = await safeJson(response);
      if (!response.ok) {
        const verifiedError = roleGovernanceErrorMessage(body);
        setUncertain(response.status >= 500 || verifiedError === null);
        setError(
          verifiedError ??
            "錯誤回覆未完整確認；請勿變更內容，直接以相同操作重試。",
        );
        return;
      }
      try {
        const result = parseRoleGovernanceRequestSuccessEnvelope(
          body,
          expected,
          response.status,
        );
        setCompleted(true);
        setNotice(
          result.replayed
            ? "已確認先前相同申請，未建立重複紀錄。"
            : "申請已保存，需由另一位具權限人員核准。",
        );
        router.refresh();
      } catch {
        setUncertain(true);
        setError("伺服器回覆不完整；請勿變更內容，直接以相同操作重試。");
      }
    } catch (caught) {
      setUncertain(true);
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路或等待時間狀態不明；請勿變更內容，直接以相同操作重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button aria-label={!enabled && disabledReason ? `建立變更申請：${disabledReason}` : "建立變更申請"} className="button button--primary" disabled={!enabled} onClick={open} ref={trigger} title={!enabled ? disabledReason : undefined} type="button">
        <Plus aria-hidden="true" />建立變更申請
      </button>
      <dialog
        aria-describedby={`${stableId}-request-description`}
        aria-labelledby={`${stableId}-request-title`}
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={keepDialogFocus}
        ref={dialog}
      >
        <form className="core-dialog__surface" onSubmit={submit}>
          <header className="drawer__header">
            <div><p className="eyebrow">雙人 AAL2 權限治理</p><h2 id={`${stableId}-request-title`}>建立變更申請</h2><p id={`${stableId}-request-description`}>先提出申請，再由另一位授權人員獨立核准。</p></div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}>
            <div className={`callout ${styles.securityCallout}`}><ShieldCheck aria-hidden="true" /><span>伺服器與資料庫會再次核對機構、分支、目前角色、最近 15 分鐘重新驗證及身分類型相容性。</span></div>
            <label className="field"><span>變更類型 *</span><select autoFocus disabled={fieldsLocked} onChange={(event) => resetSelections(event.target.value as RoleGovernanceOperation)} value={operation}>{Object.entries(operationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {operation === "create_role" ? (
              <div className={styles.formGrid}>
                <label className="field"><span>角色代碼 *</span><input disabled={fieldsLocked} maxLength={64} onChange={(event) => changed(() => setRoleKey(event.target.value))} pattern="[a-z][a-z0-9_]{1,63}" placeholder="例如 activity_lead" required value={roleKey} /></label>
                <label className="field"><span>角色名稱 *</span><input disabled={fieldsLocked} maxLength={120} onChange={(event) => changed(() => setRoleName(event.target.value))} required value={roleName} /></label>
                <label className={`field ${styles.wideField}`}><span>角色說明</span><textarea disabled={fieldsLocked} maxLength={1000} onChange={(event) => changed(() => setRoleDescription(event.target.value))} value={roleDescription} /></label>
              </div>
            ) : null}
            {(operation === "assign_role" || operation === "revoke_role") ? (
              <label className="field"><span>成員 *</span><select disabled={fieldsLocked} onChange={(event) => changed(() => { setTargetMembershipId(event.target.value); setTargetRoleId(""); })} required value={targetMembershipId}><option value="">請選擇成員</option>{memberships.map((membership) => <option disabled={operation === "assign_role" && !(["invited", "active"] as const).includes(membership.status as "invited" | "active")} key={membership.id} value={membership.id}>{membership.displayName}・{membership.status}</option>)}</select></label>
            ) : null}
            {operation !== "create_role" ? (
              <label className="field"><span>角色 *</span><select aria-describedby={singleSiteScopeMismatch ? `${stableId}-single-site-scope` : undefined} aria-invalid={singleSiteScopeMismatch || undefined} disabled={fieldsLocked || ((operation === "assign_role" || operation === "revoke_role") && !selectedMembership)} onChange={(event) => changed(() => { setTargetRoleId(event.target.value); setPermissionKey(""); })} required value={targetRoleId}><option value="">請選擇角色</option>{roleOptions.map((role) => <option key={role.id} value={role.id}>{currentGovernanceRoleName(role)}{role.system ? "・系統模板" : "・機構自訂"}</option>)}</select>{(operation === "assign_role" && selectedMembership && roleOptions.length === 0) ? <small className={styles.inlineNotice}>沒有符合此身分類型且尚未指派的有效角色。</small> : null}</label>
            ) : null}
            {singleSiteScopeMismatch ? <p className="form-error" id={`${stableId}-single-site-scope`} role="alert">{singleSiteScopeMessage}</p> : null}
            {operation === "assign_role" ? <p className={styles.inlineNotice}>主任兼任護理或社工須分別送審對應角色，並核對專業資格；送審或主任職稱本身不會授予兼任權限。</p> : null}
            {(operation === "grant_permission" || operation === "revoke_permission") ? (
              <label className="field"><span>權限 *</span><select disabled={fieldsLocked || !selectedRole} onChange={(event) => changed(() => setPermissionKey(event.target.value))} required value={permissionKey}><option value="">請選擇權限</option>{permissionOptions.map((permission) => <option key={permission.key} value={permission.key}>{permission.key}・風險 {permission.riskLevel}</option>)}</select>{selectedRole && permissionOptions.length === 0 ? <small className={styles.inlineNotice}>此角色目前沒有可執行的這類權限變更。</small> : null}</label>
            ) : null}
            <label className="check-field"><input disabled={pending || completed} required type="checkbox" /><span>我已確認變更對象與內容，並同意送交另一位具權限人員獨立覆核。</span></label>
            {uncertain ? <button className="button button--quiet" disabled={pending} onClick={() => { setUncertain(false); setError(null); key.current = crypto.randomUUID(); }} type="button">解除欄位鎖定並改用新申請（請先確認原操作未成功）</button> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
          </div>
          <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">{completed ? "關閉" : "取消"}</button><button className="button button--primary" disabled={pending || completed || singleSiteScopeMismatch} type="submit">{pending ? "確認中…" : completed ? "已送出" : uncertain ? "以相同內容重試" : "送出覆核"}</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function RoleGovernanceApproveAction({
  request,
  enabled,
  instance,
  disabledReason,
}: {
  request: RoleGovernanceRequest;
  enabled: boolean;
  instance: "desktop" | "mobile";
  disabledReason?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef("");
  const titleId = `role-approval-${instance}-${request.id}`;

  function open() {
    if (!enabled) return;
    key.current = crypto.randomUUID();
    setCompleted(false);
    setError(null);
    setNotice(null);
    dialog.current?.showModal();
  }
  function close() { if (!pending) dialog.current?.close(); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    key.current ||= crypto.randomUUID();
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/role-governance/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({ request_id: request.id }),
      });
      const body = await safeJson(response);
      if (!response.ok) {
        setError(
          roleGovernanceErrorMessage(body) ??
            "核准錯誤回覆未完整確認；請直接以相同操作重試。",
        );
        return;
      }
      try {
        const result = parseRoleGovernanceApprovalSuccessEnvelope(
          body,
          request.id,
          response.status,
        );
        setCompleted(true);
        setNotice(result.replayed ? "已確認先前核准結果，未重複套用。" : "核准與權限變更已在同一交易完成。");
        router.refresh();
      } catch {
        setError("伺服器回覆不完整；請直接以相同操作重試。");
      }
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路或等待時間狀態不明；請直接以相同操作重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button aria-label={!enabled && disabledReason ? `獨立核准：${disabledReason}` : "獨立核准"} className="button button--primary" disabled={!enabled} onClick={open} ref={trigger} title={!enabled ? disabledReason : undefined} type="button"><FileCheck2 aria-hidden="true" />獨立核准</button>
      <dialog aria-labelledby={titleId} className={`core-dialog ${styles.dialog}`} onCancel={(event) => { if (pending) event.preventDefault(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} onClose={() => trigger.current?.focus()} onKeyDown={keepDialogFocus} ref={dialog}>
        <form className="core-dialog__surface" onSubmit={submit}>
          <header className="drawer__header"><div><p className="eyebrow">第二人 AAL2 覆核</p><h2 id={titleId}>核准{operationLabels[request.operation]}</h2><p>{request.requesterLabel}提出；核准後會原子套用。</p></div><button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
          <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}><div className={`callout ${styles.securityCallout}`}><ShieldCheck aria-hidden="true" /><span>資料庫會再次鎖定並核對目標、身分類型、目前權限及獨立重新驗證證據；申請人不能核准自己的申請。</span></div><label className="check-field"><input disabled={completed} required type="checkbox" /><span>我已獨立核對這項變更，確認自己不是申請人，並同意套用。</span></label>{error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}</div>
          <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">{completed ? "關閉" : "取消"}</button><button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "確認中…" : completed ? "已核准" : "核准並套用"}</button></footer>
        </form>
      </dialog>
    </>
  );
}
