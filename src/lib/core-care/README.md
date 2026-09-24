# 每日服務適用性與同快照摘要

2026-09-22 本機實作；尚未發佈或套用正式資料庫。

`core_daily_snapshot` 在同一 STABLE 資料快照取得目前授權個案、服務日收案狀態、週表／單日調整、正式出勤、最近各類量測、最新日誌及完成服務數。沿用現行逐案指派與各來源權限，不增加任何角色權限。公開入口為 invoker，私有守門入口留查閱稽核；原始 builder 不授予 authenticated／service_role。

## 分母

- 已安排的服務日：出勤待核對；尚未登記出勤前仍列入服務名單。
- 實到：即使未排班、週表未建立或過期，也列入當日服務名單。
- 已登記請假／未到：保留出勤紀錄，不列量測／日誌待填。
- 明確未排服務或取消單日安排：不列漏填，既有紀錄仍可查看。
- 尚無安排、安排過期或缺出勤查閱權限：獨立列為待確認，不推定缺勤或零待辦。
- 當日尚未收案、暫停或結案：已有當日證據仍保留供核對，但不加入當日服務分母；摘要入口不提供新的紀錄表單。

本頁分母是服務名單，不是臨床必測項目政策。至少一筆量測不代表每項量測或每班工作完成；精確班別與工作項目仍使用原有主管分工。日誌摘要只顯示該人最新日誌，草稿／待簽不當完成；完整歷史仍在既有日誌版本流程。來源無權限時不顯示 0、不產生該來源待辦或表單。

## 驗收與發布順序

- 本機 Vitest：`pnpm exec vitest run src/lib/core-care src/components/core-care src/components/workspace/today-work-list.test.tsx src/lib/care-diary/revisions.test.ts`。
- 本機 PGlite：`node scripts/test-database.mjs core_daily_applicability_snapshot.test.sql`；43 assertions，使用現行 Google／session 授權，不替換授權函式。涵蓋安排、單日取消、請假、臨時實到、歷史、來源最小化、臺北日界、跨機構／分支／未指派／撤權與稽核。
- 過渡版本：須先套用 `20260922061353_core_daily_applicability_snapshot.sql` 再發布應用；缺 RPC 時頁面顯示載入失敗，不回退成多次查詢或空名單。
- 上限 500 位當日相關可見個案，超限整份拒絕，不截斷成錯誤分母；尚未做正式 500 個案／50 人並行效能驗收。
- 本機測試不等於真人作業、正式 Supabase／RLS 或手機瀏覽器驗收。無正式部署、正式資料寫入或遠端設定變更。
