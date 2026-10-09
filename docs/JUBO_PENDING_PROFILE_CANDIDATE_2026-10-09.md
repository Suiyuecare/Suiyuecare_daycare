# JUBO 待收案完整資料版本：候選驗收（不得部署）

此候選交易須先通過原始 XLSX 同位元組解析、23/17 核對、23/23 逐筆主管 AAL2 核准，才可由資料庫擁有者執行。它不授權出勤、服務、用藥、交通或申報，也不從 JUBO 開案日／首次服務日推定本機構收案日。

## 同一交易的產物

- 23 筆 `public.clients` 均為 `pending`、`admitted_on=NULL`、`ended_on=NULL`；17 筆月清冊只供核對，不另建個案。
- 每筆必有 `private.client_intake_versions` 第 1 版，包含姓名、生日、正規化身分識別、性別、戶籍／居住地址、CMS 等級、身障資訊、主要聯絡人／代理人與待確認同意。空白值保持空白；個案電話不由其他電話欄位猜測。
- 每版以 `private.jubo_intake_profile_sources` 連回不可變原始主檔列、可選月清冊列、原始列 SHA-256、欄位索引、解析／映射版本與待補警示。原值由連結的 `private.jubo_source_rows.raw_values` 及 `column_labels` 讀取；稽核與回條不回傳姓名、證號或地址。
- 任一列不符來源型別、身分雜湊、欄位驗證或 FK 時，整批交易回滾；相同冪等鍵重送只回同一回條，不能再建立版本。

## 主權與目前硬阻擋

JUBO 是經核對的廠商匯出，不是中央 CMS 的官方權威。第 1 版欄位標示 `jubo_export`，不冒充 `central`；正式 CMS 匯入仍須逐欄人工確認，不能以後來資料靜默覆寫來源。現有 `private.write_intake_profile` 及個案主檔編輯投影不開放 `pending`；新增的資料庫護欄對此批個案即使日後解除待收案，也拒絕無正式 CMS 來源的第 2 版。故目前主管**可以看來源及缺漏，但尚不能在此候選版補資料**。另需獨立設計「機構補充欄位」的狹義 allowlist、版本與覆核，不能只把 `pending` 加進通用更新狀態清單。

本 SQL 以已審查的來源列重建 JUBO 規劃器對應欄位；內部個案代碼採資料庫新建代碼，不假稱等於規劃器以機密 HMAC 產生的候選代碼。尚未用兩份實際核准 XLSX 逐欄驗證 SQL 與 `JuboImportPlan` 的 Unicode 正規化、空值、日期及欄位映射完全一致，也未證明正式入庫 worker 的 staged rows 與核准 XLSX 位元組完全一致；亦未完成所有模組對 `pending` 狀態的解析／讀寫隔離、真實 PostgreSQL 併發、真人 AAL2、東京搬遷及完整前端驗收。因此即使 PGlite 合成測試通過，**不可將此候選 promotion 合併、發布、部署或用於真實個資**。
