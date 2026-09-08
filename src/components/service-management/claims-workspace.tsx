import {
  BadgeDollarSign,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  Files,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { ClaimValidationComposer } from "@/components/service-management/claim-validation-composer";
import type { PageCatalogEntry } from "@/lib/catalog";
import { sumMoney } from "@/lib/integrations/claims";
import type {
  ClaimBatchSummary,
  ClaimReadSnapshot,
  ClaimStatus,
} from "@/lib/service-management/types";

const statusLabels: Record<ClaimStatus, string> = {
  draft: "草稿",
  validated: "已驗證",
  exported: "已匯出",
  submitted: "已送出",
  accepted: "已接受",
  rejected: "有退件",
  reconciled: "已對帳",
  voided: "已作廢",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00+08:00`));
}

function formatMoney(value: string | null) {
  if (value == null) return "—";
  const [whole, fraction = "00"] = value.split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}.${fraction.padEnd(2, "0")}`;
}

function responseSummary(batch: ClaimBatchSummary) {
  if (batch.legacyResponseUnknown) return "舊版回覆未逐筆分類";
  return batch.respondedItemCount
    ? `${batch.respondedItemCount} 筆（退件 ${batch.rejectedItemCount ?? 0}）`
    : "尚無回覆";
}

function rejectedSummary(batch: ClaimBatchSummary) {
  if (batch.legacyResponseUnknown) return "舊版待治理";
  return batch.rejectedItemCount == null
    ? "—"
    : `${batch.rejectedItemCount} 筆`;
}

export function ClaimsWorkspace({
  page,
  snapshot,
  query,
  status,
  canValidate,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: ClaimReadSnapshot | null;
  query: string;
  status: "all" | ClaimStatus;
  canValidate: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert"><span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span><h1>申報批次暫時無法載入</h1><p>系統不會改用展示金額或舊快照代替。</p><a className="button button--secondary" href="?status=all">重新載入</a></section>;
  }
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const batches = snapshot.batches.filter((batch) => {
    const matchesQuery = !normalizedQuery || `${batch.formatVersion} ${batch.periodStart} ${batch.periodEnd}`.toLocaleLowerCase("zh-TW").includes(normalizedQuery);
    return matchesQuery && (status === "all" || batch.status === status);
  });
  const aggregatesAvailable = snapshot.batches.every(
    (batch) => batch.itemCount != null && batch.totalAmount != null,
  );
  const totalItems = aggregatesAvailable
    ? snapshot.batches.reduce((total, batch) => total + (batch.itemCount ?? 0), 0)
    : null;
  const totalAmount = aggregatesAvailable
    ? sumMoney(snapshot.batches.map((batch) => batch.totalAmount ?? "0.00"))
    : null;
  const rejectedItems = snapshot.batches.reduce(
    (total, batch) =>
      total + (batch.legacyResponseUnknown ? 0 : (batch.rejectedItemCount ?? 0)),
    0,
  );
  const legacyResponseUnknownCount = snapshot.batches.filter(
    (batch) => batch.legacyResponseUnknown,
  ).length;
  const draftBatches = snapshot.batches.flatMap((batch) =>
    batch.status === "draft" &&
    batch.itemCount != null &&
    batch.totalAmount != null
      ? [{
          id: batch.id,
          periodLabel: `${formatDate(batch.periodStart)}–${formatDate(batch.periodEnd)}`,
          totalAmount: batch.totalAmount,
          itemCount: batch.itemCount,
        }]
      : [],
  );

  return <>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>服務管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
<header className="page-heading"><div><p className="eyebrow">申報快照與對帳・頁面 49</p><h1>{page.title}</h1><p className="page-heading__description">申報批次、不可變匯出快照與主管機關回覆分開保存；筆數與金額由資料庫以同一權威快照精確彙整。</p></div><div className="page-heading__actions"><ClaimValidationComposer batches={draftBatches} demo={snapshot.demo} enabled={canValidate} hasRecentAal2={hasRecentAal2} /></div></header>
    <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>匯出與逐筆對帳已採單一交易、最近 15 分鐘 AAL2 與冪等保護；清單直接讀取資料庫彙整，不會以受分頁限制的明細在瀏覽器加總。</span></div>
    <section aria-label="申報摘要" className="metric-grid">{[
      ["申報批次", snapshot.batches.length, "批", "目前分支最近 200 批"],
      ["申報明細", totalItems ?? "—", totalItems == null ? "" : "筆", totalItems == null ? "彙整暫時無法取得" : "資料庫同批次摘要"],
      ["申報總額", totalAmount ? formatMoney(totalAmount) : "—", "", totalAmount ? "資料庫精確十進位加總" : "彙整暫時無法取得"],
      [
        "退件明細",
        legacyResponseUnknownCount ? "待治理" : rejectedItems,
        legacyResponseUnknownCount ? "" : "筆",
        legacyResponseUnknownCount
          ? `${legacyResponseUnknownCount} 批舊版回覆未逐筆分類`
          : "即使批次已對帳仍持續顯示",
      ],
    ].map(([label, value, unit, foot], index) => <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{index === 0 ? <Files aria-hidden="true" /> : index === 1 ? <FileCheck2 aria-hidden="true" /> : index === 2 ? <BadgeDollarSign aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">{foot}</p></article>)}</section>
    <section className="panel"><div className="panel__header"><div className="panel__title"><h2>申報批次</h2><p>{batches.length} 批符合條件</p></div><span className="core-care-muted">正式匯出格式尚待驗收</span></div>
      <form className="filter-bar" method="get"><label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋期間或格式版本</span><input defaultValue={query} name="q" placeholder="搜尋期間或格式版本…" type="search" /></label><label className="field field--compact"><span>申報狀態</span><select defaultValue={status} name="status"><option value="all">全部狀態</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button button--secondary" type="submit">套用篩選</button></form>
      {batches.length ? <><div className="table-wrap core-care-table"><table className="data-table"><thead><tr><th scope="col">申報期間</th><th scope="col">格式版本</th><th scope="col">狀態</th><th scope="col">明細</th><th scope="col">回覆結果</th><th scope="col">總額</th><th scope="col">不可變快照</th><th scope="col">匯出日</th><th scope="col">對帳日</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td>{formatDate(batch.periodStart)}–{formatDate(batch.periodEnd)}</td><td>{batch.formatVersion}</td><td><StatusPill status={statusLabels[batch.status]} /></td><td>{batch.itemCount == null ? "—" : `${batch.itemCount} 筆`}</td><td>{responseSummary(batch)}</td><td>{formatMoney(batch.totalAmount)}</td><td>{batch.hasImmutableSnapshot ? "已建立" : "尚未建立"}</td><td>{formatDate(batch.exportedAt)}</td><td>{formatDate(batch.reconciledAt)}</td></tr>)}</tbody></table></div><div className="mobile-records core-care-mobile">{batches.map((batch) => <article className="record-card" key={batch.id}><div className="record-card__top"><div><h3>{formatDate(batch.periodStart)}–{formatDate(batch.periodEnd)}</h3><span className="data-table__secondary">{batch.formatVersion}</span></div><StatusPill status={statusLabels[batch.status]} /></div><dl className="core-care-card-grid"><div><dt>明細</dt><dd>{batch.itemCount == null ? "待彙整" : `${batch.itemCount} 筆`}</dd></div><div><dt>退件</dt><dd>{rejectedSummary(batch)}</dd></div><div><dt>總額</dt><dd>{formatMoney(batch.totalAmount)}</dd></div><div><dt>匯出快照</dt><dd>{batch.hasImmutableSnapshot ? "已建立" : "尚未建立"}</dd></div><div><dt>對帳日</dt><dd>{formatDate(batch.reconciledAt)}</dd></div></dl></article>)}</div></> : <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的申報批次</h2><p>調整搜尋或狀態；系統不會跨分支查詢。</p></section></div>}
    </section>
  </>;
}
