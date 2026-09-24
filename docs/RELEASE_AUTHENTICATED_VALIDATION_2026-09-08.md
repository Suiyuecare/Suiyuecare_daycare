# 日照系統建置驗證版發布紀錄 — 2026-09-08

## 發布結果

- 網址：https://daycare.suiyuecare.com/login
- Vercel project：`prj_eiwNI6buPlPXynMCWhatuzqxD74H`。
- Production deployment：`dpl_5TBrYMdP34QLcV68NyaPoJMbnL1s`，READY。
- 發布程式 commit：`7d3cd683a276c9180a8cc4ec82582d0cf1caf914`。
- 以 production 設定建立候選，確認登入與拒絕路徑後 promote；不是合成 Preview 的直接升級。
- Alias API 確認 `daycare.suiyuecare.com` 指向上述 deployment；HTTPS GET 200，TLS 驗證成功。
- 使用隔離 worktree，納入先前核准的 75 個 Finance 配色／框架／載入動畫檔案；原 dirty 工作目錄不變。
- 此次從本機候選部署，未 Git push 或合併 GitHub main。後續測試與此紀錄的提交不改變線上程式碼。

## 區域、費用與安全邊界

- 沿用既有 Supabase `mmxqxsokpcdvuzmdhptg`，首爾 `ap-northeast-2`，沒有搬遷、新建專案或升級方案。
- Vercel 函式執行區域為東京 `hnd1`；本次雲端建置紀錄為美東 `iad1`，不將建置區、函式區與資料庫區混稱。
- 未購買 PITR、WORM、通知供應商或其他加購項目；不能保證平台既有用量帳單完全不變。
- Production 僅新增 Supabase URL、publishable key、server-only sensitive secret key、正式 app origin。
- 四個 Preview 合成模式設定與既有 Vercel 存取保護保持原樣。密鑰未寫入 Git 或報告。
- 未匯入真實個案 HTML、建立正式機構／個案、發送邀請／簡訊／LINE 或建立管理員。
- 發布後 Auth users、profiles、memberships 均為 0。
- 登入頁標示「建置驗證版本」及不得輸入真實個案資料；這是公開登入入口發布，不是 89 頁正式營運驗收。

## 雲端資料庫變更

- 只套用 pre-MFA 自身資格檢查，雲端共 94 份 migrations。
- MCP 寫入的 migration version 為 `20260908150303`；本機檔名已對齊，SQL 內容不變。
- 已核對 public INVOKER / private DEFINER、postgres owner、空 search_path；僅 authenticated 可執行。
- publishable key 的匿名 RPC 請求回應 401 / SQLSTATE 42501。
- 安全 advisor 只有既有 RLS enabled/no policy INFO，共 142 個 deny-by-default／RPC 專用資料表；未因此放寬授權。
  [官方說明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

## 驗證結果

- 本機 normal production build（含 TypeScript）成功、全站 ESLint 零警告。
- Vitest：296 files / 2,862 tests 通過。
- 本機 PGlite：94 migrations 編譯；93 SQL files / 3,779 assertions 分段覆驗通過。
  首輪 86 files / 3,483 assertions 通過後，教育訓練測試因台北 23:00 後的「現在＋1 小時」跨日失敗；
  僅修正該測試日期基準，保留原錯誤碼／業務阻擋，剩餘 7 files / 296 assertions 通過。
- 舊 `test:routes` 曾在未啟動其本機示範伺服器時執行，得到 fetch failed，不能列為通過證據。
  本次線上改使用符合真實登入模式的匿名探針，89／89 頁均導向正確 staff/family 登入且 no-store。
- 六個線上 API 匿名 POST（MFA challenge、HTML 匯入、申報匯出、同步、通知、角色申請）均為 401 且 no-store。
- 實際瀏覽器確認桌機及 390px 登入頁；390px 無橫向溢出、input 16px／50px，無瀏覽器錯誤或框架錯誤頁。
- 瀏覽器直訪 staff dashboard / family home 均導向各自登入入口。
- 本部署近 30 分鐘 error 級別紀錄查詢為 0；未新增持續監控或外部 log drain，不等於 SLA／災難復原驗收。
- Finance 完全同色仍有既知 WCAG 對比問題，見 `UI_FINANCE_THEME_2026-09-08.md`；不宣稱 AA 全數通過。

## 管理員啟用仍待完成

1. 使用者確認李佳泰執行長的完整 Email，不能推測或沿用其他產品通用信箱。
2. 補完一次性邀請確認與自行設定密碼流程；目前只有帳密登入與 MFA。
3. 驗證既有寄信設定與精準 redirect allowlist；不加購服務或寄出無法接受的邀請。
   [Supabase SMTP 限制](https://supabase.com/docs/guides/auth/auth-smtp)
4. 以支援的 Auth admin API 建立帳戶，另以經覆核交易建立真實組織／分支／員工 profile／membership／organization_manager 角色，保留稽核，不啟用 TEST 資料。
5. 由本人設定密碼與 MFA，再做實際跨機構／分支／角色驗證；不在聊天分享密碼或 OTP。

原訂東京資料區、法遵、正式資料、七年封存、外部供應商、完整功能、效能與還原驗收仍獨立待辦。
本次依 Supabase 最小權限與 Vercel 隔離環境發布規範執行；沒有把「網站已發布」當成「系統已完整可營運」。
