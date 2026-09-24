"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { INTAKE_STEPS, intakeSnapshotSchema, intakeMissingItems, type IntakeSnapshot } from "@/lib/client-intake/model";
import { intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import type { TenantContext } from "@/lib/domain/types";
import { profileToTaipeiPrefill } from "@/lib/taipei-abcd/prefill";
import { CmsIntakeStep } from "./cms-intake-step";
import { IntakeProfileForm } from "./intake-profile-form";
import { AdmissionHandoff } from "./admission-handoff";
import styles from "./intake.module.css";

const ClientWeeklyWorkspace = dynamic(() => import("@/components/client-weekly/client-weekly-workspace").then((m) => m.ClientWeeklyWorkspace), { loading: () => <p role="status">載入每週安排…</p> });
const TaipeiAbcdIntakeStep = dynamic(() => import("@/components/taipei-abcd/taipei-abcd-intake-step").then((m) => m.TaipeiAbcdIntakeStep), { loading: () => <p role="status">載入 A／B／C 表…</p> });
const ClientDocumentsWorkspace = dynamic(() => import("@/components/client-documents/client-documents-workspace").then((m) => m.ClientDocumentsWorkspace), { loading: () => <p role="status">載入應備文件…</p> });

type ClientChoice = { id: string; displayName: string; clientCode: string };
export function IntakeWorkspace({ context, clients: initialClients, initialSnapshot, loadError, today, initialStep = 1, archiveConfigured = false }: {
  context: TenantContext; clients: ClientChoice[]; initialSnapshot: IntakeSnapshot | null; loadError: boolean; today: string; initialStep?: number; archiveConfigured?: boolean;
}) {
  const [clients, setClients] = useState(initialClients);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedId, setSelectedId] = useState(initialSnapshot?.clientId ?? "");
  const [step, setStep] = useState(initialSnapshot ? initialStep : 0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([initialSnapshot ? initialStep : 0]));
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(loadError ? "個案清單或基本資料暫時無法載入，請重新整理後再試。沒有改用其他分支資料。" : "");
  const [dirtySteps, setDirtySteps] = useState<Record<number, boolean>>({});
  const dirty = Object.values(dirtySteps).some(Boolean);
  const [busySteps, setBusySteps] = useState<Record<number, boolean>>({});
  const saving = Object.values(busySteps).some(Boolean);
  const loadSequence = useRef(0);
  const scope = (permission: string) => context.demo || context.scopes.includes(permission);
  const canManage = !error && scope("clients.manage") && scope("clients.demographics.read");
  const canCreate = canManage && scope("clients.view_all");
  const importDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 0: value })), []);
  const profileDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 1: value })), []);
  const weeklyDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 2: value })), []);
  const abcdDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 3: value })), []);
  const documentDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 4: value })), []);
  const importBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 0: value })), []);
  const profileBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 1: value })), []);
  const weeklyBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 2: value })), []);
  const abcdBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 3: value })), []);
  const documentBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 4: value })), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const intercept = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.href === window.location.href || anchor.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("尚有未儲存的收案資料。確定離開並放棄這些輸入嗎？")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", intercept, true); };
  }, [dirty]);
  function goTo(value: number) { setStep(value); setVisited((v) => new Set([...v, value])); }
  async function readClient(clientId: string, fromWrite = false) {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(""); setSelectedId(clientId);
    try {
      const result = intakeSnapshotSchema.parse(await intakeRequest(`/api/client-intake?client=${clientId}`));
      if (sequence !== loadSequence.current) return;
      if (result.clientId !== clientId) throw new Error("讀回資料與所選個案不一致，已停止顯示。請重新讀取此個案。");
      const sameClient = snapshot?.clientId === clientId;
      setSnapshot(result); setManual(false); setStep(1);
      if (sameClient) setVisited((s) => new Set([...s, 1]));
      else { setVisited(new Set([1])); setDirtySteps({}); }
      setClients((v) => v.some((c) => c.id === clientId) ? v.map((c) => c.id === clientId ? { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode } : c) : [...v, { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode }]);
      window.history.replaceState(null, "", `/app/client-intake?client=${clientId}`);
    } catch (e) {
      if (sequence === loadSequence.current) { setError(`${fromWrite ? "伺服器已回報儲存成功，但最新資料尚未讀回。請重試讀取，不要另建一位個案。 " : ""}${intakeErrorMessage(e)}`); if (!fromWrite) setSnapshot(null); }
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  async function choose(id: string) {
    if (saving || loading) return;
    if (dirty && !window.confirm("尚有未儲存的資料。確定放棄並切換個案嗎？")) return;
    if (!id) { ++loadSequence.current; setSelectedId(""); setSnapshot(null); setManual(false); setVisited(new Set([0])); setStep(0); setError(""); setDirtySteps({}); window.history.replaceState(null, "", "/app/client-intake"); return; }
    if (context.demo) {
      const client = clients.find((c) => c.id === id)!;
      setSelectedId(id); setSnapshot({ clientId: id, profileVersion: 0, clientRowVersion: 1, pending: true, fieldAuthority: {}, sourceBatchId: null, profile: { displayName: client.displayName, clientCode: client.clientCode, dateOfBirth: null, identityNumber: null, sex: "unknown", phone: null, registeredAddress: null, residentialAddress: null, cmsLevel: null, disability: null, contacts: [], consent: { status: "pending", confirmedOn: null }, notes: "" } }); setVisited(new Set([1])); setStep(1); setDirtySteps({}); return;
    }
    await readClient(id);
  }
  const saved = (id: string) => readClient(id, true);
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>收案</p><h1>個案建檔</h1><p>匯入 CMS，再完成基本資料、每週安排、評估與文件。</p></div><Link className="button button--secondary" href="/app/staff/workspace/case-center">個案中心</Link></header>
    <section className={styles.selector}><label>目前處理的個案<select value={selectedId} disabled={loading || saving} onChange={(e) => choose(e.target.value)}><option value="">＋建立新個案</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName} · {client.clientCode}</option>)}</select></label><div><span className={styles.badge}>{snapshot ? snapshot.pending ? "待收案 · 尚未開始服務" : "已建檔 · 依服務狀態執行" : "尚未建檔"}</span><p>{snapshot ? `基本資料待核對 ${intakeMissingItems(snapshot.profile).length} 項` : "先匯入 CMS，或選擇手動建檔。"}</p></div></section>
    {context.demo ? <p className={styles.notice}>目前為本機合成資料試看，不會保存或上傳任何真實個案。</p> : null}
    {snapshot ? <AdmissionHandoff snapshot={snapshot} canRead={scope("clients.read")} blocked={dirty || saving || loading || Boolean(error)} /> : null}
    <nav aria-label="收案流程"><ol className={styles.steps}>{INTAKE_STEPS.map((title, index) => <li key={title}><button type="button" aria-current={step === index ? "step" : undefined} disabled={loading || saving || index > 0 && !snapshot && !(index === 1 && manual)} onClick={() => goTo(index)}><b>{index + 1}</b><span>{title}</span></button></li>)}</ol></nav>
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{selectedId ? <button type="button" disabled={loading} onClick={() => readClient(selectedId)}>重試讀取此個案</button> : <button type="button" onClick={() => window.location.reload()}>重新載入個案清單</button>}</div> : null}
    {loading ? <p role="status">正在讀取所選個案，請稍候…</p> : null}<div className={styles.panel} inert={loading} key={snapshot?.clientId ?? "new"}>
      <div hidden={step !== 0}>{visited.has(0) ? <CmsIntakeStep current={snapshot} canImport={scope("imports.manage") && canCreate} canApprove={scope("imports.approve") && (snapshot ? canManage : canCreate)} demo={context.demo} archiveConfigured={archiveConfigured} onSaved={saved} onDirty={importDirty} onBusy={importBusy} profileHasDraft={Boolean(dirtySteps[1])} onManual={() => { setManual(true); goTo(1); }} /> : null}</div>
      <div hidden={step !== 1}>{visited.has(1) ? <IntakeProfileForm key={snapshot?.profileVersion ?? 0} initial={snapshot} canManage={snapshot ? canManage : canCreate} demo={context.demo} today={today} onSaved={saved} onDirty={profileDirty} onBusy={profileBusy} /> : null}</div>
      <div hidden={step !== 2}>{visited.has(2) && snapshot ? <ClientWeeklyWorkspace clientId={snapshot.clientId} canManage={!error && scope("staff_scheduling.manage")} demo={context.demo} today={today} onDirty={weeklyDirty} onBusy={weeklyBusy} /> : null}</div>
      <div hidden={step !== 3}>{visited.has(3) && snapshot ? <TaipeiAbcdIntakeStep clientId={snapshot.clientId} organizationId={context.organizationId} branchId={context.branchId!} usageYear={115} readOnly={Boolean(error) || context.demo || !scope("abcd_assessments.manage")} demo={context.demo} onDirty={abcdDirty} onBusy={abcdBusy} today={today} prefill={profileToTaipeiPrefill(snapshot.profile)} /> : null}</div>
      <div hidden={step !== 4}>{visited.has(4) && snapshot ? <ClientDocumentsWorkspace clientId={snapshot.clientId} canManage={!error && ["clients.manage", "medications.manage", "health.write"].some(scope)} demo={context.demo} today={today} onDirty={documentDirty} onBusy={documentBusy} /> : null}</div>
    </div>
    <p className={styles.footer}>一般建檔、CMS 核對與每週安排使用已核准的 Google 帳號，不另要求驗證器；仍依分支、個案與職務授權。此頁不會自動核准收案、完成評估或建立給藥紀錄。已保存的進度可選取同一個案繼續；未送出的敏感資料不會保存在裝置離線快取。</p>
  </div>;
}
