import { suggestCareReminders } from "@/lib/care-reminders/rules";
import type { ImportPreview } from "@/lib/imports/types";

export function ImportReminderPreview({ preview }: { preview: ImportPreview }) {
  const suggestions = suggestCareReminders(preview.fields, preview.batch.mappingVersion, preview.conflicts.map((item) => item.mappingKey));
  return <section className="panel__body" aria-labelledby="import-reminder-preview"><h3 id="import-reminder-preview">自動整理：待核對的個案注意事項</h3>
    <p>僅依已識別欄位的明確文字選項整理，不使用自由文字猜測診斷。尚未核對、尚未關聯個案，不是正式照顧指示。</p>
    <p>第一版支援進食 E1、如廁 E7、移位 E8、表達 C4 已核對的完整欄位與選項文字。單獨數字及其他版型不猜測，須先完成字典核對。</p>
    {suggestions.length ? <ul>{suggestions.map((item) => <li key={item.ruleId}><strong>{item.title}</strong><p>{item.text}</p><p>來源：{item.label}／{item.sourceValue}，規則 {item.ruleVersion}</p></li>)}</ul>
      : <p>目前沒有可安全自動產生的候選。缺值、不適用、衝突與不支援的選項不會被當成正常，仍須人工核對。</p>}
    <p>完成可信封存後，由授權人員在個案「照顧提醒」核對來源身分、建立候選並逐筆發布。這不會取代正式中央資料匯入或改寫原照顧計畫。</p>
  </section>;
}
