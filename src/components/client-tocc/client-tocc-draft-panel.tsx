"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useCoreDraftGuard } from "@/components/app/core-draft-guard";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { canRecordClientToccOn } from "@/lib/client-tocc/projection";
import type { ClientToccOption } from "@/lib/client-tocc/types";
import { parseClientToccAssessmentFields } from "@/lib/client-tocc/validation";
import {
  parseToccDraftSaveInput,
  parseToccDraftSaveReceipt,
  parseToccDraftSignInput,
  parseToccDraftSignReceipt,
  type ToccDraft,
} from "@/lib/integrations/client-tocc-drafts";
import { parseClientToccErrorEnvelope } from "@/lib/integrations/client-tocc";

import {
  makeInteractiveDraft,
  requestBody,
  ToccFields,
  type Draft,
} from "./client-tocc-composer";
import styles from "./client-tocc.module.css";

type Editing = { previous: ToccDraft | null; fields: Draft; key: string; dirty: boolean; submitted: boolean };
type EditorTransition = { kind: "create" | "revise" | "cancel"; draft?: ToccDraft; trigger: HTMLButtonElement | null };

const definiteSaveErrors = new Set(["TOCC_DRAFT_VERSION_CONFLICT", "TOCC_DRAFT_IDEMPOTENCY_CONFLICT",
  "TOCC_DRAFT_FORBIDDEN", "INVALID_TOCC_DRAFT", "DEMO_WRITE_DISABLED"]);
const definiteSignErrors = new Set(["TOCC_DRAFT_VERSION_CONFLICT", "TOCC_DRAFT_SIGN_FORBIDDEN",
  "INVALID_TOCC_DRAFT_SIGN", "DEMO_WRITE_DISABLED"]);

const resultLabels = { clear: "無需追蹤", monitor: "持續觀察", action_required: "需處置" } as const;
const evidenceLabels = { not_required: "不需證明", pending: "證明待確認", verified: "證明已確認", rejected: "證明不採認" } as const;
const actionLabels = { none_required: "無需處置", pending: "待處置", in_progress: "處置中", completed: "已完成", referred: "已轉介" } as const;

function errorMessage(value: unknown, fallback: string) {
  const parsed = parseClientToccErrorEnvelope(value);
  return parsed ? `${parsed.error.message}（請求識別碼：${parsed.requestId}）` : fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function envelopeData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (value as { status?: unknown }).status !== "ok") throw new Error("伺服器回條格式不完整，請使用原冪等鍵重試。");
  return (value as { data?: unknown }).data;
}

function formatTaipeiCreatedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "建立時間待核對";
  // Locale format() can use a different invisible separator in Node and Chrome,
  // which would hydrate the same instant to different text. Join fixed parts.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `建立於 ${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}（台北）`;
}

function DraftDetails({ draft, client }: { draft: ToccDraft; client: ClientToccOption | undefined }) {
  return <dl className={styles.reviewGrid}>
    <div><dt>個案</dt><dd>{client ? `${client.name}（${client.code}）` : "—"}</dd></div>
    <div><dt>評估日</dt><dd>{draft.assessmentDate}</dd></div>
    <div><dt>結果</dt><dd>{resultLabels[draft.resultStatus]}</dd></div>
    <div><dt>證明狀態</dt><dd>{evidenceLabels[draft.evidenceStatus]}</dd></div>
    <div><dt>處置狀態</dt><dd>{actionLabels[draft.actionStatus]}</dd></div>
    <div><dt>症狀摘要</dt><dd>{draft.symptomSummary ?? "未填"}</dd></div>
    <div><dt>風險摘要</dt><dd>{draft.riskSummary ?? "未填"}</dd></div>
  </dl>;
}

export function ClientToccDraftPanel({ drafts, clients, today, canSave, canSign }: {
  drafts: readonly ToccDraft[];
  clients: readonly ClientToccOption[];
  today: string;
  canSave: boolean;
  canSign: boolean;
}) {
  const router = useRouter();
  const draftGuard = useCoreDraftGuard();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reviewing, setReviewing] = useState<ToccDraft | null>(null);
  const [conflict, setConflict] = useState(false);
  const signKeys = useRef(new Map<string, string>());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const reviewOrigin = useRef<HTMLButtonElement | null>(null);
  const editorOrigin = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recordable = clients.filter((client) => client.canRecord);
  const available = drafts.filter((draft) => clients.some((client) => client.id === draft.clientId));
  const editorRowId = editing?.fields.rowId;
  const hasUnconfirmedInput = Boolean(uncertain || (editing && (editing.dirty || editing.submitted)));
  const latestAfterConflict = conflict && editing?.previous
    ? available.find((draft) => draft.draftKey === editing.previous?.draftKey && draft.versionId !== editing.previous.versionId)
    : null;
  const currentReview = reviewing ? available.find((draft) => draft.draftKey === reviewing.draftKey) : null;
  const reviewIsCurrent = Boolean(reviewing && currentReview && currentReview.versionId === reviewing.versionId
    && currentReview.contentHash === reviewing.contentHash && !currentReview.signedAssessmentId);

  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus();
  }, [reviewing]);
  useEffect(() => {
    if (editorRowId) editorHeading.current?.focus();
  }, [editorRowId]);
  function applyTransition(action: EditorTransition) {
    setError(null);
    setNotice(null);
    setConflict(false);
    setReviewing(null);
    setUncertain(false);
    if (action.kind === "cancel") {
      setEditing(null);
      setTimeout(() => editorOrigin.current?.focus(), 0);
      return;
    }
    editorOrigin.current = action.trigger;
    if (action.kind === "create") {
      if (!recordable.length) return;
      setEditing({ previous: null, fields: makeInteractiveDraft(recordable[0]!.id, today),
        key: crypto.randomUUID(), dirty: false, submitted: false });
      return;
    }
    const previous = action.draft;
    if (!previous) return;
    setEditing({
      previous,
      key: crypto.randomUUID(),
      dirty: false,
      submitted: false,
      fields: {
        rowId: previous.versionId,
        itemKey: "",
        clientId: previous.clientId,
        assessmentDate: previous.assessmentDate,
        resultStatus: previous.resultStatus,
        symptomSummary: previous.symptomSummary ?? "",
        riskSummary: previous.riskSummary ?? "",
        evidenceStatus: previous.evidenceStatus,
        actionStatus: previous.actionStatus,
      },
    });
  }

  function requestTransition(action: EditorTransition) {
    if (!draftGuard.discard(() => applyTransition(action), action.trigger)) {
      setError("前次操作仍在送出或結果未確認；請用原冪等鍵重試確認，暫時不能放棄或切換草稿。");
    }
  }

  async function copyCurrentInput() {
    if (!editing) return;
    const fields = editing.fields;
    const copy = [
      `評估日：${fields.assessmentDate}`, `結果：${resultLabels[fields.resultStatus]}`,
      `證明狀態：${evidenceLabels[fields.evidenceStatus]}`,
      `處置狀態：${actionLabels[fields.actionStatus]}`,
      `症狀摘要：${fields.symptomSummary || "未填"}`,
      `風險摘要：${fields.riskSummary || "未填"}`,
    ].join("\n");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(copy);
      setNotice("目前輸入已複製；內容包含健康資訊，請妥善處理剪貼簿。");
    } catch {
      setError("無法複製目前輸入；表單內容仍保留在本頁，請勿關閉或切換頁面。");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !canSave || pending || conflict || !draftGuard.begin()) return;
    let requestSent = false;
    let definiteFailure = false;
    setPending(true);
    setEditing((current) => current ? { ...current, submitted: true } : null);
    setError(null);
    try {
      const client = recordable.find((item) => item.id === editing.fields.clientId);
      if (!client || !canRecordClientToccOn(client, editing.fields.assessmentDate)) {
        throw new Error("評估日不在目前個案的有效服務期間。");
      }
      parseClientToccAssessmentFields(requestBody(editing.fields), today);
      const body = {
        action: editing.previous ? "revise" : "create",
        draft_key: editing.previous?.draftKey ?? editing.fields.rowId,
        previous_version_id: editing.previous?.versionId ?? null,
        expected_version: editing.previous?.version ?? 0,
        expected_content_hash: editing.previous?.contentHash ?? null,
        ...requestBody(editing.fields),
      };
      const input = parseToccDraftSaveInput(body, editing.key);
      requestSent = true;
      const response = await fetchWithTimeout("/api/client-tocc/drafts", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": editing.key },
        body: JSON.stringify(body),
      });
      const envelope = await responseBody(response);
      if (!response.ok) {
        const parsed = parseClientToccErrorEnvelope(envelope);
        if (response.status === 409 && parsed?.error.code === "TOCC_DRAFT_VERSION_CONFLICT") setConflict(true);
        definiteFailure = Boolean(parsed && definiteSaveErrors.has(parsed.error.code));
        throw new Error(errorMessage(envelope, "草稿尚未確認儲存；內容與冪等鍵已保留。"));
      }
      const receipt = parseToccDraftSaveReceipt(envelopeData(envelope), input);
      if (response.status !== (receipt.replayed ? 200 : 201)) throw new Error("草稿回條狀態不一致，請使用原冪等鍵重試。");
      draftGuard.saved();
      setUncertain(false);
      setEditing(null);
      setConflict(false);
      setNotice(`未簽署草稿 v${receipt.version} 已儲存。`);
      router.refresh();
      setTimeout(() => panelHeading.current?.focus(), 0);
    } catch (reason) {
      const resultUncertain = requestSent && !definiteFailure || uncertain && !requestSent;
      if (resultUncertain) draftGuard.hold();
      else draftGuard.unhold();
      setUncertain(resultUncertain);
      setEditing((current) => current ? { ...current, dirty: true, submitted: resultUncertain } : null);
      setError(resultUncertain
        ? "草稿送出結果未確認；請保留本頁，按「以原操作重試儲存」確認。"
        : reason instanceof Error ? reason.message : "草稿未儲存；請檢查內容後重試。");
    } finally {
      draftGuard.finish();
      setPending(false);
    }
  }

  function openReview(draft: ToccDraft, trigger: HTMLButtonElement) {
    if (uncertain || pending) {
      setError("前次操作結果未確認；請先用原冪等鍵重試確認。");
      return;
    }
    if (editing) {
      setError("請先儲存或取消目前草稿編輯，再核對簽署。");
      return;
    }
    reviewOrigin.current = trigger;
    setReviewing(draft);
    setError(null);
    setNotice(null);
  }

  function closeReview() {
    if (uncertain || pending) {
      setError("簽署結果未確認；請用原冪等鍵重試，暫時不能離開核對畫面。");
      return;
    }
    setReviewing(null);
    setError(null);
    setTimeout(() => reviewOrigin.current?.focus(), 0);
  }

  async function sign(draft: ToccDraft) {
    if (!canSign || draft.signedAssessmentId || pending || (!reviewIsCurrent && !uncertain)
      || editing || !draftGuard.begin()) return;
    let requestSent = false;
    let definiteFailure = false;
    const operation = `${draft.draftKey}:${draft.versionId}:${draft.contentHash}`;
    const key = signKeys.current.get(operation) ?? crypto.randomUUID();
    signKeys.current.set(operation, key);
    setPending(true);
    setError(null);
    try {
      const body = {
        draft_key: draft.draftKey,
        expected_version_id: draft.versionId,
        expected_version: draft.version,
        expected_content_hash: draft.contentHash,
      };
      const input = parseToccDraftSignInput(body, key);
      requestSent = true;
      const response = await fetchWithTimeout("/api/client-tocc/drafts/sign", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
      const envelope = await responseBody(response);
      if (!response.ok) {
        const parsed = parseClientToccErrorEnvelope(envelope);
        definiteFailure = Boolean(parsed && definiteSignErrors.has(parsed.error.code));
        throw new Error(errorMessage(envelope, "簽署尚未確認；請使用原冪等鍵重試。"));
      }
      const receipt = parseToccDraftSignReceipt(envelopeData(envelope), input);
      if (response.status !== (receipt.replayed ? 200 : 201)) throw new Error("簽署回條狀態不一致，請使用原冪等鍵重試。");
      draftGuard.saved();
      setUncertain(false);
      signKeys.current.delete(operation);
      setReviewing(null);
      setNotice("草稿已由真實 AAL2 驗證簽署；正式紀錄將在下方顯示。");
      router.refresh();
      setTimeout(() => panelHeading.current?.focus(), 0);
    } catch (reason) {
      const resultUncertain = requestSent && !definiteFailure || uncertain && !requestSent;
      if (resultUncertain) draftGuard.hold();
      else draftGuard.saved();
      setUncertain(resultUncertain);
      setError(resultUncertain
        ? "簽署結果未確認；請保留本頁，按「以原操作重試簽署」確認。"
        : reason instanceof Error ? reason.message : "簽署未完成；請核對條件後重試。");
    } finally {
      draftGuard.finish();
      setPending(false);
    }
  }

  function actionsFor(draft: ToccDraft, client: ClientToccOption | undefined) {
    if (draft.signedAssessmentId) return null;
    if (!client?.canRecord || !canRecordClientToccOn(client, draft.assessmentDate))
      return <p className={styles.draftUnavailable}>個案目前不可新增或修訂 TOCC；請確認服務狀態與期間。</p>;
    return <div className={styles.draftActions}>
      {canSave ? <button className="button button--quiet" disabled={pending}
        onClick={(event) => requestTransition({ kind: "revise", draft, trigger: event.currentTarget })}
        type="button">修訂</button> : null}
      {canSign ? <button className="button button--secondary" disabled={pending}
        onClick={(event) => openReview(draft, event.currentTarget)}
        type="button">核對草稿 v{draft.version}</button> : null}
    </div>;
  }

  if (!canSave && !canSign && !available.length) return null;
  return (
    <section aria-labelledby="tocc-draft-title" className="panel">
      <div className="panel__header">
        <div className="panel__title">
          <h2 id="tocc-draft-title" ref={panelHeading} tabIndex={-1}>未簽署 TOCC 草稿</h2>
          <p>草稿供人工核對與修訂，不計入下方正式 TOCC 效期或統計。簽署後才形成不可變的正式版本。</p>
        </div>
        {canSave ? <button className="button button--secondary" disabled={!recordable.length || pending}
          onClick={(event) => requestTransition({ kind: "create", trigger: event.currentTarget })}
          type="button">建立草稿</button> : null}
      </div>
      {notice ? <p className={`${styles.draftFeedback} ${styles.draftFeedbackSuccess}`} role="status">{notice}</p> : null}
      {error && !reviewing ? <p className={`${styles.draftFeedback} ${styles.draftFeedbackError}`} role="alert">{error}</p> : null}
      {hasUnconfirmedInput ? <p className={styles.draftNavigationNotice} role="status">
        {uncertain
          ? "前次送出結果未確認；本次操作內容與冪等鍵已鎖定。頁面連結與篩選切換已暫停，其他程式直接導覽可能無法攔截；關閉或重新整理會再次提醒，但瀏覽器仍可強制離頁。請保留本頁並按原操作重試。"
          : "目前有未儲存輸入。切換草稿、站內連結、篩選或離頁時會要求確認；若由其他程式直接切換畫面，請先自行完成儲存或複製需要的內容。"}
      </p> : null}
      {editing ? (
        <form className={styles.draftEditor} method="post" noValidate onSubmit={save}>
          <h3 ref={editorHeading} tabIndex={-1}>{editing.previous ? `修訂未簽署草稿 v${editing.previous.version}` : "建立未簽署草稿"}</h3>
          <fieldset className={styles.draftFields} disabled={pending || uncertain}>
            <ToccFields
              clientLocked={editing.previous !== null}
              clients={recordable}
              draft={editing.fields}
              onChange={(fields) => {
                if (pending || uncertain) return;
                draftGuard.changed();
                setEditing((current) => current ? { ...current, fields, key: crypto.randomUUID(), dirty: true } : null);
                setError(null);
              }}
              prefix="tocc-draft"
              today={today}
            />
          </fieldset>
          {conflict ? <section aria-label="草稿版本衝突處理" className={styles.conflictCard}>
            <h4>草稿已有新版，目前輸入仍保留</h4>
            <p>請先核對最新版本；複製目前輸入會將健康摘要放到裝置剪貼簿。重新載入清單不會清除本頁表單。</p>
            <div className={styles.actions}>
              <button className="button button--secondary" onClick={() => void copyCurrentInput()} type="button">複製目前輸入（含健康摘要）</button>
              <button className="button button--quiet" onClick={() => router.refresh()} type="button">重新載入最新草稿</button>
            </div>
            {latestAfterConflict ? <>
              <h5>目前伺服器版本 v{latestAfterConflict.version}</h5>
              <DraftDetails draft={latestAfterConflict} client={clients.find((client) => client.id === latestAfterConflict.clientId)} />
              {latestAfterConflict.signedAssessmentId ? <p>最新版已簽署，不能再修訂此草稿。</p>
                : <button className="button button--secondary" onClick={() => {
                  setEditing((current) => current ? { ...current, previous: latestAfterConflict,
                    key: crypto.randomUUID(), dirty: true, submitted: false } : null);
                  setConflict(false);
                  setError(null);
                  setNotice(`已以最新版 v${latestAfterConflict.version} 為基礎，保留目前輸入；請核對差異後再儲存。`);
                }} type="button">保留目前輸入並改以 v{latestAfterConflict.version} 修訂</button>}
            </> : null}
          </section> : null}
          <div className={styles.actions}>
            <button className="button button--primary" disabled={pending || conflict} type="submit">{pending ? "儲存中…" : uncertain ? "以原操作重試儲存" : "儲存未簽署草稿"}</button>
            <button className="button button--quiet" disabled={pending}
              onClick={(event) => requestTransition({ kind: "cancel", trigger: event.currentTarget })}
              type="button">取消</button>
          </div>
        </form>
      ) : null}
      {available.length ? <>
        <div aria-label="TOCC 草稿列表，可左右捲動" className="table-wrap" role="region" tabIndex={0}>
          <table className="data-table">
            <thead><tr><th scope="col">個案</th><th scope="col">草稿版本</th><th scope="col">填報日／結果</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead>
            <tbody>{available.map((draft) => {
              const client = clients.find((item) => item.id === draft.clientId);
              return <tr key={draft.draftKey}>
                <td>{client?.name ?? "—"}<small className="data-table__secondary">{client?.code}</small></td>
                <td>v{draft.version}<small className="data-table__secondary">{formatTaipeiCreatedAt(draft.createdAt)}</small></td>
                <td>{draft.assessmentDate}<small className="data-table__secondary">{resultLabels[draft.resultStatus]}</small></td>
                <td>{draft.signedAssessmentId ? "已轉為正式簽署紀錄" : "未簽署"}</td>
                <td>{actionsFor(draft, client)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mobile-records core-care-mobile" data-testid="tocc-draft-mobile-list">
          {available.map((draft) => {
            const client = clients.find((item) => item.id === draft.clientId);
            return <article className="record-card" key={draft.draftKey}>
              <div className="record-card__top"><div><h3>{client?.name ?? "—"}</h3><span className="data-table__secondary">{client?.code}</span></div>
                <span>{draft.signedAssessmentId ? "已簽署" : "未簽署"}</span></div>
              <dl className="core-care-card-grid">
                <div><dt>草稿版本</dt><dd>v{draft.version}</dd></div>
                <div><dt>評估日</dt><dd>{draft.assessmentDate}</dd></div>
                <div><dt>結果</dt><dd>{resultLabels[draft.resultStatus]}</dd></div>
                <div><dt>建立時間</dt><dd>{formatTaipeiCreatedAt(draft.createdAt)}</dd></div>
              </dl>
              {actionsFor(draft, client)}
            </article>;
          })}
        </div>
      </> : <p className="empty-state">目前沒有可檢視的 TOCC 草稿。</p>}
      {reviewing && !reviewing.signedAssessmentId ? (
        <section aria-labelledby="tocc-sign-review-title" className={styles.reviewCard}>
          <h3 id="tocc-sign-review-title" ref={reviewHeading} tabIndex={-1}>正式簽署前核對草稿 v{reviewing.version}</h3>
          <p>以下為即將簽署的完整草稿內容。送出後會由目前真實 AAL2 驗證建立不可變的正式 TOCC 版本。</p>
          <DraftDetails draft={reviewing} client={clients.find((client) => client.id === reviewing.clientId)} />
          {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
          {!reviewIsCurrent ? <p className={styles.inlineError} role="alert">{uncertain
            ? "清單中的版本已變動；請用原操作重試確認前次簽署結果，勿另行簽署新版。"
            : "草稿版本已變動或簽署，請返回列表重新核對。"}</p> : null}
          <div className={styles.actions}>
            <button className="button button--primary" disabled={pending || (!reviewIsCurrent && !uncertain)} onClick={() => void sign(reviewing)} type="button">{pending ? "簽署中…" : uncertain ? `以原操作重試簽署 v${reviewing.version}` : `確認並簽署 v${reviewing.version}`}</button>
            <button className="button button--quiet" disabled={pending} onClick={closeReview} type="button">返回草稿</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
