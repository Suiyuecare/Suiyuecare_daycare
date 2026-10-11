# 營運報表與評鑑：原生鎖競爭驗收

此紀錄是本地隔離 PostgreSQL 的合成資料驗收，不是正式 GoTrue 登入、正式個資操作、50 人 HTTP 效能或部署證明。

## 修正範圍

`20261011172000_operations_evidence_lock_reauthorization.sql` 在品質月報凍結的 1 個、評鑑覆核的 3 個及證據包的 2 個 advisory lock 返回後，重新確認目前機構／分支、使用者准入、精確權限及近期 AAL2。重新檢核發生在查閱冪等回條及讀寫資料前，不允許停用後重送取得舊回條。既有獨立覆核、來源／附件版本、掃毒、不可變紀錄及雜湊／版本衝突規則保持不變。

## 實際結果

PostgreSQL 17.11，本輪指令完整結束、exit 0、測試 cluster 已停止：

- 168／168 migration 原生編譯。
- 9 份嚴格 SQL 套件，667／667 assertions；包含 JUBO 收案準備 33、品質月報與評鑑 35。套件不得替換正式准入判定。
- 原有 20 組原生工作階段／鎖競爭測試保留通過；新增 11／11 組營運鎖等待測試，合計 31 組。
- 新增測試真正以兩個 PostgreSQL 工作階段等待 advisory lock；由 `pg_stat_activity`、`pg_blocking_pids` 確認正在等待後，另一工作階段提交工作階段撤銷、Google 開通停用或機構／分支停用。
- 6 個營運 lock 全覆蓋：月報 actor lock；覆核 collection、actor、item lock；證據包 collection、actor lock。新作業及可達的舊回條重送均收到 SQLSTATE 42501；無新增版本、月報、覆核、證據包或對應業務稽核，無舊回條輸出。主管停用機構／分支本身的稽核不誤列為新增業務稽核。
- Node 工具契約 16／16：12 個 HTTP 負載工具 mock 契約、4 個 post-lock migration 契約。後者只補充原生實測，不取代它。
- 本輪修改的 JavaScript ESLint 與 `git diff --check` 通過。

完整安全聚合 stdout 保存於 Git／Vercel 排除的 `private/native-acceptance/operations-20261012-final.log`，0600。前一輪原生驗收可見 `private/native-acceptance/admission-20261012-005554.log`；其 167／599 數字是前一版歷史結果，不取代本輪 168／667。

## 重跑

從此專案根目錄執行；只接受本機 PostgreSQL binary 目錄，不接受資料庫 URL：

```sh
INTAKE_NATIVE_PG_BIN=/Users/seniorlifepr/.local/share/edoc-backup-runtime/Postgres.app/Contents/Versions/17/bin node scripts/test-admission-native.mjs
node --test scripts/tests/operations-lock-reauth.test.mjs scripts/tests/http-load.test.mjs
node node_modules/eslint/bin/eslint.js scripts/test-admission-native.mjs scripts/tests/operations-lock-reauth.test.mjs
git diff --check
```

原生 runner 自建臨時 Unix socket cluster、禁止 TCP，結束時只停止自己的 cluster；使用合成 Google identity、Auth session／MFA metadata、已核准 staff grants，不使用簽造 HTTP JWT，也不覆寫 production authorization predicate。證據簽署 successor 是測試管理角色建立的合成 fixture，故本測試不宣稱真人簽署流程已驗收。

## 尚不能從此紀錄推論

- 真員工 Google 登入、正式角色 UAT、實際設備或 Storage HTTP 流程。
- 官方申報格式、主管機關接收、七年正式資料移轉完整度。
- Finance 已連線：仍需獨立 server token、Finance 負責人的正式 CAS 綁定核准及實際對帳；不能使用寬範圍舊 binding 冒充 J1101／E6 部門資料。
- 真正 50 人效能：`docs/HTTP_LOAD_ACCEPTANCE.md` 的工具與 mock 契約已就緒，但沒有隔離 GoTrue staging 與 200 個實際測試 session 時，不可宣稱實跑通過。正式東京與首爾 project、公司正式 hosts 永久列於該工具拒絕名單。
- 任何 GitHub／Vercel／Supabase 正式發布；須另由發布者完成放行及實際驗證。
