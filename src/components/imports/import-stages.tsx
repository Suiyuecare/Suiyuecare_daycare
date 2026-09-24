import styles from "./import-readiness.module.css";

export function ImportStages({ parsed }: { parsed: boolean }) {
  return <ol className={styles.stages} aria-label="匯入三階段進度">
    <li><span>階段 1</span><strong>{parsed ? "已解析" : "等待解析"}</strong><p>{parsed ? "來源欄位已取得，請逐項核對。" : "先選擇 HTML 檔案，再上傳預覽。"}</p></li>
    <li><span>階段 2</span><strong>待核對／暫存核准</strong><p>暫存核准不等於正式入檔。</p></li>
    <li><span>階段 3</span><strong>正式入檔尚未完成</strong><p>尚未開放；不會更新個案、核定計畫或服務紀錄。</p></li>
  </ol>;
}

export function ImportNextSteps() {
  return <section className={styles.nextSteps} aria-labelledby="import-next-steps-heading">
    <h2 id="import-next-steps-heading">正式入檔前，下一步要做什麼？</h2>
    <p>以下工作尚待完成，不是這次解析的成功項目。</p>
    <ol>
      <li><strong>機構核對：</strong>用穩定識別碼確認個案，逐欄確認對應、差異與保留原值的規則；不依姓名自動合併。</li>
      <li><strong>管理員完成設定：</strong>確認原始檔七年防刪封存、附件安全檢查及保存證據。</li>
      <li><strong>工程端完成正式入檔：</strong>串接個案資料、衝突覆核及失敗回復測試，再由授權人員完成近期身分驗證與核准。</li>
    </ol>
  </section>;
}
