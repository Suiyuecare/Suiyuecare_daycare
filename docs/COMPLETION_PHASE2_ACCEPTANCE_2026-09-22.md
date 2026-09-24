# 日照系統第二批：自訂表單改版、停用與保存版本列印

## 交付範圍與狀態

接續第一批 `COMPLETION_ACCEPTANCE_2026-09-22.md`，本批不修改 Finance、不匯入真實 CMS 個資、不啟用新的雲端服務或付費方案。
本檔記錄本機程式與合成資料驗證；尚未推送、部署或套用正式 Supabase migration，不代表全系統 89 頁已通過營運驗收。

## 使用者流程與驗收

| 功能 | 現場／管理者操作 | 驗收要求 |
|---|---|---|
| 表單複製改版 | 第 82 頁選已發布或已停用的機構自訂版本，填原因，建立下一版草稿，再由既有編輯器調整欄位與生效日 | 不改原版名稱、類型、欄位、日期或內容雜湊；存在草稿時不重複建立；不得複製官方規則作為官方新版本 |
| 表單停用 | 申請人填理由，另一名具相同機構治理權限的人核准或退回 | 本人不可自核；獨立同工作階段驗證證據；全機構可追蹤申請與來源分支；核准後停止新填答，既有草稿、更正與歷史保留；替代版最早於核准次日開始，不回溯截斷原版日期；原發布核准回條仍可冪等重取，不重新啟用 |
| 第二人實際覆核 | 已核准的公司 Google 身分且具機構層級 `forms.manage` 的人，完成本人重要操作驗證後覆核 | 僅表單治理使用專屬權限檢查；原 `has_permission`、`is_active_user`、個案、財務、用藥權限不擴張；未核准身分、跨機構、撤權、失效工作階段或過期證據均拒絕 |
| 保存版本預覽與 PDF | 個案表單填答頁選一筆已保存的草稿、簽署或歷史更正版，準備快照，預覽並下載 | 僅輸出保存內容，未儲存編輯不可混入；逐題順序、0、否、未填、不適用原因完整；草稿不偽裝已簽署；簽署證據不是憑證式 PDF 數位簽章 |
| 短效文件下載 | 由同一登入帳號在 5 分鐘內下載固定快照 | 使用者、機構、分支、工作 ID 與雜湊綁定；重試不延長效期；渲染前、後及最後資料庫等待後檢查權限／期限；未授權或到期不回傳文件位元組 |
| 操作結果不明 | 網路逾時時按原操作重試 | 保留原鍵與原內容；無法核對時不顯示假成功、不允許切換分支造成重試遺失；明確過期的列印工作可終結並另備新快照 |

### 權限邊界

- 日常 Google 登入與草稿填寫沒有因本批而重新增加登入必經驗證步驟。表單發布／停用及個資 PDF 輸出仍屬原有重要操作門檻。
- PDF 準備需 `care_records.read`、`document_printing.read/manage/access`；下載仍需當前逐案範圍、`care_records.read` 及文件 `read/access`。並非取得日常填答權就能匯出。
- 列印工作保存在私有、強制 RLS、不可變表；無一般使用者直接表格權限。必須透過即時授權 RPC。
- 每次讀取 RPC 的稽核標為 `read_authorization_check`，代表授權核對，**不是成功下載計數**。一次 PDF 渲染前後有兩次核對；不能用這個數量推論人員已收到文件。
- HMAC 短效連結沿用伺服器 `DOCUMENT_DOWNLOAD_SIGNING_SECRET`，不增加付費依賴。缺配置時保持停用，不產生可公開存取 URL；正式部署仍需確認平台存取日誌不保存完整 token。

## 技術與重現入口

- Migration：`20260922071952_custom_form_version_lifecycle.sql`、`20260922072008_custom_response_print_snapshots.sql`，須在第一批四個 migration 之後執行。
- API：`GET/POST /api/forms/lifecycle`、`POST /api/forms/responses/prints`、`GET /api/forms/responses/prints/[jobId]/pdf`。
- `node node_modules/vitest/vitest.mjs run --maxWorkers=2`
- `node scripts/test-database.mjs`
- `CUSTOM_PRINT_NATIVE_PG_BIN=<Postgres17-bin> node scripts/test-custom-response-print-native.mjs`
- `CUSTOM_LIFECYCLE_NATIVE_PG_BIN=<Postgres17-bin> node scripts/test-custom-form-lifecycle-native.mjs`
- `CUSTOM_FORM_NATIVE_PG_BIN=<Postgres17-bin> node scripts/test-custom-form-responses-native.mjs`
- `node node_modules/eslint/bin/eslint.js . --max-warnings=0`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/next/dist/bin/next build`
- `node scripts/dev-demo.mjs --port 3107`；另執行 `node scripts/verify-completion-browser.mjs` 和 `ROUTE_SMOKE_BASE_URL=http://127.0.0.1:3107 node scripts/test-page-routes.mjs`。

## 驗收證據

- 已完成的 PDF 樣本：40 題、單題長文跨 3 頁，完整文件 5 頁；已簽署樣本 2 頁。主代理逐頁檢視全部 7 頁，未見缺字、欄位截斷、疊字或頁尾重疊；內容能重新讀取，相同快照重製位元組一致。合成檔僅在 `/tmp/daycare-custom-response-pdf-20260922/`，不是正式個案或正式文件。
- 預覽 HTML 與 PDF 共用純資料模型；瀏覽器元件不載入 PDF 渲染器、字型檔或伺服器密鑰。中文正式渲染使用封存於 repo 的 Noto 字型，渲染前驗雜湊；未支援字元失敗回報，不忽略內容。
- 全套 Vitest：428 個檔案、4,813 項通過；另 1 個跨 Finance repository 的選用測試未啟用，不計入通過。首輪有一個舊文案斷言失敗，已更新為新功能及限制的斷言後完整重跑通過。
- 全套本機資料庫相容性檢查：125 個 migration 載入通過；121 個測試檔案、5,584 個斷言全部通過。其中 93 組使用既有 PGlite 專用身分 fixture，28 組實際執行執行長登入限制；這不是正式 Supabase 驗收的替代品。
- 原生 PostgreSQL 17：三個獨立合成資料測試庫各載入 125 個 migration。列印通過 67 個 SQL 斷言與 12 組雙工作階段競態測試；改版／停用通過 66 個斷言與 6 組競態；填答通過 56 個斷言與 7 組競態，共 25 組。包含重送、同版競爭、撤權、工作階段撤銷、稽核鎖等待及驗證期限跨越；使用實際授權函式，不繞過身分驗證。
- 全套 ESLint、TypeScript 型別檢查與 `git diff --check` 通過。
- 本機瀏覽器：89/89 路由可開啟；本批 8 頁 × 390／1440px 共 16/16 檢查，加上 2 組載入已存填答及列印入口互動，全部通過。檢查單一 main、無橫向溢出、無錯誤遮罩、關閉 dialog 不可見；自訂表單控制項至少 44px、輸入字體 16px。結果位於本機暫存 `daycare-browser-acceptance-Dwr1QA`。
- 正式建置通過；新 PDF 路由的部署追蹤檔已確認包含中文 TTF 及 OFL 授權。仍有既有 `preferredRegion` deprecation 警告，未在這批任意修改部署區域，也未由本機建置推論正式服務區域。
- 本批追加防護：原自訂填答寫入、讀取在稽核鎖等待後重驗即時會員、角色、授權及個案範圍；簽署另重驗原 AAL2 證據。失效時紀錄、回條與稽核全部回滾。

## 正式發布前仍需完成

1. 以目前遠端版本對照這批 migration，確認備份、回復點與預覽環境；本機測試不得直接當成正式資料庫已驗收。
2. 用真實核准帳號逐步完成新版本→送審→第二人發布→個案填答→簽署→預覽／下載→停用；不使用管理金鑰代替使用者。中文 PDF 目前嵌入完整字型，兩份合成樣本分別為 4,496,864 與 4,481,525 bytes；須在部署預覽環境實測完整下載、平台回應大小與耗時限制，不能只由本機串流成功推論正式平台可用。
3. 由機構確認哪個帳號具**機構層級**表單治理角色；本批未替任何人開通或擴大正式帳號權限。單點權限不自動升成全機構表單管理。
4. 另行完成官方量表、ABC 文件逐欄比對、CMS 封存／附件掃毒、正式申報格式與回覆對帳、Finance 對帳、家屬／LINE、備份還原與容量測試等第一批列出的門檻。自訂表單不是這些項目的替代品。
5. 附件型自訂欄位、離線填答、發布送審後的撤回／退修重送，以及尚未生效範本的排期取消仍未完成；本次停用對象為已生效的已發布自訂版本。不可把可開啟路由或合成展示稱為完整實務流程驗收。
