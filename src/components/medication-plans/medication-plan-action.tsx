"use client";

import { useRef, useState } from "react";
import { CircleX, Plus, Send, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseMedicationPlanActionError,
  parseMedicationPlanActionSuccess,
  type MedicationPlanActionExpectation,
} from "@/lib/medication-plans/parser";
import type {
  MedicationPlanClientOption,
  MedicationPlanRecord,
} from "@/lib/medication-plans/types";

import styles from "./medication-plans.module.css";

export type MedicationPlanActionKind =
  | "create"
  | "revise"
  | "submit"
  | "approve"
  | "stop";

const labels: Record<MedicationPlanActionKind, string> = {
  create: "新增計畫",
  revise: "建立新版",
  submit: "送出核准",
  approve: "獨立核准",
  stop: "停藥",
};

const endpoints: Record<MedicationPlanActionKind, string> = {
  create: "/api/medication-plans/drafts",
  revise: "/api/medication-plans/drafts",
  submit: "/api/medication-plans/submit",
  approve: "/api/medication-plans/approve",
  stop: "/api/medication-plans/stop",
};

function taipeiLocal(value: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) {
    throw new Error("INVALID_LOCAL_DATETIME");
  }
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("INVALID_LOCAL_DATETIME");
  const roundTrip = new Date(parsed.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 16);
  if (roundTrip !== value) throw new Error("INVALID_LOCAL_DATETIME");
  return parsed.toISOString();
}

function apiMessage(
  envelope: ReturnType<typeof parseMedicationPlanActionError>,
  fallback: string,
) {
  return envelope?.errors.find((error) => error.message.trim())?.message || fallback;
}

function actionIcon(kind: MedicationPlanActionKind) {
  if (kind === "create" || kind === "revise") return <Plus aria-hidden="true" />;
  if (kind === "submit") return <Send aria-hidden="true" />;
  if (kind === "approve") return <ShieldCheck aria-hidden="true" />;
  return <CircleX aria-hidden="true" />;
}

export function MedicationPlanAction({
  kind,
  instance,
  client,
  plan,
  canManage,
  hasRecentAal2,
  demo,
  generatedAt,
  eligible = true,
}: {
  kind: MedicationPlanActionKind;
  instance: string;
  client: MedicationPlanClientOption;
  plan?: MedicationPlanRecord;
  canManage: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
  generatedAt: string;
  eligible?: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const drafts = kind === "create" || kind === "revise";
  const highRiskAction = kind === "approve" || kind === "stop";
  const enabled =
    !demo &&
    canManage &&
    eligible &&
    (!drafts || client.canCreatePlan) &&
    (!highRiskAction || hasRecentAal2) &&
    !pending;
  const label = labels[kind];
  const dialogId = `medication-plan-${kind}-${instance}-${plan?.id ?? "new"}`;
  const descriptionId = `${dialogId}-description`;
  const proposedStart = taipeiLocal(
    new Date(new Date(generatedAt).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
  );
  const defaultStart = drafts ? proposedStart : plan ? taipeiLocal(plan.effectiveFrom) : proposedStart;
  const defaultEnd =
    drafts && plan?.effectiveTo && plan.effectiveTo > taipeiLocalToIso(proposedStart)
      ? taipeiLocal(plan.effectiveTo)
      : "";
  const disabledReason = demo
    ? "展示模式不寫入任何資料"
    : !canManage
      ? "目前角色沒有 medications.manage"
      : !eligible
        ? "這個版本目前不能執行此操作"
        : drafts && !client.canCreatePlan
          ? "個案必須為已收案、服務中且尚未結案"
          : highRiskAction && !hasRecentAal2
            ? "請先完成最近 15 分鐘內的雙因素重新驗證"
            : undefined;

  function open() {
    if (!enabled) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    setCompleted(false);
    form.current?.reset();
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function changed() {
    if (!error) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNeedsReauth(false);
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !event.currentTarget.contains(document.activeElement))
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
    if (pending || completed || (!drafts && !plan)) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    const values = new FormData(event.currentTarget);
    let body: Record<string, unknown>;
    let expectation: MedicationPlanActionExpectation;
    try {
      if (drafts) {
        const times = String(values.get("schedule_times") ?? "")
          .split(/[\s,，、;；]+/u)
          .map((time) => time.trim())
          .filter(Boolean);
        const effectiveTo = String(values.get("effective_to") ?? "");
        body = {
          client_id: client.id,
          previous_plan_id: kind === "revise" ? plan?.id ?? null : null,
          medication_name: String(values.get("medication_name") ?? ""),
          dose: Number(values.get("dose")),
          dose_unit: String(values.get("dose_unit") ?? ""),
          route: String(values.get("route") ?? ""),
          schedule_times: times,
          high_risk: values.get("high_risk") === "on",
          effective_from: taipeiLocalToIso(
            String(values.get("effective_from") ?? ""),
          ),
          effective_to: effectiveTo ? taipeiLocalToIso(effectiveTo) : null,
        };
        expectation = {
          kind,
          clientId: client.id,
          ...(kind === "revise" ? { plan: plan! } : {}),
          requestedEffectiveFrom: String(body.effective_from),
        } as MedicationPlanActionExpectation;
      } else if (kind === "stop") {
        body = {
          medication_plan_id: plan!.id,
          expected_row_version: plan!.rowVersion,
          reason: String(values.get("reason") ?? ""),
        };
        expectation = { kind, clientId: client.id, plan: plan! };
      } else {
        body = {
          medication_plan_id: plan!.id,
          expected_row_version: plan!.rowVersion,
        };
        expectation = { kind, clientId: client.id, plan: plan! };
      }
    } catch {
      setError("請填寫有效的台北日期時間。");
      setPending(false);
      return;
    }

    try {
      const response = await fetchWithTimeout(endpoints[kind], {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(body),
      });
      const rawEnvelope: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorEnvelope = parseMedicationPlanActionError(rawEnvelope);
        if (errorEnvelope?.errors.some((item) => item.code === "AAL2_REQUIRED")) {
          setNeedsReauth(true);
        }
        setError(
          apiMessage(
            errorEnvelope,
            "操作尚未確認完成；請保留此視窗並以相同操作重試。",
          ),
        );
        return;
      }
      let success;
      try {
        success = parseMedicationPlanActionSuccess(rawEnvelope, expectation);
      } catch {
        setError("伺服器回覆不完整；請勿改動內容，直接以相同操作重試。");
        return;
      }
      setCompleted(true);
      setNotice(
        success.data.replayed
          ? "已確認先前相同操作，沒有建立重複版本。"
          : kind === "create" || kind === "revise"
            ? `第 ${success.data.version} 版草稿已建立。`
            : kind === "submit"
              ? "計畫已凍結送審，須由另一位具權限人員核准。"
              : kind === "approve"
                ? "計畫已由伺服器時間核准；未來生效版本不會提前啟用。"
                : "停藥事件已以伺服器時間簽署，既有歷史未被改寫。",
      );
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
        className={`button ${kind === "approve" ? "button--primary" : "button--secondary"} ${styles.actionButton}`}
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        {actionIcon(kind)}
        {label}
      </button>
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
        <form
          className="core-dialog__surface"
          onChange={changed}
          onSubmit={submit}
          ref={form}
        >
          <header className="drawer__header">
            <div>
              <p className="eyebrow">版本化用藥治理</p>
              <h2 id={dialogId}>{label}</h2>
              <p id={descriptionId}>
                {client.displayName}・{plan ? `${plan.medicationName} 第 ${plan.version} 版` : "全新計畫"}
              </p>
            </div>
            <button
              aria-label="關閉"
              className="icon-button"
              disabled={pending}
              onClick={close}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}>
            <div className={`callout ${styles.securityCallout}`}>
              <ShieldCheck aria-hidden="true" />
              <span>
                {drafts
                  ? "機構、分支、版本、藥物與排程識別鍵、來源、建立人及雜湊都由伺服器決定；修改只會建立新版本。"
                  : kind === "submit"
                    ? "送審會凍結這個精確資料版本；送審人不能核准自己的計畫。"
                    : kind === "approve"
                      ? "核准需最近 15 分鐘 AAL2 與第二位獨立人員；未來生效時間不會因核准而提前。"
                      : "停藥需最近 15 分鐘 AAL2、精確資料版本與原因；時間、簽署證據及雜湊由伺服器產生。"}
              </span>
            </div>

            {drafts ? (
              <fieldset className={styles.formGrid} disabled={completed}>
                <label className={`field ${styles.wideField}`}>
                  <span>藥物名稱</span>
                  <input defaultValue={plan?.medicationName ?? ""} maxLength={200} name="medication_name" required />
                </label>
                <label className="field">
                  <span>劑量</span>
                  <input defaultValue={plan?.dose ?? ""} max="100000" min="0.0001" name="dose" required step="0.0001" type="number" />
                </label>
                <label className="field">
                  <span>單位</span>
                  <input defaultValue={plan?.doseUnit ?? ""} maxLength={32} name="dose_unit" required />
                </label>
                <label className="field">
                  <span>途徑</span>
                  <input defaultValue={plan?.route ?? ""} maxLength={80} name="route" required />
                </label>
                <label className="field">
                  <span>每日時點</span>
                  <input defaultValue={plan?.schedule.times.join(", ") ?? "08:00"} name="schedule_times" placeholder="08:00, 20:00" required />
                </label>
                <label className="field">
                  <span>生效時間（台北）</span>
                  <input defaultValue={defaultStart} name="effective_from" required type="datetime-local" />
                  {kind === "revise" ? <small>新版核准後會依此未來時間切換，不會提前取代目前計畫。</small> : null}
                </label>
                <label className="field">
                  <span>結束時間（台北，可留空）</span>
                  <input defaultValue={defaultEnd} name="effective_to" type="datetime-local" />
                </label>
                <label className={`check-field ${styles.wideField}`}>
                  <input defaultChecked={plan?.highRisk ?? false} name="high_risk" type="checkbox" />
                  <span>標記為機構指定高風險用藥（本頁不提供診斷）</span>
                </label>
              </fieldset>
            ) : (
              <dl className={styles.dialogSummary}>
                <div><dt>目前版本</dt><dd>第 {plan?.version} 版・資料 v{plan?.rowVersion}</dd></div>
                <div><dt>風險標記</dt><dd>{plan?.highRisk ? "高風險" : "一般"}</dd></div>
                <div><dt>每日時點</dt><dd>{plan?.schedule.times.join("、")}</dd></div>
                <div><dt>生效時間</dt><dd>{plan ? taipeiLocal(plan.effectiveFrom).replace("T", " ") : "—"}</dd></div>
                {kind === "stop" ? (
                  <div className={styles.summaryWide}>
                    <dt>停藥原因</dt>
                    <dd><textarea aria-label="停藥原因" maxLength={1000} name="reason" required rows={4} /></dd>
                  </div>
                ) : null}
              </dl>
            )}

            <label className="check-field">
              <input disabled={completed} required type="checkbox" />
              <span>
                {drafts
                  ? "我已核對藥物、劑量、時點及生效期間，了解儲存後仍為草稿。"
                  : kind === "approve"
                    ? "我已獨立核對完整內容，確認自己不是送審人，並同意核准不可改寫版本。"
                    : kind === "stop"
                      ? "我確認停藥原因及目前資料版本，了解成功後只會新增不可變停藥事件。"
                      : "我已核對完整內容，並同意凍結此版本送交另一人核准。"}
              </span>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {needsReauth ? <Link className={styles.reauthLink} href="/mfa?audience=staff&purpose=sensitive-action">立即重新驗證</Link> : null}
            {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">
              {completed ? "關閉" : "取消"}
            </button>
            <button className="button button--primary" disabled={pending || completed} type="submit">
              {pending ? "確認中…" : completed ? "已完成" : label}
            </button>
          </footer>
        </form>
      </dialog>
      {!enabled && highRiskAction && !demo && canManage && !hasRecentAal2 ? (
        <Link className={styles.reauthLink} href="/mfa?audience=staff&purpose=sensitive-action">重新驗證</Link>
      ) : null}
    </div>
  );
}
