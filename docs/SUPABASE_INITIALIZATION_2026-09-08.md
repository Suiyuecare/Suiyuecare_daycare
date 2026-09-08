# Supabase 測試環境初始化紀錄 — 2026-09-08

初始化與雲端負向驗證已於 2026-09-08 15:46（Asia/Taipei）完成。

## 授權與界線

本次依使用者確認，初始化既有 `Suiyuecare_daycare` 專案
`mmxqxsokpcdvuzmdhptg`，只建立應用資料結構、權限及最小合成測試資料。
實際區域是首爾 `ap-northeast-2`，PostgreSQL 17.6；不是原規劃的東京正式環境。
此授權不等於真實個資上線、跨境法遵、正式營運或 89 頁驗收通過。

本次未操作 Vercel、未變更前台環境變數、未匯入原始 HTML、未建立真實帳號，
也未建立 S3、LINE、簡訊或付費加購。沒有推送 GitHub，避免觸發既有 Preview 自動部署。

## 已完成的雲端變更

| 項目 | 實際結果 |
| --- | --- |
| 初始化前 | public/private 應用表 0、遷移 0、Auth users 0、附件 0 |
| 原生 CLI 遷移 | 93 份，保留原始版本與名稱，沒有偽造／修補 history |
| public 應用表 | 134 張，全部 ENABLE 與 FORCE RLS |
| private 內部表 | 95 張，全部 ENABLE 與 FORCE RLS |
| 角色／權限定義 | 10 個系統角色模板、199 項權限；沒有員工指派 |
| 函式／view | public 252、private 653 個函式；2 個 view |
| 特權函式 | 470 個，全在 private，owner 為 postgres、固定空 search_path |
| 合成資料 | 1 個停用 TEST 機構、1 個停用 TEST 分支、2 個 suspended TEST 個案 |
| 合成資料稽核 | 4 筆 system actor insert 紀錄；不是使用者簽署或 MFA 證據 |
| 真實帳號／附件 | Auth users 0、profiles 0、memberships 0、Storage objects 0 |

合成個案沒有生日、身分證、聯絡人、收案日期、用藥、量測、服務、申報或通知。
停用旗標只是標示；隔離仍靠 RLS、ACL 及沒有帳號／指派，不以旗標取代授權控制。

## 初始化時一併修補的權限缺口

1. 舊 foundation 與 security 是分開的 migration。先撤銷 public schema 的匿名／一般
   使用者 USAGE，且確認 CREATE 為 false，避免遷移中途的預設授權窗口。
   每份 migration 與自己的 history 寫入是同一交易；93 份不是單一全包交易。
   失敗不得無條件重新開放 schema。
2. `20260908072804_meeting_append_only_privilege_hardening.sql` 撤銷兩個會議歷程表
   多餘的 TRUNCATE／REFERENCES／TRIGGER 權限，保留必要 CRUD 與 append-only triggers。
   同時撤銷 API 角色的 public MAINTAIN 權限，以及未來表的隱含授權。
3. `20260908073427_initialization_rls_hardening.sql` 為 24 張內部表補齊 RLS／FORCE，
   並為 2 張會議表補 FORCE。未新增寬鬆 policy、未恢復直表權限、未改寫舊 migration。

## 驗證證據

- 遷移名稱／版本：本機與雲端皆 93 筆，排序檔名指紋一致：
  `ce93a1bfd0429e3a0e71dcb163a48424`。
  此 MD5 只用於本次相等性對照，不是簽署或安全完整性證明。
- 93 份遷移檔案的排序名稱＋逐檔 SHA-256 manifest 指紋：
  `6d6f78623edd6991c161fec1388b17915f65fc1c7fdd4093e0dbffd3876aa560`。
- 合成 initializer 雲端成功執行兩次，4 筆資料及 4 筆稽核含時間欄位的前後內容一致，
  沒有重複新增或更新。`ON CONFLICT DO NOTHING` 未被用來掩蓋內容衝突。
- 本機 initializer 已驗證衝突、既有 Auth／業務資料阻擋、第二筆個案失敗整批回滾、
  稽核缺漏回滾；這些破壞性故障注入只在記憶體內 PGlite 執行。
- 雲端匿名 HTTP：無 API key 回應 401；有效 publishable key、無使用者登入時，
  clients／organizations／branches 均回應 401、SQLSTATE 42501、資料 0 筆。
- 完整本機回歸：93 migrations compile、92 SQL 測試檔、3,737 assertions 全通過。
- initializer／gate：11 個本機情境全通過，包含空庫／部分遷移不准開門，
  完整遷移後只恢復 USAGE、不恢復 CREATE；新增 JavaScript 工具 ESLint 通過。
- schema 恢復後的雲端 `verify-supabase-initialization.sql` 回應 PASS。
  229 張表 RLS／FORCE 全數有效、owner 正確、匿名表授權為 0、未授權角色讀取為拒絕或零筆。
- schema 恢復後重新執行上述 HTTP 檢查全部通過。另確認 anon／authenticated
  的 USAGE=true、CREATE=false；兩個 view 都是 security_invoker。
- 原生 CLI `db push --dry-run --linked` 確認 remote database is up to date。

上述角色模擬不是實際登入／MFA 驗收。未建立測試 Auth session、未冒用員工，
也未把本機 Auth bootstrap 或 pgTAP 的假帳號腳本執行到雲端。

## Advisor 結果與待辦

本次 Supabase security advisor 的 ERROR／WARN 均為 0；有 142 筆
[`RLS Enabled No Policy`](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
INFO，屬目前透過受控函式存取、沒有直表授權的 default-deny 表。
不得只為消除提示而新增允許所有人的 policy。

Performance advisor 有 1,243 筆 INFO，ERROR／WARN 為 0：

- 358 筆[外鍵缺少完整涵蓋索引](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)：正式資料量及壓測前，依實際查詢計畫補足。
- 884 筆[未使用索引](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)：空庫／合成資料階段不代表可刪除，不因這次掃描移除。
- 1 筆 [Auth 連線配置提示](https://supabase.com/docs/guides/deployment/going-into-prod)：正式流量與方案設定時驗收。

零 ERROR／WARN 不代表無漏洞或效能達標。50 人並行、跨機構／分支真實登入、
15 分鐘 AAL2、停權後 5 分鐘 session 撤銷、PITR／還原、七年保存、資料區域與 DPA
仍是正式啟用前獨立門檻。

## 操作檔案與後續

以下是顯式管理員工具，不能加入自動部署或以 `--include-seed` 取代：

- `scripts/supabase-initialization-close-gate.sql`：只允許空專案的初始化存取封鎖。
- `scripts/initialize-synthetic-supabase.sql`：可重跑的最小 TEST 資料，內容衝突即回滾。
- `scripts/supabase-initialization-open-gate.sql`：通過 RLS／owner／ACL／函式檢查才恢復原有 USAGE，CREATE 保持關閉。
- `scripts/verify-supabase-initialization.sql`：唯讀 catalog 與交易內的無指派角色模擬，最後 ROLLBACK。
- `scripts/verify-supabase-anonymous-api.mjs`：只讀匿名 HTTP 檢查，API key 僅在記憶體，不輸出或寫檔。
- `scripts/test-synthetic-initializer.mjs`：僅本機記憶體測試，Auth／Storage 模擬不會送到雲端。

下一步另行取得公司管理員 Email，建立真正帳號、完成管理員自行 MFA 設定，
再配置與驗證測試前台連線。既有 synthetic-only Preview 不可直接塞入 Supabase
設定冒充已登入系統。本次初始化本身不使前台變成正式可用系統。
