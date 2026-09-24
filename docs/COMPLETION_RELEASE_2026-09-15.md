# 第一批補強正式發布紀錄

核對時間：2026-09-15 13:56（Asia/Taipei）。

## 發布結果

| 項目 | 已確認結果 |
| --- | --- |
| 狀態 | 已發布；公司網域已指向同一個通過候選檢查的 READY artifact。不是 89 頁完整營運驗收。 |
| 正式網址 | https://daycare.suiyuecare.com |
| Vercel project | `prj_eiwNI6buPlPXynMCWhatuzqxD74H`／`suiyue-daycare-preview` |
| 部署 ID | `dpl_3eXkvL8YtiecjV8RbMqGmU6uMzU1` |
| 不可變部署網址 | https://suiyue-daycare-preview-c8l6vp622-entrepreneur-9585s-projects.vercel.app |
| 部署來源 commit | `a72079f08d7b3448d8bfe6e96748eecc1e682142` |
| 功能基線 commit | `352f2a4`；發布前另補交易／逾時及停用機構 guard。 |
| 來源 manifest SHA-256 | `0f8c78bd27b2c8a75c8cd6c48c7adc28f3ea985bbc00923f9ee3ff453b43754d` |
| 執行區域 | 部署 API 回報 `hnd1`。沒有遷移 Supabase、變更方案或新增付費資源。 |
| Supabase project | `mmxqxsokpcdvuzmdhptg`；migration 112 → 115，最新 `20260914131934`。 |

本次使用既有專案的 Vercel CLI 候選發布及 promote；未推送公開 GitHub 分支，未覆寫原有 dirty checkout。保護設定、Google 身分驗證及既有角色權限不變，未新增正式帳號或上傳真實個案測試檔。

## 前台入口與交付邊界

| 操作入口 | 本次新增 | 尚未代表完成的事 |
| --- | --- | --- |
| 統計報表 → 收案與補件表；`/app/intake-completeness` | 身分／聯絡／同意／文件／每週到站設定的 13 項完整度與來源連結 | 不等於 CMS 封存、掃毒已接通；不作法定或臨床核准。 |
| 統計報表 → 員工證照到期與補件；`/app/staff-qualification-readiness` | 到期、30 日內到期、未核驗、缺證明等清單 | 不等於已完成排班／服務資格阻擋或通知發送。 |
| 統計報表／單店總覽 → 出缺勤月報；`/app/store-attendance-month` | 逐日已登記出席／請假／缺席、整月人次及不重複出席人數 | 沒登記不推定缺席；尚未接上 Finance 真實收入支出。 |
| 表單與規則版本 → 建立自訂表單 | 機構草稿設計、欄位驗證、畫面試填、基準版本與重送保護 | 試填不保存正式個案答案；發布後正式填答／停用／下一版仍待完成。治理寫入沿用既有重新驗證政策。 |
| 整合與稽核中心 → Finance 串接檢查 | 設定缺漏、格式與資料範圍檢查 | 檢查不發出 Finance 請求、不寫帳，格式完整不等於連通或對帳完成。 |

各入口依來源權限顯示，不保證每個角色都看得到全部報表。

## 資料庫發布及資料保全

發布前 dry-run 僅列三筆；沒有長於 30 秒的非閒置交易；`form_versions` 原為 0 筆、總大小 40,960 bytes。三份新增 migration 各有 BEGIN／COMMIT、5 秒鎖定等待、30 秒 statement timeout。

| Migration | SHA-256 |
| --- | --- |
| `20260914131429_intake_completeness_report.sql` | `58fa2823e200d871cf7da665e5f87478d44912d820f108c53b87082cb3459c3d` |
| `20260914131437_custom_form_draft_authoring.sql` | `25dfe37760dd9c3b8f7316fe753b498218396b60e977b1a1e253ad87cd4f6782` |
| `20260914131934_store_attendance_month_report.sql` | `7df3804a012ee3a92ca2b7b48ab865134cb75ca7f3b24c585e95839dcdf31074` |

- 正式 `supabase db push --linked --yes` 成功且只套用上述三筆；再次 dry-run 顯示 up to date。
- 18 類既有業務表以筆數及排序 JSON 指紋比對，全部一致；表單比對排除新增的併發控制欄位 `draft_revision`，其型別、NOT NULL、預設 1 另行查核。
- 比對涵蓋個案、量測、照顧、出勤、表單、角色／權限／membership，以及收案、每週設定、附件／掃毒／覆核歷程。只讀取數量及指紋到驗證輸出，不輸出原始個資。
- 11 個新增函式 owner 均為 postgres、固定空 search_path；4 個 public 入口為 SECURITY INVOKER，僅 authenticated 可執行。PUBLIC、anon、service_role 無 EXECUTE；非入口內部 helpers 也未授予直接執行。
- 新增私有冪等回執表 ENABLE／FORCE RLS；anon、authenticated、service_role 無直接讀寫／刪除／truncate 權限；5 個索引均 valid／ready。
- 既有已發布表單保護函式指紋不變；表單稽核、key 不可變、發布後不可變及時間戳 trigger 仍啟用。
- 停用機構即使分支、角色與登入仍有效，自訂表單讀取、建立、編輯及既有回執重播都被拒絕。

## 驗證紀錄與限制

| 層級 | 已通過結果 | 不能據此宣稱 |
| --- | --- | --- |
| 本批功能基線 | 完整 Vitest 4,275 通過／1 個既有跳過；本機 build；89 路由展示煙霧；新功能 390px／1440px 畫面互動。詳見第一批文件。 | 這些是本機合成資料，不是真人 Google 或正式資料寫入驗收。 |
| 本次發布前 | 再跑 lint、typecheck、diff check；新增匿名 probe lint／語法檢查通過。 | 不是第三方滲透測試。 |
| SQL 全回歸 | 115 migration 編譯，111 測試檔、4,999 assertions 通過；93 legacy PGlite fixture、18 enforced admission suites 分開計數。 | PGlite 不等於正式 Auth／Storage。 |
| 原生 PostgreSQL 17.11 | 585 流程 assertions、9 額外 ACL／Storage／索引；104→115 升級指紋一致；真實雙連線同 key 一筆、不同 key 同基準一成功一衝突；啟用冪等。 | Auth／Storage 仍為本機合成 fixture，未模擬真人登入已完成。 |
| 候選部署 | Vercel production target／skip-domain，雲端 READY；登入 HTTP 200、Google 按鈕可用、非展示模式、no-store；新 3 頁＋4 API 匿名防護通過。 | 未建立或借用正式使用者工作階段。 |
| 切換 | 切換前公司 alias 仍在舊版，promote 同一 artifact 後 alias 精確指向新部署。 | 不是重新建置另一個未驗證版本。 |
| 正式 HTTP | 原有 89 頁匿名正確轉登入且 no-store；收案 16 項、新功能 7 項匿名檢查全數通過，API 拒絕且不回資料／stack。 | 不等同 89 頁業務流程或跨分支真人驗收。 |
| 正式瀏覽器 | 390px、1440px 登入畫面無水平溢出、破圖；Google 按鈕啟用，手機觸控高度 44px；新收案表匿名轉員工登入；JS errors 0。 | 不能越過登入去驗收正式個案資料；新功能內頁畫面驗證仍以本機記錄為準。 |
| 正式錯誤紀錄 | 針對新 deployment、最近 30 分鐘、上限 100 筆查詢，error 紀錄 0；未輸出紀錄內容。 | 這是短時間抽查，不是 99.9% SLA 或全天監控證據。 |

安全 advisor 前後均無 ERROR，既有 1 項 leaked-password protection WARN 未變。RLS 無 policy 的 INFO 167→168，新增一張刻意禁止直接存取的私有回執表；實際直接權限已驗證，未為消除提示放寬保護。既有 WARN 仍需按登入方式及方案完成安全審查：[Supabase 密碼安全說明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)、[RLS 無 policy 提示說明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

## 回復方式

先前正式 artifact：`dpl_38pbwj5piycFYB8N8c3SzitRRnEP`，來源 `d3aeace1751bfe2ac650de7bf4820a89b1bee12f`，已在本次切換前確認 READY。

若發布後出現阻斷問題，將公司網域回復到此既有 artifact，保留本次新增資料、版本及稽核；不要透過 down migration、刪表或移除 `draft_revision` 回復。回復仍須再查 alias、登入、匿名防護及錯誤紀錄。

## 仍未完成與下一步

本次正式環境只有 Google／應用網址／Supabase 設定，沒有 CMS 封存、附件掃毒、Finance 或 LINE 設定。仍保留未配置即停止的保護，也沒有配置收費服務。

優先完成：CMS／文件安全接通 → 收案到今日工作真人流程 → 正式評估及用藥／服務資格 → 官方申報／Finance 對帳。其後再做家屬端與指定 IoT。

完整 10 項缺口、製作方式及量化驗收見 [下一階段製作與驗收清單](COMPLETION_NEXT_ACCEPTANCE_2026-09-15.md)。正式資料上線前仍須真人角色矩陣、效能、備份還原、安全測試及移轉／完整申報週期平行驗收；本次發布不是全系統完成聲明。
