# 正式部署與登入安全預檢 — 2026-09-08

## 狀態與範圍

本輪依使用者同意，查明部署及登入問題，並在獨立 worktree 修正 pre-MFA 阻斷。
這是本機候選版本，**不是正式部署、真實帳號登入驗收或完整營運上線**。
原工作目錄的未提交 Finance 外觀、框架及載入動畫變更全部保留，沒有混入此獨立修復。

## 雲端唯讀確認

- Vercel 專案 `prj_eiwNI6buPlPXynMCWhatuzqxD74H` 的舊 production 部署
  `dpl_6g3fqvM4bfbtrHFCTafgRga4UanP` 仍為 ERROR；API 回覆 ENOENT / build exited 1。
  既有發布紀錄指出首輪排除規則誤排 `src/lib/supabase`，目前 `.vercelignore`
  已使用根目錄限定 `/supabase`，並在本機 normal production build 確認可建置。
- Vercel 只有 4 個 Preview 專用合成模式設定，production 沒有應用環境變數。
  沒有把 Preview promote 成正式版，也沒有調降部署保護。
- Supabase `mmxqxsokpcdvuzmdhptg` 為 ACTIVE_HEALTHY、首爾 `ap-northeast-2`，
  屬 `Suiyuecare's Org`（Pro），不是原規劃東京 `ap-northeast-1`。
- 只查計數：Auth users、profiles、memberships 均為 0。沒有讀取個案內容、建立帳號或寫入雲端。
- 唯讀核對 `auth.sessions` 欄位：id、user_id、created_at、not_after 可用，沒有 revoked_at；
  service_role 沒有此表 SELECT 權限。沒有為修正加入任何 Auth 直表授權。

## 已找到與修正的登入阻斷

原流程為密碼登入（AAL1）→建立重新驗證挑戰→驗證 TOTP。
但建立挑戰的 API 先呼叫 `getTenantContext`；其 `active_memberships` view
刻意拒絕 AAL1 員工，因此員工在完成 TOTP 前就被 401 阻擋。
既有 RLS 測試也明確要求 AAL1 不得取得 tenant context，不能放寬此資料保護。

修正使用窄化的 `can_begin_staff_mfa()` 自身資格檢查：

- API 先用 Auth `getUser` 與已驗證 `getClaims` 核對相同使用者，不信任 client user ID 或 user_metadata。
- 一般使用者 session 呼叫零參數 RPC，只能取得自己的資格布林值。
- public bridge 為 SECURITY INVOKER；private helper 為 postgres 所有、固定空 search_path，
  僅 authenticated 可執行，anon 及 service_role 不可執行。
- helper 檢查有效 JWT、相符且未到期的 Auth session、帳戶狀態、員工 profile、有效機構／分支、
  membership 與員工角色，不回傳任何帳戶、session、機構或個案資料。
- 只有資格明確為 true，server-only admin client 才呼叫原一次性 challenge RPC。
  新 migration 未部署或 RPC 失敗一律拒絕，不退回舊流程。
- 原 challenge／nonce／JWT 時間證據消費流程與業務 RLS 不變，不憑前端宣告授予 AAL2。

上述分層遵守 [Supabase SSR 身分驗證文件](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
及 Supabase 技能的最小權限、server-only 密鑰與 RLS 檢查原則。

## 驗證界線

已完成的本機檢查（Node.js 22.23.2／pnpm 11.21.0）：

- ESLint 全站零警告、`git diff --check` 通過。
- 最終程式碼 normal production build 成功，含 TypeScript 檢查；不是雲端部署。
- 全套 Vitest：292 個檔案、2,825 項測試通過。
- 新增資格／既有 RLS／重新驗證／foundation：4 個 SQL 測試檔、104 assertions 通過，
  其中新增 pre-MFA 資格檢查 42 項；94 份 migration 本機編譯成功。
- 完整資料庫回歸：93 個 SQL 測試檔、3,779 assertions 全數通過（僅本機 PGlite）。
- 新 helper 的 owner、invoker／definer、空 search_path、執行 ACL 與 Auth 直表拒絕，
  經第二位審查者在完整 migrations 的 PGlite 獨立核對。
- 89／89 員工／家屬入口匿名 GET 導向與 no-store 通過；瀏覽器抽查 staff／family 導向登入。

匿名路由探針 `scripts/verify-anonymous-app-access.mjs` 檢查 89 個入口與 no-store。
Next.js 串流可能使用 HTTP 200 加入 redirect meta，而非 HTTP 307；探針靜態解析受大小限制的回應，
驗證目標為本站對應登入頁且沒有渲染業務 shell／h1，不執行 HTML 或記錄回應內容。
本機瀏覽器亦確認員工與家屬頁面會導向各自登入入口。

重要限制：資格檢查與 challenge 建立是兩個交易，競態停用可能留下 challenge；challenge 本身不授權業務資料。
既有 consume／一般 RLS 並非全面即時檢查 auth.sessions。本輪不能宣稱「所有工作階段 5 分鐘內撤銷」驗收完成。
本機 PGlite 的 Auth schema 只為模擬所需欄位，不會部署至 Supabase 的 auth schema。

## 正式啟用前需要使用者確認

1. 是否依原規劃，在使用者指定的 Supabase 組織建立東京正式專案，保留首爾供測試。
   必須先取得指定組織、查明並確認新增費用，不直接加購。
2. 首位管理員的公司 Email。需建立正式 Auth 帳號、有效機構／分支／profile／membership／role；
   不自動沿用 WordPress 或其他產品帳號。密碼與 MFA 由管理員本人設定，不在對話交付。
3. 套用 migration 後配置 production 環境，先驗證員工帳密→MFA→租戶入口與拒絕路徑，
   再發布、核對網域 alias／TLS／快取／未授權 API。正式資料仍須獨立完成原規劃治理與營運驗收。

本輪沒有 Git push、Vercel 部署、環境變數更新、Supabase migration apply、真實帳號建立或購買方案。
