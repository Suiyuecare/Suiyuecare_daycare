"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, FileCheck2, LockKeyhole, UsersRound } from "lucide-react";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import { admissionPreparationInputSchema, admissionPreparationReceiptSchema,
  type AdmissionPreparationInput, type AdmissionPreparationSnapshot } from "@/lib/jubo-admission-preparation/contract";
import styles from "./intake.module.css";
import admissionStyles from "./jubo-admission-preparation.module.css";

type Operation = { key: string; body: AdmissionPreparationInput };
const decisionLabels = { approved: "核對通過", held: "待補資料", rejected: "退回" };

export function JuboAdmissionPreparation({ snapshot }: { snapshot: AdmissionPreparationSnapshot }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const operation = useRef<Operation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorScope, setErrorScope] = useState("");
  useProtectedCompletionDraft(dirty, busy, unknown);
  const locked = busy || unknown || confirmed;

  async function send(current: Operation) {
    setBusy(true); setMessage("");
    try {
      const response = await fetchWithTimeout("/api/jubo-admission-preparation", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "idempotency-key": current.key },
        body: JSON.stringify(current.body),
      });
      const envelope = await response.json() as { status?: string; data?: unknown; errors?: { message?: string }[] };
      const receipt = admissionPreparationReceiptSchema.safeParse(envelope.data);
      if (response.ok && envelope.status === "ok" && receipt.success) {
        operation.current = null; setUnknown(false); setDirty(false); setConfirmed(true);
        setMessage("proposalId" in receipt.data ? "已提交，請另一位主任核對。" : "已保存主任核對結果；尚未正式收案。");
        router.refresh();
      } else {
        const ambiguous = unknown || response.status >= 500 || response.ok || [408, 429].includes(response.status);
        setUnknown(ambiguous);
        if (!ambiguous) operation.current = null;
        setMessage(envelope.errors?.[0]?.message ?? (ambiguous ? "結果尚未確認，請重試同一次操作。" : "此次未完成，請核對資料後再送出。"));
      }
    } catch {
      setUnknown(true); setMessage("連線中斷，請保留畫面並重試同一次操作。");
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, proposal?: AdmissionPreparationSnapshot["proposals"][number]) {
    event.preventDefault();
    if (locked) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const raw = proposal ? { action: "review", clientId: snapshot.clientId, proposalId: proposal.id,
      expectedSha256: proposal.sha256, decision: data.get("decision"), reason: data.get("reason") }
      : { action: "propose", clientId: snapshot.clientId, clientRowVersion: snapshot.clientRowVersion,
        admittedOn: data.get("admittedOn"), eligibilityFrom: data.get("eligibilityFrom"), eligibilityTo: data.get("eligibilityTo"),
        eligibilityReference: data.get("eligibilityReference"), eligibilitySha256: data.get("eligibilitySha256"),
        agreementReference: data.get("agreementReference"), agreementSha256: data.get("agreementSha256"), reason: data.get("reason") };
    const parsed = admissionPreparationInputSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), "請補齊並核對此欄位。"]));
      setErrors(fields); setErrorScope(proposal ? `review-${proposal.id}` : "propose");
      setMessage("請補齊標示的欄位，收案日須在資格期間內。");
      const target = form.querySelector(`[name="${String(parsed.error.issues[0]?.path[0])}"]`);
      if (target instanceof HTMLElement) {
        target.closest("details")?.setAttribute("open", ""); target.focus();
      }
      return;
    }
    setErrors({});
    const current = { key: crypto.randomUUID(), body: parsed.data };
    operation.current = current;
    void send(current);
  }

  function field(name: string, label: string, type = "text", maxLength?: number, scope = "propose") {
    const error = scope === errorScope ? errors[name] : undefined;
    const errorId = `admission-${scope}-${name}-error`;
    return <div className={admissionStyles.field}><label>{label}<input name={name} type={type} required maxLength={maxLength}
      aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
      </label>{error && <small id={errorId} className={styles.errorHint}>{error}</small>}</div>;
  }

  return <section className={styles.workspace} aria-labelledby="jubo-admission-preparation-title" ref={root}>
    <div className={styles.panel}>
      <div className={styles.inline}><ClipboardCheck aria-hidden="true" size={24} /><h2 id="jubo-admission-preparation-title">收案核對</h2></div>
      <ol className={admissionStyles.progress} aria-label="收案核對進度">
        <li><span><FileCheck2 aria-hidden="true" size={18} /> 提交資料</span></li>
        <li><span><UsersRound aria-hidden="true" size={18} /> 主任覆核</span></li>
        <li><span><LockKeyhole aria-hidden="true" size={18} /> 文件驗證待啟用</span></li>
      </ol>
      <p className={styles.notice}>目前仍為待收案。核對通過不會開放出勤、給藥、排車或申報。</p>
      <details><summary>為何還不能正式收案？</summary>
        <p>資格證明與已簽服務契約，尚無可核驗的文件來源。填入編號與 SHA-256 只保存核對聲明，不代表系統已確認文件存在或效力。已保存的核對內容不可改寫；變更資料請重新提交新版本。</p>
      </details>
      {message && <p role={confirmed ? "status" : "alert"} className={confirmed ? styles.notice : styles.error}>{message}</p>}
      {unknown && <button className="button" type="button" disabled={busy} onClick={() => {
        if (operation.current) void send(operation.current);
      }}>{busy ? "確認中…" : "重試同一次操作"}</button>}
      {confirmed && <button className="button secondary" type="button" onClick={() => router.refresh()}>更新核對清單</button>}
    </div>

    {snapshot.proposals.length > 0 && <div className={styles.panel}>
      <h3>核對紀錄</h3>
      {snapshot.proposals.map(proposal => <article key={proposal.id} className={styles.sourceCard}>
        <div className={styles.inline}><strong>第 {proposal.version} 版 · 收案日 {proposal.admittedOn}</strong>
          <span className={styles.badge}>{proposal.reviewDecision ? decisionLabels[proposal.reviewDecision] : "待主任核對"}</span></div>
        <p>資格期間：{proposal.eligibilityFrom} — {proposal.eligibilityTo}</p>
        <p>核對依據：{proposal.reason}</p>
        {proposal.reviewReason && <p>主任意見：{proposal.reviewReason}</p>}
        <details><summary>查看文件識別</summary>
          <p>資格證明：{proposal.eligibilityReference}</p><p>SHA-256：{proposal.eligibilitySha256}</p>
          <p>服務契約：{proposal.agreementReference}</p><p>SHA-256：{proposal.agreementSha256}</p>
        </details>
        {proposal.canReview ? <form className={styles.form} method="post" action="/api/jubo-admission-preparation" noValidate onChange={() => setDirty(true)} onSubmit={event => submit(event, proposal)}>
          <fieldset disabled={locked}><legend>主任獨立核對</legend>
            <div className={admissionStyles.choices}>{(["approved", "held", "rejected"] as const).map(decision =>
              <label className={styles.confirm} key={decision}><input type="radio" name="decision" value={decision} required />{decisionLabels[decision]}</label>)}</div>
            {errorScope === `review-${proposal.id}` && errors.decision && <p className={styles.errorHint}>{errors.decision}</p>}
            {field("reason", "核對意見（至少 10 字）", "text", 1000, `review-${proposal.id}`)}
          </fieldset>
          <button type="submit" className="button" disabled={locked}>{busy ? "保存中…" : "保存主任核對"}</button>
        </form> : !proposal.reviewDecision && <p>{proposal.ownProposal ? "請另一位有權限的主任覆核。" : "此版已過期或目前無覆核權限，請核對最新資料。"}</p>}
      </article>)}
    </div>}

    {snapshot.canSubmit ? <form className={`${styles.panel} ${styles.form}`} method="post" action="/api/jubo-admission-preparation" noValidate onChange={() => setDirty(true)} onSubmit={event => submit(event)}>
      <h3>{snapshot.proposals.length ? "重新提交核對" : "提交收案資料"}</h3>
      <fieldset disabled={locked}><legend>收案日與資格</legend>
        <div className={styles.grid}>
          {field("admittedOn", "已核對的收案日期", "date")}
          {field("eligibilityReference", "資格證明編號／文件位置", "text", 240)}
          {field("eligibilityFrom", "資格有效起日", "date")}{field("eligibilityTo", "資格有效迄日", "date")}
          {field("agreementReference", "已簽服務契約編號／文件位置", "text", 240)}
          {field("reason", "核對依據（至少 10 字）", "text", 1000)}
        </div>
        <details><summary>文件 SHA-256（必填）</summary><div className={styles.grid}>
          {field("eligibilitySha256", "資格證明 SHA-256", "text", 64)}
          {field("agreementSha256", "服務契約 SHA-256", "text", 64)}
        </div></details>
      </fieldset>
      <div className={styles.inline}><button type="submit" className="button" disabled={locked}>{busy ? "提交中…" : "提交給主任核對"}</button>
        <small>提交及覆核需要最近 15 分鐘內的身分驗證。</small></div>
    </form> : <p className={styles.notice}>原始清冊狀態為「{snapshot.sourceStatus}」，請先核對來源狀態；目前不可提交收案。</p>}
  </section>;
}
