"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseBranchListEnvelope,
  parseBranchSwitchEnvelope,
  type BranchClientOption,
} from "@/lib/auth/branch-client";

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState(currentBranchId);
  const [selectedName, setSelectedName] = useState(currentBranchName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (readOnly) return;
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
      const body = parseBranchListEnvelope(raw, response.status, selectedId);
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
    if (readOnly) return;
    if (branch.id === selectedId) {
      setOpen(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/context/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: branch.id }),
      });
      if (!response.ok) {
        setError("分支切換失敗，原分支維持不變。");
        return;
      }
      const raw: unknown = await response.json().catch(() => null);
      parseBranchSwitchEnvelope(raw, response.status, branch);
      setSelectedId(branch.id);
      setSelectedName(branch.name);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? "分支切換逾時，結果未知；請重新載入確認目前分支。"
        : "分支切換失敗，請重新載入確認目前分支。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="branch-switcher">
      <button aria-expanded={open} className="branch-switcher__button" disabled={pending || readOnly} onClick={toggle} type="button">
        <span><small>{organizationName}・目前分支</small><strong>{pending ? "讀取中…" : selectedName}</strong></span>
        <ChevronsUpDown aria-hidden="true" />
      </button>
      {readOnly ? <small>固定合成分支 · 不切換真實機構</small> : null}
      {open ? <div className="branch-switcher__menu">{branches.map((branch) => <button aria-current={branch.id === selectedId ? "true" : undefined} key={branch.id} onClick={() => select(branch)} type="button"><span>{branch.name}</span>{branch.id === selectedId ? <Check aria-hidden="true" /> : null}</button>)}</div> : null}
      {error ? <small className="branch-switcher__error" role="alert">{error}</small> : null}
    </div>
  );
}
