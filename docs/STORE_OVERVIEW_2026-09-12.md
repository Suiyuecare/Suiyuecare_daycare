# 單店出勤與收支：實作與驗收紀錄

狀態：**本機實作及合成資料驗證；未推送、未部署、未綁定正式 Finance。**
本批不代表日照系統已通過正式營運驗收，也不代表原先未發布的改善批次已上線。

## 使用者核定範圍

新增 `/app/store-overview`「單店出勤與收支」，保留原 89 頁及獨立入口。
頁面只有個案出缺勤與 Finance 該店收入、支出；沒有新增薪資、人資、投資報酬、
醫療、品質指標、線上付款、財務編輯、跨店總覽或投資人帳號。

介面依 uiux-simplify-software 技能收斂成兩區，沿用現有 Finance 配色、框架及
ModuleLoading，不使用工程欄位作為現場說明。僅將共用讀取動畫的說明文字改用
既有深灰棕色，修正白底對比不足；動畫速度、條寬、框架均未改動。

## 已實作

- 選出勤日期及收支月份，預設臺北今天／當月；兩者可以各自調整。
- 出勤依 `attendance_records.service_date`、機構、分支及現行根紀錄統計。
  每個案／天只算一次；只有明確 `absent` 算缺席，未登記不算缺席；取消與更正
  佐證不重算。歷史出勤不因個案現在結案而消失。沒有虛構應到人數或出勤率。
- Finance 使用另一專案的唯讀月收支 API；不把日照帳單或收款資料當成 Finance。
  沿 Finance P&L 分類帳定義，不是銀行現金收付款，也不是已核准月結證明。
- 只有數字彙總、期間與來源讀取時間傳入畫面，不傳個案身分、分類帳明細或密鑰。
- 成功出勤及 Finance 查閱均記錄最小稽核；Finance 稽核／再次授權失敗時不顯示金額。
- 缺設定、逾時、來源失敗、真正零紀錄、非法日期、資料過期與離線均分別處理。
- 離線隱藏人數／金額；恢復連線後必須以完整 GET 重新驗證會話及資料，不能由
  online 事件或舊 RSC 重新渲染解除保護。不寫入 localStorage／sessionStorage。
- 原 service worker 仍不快取 `/app/` 或 API；新頁 force-dynamic，HTTP private/no-store。
- 導覽先由伺服器權限過濾；直接路由及資料讀取再次檢查資料庫權限。

## 權限與 Finance 邊界

Daycare 使用既有已釘選的 Google CEO 活會話規則，並要求有效
`organization_manager` 同角色具 `attendance.read`＋`clients.view_all` 全店權限。
沒有新增 MFA 關卡、放寬既有寫入／簽署／匯出限制，或新增其他可登入帳號。

資料庫新增三個 public invoker RPC，私有 helper 均設空 search_path 及最小 grants：

1. `can_read_store_overview(org, branch)`：只確認當前呼叫者可否看這間店。
2. `read_store_attendance_summary(org, branch, date)`：同一 SQL 彙總，成功查閱稽核。
3. `record_store_finance_summary_read(org, branch, month)`：再次授權及最小查閱稽核。

Finance 端在獨立 worktree `/tmp/finance-daycare-summary.xtou9v`，本地 commit
`f6587f89a76e95f9dedd1622b1c15038d697e0a1`；不得 cherry-pick 到 Daycare repo。
它的私有 binding 沒有預設資料，需確認目前正式 Finance 組織／法人對應後才啟用。
原 Finance dirty checkout 完全保留；本批沒有修改帳務資料。

Daycare 只向設定中的標準 Supabase HTTPS function URL 發送專用 token，不接受
瀏覽器指定 URL／entity；禁止重新導向，回應限制 16 KiB，驗證 request ID、機構、
分支、月份、entity、幣別、口徑及來源時間，並保留精確小數與沖銷負數。

Finance 口徑：4／7 科目收入為貸−借；5／6／9 科目支出為借−貸。依既有 P&L，
先按科目彙總，排除淨額絕對值 ≤0.4 的科目，再相加。正式啟用前必須對帳包含
沖銷及 void 標記的月份（Finance P&L 與首頁有既存排除規則差異，不可混用）。
任一該 tenant／月 production 分錄無法人對應時，保守拒絕顯示，不能漏算後回傳完整。

## 本機驗收證據

- `pnpm lint`、`pnpm typecheck` 通過。
- 全量 Vitest（含實際 Daycare fetch → loopback HTTP → Finance handler）：
  **323 個測試檔／3450 項通過**。
- 全量資料庫測試：97 個測試檔／4158 項斷言通過，99 migrations 編譯通過。
  新 gate／出勤／Finance 查閱稽核涵蓋其中 80 項，使用真實 CEO admission fixture；
  原有 93 組 legacy PGlite fixture 的 admission bypass 沒有擴大。
- 原 89 頁路由 smoke：89／89 通過；新頁另外實際瀏覽驗證。
- `pnpm build` 通過，新頁為 dynamic。仍有既存 preferredRegion deprecated 警告；
  本批沒有改雲端執行區域或方案。
- Finance 獨立測試：40 HTTP／adapter、14 PGlite SQL 情境、22 migration lineage 檢查通過。
- 桌機及 390px 手機驗證：頁面、人數／金額卡片、日期／月份送出、手機導覽、
  離線隱藏、上線後重新讀取成功；main 無橫向溢出，輸入／按鈕高 48px、文字 16px。
- axe-core 4.12.1：新頁 main 範圍桌機及手機穩定狀態 0 violations；不是全站 AA 認證。
- 本機 production build 關閉 demo、清空外部整合後，未登入直接開新頁會導回
  `/login?audience=staff`，沒有金額／個案數字或 framework error；HTTP 回應維持
  private/no-store。這是本機未登入防護驗證，不是真實 Google 會話的雲端驗證。
- 初次 CLI 對原生日期控制項的填寫未成功，已用原生 input value 做自動化輸入，
  再實際按提交驗證 URL、期間及頁面；沒有把未送出的畫面當作通過。
- 獨立安全／口徑複核已確認本批 P1／P2 問題收斂；正式環境驗收仍分開執行。

重跑跨 repository contract 測試：

```sh
FINANCE_CONTRACT_REPO=/absolute/path/to/finance-worktree pnpm test
pnpm test:database
pnpm build
```

沒有設定 `FINANCE_CONTRACT_REPO` 時，只有跨 repo HTTP 測試會跳過；其他測試照常跑。
本機展示使用 `pnpm dev:demo --port 3136`，該啟動器會清空所有 Finance 整合設定；
synthetic preview 若帶 Finance 連線設定會拒絕啟動。

## 正式上線前尚需執行

1. 審查 Daycare 既有未發布批次及 migration 差異，避免只推前端造成 RPC 缺失。
2. 由資料負責人核對萬華店在**目前正式** Finance 的法人／部門與歷史資料範圍。
   不把 seed 的 E6／J1101 自動當成正式已核准 binding；若法人含多店，須先拆清範圍。
3. 在隔離、完整 Finance 測試環境驗證 migration、PostgREST、Edge/Deno 與逾時取消。
4. 依 Finance README 建立經審核、有限效期的 binding 與專用 32-byte hex token。
   Daycare 的五個 server-only `FINANCE_STORE_*` 設定見 `.env.example`；不得貼入公開
   repository、前端、對話或日誌。測試及正式環境使用不同密鑰。
5. 正式 Finance endpoint 與 Daycare migration／前端部署後，用真實授權會話逐月
   對帳：空月份、一般月份、沖銷月份；測試跨店、過期 binding、停用會話與來源停機。
6. 正式 Chrome／Safari、Google 登入、雲端 RLS／Edge、代表性資料量與壓力測試仍待驗收。

本批沒有執行 production DDL、建立真實 binding、配置密鑰、推送、發布或購買服務。
