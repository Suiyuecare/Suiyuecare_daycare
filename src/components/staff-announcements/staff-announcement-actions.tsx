"use client";

import { Check, Eye, FilePlus2, Send, ShieldAlert, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  useId,
  useRef,
  useState,
} from "react";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  parseStaffAnnouncementApiEnvelope,
  parseStaffAnnouncementInput,
  type StaffAnnouncementAction,
} from "@/lib/integrations/staff-announcements";
import { defaultTaipeiLocal, isoToTaipeiLocal, taipeiLocalToIso } from "@/lib/staff-announcements/date";
import type {
  StaffAnnouncementAudienceRole,
  StaffAnnouncementAudienceStaff,
  StaffAnnouncementItem,
  StaffAnnouncementMutationInput,
} from "@/lib/staff-announcements/types";

import styles from "./staff-announcements.module.css";

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function errorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const envelope = value as { requestId?: unknown; errors?: unknown };
  const requestId = typeof envelope.requestId === "string" ? envelope.requestId : null;
  const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
  const first = errors[0] as { message?: unknown } | undefined;
  const message = typeof first?.message === "string" ? first.message : fallback;
  return requestId ? `${message}（請求識別碼：${requestId}）` : message;
}

async function submitAction(
  action: StaffAnnouncementAction,
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  const expected = parseStaffAnnouncementInput(action, body, idempotencyKey);
  const response = await fetchWithTimeout("/api/staff-announcements", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Announcement-Action": action,
    },
    body: JSON.stringify(body),
  });
  const envelope = await safeJson(response);
  if (!response.ok) throw new Error(errorMessage(
    envelope,
    "公告操作未確認完成；內容與相同操作鍵已保留，可直接重試。",
  ));
  try {
    return parseStaffAnnouncementApiEnvelope(envelope, expected);
  } catch (error) {
    throw new Error(errorMessage(
      envelope,
      error instanceof Error ? error.message : "公告操作回應無法確認。",
    ));
  }
}

function trapFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("disabled"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

type DraftFields = {
  title: string;
  body: string;
  publishLocal: string;
  expiryMode: "" | "none" | "at";
  expiresLocal: string;
  userIds: readonly string[];
  roleIds: readonly string[];
  reason: string;
};

function draftFields(item?: StaffAnnouncementItem): DraftFields {
  return {
    title: item?.title ?? "",
    body: item?.body ?? "",
    publishLocal: item ? isoToTaipeiLocal(item.publishAt) : "",
    expiryMode: item ? (item.expiresAt ? "at" : "none") : "",
    expiresLocal: item?.expiresAt ? isoToTaipeiLocal(item.expiresAt) : "",
    userIds: item?.audienceUserIds ?? [],
    roleIds: item?.audienceRoleIds ?? [],
    reason: "",
  };
}

export function StaffAnnouncementDraftAction({
  item, staff, roles, canManage, demo,
}: {
  item?: StaffAnnouncementItem;
  staff: readonly StaffAnnouncementAudienceStaff[];
  roles: readonly StaffAnnouncementAudienceRole[];
  canManage: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = useRef(crypto.randomUUID());
  const [fields, setFields] = useState(() => draftFields(item));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const usableUsers = new Set(staff.map((person) => person.userId));
  const usableRoles = new Set(roles.map((role) => role.roleId));
  const missingAudience = item ?
    item.audienceUserIds.filter((id) => !usableUsers.has(id)).length +
      item.audienceRoleIds.filter((id) => !usableRoles.has(id)).length : 0;
  const disabledReason = demo ? "展示模式唯讀" : !canManage
    ? "需要 announcements.manage 權限"
    : staff.length + roles.length === 0 ? "目前沒有可選的有效員工或角色" : null;

  function changed(next: DraftFields) {
    key.current = crypto.randomUUID();
    setFields(next); setError(null);
  }
  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    key.current = crypto.randomUUID(); setFields(draftFields(item)); setError(null);
    dialog.current?.showModal();
  }
  function close() { if (!pending) dialog.current?.close(); }
  function toggle(kind: "userIds" | "roleIds", id: string, checked: boolean) {
    changed({ ...fields, [kind]: checked
      ? [...fields[kind], id]
      : fields[kind].filter((value) => value !== id) });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      if (!fields.publishLocal || !fields.expiryMode ||
        (fields.expiryMode === "at" && !fields.expiresLocal)) {
        throw new Error("請明確選擇發布時間，以及無到期或指定到期時間。");
      }
      const body = {
        previous_version_id: item?.versionId ?? null,
        title: fields.title, body: fields.body,
        publish_at: taipeiLocalToIso(fields.publishLocal),
        expires_at: fields.expiryMode === "at" ? taipeiLocalToIso(fields.expiresLocal) : null,
        audience_user_ids: fields.userIds,
        audience_role_ids: fields.roleIds,
        change_reason: item ? fields.reason : null,
      };
      const receipt = await submitAction("draft", body, key.current);
      if (receipt.data.action !== "draft") throw new Error("公告草稿回應類型不一致。");
      dialog.current?.close();
      setNotice(`已建立不可變草稿 v${receipt.data.version}；請求識別碼：${receipt.requestId}`);
      key.current = crypto.randomUUID(); router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "公告草稿未確認完成。");
    } finally { setPending(false); }
  }

  return <div className={styles.actionBox}>
    <button className={item ? "button button--quiet" : "button button--primary"}
      disabled={Boolean(disabledReason)} onClick={open} ref={trigger}
      title={disabledReason ?? undefined} type="button">
      <FilePlus2 aria-hidden="true" />{item ? "建立新版" : "建立公告"}
    </button>
    {notice ? <p className={styles.inlineNotice} role="status">{notice}</p> : null}
    <dialog aria-labelledby={titleId}
      className={`core-dialog ${styles.dialog}`} onCancel={(event) => { if (pending) event.preventDefault(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onClose={() => trigger.current?.focus()} onKeyDown={trapFocus} ref={dialog}>
      <form className="core-dialog__surface" onSubmit={submit}>
        <header className="drawer__header"><div><p className="eyebrow">不可覆寫公告版本</p><h2 id={titleId}>{item ? `從 v${item.version} 建立新版` : "建立公告草稿"}</h2></div><button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
        <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}>
          <div className="callout"><ShieldAlert aria-hidden="true" /><span>草稿不會送達任何人；發布時才重新驗證有效員工並凍結精確收件名單。到期政策沒有預設值，請明確選擇。</span></div>
          {missingAudience ? <p className="form-error" role="status">原版本有 {missingAudience} 個已失效對象，未自動帶入；請重新選擇有效對象。</p> : null}
          <fieldset className={styles.formFields} disabled={pending}>
            <label className="field"><span>標題 *</span><input autoFocus maxLength={200} onChange={(event) => changed({ ...fields, title: event.target.value })} required value={fields.title} /></label>
            <label className="field"><span>內容 *</span><textarea maxLength={10_000} onChange={(event) => changed({ ...fields, body: event.target.value })} required rows={6} value={fields.body} /></label>
            <div className={styles.twoColumns}>
              <label className="field"><span>發布時間（Asia/Taipei）*</span><input onChange={(event) => changed({ ...fields, publishLocal: event.target.value })} required type="datetime-local" value={fields.publishLocal} /></label>
              <label className="field"><span>到期設定 *</span><select onChange={(event) => changed({ ...fields, expiryMode: event.target.value as DraftFields["expiryMode"], expiresLocal: event.target.value === "at" ? fields.expiresLocal : "" })} required value={fields.expiryMode}><option value="">請明確選擇</option><option value="none">無到期時間</option><option value="at">指定到期時間</option></select></label>
              {fields.expiryMode === "at" ? <label className="field"><span>到期時間（Asia/Taipei）*</span><input onChange={(event) => changed({ ...fields, expiresLocal: event.target.value })} required type="datetime-local" value={fields.expiresLocal} /></label> : null}
              {item ? <label className="field"><span>新版理由 *</span><textarea maxLength={1_000} onChange={(event) => changed({ ...fields, reason: event.target.value })} required value={fields.reason} /></label> : null}
            </div>
            <fieldset className={styles.audience}><legend>精確員工（可與角色合併）</legend>{staff.map((person) => <label key={person.userId}><input checked={fields.userIds.includes(person.userId)} onChange={(event) => toggle("userIds", person.userId, event.target.checked)} type="checkbox" /><span>{person.displayName}<small>{person.employeeCode ?? person.profileKind}</small></span></label>)}</fieldset>
            <fieldset className={styles.audience}><legend>本分支治理角色（發布時解析有效員工）</legend>{roles.map((role) => <label key={role.roleId}><input checked={fields.roleIds.includes(role.roleId)} onChange={(event) => toggle("roleIds", role.roleId, event.target.checked)} type="checkbox" /><span>{role.roleName}</span></label>)}</fieldset>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <footer className="drawer__footer"><button className="button button--quiet" disabled={pending} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "儲存中…" : "建立不可變草稿"}</button></footer>
      </form>
    </dialog>
  </div>;
}

function ConfirmAction({
  action, item, canPublish, hasRecentAal2, demo, generatedAt,
}: {
  action: "publish" | "withdraw";
  item: StaffAnnouncementItem;
  canPublish: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
  generatedAt: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const expiredDraft = action === "publish" && item.expiresAt !== null &&
    new Date(item.expiresAt).getTime() <= new Date(generatedAt).getTime();
  const eligible = action === "publish" ? item.versionState === "draft" :
    item.activeReleaseVersionId !== null && item.lifecycle !== "withdrawn";
  const disabledReason = demo ? "展示模式唯讀" : !canPublish
    ? "需要 announcements.publish 權限" : !hasRecentAal2
      ? "需要最近 15 分鐘 AAL2" : !eligible
        ? action === "publish" ? "目前版本不是可發布草稿" : "目前沒有可撤回發布版"
        : expiredDraft ? "到期時間已過，請先建立新版" : null;
  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget; key.current = crypto.randomUUID();
    setReason(""); setError(null); dialog.current?.showModal();
  }
  function close() { if (!pending) dialog.current?.close(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const body = action === "publish"
        ? { draft_version_id: item.versionId }
        : { expected_latest_version_id: item.versionId, release_version_id: item.activeReleaseVersionId, reason };
      const receipt = await submitAction(action, body, key.current);
      if (receipt.data.action !== action) throw new Error("公告回應類型不一致。");
      dialog.current?.close();
      setNotice(`${action === "publish" ? "已發布並凍結員工收件名單" : "已建立撤回版本"}；請求識別碼：${receipt.requestId}`);
      key.current = crypto.randomUUID(); router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "公告操作未確認完成。");
    } finally { setPending(false); }
  }
  const title = action === "publish" ? "發布公告" : "撤回公告";
  return <div className={styles.actionBox}>
    <button className={action === "publish" ? "button button--secondary" : "button button--quiet"}
      disabled={Boolean(disabledReason)} onClick={open} ref={trigger}
      title={disabledReason ?? undefined} type="button">
      {action === "publish" ? <Send aria-hidden="true" /> : <Undo2 aria-hidden="true" />}{title}
    </button>
    {notice ? <p className={styles.inlineNotice} role="status">{notice}</p> : null}
    <dialog aria-labelledby={titleId} className={`core-dialog ${styles.confirmDialog}`}
      onCancel={(event) => { if (pending) event.preventDefault(); }} onClose={() => trigger.current?.focus()}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={trapFocus} ref={dialog}>
      <form className="core-dialog__surface" onSubmit={submit}>
        <header className="drawer__header"><div><p className="eyebrow">近期 AAL2 高風險操作</p><h2 id={titleId}>{title}</h2></div><button aria-label="關閉" autoFocus className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
        <div className="drawer__body core-dialog__body"><p><strong>{item.title}</strong>・目前 v{item.version}</p>{action === "publish" ? <p>發布會依目前分支、角色與有效員工解析精確收件名單，之後不會因人員異動改寫。</p> : <label className="field"><span>撤回理由 *</span><textarea disabled={pending} maxLength={1_000} onChange={(event) => { key.current = crypto.randomUUID(); setReason(event.target.value); }} required value={reason} /></label>}{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <footer className="drawer__footer"><button className="button button--quiet" disabled={pending} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "確認中…" : title}</button></footer>
      </form>
    </dialog>
  </div>;
}

export function StaffAnnouncementPublishAction(props: Omit<Parameters<typeof ConfirmAction>[0], "action">) {
  return <ConfirmAction action="publish" {...props} />;
}

export function StaffAnnouncementWithdrawAction(props: Omit<Parameters<typeof ConfirmAction>[0], "action">) {
  return <ConfirmAction action="withdraw" {...props} />;
}

export function StaffAnnouncementReadAction({ item, enabled, demo }: {
  item: StaffAnnouncementItem; enabled: boolean; demo: boolean;
}) {
  const router = useRouter();
  const key = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const readable = item.actorIsRecipient && item.activeReleaseVersionId !== null &&
    ["published", "expired"].includes(item.lifecycle) && item.actorReadAt === null;
  async function markRead() {
    if (!item.activeReleaseVersionId) return;
    setPending(true); setMessage(null);
    try {
      const receipt = await submitAction("read", { release_version_id: item.activeReleaseVersionId }, key.current);
      if (receipt.data.action !== "read") throw new Error("已讀回應類型不一致。");
      setMessage(`已記錄實際閱讀；請求識別碼：${receipt.requestId}`);
      key.current = crypto.randomUUID(); router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "已讀未確認完成。");
    } finally { setPending(false); }
  }
  if (item.actorReadAt) return <span className="status-pill status-pill--success"><Check aria-hidden="true" />已讀</span>;
  return <div className={styles.actionBox}>
    <button className="button button--quiet" disabled={demo || !enabled || !readable || pending}
      onClick={markRead} title={demo ? "展示模式唯讀" : !enabled
        ? "需要 announcements.read 權限"
        : !readable ? "目前不是可補記已讀的收件公告" : undefined} type="button">
      <Eye aria-hidden="true" />{pending ? "記錄中…" : item.lifecycle === "expired" ? "補記歷史已讀" : "標為已讀"}
    </button>
    {message ? <small aria-live="polite" className={styles.actionMessage}>{message}</small> : null}
  </div>;
}

export const staffAnnouncementDefaultTaipeiLocal = defaultTaipeiLocal;
export type { StaffAnnouncementMutationInput };
