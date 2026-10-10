import { FlaskConical } from "lucide-react";

export function SyntheticPreviewBanner() {
  return (
    <aside aria-label="合成資料試用限制" className="preview-mode-banner">
      <FlaskConical aria-hidden="true" />
      <strong>唯讀合成試用</strong>
      <p>本頁只顯示合成資料，不保存或傳送業務資料。禁止輸入或上傳真實個資。</p>
    </aside>
  );
}
