"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
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
}: {
  currentBranchId: string;
  currentBranchName: string;
  organizationName: string;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchState, setSwitchState] = useState<"idle" | "working" | "reloading" | "uncertain">("idle");
  const switchLock = useRef(false);
  const operationPending = usePendingOperations();
  const viewPending = useViewTransitionPending();
  const viewLease = useRef<(() => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
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
      if (!response.ok) {
        setError("無法讀取分支，請重試。");
        return;
      }
      const body = parseBranchListEnvelope(raw, response.status, currentBranchId);
      if (pendingGuard()) return;
      setBranches(body.data.branches);
      setOpen(true);
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? "讀取分支逾時，請重試。"
        : "無法讀取分支，請檢查網路後重試。");
    } finally {
      setPending(false);
    }
  }

  async function select(branch: Branch) {
    if (readOnly || switchLock.current || pendingGuard()) return;
    if (branch.id === currentBranchId) {
      setOpen(false);
      return;
    }
    if (!window.confirm("切換分支會重新載入系統，未儲存的輸入將不會保留。確定切換分支嗎？")) return;
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
      if (!response.ok) {
        setError("切換未完成核對。為避免在不明分支操作，舊頁面已鎖定；請安全重新載入確認。");
        setSwitchState("uncertain");
        return;
      }
      const raw: unknown = await response.json().catch(() => null);
      parseBranchSwitchEnvelope(raw, response.status, branch);
      setOpen(false);
      setSwitchState("reloading");
      reloadCurrentStaffRoute();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? "分支切換逾時，結果未知；舊頁面保持鎖定，請安全重新載入確認目前分支。"
        : "分支回覆無法完成核對；舊頁面保持鎖定，請安全重新載入確認目前分支。");
      setSwitchState("uncertain");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="branch-switcher">
      <button aria-expanded={open} className="branch-switcher__button" disabled={pending || readOnly || switchState !== "idle" || operationPending || viewPending} onClick={toggle} type="button">
        <span><small>{organizationName}・目前分支</small><strong>{pending ? "讀取中…" : currentBranchName}</strong></span>
        <ChevronsUpDown aria-hidden="true" />
      </button>
      {readOnly ? <small>固定合成分支 · 不切換真實機構</small> : null}
      {!readOnly && operationPending ? <small role="status">有儲存結果尚待確認，暫停切換分支；請先回原表單確認。</small> : !readOnly && viewPending && switchState === "idle" ? <small role="status">系統正在更新，暫停切換分支。</small> : null}
      {open ? <div className="branch-switcher__menu">{branches.map((branch) => <button aria-current={branch.id === currentBranchId ? "true" : undefined} disabled={switchState !== "idle" || operationPending || viewPending} key={branch.id} onClick={() => select(branch)} type="button"><span>{branch.name}</span>{branch.id === currentBranchId ? <Check aria-hidden="true" /> : null}</button>)}</div> : null}
      {error && switchState === "idle" ? <small className="branch-switcher__error" role="alert">{error}</small> : null}
      <dialog ref={dialog} className={styles.guard} aria-labelledby="branch-switch-title" aria-describedby="branch-switch-description" onCancel={(event) => event.preventDefault()}>
        <h2 id="branch-switch-title">{switchState === "uncertain" ? "請先確認目前分支" : "正在安全切換分支"}</h2>
        <p id="branch-switch-description">舊頁面已遮蔽並停止操作；重新載入後，系統會依目前登入與分支權限重新取得資料。</p>
        {switchState === "uncertain" ? <p role="alert">{error}</p> : <p role="status">{switchState === "reloading" ? "已核對切換回條，正在重新載入。若瀏覽器詢問是否離開，請確認後繼續。" : "正在核對分支，請稍候。切換送出後不能取消或繼續使用舊頁面。"}</p>}
        {switchState === "uncertain" || switchState === "reloading" ? <button ref={reloadButton} className="button button--primary" type="button" onClick={reloadCurrentStaffRoute}>安全重新載入系統</button> : null}
      </dialog>
    </div>
  );
}
