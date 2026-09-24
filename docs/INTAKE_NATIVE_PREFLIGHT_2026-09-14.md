# 收案流程原生 PostgreSQL 發布前檢查

日期：2026-09-14。此文件記錄發布前檢查，不代表已發布、已通過真人登入驗收或可上傳真實個資。

## 驗證範圍及結果

- 使用現成 PostgreSQL 17.11（Postgres.app）執行，不安裝服務、不新增費用。只建立獨立 `/tmp/daycare-native-pg.*` 合成資料 cluster，停用 TCP listener；完成後停止 cluster，保留合成測試 artifacts。
- 最終凍結的全部 **112/112** 份 migration 在原生引擎編譯通過，含僅補兩個外鍵索引的 additive migration。
- 先套用既有 104 份 migration 與合成 seed，再升級 intake 4 份、本輪 3 份及索引補正 1 份。升級前後 `clients`、`measurements`、`form_versions`、`roles` 的資料雜湊相同；腳本輸出由實際 migration 數量產生，不硬編碼版本數。此雜湊檢查不包含所有歷史臨床資料表。
- 原樣執行七份 pgTAP：每週到站 34、個案/CMS 94、臺北 A/B/C 56、文件 50、Google 日常收案 70、待啟用員工 37、臺北行政覆核 46，共 **387/387** 通過。沒有套用舊套件的 admission bypass fixture；Google AAL1 使用與應用程式相同的真權限 predicate，Auth session/identity 本身仍是合成測試資料。
- 額外 **9/9** 原生 ACL/Storage/索引檢查通過：14 張 intake/activation private 表全部存在且強制 RLS（含新 pending activation、review events、export snapshots）；anon、authenticated、service_role 都不能直接讀寫；私有 bucket 大小限制 4 MB；即使另有無條件 permissive policy，瀏覽器仍不能讀寫此 bucket。新增兩條 catalog 檢查確認 review/export 的索引均為 valid、ready、非 partial 的 B-tree，完整且依序包含 `(client_id, organization_id, branch_id)`。
- 兩個獨立 `psql` session 同時操作同一週表：相同冪等鍵取得同一 receipt、只新增一個版本；不同鍵但相同基準版本，只有一筆成功、另一筆得到 SQLSTATE `40001`；最終版本數正確。
- 另外兩個獨立 `psql` session 使用同一核准身分的兩份合成 Google OAuth session，同時消耗同一 pending activation：兩者皆安全回傳 `true`，最終只有 1 筆 grant、profile、membership、role、已消耗 activation 與 activation update audit。保存的啟用 session 是兩個實際競爭 session 之一；沒有建立重複或較高權限。
- `scripts/test-intake-native.mjs` 通過 ESLint；腳本不接受外部資料庫 URL，不讀取 `.env`，不能指向 hosted DB。

原生檢查仍使用合成 Supabase Auth/Storage schema 與鎖版套件中的 pgTAP SQL；**沒有使用 PGlite 執行引擎**，也不等於完整 Supabase Auth 或 Storage HTTP 服務驗收。雙 session 測試不是 50 人壓測。

## 重現方式

```sh
INTAKE_NATIVE_PG_BIN=/Users/seniorlifepr/.local/share/edoc-backup-runtime/Postgres.app/Contents/Versions/17/bin node scripts/test-intake-native.mjs
```

2026-09-14 最終索引補正凍結後通過的 cluster：`/tmp/daycare-native-pg.Rzy7LO`（已停止，112 份 migration、387 項套件測試、9 項 catalog 檢查與 activation 真雙 session 測試）。先前 111 份驗證保留在 `/tmp/daycare-native-pg.Ri81AQ`，108 份／234 項驗證保留在 `/tmp/daycare-native-pg.1W3MB9`（皆已停止），不是本輪最新結果。原始三份個案 HTML 沒有放進這些 cluster 或雲端。

## Migration 稽核

| Migration | 主要檢查 |
| --- | --- |
| `20260913175005_client_weekly_attendance_transport.sql` | 週表、例外、操作紀錄皆 append-only；行程意圖不產生實際出勤或派車；最新版本及冪等鍵都有序列化鎖。 |
| `20260913175121_client_intake_profile_and_cms_commit.sql` | 核准才從不可變 staging 寫入；精確身分雜湊去重；來源與本地欄位權限分離；舊 scalar editor 不能改寫已有版本資料；既有無 intake profile 個案仍走原流程。 |
| `20260913175206_taipei_abcd_intake_drafts.sql` | 官方來源版本固定；僅草稿；A 表另驗基本資料欄位權限；C 表只取當地實際量測及已簽照顧紀錄；沒有自動發布或自動簽署。 |
| `20260913180653_client_documents_intake_pipeline.sql` | 私有 bucket、禁止 browser 直讀直寫；服務端有限 scanner RPC；掃毒結果及覆核不可變；下載 60 秒授權；身分證需額外基本資料欄位權限。 |
| `20260914091707_approved_google_intake_actions.sql` | 僅真實、已核准的 Google AAL1 員工可做明列日常收案動作；仍逐項驗證角色、分支、個案及來源欄位，沒有全域繞過 AAL2。 |
| `20260914091746_pending_staff_google_activation.sql` | 限事先核准的固定使用者、信箱、機構、分支及單點管理角色；驗證 Google subject、verified email、live session/AMR；row lock 與 subtransaction 保證只啟用一次且失敗無殘留；已消耗邀請不能取代實際 grant 停權。 |
| `20260914091755_taipei_abcd_administrative_workflow.sql` | 提交後凍結、獨立有效主管覆核、帶理由更正版及不可變匯出快照；停用或尚未生效的主管角色不能覆核；匯出仍需近期 AAL2 及 printing.read/access/manage；行政覆核不冒稱電子簽章或完整官方表。 |
| `20260914112708_taipei_abcd_workflow_client_fk_indexes.sql` | 已發布 111 份之後獨立新增，只補 review/export 的 `(client_id, organization_id, branch_id)` 兩個外鍵索引；不改舊 migration、權限、RLS、函式、資料或原 lookup 索引。 |

八份皆使用 `BEGIN/COMMIT` 並在交易起始設定 `set local lock_timeout = '5s'`，已於最終原生回歸確認；第 112 份另設 `statement_timeout = '30s'`。索引補正使用一般 CREATE INDEX，期間會短暫阻擋寫入，適用剛建立的工作流程表；拿不到鎖或建置過久即整筆停止，正式套用前仍須由發布者確認表大小及操作時機，不得移除 timeout 以強推。Migration 本身無資料清除、帳號開通、全表業務資料回填或既有資料表欄位重寫；新 activation RPC 只在另行事先核准且實際 Google 登入後執行開通。舊資料的查閱權限保持守門。公開 RPC 為 invoker，敏感 guarded helper 留在 private schema 並明確撤銷 PUBLIC/anon 權限；內部 helper 對認證角色的執行權限只提供帶完整權限檢查的入口。

## Hosted 只讀核對（最初四份套用前的歷史基線）

目標 `mmxqxsokpcdvuzmdhptg`。下列是最初四份 intake migration 套用前取得的 metadata，**不是本輪最終發布狀態**；正式 migration 與部署由發布負責人另行回查：

- PostgreSQL 17.6；104 份 migration；最新 `20260913123658`；本次 intake RPC 與 bucket 尚不存在。
- `storage.objects`、`storage.buckets` 已啟用 RLS、由 `supabase_storage_admin` 擁有；objects 目前無 policy。
- 發布 executor 為 `postgres`，非 superuser、具 BYPASSRLS。雖非 storage owner 成員，`supautils.policy_grants` 已明確包括 `postgres` 對 `storage.objects` 的 policy 操作；buckets INSERT/SELECT 權限也存在。沒有為通過檢查而更改 owner 或授權。
- `private` schema 不授予 anon usage；authenticated/service_role 有 usage，但資料表權限另行封鎖。
- Security advisor：既有 `rls_enabled_no_policy` INFO 153 筆，既有 `auth_leaked_password_protection` WARN 1 筆，沒有 ERROR。沒有把「無 policy」改成允許 policy；本系統私有表透過有限 RPC 存取，無 policy 是 deny-all 邊界的一部分。
- Performance advisor：既有未索引外鍵 INFO 361、未使用索引 INFO 890、multiple permissive policies WARN 13、Auth connections INFO 1。這是套用前基線，不能宣稱正式資料庫已無任何警告；未擴大本次工作去刪除既有索引或改動無關 policies。

只執行 catalog、權限及 advisor 查詢；未取得任何真實個案欄位，未做 hosted DDL 或測試寫入。

## 發布時仍須核對

1. 最終 source freeze 後重跑本腳本及完整前後端套件；移轉紀錄不可重複套用。
2. 先查正式 history 再套用仍待發布的 migration，並回查 catalog/ACL 與私有 bucket；已套用的 111 份不得重複套用。本輪只交付第 112 份本機驗證，正式套用及 advisor 回查由發布者執行；其餘歷史 INFO 不在本次擴修範圍。失敗需停止並確認 transaction 結果，不得跳過 RLS 或改成 public bucket。
3. 維持 CMS 封存、附件掃毒設定缺漏時的 fail-closed；不得宣稱設定不存在時可以正式上傳。設定、DPA、費用與真實資料責任由發布負責人另行完成。
4. 已登入角色的頁面→API→資料回讀、真 Google OAuth 啟用、簽署/表單發布、Storage HTTP/短效下載、防毒整合、實際 50 並行及備份還原仍是獨立驗收；這份報告不代替它們。

## 封存與掃毒前置（獨立 gate）

`infra/intake/README.md` 與 `scripts/preflight-intake-infrastructure.mjs` 記錄沒有新增費用的接通前置。38/38 合成測試通過、TLS/mTLS 與 CA 真解析採 fail-closed；本機實際 configuration-only 執行 exit 2、`operatorEnablementRecommended=false`。可見本專案／production 缺 AWS 封存及 ClamAV 配置，因此沒有執行真 AWS 或 scanner 連線，不把 mock 回覆或原生 SQL 通過當成基礎設施已可用。本工具無建立資源、PUT、DELETE、production env 或 hosted DB 寫入。

## 一手參考

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)：RLS 與 grants 必須一起檢查。
- [Supabase 索引管理](https://supabase.com/docs/guides/database/postgres/indexes)：一般 CREATE INDEX 的寫入鎖及索引驗證注意事項。
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)：Storage 與 RLS 的權限界線。
- [Supautils](https://github.com/supabase/supautils)：受控 policy grants 的 hosted 權限機制。
- [RLS-no-policy advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[密碼安全提醒](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)、[multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)。
