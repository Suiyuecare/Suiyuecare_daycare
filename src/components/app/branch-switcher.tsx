"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { requestUnsavedExit } from "@/lib/navigation/unsaved-changes";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import {
  parseBranchListEnvelope,
  parseBranchSwitchEnvelope,
  type BranchClientOption,
} from "@/lib/auth/branch-client";
import { reloadCurrentStaffRoute } from "./branch-navigation";
import styles from "./branch-switcher.module.css";

type Branch = BranchClientOption;

export function BranchSwitcher({
  currentBranchId,
  currentBranchName,
  organizationName,
  readOnly = false,
  compact = false,
}: {
  currentBranchId: string;
  currentBranchName: string;
  organizationName: string;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchState, setSwitchState] = useState<"idle" | "working" | "reloading" | "uncertain">("idle");
  const [confirmation, setConfirmation] = useState<Branch | null>(null);
  const approvedSwitch = useRef<Branch | null>(null);
  const dialogId = useId();
  const dialogTitleId = `${dialogId}-branch-switch-title`;
  const dialogDescriptionId = `${dialogId}-branch-switch-description`;
  const switchLock = useRef(false);
  const operationPending = usePendingOperations();
  const viewPending = useViewTransitionPending();
  const viewLease = useRef<(() => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => { if (switchState === "uncertain" || switchState === "reloading") reloadButton.current?.focus(); }, [switchState]);
  useEffect(() => () => { viewLease.current?.(); viewLease.current = null; }, []);

  function pendingGuard() {
    if (!hasPendingOperations() && !hasViewTransition()) return false;
    setError(hasPendingOperations() ? "有儲存結果尚待確認，請先回原表單確認；目前不能切換分支。" : "工作清單正在更新，請完成後再切換分支。");
    return true;
  }

  async function toggle() {
    if (readOnly || switchLock.current || pendingGuard()) return;
    if (open) {
      setOpen(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/context/branch", { cache: "no-store" });
      const raw: unknown = await response.json().catch(() => null);
      if (!active.current) return;
      if (!response.ok) {
        setError("無法讀取分支，請重試。");
        return;
      }
      const body = parseBranchListEnvelope(raw, response.status, currentBranchId);
      if (pendingGuard()) return;
      setBranches(body.data.branches);
      setOpen(true);
    } catch (caught) {
      if (!active.current) return;
      setError(isClientFetchTimeoutError(caught)
        ? "讀取分支逾時，請重試。"
        : "無法讀取分支，請檢查網路後重試。");
    } finally {
      if (active.current) setPending(false);
    }
  }

  function select(branch: Branch) {
    if (readOnly || switchLock.current || pendingGuard()) return;
    if (branch.id === currentBranchId) {
      setOpen(false);
      return;
    }
    if (requestUnsavedExit(() => select(branch))) return;
    setConfirmation(branch);
  }

  async function performSwitch(branch: Branch) {
    if (!active.current || readOnly || switchLock.current || pendingGuard() ||
        branch.id === currentBranchId || !branches.some((option) => option.id === branch.id && option.name === branch.name)) return;
    // Another editor can become dirty while confirmation is open (for example
    // through a late asynchronous update). Recheck at the actual cookie boundary.
    if (requestUnsavedExit(() => { void performSwitch(branch); }, () => active.current && !switchLock.current)) return;
    // A write may have started while confirmation was open. Acquire again at
    // the actual scope-change boundary, before changing any cookie or view.
    const release = tryAcquireViewTransition();
    if (!release) { pendingGuard(); return; }
    viewLease.current = release;
    // showModal synchronously makes every background control inert before POST
    // can change the branch cookie. Do not proceed on browsers without this guard.
    try { dialog.current!.showModal(); } catch { release(); viewLease.current = null; setError("此瀏覽器無法安全鎖定切換畫面，請重新載入或更新瀏覽器後再試；尚未送出切換。"); return; }
    switchLock.current = true; setSwitchState("working");
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/context/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: branch.id }),
      });
      if (!active.current) return;
      if (!response.ok) {
        setError("切換未完成核對。為避免在不明分支操作，舊頁面已鎖定；請安全重新載入確認。");
        setSwitchState("uncertain");
        return;
      }
      const raw: unknown = await response.json().catch(() => null);
      if (!active.current) return;
      parseBranchSwitchEnvelope(raw, response.status, branch);
      setOpen(false);
      setSwitchState("reloading");
      reloadCurrentStaffRoute();
    } catch (caught) {
      if (!active.current) return;
      setError(isClientFetchTimeoutError(caught)
        ? "分支切換逾時，結果未知；舊頁面保持鎖定，請安全重新載入確認目前分支。"
        : "分支回覆無法完成核對；舊頁面保持鎖定，請安全重新載入確認目前分支。");
      setSwitchState("uncertain");
    } finally {
      if (active.current) setPending(false);
    }
  }

  const executeApprovedSwitch = useEffectEvent((branch: Branch) => { void performSwitch(branch); });
  // Close the cancellable modal before opening the non-cancellable scope guard.
  // The effect event rechecks live props and locks, not the old render's values.
  useEffect(() => {
    if (confirmation || !approvedSwitch.current) return;
    const branch = approvedSwitch.current;
    approvedSwitch.current = null;
    executeApprovedSwitch(branch);
  }, [confirmation]);

  return (
    <div className={`branch-switcher${compact ? " branch-switcher--compact" : ""}`}>
      <button aria-label={`${organizationName}，目前分支：${currentBranchName}`} aria-expanded={open} className="branch-switcher__button" disabled={pending || readOnly || switchState !== "idle" || operationPending || viewPending} onClick={toggle} type="button">
        <span>
          <small>機構全銜</small>
          <strong className="branch-switcher__organization-name">{pending ? "讀取中…" : organizationName}</strong>
          <small className="branch-switcher__current-branch">目前分支：{currentBranchName}</small>
        </span>
        <ChevronsUpDown aria-hidden="true" />
      </button>
      {readOnly ? <small>固定合成分支 · 不切換真實機構</small> : null}
      {!readOnly && operationPending ? <small role="status">有儲存結果尚待確認，暫停切換分支；請先回原表單確認。</small> : !readOnly && viewPending && switchState === "idle" ? <small role="status">系統正在更新，暫停切換分支。</small> : null}
      {open ? <div className="branch-switcher__menu">{branches.map((branch) => <button aria-current={branch.id === currentBranchId ? "true" : undefined} disabled={switchState !== "idle" || operationPending || viewPending} key={branch.id} onClick={() => select(branch)} type="button"><span>{branch.name}</span>{branch.id === currentBranchId ? <Check aria-hidden="true" /> : null}</button>)}</div> : null}
      {error && switchState === "idle" ? <small className="branch-switcher__error" role="alert">{error}</small> : null}
      <GovernanceDialog open={confirmation !== null} title="確認切換分支" onRequestClose={() => setConfirmation(null)}>
        {confirmation ? <>
          <p>將切換至「{confirmation.name}」，並重新載入資料。</p>
          <p>尚未儲存的輸入不會保留。確認後，舊頁面會停止操作，直到重新核對登入與分支權限。</p>
          <div className="drawer__actions">
            <button className="button button--primary" type="button" onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); }
            }} onClick={() => {
              if (!active.current) return;
              approvedSwitch.current = confirmation; setConfirmation(null);
            }}>切換分支</button>
          </div>
        </> : null}
      </GovernanceDialog>
      <dialog ref={dialog} className={styles.guard} aria-labelledby={dialogTitleId} aria-describedby={dialogDescriptionId} onCancel={(event) => event.preventDefault()}>
        <h2 id={dialogTitleId}>{switchState === "uncertain" ? "請先確認目前分支" : "正在安全切換分支"}</h2>
        <p id={dialogDescriptionId}>舊頁面已遮蔽並停止操作；重新載入後，系統會依目前登入與分支權限重新取得資料。</p>
        {switchState === "uncertain" ? <p role="alert">{error}</p> : <p role="status">{switchState === "reloading" ? "已核對切換回條，正在重新載入。若瀏覽器詢問是否離開，請確認後繼續。" : "正在核對分支，請稍候。切換送出後不能取消或繼續使用舊頁面。"}</p>}
        {switchState === "uncertain" || switchState === "reloading" ? <button ref={reloadButton} className="button button--primary" type="button" onClick={reloadCurrentStaffRoute}>安全重新載入系統</button> : null}
      </dialog>
    </div>
  );
}
