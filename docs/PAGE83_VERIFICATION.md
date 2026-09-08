# 第 83 頁：整合與稽核中心查閱切片

更新日期：2026-09-08（Asia/Taipei）。本頁仍為 `partial`，沒有完成整合清冊治理、供應商審查、重試、停用或每日對帳流程。

## 已實作的查閱範圍

- 獨立路由 `staff/governance/integrations-audit`，展示與正式 loader 分離，正式讀取失敗不使用合成資料補位。
- 只讀取 7 種既有來源：中央 HTML 匯入、通知投遞、離線同步操作、申報、跨專業照會通知 outbox、轉介通知 outbox、家屬溝通投遞。
- 每一來源先套機構、分支、台北時間窗口及精確追蹤條件，再於單一資料庫陳述式彙整。新增各來源的範圍／時間索引；未以本機功能測試冒充正式大量效能驗收。
- 日期包含起訖日，最多 90 日；未知參數、重複參數、不存在日期、非法 UUID 均拒絕。
- 日期與相關 UUID 同時約束來源及稽核；整合／活動狀態只篩來源，動作／資料類別／操作者只篩稽核，畫面明示此差異。
- 相關 UUID 只比對實際保存的 correlation／冪等 UUID；不以個案姓名、電話、身分證或紀錄 UUID 猜測追蹤關係。
- 完整符合集合總數與最多 100 個來源事件、200 個稽核列分開顯示；截斷時要求縮小條件，不把顯示列數當總數。
- 快照保存 ID、SHA-256、產生與過期時間；TypeScript 驗證原始快照雜湊、strict schema、範圍、順序、總數、狀態語意與完整集合一致性。

## 安全與真實狀態

- 正式讀取須目前員工 AAL2、`audit.view`、有效分支及同 session 最近 15 分鐘可信重新驗證；資料庫在讀取前後重新核對權限。
- 瀏覽器僅收到白名單資料類別、動作、狀態與去敏感 ID。不回傳任意 `metadata`、`changed_fields`、原始 `row_pk`、錯誤全文、附件或投遞內容。
- 審查發現：舊的 `authenticated SELECT audit_events` grant 可繞過去敏感投影。Migration `20260908009000_integrations_audit_page83.sql` 已撤銷此直接讀取，保留受控 SECURITY DEFINER RPC 與必要 `service_role` 權限；pgTAP 同時驗證直接讀取 42501 與合法 RPC 可讀。不能只靠 UI 隱藏。
- 稽核資料分類使用實際 writer／trigger 的精確表名白名單（包含已知 `public.` 名稱），未知表保持 `other` 且遮罩紀錄 ID。大整數稽核 ID 保留字串，不經 JavaScript 浮點截斷。
- 來源、流程狀態、錯誤分類與錯誤遮罩狀態的組合須符合白名單；例如完成事件不得同時標示匯入驗證失敗。
- 來源連結只接受固定站內路由且關閉預先讀取；任意 URL 不產生連結。
- 「已觀察到活動」不代表供應商串接、服務健康、送達或完成 DPA。目的、欄位、方向、頻率、供應商、區域與負責人的正式治理資料尚未發布；UI 清楚標示未配置。

## 本機驗證證據

- 聚焦 Vitest：`pnpm exec vitest run src/lib/integrations-audit src/components/integrations-audit`，5 檔、34 項通過，包含實際 PGlite SQL → TypeScript 投影測試，不僅是手工 mock。
- Migration compile：88 份通過；專頁 `integrations_audit_page83.test.sql`：45/45 通過。受直接讀取權限撤銷影響的 10 份既有 pgTAP fixture，改由 owner 執行內部 ledger 斷言而非恢復 browser grant；加本頁共 11 檔、437 項通過。全專案最終重跑另以 `IMPLEMENTATION_STATUS.md` 記錄，不能把本節聚焦結果當作其他頁面驗證。
- 瀏覽器：本機 3112 展示資料，1440px 與 390px 無水平溢位；輸入至少 16px、主要觸控目標至少 44px。兩個寬度 axe WCAG A／AA／2.2 AA 零違規、零 incomplete；原生 details 鍵盤開展及焦點保留已驗證。
- 合成篩選操作確認 notification 來源與 export 稽核各自使用正確集合；重複動作參數、不存在曆日均顯示錯誤並清空結果。
- 圖片：`artifacts/page83-browser/desktop-1440.png`、`mobile-390.png`、`mobile-filters-390.png`、`mobile-audit-390.png`。

## 未完成的正式驗收

正式 Supabase、真實 Auth／MFA、兩條資料庫連線的撤權競態、七年資料／50 人效能、供應商清冊治理與 DPA、停用／重試命令、每日對帳、失敗升級、外部整合與正式部署仍未完成。本次沒有連線或修改任何正式資料，也沒有發出 LINE、簡訊或申報。
