"use client";

import { Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  useRef,
  useState,
} from "react";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  parseIndividualPlanApiEnvelope,
  parseIndividualPlanInput,
  parseIndividualPlanResponseContext,
} from "@/lib/integrations/individual-service-plans";
import type {
  IndividualPlanClient,
  IndividualPlanItemInput,
  IndividualPlanResponsible,
} from "@/lib/individual-service-plans/types";

import styles from "./individual-service-plans.module.css";

type Draft = {
  clientId: string;
  correctionReason: string;
  items: readonly IndividualPlanItemInput[];
};

const progressLabels = {
  not_started: "尚未開始",
  in_progress: "進行中",
  completed: "已完成",
} as const;

function emptyItem(responsibleUserId: string): IndividualPlanItemInput {
  return {
    goal: "",
    activity: "",
    frequency: "",
    responsibleUserId,
    progressStatus: "not_started",
    progressNote: null,
  };
}

function draftFor(client: IndividualPlanClient | undefined, responsibleId: string): Draft {
  return {
    clientId: client?.clientId ?? "",
    correctionReason: "",
    items: client?.latestPlan?.items.map((item) => ({
      goal: item.goal,
      activity: item.activity,
      frequency: item.frequency,
      responsibleUserId: item.responsibleUserId,
      progressStatus: item.progressStatus,
      progressNote: item.progressNote,
    })) ?? [emptyItem(responsibleId)],
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function responseError(value: unknown, fallback: string) {
  const context = parseIndividualPlanResponseContext(value);
  const message = context?.message ?? fallback;
  return context ? `${message}（請求識別碼：${context.requestId}）` : message;
}

export function IndividualPlanComposer({
  clients,
  responsibles,
  planMonth,
  canWrite,
  hasRecentAal2,
  demo,
}: {
  clients: readonly IndividualPlanClient[];
  responsibles: readonly IndividualPlanResponsible[];
  planMonth: string;
  canWrite: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const eligible = clients.filter((client) => client.canPlanMonth);
  const [draft, setDraft] = useState<Draft>(() => draftFor(eligible[0], responsibles[0]?.userId ?? ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = clients.find((client) => client.clientId === draft.clientId);
  const disabledReason = demo
    ? "展示模式唯讀，不會送出或假裝成功"
    : !canWrite
      ? "需要 care_plans.write 與 care_plans.sign 權限"
      : !hasRecentAal2
        ? "需要最近 15 分鐘 AAL2 重新驗證"
        : !eligible.length || !responsibles.length
          ? "目前沒有可建立計畫的個案或負責人"
          : null;

  function changed(next: Draft) {
    idempotencyKey.current = crypto.randomUUID();
    setDraft(next);
    setError(null);
  }

  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    idempotencyKey.current = crypto.randomUUID();
    setDraft(draftFor(eligible[0], responsibles[0]?.userId ?? ""));
    setError(null);
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function trapFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
    )).filter((element) => !element.hasAttribute("disabled"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function updateItem(index: number, patch: Partial<IndividualPlanItemInput>) {
    changed({
      ...draft,
      items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const requestBody = {
        client_id: selected.clientId,
        plan_month: planMonth,
        previous_plan_id: selected.latestPlan?.id ?? null,
        correction_reason: selected.latestPlan ? draft.correctionReason : null,
        items: draft.items.map((item) => ({
          goal: item.goal,
          activity: item.activity,
          frequency: item.frequency,
          responsible_user_id: item.responsibleUserId,
          progress_status: item.progressStatus,
          progress_note: item.progressNote || null,
        })),
      };
      const expected = parseIndividualPlanInput(requestBody, idempotencyKey.current);
      const response = await fetchWithTimeout("/api/individual-service-plans", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(requestBody),
      });
      const envelope = await safeJson(response);
      if (!response.ok) throw new Error(responseError(
        envelope,
        "服務計畫未確認完成；內容與操作鍵已保留，可直接重試。",
      ));
      let receipt;
      try {
        receipt = parseIndividualPlanApiEnvelope(
          envelope,
          expected,
          response.status,
        );
      } catch (receiptError) {
        throw new Error(responseError(
          envelope,
          receiptError instanceof Error
            ? receiptError.message
            : "服務計畫回應無法確認；內容與操作鍵已保留。",
        ));
      }
      dialog.current?.close();
      setNotice(`已簽署 ${planMonth} 的 v${receipt.data.planVersion}；請求識別碼：${receipt.requestId}`);
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "服務計畫未確認完成；請保留內容重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.composer}>
      <button
        aria-label={disabledReason ? `建立或更新計畫：${disabledReason}` : "建立或更新計畫"}
        className="button button--primary"
        disabled={Boolean(disabledReason)}
        onClick={open}
        ref={trigger}
        title={disabledReason ?? undefined}
        type="button"
      >
        <Plus aria-hidden="true" />建立／更新計畫
      </button>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <dialog
        aria-labelledby="individual-plan-dialog-title"
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={trapFocus}
        ref={dialog}
      >
        <form className="core-dialog__surface" onSubmit={submit}>
          <header className="drawer__header">
            <div><p className="eyebrow">不可覆寫的月版本</p><h2 id="individual-plan-dialog-title">{planMonth} 個別化服務計畫</h2></div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}>
            <div className={`callout ${styles.securityCallout}`}>
              <ShieldCheck aria-hidden="true" />
              <span>送出即以伺服器時間簽署新版本；既有版本不會被修改。頻率與進度是人工紀錄，系統不計算完成率或照顧建議。</span>
            </div>
            <label className="field">
              <span>個案 *</span>
              <select
                autoFocus
                disabled={pending}
                onChange={(event) => {
                  const client = eligible.find((value) => value.clientId === event.target.value);
                  changed(draftFor(client, responsibles[0]?.userId ?? ""));
                }}
                required
                value={draft.clientId}
              >
                {eligible.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}（{client.clientCode}）{client.latestPlan ? `・目前 v${client.latestPlan.version}` : "・尚無計畫"}</option>)}
              </select>
            </label>
            {selected?.latestPlan ? (
              <label className="field">
                <span>新版理由 *</span>
                <textarea disabled={pending} maxLength={1_000} onChange={(event) => changed({ ...draft, correctionReason: event.target.value })} required value={draft.correctionReason} />
              </label>
            ) : null}
            <div className={styles.items}>
              {draft.items.map((item, index) => (
                <fieldset className={styles.item} disabled={pending} key={index}>
                  <legend>計畫項目 {index + 1}</legend>
                  <label className="field"><span>目標 *</span><textarea maxLength={500} onChange={(event) => updateItem(index, { goal: event.target.value })} required value={item.goal} /></label>
                  <label className="field"><span>活動 *</span><textarea maxLength={1_000} onChange={(event) => updateItem(index, { activity: event.target.value })} required value={item.activity} /></label>
                  <div className={styles.twoColumns}>
                    <label className="field"><span>頻率（人工文字）*</span><input maxLength={240} onChange={(event) => updateItem(index, { frequency: event.target.value })} required value={item.frequency} /></label>
                    <label className="field"><span>負責人 *</span><select onChange={(event) => updateItem(index, { responsibleUserId: event.target.value })} required value={item.responsibleUserId}>{responsibles.map((person) => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}</select></label>
                    <label className="field"><span>進度 *</span><select onChange={(event) => updateItem(index, { progressStatus: event.target.value as IndividualPlanItemInput["progressStatus"] })} value={item.progressStatus}>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="field"><span>進度備註</span><input maxLength={1_000} onChange={(event) => updateItem(index, { progressNote: event.target.value || null })} value={item.progressNote ?? ""} /></label>
                  </div>
                  {draft.items.length > 1 ? <button className={`button button--quiet ${styles.remove}`} onClick={() => changed({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })} type="button"><Trash2 aria-hidden="true" />移除項目</button> : null}
                </fieldset>
              ))}
            </div>
            {draft.items.length < 20 ? <button className="button button--secondary" disabled={pending} onClick={() => changed({ ...draft, items: [...draft.items, emptyItem(responsibles[0]?.userId ?? "")] })} type="button"><Plus aria-hidden="true" />新增計畫項目</button> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--quiet" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending} type="submit">{pending ? "簽署中…" : selected?.latestPlan ? "簽署新版本" : "簽署第一版"}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
