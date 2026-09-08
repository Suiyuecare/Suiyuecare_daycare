"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { IMPORT_PROMOTION_GATES, filterImportReadinessFields, summarizeImportReadiness,
  type ImportFieldFilter, type ImportReadinessInput } from "@/lib/imports/readiness";
import styles from "./import-readiness.module.css";

const stateLabels = { mapped: "候選映射已辨識", unknown: "待映射", conflict: "欄位衝突" };
const PAGE_SIZE = 20;

export function ImportReadinessPanel({ input }: { input: ImportReadinessInput }) {
  const headingId = useId();
  const [status, setStatus] = useState<ImportFieldFilter>("all");
  const [section, setSection] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const result = summarizeImportReadiness(input);
  // Filter exact parser parent paths; repeated paths intentionally remain grouped.
  const paths = Array.from(new Set(input.fields.map((field) => field.source.parentPath)));
  const filtered = filterImportReadinessFields(input.fields, status, section);
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(pageIndex, lastPage);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return <section className={styles.workspace} aria-labelledby={headingId}>
    <header><p className="eyebrow">來源核對 · 不改寫資料</p>
      <h2 id={headingId}>匯入完整度與欄位追蹤</h2>
      <p>解析映射版本：<code>{input.mappingVersion}</code>。所有數量來自目前這份解析快照，不代表 89 頁資料完整度。</p></header>
    <div className={styles.notice} role="note"><strong>{result.hasOpenParserIssues ? "仍有解析項目待核對" : "解析未發現待映射項目；仍不可正式匯入"}</strong>
      <p>正式寫入尚未開放。零未知欄位、零衝突，或已核准暫存，都不能證明已寫入業務資料。</p></div>
    <dl className={styles.metrics}>
      {[["全部欄位", result.fieldTotal], ["候選已映射", result.mapped], ["待映射欄位", result.unknown],
        ["衝突欄位", result.conflict], ["衝突群組", result.conflictGroups], ["未知區段", result.unrecognizedSections]]
        .map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
    </dl>
    <p>全部欄位＝候選已映射＋待映射＋衝突欄位。衝突群組與警示是另外的核對項目，不重複加入欄位總數。</p>
    <div className={styles.filters}>
      <label>欄位狀態<select value={status} onChange={(event) => { setStatus(event.target.value as ImportFieldFilter); setPageIndex(0); }}>
        <option value="all">全部欄位</option><option value="mapped">候選映射已辨識</option><option value="unknown">待映射</option><option value="conflict">欄位衝突</option>
      </select></label>
      <label>來源父層路徑<select value={section} onChange={(event) => { setSection(event.target.value); setPageIndex(0); }}>
        <option value="all">全部來源路徑</option>{paths.map((path) => <option key={path} value={path}>{path}</option>)}
      </select></label>
      <button className="button button--secondary" type="button" onClick={() => { setStatus("all"); setSection("all"); setPageIndex(0); }}>清除欄位篩選</button>
    </div>
    <p role="status">符合 {filtered.length} 欄；{filtered.length === 0 ? "目前無符合欄位" : `顯示第 ${currentPage * PAGE_SIZE + 1}–${currentPage * PAGE_SIZE + visible.length} 欄`}。</p>
    {visible.length === 0 ? <div className="empty-card"><h3>沒有符合條件的欄位</h3><p>請切換狀態或清除篩選；不代表正式資料已齊全。</p></div> :
      <ul className={styles.fields}>{visible.map((field) => <li key={field.id}>
        <div className={styles.fieldHeading}><h3>{field.source.label}</h3><span className="status-pill status-pill--warning">{stateLabels[field.mappingState]}</span></div>
        <p>{field.isMasked ? "預覽值（已遮罩）" : "預覽值"}：{field.displayValue || "未提供值；不能推定為 0 或不適用"}</p>
        <details><summary>查看來源與候選對應</summary><dl className={styles.provenance}>
          <div><dt>來源區段</dt><dd>{field.source.sectionCode} · {field.source.sectionTitle}</dd></div>
          <div><dt>父層路徑</dt><dd><code>{field.source.parentPath}</code></dd></div>
          <div><dt>欄位／控制項代碼</dt><dd>{field.source.controlName ?? "來源未提供代碼"}</dd></div>
          <div><dt>映射鍵</dt><dd><code>{field.mappingKey}</code></dd></div>
          <div><dt>候選資料路徑</dt><dd>{field.targetPath ?? "尚未建立候選對應"}</dd></div>
          <div><dt>正式業務寫入</dt><dd>尚未開放；不以候選路徑判定完成</dd></div>
        </dl>{field.warnings.length > 0 ? <ul>{field.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : <p>此欄位沒有解析警示；不是必填或業務正確性驗收。</p>}</details>
      </li>)}</ul>}
    <nav className={styles.pagination} aria-label="解析欄位分頁">
      <button className="button button--secondary" type="button" disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>上一頁欄位</button>
      <span>第 {currentPage + 1}／{lastPage + 1} 頁</span>
      <button className="button button--secondary" type="button" disabled={currentPage >= lastPage} onClick={() => setPageIndex(currentPage + 1)}>下一頁欄位</button>
    </nav>
    <details className={styles.notice}><summary>解析警示（{result.warningTotal} 項，錯誤 {result.errorWarnings} 項）</summary>
      {input.warnings.length === 0 ? <p>目前沒有解析警示，仍需完成人工與正式環境驗收。</p> : <ul>{input.warnings.map((warning) => <li key={warning.id}>{warning.severity === "error" ? "錯誤" : warning.severity === "warning" ? "警示" : "資訊"} · {warning.code}：{warning.message}</li>)}</ul>}
    </details>
    <details className={styles.notice}><summary>來源區段清單（{result.sectionTotal} 區段）</summary>
      <p>即使區段內沒有可解析欄位，也保留在此清單，不會當作已完成。</p>
      <ul>{input.sections.map((item) => <li key={item.id}>{item.code} · {item.title}：{item.recognized ? "已辨識來源區段" : "未知區段，待確認"}</li>)}</ul>
    </details>
    <section className={styles.notice} aria-label="正式匯入尚缺的證據"><h3>正式匯入尚缺的證據</h3>
      <ul>{IMPORT_PROMOTION_GATES.map((gate) => <li key={gate.id}><strong>{gate.title}｜待驗收</strong><p>{gate.reason}</p><p>負責：{gate.owner}</p></li>)}</ul>
      <Link className="button button--secondary" prefetch={false} href="/app/staff/governance/integrations-audit#data-inventory">前往資料盤點與缺漏追蹤</Link>
    </section>
  </section>;
}
