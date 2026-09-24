# 文件逐份處置與週表重送保護：正式發布紀錄

核對時間：2026-09-15 14:47（Asia/Taipei）。本批是下一階段的第一個可交付切片，不是全部 89 頁或正式營運驗收完成。

## 發布識別

| 項目 | 結果 |
| --- | --- |
| 公司網址 | https://daycare.suiyuecare.com |
| Vercel project | `prj_eiwNI6buPlPXynMCWhatuzqxD74H`／`suiyue-daycare-preview` |
| 已上線部署 | `dpl_EdyJQ12CU7gQcK4rGbNDaCgYuuFv`，READY |
| 不可變網址 | https://suiyue-daycare-preview-pmg4jx4h4-entrepreneur-9585s-projects.vercel.app |
| 應用來源 commit | `2d354e460839890bbd7b75eff841b0f8a31c1a0b` |
| 來源 manifest SHA-256 | `261aaa481f7f9818a7dd0a0090634df64759da7bcc7767448a58c282acd3eecf` |
| 本機分支 | `codex/document-lifecycle-20260915` |
| Supabase project | `mmxqxsokpcdvuzmdhptg`，ACTIVE_HEALTHY |
| Migration | 115 → 116，最新 `20260915061004` |
| 區域／費用 | Vercel API 確認執行區域仍為 `hnd1`；Supabase 仍為原有 `ap-northeast-2`。沒有搬遷、變更方案或新建付費基礎設施。 |

以 production target／skip-domain 建置候選，通過候選檢查後 promote 同一 artifact；切換前後均以公司網域 inspect 核對部署 ID。原有 dirty checkout 保留；本次沒有推送／改寫公開 GitHub 分支，使用既有 Vercel 專案發布。新增發布文件的 commit 不會改變上述應用來源。

部署來源清單為 1,001 檔，以排序後的來源路徑／uid／size 計算上述 manifest；不包含 `.env*`、根目錄 `supabase/`／`infra/`／`docs/`，也未包含 HTML、PDF、Word、Excel 原始檔。應用本身的 `src/lib/supabase/*.ts` 是必要 SDK 封裝程式，不是資料庫遷移或機密檔。

## 使用者入口與本批範圍

進入「個案匯入與收案」，選擇個案，再選「應備文件」：

- 六類補件卡片先呈現狀態，點開後才顯示上傳或類別處置欄位。
- 「逐份文件與歷史」可按類別、每頁 50 份查閱；同次查詢最多 5,000 份、效期五分鐘，超限或過期明示。
- 單份藥袋可獨立覆核、要求補正、停用及重新覆核採用；原始檔保留，不能把文件處置當成停藥、醫囑或已給藥。
- 不同藥袋可並存，不以上傳新檔推定其他藥袋失效；停用／過期才標示歷史用途。
- 成功回條後若補件摘要讀取失敗，舊摘要收起且禁止舊版本操作，重新查詢而非重複儲存。
- 「每週到站與接送」與單日例外在未知結果時固定原內容、版本及冪等鍵；首次確定衝突須人工讀取、比對、勾選後才更新基準。

既有角色、個案／類別權限及重要操作重新驗證政策不變；不開通新的正式帳號。CMS 原始檔封存及附件 TLS 掃毒沒有接通，**上傳仍維持停用**。

## 資料庫與資料保全

唯一新增 migration：`20260915061004_client_document_lifecycle_and_history.sql`，SHA-256 `cc183b199b57af661378e6fdc5a8069b84f42957621c8cb331f0bb0eca4bb32f`。

- dry-run 僅列此一檔；正式 push 成功，再次 dry-run 為 up to date。
- BEGIN／COMMIT、5 秒 lock timeout、30 秒 statement timeout；發布前長於 30 秒非閒置交易為 0。
- 18 類既有表在升級前後的筆數及排序內容指紋完全相同；只輸出雜湊，不輸出明文個資。包含個案、角色、權限、表單、量測、收案、週表、附件及 ABC 行政歷程。
- 五個新增私有資料表均 ENABLE／FORCE RLS；anon、authenticated、service_role 無直接 SELECT／INSERT／UPDATE／DELETE／TRUNCATE。
- 八個新函式 owner 均為 postgres、固定空 search_path。兩個 public RPC 為 SECURITY INVOKER，僅 authenticated 可執行；非入口 helpers 無直接執行授權。
- 18 個新增索引均 valid／ready。逐份事件與回執不可刪改；只允許在同讀者／同個案重新查詢時清理最多三個已過期導覽快照，不刪原文件或稽核。
- key lock 與 category lock 等待後皆重新驗權；停權、跨範圍或不符重新驗證條件者不能寫入或重播回條。

安全 advisor 無 ERROR；既有一項 [leaked-password protection WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 未變。刻意禁止直接存取的私有表增加五張，因此 [RLS no-policy INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 168 → 173；未為消除提示放寬表權限。

## 驗證結果與邊界

| 層級 | 證據 | 不代表 |
| --- | --- | --- |
| 程式 | lint、TypeScript、production build 通過；Vitest 4,393 通過、1 個既有跳過。 | 不等於正式登入、官方表單或全部流程完成。 |
| SQL 相容回歸 | 116 migrations、112 檔、5,109 assertions；末次理由欄位相容修正另跑新文件 111＋既有文件 50＋補件表 33，全數通過。93 legacy fixture 與 19 enforced suites 分開計數。 | PGlite 不等於正式 Auth／Storage。 |
| 原生 PostgreSQL 17.11 | 最終程式 696 assertions＋9 項 ACL／Storage／索引；104→116 保留合成資料指紋；實際雙 writer 同 key 一筆、同基準一成功一衝突；兩種鎖等待途中撤權零新增。 | 仍是合成 Auth／Storage fixture，不是真人 Google 或檔案掃毒。 |
| UI | 同個案、同 viewport 的舊／新程式實拍；390px／1440px 無橫向溢出，44px 控制項、16px 輸入、鍵盤 Enter 展開、焦點可見。 | 不冒充 WCAG 全面人工驗收。 |
| 候選 | 保留 Vercel 平台保護，透過既有 CLI 授權檢查三個 API、收案入口及可用的 Google 登入按鈕，5／5。沒有應用登入工作階段。 | 平台授權不等於應用登入或個案授權。 |
| 正式 HTTP | 公司網域 89 頁匿名轉正確登入且 no-store；18 項收案／文件及 7 項前批功能檢查通過，拒絕回應無資料、無 stack。 | 不是 89 頁業務或跨分支真人驗收。 |
| 正式瀏覽器 | 收案入口匿名轉 staff login；390px／1440px Google 按鈕啟用、無溢出或破圖、JS errors 0。 | 沒有越過 Google 登入，也沒有上傳真實個案。 |
| 短時間錯誤抽查 | 本部署最近 30 分鐘、上限 100 筆 error 查詢為 0；未輸出紀錄內容。 | 不是長期 SLA、全時監控或效能壓測。 |

手機附件區預設高度 8,919.84 → 3,349.84 px（約減少 62%），桌面 3,668.75 → 1,723.89 px（約減少 53%）；這是欄位收合後的閱讀長度，不是少了資料欄位。改善前後對照為本機合成截圖，保留於 `/Users/seniorlifepr/.codex/tmp/daycare-document-comparison-20260915.html`。

## 回復與下一批

前一正式 artifact：`dpl_3eXkvL8YtiecjV8RbMqGmU6uMzU1`，應用來源 `a72079f08d7b3448d8bfe6e96748eecc1e682142`。若需回復前台，切回該 artifact，再驗證網域／登入／匿名防護；保留本次新增資料、處置版本及稽核，不以 down migration 或刪表回復。

下一批仍需補：待收案與正式分工口徑、同個案正式收案交接、交通需求與已派／未派車對帳。其餘正式量表、申報、Finance、家屬、IoT 等維持下一階段清單。正式 CMS／附件啟用另需公司封存／掃毒資源、供應商及資料區域審查、真實服務 canary 與真人流程驗收；本次沒有增加費用或解除任何上傳保護。
