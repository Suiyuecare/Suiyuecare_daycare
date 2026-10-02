"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { TenantContext } from "@/lib/domain/types";
import { emptyIntakeProfile, intakeProfileSchema, intakeMissingItems, type IntakeProfile, type IntakeSnapshot } from "@/lib/client-intake/model";
import { IntakeRequestError, intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import { beginIntakeWrite, confirmIntakeWriteReadback, getIntakeWriteOperation, hasIntakeWriteOperation,
  intakeWriteAuthority, isCurrentIntakeWrite, isIntakeWriteAuthorityCurrent, markIntakeWriteUnknown, rejectIntakeWrite,
  retryIntakeWrite, saveIntakeWriteReceipt, useIntakeWriteState, type IntakeWriteOperation } from "@/lib/client-intake/write-pending";
import styles from "./intake.module.css";

type Props = {
  context: TenantContext; initial: IntakeSnapshot | null; canManage: boolean; demo: boolean; today: string;
  onSaved: (clientId: string) => Promise<IntakeSnapshot | void>; onDirty: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void;
};
export function IntakeProfileForm(props: Props) {
  const state = useIntakeWriteState();
  return <IntakeProfileEditor {...props} key={JSON.stringify([intakeWriteAuthority(props.context), state.epoch, props.initial?.clientId ?? null])} />;
}
function IntakeProfileEditor({ context, initial, canManage, demo, today, onSaved, onDirty, onBusy }: Props) {
  const state = useIntakeWriteState();
  const pending = getIntakeWriteOperation(context, "profile", initial?.clientId ?? null);
  const [profile, setProfile] = useState<IntakeProfile>(() => pending ? JSON.parse(pending.body).profile : structuredClone(initial?.profile ?? emptyIntakeProfile));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const optionalDetails = useRef<HTMLDetailsElement>(null);
  const errorId = useId();
  const inFlight = useRef(false);
  const active = useRef<IntakeWriteOperation | null>(null), controller = useRef<AbortController | null>(null);
  const lifecycle = useRef({ generation: 0 });
  useLayoutEffect(() => {
    const owner = lifecycle.current; owner.generation++;
    return () => { owner.generation++; controller.current?.abort(); if (active.current) markIntakeWriteUnknown(active.current); };
  }, []);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => { if (pending) onDirty(true); }, [pending, onDirty]);
  const isolated = !demo && (!isIntakeWriteAuthorityCurrent(context) || hasIntakeWriteOperation() && !pending);
  const disabled = !canManage || demo || busy || Boolean(pending) || isolated;
  const canRecover = pending?.phase === "saved" ? ["clients.read", "clients.demographics.read"].every(scope => context.scopes.includes(scope)) : canManage;
  function focusField(name: string) {
    if (name !== "displayName" && name !== "clientCode") optionalDetails.current?.setAttribute("open", "");
    const control = formRef.current?.elements.namedItem(name === "contacts" ? "contacts.0.name" : name);
    if (control instanceof HTMLElement) control.focus();
  }
  useEffect(() => { if (invalid.length) focusField(invalid[0]); }, [invalid]);
  function fieldLabel(path: string) {
    const labels: Record<string, string> = { displayName: "姓名／顯示稱呼", clientCode: "機構個案編號", identityNumber: "身分識別", dateOfBirth: "出生日期", phone: "個案電話", registeredAddress: "戶籍地址", residentialAddress: "居住地址", disability: "身障資格／程度", notes: "機構補充說明", "consent.confirmedOn": "同意確認日期", "consent.status": "告知同意狀態", contacts: "主要聯絡人" };
    const contact = /^contacts\.(\d+)\.(\w+)$/u.exec(path);
    if (contact) return `聯絡人 ${Number(contact[1]) + 1}：${({ name: "姓名", relationship: "與個案關係", phone: "聯絡電話", address: "聯絡地址" } as Record<string, string>)[contact[2]] ?? "主要／緊急聯絡狀態"}`;
    return labels[path] ?? "個案資料";
  }
  function errorAttributes(path: string) { return { "aria-invalid": invalid.includes(path), "aria-describedby": invalid.includes(path) ? errorId : undefined }; }
  function update<K extends keyof IntakeProfile>(key: K, value: IntakeProfile[K]) {
    if (disabled) return;
    setProfile((p) => ({ ...p, [key]: value })); onDirty(true); setMessage("");
  }
  function locked(key: keyof IntakeProfile) {
    return disabled || initial?.fieldAuthority[key] === "central" && ["displayName", "identityNumber", "dateOfBirth", "sex", "cmsLevel", "disability"].includes(key) || key === "identityNumber" && Boolean(initial?.profile.identityNumber);
  }
  function field(key: "displayName" | "clientCode" | "dateOfBirth" | "identityNumber" | "phone" | "registeredAddress" | "residentialAddress" | "disability", label: string, type = "text", required = false) {
    return <label>{label}{required ? "（必填）" : ""}
      <input name={key} type={type} required={required} value={profile[key] ?? ""} disabled={locked(key)} {...errorAttributes(key)} maxLength={key.includes("Address") || key === "disability" ? 500 : key === "clientCode" ? 64 : key === "identityNumber" ? 32 : key === "phone" ? 80 : 120} max={type === "date" ? today : undefined} autoComplete="off" onChange={(e) => update(key, e.target.value || (required ? "" : null))} />
      {initial?.fieldAuthority[key] === "central" ? <small>中央來源；受保護欄位請透過 CMS 核對更新。</small> : null}
    </label>;
  }
  async function send(original: IntakeWriteOperation) {
    if (!isCurrentIntakeWrite(original)) return;
    const generation = lifecycle.current.generation;
    const abort = new AbortController(); controller.current = abort; active.current = original;
    inFlight.current = true; setBusy(true); setError("");
    const current = () => generation === lifecycle.current.generation && isCurrentIntakeWrite(original);
    try {
      const value = await intakeRequest("/api/client-intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: original.body, signal: abort.signal });
      if (!current()) return;
      const saved = saveIntakeWriteReceipt(original, value); if (!saved) return;
      active.current = saved; await readSaved(saved, generation);
    } catch (e) {
      if (!current()) return;
      if (e instanceof IntakeRequestError && e.definitiveRejection) rejectIntakeWrite(original); else markIntakeWriteUnknown(original);
      setError(original.everUnknown ? "原次保存仍待確認；本次拒絕不能證明前次未保存。請保留原操作，不要另建個案。" : intakeErrorMessage(e));
    } finally { if (controller.current === abort) controller.current = null;
      if (generation === lifecycle.current.generation) { inFlight.current = false; setBusy(false); } }
  }
  async function readSaved(saved: IntakeWriteOperation, generation = lifecycle.current.generation) {
    if (!isCurrentIntakeWrite(saved) || !saved.receipt) return;
    setMessage("基本資料已有保存回條，正在核對最新資料；建檔不代表已核准收案。");
    try {
      const snapshot = await onSaved(saved.receipt.clientId);
      const verified = confirmIntakeWriteReadback(saved, snapshot);
      if (generation !== lifecycle.current.generation) return;
      if (verified) { onDirty(false); setMessage("基本資料已儲存並核對讀回；建檔不代表已核准收案。"); }
      else if (isCurrentIntakeWrite(saved)) setError("基本資料已保存，但原版本內容尚未完整讀回。請重讀資料，不要再次建檔。");
    } catch { if (generation === lifecycle.current.generation && isCurrentIntakeWrite(saved)) setError("基本資料已保存，但資料讀取失敗。請重讀資料，不要再次建檔。"); }
  }
  async function recover() {
    if (!pending || busy || inFlight.current || !canRecover || demo || isolated) return;
    if (pending.phase === "saved") {
      inFlight.current = true; setBusy(true); setError("");
      try { await readSaved(pending); } finally { inFlight.current = false; setBusy(false); }
    } else { const retry = retryIntakeWrite(pending, context); if (retry) await send(retry); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (disabled || inFlight.current) return;
    setError(""); setInvalid([]);
    const parsed = intakeProfileSchema.safeParse(profile);
    if (!parsed.success) { setInvalid([...new Set(parsed.error.issues.map((i) => i.path.join(".")))]); setError("以下欄位格式或必填資料尚未完成，請點選欄位回到原處修改。資料尚未儲存。"); return; }
    const operation = beginIntakeWrite(context, "profile", initial?.clientId ?? null, { action: initial ? "update" : "create", profile: parsed.data,
      idempotency_key: crypto.randomUUID(), ...(initial ? { clientId: initial.clientId, expectedVersion: initial.profileVersion, expectedClientVersion: initial.clientRowVersion } : {}) });
    if (operation) await send(operation);
  }
  if (isolated) return <p role="status">原收案操作仍待核對，內容已隔離。請回原授權範圍核對；若登入或權限已變更，請安全登出後重新登入。</p>;
  const missingItems = intakeMissingItems(profile);
  return <form ref={formRef} onSubmit={save} noValidate data-intake-write className={styles.form}>
    <div className={styles.formLead}><h2>{initial ? "核對基本資料" : "建立個案"}</h2><p>缺項可補，勿猜填。</p></div>
    {demo ? <p className={styles.notice}>合成資料試看 · 不會儲存。</p> : pending ? <p className={styles.notice}>請先核對原次保存；在結果確認前，暫時不能修改資料。</p> : !canManage ? <p className={styles.notice}>目前僅可查看，請由有權限的收案人員修改。</p> : null}
    <fieldset disabled={disabled}><legend>先填這兩項</legend><div className={styles.grid}>
      {field("displayName", "姓名／顯示稱呼", "text", true)}{field("clientCode", "機構個案編號", "text", true)}
    </div></fieldset>
    <section className={styles.missingCard} aria-label="基本資料待核對">
      <details className={styles.missingDisclosure}>
        <summary>基本資料待核對{missingItems.length ? ` · ${missingItems.length} 項` : " · 基本欄位已提供"}</summary>
        {!missingItems.length ? <p>基本欄位已提供；仍須確認評估、文件與正式收案審核。</p> : null}
        {missingItems.length ? <ul className={styles.missingItems}>{missingItems.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      </details>
    </section>
    <details className={styles.optionalProfile} open={Boolean(initial)} ref={optionalDetails}>
      <summary>{initial ? "核對其餘基本資料" : "補充資料（可稍後填）"}</summary>
    <fieldset disabled={disabled}><legend>身分與聯繫</legend><div className={styles.grid}>
      {field("identityNumber", "身分證／居留證識別")}{field("dateOfBirth", "出生日期", "date")}
      <label>性別<select name="sex" value={profile.sex} disabled={locked("sex")} onChange={(e) => update("sex", e.target.value as IntakeProfile["sex"])}><option value="unknown">未提供</option><option value="male">男</option><option value="female">女</option><option value="other">其他</option></select></label>
      {field("phone", "個案電話", "tel")}{field("registeredAddress", "戶籍地址")}{field("residentialAddress", "居住地址")}
      <label>CMS 等級<select name="cmsLevel" value={profile.cmsLevel ?? ""} disabled={locked("cmsLevel")} onChange={(e) => update("cmsLevel", e.target.value ? Number(e.target.value) : null)}><option value="">未提供</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((v) => <option key={v} value={v}>{v} 級</option>)}</select></label>
      {field("disability", "身障資格／程度")}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>關係人與交接聯絡</legend>
      {profile.contacts.length === 0 ? <p>尚未提供聯絡人。可先建檔，後續再補。</p> : null}
      {profile.contacts.map((contact, index) => <section key={index} className={styles.contact} aria-label={`聯絡人 ${index + 1}`}>
        <div className={styles.grid}>{([ ["name", "聯絡人姓名"], ["relationship", "與個案關係"], ["phone", "聯絡電話"], ["address", "聯絡地址"] ] as const).map(([key, label]) => <label key={key}>{label}<input name={`contacts.${index}.${key}`} {...errorAttributes(`contacts.${index}.${key}`)} value={contact[key]} autoComplete="off" maxLength={key === "address" ? 500 : key === "phone" ? 80 : 120} required={key === "name"} onChange={(e) => update("contacts", profile.contacts.map((c, i) => i === index ? { ...c, [key]: e.target.value } : c))} /></label>)}</div>
        <div className={styles.inline}><label><input type="checkbox" checked={contact.isPrimary} onChange={(e) => update("contacts", profile.contacts.map((c, i) => ({ ...c, isPrimary: i === index ? e.target.checked : e.target.checked ? false : c.isPrimary })))} />主要聯絡人</label>
          <label><input type="checkbox" checked={contact.isEmergency} onChange={(e) => update("contacts", profile.contacts.map((c, i) => i === index ? { ...c, isEmergency: e.target.checked } : c))} />緊急聯絡人</label>
          <button type="button" onClick={() => update("contacts", profile.contacts.filter((_, i) => i !== index))}>移除此聯絡欄位</button></div>
      </section>)}
      <button type="button" disabled={profile.contacts.length >= 10} onClick={() => update("contacts", [...profile.contacts, { name: "", relationship: "", phone: "", address: "", isPrimary: profile.contacts.length === 0, isEmergency: false }])}>＋新增聯絡人</button>
    </fieldset>
    <fieldset disabled={disabled}><legend>告知同意與補充</legend><div className={styles.grid}>
      <label>告知同意狀態<select name="consent.status" value={profile.consent.status} onChange={(e) => update("consent", { status: e.target.value as IntakeProfile["consent"]["status"], confirmedOn: null })}><option value="pending">待確認</option><option value="confirmed">已明確確認</option><option value="declined">尚未同意</option></select></label>
      <label>確認日期<input name="consent.confirmedOn" {...errorAttributes("consent.confirmedOn")} type="date" max={today} required={profile.consent.status === "confirmed"} disabled={profile.consent.status !== "confirmed"} value={profile.consent.confirmedOn ?? ""} onChange={(e) => update("consent", { ...profile.consent, confirmedOn: e.target.value || null })} /></label>
    </div><label>機構補充說明<textarea className="resize-none" name="notes" {...errorAttributes("notes")} value={profile.notes} rows={3} maxLength={4000} onChange={(e) => update("notes", e.target.value)} /></label></fieldset>
    </details>
    {error ? <div className={styles.error} role="alert" id={errorId}><p>{error}</p>{invalid.length ? <ul>{invalid.map((path) => <li key={path}><button type="button" onClick={() => focusField(path)}>{fieldLabel(path)}</button></li>)}</ul> : null}</div> : null}{message ? <p role="status">{message}</p> : null}
    {pending ? <div role="status"><p>{pending.phase === "saved" ? "已有保存回條，請重讀資料核對原版本，不會再次送出。" : "原次保存仍待確認，內容已固定；只能明確重試同一次操作。"}</p>
      <button className={`button button--primary ${styles.primary}`} type="button" disabled={busy || pending.phase === "sending" || !canRecover} onClick={recover}>{busy ? "核對中…" : pending.phase === "saved" ? "重讀已保存資料（不重送）" : "重試原次保存"}</button>
      <p>完整重新載入會失去此分頁的原操作，請先完成核對。</p>{state.navigationBlocked ? <p>請先核對原操作，再切換個案或離開。</p> : null}</div>
      : <button className={`button button--primary ${styles.primary}`} type="submit" disabled={disabled}>{busy ? "儲存與核對中…" : initial ? "儲存基本資料" : "建立待收案個案"}</button>}
  </form>;
}
