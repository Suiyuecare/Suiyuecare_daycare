# 家屬端資料存取安全修補（2026-09-08）

## 範圍

本次只檢查家屬端第 84–89 頁共用的身分、同意、RLS、RPC 投影與空狀態。所有測試資料均為固定 UUID 與合成名稱；未連線至正式 Supabase、LINE、AWS、簡訊或任何真實使用者資料。

## 修補前的負面證據

既有家屬讀取函式將兩種不充分的條件誤當成有效授權：

1. `workflow_version IS NULL` 的舊版同意資料沒有一次性 OTP／關係確認／明確同意文件的消耗證據，但 `family_client_summaries` 與 `can_read_client` 仍接受 `scopes = ['*']`。
2. `family_care_summaries` 只檢查 `care_records.status = 'signed'`，未檢查終端版本，也沒有機構核准對家屬發布的紀錄。因此簽署版之後已作廢，或屬內部用途的類別，仍可能回傳中繼資料。

修補前的 `rls_access.test.sql` 明確建立 legacy wildcard 同意，並把下列結果寫成成功預期，形成可重現的負面基線：

```sql
set local role authenticated;
-- request.jwt.claims 指向合成家屬帳號
select count(*) from public.family_client_summaries();
-- 修補前：1

select count(*)
from public.family_care_summaries('合成個案 UUID');
-- 修補前：1
```

這不是資料內容洩漏的正式環境證明，而是舊契約在本機資料庫測試中主動允許上述路徑的證據。

## 已落實的修補

Migration `20260908008000_family_portal_read_hardening.sql`：

- 新增不對 browser role 開放的 `private.has_current_governed_family_consent`。
- 只接受 `workflow_version = 1`、精確 recipient、client、organization、branch、relationship、scopes、document version、有效期限及 evidence hash 全部相符的同意。
- 驗證 evidence 已由 grant actor 在有效時間內精確消耗，且關聯的 AAL2 challenge 具有受允許的 factor evidence。
- legacy row、`*` wildcard、未消耗 evidence、已過期、已撤回、關係漂移及缺少資料類別 scope 全部拒絕。
- `family_client_summaries` 只使用上述治理後的 `client.read` 判斷。
- 尚無「機構核准對家屬發布」資料模型，因此 `family_care_summaries` 明確回傳零筆。簽署是內部紀錄終結狀態，不等同家屬發布核准。
- 未新增任何 base table grant；家屬仍不能直接讀取 `clients` 或 `care_records` 完整資料。

Server／UI 邊界：

- RPC 回傳經 strict Zod schema 驗證；未知欄位、錯誤 UUID、無效曆日、重複 ID 或超過 500 筆一律 fail closed，錯誤訊息不包含原始資料。
- 第 85–89 頁分別顯示「訊息」「健康與照顧摘要」「行程、活動與交通」「帳務與核准文件」「通知與設定」的資料類別狀態。
- 這些頁面的專用授權與發布投影尚未建立時，正式畫面只顯示「未配置／無資料」，不再用 client identity 更新時間冒充該頁資料已授權或已發布。
- 多位獲授權個案必須先明確選擇一位；畫面不自動合併不同個案。
- 第 84 頁正式首頁改為中性的「今日出勤」，不在 `attendance = null` 時聲稱「今天已到中心」。照顧發布尚未配置時，當日完成數及最近更新時間均維持 `null`，不以個案身分資料的異動時間冒充照顧更新。
- Server loader 也拒絕非空的舊版 `family_care_summaries` 結果，避免程式先更新但資料庫尚未套用 migration 時意外公開內部紀錄。已簽署不等於已核准家屬發布。

## 回歸證據

2026-09-08 本機聚焦驗證：

- Database compile：86 migrations passed。
- `family_portal_read_hardening.test.sql`：21/21。
- `family_consent_workflow.test.sql`：68/68。
- `rls_access.test.sql`：32/32。
- 家屬 snapshot／loader strict boundary 與第 84–89 頁 React 測試：4 檔、19/19。涵蓋空值與更新時間的誠實顯示、舊 RPC 非空結果拒絕、跨分支拒絕、多個案不自動選取及不存在曆日。
- `pnpm typecheck`：通過。
- 聚焦 ESLint：0 warnings／0 errors（最終次數以最新測試輸出為準）。

pgTAP 覆蓋 current、expired、revoked、未消耗 evidence、relationship mismatch、category scope 不相符、不同 recipient、跨 tenant/client、signed→voided 與 arbitrary internal category。舊版 RLS 測試也已改成要求 legacy wildcard 與未發布照顧中繼資料均為 0 筆。

## 仍刻意維持未配置

- 第 84–89 頁尚未具有完整、逐資料類別的 family publication projections；健康、用藥、照顧、行程、交通、帳務、文件、訊息與通知內容不得視為已完成。
- 尚未配置的資料不以空值代表正常，也不以示範資料填入正式畫面。
- 尚未建立家屬端 24 小時離線讀取快取及撤權推播清除機制；目前不宣稱具備該能力。
- PGlite 是本機 PostgreSQL 相容性檢查；正式 Supabase PostgreSQL、併發情境與部署環境仍須由整合驗證階段確認。
