# 照服員改善版發布紀錄（2026-09-13）

## 發布範圍與狀態

使用者授權發布照服員改善第 1、2、3、5、6 項。功能來源提交為 `6d42086`，發布窄修後來源為 `4064291fa5e95b623b81d675c11954085e291b00`。已在台北時間 2026-09-13 凌晨發布並驗證正式網域。下方驗證範圍明確區分發布／匿名入口與尚待進行的真實登入業務操作。

- 當班個案、上午／下午工作、進食／飲水／如廁／活動快速紀錄。
- 日誌草稿、提交、簽署、退回與不可覆寫的更正歷程。
- 有效期內加密離線草稿與冪等重送；本機草稿不是正式紀錄。
- 中央來源的進食、移位、如廁、溝通候選提醒；人工確認後才可供照服員使用。
- 包含先前尚未發布的可信匯入暫存與店務摘要資料庫依賴。

不變更現有 CEO Google 准入、角色／個案授權、寫入驗證或付費方案；Vercel 東京執行區域與既有 Supabase 首爾專案皆保留。未新增照服員帳號或調整 Finance。

## 發布前窄修

- 查看模式不掛載需要較高驗證等級的日誌操作元件；既有授權摘要仍可查看。不修改後端權限。
- 補上不發出受保護請求、存取改變後移除舊觀察兩項測試。
- 歷史 `executive_read_only_login` 本機與 hosted SQL 的 MD5 同為 `98efde9f4a3149cf6a1b7e86c903947c`；本機檔名對齊 hosted `20260909083009`，沒有 revert 或 repair 雲端遷移歷程。

## 資料庫發布清單

依序套用下列五份既有、已在本機驗證的 migration；發布前 dry-run 只列出這五份。

1. `20260911140908_trusted_import_upload_staging.sql`
2. `20260911165630_store_overview_attendance_summary.sql`
3. `20260912150411_care_diary_lifecycle.sql`
4. `20260912150541_cms_care_reminders.sql`
5. `20260912150549_care_worker_daily_roster.sql`

遷移前：97 個 hosted 版本，care_records 筆數為 0，沒有超過 30 秒的長交易。舊每日服務彙整函式的三個預期更新位置各出現一次。遷移只增加結構／函式，不匯入個案或新增權限指派。

## 驗證與公開資料檢查

- 本輪完整單元測試：345 檔、3,633 項通過；1 項需外部原始檔的既有測試跳過。
- ESLint、TypeScript 通過。乾淨 checkout 初次 typecheck 缺少 Next.js 自動產生的 PageProps／LayoutProps；執行 `next typegen` 後重測成功，沒有放寬型別或修改檢查設定。
- 前一輪相同功能基線：102 份 migrations 可編譯、99 份 SQL 測試 4,228 項通過，89 個合成頁面路由與 390px／桌機介面、瀏覽器離線／跨分頁登出通過。這些是本機證據，不當成正式帳號端到端驗收。
- 獨立掃描 HEAD 與 15 個待推送歷史提交，共 1,544 個文字版本及 1 個品牌圖檔；真實密鑰／原始個案資訊匹配為 0。疑似密鑰皆為明示測試 fixture 或環境引用。
- 真實 CMS HTML、私人路徑、環境檔、暫時驗收路由未加入公開原始碼或部署清單。

## 仍待接線與營運驗收

- 正式 HTML WORM storage/runtime、中央欄位 promotion 尚未接通；提醒候選不等於正式個案匯入完成。
- Finance 收支來源尚未配置，店務摘要不得把未連線冒充收入／支出 0。
- 實際照服員授權、真實登入後寫入、跨 session 併發、來源字典與臨床／營運人工驗收仍待完成。
- 發布前安全 advisor 既有 143 項「RLS 無政策」INFO 多為私有 RPC 專用表；不為消除提示增加寬鬆政策。另有既存密碼外洩防護 WARN，未變更 Google 登入或方案。[密碼安全說明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 回復方式

發布前 production deployment：`dpl_JCURJBEcXHi4zU5GRTDbgHXiH8kZ`，來源 `6700f06b6dc57f1180bdfe4948e096795973d997`。若新版本發生阻斷，回復 Vercel alias 至該版；不刪除新表／enum／紀錄，保留版本與稽核歷程。

## Deploy Result

- URL：[daycare.suiyuecare.com](https://daycare.suiyuecare.com)
- Target：production
- Status：READY
- Commit：`4064291fa5e95b623b81d675c11954085e291b00`
- Framework：Next.js 16.3.3
- Build Duration：59 秒（Vercel build log）；TypeScript 33 秒包含在建置內。
- Deployment：`dpl_D6MVb5pnH25kLjKEvjXMuMVvdtti`
- Candidate：[不可變部署網址](https://suiyue-daycare-preview-hie08ia52-entrepreneur-9585s-projects.vercel.app)
- 流程：既有五份 migration → hosted 複核 → `deploy --prod --skip-domain` → 候選檢查 → promote 相同 artifact → 正式 alias 複核。候選期間公司網域仍指向舊部署，未放寬平台保護。
- REST 確認公司 alias 指向本次 deployment；部署 metadata 的來源 SHA 完全一致，regions 為 `hnd1`。建置工作機位於 `iad1` 不等於敏感函式執行區域。
- Node 因既有 engines `>=22` 於雲端使用 24.x；建置成功。保留既有 engines／區域，後續可另案固定版本；既有 preferredRegion 棄用警告未當成新錯誤忽略。
- CLI 實際上傳清單 906 檔、6,849,954 bytes；沒有環境檔、真實 HTML、私人路徑、瀏覽器測試 harness 或 tsbuildinfo。

## Hosted 資料庫複核

2026-09-13 00:14（台北）由獨立 reviewer 執行唯讀 metadata／COUNT 檢查，未讀個資或登入憑證。

- migrations 由 97 增至 102，最新五份與清單一致。
- 9 張新增 private 表 owner 為 postgres、ENABLE/FORCE RLS；anon／authenticated／service_role 的直接 SELECT、INSERT、UPDATE、DELETE、TRUNCATE 全部拒絕。
- 12 個公開 RPC 均為 INVOKER、空 search_path、postgres owner；11 個只授予 authenticated 執行，`complete_import_upload` 只授予 service_role，匿名全拒絕。
- 17 個 private definer helper 的 owner／search_path／匿名拒絕設定正確。
- 每日彙整三個舊公式位置皆為 0、新公式各 1；submitted／corrected enum 存在，日誌 CHECK validated=true。
- care_records 遷移前後均 0，新九表皆 0。没有建立測試個案或業務資料；角色／會員未保留遷移前筆數，僅能證實 migration 原文無相關資料寫入，不宣稱完整历史對帳。
- Security advisor：152 項 RLS 無政策 INFO（原 143 + 新 9 張刻意封閉的私有表），既有密碼防護 WARN 1，ERROR 0。未新增寬鬆政策清除提示。[RLS advisor 說明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

## Production Verification Report

使用故事：照服員從今日工作進入個案紀錄，经 API／授權 RPC 保存，再由同一資料版本更新畫面；本次可證實發布與匿名保護，不假裝完成真實員工登入寫入。

| 邊界 | 本次證據 | 範圍 |
| --- | --- | --- |
| 正式入口 | 390px／1440px Chromium，Google 按鈕啟用，無橫向溢出、無壞圖及頁面錯誤 | 未登入畫面 |
| Google 起始流程 | 點擊正式登入按鈕，實際抵達 accounts.google.com 的登入識別頁 | 未輸入帳密，未代替執行長完成登入 |
| Client → API | records、care-reminders GET 與 care-roster POST 均 401，結構化錯誤且 no-store | 無 session，不含業務輸入；roster 僅支援 POST，初次 GET 的 405 不是故障 |
| 89 頁隔離 | `verify-anonymous-app-access.mjs` 89/89，皆導回對應員工／家屬登入且 no-store | 不等於 89 頁登入後全功能驗收 |
| API → Data | 正式資料庫版本／表／RPC／RLS 檢查全部通過 | 真實寫入及多使用者競態未於 production 操作 |
| Data → Response → UI | 本機功能／RPC／離線回執測試通過，雲端建置成功 | 正式照服員操作仍待帳號與營運驗收 |

### Post-Deploy Observability

- Error scan：部署 READY 後超過 60 秒，以 CLI 篩選此 deployment 的 error 等級、since 1h；2026-09-13 00:17:57（台北）回傳 0 筆。這是當時短窗檢查，不代表已觀察完整一小時或未來無錯。
- Drains：0，沒有配置向外部監控轉送。此次未加購或新建外部服務。
- Monitoring：可使用 Vercel 內建 runtime logs；外部錯誤通知與長期監控驗收仍有缺口，不能宣稱已達完整 SLA。
- 保留正式匯入、Finance 接線、實際使用者／資料／權限、營運驗收待辦；本次未用展示資料冒充已正式保存。
