"use client";

import { CheckCircle2, ClipboardCheck, Clock3 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import { readQuestionnairePublicationReceipt } from "@/lib/questionnaire-assessments/receipt";
import { questionnairePublicationInputSchema, type QuestionnaireGovernanceSnapshot } from "@/lib/questionnaire-assessments/governance";
import styles from "./questionnaire-assessments.module.css";

export function QuestionnaireRuleGovernance({ snapshot }: { snapshot: QuestionnaireGovernanceSnapshot | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const operation = useRef<{ key: string; body: string } | null>(null);
  const holdNavigation = useCallback((reason: "dirty" | "busy" | "unknown") => setMessage(reason === "unknown"
    ? "發布結果尚未確認；請保留原頁，必要時在新分頁完成近期驗證後，回來重試同一次操作。"
    : reason === "busy" ? "正在處理發布，請稍候再離開。"
      : "有未送出的發布內容；請先送出提案或清除未送出內容，再離開此頁。"), []);
  useProtectedCompletionDraft(dirty, busy, unknown, holdNavigation);

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
      const input = JSON.parse(current.body) as { action: "request" } | { action: "approve"; publicationId: string };
      const receipt = readQuestionnairePublicationReceipt(envelope.data, input);
      if (envelope.status !== "ok" || !receipt) throw new Error("invalid receipt");
      operation.current = null; setUnknown(false);
      if (input.action === "request") { formRef.current?.reset(); setDirty(false); setFieldErrors({}); }
      setMessage(receipt.status === "approved" ? "規則已由第二人覆核發布。" : "已送出，請另一位治理人員覆核。");
      router.refresh();
    } catch { setUnknown(true); setMessage("結果尚未確認，請重試同一次操作。"); }
    finally { setBusy(false); }
  }

  if (!snapshot) return <section className="empty-card" role="alert"><h2>量表規則暫時無法載入</h2><a className="button button--secondary" href="?">重試</a></section>;
  return <section className={styles.formPanel} aria-labelledby="questionnaire-rules-title">
    <header className="page-heading"><div><h2 id="questionnaire-rules-title"><ClipboardCheck aria-hidden="true" size={24} /> 量表規則發布</h2><p>提案 → 第二人覆核 → 依生效日簽署</p></div></header>
    <form noValidate ref={formRef} onChange={() => { setDirty(true); setFieldErrors({}); }} onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const catalog = snapshot.catalogue.find((entry) => entry.formKey === values.get("form"));
      if (!catalog) return;
      const input = questionnairePublicationInputSchema.safeParse({ action: "request", formKey: catalog.formKey, formVersion: catalog.formVersion,
        effectiveFrom: values.get("from"), ...(values.get("to") ? { effectiveTo: values.get("to") } : {}), evidenceReference: values.get("evidence") });
      if (!input.success) {
        setFieldErrors(Object.fromEntries(input.error.issues.map(issue => [String(issue.path[0]), issue.path[0] === "effectiveTo" ? "終止日不可早於生效日。" : "請填寫並核對此欄位。"])));
        setMessage("請核對標示的發布欄位。");
        const name = ({ effectiveFrom: "from", effectiveTo: "to", evidenceReference: "evidence" } as Record<string, string>)[String(input.error.issues[0]?.path[0])];
        if (name) (event.currentTarget.elements.namedItem(name) as HTMLElement | null)?.focus();
        return;
      }
      setFieldErrors({}); void send(input.data);
    }}>
      <fieldset className={styles.measurements} disabled={busy || unknown}>
        <legend>新增發布提案</legend>
        <label>量表<select name="form" required>{snapshot.catalogue.map((form) => <option key={form.formKey} value={form.formKey}>{form.title}（{form.questionCount} 題）</option>)}</select></label>
        <div><label>生效日<input type="date" name="from" required aria-invalid={!!fieldErrors.effectiveFrom} aria-describedby={fieldErrors.effectiveFrom ? "rule-from-error" : undefined} /></label>
          {fieldErrors.effectiveFrom ? <span id="rule-from-error" className={styles.fieldError}>{fieldErrors.effectiveFrom}</span> : null}</div>
        <div><label>終止日（選填）<input type="date" name="to" aria-invalid={!!fieldErrors.effectiveTo} aria-describedby={fieldErrors.effectiveTo ? "rule-to-error" : undefined} /></label>
          {fieldErrors.effectiveTo ? <span id="rule-to-error" className={styles.fieldError}>{fieldErrors.effectiveTo}</span> : null}</div>
        <div><label>審查／授權文件編號<input name="evidence" maxLength={300} required placeholder="已完成內容及公式審查的文件編號" aria-invalid={!!fieldErrors.evidenceReference} aria-describedby={fieldErrors.evidenceReference ? "rule-evidence-error" : undefined} /></label>
          {fieldErrors.evidenceReference ? <span id="rule-evidence-error" className={styles.fieldError}>{fieldErrors.evidenceReference}</span> : null}</div>
        <button className="button button--primary" type="submit">{busy ? "處理中…" : "送出提案"}</button>
      </fieldset>
    </form>
    {dirty && !busy && !unknown ? <button className="button button--secondary" type="button" onClick={() => {
      formRef.current?.reset(); setDirty(false); setMessage(""); setFieldErrors({});
    }}>清除未送出內容</button> : null}
    <a className="button button--secondary" href="/auth/mfa?next=%2Fapp%2Fstaff%2Fgovernance%2Fform-rule-versions" target="_blank" rel="noopener noreferrer">在新分頁完成近期驗證</a>
    {dirty || unknown ? <p>保留此頁的輸入，在新分頁完成驗證後返回；結果未確認時，使用「重試同一次操作」。</p> : null}
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
