# 收案流程發布驗證與正式營運待辦

日期：2026-09-14（Asia/Taipei）。本次依授權測試、除錯並發布既有日照系統；不代表全部 89 頁、法遵、正式表單或營運已驗收完成。

## 發布識別

- 程式：`bab5e970556bde2bb7c323f758af17fb26bc845a`，包含前批 `dd0e50b` 收案功能。
- Vercel：`prj_eiwNI6buPlPXynMCWhatuzqxD74H`，候選 `dpl_GXNbDw6q5ESdhdCdG5HDUMsDTHVw`，READY，production 環境，函式 `hnd1`。
- 候選網址：`https://suiyue-daycare-preview-jghffxilx-entrepreneur-9585s-projects.vercel.app`。
- 正式網域：`https://daycare.suiyuecare.com`；同一候選已 promotion，2026-09-14 08:35（臺北）回查 alias 指向上述 deployment，project ID 相同。
- 原正式 artifact：`dpl_6qFxjMKS1PawMKShBmNwv6jDuQEs`，程式 `c97400d715905b5c42e61032b26a3d010ec78e64`。候選 READY 後已核對正式網域仍指向原版本。
- 上傳清單：956 個來源檔，7,125,213 bytes；manifest SHA-256 `8dfb8073a8537b77f56e4793e7f1e693b697e3eee509ad0b945773974ad475ef`。
- 實際 dry-run 清單未包含 `.env`、使用者 HTML/PDF、測試資料、原始附件、SQL、文件或本機 build；禁止路徑、symlink、指定 secret literal 檢查均 0。這不是通用個資掃描認證。
- 未推送或覆寫 GitHub 分支；由乾淨隔離 checkout 上傳同一來源建立正式候選。原使用者 dirty checkout 保留。

## 已修問題

1. A 表及身分證附件都驗證敏感基本資料欄位權限；撤權後讀取、歷史、下載、上傳／覆核重送不再繞過。
2. 收案工作台隨機構、分支、使用者、角色／權限及所選個案重新掛載，清除舊範圍私有狀態。
3. 切分支先確認未存輸入，再以原生 modal 同步遮住與鎖定背景，最後完整載入同源工作頁、移除舊個案 query/hash。錯誤／逾時維持鎖定，不自動重送 POST。
4. 個案回條核對 clientId；附件讀回確認後才更新基準版本，保留不確定結果的冪等鍵；不清除其他附件類別草稿。
5. 基本資料及 A/B/C 草稿錯誤可定位中文欄位、開啟原區段；防連點；單日異動換日／重新載入提醒未存草稿。
6. CMS 封存未配置即停用選檔與上傳，保留手動建檔入口；服務端只傳 readiness boolean。原角色、AAL、表單簽署及臨床規則不因此放寬。
7. 導航 hover 改淺橘、目前頁保留實橘，排除視覺上的雙重選取。依介面簡化技能只調提示，不刪功能。

## 已完成測試

| 範圍 | 結果與邊界 |
| --- | --- |
| 完整 Vitest（source freeze 後） | 373 檔、3,942 項通過；1 項 opt-in 跨 Finance repo 合約測試未執行，不冒充正式 Finance 已串通。 |
| ESLint / TypeScript / build | 完整通過。初輪與 build 同跑時 ABC 測試 5 秒逾時；單套 10 項通過，最後 maxWorkers=2 全套通過，沒有調大 timeout 或 skip。中途編輯中的 branch 測試失敗已在凍結版本完整重測。 |
| SQL 全量相容回歸 | 108 migrations；106 測試檔、4,728 assertions 通過。其中 93 個既存 PGlite-only admission fixture、13 個真實 admission predicate 套，不視為正式 Auth E2E。 |
| 原生 PostgreSQL 17.11 | 108 migrations；四套收案 234/234、ACL/Storage 7/7；真雙 session 同鍵重送及版本競爭、104→108 有既有合成資料升級全部通過。見原生 preflight 報告。 |
| 89 頁 | 本機合成模式 89/89 路由標題煙霧測試；不等於每頁完整業務驗收。 |
| 未登入邊界（本機 production build） | 89 頁及新收案 14 項檢查通過，含 13 API probes；使用 loopback 假 Supabase 配置、無 JWT、無外部個資傳輸。第一次空配置 build 回 503 是未配置邊界，不列為登入拒絕驗收成功。 |
| Hosted Supabase 匿名 HTTP | 無 API key 401；僅 public key 讀個案／機構／分支均 401/42501、回傳資料 0；migration 前後皆通過。未讀取／輸出金鑰。 |
| 介面 | 收案五步 390/820/1440、跨步草稿、鍵盤、C 表月份及六類附件檢查通過；分支 modal 的遮罩、Esc、錯誤焦點、390px 及完整 document 重建在本機模擬回條驗證。非真人正式帳號操作。 |
| 依賴 | `pnpm audit --prod`：0 已報漏洞；不代替 ASVS、滲透或供應鏈完整審查。 |

建置仍有既存 `preferredRegion` deprecated 與 Node `>=22` 可隨新版升級提醒。此次未升級 framework、未改執行區域或付費方案；正式 build 的業務函式實際為 Node 24、`hnd1`，7 個新增頁面/API 入口全部存在。`_middleware` 為既有多區域登入閘道（bom1/fra1/gru1/iad1/lhr1/sfo1/sin1/syd1）；前一正式 artifact 也相同。最初「所有輸出皆東京」的檢查因此不通過，已逐路徑確認業務函式均東京，單獨記錄 gateway 邊界；不可宣稱整個服務、Token 或網路路徑只在日本。雲端 build 機器 iad1 不等同個案 API 執行區域。

## 正式資料庫結果

- Supabase `mmxqxsokpcdvuzmdhptg`，維持原有首爾 `ap-northeast-2`，未搬區或新增付費服務。
- 正式 `db push` 成功套用且只套用四筆：`20260913175005`、`20260913175121`、`20260913175206`、`20260913180653`。各自 BEGIN/COMMIT、lock_timeout 5 秒；再次 dry-run 已無待套用。
- 104→108；既有 clients 2、auth users 1、care records 0；clients、roles、role_permissions、memberships、client_assignments、form_versions 全量聚合雜湊前後相同。沒有個案回填、員工開通或實際測試上傳。
- 11 張新 private 表皆 FORCE RLS；anon/authenticated/service_role 直接表讀寫權限違規 0。
- `client-intake-documents` bucket 私有、4 MiB、PDF/JPEG/PNG；restrictive policy 禁止 browser 直讀直寫。新 profile、週表、A/B/C、附件與 bucket object 筆數皆 0。
- Security advisor 無 ERROR；既有密碼外洩防護 WARN 1 仍在。deny-all private 表的 RLS-no-policy INFO 153→164，增加的 11 對應新 private 表，沒有為消除提示而開放政策。

## 正式前台核對

- 候選以 Vercel CLI 自動通過 deployment protection、**沒有 app 登入憑證**，完整執行新收案 14 項檢查：全部通過。另驗 Google 登入入口存在且可按、無個案 shell。
- 正式 alias 回查：`daycare.suiyuecare.com` → `dpl_GXNbDw6q5ESdhdCdG5HDUMsDTHVw`；同一已測 artifact，沒有重新 build 未測來源。
- 正式網址再次通過 89 頁 audience 登入導向與 no-store，以及新收案 14 項（13 API probes + 1 工作頁）檢查；API 401/AUTH_REQUIRED、data null、request ID、private/no-store 全部符合。
- 真實正式登入頁瀏覽器：390/1440 無水平溢位、無壞圖及 page errors；Google 按鈕可用，390 下觸控尺寸 342×44。截圖保留 `/tmp/daycare-production-login-{390,1440}-20260914.png`（公開登入畫面）。
- 08:35:26（臺北）查此部署前 10 分鐘、上限 50 筆 error logs：0 筆；只記數量，不輸出敏感日誌。這不是長期監控或可用率保證。
- Google 按鈕實際導向 `accounts.google.com/v3/signin/identifier`；停在 Google 本人登入之前，不輸入密碼或截取 session。
- 正式驗證後再次核對：clients 2、auth users 1、intake profiles 0、document versions 0、bucket objects 0；沒有測試寫入正式個案或附件。
- **沒有完成真人登入後的臨床／收案流程驗收**，沒有以公開頁或未登入測試冒充已登入正式 E2E。

## 明天正式使用前仍缺

1. **CMS 封存與附件掃毒尚未配置**：沒有 WORM/KMS 與正式 scanner，因此真實 HTML／附件上傳停用；不使用假掃描或無保留保證的儲存代替。
2. **建檔／週表／A/B/C 的 AAL 政策尚待確認**：本次保留既有寫入／表單 AAL2，正式目前無 verified MFA factor。Google 一般登入並不等於這些新增操作可完成；不能只看按鈕即宣稱可用。待確認是否將指定非簽署日常作業改為已核准 Google 角色授權，保留高風險簽署／給藥／匯出／擴權保護。
3. **首批萬華帳號角色未確認及未開通**：需選定單點管理員、主任或照服等模板，且以本人公司 Google 完成實際登入驗收；未為測試而發額外權限。
4. **A/B/C 目前是草稿**：官方表單核准、正式 PDF／簽署、C 月報與主管覆核驗收仍待完成；D 臨時住宿不在純日照範圍。
5. **附件後續能力**：多藥袋逐份有效／停用與覆核、超過 200 件歷史分頁、實際掃毒／Storage／短效下載服務鏈仍待驗收。
6. **整體營運**：Finance 正式連線、真人跨角色／跨分支 E2E、50 人壓測、備份還原／RPO/RTO、七年移轉對帳及正式申報平行週期未由本次發布完成。

因此可發布修正並進行受控驗收，但**不能據此宣稱明天即可全面取代既有正式系統**；未通過的流程需繼續使用原系統或機構既有核准作業。

## 回復策略

若新前端／API 有重大異常，將既有網域切回上述前一 artifact；四份 additive migration 留存，不刪表、不重置 migration history。若發布後已有任何新資料，回復前先由管理員確認，不能以刪除新版本資料當作 rollback。

相關：[權限矩陣與兩項 P1 證據](./CLIENT_INTAKE_PERMISSION_AUDIT_2026-09-14.md)、[原生 PostgreSQL preflight](./INTAKE_NATIVE_PREFLIGHT_2026-09-14.md)。
