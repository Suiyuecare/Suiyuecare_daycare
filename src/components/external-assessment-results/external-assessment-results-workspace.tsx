"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, Plus, RotateCw } from "lucide-react";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  externalAssessmentInstruments,
  externalAssessmentResultInputSchema,
  externalAssessmentResultRecordSchema,
  parseExternalAssessmentResultsSnapshot,
  type ExternalAssessmentInstrument,
  type ExternalAssessmentResultInput,
  type ExternalAssessmentResultRecord,
} from "@/lib/external-assessment-results/contract";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";

import styles from "./external-assessment-results-workspace.module.css";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

type FrozenSaveAttempt = {
  clientId: string;
  instrumentKey: ExternalAssessmentInstrument;
  input: ExternalAssessmentResultInput;
  operationKey: string;
  body: string;
};

function parseCommittedRecord(value: unknown, attempt: FrozenSaveAttempt): ExternalAssessmentResultRecord | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  const data = (value as { data: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const receipt = data as { record?: unknown; persisted?: unknown; demo?: unknown; replayed?: unknown };
  const parsed = externalAssessmentResultRecordSchema.safeParse(receipt.record);
  if (!parsed.success || receipt.persisted !== true || receipt.demo !== false ||
    typeof receipt.replayed !== "boolean") return null;
  const record = parsed.data;
  const input = attempt.input;
  return record.clientId === attempt.clientId && record.instrumentKey === attempt.instrumentKey &&
    record.externalVersion === input.externalVersion && record.assessedOn === input.assessedOn &&
    record.score === input.score && record.maximumScore === input.maximumScore &&
    record.externalResult === input.externalResult && record.performedBy === input.performedBy &&
    record.source === input.source && record.followUpDueOn === input.followUpDueOn &&
    record.followUpNote === input.followUpNote ? record : null;
}

export function ExternalAssessmentResultsWorkspace({
  clientId,
  initialInstrument,
  readableInstruments,
  writableInstruments,
}: {
  clientId: string;
  initialInstrument: ExternalAssessmentInstrument | null;
  readableInstruments: readonly ExternalAssessmentInstrument[];
  writableInstruments: readonly ExternalAssessmentInstrument[];
}) {
  const [instrumentKey, setInstrumentKey] = useState<ExternalAssessmentInstrument>(
    initialInstrument && readableInstruments.includes(initialInstrument)
      ? initialInstrument : readableInstruments[0] ?? "barthel_adl",
  );
  const [assessedOn, setAssessedOn] = useState(today);
  const [externalVersion, setExternalVersion] = useState("");
  const [score, setScore] = useState("");
  const [maximumScore, setMaximumScore] = useState("");
  const [externalResult, setExternalResult] = useState("");
  const [performedBy, setPerformedBy] = useState("");
  const [source, setSource] = useState("");
  const [followUpDueOn, setFollowUpDueOn] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [records, setRecords] = useState<ExternalAssessmentResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const readGeneration = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const saveAttempt = useRef<FrozenSaveAttempt | null>(null);
  const releaseOperation = useRef<(() => void) | null>(null);
  const currentScope = useRef(`${clientId}:${instrumentKey}`);
  const setScopeChangeState = useScopeChangeDraftRegistration();
  const canWriteSelected = writableInstruments.includes(instrumentKey);
  const fieldsLocked = saving || uncertain;
  const visibleRecords = records.filter((record) => record.clientId === clientId && record.instrumentKey === instrumentKey);

  useEffect(() => {
    currentScope.current = `${clientId}:${instrumentKey}`;
  }, [clientId, instrumentKey]);

  useEffect(() => {
    setScopeChangeState({ dirty: false, busy: saving, unknown: uncertain });
  }, [saving, uncertain, setScopeChangeState]);

  const load = useCallback(async () => {
    if (!readableInstruments.includes(instrumentKey)) return;
    const generation = ++readGeneration.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setRecords([]);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithTimeout(`/api/external-assessment-results?clientId=${encodeURIComponent(clientId)}&instrumentKey=${instrumentKey}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("data" in body)) throw new Error("LOAD_FAILED");
      const parsed = (body as { data: { snapshot: unknown } }).data;
      const snapshot = parseExternalAssessmentResultsSnapshot(parsed.snapshot, clientId, instrumentKey);
      if (generation !== readGeneration.current || controller.signal.aborted) return;
      setRecords(snapshot.records);
    } catch {
      if (generation !== readGeneration.current || controller.signal.aborted) return;
      setError("結果清單暫時無法載入，請重試。");
    } finally {
      if (generation === readGeneration.current && !controller.signal.aborted) setLoading(false);
    }
  }, [clientId, instrumentKey, readableInstruments]);

  const invalidateRead = useCallback(() => {
    ++readGeneration.current;
    readController.current?.abort();
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    return invalidateRead;
  }, [load, invalidateRead]);

  async function sendAttempt(attempt: FrozenSaveAttempt) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/external-assessment-results", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": attempt.operationKey },
        body: attempt.body,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (!uncertain && [400, 403].includes(response.status) && saveAttempt.current === attempt) {
          saveAttempt.current = null;
          releaseOperation.current?.();
          releaseOperation.current = null;
          setError("這筆資料未保存。請檢查欄位或權限後再試。");
          return;
        }
        throw new Error("SAVE_NOT_CONFIRMED");
      }
      const record = parseCommittedRecord(body, attempt);
      if (!record) throw new Error("RECEIPT_MISMATCH");
      if (saveAttempt.current !== attempt) return;
      saveAttempt.current = null;
      releaseOperation.current?.();
      releaseOperation.current = null;
      setUncertain(false);
      if (currentScope.current !== `${attempt.clientId}:${attempt.instrumentKey}`) return;
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]
        .sort((a, b) => b.assessedOn.localeCompare(a.assessedOn) || b.createdAt.localeCompare(a.createdAt)));
      setNotice("已保存外部量表結果；系統未填答或計分。");
      setExternalVersion("");
      setScore("");
      setMaximumScore("");
      setExternalResult("");
      setPerformedBy("");
      setSource("");
      setFollowUpDueOn("");
      setFollowUpNote("");
    } catch {
      if (saveAttempt.current === attempt) {
        setUncertain(true);
        setError("儲存結果尚未確認。請以原操作重試；確認前不能修改或另存。");
      }
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || uncertain || saveAttempt.current || !canWriteSelected ||
      !readableInstruments.includes(instrumentKey)) return;
    setError(null);
    setNotice(null);
    const input = externalAssessmentResultInputSchema.safeParse({
      instrumentKey,
      externalVersion,
      assessedOn,
      score: score === "" ? null : Number(score),
      maximumScore: maximumScore === "" ? null : Number(maximumScore),
      externalResult,
      performedBy,
      source,
      followUpDueOn: followUpDueOn || null,
      followUpNote: followUpNote || null,
    });
    if (!input.success) {
      setError("請檢查必填欄位；分數與滿分需一起填，且分數不能大於滿分。");
      return;
    }
    const lease = tryAcquirePendingOperation();
    if (!lease) { setError("畫面正在切換，請稍候再儲存。"); return; }
    const attempt: FrozenSaveAttempt = {
      clientId,
      instrumentKey,
      input: input.data,
      operationKey: crypto.randomUUID(),
      body: JSON.stringify({ clientId, input: input.data }),
    };
    releaseOperation.current = lease;
    saveAttempt.current = attempt;
    await sendAttempt(attempt);
  }

  return <section aria-labelledby="external-results-title" className={styles.panel} id="external-result-entry">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>紙本／外部評估</p><h2 id="external-results-title">登錄評估結果</h2></div>
      <span className={styles.badge}>不計分</span>
    </header>
    <p className={styles.intro}>先在核准的紙本或外部工具完成評估，再照原結果登錄。這裡不提供題目、自動計分、診斷或照顧決策。</p>
    <div className={styles.instrumentPicker}>
      <label>量表／評估工具
        <select disabled={fieldsLocked} onChange={(event) => setInstrumentKey(event.target.value as ExternalAssessmentInstrument)} value={instrumentKey}>
          {readableInstruments.map((key) => <option key={key} value={key}>{externalAssessmentInstruments[key]}</option>)}
        </select>
      </label>
    </div>
    {canWriteSelected ? <form className={styles.form} noValidate onSubmit={submit}>
      <label>外部題本／版本
        <input disabled={fieldsLocked} maxLength={80} onChange={(event) => setExternalVersion(event.target.value)} required value={externalVersion} />
      </label>
      <label>評估日期
        <input disabled={fieldsLocked} max={today} onChange={(event) => setAssessedOn(event.target.value)} required type="date" value={assessedOn} />
      </label>
      <div className={styles.scoreFields}>
        <label>外部分數（選填）
          <input disabled={fieldsLocked} inputMode="decimal" min="0" onChange={(event) => setScore(event.target.value)} step="0.01" type="number" value={score} />
        </label>
        <label>滿分（與分數一起填）
          <input disabled={fieldsLocked} inputMode="decimal" min="0.01" onChange={(event) => setMaximumScore(event.target.value)} step="0.01" type="number" value={maximumScore} />
        </label>
      </div>
      <label className={styles.wide}>原量表結果／判讀摘要
        <textarea disabled={fieldsLocked} maxLength={500} onChange={(event) => setExternalResult(event.target.value)} required rows={2} value={externalResult} />
      </label>
      <label>執行者
        <input disabled={fieldsLocked} maxLength={120} onChange={(event) => setPerformedBy(event.target.value)} required value={performedBy} />
      </label>
      <label>來源／機構
        <input disabled={fieldsLocked} maxLength={120} onChange={(event) => setSource(event.target.value)} required value={source} />
      </label>
      <label>人工追蹤日期（選填）
        <input disabled={fieldsLocked} onChange={(event) => setFollowUpDueOn(event.target.value)} type="date" value={followUpDueOn} />
      </label>
      <label className={styles.wide}>追蹤事項（選填）
        <textarea disabled={fieldsLocked} maxLength={500} onChange={(event) => setFollowUpNote(event.target.value)} rows={2} value={followUpNote} />
      </label>
      <p className={styles.caution}><AlertTriangle aria-hidden="true" />登錄為未簽署的外部結果，不會自動建立風險分類或照顧決策。</p>
      <div className={styles.actions}>
        <button className="button button--primary" disabled={fieldsLocked} type="submit">
          {saving ? <LoaderCircle aria-hidden="true" className={styles.spinning} /> : <Plus aria-hidden="true" />}
          {saving ? "儲存中" : "儲存結果"}
        </button>
      </div>
    </form> : <p className={styles.intro}>此量表目前只有查閱權限；如需登錄，請聯絡機構管理員確認評估權限。</p>}
    {error ? <p className={styles.feedbackError} role="alert">{error}</p> : null}
    {notice ? <p className={styles.feedbackSuccess} role="status"><Check aria-hidden="true" />{notice}</p> : null}
    {uncertain ? <div className={styles.retryHold} role="status">
      <p>原操作結果尚未確認。請保持此頁，勿更換個案或重填。</p>
      <button className="button button--secondary" disabled={saving}
        onClick={() => { const attempt = saveAttempt.current; if (attempt) void sendAttempt(attempt); }} type="button">
        {saving ? <LoaderCircle aria-hidden="true" className={styles.spinning} /> : <RotateCw aria-hidden="true" />}
        以原操作重試
      </button>
    </div> : null}
    <div className={styles.reloadAction}>
      <button aria-label="重新載入結果" className="button button--secondary" disabled={loading || saving}
        onClick={() => void load()} type="button"><RotateCw aria-hidden="true" />重新載入結果</button>
    </div>
    <div aria-live="polite" className={styles.history}>
      <h3>歷次{externalAssessmentInstruments[instrumentKey]}結果 <span>{visibleRecords.length}</span></h3>
      {loading ? <p className={styles.muted}>載入中…</p> : error && visibleRecords.length === 0 ? null : visibleRecords.length === 0
        ? <p className={styles.muted}>尚無登錄紀錄</p>
        : <ul>{visibleRecords.map((record) => <li key={record.id}>
          <div className={styles.recordTitle}><strong>{externalAssessmentInstruments[record.instrumentKey]}</strong><time dateTime={record.assessedOn}>{record.assessedOn}</time></div>
          <p>{record.score === null ? "未登錄分數" : `外部結果 ${record.score}／${record.maximumScore}`} · {record.externalResult}</p>
          <small>{record.externalVersion} · {record.performedBy} · {record.source}</small>
          {record.followUpDueOn ? <small>追蹤：{record.followUpDueOn}{record.followUpNote ? ` · ${record.followUpNote}` : ""}</small> : null}
        </li>)}</ul>}
    </div>
  </section>;
}
