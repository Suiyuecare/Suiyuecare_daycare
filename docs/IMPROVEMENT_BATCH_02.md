# 第二批改善：可信上傳暫存與斷線重試

日期：2026-09-11。**本機實作；未推送、未部署、未套用雲端 migration。**

## 本批完成的範圍

中央 HTML 的受控暫存後端，尚未接上現場匯入頁。它不是完整 `ProductionImportStorage`，不是正式個案入檔，也不是主管核准欄位映射。

1. 伺服器先複製原始 bytes，驗證檔名、MIME、大小、UTF-8，並使用現有靜態解析器；拒絕不合法或過大的解析內容後才建立預約。不接收瀏覽器提供的解析結果或封存證據。
2. `reserve_import_upload` 用目前使用者 JWT 建立機構／分支／人員／session／重新驗證證據綁定的預約。資料庫決定 UUID 與初始時間；重試不能變更檔案、範圍或初始封存時間。
3. 使用已有的 `S3ComplianceArchive` 介面先封存並驗證固定物件版本。此輪僅注入模擬 AWS，不建立雲端桶、KMS 金鑰或七年不可刪物件。
4. 只有 server worker 可呼叫 `complete_import_upload`。依不可變預約重新驗證目前 CEO 政策、Google 身分、實際 Auth session、員工狀態、分支、角色、權限與近期驗證證據；不能由 worker 任填另一人的權限。
5. 在一個資料庫交易保存完整解析 JSON、未知欄位、封存參照、完整內容雜湊與不可變回執；寫入後故障連同該次稽核回滾。回執固定 `staging_only: true`、`formally_imported: false`。
6. 若完成回應遺失，同鍵重試會取得原始回執，不重新封存。回執核對完整 JSON 文字的 SHA-256，不僅比較筆數或正規化內容；解析原值、來源位置、警示等也被綁定。

兩張新表均在 `private` schema、強制 RLS、撤銷所有一般 API 直接表權限；不可變觸發器阻擋改寫與刪除。它們與舊有可由 authenticated 寫入的 `public.import_*` 分開，避免把舊暫存列誤認成伺服器驗證證據。

公開 schema 的兩個 RPC 僅作 security-invoker 包裝；權限操作位於固定空 search_path 的私有函式。worker 暫時採用預約內經驗證的最小 claims，成功與例外皆還原 claims、legacy sub／role；不保存 JWT token 字串或 editable user_metadata。做法參照 [Supabase RLS 與安全函式說明](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 現有介面與安全限制

| 介面 | 呼叫者 | 結果 |
| --- | --- | --- |
| `stageTrustedHtmlImport` | server-only，須明確注入使用者、worker 及封存依賴 | 驗證原始 bytes，串接預約／封存／完成；只回傳核對過的暫存回執 |
| `reserve_import_upload` | 已授權員工 JWT | queued 預約，或同筆已完成的暫存回執 |
| `complete_import_upload` | 只有 service_role | 重新查驗原預約權限後，交易式保存私有解析內容與回執 |

- 沒有自動建立 service-role client、讀取密鑰、註冊 production repository 或開放新的 HTTP 路由。不能單靠新增環境變數就讓正式匯入頁繞過既有阻擋。
- 完成 RPC 的 `p_parsed_payload` 是伺服器產生的 **UTF-8 JSON 文字**，資料庫解析為 JSONB 保存，但雜湊使用原始文字。不得換成 JSONB 序列化後再計算，兩者空白／鍵排序不同。
- SQL 只能驗證封存參照一致性，不能自行確認 AWS 真實加密或 WORM 狀態；正式啟用必須使用實際驗證過的 S3 adapter。
- 來源值／檔名／最小 claims 均在私有資料內；稽核只保存欄位名稱、操作識別及必要 metadata，不保存上述內容。公開錯誤不含 SDK／SQL 原文、cause、來源值或密鑰。
- 一般 Google 登入、CEO 白名單與既有敏感操作權限未改動。

## 重試與尚未完成的復原情境

**可處理：**原 session 與證據仍有效期間，同鍵同內容重試、封存失敗重試、資料庫成功但回應遺失的結果查回。資料庫交易失敗不會建立完成回執；已封存物件不刪除、不縮短保留期限。

**保守阻擋：**同一來源換新鍵、同鍵改內容、換 session、原始授權證據或 JWT 到期。新鍵同內容目前回傳「已有上傳預約」，尚未支援舊 UI 的改名 duplicate alias 回執。未完成預約若授權失效，需後續受控重新授權／人工對帳流程；不能宣稱反覆按重試必定成功。

因此，**正式部署仍先阻擋**。下一批需補上到期預約復原、WORM 孤兒清冊、欄位權限預覽與完整 repository 接線，再驗證原本 upload／preview／reparse／approve 契約。不可直接把這兩支 RPC 當作完整替代。

## 驗收紀錄

- 74 項 TypeScript 合成測試：靜態解析零外部請求、未知內容保存、輸入在 await 前複製、範圍／檔案／時間／雜湊綁定、archive／RPC 回應完整性、同鍵回執與錯誤去敏。
- 6 項 TypeScript → 本機 PGlite 實際 RPC 整合：真實解析後讀回私有內容、完成回應遺失、安全重試、封存失敗、途中撤銷權限、重複來源及交易故障回滾；AWS 為模擬，CEO gate 使用真實 migration 與合成 Auth 資料，沒有 legacy admission bypass。
- 新 SQL 權限／交易測試 74／74 通過，含 legacy claim.sub 優先權的本機相容測試；未修改共用 Auth bootstrap 或放寬 CEO admission。
- 完整資料庫回歸：**98 個 migrations 編譯、96 套／4,078 項斷言通過**。其中 93 套為既有 PGlite-only 多角色 fixture，3 套實際啟用 CEO admission；新匯入測試屬後者，未加入 legacy bypass 清單。
- 全案程式測試 **318 檔／3,366 項通過**；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 通過。建置仍有既存 `preferredRegion` 棄用警告，本批未改部署區域。
- 本機原生 Supabase advisors／migration list 因 `127.0.0.1:54322` 未運作而未完成；沒有改用正式資料庫測試。額外執行的 89 頁 HTTP smoke 因未啟動本機網站而全部 fetch failed，**不算通過，也不能據此判定正式頁面故障**；本批未改 UI，沒有新增瀏覽器驗收證據。
- 整合時找到並修正三項問題：重試內嵌回執缺少 replayed、未建立的 digest 函式引用，以及未核對完整解析內容的回執雜湊。最終需以修正後測試結果為準，不以初次編譯通過推定可用。

此處 PGlite 是本機 PostgreSQL 相容測試，不代表遠端 Supabase、PostgREST 傳輸、真實 Google 登入、AWS IAM／KMS、並行連線壓測或正式個資驗收。此次沒有讀取／修改真實個案，也沒有加購服務。

## 正式入檔仍需要

公司核准的封存資源／費用與資料區域設定、正式欄位映射與穩定識別字典、逐欄人工核對、附件隔離掃毒，以及正式個案欄位／版本／來源／回執的單一交易。這些需求與今日工作排程、申報／對帳等後續改善，沒有因本批暫存完成而自動完成。
