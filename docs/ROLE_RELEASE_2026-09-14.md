# 十一類職務與第一批改善：正式發布紀錄

日期：2026-09-14。使用者本輪要求「推到前台」。範圍為本任務尚未發布的第一批主管準備／接續工作／逐人授權底座，以及十一類職務分類；不開通帳號、不改派會員、不匯入真實個案、不改 Finance、不加購服務或更動區域。

## 發布來源與前置檢查

- 功能基線：`75e709c`，含 `6ad9602` 及 `75e709c` 兩批功能變更；上一版正式來源 `4064291fa5e95b623b81d675c11954085e291b00`。
- 上一版 production：`dpl_D6MVb5pnH25kLjKEvjXMuMVvdtti`；本輪已重新核對公司 alias 確實指向此版，不採用舊文件當成即時證明。
- Vercel 專案 `prj_eiwNI6buPlPXynMCWhatuzqxD74H`，公司網址 `daycare.suiyuecare.com`。MCP 缺少此 team 權限，改用既有 CLI 登入的授權；未修改保護設定或憑證。
- Supabase `mmxqxsokpcdvuzmdhptg`／ACTIVE_HEALTHY／PostgreSQL 17。沿用首爾資料庫與 Vercel 東京函式區域，不新增付費分支。
- 遷移前 102 個版本、10 個系統模板、1 個 Auth 帳號、1 個會員、1 筆角色指派、0 筆 care_records。單點角色空分支及主任 key／UUID 碰撞均為 0；無超過 30 秒的非 idle 長交易。
- 原會員、角色指派及舊 role permissions 的不可逆摘要已於操作前保存並於操作後核對；未輸出身份資料、Google subject 或 session/token。
- Security advisor 基線：152 筆 RLS 無政策 INFO（刻意封閉 RPC 表）、1 筆既有密碼防護 WARN、0 ERROR；不以增加寬鬆政策消除提示。
- 已讀取 Github 最新公開 orphan baseline，確認與此已驗收版本不同且缺少先前上線功能。本輪不覆寫該分支、不推送本機舊歷史，直接發布受驗證 checkout 至既有 Vercel 專案。
- `vercel deploy --dry --json`：916 個實際上傳檔案、6,895,416 bytes；無環境檔、原始 HTML、docs、tests、scripts、Supabase migration 或私人資料。既有 `.vercelignore` 保留。

## 資料庫順序與發布中發現的修正

1. `20260913111916_approved_staff_routine_care_access.sql`
2. `20260913123658_eleven_role_taxonomy_branch_scope.sql`
3. 核對資料庫後，建立 production candidate，但不先切換公司網域。
4. 候選驗證成功後才 promote 相同 artifact；不重新建置另一版本。

第一次 CLI push 成功套用第一份；第二份在 `SET LOCAL`／`LOCK TABLE` 回報 SQLSTATE 25P01（未處於 transaction），在更新任何角色前安全停止。原先註解「Supabase migration 一定在 transaction」不符合本輪實際 CLI 2.105.0 行為。不得移除 lock；改在尚未成功套用的第二份 migration 明確包覆交易並重跑升級／角色測試。第一份已成功的遷移與 hosted history 不改寫、不 repair。

此時中間狀態已核對為 103 migrations、10 系統角色、0 主任、0 routine grant；帳號／會員／指派仍各 1，care_records 仍 0，前台仍為舊版。這不是遺留半完成的角色指派。

修正來源 `c97400d715905b5c42e61032b26a3d010ec78e64` 僅改第二份 migration 的明確交易、升級測試及該修正紀錄。104 migrations 編譯、角色 SQL 51/51、upgrade 20/20、scoped ESLint 及 diff check 通過。重跑原生 CLI dry-run 僅列出第二份，`supabase db push --linked --yes` 成功套用，沒有移除鎖、降低 guards 或改寫已套用版本。

## 最終驗證與發布結果

### Deploy Result

- URL：<https://daycare.suiyuecare.com>
- Target：production；Status：READY。
- Source：`c97400d715905b5c42e61032b26a3d010ec78e64`（deployment 的 gitCommitSha／githubCommitSha 均相符）。
- Deployment：`dpl_6qFxjMKS1PawMKShBmNwv6jDuQEs`。
- Artifact：<https://suiyue-daycare-preview-c6udbjwle-entrepreneur-9585s-projects.vercel.app>。
- Framework：Next.js 16.3.3；原生雲端 production build／TypeScript 通過，Vercel buildingAt 至 ready 為 53,921 ms；函式區域仍為 `hnd1`。建置在 iad1 執行，不代表個案資料執行區域改成美國。
- 候選透過 `deploy --prod --skip-domain` 建置；先證明公司 alias 仍指向舊版、檢查候選，再 promote 同一 artifact。最後公司 alias 已指向上述新 deployment；沒有重建、清除網站保護或更動環境變數。
- 核對完成時間：台北 2026-09-14 00:52。

### Hosted 資料庫與保留證據

- 正式 history：104 migrations，最新 `20260913123658`；11 系統角色。
- 主任恰有 `clients.read`、`clients.view_all`、`attendance.read`、`care_records.read`、`services.read`、`notifications.read` 六項；額外權限與人員指派為 0。兼任護理／社工需另外核准角色與資格，沒有自動授予臨床寫入。
- 單點管理員／主任 NULL 分支指派及相關不合規指派申請為 0。
- 原會員、角色指派、原有 role permissions（排除新增主任）三份摘要與發布前完全一致；Auth 帳號／會員／指派仍各 1，care_records 與 routine grants 仍為 0。Google 入口瀏覽器檢查後再次確認相同筆數。
- 原 `is_active_user`、`is_active_executive_reader`、`has_recent_aal2`、`has_executive_read_permission` 函式定義摘要未變。不冒用執行長 JWT，也不把相容性核對宣稱為真人登入驗收。
- 新私有逐人授權表 owner postgres、ENABLE/FORCE RLS，anon／authenticated／service_role 無直接資料表讀寫權限，仍為 0 筆。兩個新 public RPC 保持 SECURITY INVOKER、空 search_path、匿名拒絕。
- 三個 scope trigger function 為 postgres owner、SECURITY DEFINER、空 search_path，PUBLIC／anon／authenticated／service_role 直接 EXECUTE 全拒絕；trigger 均啟用且掛在正確事件。原 membership 身分／組織／分支不可變 guard 仍在。
- `active_memberships` 保持 security_invoker、security_barrier、本人及有效期間篩選。六張依賴表皆 FORCE RLS，新增 13 個 routine policy 全為 SELECT-only。`profiles` 原有 authenticated 部分 DML grant，不宣稱所有底層表皆禁止直接 DML。
- Security advisor：153 筆 [RLS 無政策 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)（比基線多一張刻意封閉的新表）、1 筆原有[密碼防護 WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)、0 ERROR。沒有為消除提示而加入寬鬆政策或加購。

### 正式前台與權限煙霧檢查

- 登入頁 200、Google 按鈕啟用、無「Google 登入尚未完成設定」。390px 與 1440px 無水平溢出、破圖或 browser runtime error；已檢視截圖。登入文字顯示逐人授權及一般日常草稿免額外驗證器，重要操作仍保留保護。
- 實際點擊 Google 按鈕，到達 `accounts.google.com/v3/signin/identifier`；未填寫帳號／密碼、未完成 OAuth、未新增 session 或授權。不保存或列印 OAuth query/state/nonce。
- `ACCESS_SMOKE_BASE_URL=https://daycare.suiyuecare.com node scripts/verify-anonymous-app-access.mjs`：89/89 catalog route 匿名皆回到正確 staff／family login，並有 no-store。此為未登入隔離測試，不代表 89 頁所有功能與角色已正式 E2E 驗收。
- `/api/records` GET、`/api/role-governance/requests` POST、`/api/staff-management/roles` POST、`/api/care-roster` POST 在正式公司網址均回 401／AUTH_REQUIRED／private no-store。POST 僅空物件與正確動作標頭，沒有業務資料；驗證在授權檢查停止。
- 發布前本機驗收沿用原實作報告的 3,759 unit pass／1 skip、101 SQL suites／4,485 assertions、lint／typecheck／build，以及相關四頁多尺寸 QA；本轮僅重跑交易修正相關測試與雲端 build，不宣稱全部測試重新執行。需私人 HTML 的 skip 未被算作 pass。
- 受保護頁面可在「員工管理」與「角色與資料範圍」查看職務分類；沒有已授權真人 browser session，因此未聲稱完成正式登入後角色 UI 操作。
- 截圖在本機忽略路徑 `artifacts/roles-release-2026-09-14/`，不隨部署上傳。

### Post-Deploy Observability

- 候選 READY 超過 60 秒與正式 promote 後，分別用 `vercel logs <本版 ID> --level error --since 1h --limit 100 --json` 掃描：皆 0 筆。只有本版存在及本輪操作的短時間觀察，不能表述為已連續監測完整一小時。
- Drains：0，沒有外部錯誤轉送。原始碼／package 未發現 Sentry、Datadog、Checkly 等整合；未新增付費監控。現有 CLI／Dashboard 能查紀錄，但持續主動告警仍是營運缺口，不能宣稱已符合 5 分鐘偵測與 99.9% SLA。
- Build 的 Node `>=22` 自動升版警告、Next preferredRegion deprecated 警告仍存在；本次未更改套件／Node 範圍，函式區域已在 artifact metadata 核實仍為東京。

發布成功不等於已完成員工開通、真實登入後寫入、專業資格、正式 CMS 匯入、Finance 接線或完整 89 頁營運驗收。這次不更動人員授權；仍需逐人確認職務、分支及核准流程。

如需回復，使用上方經本輪核對的舊 production artifact；不刪除新表、歷史紀錄或稽核資料。
