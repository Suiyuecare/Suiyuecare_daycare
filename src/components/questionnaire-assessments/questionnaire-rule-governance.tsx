"use client";

import { CheckCircle2, ClipboardCheck, Clock3 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import type { QuestionnaireGovernanceSnapshot } from "@/lib/questionnaire-assessments/governance";
import styles from "./questionnaire-assessments.module.css";

export function QuestionnaireRuleGovernance({ snapshot }: { snapshot: QuestionnaireGovernanceSnapshot | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  const operation = useRef<{ key: string; body: string } | null>(null);
  const register = useScopeChangeDraftRegistration();
  useLayoutEffect(() => { register({ dirty: false, busy, unknown }); }, [register, busy, unknown]);

  async function send(input?: Record<string, unknown>) {
    if (busy || (!input && !operation.current)) return;
    if (!operation.current && input) operation.current = { key: crypto.randomUUID(), body: JSON.stringify(input) };
    const current = operation.current!;
    setBusy(true); setMessage("");
    try {
      const response = await fetchWithTimeout("/api/questionnaire-assessments/rules", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": current.key }, body: current.body,
      });
      const envelope = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status) && !unknown && envelope.status === "error") {
          operation.current = null; setUnknown(false);
        } else setUnknown(true);
        setMessage(envelope.errors?.[0]?.message ?? "發布未完成，請保留畫面重試。");
        return;
      }
      if (!envelope.data?.publicationId || !["pending", "approved"].includes(envelope.data.status)) throw new Error("invalid receipt");
      operation.current = null; setUnknown(false);
      setMessage(envelope.data.status === "approved" ? "規則已由第二人覆核發布。" : "已送出，請另一位治理人員覆核。");
      router.refresh();
    } catch { setUnknown(true); setMessage("結果尚未確認，請重試同一次操作。"); }
    finally { setBusy(false); }
  }

  if (!snapshot) return <section className="empty-card" role="alert"><h2>量表規則暫時無法載入</h2><a className="button button--secondary" href="?">重試</a></section>;
  return <section className={styles.formPanel} aria-labelledby="questionnaire-rules-title">
    <header className="page-heading"><div><h2 id="questionnaire-rules-title"><ClipboardCheck aria-hidden="true" size={24} /> 量表規則發布</h2><p>提案 → 第二人覆核 → 依生效日簽署</p></div></header>
    <form onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const catalog = snapshot.catalogue.find((entry) => entry.formKey === values.get("form"));
      if (!catalog) return;
      void send({ action: "request", formKey: catalog.formKey, formVersion: catalog.formVersion,
        effectiveFrom: values.get("from"), ...(values.get("to") ? { effectiveTo: values.get("to") } : {}), evidenceReference: values.get("evidence") });
    }}>
      <fieldset className={styles.measurements} disabled={busy || unknown}>
        <legend>新增發布提案</legend>
        <label>量表<select name="form" required>{snapshot.catalogue.map((form) => <option key={form.formKey} value={form.formKey}>{form.title}（{form.questionCount} 題）</option>)}</select></label>
        <label>生效日<input type="date" name="from" required /></label>
        <label>終止日（選填）<input type="date" name="to" /></label>
        <label>審查／授權文件編號<input name="evidence" maxLength={300} required placeholder="已完成內容及公式審查的文件編號" /></label>
        <button className="button button--primary" type="submit">{busy ? "處理中…" : "送出提案"}</button>
      </fieldset>
    </form>
    <a className="button button--secondary" href="/auth/mfa?next=%2Fapp%2Fstaff%2Fgovernance%2Fform-rule-versions">完成近期驗證</a>
    {unknown ? <button className="button button--primary" disabled={busy} onClick={() => void send()} type="button">重試同一次操作</button> : null}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
    <div className={styles.questions}>{snapshot.publications.map((publication) => <article className={styles.questionCard} key={publication.publicationId}>
      <div className={styles.questionHeading}><h3>{snapshot.catalogue.find((form) => form.formKey === publication.formKey)?.title ?? publication.formKey}</h3>
        <span>{publication.status === "approved" ? <CheckCircle2 aria-hidden="true" size={18} /> : <Clock3 aria-hidden="true" size={18} />} {publication.status === "approved" ? "已發布" : "待第二人覆核"}</span></div>
      <p>{publication.effectiveFrom} 起{publication.effectiveTo ? `，至 ${publication.effectiveTo}` : ""} · 提案：{publication.requestedName}{publication.approvedName ? ` · 覆核：${publication.approvedName}` : ""}</p>
      <details><summary>規則與文件</summary><p>{publication.formVersion}</p><p>{publication.evidenceReference}</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.catalogue.find((form) => form.formKey === publication.formKey)?.rule, null, 2)}</pre></details>
      {publication.canApprove ? <button className="button button--primary" type="button" disabled={busy || unknown}
        onClick={() => void send({ action: "approve", publicationId: publication.publicationId })}>核對公式、題目與文件後發布</button> : null}
    </article>)}</div>
    {!snapshot.publications.length ? <p>尚無提案；評估仍可填寫、保存與送審。</p> : null}
  </section>;
}
