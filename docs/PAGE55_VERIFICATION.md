# 第 55 頁：核定照顧計畫唯讀切片驗證

日期：2026-09-08（Asia/Taipei）。維持 **partial**：本次完成可追溯的獨立查閱頁，不代表官方資料映射、核定寫入或正式額度規則已完成。

## 已實作

- 使用獨立有界 RPC，一個資料庫陳述式產生篩選、列表、歷史、統計、來源及雜湊；快照有效期 60 秒。畫面到期／離線顯示明確狀態並可手動更新，不自動送出資料。
- 正式讀取要求目前有效員工、AAL2、`clients.read`、`care_plans.read`，並限制租戶、分支及可見個案。一般查閱不額外要求最近 15 分鐘重新驗證。
- 分開呈現流程最新版本、最新發布版本及指定日期有效發布版本。未來已簽版本、較新草稿不遮蔽當期有效版本；作廢按指定日期生效。
- 每頁最多 25 條版本鏈、每鏈完整 50 版，超出歷史上限直接拒絕，不以不完整歷史推論有效版本。選項上限與截斷旗標明確顯示。
- 保留來源、雜湊、版本差異及未映射 `plan_data`／`service_limits`。JSON 只以安全文字呈現，不作為 HTML、程式碼、公式或核定額度執行；精確保留 `9007199254740993` 等超出 JavaScript 安全整數範圍的原始數字。
- 日期、重複／未知查詢參數及快照結構嚴格驗證；錯誤不回退至其他個案或無篩選資料。每次成功查閱留下不含內容個資的稽核。

## 本機可重跑證據

```bash
pnpm exec vitest run src/lib/authorized-care-plan-view src/components/authorized-care-plan-view
pnpm exec vitest run src/components/ui/snapshot-freshness.test.tsx
pnpm test:database:compile
```

- Page55 focused Vitest：4 份、24 項通過，含真實 PGlite SQL JSON → TypeScript 契約。此契約測試找出並修正草稿發布旗標輸出 NULL 的問題，現在輸出明確 false。
- 新 `supabase/tests/authorized_care_plan_view_page55.test.sql`：29 項通過；foundation：24 項通過；當時全部 84 份 migration 編譯通過。
- 共用快照有效性元件：5 項測試通過，涵蓋到期、離線／重新連線、事件清理及手動更新。
- TypeScript 與本次檔案 ESLint 通過。

安全複查另新增 `20260908005000_authorized_care_plan_write_boundary.sql`：移除休眠中的核定計畫 INSERT policy，撤除 public／anon／authenticated／service_role 直接新增權限。未實作受控 promotion 前，瀏覽器不能自行提供 signed 狀態、來源與任意雜湊來偽造核定資料；SELECT 與強制 RLS 保留。`authorized_care_plan_write_boundary.test.sql` 12 項通過，證明偽造草稿／已簽來源與 service_role 直寫均拒絕、零副作用；owner 建立的合成可信 fixture 仍可供 Page55 查閱及 Page52 精確綁定。加入此邊界後 migration 編譯為 85 份。

SQL 測試涵蓋執行權限、AAL2、雙權限、個案指派、跨分支／跨租戶、當期／未來／草稿／作廢版本、原始未知內容、雜湊、短效時間、最小稽核、不可變資料及 64KiB 來源上限。

## 實際瀏覽器

本機合成展示路由 `/app/staff/service-management/approved-care-plans` 在 1440px／390px 均無整頁橫向溢出；輸入文字至少 16px、主要操作至少 44px。全部歷史展開後，兩種寬度的 axe WCAG 2／2.1／2.2 AA 均 0 violations、0 incomplete。自動掃描不取代人工螢幕閱讀器或完整 WCAG 驗收。

`effective=current` 僅顯示對應當期個案；不合法日期及重複 `as_of` 參數都顯示錯誤、計畫 DOM 數為 0。截圖：`artifacts/page55-browser/desktop-readonly-1440.png`、`mobile-readonly-390.png`。

保留的合成 `tests/browser/authorized-care-plan-view-harness.tsx` 使用真正 React 頁面元件，注入 script／img onerror／iframe 字串。暫時的本機測試路由已移除。全部歷史展開後 12 個原文區塊安全顯示：程式執行標記 0、探針 img／iframe DOM 0、探針網路請求 0。截圖：`artifacts/page55-browser/mobile-escaped-security-390.png`。

## 尚待完成

- 中央 HTML 的正式欄位映射、核准後原子寫入業務表，以及官方核定計畫／額度／服務限制版本與超限理由流程。
- 正式 Supabase、真實登入／MFA／RLS 全角色矩陣、並行交易、CI、部署及效能測試。
- 正式資料保存、資料供應商審查、機構／主管機關業務與法律驗收。

本次未使用真實個案做展示測試、未連線原廠系統、未上傳原始 HTML、未部署至正式環境。
