# 第 52 頁：個案服務計畫工作流程驗證

日期：2026-09-08（Asia/Taipei）。本機實作紀錄，不是正式 Supabase、醫療業務或上線驗收。

## 實作範圍

- 獨立工作區、篩選、狀態、目標／預期成果、多列措施／頻率／負責人、生效／結束／檢討日期、版本差異及歷史簽署證據。
- 建立草稿、修訂草稿、核准、簽署與作廢均新增不可變版本；操作綁定終端 ID、版本、內容雜湊、精確核定來源及原來源雜湊。
- 所有操作要求有效 AAL2 員工與個案資料範圍；核准／簽署／作廢另要求對應權限與同一工作階段最近 15 分鐘重新驗證。伺服器產生時間、簽署及核准證據，不接受瀏覽器自行提供。
- 已簽有效版本與最新流程草稿分開判斷；較新草稿及未來版本不取代指定日期可追溯的已簽版本。
- 舊 JSON 不會靜默捨棄或轉成新格式；未映射時以唯讀原文保存並關閉核准、簽署。建立修訂須明確輸入完整目標與措施。
- 機構手動計畫不冒充官方服務代碼、費率或專業資格；任用有效只標示 `active_membership_only`。新工作流程版本固定 `blocked_not_configured`，申報驗證與匯出也須實際拒絕，不只畫面警告。
- 一般快照有 60 秒有效性、離線提示及手動更新。重複／未知查詢或無效日期直接顯示錯誤，不放寬個案範圍。

## 未知結果與操作體驗

- 回執逐項比對操作、機構／分支、個案、前版、核定來源、原內容及 HTTP／replay 語意。
- 斷線、不明 409、502、無法核對的成功回應及非結構化 gateway 錯誤，都保留原請求、機構／分支與冪等鍵；同步送出鎖阻擋重複點擊。
- 只有首次確定未成功的已知錯誤才能解鎖。曾結果未知後，再收到權限或版本拒絕仍保留原操作，不允許換鍵新增。
- 同一操作元件仍掛載時，更新清單、鏈尾已作廢、權限撤銷或範圍 props 改變都保留待核對操作；需要回原範圍且恢復原操作權限與近期 MFA，才能重試。重試不改成畫面最新可選的另一種操作。
- 編輯欄位只依真實基準版本重建；切換個案時清空草稿，避免沿用上一位個案的輸入內容。無權限、展示唯讀、無可用操作與真正已作廢分別顯示。

## 可重跑指令

```bash
pnpm exec vitest run src/lib/client-service-plan-workflow src/components/client-service-plan-workflow src/app/api/client-service-plans
pnpm test:database client_service_plan_workflow_page52.test.sql core_care_plans.test.sql
```

本輪 React 操作與頁面測試 19 項通過，含多次未知重試、撤權／切換分支／空清單／作廢鏈尾、原操作 MFA、已知失敗保留輸入、重複點擊、來源欄位序列化及重新載入後版本欄位更新。API 測試替換授權 adapter，不能當作真 MFA E2E。

本頁 focused Vitest 共 4 份、53 項通過，含 3 項真 PGlite SQL JSON → TypeScript 契約與上述 19 項 React 測試。專頁 pgTAP 50 項、核定寫入邊界 12 項通過；不得以本機相容性測試推論正式 Supabase 交易或多連線已驗收。

安全複查修正三項實際問題：同一人核准後延後簽署仍可沿用歷史核准時間與完整證據；瀏覽器及 service_role 不得直接偽造已簽核定來源；核定選項依檢視日期挑選有效終端版本，第四季新版本不會隱藏第三季仍有效的舊版。送出時仍逐一檢查完整服務期間，跨越已取代期間會拒絕。

## 瀏覽器證據

- 實際本機合成展示 `/app/staff/service-management/client-service-plans`：1440px／390px 均無整頁橫向溢出、輸入至少 16px，包含舊格式原文在內的歷史 summary 均至少 44px。兩種寬度全部歷史展開後 axe WCAG 2／2.1／2.2 AA 均 0 violations、0 incomplete。
- `status=signed` 的清單與筆數一致且不混入草稿個案；不合法日期與重複 status 參數均顯示明確錯誤、計畫表列 0 筆。
- 真 React 表單的合成 harness 完成 2 個目標、2 個措施的輸入及模擬斷線：撤權後原操作保留、按鈕停用；恢復後再次送出，兩次 JSON body 與冪等鍵完全一致。所有 Page52 寫入在元件層被攔截，HTTP 外送及正式資料寫入皆為 0，不是實際員工登入／簽署流程。
- 表單在 390px／1440px 及手機待核對狀態皆 axe 零違規／零 incomplete。日期欄位由 DOM 日期輸入事件設定；不當作原生日期選擇器的人工鍵盤驗收。
- 截圖位於 `artifacts/page52-browser/`：`desktop-readonly-1440-final.png`、`mobile-readonly-390-final.png`、`desktop-multirow-form-1440.png`、`mobile-multirow-form-390.png`、`mobile-pending-permission-390.png`。
- 保留 `tests/browser/client-service-plan-harness.tsx` 供重跑；暫時測試路由及產生的型別已移除，正常 app 沒有引用該 fixture。

## 尚待外部驗收

正式核定來源 promotion、已發布服務代碼／費率／資格映射、官方申報格式、完整歷史匯出／文件、正式 Supabase 多連線與 RLS、MFA 端到端、撤權競態、50 人壓測及法律／業務驗收仍須完成。跨頁、整頁重新整理或篩選移除整個操作元件後的持久化待核對佇列尚未實作；本次重試證據只涵蓋仍掛載元件，不宣稱跨導覽復原或離線簽署。未連線原廠系統、未使用真實個案做展示、未部署、未送出申報。
