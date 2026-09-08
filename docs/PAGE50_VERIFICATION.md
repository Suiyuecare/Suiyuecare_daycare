# 第 50 頁：個案服務紀錄本機驗證

日期：2026-09-08（Asia/Taipei）。狀態：dedicated 垂直切片，**未通過法定表單、正式 Supabase 或上線驗收**。

## 實作範圍與安全邊界

- 本頁保存機構人員手動輸入的服務類型、服務起訖、服務內容、服務結果、作者及可選的既有執行事件參照；來源固定為 `manual_local`，結構固定為 `manual_service_narrative_v1`。
- 這是「本機人工服務敘事」，不是核准法定表單。法定欄位規則維持 `not_configured`；附件、匯出、通知、離線及申報資格也都明確維持 `not_configured`。
- 本頁不建立或修改 `service_events`、`claim_items`，不自行產生服務執行證據，也不讓草稿、簽署或更正提升申報資格。
- 可選執行參照只能連到同機構、同分支、同個案、同原始作者、目前已完成且具有有效 SHA-256 內容雜湊的既有事件；簽署時再次核對目前狀態與保存時雜湊。事件後續改變只標示證據已變更，不改寫歷史版本。

## 版本、簽署與回執

- 建立及修訂產生新的不可變草稿版本；只有原作者能修訂目前草稿。簽署複製被選中的完整草稿內容，不接受瀏覽器只傳版本號或局部欄位。
- 簽署及更正要求專用簽署權限，以及同一工作階段最近 15 分鐘 AAL2。伺服器保存簽署者、角色、時間、用途、重新驗證 challenge、來源版本及內容雜湊。
- 更正只能接續已簽或已更正的鏈尾，須填至少 8 字理由並建立新版本；請求另攜帶並驗證來源版本的原作者，避免把更正簽署者誤寫成原始作者。
- 資料庫以每條版本鏈與每位 actor 的操作鍵鎖定交易；`expected_version`、前版 ID、前版雜湊及 actor-scoped idempotency 防止分叉、覆寫與重送重複。
- 保存回執嚴格核對機構、分支、個案、actor、操作、原操作鍵、版本、前版、來源雜湊及完整實際保存內容。HTTP 201 只接受首次結果，HTTP 200 只接受資料庫確認的 exact replay；畸形 2xx 視為未知結果，不宣稱保存成功。

## 權限、查詢與稽核

- 正式讀取要求 AAL2 員工、`clients.read` 與 `case_service_records.read`；寫入另需 manage 或 sign，資料庫仍逐次驗證 tenant、branch 及 assigned-client 範圍。家屬角色與未指派個案 fail closed。
- 快照依台北日期、個案、服務類型、作者及狀態組合篩選；非法日期、重複參數、未知參數及陣列語意直接拒絕。紀錄先按服務開始時間，再以穩定個案 ID 與紀錄 ID 排序，不依輸入時間或姓名 collation。
- 所有統計以完整符合條件集合計算後才截取最多 200 筆；TypeScript 投影對未截斷集合要求逐狀態精確相等，對已截斷集合要求可見數不得超過完整總數。每條歷史最多顯示 50 版並明示截斷。
- 版本與 operation ledger 強制 RLS、撤除瀏覽器及 service-role 直接 DML，並設不可更新／刪除觸發器。稽核只留工作流程、版本、狀態、欄位名稱及相關 ID，不複製人工敘事或篩選值。

## 可重跑驗證

```bash
pnpm exec vitest run src/lib/case-service-records/case-service-records.test.ts src/lib/case-service-records/database-contract.test.ts src/app/api/case-service-records/route.test.ts src/components/case-service-records/case-service-records-workspace.test.tsx
pnpm test:database -- case_service_records_page50.test.sql foundation_schema.test.sql
pnpm test:database:compile
pnpm typecheck
pnpm exec eslint src/lib/case-service-records src/app/api/case-service-records src/components/case-service-records --max-warnings=0
```

本檢查點結果：

- Page50 focused Vitest：4 個檔案、70 項通過。其中包含真 PGlite SQL JSON → TypeScript 的空快照、首次建立／exact replay、同時同日多個案穩定排序、執行證據簽署／更正／事後失效等契約。
- pgTAP：Page50 57/57、foundation 24/24，共 2 個檔案、81 項通過。涵蓋直接 DML、AAL2、權限／指派、跨 tenant、不可變版本、線性鏈、actor-scoped exact replay、內容綁定、執行證據負向案例、200 筆截斷、稽核不含敘事及不變更申報／執行權威。
- migration compile：當時工作區 88/88；TypeScript typecheck 與 Page50 focused ESLint 通過。

上述資料庫檢查使用本機 PGlite 相容層；API 測試替換登入及 Supabase adapter。這些分段證據不是正式 Supabase、多連線競態、真 MFA 或正式員工端端到端驗收。

## 瀏覽器與互動驗證

2026-09-08，使用本機 `127.0.0.1:3112` 與合成資料：

- 正式 catalog 展示路由在 1440px／390px 可讀取；空白 GET 選項可正常使用，`status=draft` 只顯示一筆合成草稿。重複 `status` 及 `2026-02-30` 會拒絕查詢、清空清單並顯示可重試錯誤。
- 本機、development＋DEMO_MODE 限定的暫時合成 fixture 用於呈現完整新增及簽署表單，不連接正式 Auth 或資料庫。測試後 fixture 原始碼與該路由的 Next 產生型別已移除，瀏覽器已關閉。
- 桌機及手機沒有水平溢位；輸入字級至少 16px、主要按鈕與 details 目標至少 44px、簽署核對勾選整個 label 至少 44px。axe WCAG A／AA／2.2 AA 在展示、手機新增表單及桌機簽署表單均為零違規、零 incomplete。
- 原生 details 可用鍵盤 Enter 展開且保留 SUMMARY 焦點；啟動編輯／簽署後焦點移至編輯 H2。React 核對原始版本與完整 payload；只有原作者能看到草稿修訂操作。
- 發現 Node 與 Chromium 的日期格式分隔空白不同造成 hydration mismatch；改採台北時區 `formatToParts` 與明確分隔符後，瀏覽器未再出現 hydration mismatch，日期仍一致。
- 手機未知結果測試攔截的只有本機合成 `/api/case-service-records`，以不完整成功回覆模擬無法核對的結果；連續兩次送出 body 與冪等鍵完全相同，原內容凍結，沒有真實保存。這不代表正式網路故障、多 session 或重試交易 E2E 已驗收。
- React 21 項涵蓋初次已知拒絕後新鍵、未知結果後再收到拒絕仍保留原鍵、缺快照／撤權／跨分支／不同 actor 關閉重試、恢復原身分後 exact replay、來源版本改變時拒絕原編輯器及不把草稿寫入 Web Storage。

已檢視圖片：

- `artifacts/page50-browser/desktop-1440.png`
- `artifacts/page50-browser/mobile-390.png`
- `artifacts/page50-browser/mobile-editor-390.png`
- `artifacts/page50-browser/mobile-exact-retry-390.png`
- `artifacts/page50-browser/desktop-sign-1440.png`
- `artifacts/page50-browser/mobile-sign-390.png`

## 尚待外部驗收

- 「法定必要欄位」的完整集合、官方表單名稱／版本、地方政府差異、簽署等級、保存／列印規格及業務流程，仍缺正式授權題本或主管機關／法務／業務簽核；因此本頁目前不能宣稱符合第 50 頁原訂法定完整性驗收。
- 正式附件上傳／掃毒／短效下載、PDF／正式文件、批次匯出、通知、離線同步、申報串接及以本頁作為申報來源均未啟用。
- 尚須在正式 Supabase 驗證 RLS、兩個真實連線的版本競態、工作階段撤銷競態、備援／還原、七年資料量、50 人並行效能及真 MFA 流程。
- 本頁展示只能使用合成資料；未匯入真實個案、未送出申報、未部署。dedicated 只代表已建立專用端到端程式切片，不代表法規、營運或正式上線 acceptance 已完成。
