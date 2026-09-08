"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ClipboardPlus,
  CopyPlus,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { canRecordClientToccOn } from "@/lib/client-tocc/projection";
import type {
  ClientToccActionStatus,
  ClientToccBatchItemResult,
  ClientToccEvidenceStatus,
  ClientToccOption,
  ClientToccResultStatus,
} from "@/lib/client-tocc/types";
import { parseClientToccAssessmentFields } from "@/lib/client-tocc/validation";
import {
  parseClientToccBatchApiEnvelope,
  parseClientToccErrorEnvelope,
  parseClientToccSingleApiEnvelope,
  type ClientToccBatchInput,
  type ClientToccSingleInput,
} from "@/lib/integrations/client-tocc";

import styles from "./client-tocc.module.css";

type Draft = {
  rowId: string;
  itemKey: string;
  clientId: string;
  assessmentDate: string;
  resultStatus: ClientToccResultStatus;
  symptomSummary: string;
  riskSummary: string;
  evidenceStatus: ClientToccEvidenceStatus;
  actionStatus: ClientToccActionStatus;
};

type UiBatchResult = ClientToccBatchItemResult & {
  clientLabel: string;
  requestId: string;
};

const resultLabels: Record<ClientToccResultStatus, string> = {
  clear: "無需追蹤",
  monitor: "持續觀察",
  action_required: "需處置",
};
const evidenceLabels: Record<ClientToccEvidenceStatus, string> = {
  not_required: "不需證明",
  pending: "證明待確認",
  verified: "證明已確認",
  rejected: "證明不採認",
};
const actionLabels: Record<ClientToccActionStatus, string> = {
  none_required: "無需處置",
  pending: "待處置",
  in_progress: "處置中",
  completed: "已完成",
  referred: "已轉介",
};

function makeDraft(
  clientId: string,
  today: string,
  rowId: string,
  itemKey: string,
): Draft {
  return {
    rowId,
    itemKey,
    clientId,
    assessmentDate: today,
    resultStatus: "clear",
    symptomSummary: "",
    riskSummary: "",
    evidenceStatus: "not_required",
    actionStatus: "none_required",
  };
}

function makeInteractiveDraft(clientId: string, today: string) {
  return makeDraft(clientId, today, crypto.randomUUID(), crypto.randomUUID());
}

function requestBody(draft: Draft) {
  return {
    client_id: draft.clientId,
    assessment_date: draft.assessmentDate,
    result_status: draft.resultStatus,
    symptom_summary: draft.symptomSummary,
    risk_summary: draft.riskSummary,
    evidence_status: draft.evidenceStatus,
    action_status: draft.actionStatus,
  };
}

async function safeEnvelope(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function envelopeError(
  envelope: unknown,
  fallback: string,
) {
  const parsed = parseClientToccErrorEnvelope(envelope);
  return parsed
    ? `${parsed.error.message}（請求識別碼：${parsed.requestId}）`
    : fallback;
}

function ToccFields({
  draft,
  clients,
  today,
  prefix,
  autoFocus,
  onChange,
}: {
  draft: Draft;
  clients: readonly ClientToccOption[];
  today: string;
  prefix: string;
  autoFocus?: boolean;
  onChange: (draft: Draft) => void;
}) {
  const selected = clients.find((client) => client.id === draft.clientId);
  const lifecycleValid = Boolean(
    selected && canRecordClientToccOn(selected, draft.assessmentDate),
  );
  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    onChange({ ...draft, [field]: value });
  }
  return (
    <div className={styles.fields}>
      <label className="field">
        <span>個案 *</span>
        <select
          autoFocus={autoFocus}
          id={`${prefix}-client`}
          onChange={(event) => update("clientId", event.target.value)}
          required
          value={draft.clientId}
        >
          {clients.map((client) => (
            <option disabled={!client.canRecord} key={client.id} value={client.id}>
              {client.name}（{client.code}）{client.canRecord ? "" : "・目前不可新增"}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>評估日 *</span>
        <input
          id={`${prefix}-date`}
          max={today}
          onChange={(event) => update("assessmentDate", event.target.value)}
          required
          type="date"
          value={draft.assessmentDate}
        />
        {!lifecycleValid ? (
          <small className={styles.inlineError}>日期不在此個案的有效服務期間。</small>
        ) : null}
      </label>
      <label className="field">
        <span>結果 *</span>
        <select
          id={`${prefix}-result`}
          onChange={(event) => {
            const result = event.target.value as ClientToccResultStatus;
            onChange({
              ...draft,
              resultStatus: result,
              actionStatus:
                result === "clear" ? "none_required" : draft.actionStatus,
            });
          }}
          required
          value={draft.resultStatus}
        >
          {Object.entries(resultLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>證明狀態 *</span>
        <select
          id={`${prefix}-evidence`}
          onChange={(event) =>
            update(
              "evidenceStatus",
              event.target.value as ClientToccEvidenceStatus,
            )
          }
          required
          value={draft.evidenceStatus}
        >
          {Object.entries(evidenceLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>處置狀態 *</span>
        <select
          id={`${prefix}-action`}
          onChange={(event) =>
            update("actionStatus", event.target.value as ClientToccActionStatus)
          }
          required
          value={draft.actionStatus}
        >
          {Object.entries(actionLabels).map(([value, label]) => (
            <option
              disabled={
                draft.resultStatus === "action_required" &&
                value === "none_required"
              }
              key={value}
              value={value}
            >
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={`field ${styles.wideField}`}>
        <span>症狀摘要{draft.resultStatus !== "clear" ? "（至少填一項）" : ""}</span>
        <textarea
          id={`${prefix}-symptom`}
          maxLength={1_000}
          onChange={(event) => update("symptomSummary", event.target.value)}
          placeholder="僅記錄授權人員觀察，不由系統判讀。"
          value={draft.symptomSummary}
        />
      </label>
      <label className={`field ${styles.wideField}`}>
        <span>風險摘要{draft.resultStatus !== "clear" ? "（至少填一項）" : ""}</span>
        <textarea
          id={`${prefix}-risk`}
          maxLength={1_000}
          onChange={(event) => update("riskSummary", event.target.value)}
          placeholder="記錄已知風險與人工判斷，不自動診斷。"
          value={draft.riskSummary}
        />
      </label>
    </div>
  );
}

export function ClientToccComposer({
  clients,
  today,
  enabled,
  demo,
}: {
  clients: readonly ClientToccOption[];
  today: string;
  enabled: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const stableId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const recordable = useMemo(
    () => clients.filter((client) => client.canRecord),
    [clients],
  );
  const firstClient = recordable[0]?.id ?? "";
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [single, setSingle] = useState(() =>
    makeDraft(firstClient, today, `${stableId}-single`, ""),
  );
  const [batch, setBatch] = useState<readonly Draft[]>(() => {
    const initialClients = recordable.slice(0, Math.min(2, recordable.length));
    return initialClients.length
      ? initialClients.map((client, index) =>
          makeDraft(client.id, today, `${stableId}-batch-${index}`, ""),
        )
      : [makeDraft("", today, `${stableId}-batch-0`, "")];
  });
  const [singleKey, setSingleKey] = useState("");
  const [batchKey, setBatchKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<readonly UiBatchResult[]>([]);

  function open(nextMode: "single" | "batch", event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    setMode(nextMode);
    setError(null);
    setBatchResults([]);
    if (nextMode === "single") {
      setSingle(makeInteractiveDraft(firstClient, today));
      setSingleKey(crypto.randomUUID());
    } else {
      const initialClients = recordable.slice(0, Math.min(2, recordable.length));
      setBatch(initialClients.map((client) => makeInteractiveDraft(client.id, today)));
      setBatchKey(crypto.randomUUID());
    }
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function keepDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
      ),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true" &&
        !element.closest("[hidden]"),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateSingle(next: Draft) {
    setSingle({ ...next, itemKey: single.itemKey });
    setSingleKey(crypto.randomUUID());
    setError(null);
  }

  function updateBatch(index: number, next: Draft) {
    setBatch((current) =>
      current.map((draft, itemIndex) =>
        itemIndex === index
          ? { ...next, itemKey: crypto.randomUUID() }
          : draft,
      ),
    );
    setBatchKey(crypto.randomUUID());
    setBatchResults([]);
    setError(null);
  }

  function validateDraft(draft: Draft) {
    const fields = parseClientToccAssessmentFields(requestBody(draft), today);
    const client = recordable.find((option) => option.id === draft.clientId);
    if (!client || !canRecordClientToccOn(client, draft.assessmentDate)) {
      throw new Error("評估日不在此個案的有效服務期間。");
    }
    return fields;
  }

  async function submitSingle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const expected: ClientToccSingleInput = {
        ...validateDraft(single),
        idempotencyKey: singleKey,
      };
      const response = await fetchWithTimeout("/api/client-tocc", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": singleKey,
        },
        body: JSON.stringify(requestBody(single)),
      });
      const envelope = await safeEnvelope(response);
      if (!response.ok) {
        throw new Error(
          envelopeError(
            envelope,
            "TOCC 評估未確認儲存；內容與 UUID 鍵已保留，可直接重試。",
          ),
        );
      }
      parseClientToccSingleApiEnvelope(envelope, expected, response.status);
      close();
      setNotice("TOCC 評估已建立新版本；效期、來源與簽署時間將由正式快照顯示。");
      setSingleKey(crypto.randomUUID());
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "TOCC 評估未確認儲存；內容與 UUID 鍵已保留，可直接重試。",
      );
    } finally {
      setPending(false);
    }
  }

  async function submitBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setBatchResults([]);
    const submitted = [...batch];
    try {
      const expected: ClientToccBatchInput = {
        idempotencyKey: batchKey,
        items: submitted.map((draft) => ({
          ...validateDraft(draft),
          idempotencyKey: draft.itemKey,
        })),
      };
      const response = await fetchWithTimeout("/api/client-tocc/batch", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": batchKey,
        },
        body: JSON.stringify({
          items: submitted.map((draft) => ({
            ...requestBody(draft),
            idempotency_key: draft.itemKey,
          })),
        }),
      });
      const envelope = await safeEnvelope(response);
      if (!response.ok) {
        throw new Error(
          envelopeError(
            envelope,
            "TOCC 批次未確認；內容與 UUID 鍵已保留，可直接重試。",
          ),
        );
      }
      const parsedEnvelope = parseClientToccBatchApiEnvelope(
        envelope,
        expected,
        response.status,
      );
      const results = parsedEnvelope.data.items;
      const names = new Map(clients.map((client) => [client.id, `${client.name}（${client.code}）`]));
      const named = results.map((result) => ({
        ...result,
        requestId: parsedEnvelope.requestId,
        clientLabel: names.get(submitted[result.itemIndex - 1]!.clientId) ?? "個案",
      }));
      setBatchResults(named);
      const failedIndices = new Set(
        named.filter((result) => result.status === "failed").map((result) => result.itemIndex),
      );
      if (failedIndices.size === 0) {
        close();
        setNotice(`TOCC 批次 ${named.length} 筆全部完成；每筆均建立獨立版本。`);
      } else {
        setBatch(submitted.filter((_, index) => failedIndices.has(index + 1)));
        setBatchKey(crypto.randomUUID());
        setNotice(
          `批次已完成 ${named.length - failedIndices.size} 筆，${failedIndices.size} 筆未完成；成功項目不會再次送出。`,
        );
      }
      if (named.some((result) => result.status === "success")) router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "TOCC 批次未確認；內容與 UUID 鍵已保留，可直接重試。",
      );
    } finally {
      setPending(false);
    }
  }

  const disabledReason = demo
    ? "展示模式只讀，不會送出或保存 TOCC"
    : recordable.length === 0
      ? "目前沒有可新增 TOCC 的在案個案"
      : !enabled
        ? "需要 health.write 與最近 15 分鐘 AAL2"
        : undefined;

  return (
    <div className={styles.composer}>
      <div className={styles.actionGroup}>
        <button
          aria-label={disabledReason ? `新增 TOCC：${disabledReason}` : "新增 TOCC"}
          className="button button--primary"
          disabled={Boolean(disabledReason)}
          onClick={(event) => open("single", event)}
          title={disabledReason}
          type="button"
        >
          <ClipboardPlus aria-hidden="true" />新增 TOCC
        </button>
        <button
          aria-label={disabledReason ? `批次登錄：${disabledReason}` : "批次登錄"}
          className="button button--secondary"
          disabled={Boolean(disabledReason)}
          onClick={(event) => open("batch", event)}
          title={disabledReason}
          type="button"
        >
          <CopyPlus aria-hidden="true" />批次登錄
        </button>
      </div>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <dialog
        aria-labelledby="client-tocc-dialog-title"
        className={`core-dialog ${styles.dialog}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onKeyDown={keepDialogFocus}
        ref={dialog}
      >
        <form
          className="core-dialog__surface"
          onSubmit={mode === "single" ? submitSingle : submitBatch}
        >
          <header className="drawer__header">
            <div>
              <p className="eyebrow">專用 TOCC 簽署交易</p>
              <h2 id="client-tocc-dialog-title">
                {mode === "single" ? "新增個案 TOCC" : "批次登錄個案 TOCC"}
              </h2>
              <p>每次送出都建立不可變的新版本；效期由伺服器套用台北日曆月規則。</p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}>
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>結果由授權人員選擇；系統只驗證欄位、保存證據並提示效期，不會自動診斷或改變照顧決策。</span>
            </div>
            {mode === "single" ? (
              <ToccFields
                autoFocus
                clients={clients}
                draft={single}
                onChange={updateSingle}
                prefix="single-tocc"
                today={today}
              />
            ) : (
              <div className={styles.batchList}>
                {batch.map((draft, index) => (
                  <fieldset className={styles.batchItem} key={draft.rowId}>
                    <legend>第 {index + 1} 筆</legend>
                    <button
                      aria-label={`移除第 ${index + 1} 筆`}
                      className={styles.removeButton}
                      disabled={batch.length === 1}
                      onClick={() => {
                        setBatch((current) => current.filter((_, itemIndex) => itemIndex !== index));
                        setBatchKey(crypto.randomUUID());
                        setBatchResults([]);
                      }}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />移除
                    </button>
                    <ToccFields
                      autoFocus={index === 0}
                      clients={clients}
                      draft={draft}
                      onChange={(next) => updateBatch(index, next)}
                      prefix={`batch-tocc-${draft.rowId}`}
                      today={today}
                    />
                  </fieldset>
                ))}
                {batch.length < 100 ? (
                  <button
                    className={`button button--secondary ${styles.addButton}`}
                    onClick={() => {
                      setBatch((current) => [
                        ...current,
                        makeInteractiveDraft(firstClient, today),
                      ]);
                      setBatchKey(crypto.randomUUID());
                      setBatchResults([]);
                    }}
                    type="button"
                  >
                    <Plus aria-hidden="true" />增加一筆
                  </button>
                ) : null}
              </div>
            )}
            {batchResults.length ? (
              <section aria-labelledby="client-tocc-batch-result-title" className={styles.results}>
                <h3 id="client-tocc-batch-result-title">逐筆處理結果</h3>
                <ul>
                  {batchResults.map((result) => (
                    <li data-status={result.status} key={`${result.itemIndex}-${result.itemIdempotencyKey}`}>
                      <strong>第 {result.itemIndex} 筆・{result.clientLabel}</strong>
                      <span>
                        {result.status === "success"
                          ? `成功，版本 v${result.assessmentVersion}，有效至 ${result.validThrough}${result.itemReplayed ? "（安全重送）" : ""}`
                          : result.error?.code === "forbidden"
                            ? "未完成：個案已不在可寫範圍，請主管確認目前指派。"
                            : result.error?.code === "idempotency_conflict"
                              ? "未完成：UUID 鍵已對應不同內容；修改內容後再送。"
                              : result.error?.code === "retryable_conflict"
                                ? "未完成：資料暫時鎖定，可直接重試此筆。"
                                : result.error?.code === "validation_failed"
                                  ? "未完成：正式規則未通過，請檢查日期與狀態。"
                                  : `未完成：結果未確認，請保留內容並提供請求識別碼 ${result.requestId}。`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending || !firstClient} type="submit">
              {pending
                ? "送出中…"
                : mode === "single"
                  ? "簽署並建立版本"
                  : batchResults.some((result) => result.status === "failed")
                    ? `重試未完成 ${batch.length} 筆`
                    : `送出 ${batch.length} 筆`}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
