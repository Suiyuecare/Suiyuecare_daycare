# 50 人 HTTP 負載驗收（隔離 staging 專用）

## 現況與邊界

工具：`scripts/test-http-load.mjs`；契約測試：`node --test scripts/tests/http-load.test.mjs`。

**工具可執行，不代表正式負載驗收已完成。** 目前沒有專用 GoTrue staging、200 個真實測試登入工作階段及完整 fixture，因此不能執行實際負載；不得產生假 JWT、借用正式帳號或將 mock 報告當成正式證據。

永遠拒絕：`daycare.suiyuecare.com`、`finance.suiyuecare.com`、`apm.suiyuecare.com`、公司主網域，以及 Supabase 正式首爾 `mmxqxsokpcdvuzmdhptg` 和東京 `diompsnswchpfguvryan`。即使指定 allowlist 也不能覆寫。工具不連 Finance，不寫帳本、不簽署、不申報、不給藥、不匯入真人資料。

## 執行前準備

1. 在**獨立、僅合成資料**的 Supabase 專案部署完整 migrations、Auth/Google 設定與 RLS，並使用相同版本的隔離 staging app。不得讓 app／SSO／Storage／Finance／通知／監控指向正式系統。測試通知使用 fake adapter，不寄真信／LINE／SMS。
2. 由負責人核对 app 的實際環境設定、部署 commit、專案 ref 與僅合成資料，建立一小時內有效的 `stagingAttestation`。這是人工配置審查，不是工具替負責人簽認；工具另外實測資料量與隔離。
3. 建立 5 個分支，每分支 100 位有效且已收案的合成個案、40 位獨立的分支照服測試員工，共 500 個案、200 員工。員工需經原本的核准 Google 入場、有效職務／指派及 `clients.read`、`care_records.read/write`；不得使用跨分支主管或 `service_role` 冒充 200 員工。
4. 準備當年度往前共 7 個曆年的合成照顧日誌。每位個案每完整年度至少 240 筆；當年度至少按已過日數比例的 240 筆。這是代表量**下限**，实际機構的七年筆數較大時，manifest 應採实际較大基線。每個案／年度的 `historyCounts` 必須與 API 可見終端紀錄**完全一致**，不是只宣告總數。這個讀取 snapshot 目前包含所有歷史，過大或太慢會真實失敗，不得減少 fixture 偽造通過。
5. 所有 baseline 日誌的 `care_item` 必須為 `LOADTEST_FIXTURE:<fixtureId>`、`note` 為 `LOADTEST_ONLY`、`abnormal=false`。不使用姓名、地址、電話、身分證、真人醫囑或影像。建立另一個機構的合成個案作跨機構否定探針；不可用不存在的 ID 代替。
6. 透過正常 Google 流程取得 200 位測試員工各自的有效 GoTrue session 與 Next SSR cookie。fixture manifest 只記 UUID 與**私有環境變數名稱**，不含 email、cookie、JWT 或 refresh token。登入憑證透過私有程序環境載入，不能貼聊天、加入 repo、用 `set -x`、輸出 env 或存入報告。
7. 使用專案的 publishable key（`DAYCARE_LOAD_PUBLISHABLE_KEY`）。工具不接受 service-role key、管理 PAT 或自行簽出的 token。token 必須來自 manifest 指定的**獨立 GoTrue**，具 OAuth AMR，並至少還有「測試期間＋5 分鐘」效期。工具會對每個真 session 呼叫 GoTrue `/auth/v1/user`，不是信任解碼 JWT；[Supabase session 說明](https://supabase.com/docs/guides/auth/sessions)。

## manifest 結構

下面只描述結構，省略陣列項目；不是可以拿去跑的 500／200 資料檔。fixture 建立工具／資料負責人應產生完整 JSON，檔案放 repo 外並設 `0600`。

```json
{
  "version": 1,
  "environment": "isolated-staging",
  "dataClass": "synthetic-only",
  "fixtureId": "<UUID>",
  "appOrigin": "https://<exact-staging-or-preview-host>",
  "authOrigin": "https://<new-isolated-20-letter-ref>.supabase.co",
  "stagingAttestation": {
    "notConnectedToProduction": true,
    "sourceCommit": "<40-character-commit-SHA>",
    "verifiedAt": "<ISO-time-within-one-hour>",
    "reviewReference": "<non-sensitive-change-review-ID>"
  },
  "historyYears": [2020, 2021, 2022, 2023, 2024, 2025, 2026],
  "branches": [{ "organizationId": "<UUID>", "branchId": "<UUID>" }],
  "clients": [{
    "clientId": "<UUID>", "organizationId": "<UUID>", "branchId": "<UUID>",
    "active": true, "admittedOn": "2020-01-01",
    "historyCounts": { "2020": 240, "2021": 240, "2022": 240, "2023": 240, "2024": 240, "2025": 240, "2026": 190 }
  }],
  "sessions": [{
    "actorId": "<UUID>", "sessionId": "<UUID>", "organizationId": "<UUID>", "branchId": "<UUID>",
    "accessTokenEnv": "DAYCARE_LOAD_ACCESS_000",
    "cookieEnv": "DAYCARE_LOAD_COOKIE_000",
    "assignedClientIds": ["<assigned-client-UUID>"]
  }],
  "foreignClient": { "clientId": "<UUID>", "organizationId": "<other-organization-UUID>", "branchId": "<other-branch-UUID>" }
}
```

各 session 的個案指派必須涵蓋全部 500 個案；每位只有自己的分支。所有 UUID、session、credential 引用不可重複。未知欄位（包含内嵌 token／cookie）會被拒絕。manifest 的年度隨執行當年移動，不可用固定過時 7 年。

## 執行

確認隔離環境與私有 env 已準備後：

```sh
node scripts/test-http-load.mjs \
  --manifest /absolute/private/daycare-load-fixtures.json \
  --allow-origin https://your-exact-daycare-staging.example \
  --allow-auth-origin https://your-new-isolated-ref.supabase.co \
  --confirm-synthetic-fixtures <fixture-uuid> \
  --duration-seconds 600 \
  --report /absolute/private/daycare-load-aggregate-report.json
```

HTTPS app host 名稱必須明示 `staging`／`preview`／`loadtest`；本機 app 可使用 loopback HTTP，但仍須真實隔離 GoTrue。兩個 origin 均須由命令列**精確** allowlist，不接受 wildcard、路徑、userinfo 或 redirect。CLI 只接受 60–1800 秒，預設 10 分鐘。report 採 `0600` 且 exclusive create，不覆寫舊驗收證據。

工具執行順序：200 GoTrue 真身份核對 → 500 個案逐年度 API 數量核對 → 200 員工跨分支及跨機構讀取必須 403 → 50 個 worker 混合讀寫。全球 semaphore 保證含兩筆競爭寫入在內，最多 50 個 HTTP in-flight；worker 輪流使用全部 200 session 與 assigned clients。

每個流程：讀 snapshot → 建立 unsigned draft → 同 key／同內容 replay → 同 key／異內容必須 409 → 兩個不同 key／相同 base version 的 draft edit 同時競爭（一筆 201、一筆 `VERSION_CONFLICT` 409）→ snapshot 核對唯一終端、恰好兩個歷史版本、原作者、內容及無丟失 → 多次 snapshot 讀取與跨分支 403 探針。不提供簽署／更正／給藥／服務／申報操作。

## 放行標準

| 項目 | 必須通過 |
|---|---|
| 環境與規模 | preflight 全通過；5 分支／500 個案／200 真 session／7 年逐個案逐年度數量吻合 |
| 實际併行 | observed peak in-flight 恰好 50；實际 workload 用到全部 200 員工及 500 個案 |
| 樣本 | 一般讀取和寫入各至少 1,000 樣本；不足延長重跑，不以 preflight 補算 |
| 速度 | nearest-rank p95 讀取 ≤2,000ms、寫入 ≤1,500ms；**全體及成功請求**均須通過，不能用快速 403／409 稀釋慢的成功操作 |
| 冪等及版本 | 每完成流程恰好一次原建檔／原鏈、一致 replay、預期 409、唯一競爭勝者／無最後寫入者覆蓋 |
| 完整性 | 完成流程數、exact replay 數、預期冪等 conflict 數、CAS conflict 數一致；讀回原作者／原內容／兩版本／一終端 |
| 隔離及錯誤 | unexpected error、timeout、leak、duplicate、missing 均 0；回覆具 private no-store 且非 demo |
| 證據 | 僅彙總數字、machine error codes、隨機加鹽 scope／origin hash；不得含 body、個案／員工 ID、cookie、JWT、堆疊 |

HTTP 計時包含接收並解析完整 JSON，不只 response headers；單筆超過 8MiB、10 秒 timeout、redirect、非 JSON、未知結果全部失敗。測試中首次錯誤會停止新增工作／寫入，保留已完成合成草稿供核對；不自動刪除、重設或回滾 staging 資料。

實際壓測會留下 `LOADTEST_RUN:<runId>` 合成草稿。下一次重新跑應從**新的已審查 fixture 快照**建立隔離 dataset；不要刪除舊證據或把舊 run 殘留混入新基線。工具的首次審查會拒絕非當次 fixture／run 的資料。

## 報告解讀與尚未涵蓋

`proofLevel=mock-http-tool-contract-only`：只驗證工具，不是 GoTrue／SQL／負載結果。`proofLevel=isolated-staging-http` 與 `accepted=true`：仅代表該隔離環境、該 commit、此 unsigned 照顧日誌工作量通過；`productionVerified` 永遠為 false。不能推論全部 89 頁、真人照顧流程、正式 SLA 或所有 API 都通過。

另外測：生命徵象／用藥／正式評估／申報／Finance（各自合法角色）；檔案上傳掃毒與下載不同尺寸及併行、storage 網路區域、瀏覽器主畫面與弱網／行動裝置體感。備份還原、DPA、PITR、RPO／RTO、第三方滲透與正式 Google 真人操作仍各自保留上線門檻。本工具不讀取／更動正式東京或首爾庫來填補這些缺口。
