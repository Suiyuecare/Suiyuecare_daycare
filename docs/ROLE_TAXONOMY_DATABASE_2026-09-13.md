# 十一類職務：資料庫實作與驗證

日期：2026-09-13。狀態：本機實作與合成資料驗證；尚未套用至正式 Supabase，未新增或開通任何真實帳號。

## 系統角色

| 順序 | 顯示名稱 | 穩定角色鍵 | 資料範圍 |
|---:|---|---|---|
| 1 | 全機構管理員（多點管理） | organization_manager | 所屬機構內，可明確核准跨分支 |
| 2 | 機構管理員（單點管理） | branch_supervisor | 必須指定單一分支 |
| 3 | 機構主任 | branch_director | 必須指定單一分支；護理／社工另行核准兼任 |
| 4 | 護理人員 | nurse | 原有個案、分支與專業限制 |
| 5 | 社工人員 | case_manager_social_worker | 原有個案、分支與專業限制 |
| 6 | 照顧服務員 | care_worker | 原有指派與當日工作範圍 |
| 7 | 駕駛人員 | transport_driver | 原有交通工作範圍 |
| 8 | 專業人員 | professional | 原有專業服務範圍 |
| 9 | 財務人員 | finance_claims | 原有帳務與申報範圍 |
| 10 | 系統維護人員 | platform_ops | 不新增明文個案權限 |
| 11 | 家屬／關係人 | family | 原有逐個案、逐類別同意；無員工權限 |

資料庫不以名稱排序決定權限。前端依相同十一類順序呈現；原有十個角色的 UUID、角色鍵與權限集合全部保留，只有系統範本名稱調整。租戶自訂角色（包含相同角色鍵）不更名、不重分類。

## 主任的保守預設與兼任

新增 UUID：`10000000-0000-4000-8000-000000000011`。

主任範本只有六個只讀權限：`clients.read`、`clients.view_all`、`attendance.read`、`care_records.read`、`services.read`、`notifications.read`。本次不複製管理員權限，也不預設附加護理或社工角色。

主任兼任護理／社工，沿用同一人的同一個分支 membership，分別透過現有治理流程核准額外角色。角色分類不代表專業資格已查驗；臨床簽署、執登與有效資格仍須另外驗收。本次未製作資格自動核准，也未放寬既有 AAL2 高風險操作。

目前沒有獨立 `staff_daily_roster.read` 權限，故未添加或猜測該權限。主任範本不宣稱已具備完整排班管理、所有專業表單查閱或員工健康資料查閱。

## 單點邊界

- 部署前檢查既有系統 `branch_supervisor`／`branch_director` 是否被配置在 `branch_id IS NULL` 的 membership；任何一筆（即使已停用）存在便停止整個 migration，要求人工核對。不可猜據點或直接改派。
- migration 自帶明確 `BEGIN`／`COMMIT`，讓前置檢查與安裝 guard 在同一交易鎖定角色、membership、指派與治理請求表；鎖等待超過五秒失敗，避免檢查與安裝間夾入不合規指派，不假設 CLI 自動建立交易。
- 指派當下會鎖定並重新讀取 membership、profile 與 role，拒絕單點系統角色的全機構空分支範圍。核准舊請求時，實際指派仍執行此驗證。
- 建立治理請求時即拒絕不合規範圍；撤銷角色仍可進行。
- 已指派到全機構的其他系統角色，不可透過改角色鍵變為單點主任／管理員。
- 原有 `memberships_prevent_key_change` 保持不變：機構、分支與使用人不可直接改寫，調動須建立適當的新 membership，再核准角色。
- `organization_manager` 的明確跨分支 membership 不受影響；也不因此獲得跨機構權限。

## 安全與非變更項目

三個資料表 invariant trigger 置於 private schema、固定空 search_path，撤銷 PUBLIC、anon、authenticated、service_role 的直接呼叫權。這些 trigger 為維持資料完整性而讀取完整 metadata，不是對外授權 RPC；沒有增設暴露資料表、RLS 放寬、service-role 前端金鑰或 `user_metadata` 授權。

不變更：登入政策、Google 逐人白名單、AAL1/AAL2 定義、正式簽署、既有 role permissions、既有帳號、任何個案正式資料、既有稽核紀錄、第三方付費方案與部署區域。更新範本與新 role grants 由既有稽核 trigger 追加紀錄，不改寫舊稽核。

## 可重跑的驗證

```sh
node scripts/test-database.mjs eleven_role_taxonomy_branch_scope.test.sql
node scripts/test-role-taxonomy-upgrade.mjs
pnpm test:database
```

- 新角色／範圍 suite：51／51 通過；採真實登入判定且以 authenticated 實際呼叫安全個案目錄 RPC，測試跨分支／機構拒絕與禁止直接讀取受保護個案表，沒有替換登入 predicate。
- 升級 suite：19 項資料驗證及 1 項明確交易邊界驗證，共 20／20 通過。先載入前 103 個 migration，建立不合規合成舊指派，證明新 migration 中止且資料不變；明確撤銷測試指派後證明成功升級，既有 ID、role keys、grants、memberships、people、tenant custom role、clinical records 與舊 audit rows 保持一致。成功升級前確定存在有效護理指派、臨床草稿及明確歷史 audit fixture，避免以空集合假證明保留資料。測試不再提供外層 `BEGIN`／`COMMIT`；僅在 migration 失敗、交易已中止時明確 `ROLLBACK`。
- Migration 編譯：104 個通過。
- 新本機 upgrade script 的 ESLint 與 diff whitespace 檢查通過。
- 全資料庫回歸：101 個 SQL suite、4,485 項 assertion 全部通過。包含 93 個既有本機多角色 fixture suite 與 8 個未替換登入判定的 suite；這個分布不得誤報為全部正式登入測試。

舊的 `pre_mfa_challenge_eligibility.test.sql` 第 16 位合成人物原本使用單點管理員卻配置全機構 membership。依該案例原意「組織範圍員工可進行 MFA」，僅將這一筆 fixture 的角色改為既有多點管理員；原 42 項驗證全部保留並通過，沒有放寬新 guard 或覆寫登入測試邏輯。

`supabase db advisors --local` 無法連線至 `127.0.0.1:54322`；本機沒有啟動原生 Supabase PostgreSQL。PGlite 不是正式 PostgreSQL、跨工作階段並行或正式登入驗收的替代。本次未對 hosted database 執行 advisory 或寫入。

正式發行仍需：角色表與 UI 同步版本、實際分支／使用人與職務核准、資料庫前置檢查、原生 PostgreSQL/advisory 與並行指派／角色身分異動測試、實際 Google 登入與讀寫權限矩陣驗證。不得僅因本機測試通過就開放全部員工。

## 2026-09-14：原生 CLI 交易邊界修正

發布流程確認 CLI 2.105 的 `db push` 不會替這份 migration 建立所需交易：原版在 `SET LOCAL` 出現 `25P01` 警示，接著 `LOCK TABLE` 以 `25P01` 停止，尚未執行角色範本寫入。前一天的 PGlite 多語句執行與 upgrade harness 外層交易掩蓋了這項原生執行差異；4,485 項歷史本機測試不能取代原生發布驗證。

本次僅對尚未套用成功的 `20260913123658` 補上明確交易，並校正測試；不更動已成功套用的 `20260913111916`、權限集合、五秒鎖、preflight 或 guard。修正者僅執行本機測試，沒有 hosted database 寫入；正式發布結果由根代理另行確認。

修正後重跑：104 個 migration 編譯、角色 SQL 51／51、upgrade 20／20、ESLint 與 diff whitespace 檢查通過。前述 4,485 項全量回歸為 2026-09-13 證據，本次交易修正沒有再重跑整包全量回歸，也不宣稱已完成原生 CLI 重套。
