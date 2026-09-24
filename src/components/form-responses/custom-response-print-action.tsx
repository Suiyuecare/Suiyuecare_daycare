"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import type { ResponseRecord } from "@/lib/custom-form-responses/contract";
import { parsePrintJob, type CustomResponsePrintJob } from "@/lib/custom-form-responses/print-contract";
import { customResponsePrintModel } from "@/lib/custom-form-responses/print-model";
import styles from "./form-responses.module.css";

export type PrintActor = { actorId: string; organizationId: string; branchId: string };
const replySchema = z.object({ requestId: z.uuid(), status: z.literal("ok"), errors: z.tuple([]), data: z.object({ job: z.unknown(), downloadUrl: z.string().max(2500), persisted: z.literal(true), demo: z.literal(false) }).strict() }).strict();
const errorSchema = z.object({ requestId: z.uuid(), status: z.literal("error"), data: z.null(), errors: z.array(z.object({ code: z.string(), message: z.string(), field: z.string().optional() }).strict()).min(1) }).strict();
const nonCommits = new Set(["INVALID_CUSTOM_PRINT", "CUSTOM_PRINT_FORBIDDEN", "CUSTOM_PRINT_CONFLICT", "AUTH_REQUIRED", "AAL2_REQUIRED", "BRANCH_CONTEXT_REQUIRED", "REQUEST_TOO_LARGE", "INVALID_JSON", "CUSTOM_PRINT_SIGNING_NOT_CONFIGURED"]);

function validDownloadUrl(value: string, jobId: string) {
  const prefix = `/api/forms/responses/prints/${jobId}/pdf?token=`;
  return value.startsWith(prefix) && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value.slice(prefix.length));
}

export function CustomResponsePrintAction({ record, actor, canPrint, blocked, dirty, demo = false, onBusyChange }: {
  record: ResponseRecord; actor?: PrintActor; canPrint: boolean; blocked: boolean; dirty: boolean; demo?: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const guard = useCoreDraftGuard();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{ job: CustomResponsePrintJob; url: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const lease = useRef<(() => void) | null>(null);
  const attempt = useRef<{ key: string; body: string; record: ResponseRecord; actor: PrintActor; ambiguous: boolean } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (!attempt.current) { lease.current?.(); lease.current = null; } }; }, []);
  useEffect(() => {
    if (!prepared) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(prepared.job.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [prepared]);
  function release() {
    lease.current?.(); lease.current = null; attempt.current = null;
    guard.finish(); guard.saved();
  }
  async function prepare() {
    if (lock.current || demo || (!attempt.current && (blocked || dirty || !canPrint || !actor))) return;
    if (!attempt.current) {
      const releaseLease = tryAcquirePendingOperation();
      if (!releaseLease) { setError("畫面正在更新或切換分支，請稍候再準備列印。"); return; }
      lease.current = releaseLease;
      try {
        attempt.current = { key: crypto.randomUUID(), body: JSON.stringify({ clientId: record.clientId, responseId: record.id }), record: structuredClone(record), actor: { ...actor! }, ambiguous: false };
      } catch { release(); setError("尚未送出列印準備，請重新操作。"); return; }
      guard.begin();
    }
    const operation = attempt.current;
    lock.current = true; setBusy(true); setError(""); onBusyChange(true);
    try {
      const response = await fetchWithTimeout("/api/forms/responses/prints", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: operation.body });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = errorSchema.safeParse(raw);
        const code = failure.success ? failure.data.errors[0]!.code : "";
        // Expiration is terminal even after an unknown result: the original
        // snapshot cannot be downloaded and retry never extends its lifetime.
        if (failure.success && ((response.status === 410 && code === "CUSTOM_PRINT_EXPIRED") || (!operation.ambiguous && [400,401,403,409,413,503].includes(response.status) && nonCommits.has(code)))) {
          release(); if (mounted.current) { setUncertain(false); setError(failure.data.errors[0]!.message); onBusyChange(false); } return;
        }
        throw new Error("結果未確認");
      }
      const body = replySchema.parse(raw).data;
      const job = parsePrintJob(body.job, { ...operation.actor, clientId: operation.record.clientId, responseId: operation.record.id }, operation.record);
      if (response.status !== (job.replayed ? 200 : 201) || !validDownloadUrl(body.downloadUrl, job.jobId)) throw new Error("回條不一致");
      customResponsePrintModel(job); // Reject malformed render data before success.
      release();
      if (!mounted.current) return;
      setUncertain(false); setPrepared({ job, url: body.downloadUrl }); setExpired(Date.parse(job.expiresAt) <= Date.now()); onBusyChange(false);
    } catch {
      operation.ambiguous = true;
      if (mounted.current) { setUncertain(true); setError("列印準備結果尚未確認。請核對並重試原列印操作，不要另建重複工作。"); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const model = useMemo(() => prepared ? customResponsePrintModel(prepared.job) : null, [prepared]);
  return <section className={styles.printPanel} aria-label="保存版本列印">
    <h3>保存版本列印</h3><p>預覽與 PDF 使用同一份已保存快照。草稿會清楚標示「未簽署」；不會包含尚未儲存的輸入。</p>
    <button type="button" className="button button--secondary" disabled={busy || demo || (!uncertain && (blocked || dirty || !canPrint || !actor))} onClick={() => void prepare()}>
      {uncertain ? "核對並重試原列印操作" : busy ? "正在準備列印…" : prepared ? "重新準備列印快照" : "預覽／準備 PDF"}
    </button>
    {dirty && <p>請先儲存或捨棄未儲存內容，再準備列印。</p>}
    {!canPrint && !demo && <p>需要文件輸出權限與近期身分確認；請由主管確認授權。</p>}
    {demo && <p>合成展示不會建立正式列印工作或下載個案文件。</p>}
    {busy && <p role="status">正在核對保存版本，請稍候…</p>}
    {error && <p role="alert">{error}</p>}
    {model && <div className={styles.printPreview} aria-label="已保存文件預覽">
      <h4>{model.title}</h4><p>{model.organization.branchName}・{model.client.displayName}（{model.client.clientCode}）</p>
      <p>{model.documentDate}・表單第 {model.template.version} 版／紀錄第 {prepared!.job.snapshot.response.revision} 版・{model.watermark}</p>
      <p role="status">已準備保存版本的列印快照。{expired ? "下載連結已過期，請重新準備。" : "連結建立後 5 分鐘內有效，限目前帳號使用。"}</p>
      {!expired && !busy && !uncertain && <a className="button button--primary" href={prepared!.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">下載此版本 PDF</a>}
      {model.sections.map((section, index) => {
        const rows = <dl>{section.rows.map((row, rowIndex) => <div key={`${index}-${rowIndex}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
        return index === 1 ? <section key={section.heading}><h4>{section.heading}</h4>{rows}</section> : <details key={section.heading}><summary>{section.heading}</summary>{rows}</details>;
      })}
      <p>{model.footerNote}</p>
    </div>}
  </section>;
}
