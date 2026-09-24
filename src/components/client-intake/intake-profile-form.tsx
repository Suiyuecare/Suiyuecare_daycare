"use client";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { emptyIntakeProfile, intakeProfileSchema, intakeMissingItems, type IntakeProfile, type IntakeSnapshot } from "@/lib/client-intake/model";
import { intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import styles from "./intake.module.css";

export function IntakeProfileForm({ initial, canManage, demo, today, onSaved, onDirty, onBusy }: {
  initial: IntakeSnapshot | null; canManage: boolean; demo: boolean; today: string;
  onSaved: (clientId: string) => Promise<void>; onDirty: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [profile, setProfile] = useState<IntakeProfile>(() => structuredClone(initial?.profile ?? emptyIntakeProfile));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  const disabled = !canManage || demo || busy;
  function focusField(name: string) {
    const control = formRef.current?.elements.namedItem(name);
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
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (disabled || inFlight.current) return;
    setError(""); setInvalid([]);
    const parsed = intakeProfileSchema.safeParse(profile);
    if (!parsed.success) { setInvalid([...new Set(parsed.error.issues.map((i) => i.path.join(".")))]); setError("以下欄位格式或必填資料尚未完成，請點選欄位回到原處修改。資料尚未儲存。"); return; }
    const payload = JSON.stringify({ action: initial ? "update" : "create", profile: parsed.data, ...(initial ? { clientId: initial.clientId, expectedVersion: initial.profileVersion, expectedClientVersion: initial.clientRowVersion } : {}) });
    if (operation.current?.payload !== payload) operation.current = { payload, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true);
    try {
      const receipt = z.object({ clientId: z.uuid(), persisted: z.literal(true) }).parse(await intakeRequest("/api/client-intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(payload), idempotency_key: operation.current.key }) }));
      if (initial && receipt.clientId !== initial.clientId) throw new Error("儲存回條與目前個案不一致，請保留輸入並重試，不要另建個案。");
      onDirty(false); setMessage("基本資料已儲存，正在重新讀取。建檔不代表已核准收案。");
      await onSaved(receipt.clientId);
    } catch (e) { setError(intakeErrorMessage(e)); } finally { inFlight.current = false; setBusy(false); }
  }
  return <form ref={formRef} onSubmit={save} className={styles.form}>
    <div><h2>{initial ? "核對個案基本資料" : "手動建立待收案個案"}</h2><p>先存基本資料，再接續安排到站、表單與文件。沒有的資料可以留待補，不要猜填。</p></div>
    {demo ? <p className={styles.notice}>合成資料試看：可以查看欄位，不會保存個案。</p> : !canManage ? <p className={styles.notice}>目前僅可查看，請由有權限的收案人員修改。</p> : null}
    <fieldset disabled={disabled}><legend>身分與聯繫</legend><div className={styles.grid}>
      {field("displayName", "姓名／顯示稱呼", "text", true)}{field("clientCode", "機構個案編號", "text", true)}
      {field("identityNumber", "身分證／居留證識別")}{field("dateOfBirth", "出生日期", "date")}
      <label>性別<select value={profile.sex} disabled={locked("sex")} onChange={(e) => update("sex", e.target.value as IntakeProfile["sex"])}><option value="unknown">未提供</option><option value="male">男</option><option value="female">女</option><option value="other">其他</option></select></label>
      {field("phone", "個案電話", "tel")}{field("registeredAddress", "戶籍地址")}{field("residentialAddress", "居住地址")}
      <label>CMS 等級<select value={profile.cmsLevel ?? ""} disabled={locked("cmsLevel")} onChange={(e) => update("cmsLevel", e.target.value ? Number(e.target.value) : null)}><option value="">未提供</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((v) => <option key={v} value={v}>{v} 級</option>)}</select></label>
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
      <label>告知同意狀態<select value={profile.consent.status} onChange={(e) => update("consent", { status: e.target.value as IntakeProfile["consent"]["status"], confirmedOn: null })}><option value="pending">待確認</option><option value="confirmed">已明確確認</option><option value="declined">尚未同意</option></select></label>
      <label>確認日期<input name="consent.confirmedOn" {...errorAttributes("consent.confirmedOn")} type="date" max={today} required={profile.consent.status === "confirmed"} disabled={profile.consent.status !== "confirmed"} value={profile.consent.confirmedOn ?? ""} onChange={(e) => update("consent", { ...profile.consent, confirmedOn: e.target.value || null })} /></label>
    </div><label>機構補充說明<textarea name="notes" {...errorAttributes("notes")} value={profile.notes} rows={3} maxLength={4000} onChange={(e) => update("notes", e.target.value)} /></label></fieldset>
    <p className={styles.notice}>目前仍待核對：{intakeMissingItems(profile).join("、") || "基本欄位已提供；仍須確認評估、文件與正式收案審核。"}</p>
    {error ? <div className={styles.error} role="alert" id={errorId}><p>{error}</p>{invalid.length ? <ul>{invalid.map((path) => <li key={path}><button type="button" onClick={() => focusField(path)}>{fieldLabel(path)}</button></li>)}</ul> : null}</div> : null}{message ? <p role="status">{message}</p> : null}
    <button className="button button--primary" type="submit" disabled={disabled}>{busy ? "儲存與核對中…" : initial ? "儲存基本資料" : "建立待收案個案"}</button>
  </form>;
}
