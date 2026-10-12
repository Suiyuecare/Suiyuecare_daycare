"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { UserPlus, Check, X } from "lucide-react";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { staffInvitationInput, staffInvitationList, staffInvitationReceipt, type StaffInvitation } from "@/lib/staff-management/invitation";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import type { StaffRoleOption } from "@/lib/staff-management/types";
import styles from "./staff-management.module.css";

const labels = { pending: "待主管核准", approved: "待 Google 首次登入", rejected: "已駁回", expired: "已過期", activated: "已開通" };
export function StaffInvitations({ currentUserId, canManage, canApprove, hasRecentAal2, roles, demo }: {
  currentUserId: string; canManage: boolean; canApprove: boolean; hasRecentAal2: boolean;
  roles: readonly StaffRoleOption[]; demo: boolean;
}) {
  const [items, setItems] = useState<StaffInvitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const lock = useRef(false);
  const register = useScopeChangeDraftRegistration();
  useLayoutEffect(() => { register({ dirty, busy, unknown }); }, [register, dirty, busy, unknown]);
  useEffect(() => {
    if (demo || !canManage) return;
    const controller = new AbortController();
    fetchWithTimeout("/api/staff-management/invitations", { cache: "no-store", signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); const body = await r.json();
        setItems(staffInvitationList.parse(body.data?.invitations)); })
      .catch(() => { if (!controller.signal.aborted) setMessage("邀請清單無法載入，請重試。"); });
    return () => controller.abort();
  }, [canManage, demo, reload]);
  async function send(payload: object) {
    if (lock.current) return;
    const value = JSON.stringify(payload);
    if (unknown && key.current?.payload !== value) { setMessage("請先確認上一筆儲存結果，再進行其他操作。"); return; }
    if (key.current?.payload !== value) key.current = { payload: value, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true); setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/staff-management/invitations", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "idempotency-key": key.current.key }, body: value,
      });
      const body = await response.json();
      if (!response.ok) {
        if (!unknown && [400, 401, 403, 422].includes(response.status) && body.status === "error") key.current = null;
        else setUnknown(true);
        throw new Error(body.errors?.[0]?.message ?? "儲存結果未確認，請重試。");
      }
      staffInvitationReceipt.parse(body.data?.receipt);
      key.current = null; setUnknown(false); setDirty(false); setMessage("已儲存。"); setReload((v) => v + 1);
    } catch (error) { if (key.current) setUnknown(true); setMessage(error instanceof Error && error.message ? error.message : "儲存結果未確認，請保留內容重試。"); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!canManage || demo) return null;
  return <section className={styles.records} aria-labelledby="staff-invite-heading">
    <div className={styles.sectionHeading}><h2 id="staff-invite-heading"><UserPlus aria-hidden="true" /> 開通員工</h2>
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => setReload((v) => v + 1)}>重新載入</button></div>
    <p>公司 Google 信箱 → 另一位主管核准 → 員工首次登入。</p>
    {hasRecentAal2 ? <form noValidate onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
      const input = staffInvitationInput.safeParse({ action: "propose", email: String(form.get("email") ?? "").trim(), displayName: form.get("name"), roleId: form.get("role") });
      if (!input.success) { setMessage("請填寫姓名、有效公司信箱及職務。"); return; }
      void send(input.data); }}>
      <fieldset className={styles.formGrid} disabled={busy || unknown}><label>姓名<input name="name" required maxLength={100} autoComplete="off" /></label>
        <label>公司 Google 信箱<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <label>職務<select name="role" required defaultValue=""><option value="" disabled>選擇職務</option>
          {roles.filter((r) => r.isSystem && r.roleKey !== "family").map((r) => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}</select></label>
        <button className="button" type="submit"><UserPlus aria-hidden="true" />提出邀請</button></fieldset>
    </form> : <a className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">開通員工前確認身分</a>}
    {message ? <p role="status">{message}</p> : null}
    {unknown ? <button type="button" className="button" disabled={busy}
      onClick={() => { if (key.current) void send(JSON.parse(key.current.payload)); }}>重試同一次操作</button> : null}
    <ul className={styles.timeline}>{items.map((item) => <li key={item.id}><div><strong>{item.display_name}</strong>
      <span>{labels[item.state]}</span></div><p>{item.allowed_email} · {item.role_name}</p>
      {canApprove && hasRecentAal2 && !unknown && item.state === "pending" && item.requested_by !== currentUserId ?
        <div><button type="button" disabled={busy} className="button" onClick={() => void send({ action: "approve", invitationId: item.id })}><Check aria-hidden="true" />核准</button>
          <button type="button" disabled={busy} className="button button--secondary" onClick={() => void send({ action: "reject", invitationId: item.id })}><X aria-hidden="true" />駁回</button></div> : null}</li>)}</ul>
  </section>;
}
