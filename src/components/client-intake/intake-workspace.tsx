"use client";
import { useCallback, useEffect, useId, useRef, useState, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { INTAKE_STEPS, intakeSnapshotSchema, intakeMissingItems, type IntakeSnapshot } from "@/lib/client-intake/model";
import { intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import type { TenantContext } from "@/lib/domain/types";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
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
type PendingLeave = { kind: "history" } | { kind: "link"; href: string; sameOrigin: boolean } | { kind: "client"; id: string };
const anyStep = (steps: Record<number, boolean>) => Object.values(steps).some(Boolean);

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
  const [dirtySteps, setDirtyStepsState] = useState<Record<number, boolean>>({});
  const dirty = anyStep(dirtySteps);
  const historyGuard = useRef<{ token: string; url: string; hadPriorEntry: boolean; collapsing: boolean; collapse: Promise<void> | null } | null>(null);
  const intentionalLeave = useRef(false);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveCancel = useRef<HTMLButtonElement>(null);
  const leaveDiscard = useRef<HTMLButtonElement>(null);
  const leaveTrigger = useRef<HTMLElement | null>(null);
  const clientSelector = useRef<HTMLSelectElement>(null);
  const pendingLeave = useRef<PendingLeave | null>(null);
  const [leaveIntent, setLeaveIntent] = useState<PendingLeave | null>(null);
  const [leaveError, setLeaveError] = useState("");
  const [busySteps, setBusyStepsState] = useState<Record<number, boolean>>({});
  const saving = anyStep(busySteps);
  const [unknownSteps, setUnknownStepsState] = useState<Record<number, boolean>>({});
  const unknown = anyStep(unknownSteps);
  const unknownStep = Object.entries(unknownSteps).find(([, value]) => value)?.[0];
  const leaveProtected = dirty || saving || unknown;
  const dirtyStepsRef = useRef(dirtySteps);
  const busyStepsRef = useRef(busySteps);
  const unknownStepsRef = useRef<Record<number, boolean>>({});
  const registerScopeChange = useScopeChangeDraftRegistration();
  const publishScopeChange = useCallback(() => registerScopeChange({
    dirty: anyStep(dirtyStepsRef.current),
    busy: anyStep(busyStepsRef.current),
    unknown: anyStep(unknownStepsRef.current),
  }), [registerScopeChange]);
  const setDirtySteps = useCallback((value: SetStateAction<Record<number, boolean>>) => {
    const next = typeof value === "function" ? value(dirtyStepsRef.current) : value;
    dirtyStepsRef.current = next;
    setDirtyStepsState(next);
    publishScopeChange();
  }, [publishScopeChange]);
  const setBusySteps = useCallback((value: SetStateAction<Record<number, boolean>>) => {
    const next = typeof value === "function" ? value(busyStepsRef.current) : value;
    busyStepsRef.current = next;
    setBusyStepsState(next);
    publishScopeChange();
  }, [publishScopeChange]);
  const setUnknownStep = useCallback((step: number, value: boolean) => {
    unknownStepsRef.current = { ...unknownStepsRef.current, [step]: value };
    setUnknownStepsState(unknownStepsRef.current);
    publishScopeChange();
  }, [publishScopeChange]);
  const loadSequence = useRef(0);
  const scope = (permission: string) => context.demo || context.scopes.includes(permission);
  const canManage = !error && scope("clients.read") && scope("clients.demographics.read") && scope("clients.manage");
  const canCreate = canManage && scope("clients.view_all");
  const importDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 0: value })), [setDirtySteps]);
  const profileDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 1: value })), [setDirtySteps]);
  const weeklyDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 2: value })), [setDirtySteps]);
  const abcdDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 3: value })), [setDirtySteps]);
  const documentDirty = useCallback((value: boolean) => setDirtySteps((s) => ({ ...s, 4: value })), [setDirtySteps]);
  const importBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 0: value })), [setBusySteps]);
  const profileBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 1: value })), [setBusySteps]);
  const weeklyBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 2: value })), [setBusySteps]);
  const abcdBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 3: value })), [setBusySteps]);
  const documentBusy = useCallback((value: boolean) => setBusySteps((s) => ({ ...s, 4: value })), [setBusySteps]);
  const profileUnknown = useCallback((value: boolean) => setUnknownStep(1, value), [setUnknownStep]);
  const importUnknown = useCallback((value: boolean) => setUnknownStep(0, value), [setUnknownStep]);
  const weeklyUnknown = useCallback((value: boolean) => setUnknownStep(2, value), [setUnknownStep]);
  const abcdUnknown = useCallback((value: boolean) => setUnknownStep(3, value), [setUnknownStep]);
  const documentUnknown = useCallback((value: boolean) => setUnknownStep(4, value), [setUnknownStep]);
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
  const restoreLeaveFocus = useCallback((trigger: HTMLElement | null) => {
    const usableTrigger = trigger?.isConnected && trigger.tabIndex >= 0 && !leaveDialog.current?.contains(trigger);
    const target = usableTrigger ? trigger : clientSelector.current;
    target?.focus();
  }, []);
  const requestLeave = useCallback((intent: PendingLeave, trigger: HTMLElement | null) => {
    if (anyStep(unknownStepsRef.current) || anyStep(busyStepsRef.current) || loading) {
      setLeaveError(anyStep(unknownStepsRef.current)
        ? "剛才的儲存結果尚未確認，請在原表單重試或核對；目前不能離開或更換個案。"
        : "資料仍在儲存或讀取中，請等待完成後再離開或更換個案。");
      restoreLeaveFocus(trigger);
      return;
    }
    if (pendingLeave.current) return;
    leaveTrigger.current = trigger;
    try {
      if (!leaveDialog.current?.showModal) throw new Error("dialog unavailable");
      leaveDialog.current.showModal();
      pendingLeave.current = intent;
      setLeaveIntent(intent);
      setLeaveError("");
      leaveCancel.current?.focus();
    } catch {
      // If a browser cannot lock the page with a modal, keep the draft here.
      pendingLeave.current = null;
      setLeaveError("此瀏覽器無法安全確認離頁。請先儲存資料，再離開或更換個案。");
      restoreLeaveFocus(trigger);
    }
  }, [loading, restoreLeaveFocus]);
  useEffect(() => {
    const interceptHistory = (event: PopStateEvent) => {
      const guard = historyGuard.current;
      if (!guard || guard.collapsing || event.state?.[historyGuardKey] === guard.token || window.location.href !== guard.url) return;
      if (!leaveProtected) { historyGuard.current = null; return; }
      // Back has already reached the same-URL entry. Restore the sentinel
      // synchronously so a second Back cannot bypass an open confirmation.
      window.history.pushState({ ...copyHistoryState(), [historyGuardKey]: guard.token }, "", guard.url);
      requestLeave({ kind: "history" }, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    };
    window.addEventListener("popstate", interceptHistory);
    return () => window.removeEventListener("popstate", interceptHistory);
  }, [leaveProtected, requestLeave]);
  useEffect(() => {
    if (!leaveProtected) { void collapseHistoryGuard(); return; }
    if (historyGuard.current) return;
    intentionalLeave.current = false;
    const token = crypto.randomUUID();
    const url = window.location.href;
    const hadPriorEntry = window.history.length > 1;
    window.history.pushState({ ...copyHistoryState(), [historyGuardKey]: token }, "", url);
    historyGuard.current = { token, url, hadPriorEntry, collapsing: false, collapse: null };
  }, [leaveProtected, collapseHistoryGuard]);
  useEffect(() => {
    if (!leaveProtected) return;
    const warn = (e: BeforeUnloadEvent) => { if (saving || unknown || !intentionalLeave.current) { e.preventDefault(); e.returnValue = ""; } };
    const intercept = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.download || anchor.target && anchor.target !== "_self" || !["http:", "https:"].includes(anchor.protocol) || anchor.href === window.location.href || anchor.getAttribute("href")?.startsWith("#")) return;
      e.preventDefault(); e.stopPropagation();
      requestLeave({ kind: "link", href: anchor.href, sameOrigin: anchor.origin === window.location.origin }, anchor);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", intercept, true); };
  }, [leaveProtected, saving, unknown, requestLeave]);
  function closeLeaveDialog() {
    leaveDialog.current?.close();
    // A programmatic close does not reliably dispatch React's onClose in all
    // browsers. Run cancellation cleanup even when no close event arrives.
    leaveDialogClosed();
  }
  function leaveDialogClosed() {
    // A delayed close event from a previous dialog must not clear a newer
    // confirmation that has already been opened.
    if (leaveDialog.current?.open) return;
    const intent = pendingLeave.current;
    pendingLeave.current = null;
    setLeaveIntent(null);
    if (!intent) return;
    if (intent.kind === "client" && clientSelector.current) clientSelector.current.value = selectedId;
    const trigger = leaveTrigger.current;
    leaveTrigger.current = null;
    // Native dialog focus restoration can happen after close(). Wait until it
    // completes, then return focus to the action that opened the confirmation.
    window.setTimeout(() => {
      if (!pendingLeave.current && !leaveDialog.current?.open) restoreLeaveFocus(trigger);
    }, 0);
  }
  async function confirmLeave() {
    const intent = pendingLeave.current;
    if (!intent) return;
    if (anyStep(unknownStepsRef.current) || anyStep(busyStepsRef.current) || loading) {
      setLeaveError(anyStep(unknownStepsRef.current)
        ? "剛才的儲存結果尚未確認，請在原表單重試或核對；輸入尚未放棄。"
        : "資料仍在儲存或讀取中，請等待完成後再試；輸入尚未放棄。");
      closeLeaveDialog();
      return;
    }
    let hadPriorEntry = true;
    if (intent.kind === "history") {
      const guard = historyGuard.current;
      if (!guard || window.location.href !== guard.url || window.history.state?.[historyGuardKey] !== guard.token) {
        setLeaveError("返回位置已變更，請保留輸入並重新操作返回；本次尚未放棄資料。");
        closeLeaveDialog();
        return;
      }
      hadPriorEntry = guard.hadPriorEntry;
    }
    pendingLeave.current = null;
    setLeaveIntent(null);
    if (intent.kind === "client") {
      flushSync(() => { setDirtySteps({}); unknownStepsRef.current = {}; setUnknownStepsState({}); publishScopeChange(); setDraftEpoch((value) => value + 1); });
      await collapseHistoryGuard();
      closeLeaveDialog();
      await commitChoice(intent.id);
      clientSelector.current?.focus();
      return;
    }
    intentionalLeave.current = true;
    historyGuard.current = null;
    const state = copyHistoryState();
    delete state[historyGuardKey];
    window.history.replaceState(state, "", window.location.href);
    flushSync(() => { setDirtySteps({}); unknownStepsRef.current = {}; setUnknownStepsState({}); publishScopeChange(); setDraftEpoch((value) => value + 1); });
    closeLeaveDialog();
    if (intent.kind === "history") {
      if (!hadPriorEntry) router.replace("/app/staff/workspace/case-center");
      else {
        // history.length also counts Forward entries. If this was the first
        // entry, go(-2) does nothing; give traversal a chance to start, then
        // use a safe destination rather than leaving a cleared draft in place.
        const sourceUrl = window.location.href;
        const settled = () => {
          window.clearTimeout(timer);
          window.removeEventListener("popstate", settled);
          window.removeEventListener("pagehide", settled);
        };
        window.addEventListener("popstate", settled);
        window.addEventListener("pagehide", settled);
        const timer = window.setTimeout(() => {
          settled();
          if (window.location.href === sourceUrl) {
            router.replace("/app/staff/workspace/case-center");
          }
        }, 1200);
        window.history.go(-2);
      }
    }
    else if (intent.sameOrigin) {
      const destination = new URL(intent.href);
      router.replace(`${destination.pathname}${destination.search}${destination.hash}`);
    } else window.location.assign(intent.href);
  }
  function goTo(value: number) {
    if (anyStep(busyStepsRef.current)) { setLeaveError("資料仍在儲存中，請稍候再切換步驟。"); return; }
    if (anyStep(unknownStepsRef.current) && !unknownStepsRef.current[value]) { setLeaveError("寫入結果尚未確認；請留在原步驟，以同一次內容重試後再切換。"); return; }
    if (showSteps) stepsToggleRef.current?.focus(); setStep(value); setVisited((v) => new Set([...v, value])); setShowSteps(false);
  }
  async function readClient(clientId: string, fromWrite = false) {
    if (anyStep(unknownStepsRef.current)) {
      setLeaveError("另一步驟的寫入結果尚未確認；請回原表單以同一次操作重試，暫時不能重新讀取或切換個案。");
      return;
    }
    const sequence = ++loadSequence.current;
    setLoading(true); setError(""); setSelectedId(clientId);
    try {
      const result = intakeSnapshotSchema.parse(await intakeRequest(`/api/client-intake?client=${clientId}`));
      if (sequence !== loadSequence.current) return;
      if (result.clientId !== clientId) throw new Error("讀回資料與所選個案不一致，已停止顯示。請重新讀取此個案。");
      if (anyStep(unknownStepsRef.current)) {
        setLeaveError("另一筆寫入結果尚未確認；請保留原表單並核對，暫時不能更換個案。");
        return;
      }
      const preserveGuard = anyStep(dirtyStepsRef.current) || anyStep(busyStepsRef.current);
      if (!preserveGuard) await collapseHistoryGuard();
      if (sequence !== loadSequence.current) return;
      const sameClient = snapshot?.clientId === clientId;
      setSnapshot(result); setManual(false); setStep(1);
      if (sameClient) setVisited((s) => new Set([...s, 1]));
      else { setVisited(new Set([1])); setDirtySteps({}); unknownStepsRef.current = {}; setUnknownStepsState({}); publishScopeChange(); }
      setClients((v) => v.some((c) => c.id === clientId) ? v.map((c) => c.id === clientId ? { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode } : c) : [...v, { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode }]);
      window.history.replaceState(copyHistoryState(), "", `/app/client-intake?client=${clientId}`);
      if (preserveGuard && historyGuard.current) historyGuard.current.url = window.location.href;
    } catch (e) {
      if (sequence === loadSequence.current) { setError(`${fromWrite ? "伺服器已回報儲存成功，但最新資料尚未讀回。請重試讀取，不要另建一位個案。 " : ""}${intakeErrorMessage(e)}`); if (!fromWrite) setSnapshot(null); }
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  async function choose(id: string) {
    if (anyStep(busyStepsRef.current) || anyStep(unknownStepsRef.current) || loading || anyStep(dirtyStepsRef.current)) { requestLeave({ kind: "client", id }, clientSelector.current); return; }
    await commitChoice(id);
  }
  async function commitChoice(id: string) {
    if (!id) { ++loadSequence.current; setSelectedId(""); setSnapshot(null); setManual(preferManualForNew); setVisited(new Set([preferManualForNew ? 1 : 0])); setStep(preferManualForNew ? 1 : 0); setShowSteps(false); setError(""); setDirtySteps({}); unknownStepsRef.current = {}; setUnknownStepsState({}); publishScopeChange(); window.history.replaceState(copyHistoryState(), "", "/app/client-intake"); return; }
    if (context.demo) {
      const client = clients.find((c) => c.id === id)!;
      setSelectedId(id); setSnapshot({ clientId: id, profileVersion: 0, clientRowVersion: 1, pending: true, fieldAuthority: {}, sourceBatchId: null, profile: { displayName: client.displayName, clientCode: client.clientCode, dateOfBirth: null, identityNumber: null, sex: "unknown", phone: null, registeredAddress: null, residentialAddress: null, cmsLevel: null, disability: null, contacts: [], consent: { status: "pending", confirmedOn: null }, notes: "" } }); setVisited(new Set([1])); setStep(1); setDirtySteps({}); unknownStepsRef.current = {}; setUnknownStepsState({}); publishScopeChange(); return;
    }
    await readClient(id);
  }
  const saved = (id: string) => readClient(id, true);
  return <div className={styles.workspace}>
    <header className={`page-heading ${styles.heading}`}><div><p className="eyebrow">收案</p><div className={styles.titleRow}><h1>個案建檔</h1><Link className="button button--secondary" href="/app/staff/workspace/case-center">個案中心</Link></div><p className="page-heading__description">先建立基本資料，再安排服務與文件。</p></div></header>
    <section className={styles.selector}><label>目前處理的個案<select ref={clientSelector} value={selectedId} disabled={loading || saving} onChange={(e) => choose(e.target.value)}><option value="">＋建立新個案</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName} · {client.clientCode}</option>)}</select></label><div><span className={styles.badge}>{snapshot ? snapshot.pending ? "待收案 · 尚未開始服務" : "已建檔 · 依服務狀態執行" : "尚未建檔"}</span><p>{snapshot ? `基本資料待核對 ${intakeMissingItems(snapshot.profile).length} 項` : error ? "個案資料尚未讀取成功，請先重試。" : !canCreateScope ? "此帳號沒有建立新個案的權限；請選擇已授權的既有個案。" : manual ? "先建立基本資料，其餘項目可後續核對。" : "先匯入 CMS，或選擇手動建檔。"}</p></div></section>
    {leaveError ? <p className={styles.error} role="alert">{leaveError}</p> : null}
    {unknown ? <p className={styles.notice} role="status">上次寫入結果尚未確認；請回到原步驟，以同一次內容重試。暫時不能切換其他步驟或個案。</p> : null}
    <dialog aria-describedby={`${stepsId}-leave-description`} aria-labelledby={`${stepsId}-leave-title`} className={`core-dialog ${styles.leaveDialog}`} onCancel={(event) => { event.preventDefault(); closeLeaveDialog(); }} onClose={leaveDialogClosed} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const first = leaveCancel.current;
      const last = leaveDiscard.current;
      if (!first || !last) return;
      const outside = !leaveDialog.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    }} ref={leaveDialog} role="alertdialog">
      <div className="core-dialog__surface">
        <header className="drawer__header"><h2 id={`${stepsId}-leave-title`}>{leaveIntent?.kind === "client" ? "放棄輸入並更換個案？" : "放棄未儲存的收案資料？"}</h2></header>
        <div className="drawer__body core-dialog__body" id={`${stepsId}-leave-description`}><p>{leaveIntent?.kind === "client" ? "更換個案會清除這位個案尚未儲存的輸入。" : "離開此頁會清除尚未儲存的輸入；已保存的資料不受影響。"}</p></div>
        <footer className="drawer__footer"><button autoFocus className="button button--secondary" onClick={closeLeaveDialog} ref={leaveCancel} type="button">繼續填寫</button><button className="button button--danger" onClick={() => void confirmLeave()} ref={leaveDiscard} type="button">{leaveIntent?.kind === "client" ? "放棄並更換個案" : "放棄輸入並離開"}</button></footer>
      </div>
    </dialog>
    {context.demo ? <p className={styles.notice}>目前為本機合成資料試看，不會保存或上傳任何真實個案。</p> : null}
    {snapshot ? <AdmissionHandoff snapshot={snapshot} canRead={scope("clients.read")} blocked={dirty || saving || unknown || loading || Boolean(error)} /> : null}
    {!snapshot && manual && !context.demo ? <p className={styles.notice} role="status">目前可先手動建立待收案個案；CMS 匯入需由具權限人員在服務就緒後核對。</p> : null}
    <nav aria-label="收案流程"><button ref={stepsToggleRef} className={styles.stepsToggle} type="button" aria-expanded={showSteps} aria-controls={stepsId} onClick={() => setShowSteps((value) => !value)}>第 {step + 1}／{INTAKE_STEPS.length} 步：{INTAKE_STEPS[step]} <span aria-hidden="true">⌄</span></button><ol id={stepsId} className={styles.steps} data-open={showSteps}>{INTAKE_STEPS.map((title, index) => <li key={title}><button type="button" aria-current={step === index ? "step" : undefined} disabled={loading || saving || unknown && unknownStep !== String(index) || index > 0 && !snapshot && !(index === 1 && manual)} onClick={() => goTo(index)}><b>{index + 1}</b><span>{title}</span></button></li>)}</ol></nav>
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{selectedId ? <button type="button" disabled={loading || saving || unknown || dirty} onClick={() => { if (!anyStep(unknownStepsRef.current) && !anyStep(busyStepsRef.current) && !anyStep(dirtyStepsRef.current)) void readClient(selectedId); }}>重試讀取此個案</button> : <button type="button" disabled={leaveProtected} onClick={() => { if (!anyStep(unknownStepsRef.current) && !anyStep(busyStepsRef.current) && !anyStep(dirtyStepsRef.current)) window.location.reload(); }}>重新載入個案清單</button>}</div> : null}
    {loading ? <p role="status">正在讀取所選個案，請稍候…</p> : null}<div className={styles.panel} inert={loading || unknown && !unknownSteps[step]} key={`${snapshot?.clientId ?? "new"}-${draftEpoch}`}>
      <div hidden={step !== 0}>{visited.has(0) ? <CmsIntakeStep current={snapshot} canImport={scope("imports.manage") && canCreate} canApprove={scope("imports.approve") && (snapshot ? canManage : canCreate)} canManual={snapshot ? canManage : canCreate} canCreateNew={canCreateScope} hasImportPermission={scope("imports.manage")} loadBlocked={Boolean(error)} demo={context.demo} archiveConfigured={archiveConfigured} onSaved={saved} onDirty={importDirty} onBusy={importBusy} onUnknown={importUnknown} profileHasDraft={Boolean(dirtySteps[1])} onManual={() => { if (anyStep(unknownStepsRef.current) || anyStep(busyStepsRef.current)) return; setManual(true); goTo(1); }} /> : null}</div>
      <div hidden={step !== 1}>{visited.has(1) ? <IntakeProfileForm key={snapshot?.profileVersion ?? 0} initial={snapshot} canManage={snapshot ? canManage : canCreate} demo={context.demo} today={today} onSaved={saved} onDirty={profileDirty} onBusy={profileBusy} onUnknown={profileUnknown} /> : null}</div>
      <div hidden={step !== 2}>{visited.has(2) && snapshot ? <ClientWeeklyWorkspace clientId={snapshot.clientId} canManage={!error && scope("staff_scheduling.manage")} demo={context.demo} today={today} onDirty={weeklyDirty} onBusy={weeklyBusy} onUnknown={weeklyUnknown} /> : null}</div>
      <div hidden={step !== 3}>{visited.has(3) && snapshot ? <TaipeiAbcdIntakeStep clientId={snapshot.clientId} organizationId={context.organizationId} branchId={context.branchId!} usageYear={115} readOnly={Boolean(error) || context.demo || !scope("abcd_assessments.manage")} demo={context.demo} onDirty={abcdDirty} onBusy={abcdBusy} onUnknown={abcdUnknown} today={today} prefill={profileToTaipeiPrefill(snapshot.profile)} /> : null}</div>
      <div hidden={step !== 4}>{visited.has(4) && snapshot ? <ClientDocumentsWorkspace clientId={snapshot.clientId} canManage={!error && ["clients.manage", "medications.manage", "health.write"].some(scope)} demo={context.demo} today={today} onDirty={documentDirty} onBusy={documentBusy} onUnknown={documentUnknown} /> : null}</div>
    </div>
    <details className={styles.footer}><summary>資料與權限說明</summary><p>一般建檔、CMS 核對與每週安排使用已核准的 Google 帳號，不另要求驗證器；仍依分支、個案與職務授權。此頁不會自動核准收案、完成評估或建立給藥紀錄。已保存的進度可選取同一個案繼續；未送出的敏感資料不會保存在裝置離線快取。</p></details>
  </div>;
}
