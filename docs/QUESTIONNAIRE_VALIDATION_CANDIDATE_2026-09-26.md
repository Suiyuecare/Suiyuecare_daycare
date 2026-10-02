# 題目式量表：獨立結構驗證候選

本輪僅補目前九份題目式量表的工程驗證候選，不是正式簽署、臨床核准、已採用規則或部署證據。原題庫／計分 v1 的 canonical JSON、雜湊、採用期間、退休紀錄與既有草稿操作均不得改寫。

## 凍結範圍

- 新 `questionnaire-validation-catalog.v1` 以獨立版本及 SHA-256 綁定精確的原計分目錄雜湊；標示 `candidateOnly: true`。
- 邊界為 `database-draft-wire`：忠實重現既有純資料庫答案與情境驗證，不冒稱前台 HTTP 前處理、使用者授權或可正式簽署。
- 缺題目鍵不能寫入；明確 `missing` 可保存草稿，但不完整。合法不適用理由可保存與否依既有資料庫逐工具差異，不完整也不產生零分。
- 已知 state 只接受對應的精確屬性組合，不轉型、不 trim、不補零、不接受未知題目／情境鍵。
- SPMSQ 教育情境可缺值保存，但不得被當成完整評估；備註不參與計分。
- MNA-SF 實測格式、單位、範圍、互斥路徑及答案一致性獨立封存；保留原字串，十分位整數交叉乘法重現 BMI，不先四捨五入。
- 驗證結果分開 `storageValid` 與 `status`。任何無效／不完整結果的分數、分類為 null；合法已回答的獨立 BSRS 安全警示不能被其他題缺答或格式錯誤抹掉。
- 候選驗證器只解讀白名單 JSON；沒有執行任意公式、JavaScript、SQL、簽署、採用或資料庫寫入介面。

## 不整併成新政策的差異

| 情境 | 現有資料庫草稿 wire | 現有 HTTP 草稿前處理 | 完整評估候選 |
|---|---|---|---|
| 不適用 | ADL／IADL／跌倒／NSI／MNA 可附合法理由保存 | 只開放 ADL／IADL | 九份均不完整 |
| 缺答案 | 必須有明確 missing state | 同樣保留 missing state | 不完整，不推估零分 |
| SPMSQ 教育情境缺值 | 可保存 | 可省略空值 | 不完整 |
| 文字處理 | Unicode 碼點長度；拒絕首尾 ASCII 空格與禁止控制字元 | 尚有 JavaScript trim／長度處理 | 新候選不改寫原文字 |

候選 `storageValid` 只代表純資料庫 wire 驗證通過，不代表 HTTP 接受、使用者具有存取權限、已寫入或具備核簽資格。

## 驗收與正式接線門檻

1. 原九份 v1 已登錄 canonical JSON 與 hash 全部保持一致；不得新增假採用或簽署。
2. 每份每題的全部合法選項、明確缺答、缺鍵、不適用、非法選項與額外 state 屬性皆有測試。
3. SPMSQ 情境、未知鍵、非字串、Unicode 長度／控制字元、MNA 小數、範圍、界線、互斥及測值一致性與實際 PostgreSQL 純驗證函式對照。
4. 完整答案的候選分數／分類／獨立警示與原封存計分表一致；任何驗證失敗均不產生分數。
5. 候選封存、綁定與內容竄改拒絕有回歸；原有前台／API 行為不變。

正式接線仍另需：真實來源原件與封存證據、私有不可變候選／組合目錄、新的雙人採用流程、逐表核簽资格／風險處置／補登／跨規則期間決議、正式簽署與更正原子交易、實際多人競爭、真人及 hosted 驗收。來源 URL 與本機驗證不能替代上述項目。

## 本輪證據

- 2026-09-27 凍結後四份新增測試檔 **93／93 通過**。九份 validation v1 雜湊有固定 golden，16 項錯誤結果規則包含於 manifest；所有可達分數、SPMSQ 三種教育情境、BSRS 五種安全答案皆重現原計分表，原九份 v1 canonical JSON／hash 不變。
- 隔離 PGlite 執行實際已存在的兩個 immutable／security-invoker 純 SQL 驗證函式，**3,224 組 JSON 資料逐筆 storageValid 一致**。沒有重寫 SQL 鏡像、替換 Auth 或操作 hosted；這不是原生多 backend、完整 RPC／RLS 或正式環境驗收。
- 獨立對抗測試涵蓋 getter 零執行、特殊／繼承欄位、未知欄位不回顯、回傳物件隔離、自行重算竄改 hash 仍拒絕、精確 MNA 界線、末尾控制字元，以及 PostgreSQL 無法表示的 NUL／孤立 surrogate。
- 全量第一次發現原異常事件 UI 測試寫死 `2026-09-30` 錯誤期限，剛好等於 2026-09-27 示範資料的合法期限；保留失敗與中止日誌，不稱第一次全量通過。只修正測試：依原期限加一天，固定驗證三個日期且保留真正等待計時、回條拒絕與合法對照；窄範圍 **8／8 GREEN**，未更動產品規則或放寬 timeout。
- 修正後完整凍結回歸 **521 檔／7,484 項全部通過，195.97 秒，無略過**；單 worker、原 timeout，跨 repo Finance 使用精確隔離候選。jsdom 的整頁導航診斷保留，不當成 Chrome／真人操作證據。
- 套件正式依賴檢查：當次 135 個依賴，已知 info／low／moderate／high／critical advisory 均 0；不取代滲透測試或 ASVS。

原始日誌保留於私有 `/Users/seniorlifepr/.codex/verification/daycare-20260926`：`questionnaire-validation-focused.log`、`questionnaire-validation-focused.json`、`questionnaire-validation-final-vitest.log`（首遍失敗後中止）、`questionnaire-validation-date-fixture-{red,green}.log`、`questionnaire-validation-final-vitest-repaired.log` 及 `questionnaire-validation-dependency-audit.json`。原生 SQL 未變，本機仍143份；前輪 native14套保留原 SQL 來源範圍，本輪不冒稱重跑。無 UI／API 接線、雲端新核對／DDL、GitHub push、Vercel 發布或新增費用。

凍結後全量 ESLint 零 warning、TypeScript、`git diff --check` 及隔離 production build 全部通過；編譯101個靜態輸出。build 明確清空外部配置、關閉 demo／Google／合成預覽，未連正式資料庫；不是 Vercel 發布或實際 Google 登入證據。本輪未改現有 UI／API／SQL，沒有重跑真人瀏覽器、路由89頁或原生14套，也不沿用其歷史結果冒充本輪新驗收。日誌為 `questionnaire-validation-final-{lint,typecheck}-repaired.log` 及 `questionnaire-validation-final-build.log`。
