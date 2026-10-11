"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ClipboardCheck, Download, Droplets, Scale, TriangleAlert } from "lucide-react";
import { qualityMetricLabels, qualityFreezeReceiptSchema, type QualityMonthlySnapshot } from "@/lib/quality-monthly/contract";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import { beginQualityOperation, markQualityOperationUnknown, retryQualityOperation, settleQualityOperation,
  useHeldQualityOperation, useLostQualityOperation } from "./quality-monthly-pending";
import { QualityMetricDetails } from "./quality-metric-details";

export function QualityMonthlyWorkspace({ snapshot, month, actorUserId, canExport = false }: {
  snapshot: QualityMonthlySnapshot | null; month: string; actorUserId: string; canExport?: boolean;
}) {
  const router = useRouter();
  const held = useHeldQualityOperation();
  const pending = held?.operation ?? null;
  const busy = held?.phase === "busy";
  const lost = useLostQualityOperation();
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const register = useScopeChangeDraftRegistration();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { register({ dirty: false, busy, unknown: !!pending || lost }); }, [register, busy, pending, lost]);
  useEffect(() => {
    const check = () => setOffline(!navigator.onLine);
    check(); window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, []);
  useEffect(() => {
    if (!pending && !lost) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [pending, lost]);

  async function freeze(retry = false) {
    if (!snapshot || !canExport || offline || lock.current || lost) return;
    if (retry && (!pending || pending.organizationId !== snapshot.organizationId || pending.branchId !== snapshot.branchId ||
      pending.actorUserId !== actorUserId || pending.input.month !== snapshot.month)) { setError("請回原分支、月份與帳號核對操作。"); return; }
    const operation = retry ? pending : beginQualityOperation({ input: { month: snapshot.month, expectedHash: snapshot.hash, idempotency_key: crypto.randomUUID() },
      organizationId: snapshot.organizationId, branchId: snapshot.branchId, actorUserId });
    if (!operation || (retry && !retryQualityOperation(operation))) { setError("還有另一項操作未完成，請先核對。"); return; }
    lock.current = true; setError("");
    try {
      const response = await fetch("/api/quality-monthly", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "idempotency-key": operation.input.idempotency_key }, body: JSON.stringify(operation.input) });
      const envelope: unknown = await response.json();
      const value = envelope as { status?: string; data?: unknown; errors?: { code?: string; message?: string }[] };
      if (!response.ok) {
        const code = value.errors?.[0]?.code;
        // Only a structured, confirmed refusal settles an operation. A gateway timeout is unknown.
        if (!retry && value.status === "error" && ["QUALITY_MONTHLY_CHANGED", "QUALITY_MONTHLY_NOT_AUTHORIZED", "QUALITY_MONTHLY_KEY_CONFLICT", "INVALID_QUALITY_FREEZE", "AAL2_REQUIRED", "AUTH_REQUIRED"].includes(code ?? "")) settleQualityOperation(operation);
        else markQualityOperationUnknown(operation);
        if (mounted.current) setError(retry ? "原操作結果仍未確認；請保留同一操作重試。" : value.errors?.[0]?.message ?? "結果尚未確認，請以原操作重試。"); return;
      }
      const receipt = qualityFreezeReceiptSchema.safeParse(value.data);
      if (value.status !== "ok" || !receipt.success || !receipt.data.snapshotId || receipt.data.organizationId !== operation.organizationId ||
        receipt.data.branchId !== operation.branchId || receipt.data.month !== operation.input.month || receipt.data.hash !== operation.input.expectedHash ||
        receipt.data.actorUserId !== operation.actorUserId || receipt.data.idempotencyKey !== operation.input.idempotency_key) {
        markQualityOperationUnknown(operation); if (mounted.current) setError("結果尚未確認，請以原操作重試。"); return;
      }
      settleQualityOperation(operation);
      if (mounted.current) router.replace(`/app/quality-monthly?month=${receipt.data.month}&snapshot=${receipt.data.snapshotId}`);
    } catch { markQualityOperationUnknown(operation); if (mounted.current) setError("連線中斷，結果尚未確認；請用原操作重試。"); }
    finally { lock.current = false; }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">品質管理</p><h1>品質月報</h1><p className="page-heading__description">看事件、找來源、固定當月報表。</p></div></header>
    <form className="filter-bar" method="get" noValidate><label className="field field--compact"><span>月份</span><input type="month" name="month" defaultValue={month} min="2000-01" max="2099-12" disabled={!!pending || lost} /></label><button className="button button--secondary" type="submit" disabled={!!pending || lost}>查看</button></form>
    {pending && <p role="status">{busy ? "正在核對原操作…" : "原操作結果尚未確認。"}{!busy && <button className="button button--secondary" type="button" disabled={offline || !canExport || !snapshot} onClick={() => void freeze(true)}>核對並重試原操作</button>}</p>}
    {lost && <p role="alert">前次操作結果尚未確認，請主管核對原回執；目前不能建立新操作。</p>}
    {error && <p role="alert">{error}</p>}
    {!snapshot ? <section className="empty-card" role="alert"><TriangleAlert aria-hidden="true" /><h2>月報暫時無法載入</h2><p>請確認本分支的報表與來源查閱權限。</p><button className="button button--secondary" onClick={() => router.refresh()}>重新載入</button></section> : <>
      <div className="callout"><ClipboardCheck aria-hidden="true" /><span>{snapshot.snapshotId ? "固定快照" : "即時核對"} · {snapshot.month} · 內部品質指標，非主管機關核定公式</span></div>
      <section className="metric-grid" aria-label="月報指標">{snapshot.metrics.map((metric, index) => {
        const Icon = [Activity, Droplets, TriangleAlert, Scale][index];
        return <article className="metric-card" key={metric.key}><div className="metric-card__top"><span>{qualityMetricLabels[metric.key]}</span><Icon aria-hidden="true" /></div><div className="metric-card__value"><strong>{metric.numerator}</strong><span>{metric.key === "weight_coverage" ? "人" : "件"}</span></div><p className="metric-card__foot">{metric.rate === null ? "缺出勤分母，暫不計算比率" : `${Number(metric.rate).toFixed(2)}${metric.key === "weight_coverage" ? "%" : " 件／百出席人日"}`}</p></article>;
      })}</section>
      <section className="panel"><div className="panel__header"><h2>來源與明細</h2><span>讀取 {formatCareTaipeiTime(snapshot.generatedAt)}</span></div><div className="panel__body">{snapshot.metrics.map((metric) => <QualityMetricDetails key={`${snapshot.hash}:${metric.key}`} metric={metric} />)}</div></section>
      <section className="panel"><div className="panel__body"><div className="page-heading__actions">{!snapshot.snapshotId ? <button className="button button--primary" disabled={!canExport || offline || busy || !!pending || lost} onClick={() => void freeze()} aria-busy={busy}>{busy ? "正在核對…" : "固定月報並匯出"}</button> : canExport && <a className="button button--primary" href={`/api/quality-monthly/export?month=${snapshot.month}&snapshot=${snapshot.snapshotId}`}><Download aria-hidden="true" />下載同一快照 CSV</a>}</div>{offline && <p role="status">目前離線，連線後再建立快照。</p>}<details><summary>計算與版本</summary><p>{snapshot.ruleVersion} · 排除已作廢體重 {snapshot.excludedVoidedWeights} 筆。未登記不當作缺席；零分母為缺資料，不是 0%。修改來源不會改寫固定快照。</p><p>識別：{snapshot.hash}</p></details></div></section>
    </>}
  </>;
}
