"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ClipboardList, FileCheck2, FileUp, Bus, UserRound } from "lucide-react";
import { INTAKE_STEPS, intakeSnapshotSchema, intakeMissingItems, type IntakeSnapshot } from "@/lib/client-intake/model";
import { intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import type { TenantContext } from "@/lib/domain/types";
import { profileToTaipeiPrefill } from "@/lib/taipei-abcd/prefill";
import { ClientSelectionCard } from "@/components/clients/client-selection-card";
import { hasCmsUploadOperation, useCmsUploadState } from "@/lib/imports/upload-pending";
import { getIntakeWriteOperation, getIntakeWriteState, hasIntakeWriteOperation, intakeWriteAuthority, isIntakeWriteAuthorityCurrent, matchesIntakeWriteReadback, useIntakeWriteState } from "@/lib/client-intake/write-pending";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { CmsIntakeStep } from "./cms-intake-step";
import { IntakeProfileForm } from "./intake-profile-form";
import { AdmissionHandoff } from "./admission-handoff";
import styles from "./intake.module.css";

const ClientWeeklyWorkspace = dynamic(() => import("@/components/client-weekly/client-weekly-workspace").then((m) => m.ClientWeeklyWorkspace), { loading: () => <p role="status">載入每週安排…</p> });
const TaipeiAbcdIntakeStep = dynamic(() => import("@/components/taipei-abcd/taipei-abcd-intake-step").then((m) => m.TaipeiAbcdIntakeStep), { loading: () => <p role="status">載入 A／B／C 表…</p> });
const ClientDocumentsWorkspace = dynamic(() => import("@/components/client-documents/client-documents-workspace").then((m) => m.ClientDocumentsWorkspace), { loading: () => <p role="status">載入應備文件…</p> });

type ClientChoice = { id: string; displayName: string; clientCode: string };
const stepIcons = [FileUp, UserRound, Bus, ClipboardList, FileCheck2];
const stepDescriptions = [
  "上傳 CMS 原檔並逐欄核對，或手動建檔。",
  "補齊身分、聯絡與告知同意資料，再儲存。",
  "確認每週到站、交通與接送安排。",
  "填寫並核對 A／B／C 表；建檔不會自動完成評估。",
  "補齊應備文件，逐份確認安全檢查與覆核狀態。",
];
export function IntakeWorkspace({ context, clients: initialClients, initialSnapshot, loadError, today, initialStep = 1, archiveConfigured = false }: {
  context: TenantContext; clients: ClientChoice[]; initialSnapshot: IntakeSnapshot | null; loadError: boolean; today: string; initialStep?: number; archiveConfigured?: boolean;
}) {
  const [clients, setClients] = useState(initialClients);
  useCmsUploadState();
  const writeState = useIntakeWriteState();
  const profilePending = getIntakeWriteOperation(context, "profile", initialSnapshot?.clientId ?? null);
  const uploadPending = hasCmsUploadOperation() || hasIntakeWriteOperation();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedId, setSelectedId] = useState(initialSnapshot?.clientId ?? "");
  const firstStep = profilePending ? 1 : initialSnapshot ? initialStep : 0;
  const [step, setStep] = useState(firstStep);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([firstStep]));
  const [manual, setManual] = useState(Boolean(profilePending));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(loadError ? "個案清單或基本資料暫時無法載入，請重新整理後再試。沒有改用其他分支資料。" : "");
  const [dirtySteps, setDirtySteps] = useState<Record<number, boolean>>({});
  const dirty = Object.values(dirtySteps).some(Boolean);
  const [busySteps, setBusySteps] = useState<Record<number, boolean>>({});
  const saving = Object.values(busySteps).some(Boolean);
  const loadSequence = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const workPanel = useRef<HTMLDivElement>(null);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const currentAuthority = intakeWriteAuthority(context);
  const owner = useRef({ authority: currentAuthority, epoch: writeState.epoch });
  const cancelRead = useCallback(() => { loadSequence.current++; readController.current?.abort(); }, []);
  useLayoutEffect(() => {
    owner.current = { authority: currentAuthority, epoch: writeState.epoch };
    return cancelRead;
  }, [cancelRead, currentAuthority, writeState.epoch]);
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
  const unsaved = useUnsavedChanges({ dirty, scopeKey: JSON.stringify([currentAuthority, writeState.epoch]),
    revisionKey: JSON.stringify([snapshot?.clientId, snapshot?.profileVersion, snapshot?.clientRowVersion]),
    canPrompt: !saving && !loading && !uploadPending, permittedFormAttribute: "data-intake-write",
    onDiscard: () => { setDirtySteps({}); setDraftEpoch(value => value + 1); } });
  function goTo(value: number) {
    if (hasCmsUploadOperation() || hasIntakeWriteOperation()) return;
    setStep(value);
    setVisited((v) => new Set([...v, value]));
    workPanel.current?.scrollIntoView?.({ block: "start" });
  }
  async function readClient(clientId: string, fromWrite = false) {
    if (!fromWrite && hasIntakeWriteOperation()) return;
    const sequence = ++loadSequence.current;
    const authority = currentAuthority, epoch = writeState.epoch;
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    setLoading(true); setError(""); if (!fromWrite) setSelectedId(clientId);
    try {
      const result = intakeSnapshotSchema.parse(await intakeRequest(`/api/client-intake?client=${clientId}`, { signal: controller.signal }));
      if (sequence !== loadSequence.current || owner.current.authority !== authority || owner.current.epoch !== epoch ||
        !isIntakeWriteAuthorityCurrent(context) || getIntakeWriteState().epoch !== epoch) throw new Error("INTAKE_READ_CANCELLED");
      if (result.clientId !== clientId) throw new Error("讀回資料與所選個案不一致，已停止顯示。請重新讀取此個案。");
      const original = getIntakeWriteState().operation;
      if (fromWrite && original && !matchesIntakeWriteReadback(original, result)) throw new Error("INTAKE_ORIGINAL_READBACK_UNCONFIRMED");
      const sameClient = snapshot?.clientId === clientId;
      setSelectedId(clientId); setSnapshot(result); setManual(false); setStep(1);
      if (sameClient) setVisited((s) => new Set([...s, 1]));
      else { setVisited(new Set([1])); setDirtySteps({}); }
      setClients((v) => v.some((c) => c.id === clientId) ? v.map((c) => c.id === clientId ? { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode } : c) : [...v, { id: clientId, displayName: result.profile.displayName, clientCode: result.profile.clientCode }]);
      window.history.replaceState(null, "", `/app/client-intake?client=${clientId}`);
      return result;
    } catch (e) {
      if (sequence === loadSequence.current) { setError(`${fromWrite ? "伺服器已回報儲存成功，但最新資料尚未讀回。請重試讀取，不要另建一位個案。 " : ""}${intakeErrorMessage(e)}`); if (!fromWrite) setSnapshot(null); }
      if (fromWrite) throw e;
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  async function chooseConfirmed(id: string) {
    if (saving || loading || hasCmsUploadOperation() || hasIntakeWriteOperation()) return;
    if (!id) { ++loadSequence.current; setSelectedId(""); setSnapshot(null); setManual(false); setVisited(new Set([0])); setStep(0); setError(""); setDirtySteps({}); window.history.replaceState(null, "", "/app/client-intake"); return; }
    if (context.demo) {
      const client = clients.find((c) => c.id === id)!;
      setSelectedId(id); setSnapshot({ clientId: id, profileVersion: 0, clientRowVersion: 1, pending: true, fieldAuthority: {}, sourceBatchId: null, profile: { displayName: client.displayName, clientCode: client.clientCode, dateOfBirth: null, identityNumber: null, sex: "unknown", phone: null, registeredAddress: null, residentialAddress: null, cmsLevel: null, disability: null, contacts: [], consent: { status: "pending", confirmedOn: null }, notes: "" } }); setVisited(new Set([1])); setStep(1); setDirtySteps({}); return;
    }
    await readClient(id);
  }
  function choose(id: string) {
    if (saving || loading || hasCmsUploadOperation() || hasIntakeWriteOperation()) return;
    unsaved.requestExit(() => { void chooseConfirmed(id); });
  }
  const saved = (id: string) => readClient(id, true);
  const missingItems = snapshot ? intakeMissingItems(snapshot.profile) : [];
  function stepStatus(index: number) {
    if (step === index) return "目前步驟";
    if (index === 0 && snapshot?.sourceBatchId) return "已有 CMS 來源";
    if (index === 1 && snapshot) return missingItems.length ? `待核對 ${missingItems.length} 項` : "基本欄位已提供";
    if (!snapshot && index > 0 && !(index === 1 && manual)) return "先建立個案";
    return "待查看";
  }
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>收案</p><h1>個案建檔</h1><p>選好個案，依步驟補齊收案資料。</p></div><Link className="button button--secondary" href="/app/staff/workspace/case-center">個案中心</Link></header>
    <ClientSelectionCard
      id="intake-client"
      label="個案"
      placeholder="＋建立新個案"
      value={selectedId}
      disabled={loading || saving || uploadPending}
      onValueChange={choose}
      options={clients.map((client) => ({ value: client.id, label: `${client.displayName} · ${client.clientCode}` }))}
      supplement={<>
        <span className={styles.badge}>{snapshot ? snapshot.pending ? "待收案 · 尚未開始服務" : "已建檔 · 依服務狀態執行" : "尚未建檔"}</span>
        <span className={styles.selectorDetail}>{snapshot ? missingItems.length ? `已保存基本資料 · 待核對 ${missingItems.length} 項` : "基本欄位已提供 · 評估與文件另行核對" : "先匯入 CMS，或選擇手動建檔。"}</span>
      </>}
    />
    {context.demo ? <p className={styles.notice}>目前為本機合成資料試看，不會保存或上傳任何真實個案。</p> : null}
    <nav aria-label="收案流程" className={styles.stepNav}><ol className={styles.steps}>{INTAKE_STEPS.map((title, index) => {
      const Icon = stepIcons[index];
      return <li key={title}><button type="button" aria-current={step === index ? "step" : undefined} disabled={loading || saving || uploadPending || index > 0 && !snapshot && !(index === 1 && manual)} onClick={() => goTo(index)}>
        <span className={styles.stepNumber}>{index + 1}</span><span className={styles.stepText}><span>{title}</span><small>{stepStatus(index)}</small></span><Icon className={styles.stepIcon} size={18} aria-hidden="true" />
      </button></li>;
    })}</ol></nav>
    <section className={styles.stageSummary} aria-label="目前收案工作">
      <p className={styles.stageLead}><strong className={styles.eyebrow}>第 {step + 1} 步／共 {INTAKE_STEPS.length} 步</strong><span>{stepDescriptions[step]}</span></p>
      {snapshot && step !== 1 ? <div className={styles.savedMissing}>
        <h3>已保存基本資料{missingItems.length ? ` · 待核對 ${missingItems.length} 項` : " · 基本欄位已提供"}</h3>
        {missingItems.length ? <ul className={styles.missingItems}>{missingItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p>評估、文件與正式收案仍需另行確認。</p>}
        <button type="button" disabled={loading || saving || uploadPending} onClick={() => goTo(1)}>核對基本資料</button>
      </div> : null}
    </section>
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{selectedId ? <button type="button" disabled={loading || uploadPending} onClick={() => readClient(selectedId)}>重試讀取此個案</button> : <button type="button" disabled={loading || uploadPending} onClick={() => window.location.reload()}>重新載入個案清單</button>}</div> : null}
    {loading ? <p role="status">正在讀取所選個案，請稍候…</p> : null}<div className={styles.panel} inert={loading} key={`${snapshot?.clientId ?? "new"}:${draftEpoch}`} ref={workPanel}>
      <div hidden={step !== 0}>{visited.has(0) ? <CmsIntakeStep context={context} current={snapshot} canImport={scope("imports.manage") && canCreate} canApprove={scope("imports.approve") && (snapshot ? canManage : canCreate)} demo={context.demo} archiveConfigured={archiveConfigured} onSaved={saved} onDirty={importDirty} onBusy={importBusy} profileHasDraft={Boolean(dirtySteps[1])} onManual={() => { setManual(true); goTo(1); }} /> : null}</div>
      <div hidden={step !== 1}>{visited.has(1) ? <IntakeProfileForm key={snapshot?.profileVersion ?? 0} context={context} initial={snapshot} canManage={snapshot ? canManage : canCreate} demo={context.demo} today={today} onSaved={saved} onDirty={profileDirty} onBusy={profileBusy} /> : null}</div>
      <div hidden={step !== 2}>{visited.has(2) && snapshot ? <ClientWeeklyWorkspace clientId={snapshot.clientId} canManage={!error && scope("staff_scheduling.manage")} demo={context.demo} today={today} onDirty={weeklyDirty} onBusy={weeklyBusy} /> : null}</div>
      <div hidden={step !== 3}>{visited.has(3) && snapshot ? <TaipeiAbcdIntakeStep clientId={snapshot.clientId} organizationId={context.organizationId} branchId={context.branchId!} usageYear={115} readOnly={Boolean(error) || context.demo || !scope("abcd_assessments.manage")} demo={context.demo} onDirty={abcdDirty} onBusy={abcdBusy} today={today} prefill={profileToTaipeiPrefill(snapshot.profile)} /> : null}</div>
      <div hidden={step !== 4}>{visited.has(4) && snapshot ? <ClientDocumentsWorkspace clientId={snapshot.clientId} canManage={!error && ["clients.manage", "medications.manage", "health.write"].some(scope)} demo={context.demo} today={today} onDirty={documentDirty} onBusy={documentBusy} /> : null}</div>
    </div>
    {snapshot ? <AdmissionHandoff snapshot={snapshot} canRead={scope("clients.read")} blocked={dirty || saving || loading || uploadPending || Boolean(error)} /> : null}
    <p className={styles.footer}>建檔不代表正式收案；評估、文件與服務狀態仍需各自確認。</p>
    <details className={styles.supportingDetails}><summary>帳號、保存與收案說明</summary><p>一般建檔、CMS 核對與每週安排使用已核准的 Google 帳號，不另要求驗證器；仍依分支、個案與職務授權。此頁不會自動核准收案、完成評估或建立給藥紀錄。已保存的進度可選取同一個案繼續；未送出的敏感資料不會保存在裝置離線快取。</p></details>
    {unsaved.notice ? <p role="status">{unsaved.notice}</p> : null}
    {unsaved.open ? <GovernanceDialog open title="捨棄未保存的收案資料" cancelLabel="繼續填寫" onRequestClose={unsaved.cancel} returnFocusRef={unsaved.returnFocusRef}>
      <p>只有尚未送出的修改會被捨棄。已送出且結果未知的原操作不能在此放棄。</p>
      <button type="button" className="button button--danger" onClick={unsaved.confirmDiscard}
        onCompositionStart={unsaved.compositionStart} onCompositionEnd={unsaved.compositionEnd}>捨棄填寫並繼續</button>
    </GovernanceDialog> : null}
  </div>;
}
