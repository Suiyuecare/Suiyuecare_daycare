# 臺北市 115 年度 A／B／C 收案、行政審核與對照副本

此實作包含逐欄輸入、版本化保存、行政送審／退回／核准／更正與同快照 PDF 對照副本；不等於正式官方範本發布、官方原稿套印、表單完整性認定或本人電子簽署。來源為使用者提供的 15 頁《115 年度臺北市政府社會局社區式品質抽監測 ABCD 表》，A 表標示 114.11 修訂；原 PDF 未更動，未將原 PDF 或真實個案 HTML 放進 Git／部署。

來源 SHA-256：`64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481`。模板鍵 `taipei.daycare.abcd.115.114-11.draft-v1`，適用年度 `115` 與修訂 `114.11` 分開鎖定。

## 已接通

- `TaipeiAbcdIntakeStep` 可嵌入收案第 4 步；props `clientId`、`organizationId`、`branchId`，可選 `today`（父頁臺北日期）、`onDirty`、`onBusy`、`prefill`、`readOnly`、`demo`。以不同個案／機構／分支 key 隔離未送出輸入；不使用 localStorage、IndexedDB 或 Service Worker 保存個資。
- A1–A24、B1–B19、個別化問題清單、四列照顧計畫均有逐項欄位；A 表包含三位聯絡人。B13／B14 照專及中心評估使用不同欄位。每個疾病的罹病時間／治療情形獨立保存。
- `profileToTaipeiPrefill` 只提議語意明確的主檔欄位，不帶完整身分證號、不把主要聯絡人猜為主要照顧者、不把 unknown／other 性別猜為男或女。所有來源帶入為 `unconfirmed`，人工確認前不計已填，不會覆蓋已錄入或不適用欄位。
- `missing`、`not_applicable`、`unconfirmed`、`recorded` 分開；不適用需原因。前後端依同一欄位／選項／日期／範圍白名單驗證。營養／SPPB／跌倒因子／SPMSQ 只顯示完整已確認答題小計，不自動分類、診斷、通報或改照顧決策。
- C1 從臺北月份內的本中心 `source=staff` 實際量測取得；C2／C3 引用該月最新、已簽署、`source_system=local` 的照顧日誌。未簽草稿、外部歷史文件、中央計畫、出勤排程不算執行。C 註記只是核對備註，不是額外執行證明。
- `GET/POST /api/taipei-abcd/drafts` 使用登入者機構／分支及既有逐案權限；已核准公司 Google 身分可以透過專用 routine-intake action 以真實 AAL1 處理一般草稿及行政審核，不偽造 AAL2。A 另需 `clients.demographics.read`，C 另需 `health.read` 與 `care_records.read`；撤銷來源權限後也不能讀到已存快照。正式簽署／敏感輸出不在此例外內。
- 依個案／年度／表別／月份建立獨立線性版本，舊草稿不可更新或刪除。冪等鍵、內容雜湊、基準版本、交易鎖與操作 ledger 共同防止重複／靜默覆寫；儲存後再 GET 比對版本、ID、雜湊才顯示成功，逾時保留原操作鍵。
- 資料表在 private schema、強制 RLS、無一般角色直接資料表權限；公開 RPC 為 invoker，私有 guarded core 使用空 search_path。稽核不記錄答案／病情／附件內容。
- `POST /api/taipei-abcd/workflow` 送審前逐區確認資料狀態，有未填時要明列待補原因；未確認的 CMS 建議不能送審。這只是行政送審，未填仍為未填，不會因備註／核准就變成臨床完整。核准／退回限有效且已生效的主管角色，且必須不同於填表人及送審人。送審後凍結；退回可續填；核准後必須以理由建立連結原版的更正版。
- 行政審核事件與輸出快照不可修改／刪除。操作鍵重試返回同一事件，前端再讀回指定草稿與審核序號／事件後才顯示成功；處理中鎖住換案，未存審核理由也會觸發換案提醒。
- C 表預設顯示已保存的來源，與送審／核准／PDF 相同；目前最新來源另收合顯示且明確標示不是已保存版。新來源只有另存新的草稿版本才會被納入；核准版本先建立更正版，不回頭改寫。
- `POST /api/taipei-abcd/exports` 只接受真實近期 AAL2、逐案來源權限及 `document_printing.read/manage/access`。以指定版本與審核序號建立不可變快照，包含當時機構／個案顯示資料；相同操作鍵重試不改用新的主檔值。API 以 no-store、sandbox、same-origin PDF stream 回傳，附 PDF／快照 SHA。前端核對 bytes SHA 後，預覽、列印、下載使用同一 PDF blob；五分鐘或離開頁面會撤销 blob URL，但無法收回使用者已下載／已列印的副本。
- 對照副本逐項列出 A 80／B 431／C 3 個輸入欄位與原稿頁碼，保留缺漏、不適用原因及來源待核對；C 附保存當時的真實來源。採固定 OFL `NotoSansTC-Regular.ttf`（來源、轉換及 SHA 見 `assets/fonts/README.md`），不依賴假核准字型／表單設定。僅本輸出啟用驗證過的 shaping 與短列不拆頁選項，共用 renderer 的預設不變。
- D 是小規模多機能臨時住宿表，本純日照範圍不啟用；API／DB 拒絕 D，不讓 CMS 的 D 區段或服務碼冒充 D 表。

## 明確尚未完成的正式驗收

1. 正式官方範本發布、雙人核准及 A／B／C 各責任人本人簽署。Migration 沒有插入假核准 `form_versions`，所有資料固定 `draft/pending_approval`。
2. 官方原稿等比例 PDF 套印、圖像欄位、正式簽名欄、Tagged PDF／螢幕閱讀器文件驗收。現有 PDF 明示「官方欄位對照副本、非官方原稿版面、未電子簽署」，不能稱為原表正式完成。
3. A3 是受限個案主檔身分核對參照，不在表單草稿重複保存完整證號；要輸出正式 A3，需沿用敏感欄位權限與正式 PDF 匯出。照片、家系／生態圖、皮膚人形圖需由文件管線提供真正已驗證附件，填入編號不代表附件存在或通過覆核。
4. C2 的個別化問題／執行對照與 C3 活動／同儕互動仍須人工核對原始照顧紀錄，不能只因有來源筆數就標示表單完成。設備量測尚未納入，待受治理設備來源契約另行接通。
5. 原表 SPPB 時間區間有未涵蓋邊界，不猜補時間轉分數。ADL／IADL 原表未提供逐題選項／公式，不擅自猜分。SPMSQ 不識字等原表未載修正规則不推定。
6. 真實使用者端到端驗收、50 人並發驗證、完整官方表逐欄業務覆核及第三方安全／無障礙驗收仍屬上線門檻；本機 PGlite／原生 PostgreSQL 測試不等於正式帳號完成流程驗證或部署。
7. 單份對照 PDF 目前上限 30 個輸出區塊／50 個行政審核事件，超出或字型缺字會整份拒絕，不截掉欄位或來源；超大月份需另設可追溯分冊規格再開放。

## 本機驗證

`pnpm exec vitest run src/lib/taipei-abcd src/app/api/taipei-abcd src/components/taipei-abcd`：98 tests；包含逐欄白名單、CMS 分欄、缺值、AAL1 行政動作、輸出真 AAL2、API 回條、UI 重送／dirty／讀回、C 畫面與 PDF 同來源、完整中文字型／字形度量、PDF 確定性及全部欄位對照。

`node scripts/test-database.mjs taipei_abcd_intake_drafts.test.sql taipei_abcd_administrative_workflow.test.sql`：56＋46 assertions。沒有 legacy auth override；新流程使用真實已核准 Google AAL1 身分、本人獨立角色，以及實際 AAL2 證據的合成 fixture。涵蓋來源權限撤回、角色停用／未生效、異人覆核、版本凍結、更正鏈、輸出重送快照不漂移與 ACL／稽核隱私。

`TAIPEI_PDF_QA_DIR=artifacts/taipei-abcd-review/final pnpm exec vitest run src/lib/taipei-abcd/workflow-export.test.ts` 產生僅合成資料的 B 表 PDF 與逐欄期望清單供 Poppler 視覺／pdfplumber 邊界驗證。產物不是正式個案或原稿簽署表。
