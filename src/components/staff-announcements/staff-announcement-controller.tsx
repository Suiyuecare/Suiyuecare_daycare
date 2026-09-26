"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import type { TenantContext } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseStaffAnnouncementApiEnvelope, parseStaffAnnouncementInput } from "@/lib/integrations/staff-announcements";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { defaultTaipeiLocal, isoToTaipeiLocal, taipeiLocalToIso } from "@/lib/staff-announcements/date";
import { beginStaffAnnouncement, getStaffAnnouncementPending, isConfirmedStaffAnnouncementRejection, observeStaffAnnouncementAuthority,
  reconcileStaffAnnouncementConfirmed, retryStaffAnnouncement, settleStaffAnnouncement, staffAnnouncementAuthoritySignature,
  staffAnnouncementScopeIdentity, useStaffAnnouncementPending, type StaffAnnouncementOperation, type StaffAnnouncementTarget } from "@/lib/staff-announcements/pending";
import type { StaffAnnouncementItem, StaffAnnouncementMutationInput, StaffAnnouncementSnapshot } from "@/lib/staff-announcements/types";
import styles from "./staff-announcements.module.css";

type Action = StaffAnnouncementMutationInput["action"];
type Fields = { title: string; body: string; publishLocal: string; expiryMode: "" | "none" | "at"; expiresLocal: string;
  userIds: string[]; roleIds: string[]; reason: string };
type Editor = { action: Exclude<Action, "read">; item?: StaffAnnouncementItem; sourceAt: string; identity: string;
  fingerprint: string; epoch: number; privacyEpoch: number; initial: Fields; fields: Fields };
type Controller = { open(action: Action, item: StaffAnnouncementItem | undefined, trigger: HTMLElement): void;
  disabledReason(action: Action, item?: StaffAnnouncementItem): string };
const ControllerContext = createContext<Controller | null>(null);
export const useStaffAnnouncementController = () => useContext(ControllerContext);
const UNKNOWN = "上次公告操作尚未確認。請勿建立另一筆；請回查同一操作。";
const labels: Record<Action, string> = { draft: "建立公告草稿", publish: "確認發布公告", withdraw: "確認撤回公告", read: "確認已讀操作" };
function fieldsFor(item?: StaffAnnouncementItem): Fields {
  return { title: item?.title ?? "", body: item?.body ?? "", publishLocal: item ? isoToTaipeiLocal(item.publishAt) : defaultTaipeiLocal(),
    expiryMode: item ? item.expiresAt ? "at" : "none" : "", expiresLocal: item?.expiresAt ? isoToTaipeiLocal(item.expiresAt) : "",
    userIds: [...item?.audienceUserIds ?? []], roleIds: [...item?.audienceRoleIds ?? []], reason: "" };
}
function recoveredFields(operation: StaffAnnouncementOperation): Fields {
  if (operation.input.action !== "draft") return { ...fieldsFor(), reason: operation.input.action === "withdraw" ? operation.input.reason : "" };
  const input = operation.input;
  return { title: input.title, body: input.body, publishLocal: isoToTaipeiLocal(input.publishAt), expiryMode: input.expiresAt ? "at" : "none",
    expiresLocal: input.expiresAt ? isoToTaipeiLocal(input.expiresAt) : "", userIds: [...input.audienceUserIds], roleIds: [...input.audienceRoleIds], reason: input.changeReason ?? "" };
}
function sourceTarget(item: StaffAnnouncementItem, action: Action): StaffAnnouncementTarget {
  if (action === "read") return { announcementKey: item.announcementKey, version: item.activeReleaseVersion!, versionId: item.activeReleaseVersionId!,
    activeReleaseVersionId: item.activeReleaseVersionId, publishAt: item.activeReleasePublishAt!, expiresAt: item.activeReleaseExpiresAt };
  return { announcementKey: item.announcementKey, version: item.version, versionId: item.versionId, activeReleaseVersionId: item.activeReleaseVersionId,
    publishAt: item.publishAt, expiresAt: item.expiresAt };
}
function sameSource(snapshot: StaffAnnouncementSnapshot | null, item?: StaffAnnouncementItem) {
  if (!snapshot) return false;
  if (!item) return true;
  return [...snapshot.items, ...(snapshot.selectedAnnouncement ? [snapshot.selectedAnnouncement] : [])]
    .some((candidate) => candidate.versionId === item.versionId && JSON.stringify(candidate) === JSON.stringify(item));
}
type Authority = { context: TenantContext; snapshot: StaffAnnouncementSnapshot | null; canRead: boolean; canPublish: boolean; hasRecentAal2: boolean };
function permitted(action: Action, live: Authority, now: number) {
  const read = !live.context.demo && live.canRead && live.context.assuranceLevel === "aal2" && live.context.scopes.includes("announcements.read");
  if (action === "read") return read;
  const manage = read && live.context.scopes.includes("announcements.manage") && live.snapshot?.canManage !== false;
  if (action === "draft") return manage;
  const age = live.context.recentAal2At === null ? Infinity : now - Date.parse(live.context.recentAal2At);
  return manage && live.canPublish && live.hasRecentAal2 && live.context.scopes.includes("announcements.publish") && age >= 0 && age <= 15 * 60_000;
}

/** Workspace-owned writes survive row/filter changes; payloads never enter browser storage. */
export function StaffAnnouncementController({ context, snapshot, canPublish, hasRecentAal2, canRead, children }: {
  context: TenantContext; snapshot: StaffAnnouncementSnapshot | null; canPublish: boolean; hasRecentAal2: boolean; canRead: boolean; children: ReactNode;
}) {
  const router = useRouter();
  const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
  // Demo contexts have non-UUID IDs and cannot create a mutation journal.
  const identity = context.demo ? JSON.stringify([context.organizationId, context.branchId, context.userId, true]) : staffAnnouncementScopeIdentity(scope, false);
  const authority = staffAnnouncementAuthoritySignature(context);
  const fingerprint = JSON.stringify([authority, canPublish, hasRecentAal2, canRead, snapshot?.canManage ?? null]);
  const lifecycle = useRef({ mounted: false, epoch: 0, fingerprint });
  const latest = useRef({ context, snapshot, canPublish, hasRecentAal2, canRead, identity, fingerprint });
  const triggerRef = useRef<HTMLElement | null>(null);
  const recoveryRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const composition = useRef(false);
  const readLease = useRef<(() => void) | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clock, setClock] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ identity: string; text: string; saved?: boolean } | null>(null);
  const journal = useStaffAnnouncementPending();
  const pending = usePendingOperations(); const changingView = useViewTransitionPending();
  const id = useId();

  useLayoutEffect(() => {
    latest.current = { context, snapshot, canPublish, hasRecentAal2, canRead, identity, fingerprint };
    if (lifecycle.current.fingerprint !== fingerprint) {
      lifecycle.current.epoch += 1; lifecycle.current.fingerprint = fingerprint;
      const operation = getStaffAnnouncementPending().operation;
      if (operation?.phase === "sending") settleStaffAnnouncement(operation, "unknown");
      setEditor(null); setRecoveryOpen(false); setErrors({}); setNotice(null); composition.current = false;
    }
    observeStaffAnnouncementAuthority(authority);
  }, [context, snapshot, canPublish, hasRecentAal2, canRead, identity, fingerprint, authority]);
  useEffect(() => {
    const life = lifecycle.current; life.mounted = true;
    return () => {
      life.mounted = false; life.epoch += 1;
      const operation = getStaffAnnouncementPending().operation;
      if (operation?.identity === latest.current.identity && operation.phase === "sending") settleStaffAnnouncement(operation, "unknown");
      readLease.current?.(); readLease.current = null;
    };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    readLease.current?.(); readLease.current = null;
    if (snapshot && !context.demo) reconcileStaffAnnouncementConfirmed({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, snapshot, Date.now());
  }, [snapshot, context.demo, context.organizationId, context.branchId, context.userId]); // same-scope positive evidence only

  function allowed(action: Action) {
    return permitted(action, latest.current, Date.now());
  }
  const ownOperation = journal.operation?.identity === identity ? journal.operation : null;
  const mayRecover = ownOperation !== null && permitted(ownOperation.input.action, { context, snapshot, canRead, canPublish, hasRecentAal2 }, clock);
  const visibleEditor = editor?.identity === identity && editor.fingerprint === fingerprint && editor.privacyEpoch === journal.privacyEpoch ? editor : null;
  const locked = ownOperation !== null;
  const guard = useUnsavedChanges({ dirty: !!visibleEditor && !locked && JSON.stringify(visibleEditor.fields) !== JSON.stringify(visibleEditor.initial),
    scopeKey: fingerprint, revisionKey: JSON.stringify([snapshot?.generatedAt, snapshot?.items, snapshot?.selectedAnnouncement]),
    canPrompt: !pending && !changingView, permittedFormAttribute: "data-staff-announcement-form", onDiscard: () => { composition.current = false; setEditor(null); } });

  function disabledReason(action: Action, item?: StaffAnnouncementItem) {
    if (!permitted(action, { context, snapshot, canRead, canPublish, hasRecentAal2 }, clock)) return context.demo ? "展示模式不會寫入公告。" : "目前權限或驗證狀態無法執行此操作。";
    if (journal.operation || pending) return "請先回查未確認的操作或完成其他作業。";
    if (changingView) return "清單重新載入中，請稍候。";
    if (!snapshot || snapshot.organizationId !== context.organizationId || snapshot.branchId !== context.branchId || snapshot.demo !== context.demo ||
      !Number.isFinite(Date.parse(snapshot.staleAfter)) || clock >= Date.parse(snapshot.staleAfter)) return "請先重新載入有效公告清單。";
    if (!sameSource(snapshot, item)) return "公告來源已變更，請重新選擇。";
    if (journal.confirmed.some((entry) => entry.identity === identity && (entry.action === "read" ? action === "read" && entry.releaseVersionId === item?.activeReleaseVersionId
      : item ? entry.announcementKey === item.announcementKey : action === "draft" && entry.newAnnouncement))) return "操作已保存，請先更新清單確認結果。";
    if (action === "publish" && item?.versionState !== "draft") return "只有草稿可以發布。";
    if (action === "publish" && item?.expiresAt !== null && item?.expiresAt !== undefined && Date.parse(item.expiresAt) <= clock) return "此草稿已到期，請先建立新版。";
    if (action === "withdraw" && (!item?.activeReleaseVersionId || item.lifecycle === "withdrawn")) return "沒有可撤回的發布版本。";
    if (action === "read" && (!item?.actorIsRecipient || !item.activeReleaseVersionId || item.actorReadAt || !item.activeReleaseVersion || !["published", "expired"].includes(item.lifecycle))) return "僅已發布或已到期公告的收件人可以標為已讀。";
    return "";
  }
  function refreshList(force = false) {
    if (getStaffAnnouncementPending().operation || hasPendingOperations()) return;
    if (force) { readLease.current?.(); readLease.current = null; }
    const lease = tryAcquireViewTransition(); if (!lease) return;
    readLease.current = lease;
    try { router.refresh(); } catch { lease(); readLease.current = null; setNotice({ identity, text: "清單無法重新載入，請再試一次。" }); }
  }
  function liveAttempt(operation: StaffAnnouncementOperation, capturedEpoch: number, capturedFingerprint: string) {
    const current = getStaffAnnouncementPending();
    return lifecycle.current.mounted && lifecycle.current.epoch === capturedEpoch && latest.current.fingerprint === capturedFingerprint &&
      latest.current.identity === operation.identity && allowed(operation.input.action) && current.operation?.token === operation.token &&
      current.operation.attempt === operation.attempt && current.authorityEpoch === operation.authorityEpoch &&
      current.authoritySignature === operation.authoritySignature && current.privacyEpoch === operation.privacyEpoch;
  }
  async function send(operation: StaffAnnouncementOperation) {
    const capturedEpoch = lifecycle.current.epoch; const capturedFingerprint = latest.current.fingerprint;
    if (!liveAttempt(operation, capturedEpoch, capturedFingerprint)) { settleStaffAnnouncement(operation, "unknown"); return; }
    try {
      const response = await fetchWithTimeout("/api/staff-announcements", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": operation.input.idempotencyKey, "X-Announcement-Action": operation.input.action }, body: operation.body });
      const raw: unknown = await response.json();
      if (!liveAttempt(operation, capturedEpoch, capturedFingerprint)) { settleStaffAnnouncement(operation, "unknown"); return; }
      if (!response.ok) {
        settleStaffAnnouncement(operation, isConfirmedStaffAnnouncementRejection(raw, response.status) ? "denied" : "unknown");
        if (!getStaffAnnouncementPending().operation) {
          const message = "公告操作未保存。請確認權限、資料或版本後重試。";
          setNotice({ identity: operation.identity, text: message });
          setErrors({ source: message });
        }
        return;
      }
      const receipt = parseStaffAnnouncementApiEnvelope(raw, operation.input);
      if (settleStaffAnnouncement(operation, receipt)) {
        setEditor(null); setRecoveryOpen(false); setErrors({});
        setNotice({ identity: operation.identity, text: "公告操作已保存。", saved: true });
        refreshList();
      }
    } catch {
      if (!liveAttempt(operation, capturedEpoch, capturedFingerprint)) { settleStaffAnnouncement(operation, "unknown"); return; }
      settleStaffAnnouncement(operation, "unknown");
    }
  }
  function start(input: StaffAnnouncementMutationInput, sourceAt: string, item?: StaffAnnouncementItem) {
    try {
      const operation = beginStaffAnnouncement(scope, context.demo, input, sourceAt, item ? sourceTarget(item, input.action) : undefined);
      if (operation) void send(operation);
      else setNotice({ identity, text: "目前有未確認操作或清單正在更新，請稍後再試。" });
    } catch { setNotice({ identity, text: "公告來源或資料無效，請重新載入後再試。" }); }
  }
  function open(action: Action, item: StaffAnnouncementItem | undefined, trigger: HTMLElement) {
    if (disabledReason(action, item) || !allowed(action) || Date.now() >= Date.parse(snapshot!.staleAfter)) return;
    const captured = lifecycle.current.epoch; const capturedFingerprint = fingerprint;
    guard.requestExit(() => {
      if (lifecycle.current.epoch !== captured || latest.current.fingerprint !== capturedFingerprint || disabledReason(action, item) || !allowed(action) || Date.now() >= Date.parse(snapshot!.staleAfter)) return;
      triggerRef.current = trigger; setErrors({}); setNotice(null); composition.current = false;
      if (action === "read" && item) {
        const input = parseStaffAnnouncementInput("read", { release_version_id: item.activeReleaseVersionId }, crypto.randomUUID());
        start(input, snapshot!.generatedAt, item); return;
      }
      if (action === "read") return;
      const fields = fieldsFor(item);
      setEditor({ action, item: item ? structuredClone(item) : undefined, sourceAt: snapshot!.generatedAt,
        identity, fingerprint, epoch: captured, privacyEpoch: journal.privacyEpoch, initial: structuredClone(fields), fields });
    });
  }
  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    if (locked) return;
    setEditor((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : null);
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }
  function submit() {
    if (!visibleEditor || locked || composition.current || hasPendingOperations() || hasViewTransition()) return;
    if (disabledReason(visibleEditor.action, visibleEditor.item) || visibleEditor.epoch !== lifecycle.current.epoch || !allowed(visibleEditor.action) || !snapshot || Date.now() >= Date.parse(snapshot.staleAfter) ||
      visibleEditor.action === "publish" && visibleEditor.item?.expiresAt !== null && visibleEditor.item?.expiresAt !== undefined && Date.parse(visibleEditor.item.expiresAt) <= Date.now()) { setErrors({ source: "公告來源或權限已變更，請重新載入並重新選擇。" }); return; }
    const value = visibleEditor.fields; const next: Record<string, string> = {}; let publishAt = ""; let expiresAt: string | null = null;
    const text = (key: "title" | "body" | "reason", max: number) => {
      if (!value[key].trim() || value[key].trim().length > max || (key === "body" ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value[key])) next[key] = `請填寫 1–${max} 字有效${key === "title" ? "標題" : key === "body" ? "內容" : "理由"}。`;
    };
    if (visibleEditor.action === "draft") {
      text("title", 200); text("body", 10_000);
      try { publishAt = taipeiLocalToIso(value.publishLocal); } catch { next.publishLocal = "請選擇有效發布日期與時間。"; }
      if (!value.expiryMode) next.expiryMode = "請選擇到期時間或明確無到期。";
      if (value.expiryMode === "at") {
        try { expiresAt = taipeiLocalToIso(value.expiresLocal); if (Date.parse(expiresAt) <= Date.parse(publishAt)) next.expiresLocal = "到期時間必須晚於發布時間。"; }
        catch { next.expiresLocal = "請選擇有效到期日期與時間。"; }
      }
      if (value.userIds.length + value.roleIds.length < 1 || value.userIds.length + value.roleIds.length > 500 ||
        value.userIds.some((userId) => !snapshot!.audienceStaff.some((entry) => entry.userId === userId)) ||
        value.roleIds.some((roleId) => !snapshot!.audienceRoles.some((entry) => entry.roleId === roleId))) next.audience = "請選擇 1–500 個有效對象；失效對象請取消並重新選擇。";
      if (visibleEditor.item) text("reason", 1000);
    } else if (visibleEditor.action === "withdraw") text("reason", 1000);
    setErrors(next);
    if (Object.keys(next).length) { formRef.current?.querySelector<HTMLElement>(`[data-announcement-field="${Object.keys(next)[0]}"]`)?.focus(); return; }
    try {
      const action = visibleEditor.action; const item = visibleEditor.item;
      const wire = action === "draft" ? { previous_version_id: item?.versionId ?? null, title: value.title, body: value.body, publish_at: publishAt,
        expires_at: expiresAt, audience_user_ids: value.userIds, audience_role_ids: value.roleIds, change_reason: item ? value.reason : null }
        : action === "publish" ? { draft_version_id: item!.versionId } : { expected_latest_version_id: item!.versionId, release_version_id: item!.activeReleaseVersionId, reason: value.reason };
      start(parseStaffAnnouncementInput(action, wire, crypto.randomUUID()), visibleEditor.sourceAt, item);
    } catch { setErrors({ source: "資料格式無效，請確認欄位後重試。" }); }
  }
  function retry() {
    if (!ownOperation || !mayRecover || !allowed(ownOperation.input.action) || composition.current) return;
    const operation = retryStaffAnnouncement(ownOperation.token, scope, context.demo);
    if (operation) void send(operation);
  }
  const recovered = ownOperation && mayRecover && (visibleEditor !== null || recoveryOpen);
  const action = recovered ? ownOperation.input.action : visibleEditor?.action;
  const fields = recovered ? recoveredFields(ownOperation) : visibleEditor?.fields;
  const draft = action === "draft"; const revision = recovered ? ownOperation.input.action === "draft" && ownOperation.input.previousVersionId !== null : !!visibleEditor?.item;
  function field(key: string) { return { id: `${id}-${key}`, "data-announcement-field": key, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined }; }
  function error(key: string) { return errors[key] ? <small id={`${id}-${key}-error`} role="alert">{errors[key]}</small> : null; }
  function close() { if (!composition.current && !locked) guard.requestExit(() => { setEditor(null); setRecoveryOpen(false); }); }
  const recoveryVisible = !!recovered;
  const modalOpen = !!action && !!fields && !guard.open && (!!visibleEditor || recoveryVisible);
  const staff = snapshot?.audienceStaff ?? []; const roles = snapshot?.audienceRoles ?? [];
  return <ControllerContext.Provider value={{ open, disabledReason }}>
    <section aria-label="公告操作回查" data-governance-focus-anchor ref={recoveryRef} tabIndex={-1}>
      {journal.operation && !ownOperation && <p role="status">另一個資料範圍有未確認操作。請回到原範圍回查；此處不顯示操作內容。</p>}
      {ownOperation && !mayRecover && <p role="status">上次操作尚未確認。目前權限或驗證已變更；恢復原授權後才能回查，操作內容已隱藏。</p>}
      {ownOperation && mayRecover && <div className="callout callout--warning"><p role="status">{ownOperation.phase === "sending" ? "公告操作確認中，請勿重複送出。" : UNKNOWN}</p>
        {!modalOpen && <button className="button button--secondary" disabled={ownOperation.phase === "sending"} onClick={(event) => { triggerRef.current = event.currentTarget; setRecoveryOpen(true); }} type="button">回查上次公告操作</button>}</div>}
      {notice?.identity === identity && <p role="status">{notice.saved ? journal.confirmed.some((entry) => entry.identity === identity)
        ? "公告操作已保存；清單尚未確認更新，請重新載入確認結果。" : "公告操作已保存，清單已確認更新。" : notice.text}</p>}
      {journal.confirmed.some((entry) => entry.identity === identity) && <div className="callout"><p>操作已保存，但目前清單尚未確認更新。</p>
        <button className="button button--secondary" disabled={pending} onClick={() => refreshList(true)} type="button">重新載入清單</button></div>}
      {(journal.navigationBlocked || guard.notice) && <p role="status">{guard.notice || "請先回查未確認操作，再離開此頁。"}</p>}
    </section>
    {children}
    <GovernanceDialog open={modalOpen} title={action ? labels[action] : "公告操作"} busy={locked} onRequestClose={close} returnFocusRef={triggerRef} fallbackFocusRef={recoveryRef}>
      <form data-staff-announcement-form noValidate onCompositionStart={() => { composition.current = true; guard.compositionStart(); }}
        onCompositionEnd={() => { composition.current = false; guard.compositionEnd(); }}
        onSubmit={(event) => { event.preventDefault(); if (!composition.current) submit(); }} ref={formRef}>
        <div className={styles.dialogBody}>
          {errors.source && <p role="alert">{errors.source}</p>}
          {fields && <fieldset className={styles.formFields} disabled={locked}>
            {draft && <>
              <label className="field" htmlFor={`${id}-title`}>標題 *<input {...field("title")} maxLength={200} required value={fields.title} onChange={(event) => update("title", event.target.value)} />{error("title")}</label>
              <label className="field" htmlFor={`${id}-body`}>內容 *<textarea {...field("body")} className="resize-none" maxLength={10000} required rows={8} value={fields.body} onChange={(event) => update("body", event.target.value)} />{error("body")}</label>
              <div className={styles.twoColumns}>
                <label className="field" htmlFor={`${id}-publishLocal`}>發布時間（Asia/Taipei）*<input {...field("publishLocal")} required type="datetime-local" value={fields.publishLocal} onChange={(event) => update("publishLocal", event.target.value)} />{error("publishLocal")}</label>
                <label className="field" htmlFor={`${id}-expiryMode`}>到期設定 *<select {...field("expiryMode")} required value={fields.expiryMode} onChange={(event) => update("expiryMode", event.target.value as Fields["expiryMode"])}>
                  <option value="">請選擇</option><option value="none">明確無到期</option><option value="at">指定到期時間</option></select>{error("expiryMode")}</label>
                {fields.expiryMode === "at" && <label className="field" htmlFor={`${id}-expiresLocal`}>到期時間（Asia/Taipei）*<input {...field("expiresLocal")} required type="datetime-local" value={fields.expiresLocal} onChange={(event) => update("expiresLocal", event.target.value)} />{error("expiresLocal")}</label>}
              </div>
              <fieldset className={styles.audience}><legend>對象 *</legend>
                <div {...field("audience")} tabIndex={-1}>{error("audience")}</div>
                {staff.map((entry) => <label key={entry.userId}><input type="checkbox" checked={fields.userIds.includes(entry.userId)} onChange={(event) => update("userIds", event.target.checked ? [...fields.userIds, entry.userId] : fields.userIds.filter((value) => value !== entry.userId))} /><span>{entry.displayName}<small>{entry.employeeCode}</small></span></label>)}
                {roles.map((entry) => <label key={entry.roleId}><input type="checkbox" checked={fields.roleIds.includes(entry.roleId)} onChange={(event) => update("roleIds", event.target.checked ? [...fields.roleIds, entry.roleId] : fields.roleIds.filter((value) => value !== entry.roleId))} />{entry.roleName}</label>)}
                {!recovered && fields.userIds.filter((value) => !staff.some((entry) => entry.userId === value)).map((value, index) => <label key={value}><input type="checkbox" checked onChange={() => update("userIds", fields.userIds.filter((entry) => entry !== value))} />已失效員工 {index + 1}（請取消）</label>)}
                {!recovered && fields.roleIds.filter((value) => !roles.some((entry) => entry.roleId === value)).map((value, index) => <label key={value}><input type="checkbox" checked onChange={() => update("roleIds", fields.roleIds.filter((entry) => entry !== value))} />已失效角色 {index + 1}（請取消）</label>)}
                {recovered && <small>原選定 {fields.userIds.length} 位員工、{fields.roleIds.length} 個角色；回查不會更換對象。</small>}
              </fieldset>
            </>}
            {(draft && revision || action === "withdraw") && <label className="field" htmlFor={`${id}-reason`}>{action === "withdraw" ? "撤回理由 *" : "修改理由 *"}<textarea {...field("reason")} className="resize-none" maxLength={1000} required rows={4} value={fields.reason} onChange={(event) => update("reason", event.target.value)} /><small>請填寫 1–1000 字理由。</small>{error("reason")}</label>}
            {action === "publish" && <p>發布目前草稿並保存收件人快照。<strong>{visibleEditor?.item?.title ?? "原公告草稿"}</strong></p>}
            {action === "withdraw" && <p>撤回目前發布版本；既有版本與已讀紀錄會保留。</p>}
          </fieldset>}
          {ownOperation?.phase === "unknown" && mayRecover && <p role="alert">{UNKNOWN}</p>}
          <div className="drawer__footer">
            {ownOperation?.phase === "unknown" && mayRecover && <button className="button button--secondary" onClick={() => { if (!composition.current) { composition.current = false; setEditor(null); setRecoveryOpen(false); } }} type="button">回待確認清單</button>}
            {ownOperation && mayRecover ? <button className="button" disabled={ownOperation.phase === "sending"} onClick={retry} type="button">{ownOperation.phase === "sending" ? "確認中…" : "重試同一操作"}</button>
              : <button className="button" disabled={pending || changingView} type="submit">{action === "draft" ? "建立不可變草稿" : action === "publish" ? "確認發布" : "確認撤回"}</button>}
          </div>
        </div>
      </form>
    </GovernanceDialog>
    <GovernanceDialog open={guard.open} title="放棄未保存的公告編輯？" cancelLabel="繼續編輯" onRequestClose={() => { if (!composition.current) guard.cancel(); }} returnFocusRef={guard.returnFocusRef}>
      <p>尚未保存的內容會被清除；已送出而未確認的操作不能放棄。</p>
      <button className="button" onClick={() => { if (!composition.current) guard.confirmDiscard(); }} type="button">放棄編輯並繼續</button>
    </GovernanceDialog>
  </ControllerContext.Provider>;
}
