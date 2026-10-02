"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
const historyGuardKey = "__daycareIntakeUnsavedGuard";
const unsavedMessage = "尚有未儲存的收案資料。確定離開並放棄這些輸入嗎？";

function copyHistoryState() {
  const state = window.history.state;
  return state && typeof state === "object" ? { ...state as Record<string, unknown> } : {};
}

export function IntakeWorkspace({ context, clients: initialClients, initialSnapshot, loadError, today, initialStep = 1, archiveConfigured = false }: {
  context: TenantContext; clients: ClientChoice[]; initialSnapshot: IntakeSnapshot | null; loadError: boolean; today: string; initialStep?: number; archiveConfigured?: boolean;
}) {
  const router = useRouter();
  const canCreateScope = context.demo || ["clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"].every((permission) => context.scopes.includes(permission));
  const canCreateAtEntry = !loadError && canCreateScope;
  const cmsAvailableAtEntry = !context.demo && canCreateAtEntry && archiveConfigured && ["imports.manage", "imports.approve"].every((permission) => context.scopes.includes(permission));
  const preferManualForNew = canCreateAtEntry && !cmsAvailableAtEntry;
  const startManual = !initialSnapshot && preferManualForNew;
  const [clients, setClients] = useState(initialClients);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedId, setSelectedId] = useState(initialSnapshot?.clientId ?? "");
  const [step, setStep] = useState(initialSnapshot ? initialStep : startManual ? 1 : 0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([initialSnapshot ? initialStep : startManual ? 1 : 0]));
  const [manual, setManual] = useState(startManual);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [showSteps, setShowSteps] = useState(false);
  const stepsToggleRef = useRef<HTMLButtonElement>(null);
  const stepsId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(loadError ? "個案清單或基本資料暫時無法載入，請重新整理後再試。沒有改用其他分支資料。" : "");
  const [dirtySteps, setDirtySteps] = useState<Record<number, boolean>>({});
  const dirty = Object.values(dirtySteps).some(Boolean);
  const historyGuard = useRef<{ token: string; url: string; collapsing: boolean; collapse: Promise<void> | null } | null>(null);
  const intentionalLeave = useRef(false);
  const [busySteps, setBusySteps] = useState<Record<number, boolean>>({});
  const saving = Object.values(busySteps).some(Boolean);
  const loadSequence = useRef(0);
  const scope = (permission: string) => context.demo || context.scopes.includes(permission);
  const canManage = !error && scope("clients.read") && scope("clients.demographics.read") && scope("clients.manage");
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
  const collapseHistoryGuard = useCallback(() => {
    const guard = historyGuard.current;
    if (!guard) return Promise.resolve();
    if (guard.collapse) return guard.collapse;
    if (window.history.state?.[historyGuardKey] !== guard.token) { historyGuard.current = null; return Promise.resolve(); }
    guard.collapsing = true;
    guard.collapse = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => { if (historyGuard.current === guard) historyGuard.current = null; resolve(); }, { once: true });
      window.history.back();
    });
    return guard.collapse;
  }, []);
  useEffect(() => {
    const interceptHistory = (event: PopStateEvent) => {
      const guard = historyGuard.current;
      if (!guard || guard.collapsing || event.state?.[historyGuardKey] === guard.token || window.location.href !== guard.url) return;
      if (!dirty) { historyGuard.current = null; return; }
      if (!window.confirm(unsavedMessage)) {
        window.history.pushState({ ...copyHistoryState(), [historyGuardKey]: guard.token }, "", guard.url);
        return;
      }
      historyGuard.current = null;
      flushSync(() => { setDirtySteps({}); setDraftEpoch((value) => value + 1); });
      window.history.back();
    };
    window.addEventListener("popstate", interceptHistory);
    return () => window.removeEventListener("popstate", interceptHistory);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) { void collapseHistoryGuard(); return; }
    if (historyGuard.current) return;
    intentionalLeave.current = false;
    const token = crypto.randomUUID();
    const url = window.location.href;
    window.history.pushState({ ...copyHistoryState(), [historyGuardKey]: token }, "", url);
    historyGuard.current = { token, url, collapsing: false, collapse: null };
  }, [dirty, collapseHistoryGuard]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { if (!intentionalLeave.current) e.preventDefault(); };
    const intercept = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.download || anchor.target && anchor.target !== "_self" || !["http:", "https:"].includes(anchor.protocol) || anchor.href === window.location.href || anchor.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(unsavedMessage)) { e.preventDefault(); e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
      intentionalLeave.current = true;
      historyGuard.current = null;
      const state = copyHistoryState();
      delete state[historyGuardKey];
      window.history.replaceState(state, "", window.location.href);
      flushSync(() => { setDirtySteps({}); setDraftEpoch((value) => value + 1); });
      if (anchor.origin === window.location.origin) router.replace(`${anchor.pathname}${anchor.search}${anchor.hash}`);
      else window.location.assign(anchor.href);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", intercept, true); };
  }, [dirty, router]);
  function goTo(value: number) { if (showSteps) stepsToggleRef.current?.focus(); setStep(value); setVisited((v) => new Set([...v, value])); setShowSteps(false); }
  async function readClient(clientId: string, fromWrite = false) {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(""); setSelectedId(clientId);
    try {
      const result = intakeSnapshotSchema.parse(await intakeRequest(`/api/client-intake?client=${clientId}`));
      if (sequence !== loadSequence.current) return;
      if (result.clientId !== clientId) throw new Error("讀回資料與所選個案不一致，已停止顯示。請重新讀取此個案。");
      await collapseHistoryGuard();
      if (sequence !== loadSequence.current) return;
      const sameClient = snapshot?.clientId === clientId;
      setSnapshot(result); setManual(false); setStep(1);
      if (sameClient) setVisited((s) => new Set([...s, 1]));
      else { setVisited(new Set([1])); setDirtySteps({}); }
      setClients((v) => v.some((c) => c.id === clientId) ? v.map((c) => c.id === clientId ? { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode } : c) : [...v, { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode }]);
      window.history.replaceState(copyHistoryState(), "", `/app/client-intake?client=${clientId}`);
    } catch (e) {
      if (sequence === loadSequence.current) { setError(`${fromWrite ? "伺服器已回報儲存成功，但最新資料尚未讀回。請重試讀取，不要另建一位個案。 " : ""}${intakeErrorMessage(e)}`); if (!fromWrite) setSnapshot(null); }
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  async function choose(id: string) {
    if (saving || loading) return;
    if (dirty && !window.confirm("尚有未儲存的資料。確定放棄並切換個案嗎？")) return;
    if (dirty) { flushSync(() => { setDirtySteps({}); setDraftEpoch((value) => value + 1); }); await collapseHistoryGuard(); }
    if (!id) { ++loadSequence.current; setSelectedId(""); setSnapshot(null); setManual(preferManualForNew); setVisited(new Set([preferManualForNew ? 1 : 0])); setStep(preferManualForNew ? 1 : 0); setShowSteps(false); setError(""); setDirtySteps({}); window.history.replaceState(copyHistoryState(), "", "/app/client-intake"); return; }
    if (context.demo) {
      const client = clients.find((c) => c.id === id)!;
      setSelectedId(id); setSnapshot({ clientId: id, profileVersion: 0, clientRowVersion: 1, pending: true, fieldAuthority: {}, sourceBatchId: null, profile: { displayName: client.displayName, clientCode: client.clientCode, dateOfBirth: null, identityNumber: null, sex: "unknown", phone: null, registeredAddress: null, residentialAddress: null, cmsLevel: null, disability: null, contacts: [], consent: { status: "pending", confirmedOn: null }, notes: "" } }); setVisited(new Set([1])); setStep(1); setDirtySteps({}); return;
    }
    await readClient(id);
  }
  const saved = (id: string) => readClient(id, true);
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>收案</p><div className={styles.titleRow}><h1>個案建檔</h1><Link className="button button--secondary" href="/app/staff/workspace/case-center">個案中心</Link></div><p>先建立基本資料，再安排服務與文件。</p></div></header>
    <section className={styles.selector}><label>目前處理的個案<select value={selectedId} disabled={loading || saving} onChange={(e) => choose(e.target.value)}><option value="">＋建立新個案</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName} · {client.clientCode}</option>)}</select></label><div><span className={styles.badge}>{snapshot ? snapshot.pending ? "待收案 · 尚未開始服務" : "已建檔 · 依服務狀態執行" : "尚未建檔"}</span><p>{snapshot ? `基本資料待核對 ${intakeMissingItems(snapshot.profile).length} 項` : error ? "個案資料尚未讀取成功，請先重試。" : !canCreateScope ? "此帳號沒有建立新個案的權限；請選擇已授權的既有個案。" : manual ? "先建立基本資料，其餘項目可後續核對。" : "先匯入 CMS，或選擇手動建檔。"}</p></div></section>
    {context.demo ? <p className={styles.notice}>目前為本機合成資料試看，不會保存或上傳任何真實個案。</p> : null}
    {snapshot ? <AdmissionHandoff snapshot={snapshot} canRead={scope("clients.read")} blocked={dirty || saving || loading || Boolean(error)} /> : null}
    {!snapshot && manual && !context.demo ? <p className={styles.notice} role="status">目前可先手動建立待收案個案；CMS 匯入需由具權限人員在服務就緒後核對。</p> : null}
    <nav aria-label="收案流程"><button ref={stepsToggleRef} className={styles.stepsToggle} type="button" aria-expanded={showSteps} aria-controls={stepsId} onClick={() => setShowSteps((value) => !value)}>第 {step + 1}／{INTAKE_STEPS.length} 步：{INTAKE_STEPS[step]} <span aria-hidden="true">⌄</span></button><ol id={stepsId} className={styles.steps} data-open={showSteps}>{INTAKE_STEPS.map((title, index) => <li key={title}><button type="button" aria-current={step === index ? "step" : undefined} disabled={loading || saving || index > 0 && !snapshot && !(index === 1 && manual)} onClick={() => goTo(index)}><b>{index + 1}</b><span>{title}</span></button></li>)}</ol></nav>
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{selectedId ? <button type="button" disabled={loading} onClick={() => readClient(selectedId)}>重試讀取此個案</button> : <button type="button" onClick={() => window.location.reload()}>重新載入個案清單</button>}</div> : null}
    {loading ? <p role="status">正在讀取所選個案，請稍候…</p> : null}<div className={styles.panel} inert={loading} key={`${snapshot?.clientId ?? "new"}-${draftEpoch}`}>
      <div hidden={step !== 0}>{visited.has(0) ? <CmsIntakeStep current={snapshot} canImport={scope("imports.manage") && canCreate} canApprove={scope("imports.approve") && (snapshot ? canManage : canCreate)} canManual={snapshot ? canManage : canCreate} canCreateNew={canCreateScope} hasImportPermission={scope("imports.manage")} loadBlocked={Boolean(error)} demo={context.demo} archiveConfigured={archiveConfigured} onSaved={saved} onDirty={importDirty} onBusy={importBusy} profileHasDraft={Boolean(dirtySteps[1])} onManual={() => { setManual(true); goTo(1); }} /> : null}</div>
      <div hidden={step !== 1}>{visited.has(1) ? <IntakeProfileForm key={snapshot?.profileVersion ?? 0} initial={snapshot} canManage={snapshot ? canManage : canCreate} demo={context.demo} today={today} onSaved={saved} onDirty={profileDirty} onBusy={profileBusy} /> : null}</div>
      <div hidden={step !== 2}>{visited.has(2) && snapshot ? <ClientWeeklyWorkspace clientId={snapshot.clientId} canManage={!error && scope("staff_scheduling.manage")} demo={context.demo} today={today} onDirty={weeklyDirty} onBusy={weeklyBusy} /> : null}</div>
      <div hidden={step !== 3}>{visited.has(3) && snapshot ? <TaipeiAbcdIntakeStep clientId={snapshot.clientId} organizationId={context.organizationId} branchId={context.branchId!} usageYear={115} readOnly={Boolean(error) || context.demo || !scope("abcd_assessments.manage")} demo={context.demo} onDirty={abcdDirty} onBusy={abcdBusy} today={today} prefill={profileToTaipeiPrefill(snapshot.profile)} /> : null}</div>
      <div hidden={step !== 4}>{visited.has(4) && snapshot ? <ClientDocumentsWorkspace clientId={snapshot.clientId} canManage={!error && ["clients.manage", "medications.manage", "health.write"].some(scope)} demo={context.demo} today={today} onDirty={documentDirty} onBusy={documentBusy} /> : null}</div>
    </div>
    <details className={styles.footer}><summary>資料與權限說明</summary><p>一般建檔、CMS 核對與每週安排使用已核准的 Google 帳號，不另要求驗證器；仍依分支、個案與職務授權。此頁不會自動核准收案、完成評估或建立給藥紀錄。已保存的進度可選取同一個案繼續；未送出的敏感資料不會保存在裝置離線快取。</p></details>
  </div>;
}
