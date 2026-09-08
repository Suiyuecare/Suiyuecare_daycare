"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleOff, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseSocialResourceActionError,
  parseSocialResourceActionSuccess,
} from "@/lib/social-resources/parser";
import type {
  SocialResourceInformationState,
  SocialResourceItem,
  SocialResourceValidityState,
} from "@/lib/social-resources/types";

import styles from "./social-resources.module.css";

export type SocialResourceActionKind = "create" | "edit" | "confirm" | "deactivate";

const labels: Record<SocialResourceActionKind, string> = {
  create: "新增資源",
  edit: "編輯資源",
  confirm: "更新確認日",
  deactivate: "停用資源",
};

function icon(kind: SocialResourceActionKind) {
  if (kind === "create") return <Plus aria-hidden="true" />;
  if (kind === "edit") return <Pencil aria-hidden="true" />;
  if (kind === "confirm") return <CheckCircle2 aria-hidden="true" />;
  return <CircleOff aria-hidden="true" />;
}

function stateLabel(value: SocialResourceInformationState) {
  if (value === "provided") return "已提供";
  if (value === "not_applicable") return "不適用";
  return "缺值";
}

export function SocialResourceAction({
  kind,
  instance,
  resource,
  canManage,
  demo,
  defaultYear,
}: {
  kind: SocialResourceActionKind;
  instance: string;
  resource?: SocialResourceItem;
  canManage: boolean;
  demo: boolean;
  defaultYear: number;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audienceState, setAudienceState] = useState<SocialResourceInformationState>(
    resource?.audienceState ?? "missing",
  );
  const [eligibilityState, setEligibilityState] = useState<SocialResourceInformationState>(
    resource?.eligibilityState ?? "missing",
  );
  const [contactState, setContactState] = useState<SocialResourceInformationState>(
    resource?.contactState ?? "missing",
  );
  const [validityState, setValidityState] = useState<SocialResourceValidityState>(
    resource?.validityState ?? "missing",
  );
  const enabled =
    !demo && canManage && !pending && (kind === "create" || resource?.status === "active");
  const label = labels[kind];
  const dialogId = `social-resource-${kind}-${instance}-${resource?.id ?? "new"}`;
  const descriptionId = `${dialogId}-description`;
  const disabledReason = demo
    ? "展示模式不會寫入資料"
    : !canManage
      ? "目前角色沒有 social_resources.manage"
      : resource?.status === "inactive"
        ? "已停用資源不可再修改"
        : undefined;

  function resetStates() {
    setAudienceState(resource?.audienceState ?? "missing");
    setEligibilityState(resource?.eligibilityState ?? "missing");
    setContactState(resource?.contactState ?? "missing");
    setValidityState(resource?.validityState ?? "missing");
  }

  function open() {
    if (!enabled) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    setCompleted(false);
    resetStates();
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function changed() {
    if (!error) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first || !event.currentTarget.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed || (kind !== "create" && !resource)) return;
    idempotencyKey.current ??= crypto.randomUUID();
    const values = new FormData(event.currentTarget);
    const action = kind === "edit" ? "update" : kind;
    let body: Record<string, unknown>;
    if (kind === "create" || kind === "edit") {
      const audience = String(values.get("audienceDetail") ?? "").trim();
      const eligibility = String(values.get("eligibilityDetail") ?? "").trim();
      const contact = String(values.get("contactDetail") ?? "").trim();
      const validFrom = String(values.get("validFrom") ?? "");
      const validUntil = String(values.get("validUntil") ?? "");
      body = {
        action,
        ...(resource
          ? { resourceId: resource.id, expectedRowVersion: resource.rowVersion }
          : {}),
        referenceYear: Number(values.get("referenceYear")),
        name: String(values.get("name") ?? ""),
        resourceType: String(values.get("resourceType") ?? ""),
        audienceState,
        audienceDetail: audienceState === "provided" ? audience : null,
        eligibilityState,
        eligibilityDetail: eligibilityState === "provided" ? eligibility : null,
        contactState,
        contactDetail: contactState === "provided" ? contact : null,
        validityState,
        validFrom:
          validityState === "date_range" || validityState === "open_ended"
            ? validFrom || null
            : null,
        validUntil: validityState === "date_range" ? validUntil || null : null,
      };
    } else if (kind === "confirm") {
      body = {
        action,
        resourceId: resource!.id,
        expectedRowVersion: resource!.rowVersion,
      };
    } else {
      body = {
        action,
        resourceId: resource!.id,
        expectedRowVersion: resource!.rowVersion,
        reason: String(values.get("reason") ?? ""),
      };
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/social-resources", {
        method: kind === "create" ? "POST" : "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(body),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parseSocialResourceActionError(raw);
        setError(
          envelope?.errors.find((item) => item.message.trim())?.message ??
            "操作尚未確認完成；請保留內容並以相同操作重試。",
        );
        return;
      }
      let success;
      try {
        success = parseSocialResourceActionSuccess(raw, {
          action,
          ...(resource
            ? {
                resourceId: resource.id,
                expectedRowVersion: resource.rowVersion,
              }
            : {}),
        });
      } catch {
        setError("伺服器回覆不完整；請勿更改內容，直接以相同操作重試。");
        return;
      }
      if (
        (kind === "create" && response.status !== (success.data.replayed ? 200 : 201)) ||
        (kind !== "create" && response.status !== 200)
      ) {
        setError("伺服器狀態與完成憑證不一致；請勿視為完成，並以相同操作重試。");
        return;
      }
      setCompleted(true);
      setNotice(
        success.data.replayed
          ? "已確認先前相同操作，沒有建立重複紀錄。"
          : kind === "create"
            ? "資源已建立。"
            : kind === "edit"
              ? "資源已更新為新版本。"
              : kind === "confirm"
                ? "最後確認日已使用伺服器台北日期更新。"
                : "資源已停用，歷史與理由均已保留。",
      );
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路狀態不明；請勿關閉或修改內容，直接按原按鈕重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionSlot}>
      <button
        aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
        className={`button ${kind === "create" || kind === "confirm" ? "button--primary" : "button--secondary"} ${styles.actionButton}`}
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        {icon(kind)}{label}
      </button>
      {notice ? <span className="sr-only" role="status">{notice}</span> : null}
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={dialogId}
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={keepFocusInside}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">社會資源管理</p>
              <h2 id={dialogId}>{label}</h2>
              <p id={descriptionId}>
                {kind === "confirm"
                  ? "確認代表您已於今天人工核對資源內容；系統不推論外部資格。"
                  : kind === "deactivate"
                    ? "停用後資料與歷次稽核保留，不能直接刪除。"
                    : "請逐欄標示已提供、不適用或缺值；空白不會自動當作不適用。"}
              </p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>

          <div className="drawer__body">
            {kind === "create" || kind === "edit" ? (
              <div className={styles.fields}>
                <label className="field"><span>年度 *</span><input defaultValue={resource?.referenceYear ?? defaultYear} max={2200} min={2000} name="referenceYear" required type="number" /></label>
                <label className="field"><span>資源類型 *</span><input defaultValue={resource?.resourceType ?? ""} maxLength={80} name="resourceType" required /></label>
                <label className={`field ${styles.wideField}`}><span>資源名稱 *</span><input defaultValue={resource?.name ?? ""} maxLength={160} name="name" required /></label>
                <InformationField detailDefault={resource?.audienceDetail ?? ""} detailLabel="適用對象內容" detailMax={500} name="audience" onState={setAudienceState} state={audienceState} />
                <InformationField detailDefault={resource?.eligibilityDetail ?? ""} detailLabel="資格內容" detailMax={2000} name="eligibility" onState={setEligibilityState} state={eligibilityState} textarea />
                <InformationField detailDefault={resource?.contactDetail ?? ""} detailLabel="聯絡方式" detailMax={1000} name="contact" onState={setContactState} state={contactState} textarea />
                <label className="field"><span>有效期限狀態 *</span><select name="validityState" onChange={(event) => setValidityState(event.target.value as SocialResourceValidityState)} value={validityState}>{[
                  ["date_range", "有起訖／截止日"],
                  ["open_ended", "開放期限"],
                  ["not_applicable", "不適用"],
                  ["missing", "缺值"],
                ].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                <label className="field"><span>開始日{validityState === "open_ended" ? " *" : ""}</span><input defaultValue={resource?.validFrom ?? ""} disabled={!(["date_range", "open_ended"] as const).includes(validityState as "date_range" | "open_ended")} name="validFrom" required={validityState === "open_ended"} type="date" /></label>
                <label className="field"><span>截止日{validityState === "date_range" ? " *" : ""}</span><input defaultValue={resource?.validUntil ?? ""} disabled={validityState !== "date_range"} name="validUntil" required={validityState === "date_range"} type="date" /></label>
                <label className={`check-field ${styles.wideField}`}><input required type="checkbox" /><span>我已逐欄確認資料來源；系統不會把缺值當作不適用，也不會自動判定外部資格。</span></label>
              </div>
            ) : kind === "confirm" ? (
              <div className={styles.confirmBody}>
                <strong>{resource?.name}</strong>
                <p>目前最後確認日：{resource?.lastConfirmedOn ?? "尚未確認"}</p>
                <label className="check-field"><input required type="checkbox" /><span>我已人工核對聯絡方式、資格、適用對象及有效期限；以今天台北日期更新確認日。</span></label>
              </div>
            ) : (
              <div className={styles.confirmBody}>
                <strong>{resource?.name}</strong>
                <label className="field"><span>停用理由 *</span><textarea maxLength={500} name="reason" required /></label>
                <label className="check-field"><input required type="checkbox" /><span>我了解停用後此版本不可再修改，且歷史資料不會刪除。</span></label>
              </div>
            )}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "確認中…" : label}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

function InformationField({
  name,
  detailLabel,
  detailDefault,
  detailMax,
  state,
  onState,
  textarea = false,
}: {
  name: "audience" | "eligibility" | "contact";
  detailLabel: string;
  detailDefault: string;
  detailMax: number;
  state: SocialResourceInformationState;
  onState: (state: SocialResourceInformationState) => void;
  textarea?: boolean;
}) {
  const inputName = `${name}Detail`;
  return (
    <div className={styles.informationField}>
      <label className="field"><span>{detailLabel}狀態 *</span><select name={`${name}State`} onChange={(event) => onState(event.target.value as SocialResourceInformationState)} value={state}>{[
        "provided",
        "not_applicable",
        "missing",
      ].map((value) => <option key={value} value={value}>{stateLabel(value as SocialResourceInformationState)}</option>)}</select></label>
      <label className="field"><span>{detailLabel}{state === "provided" ? " *" : ""}</span>{textarea
        ? <textarea defaultValue={detailDefault} disabled={state !== "provided"} maxLength={detailMax} name={inputName} required={state === "provided"} />
        : <input defaultValue={detailDefault} disabled={state !== "provided"} maxLength={detailMax} name={inputName} required={state === "provided"} />}</label>
    </div>
  );
}

export function SocialResourceFreshness({ staleAfter, demo }: { staleAfter: string; demo: boolean }) {
  const [expiredBoundary, setExpiredBoundary] = useState<string | null>(null);
  useEffect(() => {
    if (demo) return;
    const remaining = new Date(staleAfter).getTime() - Date.now();
    const timer = window.setTimeout(
      () => setExpiredBoundary(staleAfter),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [demo, staleAfter]);
  const stale = !demo && expiredBoundary === staleAfter;
  if (demo) return <span>合成展示快照</span>;
  return stale
    ? <span className={styles.stale} role="status">資料已過期，請重新載入</span>
    : <span>資料為目前快照</span>;
}
