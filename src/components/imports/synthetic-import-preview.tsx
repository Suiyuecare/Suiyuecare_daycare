import { buildSyntheticImportPreview } from "@/lib/imports/synthetic-preview-sample";
import styles from "@/components/reports/reports.module.css";
import { ImportReadinessPanel } from "./import-readiness-panel";
import { ImportNextSteps, ImportStages } from "./import-stages";
import importStyles from "./import-readiness.module.css";

export function SyntheticImportPreview() {
  const preview = buildSyntheticImportPreview();
  return <div className={styles.workspace}>
    <header className="page-heading"><div><p className="eyebrow">系統治理 · 頁面 80</p>
      <h1>中央 HTML 匯入</h1><p className="page-heading__description">線上試用只展示內建合成樣本的靜態解析結果，不開放上傳。</p></div></header>
    <ImportStages parsed />
    <aside className={styles.notice} role="note"><strong>禁止上傳真實個資 · 不會寫入正式資料</strong>
      <p>這是另行製作的 3 區段合成示例，不是您提供的三份真實個案檔案，也不是 42／41／40 區段黃金樣本驗收。</p>
      <p>未知欄位與警示仍須核對；原始 HTML 不會開啟，不執行程式或連線外部資源。</p>
    </aside>
    <section className={styles.card} aria-label="固定樣本解析摘要">
      <h2>解析摘要</h2><dl>
        <dt>區段／欄位數</dt><dd>{preview.sections.length} 區段／{preview.fields.length} 欄位</dd>
        <dt>未知欄位</dt><dd>{preview.fields.filter((field) => field.mappingState === "unknown").length} 欄</dd>
        <dt>解析器對外請求</dt><dd>{preview.security.externalRequestCount} 次（不執行原始 HTML）</dd>
      </dl>
      <details className={importStyles.management}><summary>管理檢查明細：合成樣本範圍</summary><p>「已識別區段」只代表解析器識別來源，不代表已完成正式欄位映射、資料主權核准、附件保存或七年封存。</p></details>
    </section>
    <ImportNextSteps />
    <ImportReadinessPanel input={{ fields: preview.fields.map((field) => ({ id: field.id,
      mappingKey: field.mappingKey, mappingState: field.mappingState, targetPath: field.targetPath,
      source: field.source, displayValue: field.normalizedValue, isMasked: false, warnings: field.warnings })),
      sections: preview.sections, warnings: preview.warnings, conflictCount: preview.conflicts.length,
      mappingVersion: preview.mappingVersion }} />
  </div>;
}
