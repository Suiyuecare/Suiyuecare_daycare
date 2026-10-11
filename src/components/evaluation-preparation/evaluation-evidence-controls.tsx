"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Download, Files } from "lucide-react";
import { evaluationEvidenceActionReceiptSchema, type EvaluationEvidenceAction, type EvaluationPreparationSnapshot } from "@/lib/evaluation-preparation/contract";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import { beginEvidenceOperation, evidenceSnapshotCurrent, markEvidenceOperationUnknown, retryEvidenceOperation,
  settleEvidenceOperation, useHeldEvidenceOperation, useLostEvidenceOperation } from "./evaluation-evidence-pending";

export function EvaluationEvidenceControls({ snapshot, actorUserId }: { snapshot: EvaluationPreparationSnapshot; actorUserId: string }) {
  const router = useRouter();
  const held = useHeldEvidenceOperation();
  const pending = held?.operation ?? null;
  const busy = held?.phase === "busy";
  const lost = useLostEvidenceOperation();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reasons, setReasons] = useState<Record<string, "evidence_missing" | "source_not_verified" | "incomplete">>({});
  const mounted = useRef(false);
  const lock = useRef(false);
  const register = useScopeChangeDraftRegistration();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { register({ dirty: false, busy, unknown: !!pending || lost }); }, [register, busy, pending, lost]);
  useEffect(() => {
    if (!pending && !lost) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [pending, lost]);

  async function execute(input: EvaluationEvidenceAction, retry = false) {
    if (lock.current || lost || snapshot.demo || !navigator.onLine) return;
    if (!evidenceSnapshotCurrent(snapshot.staleAfter) && !retry) { setError("資料已過期，請重新載入後覆核。"); return; }
    if (retry && (!pending || pending.organizationId !== snapshot.organizationId || pending.branchId !== snapshot.branchId || pending.actorUserId !== actorUserId)) { setError("請回原分支與帳號核對操作。"); return; }
    const operation = retry ? pending : beginEvidenceOperation({ input, organizationId: snapshot.organizationId, branchId: snapshot.branchId, actorUserId });
    if (!operation || (retry && !retryEvidenceOperation(operation))) { setError("還有另一項操作未完成，請先核對。"); return; }
    lock.current = true; setError(""); setMessage("");
    const settle = () => settleEvidenceOperation(operation);
    try {
      const response = await fetch("/api/evaluation-preparation/evidence", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "idempotency-key": operation.input.idempotency_key }, body: JSON.stringify(operation.input) });
      const body: unknown = await response.json();
      const envelope = body as { status?: string; data?: unknown; errors?: { code?: string; message?: string }[] };
      if (!response.ok) {
        const code = envelope.errors?.[0]?.code;
        if (!retry && ["EVIDENCE_NOT_AUTHORIZED", "INVALID_EVIDENCE_ACTION", "EVIDENCE_VERSION_CHANGED", "EVIDENCE_KEY_CONFLICT", "EVIDENCE_INCOMPLETE", "AAL2_REQUIRED", "AUTH_REQUIRED"].includes(code ?? "")) settle();
        else markEvidenceOperationUnknown(operation);
        if (mounted.current) setError(retry ? "原操作結果仍未確認；請保留同一操作重試。" : envelope.errors?.[0]?.message ?? "結果尚未確認，請用原操作重試。");
        return;
      }
      const receipt = evaluationEvidenceActionReceiptSchema.safeParse(envelope.data);
      const action = operation.input;
      if (envelope.status !== "ok" || !receipt.success || receipt.data.organizationId !== operation.organizationId || receipt.data.branchId !== operation.branchId ||
        receipt.data.actorUserId !== operation.actorUserId || receipt.data.idempotencyKey !== action.idempotency_key ||
        (action.action === "review" ? receipt.data.versionId !== action.versionId || receipt.data.decision !== action.decision || !receipt.data.reviewId : receipt.data.hash !== action.expectedHash || !receipt.data.bundleId)) {
        markEvidenceOperationUnknown(operation); if (mounted.current) setError("回執無法核對；請用原操作重試。"); return;
      }
      settle();
      if (mounted.current) { setMessage(action.action === "bundle" ? "已建立不可變證據清冊；未送交主管機關。" : "覆核結果已保存。"); router.refresh(); }
    } catch { markEvidenceOperationUnknown(operation); if (mounted.current) setError("連線中斷，結果尚未確認；請用原操作重試。"); }
    finally { lock.current = false; }
  }

  const reviews = new Map(snapshot.reviews.map((review) => [review.versionId, review]));
  const disable = snapshot.demo || busy || !!pending || lost;
  return <section className="panel" aria-labelledby="evidence-review-heading"><div className="panel__header"><div><h2 id="evidence-review-heading"><CheckCheck aria-hidden="true" /> 證據覆核</h2><p>獨立覆核 {snapshot.approvedTotal}／{snapshot.total} 項</p></div></div><div className="panel__body">
    {snapshot.items.filter((item) => item.progress === "internal_review_requested").map((item) => {
      const review = reviews.get(item.versionId);
      const independent = actorUserId !== item.recordedBy && actorUserId !== item.ownerUserId;
      return <article key={item.versionId} className="record-card"><h3>{item.itemCode} · 第 {item.version} 版</h3>{review ? <p>{review.decision === "approved" ? "已由另一人覆核通過" : "需補件，請修訂新版本"} · {formatCareTaipeiTime(review.reviewedAt)}</p> : !independent ? <p>請由另一位主管覆核。</p> : <div className="page-heading__actions"><button className="button button--primary" type="button" disabled={disable} onClick={() => void execute({ action: "review", versionId: item.versionId, decision: "approved", reasonCode: "review_complete", idempotency_key: crypto.randomUUID() })}>確認證據並通過</button><label className="field field--compact"><span>退回原因</span><select value={reasons[item.versionId] ?? "incomplete"} disabled={disable} onChange={(event) => setReasons({ ...reasons, [item.versionId]: event.target.value as "incomplete" })}><option value="incomplete">資料未完整</option><option value="evidence_missing">缺少證據</option><option value="source_not_verified">來源待核對</option></select></label><button className="button button--secondary" type="button" disabled={disable} onClick={() => void execute({ action: "review", versionId: item.versionId, decision: "needs_changes", reasonCode: reasons[item.versionId] ?? "incomplete", idempotency_key: crypto.randomUUID() })}>退回補件</button></div>}</article>;
    })}
    {!snapshot.items.some((item) => item.progress === "internal_review_requested") && <p>項目送出內部覆核後，會顯示在這裡。</p>}
    <div className="page-heading__actions"><button className="button button--primary" disabled={disable || !snapshot.collectionHash || snapshot.total === 0 || snapshot.approvedTotal !== snapshot.total} type="button" onClick={() => snapshot.collectionHash && void execute({ action: "bundle", expectedHash: snapshot.collectionHash, idempotency_key: crypto.randomUUID() })}><Files aria-hidden="true" />固定已覆核證據清冊</button></div>
    {pending && <p role="status">{busy ? "正在核對原操作…" : "原操作結果尚未確認。"}{!busy && <button className="button button--secondary" type="button" onClick={() => void execute(pending.input, true)}>核對並重試原操作</button>}</p>}
    {lost && <p role="alert">前次操作結果尚未確認，請主管核對原回執；目前不能建立新操作。</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!!snapshot.bundles.length && <ul>{snapshot.bundles.map((bundle) => <li key={bundle.id}><a className="button button--secondary" href={`/api/evaluation-preparation/evidence/export?bundle=${bundle.id}`}><Download aria-hidden="true" />{formatCareTaipeiTime(bundle.createdAt)} · {bundle.itemCount} 項 · 清冊下載</a></li>)}</ul>}
    <details><summary>證據與保存規則</summary><p>通過覆核前，會驗證分支、文件快照或掃毒合格附件、來源版本與內容雜湊。本人不能覆核自己負責或建立的項目。固定清冊保存當時版本與附件雜湊，不會隨來源更動；此功能不是官方送件。</p></details>
  </div></section>;
}
