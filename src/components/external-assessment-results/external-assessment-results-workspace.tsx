"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, Plus, RotateCw } from "lucide-react";

import {
  externalAssessmentInstruments,
  externalAssessmentResultInputSchema,
  externalAssessmentResultRecordSchema,
  parseExternalAssessmentResultsSnapshot,
  type ExternalAssessmentInstrument,
  type ExternalAssessmentResultRecord,
} from "@/lib/external-assessment-results/contract";

import styles from "./external-assessment-results-workspace.module.css";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

export function ExternalAssessmentResultsWorkspace({
  clientId,
  initialInstrument,
  canWrite,
}: {
  clientId: string;
  initialInstrument: ExternalAssessmentInstrument | null;
  canWrite: boolean;
}) {
  const [instrumentKey, setInstrumentKey] = useState<ExternalAssessmentInstrument>(initialInstrument ?? "barthel_adl");
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

  const instrumentOptions = useMemo(() => Object.entries(externalAssessmentInstruments) as [ExternalAssessmentInstrument, string][], []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/external-assessment-results?clientId=${encodeURIComponent(clientId)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("data" in body)) throw new Error("LOAD_FAILED");
      const parsed = (body as { data: { snapshot: unknown } }).data;
      const snapshot = parseExternalAssessmentResultsSnapshot(parsed.snapshot, clientId);
      setRecords(snapshot.records);
    } catch {
      setError("結果清單暫時無法載入，請重試。");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setSaving(true);
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/external-assessment-results", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ clientId, input: input.data }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("data" in body)) throw new Error("SAVE_FAILED");
      const record = externalAssessmentResultRecordSchema.parse((body as { data: { record: unknown } }).data.record);
      if (record.clientId !== clientId) throw new Error("SCOPE_MISMATCH");
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
      setError("儲存結果尚未確認。請先重新載入清單，確認是否已有紀錄，再決定是否重送。");
    } finally {
      setSaving(false);
    }
  }

  return <section aria-labelledby="external-results-title" className={styles.panel} id="external-result-entry">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>紙本／外部評估</p><h2 id="external-results-title">登錄評估結果</h2></div>
      <span className={styles.badge}>不計分</span>
    </header>
    <p className={styles.intro}>先在核准的紙本或外部工具完成評估，再照原結果登錄。這裡不提供題目、自動計分、診斷或照顧決策。</p>
    {canWrite ? <form className={styles.form} onSubmit={submit}>
      <label>量表／評估工具
        <select onChange={(event) => setInstrumentKey(event.target.value as ExternalAssessmentInstrument)} value={instrumentKey}>
          {instrumentOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label>外部題本／版本
        <input maxLength={80} onChange={(event) => setExternalVersion(event.target.value)} required value={externalVersion} />
      </label>
      <label>評估日期
        <input max={today} onChange={(event) => setAssessedOn(event.target.value)} required type="date" value={assessedOn} />
      </label>
      <div className={styles.scoreFields}>
        <label>外部分數（選填）
          <input inputMode="decimal" min="0" onChange={(event) => setScore(event.target.value)} step="0.01" type="number" value={score} />
        </label>
        <label>滿分（與分數一起填）
          <input inputMode="decimal" min="0.01" onChange={(event) => setMaximumScore(event.target.value)} step="0.01" type="number" value={maximumScore} />
        </label>
      </div>
      <label className={styles.wide}>原量表結果／判讀摘要
        <textarea maxLength={500} onChange={(event) => setExternalResult(event.target.value)} required rows={2} value={externalResult} />
      </label>
      <label>執行者
        <input maxLength={120} onChange={(event) => setPerformedBy(event.target.value)} required value={performedBy} />
      </label>
      <label>來源／機構
        <input maxLength={120} onChange={(event) => setSource(event.target.value)} required value={source} />
      </label>
      <label>人工追蹤日期（選填）
        <input onChange={(event) => setFollowUpDueOn(event.target.value)} type="date" value={followUpDueOn} />
      </label>
      <label className={styles.wide}>追蹤事項（選填）
        <textarea maxLength={500} onChange={(event) => setFollowUpNote(event.target.value)} rows={2} value={followUpNote} />
      </label>
      <p className={styles.caution}><AlertTriangle aria-hidden="true" />登錄為未簽署的外部結果，不會自動建立風險分類或照顧決策。</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.success} role="status"><Check aria-hidden="true" />{notice}</p> : null}
      <div className={styles.actions}>
        <button className="button button--primary" disabled={saving} type="submit">
          {saving ? <LoaderCircle aria-hidden="true" className={styles.spinning} /> : <Plus aria-hidden="true" />}
          {saving ? "儲存中" : "儲存結果"}
        </button>
        <button aria-label="重新載入結果" className="button button--secondary" disabled={loading} onClick={() => void load()} type="button">
          <RotateCw aria-hidden="true" />重新載入
        </button>
      </div>
    </form> : <p className={styles.intro}>目前帳號只有查閱權限；如需登錄，請聯絡機構管理員開通日常照顧紀錄權限。</p>}
    <div aria-live="polite" className={styles.history}>
      <h3>歷次外部結果 <span>{records.length}</span></h3>
      {loading ? <p className={styles.muted}>載入中…</p> : error && records.length === 0 ? null : records.length === 0
        ? <p className={styles.muted}>尚無登錄紀錄</p>
        : <ul>{records.map((record) => <li key={record.id}>
          <div className={styles.recordTitle}><strong>{externalAssessmentInstruments[record.instrumentKey]}</strong><time dateTime={record.assessedOn}>{record.assessedOn}</time></div>
          <p>{record.score === null ? "未登錄分數" : `外部結果 ${record.score}／${record.maximumScore}`} · {record.externalResult}</p>
          <small>{record.externalVersion} · {record.performedBy} · {record.source}</small>
          {record.followUpDueOn ? <small>追蹤：{record.followUpDueOn}{record.followUpNote ? ` · ${record.followUpNote}` : ""}</small> : null}
        </li>)}</ul>}
    </div>
  </section>;
}
