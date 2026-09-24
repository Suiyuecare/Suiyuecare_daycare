# 收案、每日分工與派車核對：正式發布紀錄

核對時間：2026-09-15 17:53（Asia/Taipei）。本批已發布至公司網址，**不是原規劃 89 頁全部完成，也不是正式營運或真人作業驗收完成**。

## 發布識別

| 項目 | 結果 |
| --- | --- |
| 公司網址 | https://daycare.suiyuecare.com |
| Vercel project | `prj_eiwNI6buPlPXynMCWhatuzqxD74H`／`suiyue-daycare-preview` |
| 已上線部署 | `dpl_3whXwFqWN7zoC5P33ekrPBemtLjx`，READY |
| 不可變網址 | https://suiyue-daycare-preview-8et4jnxu2-entrepreneur-9585s-projects.vercel.app |
| 應用來源 commit | `dbc1fd6b96d30414217ae21372d4518dcfc37c4f` |
| 來源 manifest SHA-256 | `3ea1986606607cb3b34eeb1e031d4df5bafa500f8d6fc2125a9a04e9af5b0fe9` |
| 本機分支 | `codex/admission-dispatch-20260915` |
| Supabase project | `mmxqxsokpcdvuzmdhptg` |
| Migration | 116 → 119，最新 `20260915092620` |

先以 production target／skip-domain 建置候選，保留平台保護並驗證，再 promote 同一 artifact；公司網域 inspect 已核對為上列部署與來源。沒有推送或改寫公開 GitHub 分支；原 dirty checkout 未動。發布文件的後續 commit 不改變上述應用來源。

API／應用函式仍部署 `hnd1`。既有 `_middleware` 維持平台多區域部署，不能將「應用函式在東京」誤寫成所有處理均限定東京。Supabase 維持原有首爾 `ap-northeast-2`；沒有搬遷、變更方案或新增付費資源。建置仍有既有 preferredRegion 棄用與 Node engines 範圍警告，並非此次區域變更。

來源 manifest 共 1,005 檔；沒有 `.env*`、根目錄 `supabase/`／`infra/`／`docs/`、HTML、PDF、Word 或 Excel 原始檔。SDK 的 `src/lib/supabase/*.ts` 為必要應用程式，沒有當成機密檔排除。

## 使用者能看到的變更

1. **個案匯入與收案 → 確認正式收案**：保存／讀回完成才開放接續；目的頁鎖定同一個案 ID，能返回同人的每週安排或文件。無效或無權限 ID 不改選第一人；帶入不自動寫入。
2. **照服員今日工作**：依指定服務日的收案、暫停、恢復及結案歷程判斷適用性；未正式收案、收案前、暫停期、結案生效日以後不列為可新增分工。沒有分工不回退為全機構所有個案。
3. **主管分工處置**：仍保留原有但不再適用的安排，明示原因並讓主管核對、填理由取消；不自動刪除歷史，不顯示不應查閱的照顧證據。
4. **當日接送需求核對**：逐個案、日期及去回程顯示待派車、已派車、重複待核對或無查閱權限；統計與明細同快照。入口帶正確日期／方向到派車頁，沒有冒稱已自動配到單一趟次。
5. **儲存結果保護**：收案與分工重試保留原內容、版本及冪等鍵；未知結果後再被拒絕不代表前次未完成。待確認期間不自動刷新或切分支；刷新／切分支先開始時也阻擋新寫入。
6. **停用與延遲回覆**：機構／分支停用後，即使繞過畫面、等待資料鎖或重送原操作，仍由資料庫拒絕。離開元件後晚到的成功只解鎖已確認操作，不刷新新頁面。

一般 Google 登入與既有 routine 權限例外不變；本批沒有新增或移除 MFA。正式收案、主管分工及其他重要動作仍沿用現行近期 AAL2 規則，不能把此批當成這些動作已免驗證。

## 資料庫與資料保全

| 新 migration | SHA-256 |
| --- | --- |
| `20260915090303_admission_day_roster_eligibility.sql` | `193b20a46e45672ef797db1a374ad0492e5360524f55e9ebfccac580707878ff` |
| `20260915090512_daily_transport_reconciliation.sql` | `82a68ed86a5139e1ffb586a34bb6fdae1287f52660d567546435f21f644ce4c8` |
| `20260915092620_client_lifecycle_active_scope_guard.sql` | `597dee54d7a662ee3acd79b7f3879a8c7d99116b0b46e61a70b2b3d8b0b4f1bf` |

- dry-run 只列上述三檔；正式 push 成功；再次 dry-run 為 up to date。三檔均以交易包住，沒有更改舊 migration 或執行 seed。
- 25 類既有表升級前後筆數與排序內容指紋完全相同，包含個案、帳號、角色、權限、表單、出勤量測、收案、週表、文件、分工、交通與 ABC 行政紀錄。沒有為測試新增正式個案、量測、收案或派車。
- 九個相關函式的正式 owner 均為 postgres、固定空 search_path。anon 與 service_role 無 execute；非入口 helper 對 authenticated 也關閉。public 派車核對入口為 SECURITY INVOKER，經 private guarded wrapper 驗權與稽核。
- 安全 advisor 無 ERROR；既有 [leaked-password protection WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 1 項及 [RLS no-policy INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 173 項未變，未以放寬私有表權限消除提示。

## 驗證結果與邊界

| 層級 | 已完成證據 | 不代表 |
| --- | --- | --- |
| 程式 | lint、TypeScript、production build 通過；最終 Vitest 4,516 通過、1 個既有跳過。 | 不等於所有正式表單已完成或已開放。 |
| SQL 回歸 | 119 migrations、115 檔、5,257 assertions 通過；93 legacy fixture 與 22 enforced suites 分開記錄。交通檔最後只加交易外框後另驗 119 compile＋45 assertions。 | PGlite 不是真實 Supabase Auth／Storage。 |
| 原生 PostgreSQL 17.11 | 104→119 合成升級保留資料；收案相關 843 assertions＋9 ACL／Storage／index checks；週表、文件、帳號啟用並行測試通過。另有正式收案／分工 102 assertions 及 9 組實際鎖競態通過。 | 後者 102 與前者有重疊，不加總為不同案例；全部仍為合成 fixture。 |
| 介面 | shared lock 完成後重啟純合成 demo：首頁、收案、異動頁 × 390／1440px 共六組無溢出、overlay 或 JS error；同 ID 往返、錯誤 ID、主管分工、44px／16px 尺寸另有測試與截圖。 | 不冒充 WCAG 全面驗收；demo 中同一人收案／生命週期 fixture 原有狀態不一致，未拿它當完整收案成功證據。 |
| 候選 | 平台保護保留、無應用工作階段：4 個 API 拒絕、3 個頁面轉登入、Google 按鈕啟用，8／8。 | 平台授權不等於應用登入，未代替真人輸入或簽署。 |
| 正式 HTTP | 89 頁匿名轉正確登入且 no-store；20 項收案／分工／文件及 7 項前批介面檢查通過，拒絕回覆無資料、無 stack。 | 不是 89 頁功能、11 角色或跨分支真人驗收。 |
| 正式瀏覽器 | 新的匿名瀏覽器從收案入口轉 staff login；1440／390px 無溢出、破圖、overlay 或 JS error。Google 按鈕可見且啟用，沒有未設定文字；三張截圖已查看，瀏覽器已關閉。 | 沒有點擊 Google、登入、測試 callback 或讀取個案資料。 |
| 短時間錯誤抽查 | 本部署最近 30 分鐘、上限 100 筆 error 查詢為 0；未輸出 raw logs。 | 不是長期 SLA、效能壓測或正式監控驗收。 |

採用 Supabase 與 Postgres 最佳實務技能檢查交易／權限；Next.js、React 指引檢查路由及狀態；介面簡化技能安排同案交接與現場文字；Vercel 瀏覽器、CLI／API 與部署技能區分本機、候選及正式證據。

## 仍未完成及回復

- CMS 原檔封存與附件掃毒沒有接通，**上傳仍停用**；不能把一般 Supabase Storage 說成已符合不可覆寫封存，也不能跳過掃毒換取開通。
- ADL、IADL、吞嚥、BSRS 等正式表單及官方申報格式仍待版本資料、實作及驗收。其他未完成項目見 [下一階段清單](COMPLETION_NEXT_ACCEPTANCE_2026-09-15.md)，包含自訂表單正式填答、資格串接、評鑑、Finance、家屬端等。
- 交通仍無正式取消趟次工作流；本批處理的是取消每週需求／最新已發布版本移除乘客，不把退回草稿當成取消已發布趟次。
- 操作鎖只存在該分頁記憶體，沒有保存個資；不是強制關閉、跨分頁或離線後的持久化復原。
- 真人 Google、代表角色作業、正式用藥簽署、備份還原、50 人壓測與完整申報週期仍須另驗。

前一正式 artifact：`dpl_EdyJQ12CU7gQcK4rGbNDaCgYuuFv`／來源 `2d354e460839890bbd7b75eff841b0f8a31c1a0b`。需要回復前台時切回該 artifact，再驗證登入與匿名保護；保留本次安全 guard、版本與稽核，不以 down migration 或刪除資料回復。
