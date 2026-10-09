# JUBO 23／17 私有暫存候選：同一份原始位元組

此變更只提供隔離的伺服器端暫存契約，沒有 API 路由、正式工作者憑證、東京資料庫寫入、正式個案建立或上線開關。

`stageApprovedJuboPair` 僅接受兩份已核准 SHA-256 的 XLSX。它直接呼叫既有 `prepareApprovedJuboPair`／`readApprovedJuboXlsx`，不另寫解析器。準備階段會阻擋非核准雜湊、錯誤 MIME／副檔名／大小、公式、外部連結、不安全 ZIP、錯誤表頭、非 23／17 筆、姓名與身分精確配對失敗，以及原始狀態不是 17 服務中、1 暫停、5 結案的來源。來源首服務日不轉為收案日或出勤。

受限的 PostgreSQL 單一交易依序核對目前使用者、分支、`imports.manage`、`imports.approve` 與最近 AAL2 證據，並保存：

- 兩份原始 XLSX `bytea`、SHA-256、長度與表頭；`storage_path` 是 `private_db` 邏輯定位，不代表已上傳 Supabase Storage 或 WORM。
- 40 筆來源列的試算表列號、原值陣列、標準化陣列與原始格位型別；來源原始狀態保持在主檔原值第 16 欄，不映射成正式個案狀態。
- 主檔末端第 29 列的 A-only 註記，僅在具權限的人員明確填寫覆核理由後，才能記為已覆核的非個案列。
- 已驗證的來源配對與僅含雜湊／筆數的冪等回執。相同使用者、同一冪等鍵、相同原始檔與覆核決定可重試；改變任何一項會拒絕。

資料庫的 `private` 表不授權瀏覽器 `anon`、`authenticated` 或 `service_role` 直接操作；新增欄位保存原值與標準化值但不改寫歷史來源列。原始位元組、原值及逐格內容不得印到 log、瀏覽器或錯誤回應。交易中任一列失敗應全部回滾；逾時後提交結果未知，必須保留同一冪等鍵核對，不得宣稱未寫入。

## 尚未放行

1. 已有預設關閉的 `stageApprovedJuboPairForCurrentStaff` 接線：Next.js 伺服器 Cookie 取 token、Auth `getUser(token)` 線上核驗、員工登入放行、同一東京 Supabase 專案的 transaction pooler、私有 PG 單交易及伺服器 HMAC；**未提供 API 路由、未設定正式憑證，也未在東京實測**。只有 `JUBO_PRIVATE_STAGE_ENABLED=true`、Production、`hnd1`、完整且一致的 Tokyo 設定才會接線；錯誤或缺值直接拒絕。將來入口必須是 Node.js runtime，且先限制原始 request 大小。
2. 由資料負責人看原始第 29 列並記錄覆核理由；不得自動視為已核准註記。
3. 在東京正式 PostgreSQL 執行 migration、權限與交易回滾／同時重試測試；目前僅通過本機 PGlite。確認 Supabase 私有資料保存、備份、退出與七年保留政策，不能把 `private_db` 當作 Object Lock。
4. 逐筆主管覆核 23 主檔、17 當月清冊及待補欄位，檢查既有身分碰撞；後續「待收案」候選還需全路由服務日阻擋與正式 intake profile 版本。這個暫存流程沒有 `public.clients` 寫入。
5. 取得 JUBO 七年全量明細與附件清單；兩份 XLSX 不能證明七年服務、用藥、附件或申報完整。

本機驗證：新增 synthetic Vitest、pgTAP。可選擇在具授權的本機環境對已核准來源執行既有 opt-in 解析測試；測試不輸出個案值，亦不寫資料庫。

## 預設關閉的正式執行環境接線

`trusted-pair-runtime.ts` 沿用本專案 `createServerSupabaseClient` 的 Next.js Cookie session：`getSession()` 只拿原始 access token、不信任其 user 物件，再由 Auth `getUser(token)` 線上核驗及 `is_staff_login_allowed` 放行；資料庫交易內再核對使用者、分支、權限及最近 AAL2。私有連線使用 Node `pg` 的未命名參數化查詢、單連線 pool、TLS 憑證驗證及 Supabase Tokyo transaction pooler。使用者、機構與分支不能從 HTTP body 指定。

`JUBO_PRIVATE_STAGE_ENABLED` 缺值或不等於 `true` 時一律拒絕；啟用仍要求 Production、Vercel Tokyo `hnd1`、正確的 20 碼 Supabase Auth 專案、相同專案的 Tokyo pooler 及 pin 住的機構／分支。`VERCEL_ENV`／`VERCEL_REGION` 必須由 Vercel 系統變數提供；若未開啟系統變數、路由不在 `hnd1` 或資料庫位於首爾，會 fail closed。未新增可用的 API 路由、排程或上傳按鈕，因此候選程式部署也不會自行讀取來源或建立個案。

正式啟用前，DB URL 與 HMAC 必須只設為 Vercel Production Secret（不使用 `NEXT_PUBLIC_`）；不要把憑證寫入 `.env.example`、GitHub 或測試輸出。入口仍需補 Node.js runtime、最大 request body、人工覆核證據取得方式、操作稽核與故障重試 UI，且不得在未完成東京真實 PG、服務角色、交易並行測試前打開旗標。
