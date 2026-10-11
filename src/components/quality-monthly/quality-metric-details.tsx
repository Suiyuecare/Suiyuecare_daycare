"use client";

import { useState } from "react";
import { qualityMetricLabels, type QualityMonthlySnapshot } from "@/lib/quality-monthly/contract";
import { qualitySourceHref } from "@/lib/quality-monthly/navigation";

type Metric = QualityMonthlySnapshot["metrics"][number];
const pageSize = 25;

function SourcePage({ kind, rows }: { kind: "分子" | "分母"; rows: Metric["numeratorItems"] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  return <section aria-label={`${kind}來源`}><h3>{kind} · {rows.length} 筆</h3>
    {rows.length ? <><ul>{rows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row) =>
      <li key={row.id}><a href={qualitySourceHref(row)}>{row.date} · {row.id.slice(0, 8)} · 查看來源</a></li>)}</ul>
      {totalPages > 1 ? <nav className="page-heading__actions" aria-label={`${kind}分頁`}>
        <button className="button button--secondary" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一頁</button>
        <span role="status">第 {currentPage}／{totalPages} 頁</span>
        <button className="button button--secondary" type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>下一頁</button>
      </nav> : null}</> : <p>沒有來源紀錄</p>}
  </section>;
}

export function QualityMetricDetails({ metric }: { metric: Metric }) {
  const [expanded, setExpanded] = useState(false);
  return <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{qualityMetricLabels[metric.key]} · 分子 {metric.numerator}／分母 {metric.denominator}</summary>
    {expanded ? <><p>{metric.key === "weight_coverage" ? "分母是本月已出席的不同個案；分子是其中有有效體重量測者。" : "分母是本月已登記出席的人日；未登記、請假、取消與歷史更正版不列入。"}</p>
      <SourcePage kind="分子" rows={metric.numeratorItems} /><SourcePage kind="分母" rows={metric.denominatorItems} />
    </> : null}
  </details>;
}
