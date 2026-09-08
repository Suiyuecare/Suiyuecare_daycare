export function SyntheticPreviewBanner() {
  return (
    <aside aria-label="合成資料試用限制" style={{
      margin: "0 0 16px", padding: "12px 16px", border: "1px solid #a8c5be",
      borderRadius: "12px", background: "#eef7f4", color: "#183b34", lineHeight: 1.6,
    }}>
      <strong>唯讀合成試用</strong>
      <p style={{ margin: "4px 0 0" }}>本頁只顯示合成資料，不保存或傳送業務資料。禁止輸入或上傳真實個資。</p>
    </aside>
  );
}
