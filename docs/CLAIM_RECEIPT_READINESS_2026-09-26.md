# 申報回執與重試安全：本機部署候選

## 結論與範圍

本批改善申報驗證、匯出快照與回覆對帳的安全邊界；不是官方送件格式、前台匯出／對帳、真人帳號或正式部署驗收。沒有使用真實個案、發布前台、修改 hosted Supabase／Finance 或建立付費資源。

## 已實作

1. 批次／明細 UUID 先正規化再去重，相同 UUID 大小寫混用不能繞過重複明細檢查。
2. 未知網路／資料庫結果回 HTTP 503，不宣稱未寫入；要求保留原內容與操作鍵。確定的權限 403、衝突 409、SQL 驗證拒絕 422 分開處理，畸形成功回執為 502。
3. 匯出／對帳使用新的 `export_claim_batch_receipt`／`reconcile_claim_batch_receipt`。HTTP 成功 shape 不增欄位，保持嚴格解析客戶端相容。
4. 回執從資料庫讀取已保存的機構、分支、衍生操作鍵、request hash、快照版本與原始完成時間；重播沿用原時間，不用請求 echo 當證據。
5. API 獨立以限定 PostgreSQL `jsonb::text` 契約重算 request hash。金額不經浮點轉換；UUID 小寫、明細排序、空訊息轉 null、UTF-8／引號／反斜線皆與 atomic SQL 一致。核准／退件互換即使總數相同仍拒絕。
6. 重新核對快照原文 hash、筆數、金額；對帳另由保存的逐筆回覆重算原請求 hash，拒絕作廢後 privileged 回覆維護造成漂移。既有快照核心內容作廢後原本就不可修改；測試的核心損壞是隔離 fault injection，不是一般員工編輯能力。
7. 公開 RPC 保留 invoker／RLS；私有執行入口固定空 search path，前後重新檢查讀取／操作權限及近期 AAL2。沒有 anon／service_role 執行授權；任何核對失敗回滾同一交易的狀態、明細與配置。

## 相容與部署次序

- CLI 建立的增量 migration：`20260926070013_claim_operation_receipts.sql`。不改舊 migration，不回填簽核人或原 API 鍵。
- 舊 RPC 保留簽名；舊 metadata-only parser 保留相容用途，正式 API 使用 bound parser。不能退回舊 RPC 掩飾增量未套用。
- 候選 138 份 migration；本批唯讀核對正式專案仍為 130 份、最後 `20260925141114`。先審核精準差異並完成資料庫版本驗收，再發布相依 API；不得整庫 reset／push。
- 既有 SQL hash 不含原 API 鍵／操作者；API 衍生 UUID 包含伺服器身份。本批沒有專用 actor ledger，不把 batch `created_by` 充當歷史操作人。

## 本機驗收

15 項新 PGlite 資料庫測試使用全部候選 migration、合成 Google 身分、實際執行的 session／AMR 授權判斷，沒有替換權限 helper。涵蓋重播、跨範圍、同鍵內容變更、讀取權限、寫入後撤權／不完整回執整筆回滾、作廢後回覆漂移及隔離損壞拒絕。

原生 PostgreSQL 17.11 全部十套通過，138 份 migration 原樣編譯。申報新增四個實際多 backend 鎖等待探針：匯出／對帳各一次提交與一次精確重播；另一交易在等待中完成 membership／session 撤權時，操作拒絕且配置為零。最終本批證據：`/tmp/daycare-claim-operation-native.j6IYE3/evidence.json`。

```sh
INTAKE_NATIVE_PG_BIN=/absolute/path/to/postgresql/17/bin pnpm test:database:native:claims
```

成功 cluster 均停止，只清除本次 data，保留證據與備份。第一次 standalone harness 的 marker 拼接錯誤修正後重跑通過；其已停止的失敗資料保留，不計為產品 SQL 失敗，也不擅自刪除其他歷史測試。

這不是 hosted Auth／HTTP、官方申報、50 位員工或效能證據；最後全量程式／SQL／build 結果另見 `RELEASE_READINESS_2026-09-26.md`。

## 仍待改善／正式證據

- **P1：申報驗證離頁與範圍。** `ClaimValidationComposer` 只在元件記憶體保存原請求，沒有明確 actor／機構／分支 scope 或全域 pending lease。唯讀合成重現：未知結果後 unmount/remount 改用新鍵；待回覆時改為無權限／空清單仍可能顯示舊成功並刷新。沒有證實跨分支寫入或重複提交，SQL 仍拒絕範圍不符；上線前須補固定 scope、離頁與晚到回覆防護及真瀏覽器驗收。
- **前台與官方格式。** 目前申報工作台只有驗證草稿，尚無匯出／對帳操作入口。真實年度／縣市格式、核定規則、回覆檔、金額及平行申報週期待驗收，不由工程人員猜測。
- **授權窗口。** final check 可拒絕鎖等待期間已提交的撤權，不代表 check→COMMIT 已與撤權完全序列化；既有 membership 的 transaction-start `now()` 自然到期語義未更改。仍沿用 CEO／高風險 AAL2 政策，不自動擴權。
- **雲端與營運。** Vercel 本批仍為正確團隊 403、可見團隊為空；hosted 增量未套用。正式量表簽署、CMS 不可變封存／掃毒、Finance hosted 對帳、商用方案／區域與其他營運門檻仍依 `PRODUCTION_GATES.md`，不能提前標示通過。
