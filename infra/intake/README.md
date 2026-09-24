# CMS 封存與附件掃毒：不新增費用的接通前置

## 2026-09-14 現況

**目前不能真正接通。** 本專案 `.env.local`、執行環境、Vercel production 均無 `AWS_`／`HTML_ARCHIVE_`／`CLIENT_DOCUMENTS_` 設定。本機沒有 AWS profile、credentials、AWS CLI、clamd 或 clamscan；沒有已連接 AWS 工具。這不等於公司沒有 AWS 帳號，只表示本次可見授權不足以確認或使用既有資源。

沒有建立 AWS bucket、KMS key、VM、容器服務、TLS 憑證或新的付費方案；沒有更改 production env／DB，沒有發送真實個資。請勿為了明日上線，把 scanner 改成 fake-clean、改用公開 bucket、取消 Object Lock 或略過 TLS 驗證。

## 公司需要提供／授權什麼

由公司管理員在正式秘密管理或部署設定中提供，不要把秘密貼到聊天或 Git：

1. 可使用的公司 AWS 身分：既有、限本系統的執行角色或憑證；可執行此專案所需 S3/KMS 操作。沒有角色時先由公司決定使用哪個 AWS 帳號，不能自動建立收費資源。
2. **既有東京 `ap-northeast-1` bucket**、KMS key ARN。Bucket 必須啟用 versioning、Object Lock COMPLIANCE 預設七年、Block Public Access、SSE-KMS；金鑰 Enabled、對稱加解密用途、未排程刪除。不能把一般 Supabase Storage 當作 WORM 證據。
3. 可讀取的既有**合成測試物件**版本，路徑限 `healthchecks/intake/`：版本 ID、SHA-256、建立時間。物件須有 `data_classification=synthetic-intake-preflight` 和 `sha256` metadata。本腳本只 HEAD、不 GET 檔案內容、不 PUT。若從未做過真實封存測試，須先明確批准一次合成 canary 寫入；七年鎖定不能承諾可事後刪除，S3/KMS 使用本身可能產生用量費用，因此本輪沒有自行執行。
4. **既有公司 ClamAV TLS gateway** 的 DNS／port；可信任有效伺服器憑證、允許此服務連線、最新病毒庫、INSTREAM 功能。不得把 clamd 3310 明文埠開到網際網路。
5. 供應商、資料區域、DPA／次處理者、保留及退出審查人。`CLIENT_DOCUMENTS_SCANNER_APPROVED=true` 表示人工治理核准，不是連線健康證明。沒有現成東京 scanner 或安全網路時，由公司先選定可不增費沿用的資源；本輪不替公司採購。

TLS 只驗證伺服器及傳輸加密，不等於限制誰可以呼叫 scanner。本輪採用 `CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE` 明確區分 `mtls` 與 `private_network`。mTLS 需成對用戶端 certificate/key；private_network 不可混用用戶端 certificate/key，且必須已有公司核准的網路存取控制。沒有 mode 即停用，不能直接架設公開匿名 TLS proxy。所有 PEM 僅放在 server secret，不放 Git 或 browser；本輪未提供真憑證，也未建立 gateway。

## 健康檢查工具

`scripts/preflight-intake-infrastructure.mjs` 是獨立發布 gate，不會設定任何環境變數，不會新增或寫入雲端資源。預設**不連線**，只看明確傳入的 process env；不自動載入 `.env`，不尋找其他專案的 secrets。

```sh
node scripts/preflight-intake-infrastructure.mjs
```

資料缺漏時 exit 2，`operatorEnablementRecommended=false`。本機實際執行結果就是此狀態，不是成功。

確定既有資源與授權後，可在公司受控且有 AWS CLI v2 的工作階段執行：

```sh
node scripts/preflight-intake-infrastructure.mjs --live-read-only
```

可用設定鍵名（值只放在受控環境中）：

```text
AWS_REGION=ap-northeast-1
HTML_ARCHIVE_BUCKET=
AWS_KMS_KEY_ID=
CLIENT_DOCUMENTS_CLAMAV_HOST=
CLIENT_DOCUMENTS_CLAMAV_PORT=3310
CLIENT_DOCUMENTS_SCANNER_APPROVED=false
CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE=
CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM=
CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM=
CLIENT_DOCUMENTS_CLAMAV_CA_PEM=
INTAKE_PREFLIGHT_CANARY_KEY=
INTAKE_PREFLIGHT_CANARY_VERSION=
INTAKE_PREFLIGHT_CANARY_SHA256=
INTAKE_PREFLIGHT_CANARY_CREATED_AT=
```

Live 模式只使用 allowlist 的 STS/S3/KMS 讀取指令，驗證 AWS 帳號一致、bucket 真實區域、versioning、COMPLIANCE／七年、阻擋公開存取、KMS 狀態及既有 canary HEAD 版本／checksum／保留證據。AWS 端點固定東京官方 HTTPS，拒絕 endpoint override。不列舉 bucket、不讀個案內容、不執行 PUT／DELETE／建立資源／調整權限。

Scanner 使用證書驗證 TLS 1.2 以上連線，測試 PING、VERSION、48 小時內病毒庫、合成 benign control 與無害標準 EICAR positive control。測試字串僅在記憶體中；不使用使用者附件。連線錯誤、簽章庫過期、超大或格式錯誤回覆、positive control 竟得到 clean 都令 gate 失敗。輸出僅代碼與布林值，不輸出 host、ARN、物件鍵、命令錯誤全文或秘密。

一次 HEAD canary 不保證當下 PUT 權限仍有效；read-only gate 通過後，仍須在正式執行身份下完成經批准的合成寫入→精確版本 HEAD／下載雜湊驗收。此工具也不驗證供應商合約或實際網路隔離，不能取代治理核准。

## 既有 connector 的健康判斷差距

- WORM adapter 已逐次核對 PUT 返回的確切版本、KMS、COMPLIANCE、checksum 與保留日；存不成功不會把正式個案寫成匯入成功。
- 但上傳入口目前只用 env 有值作「已設定」判斷，未先檢查 bucket 的真實區域、預設保留及 key 健康。這不能宣稱服務正常；發布負責人應先要求上述 live gate 與合成寫入實證再啟用設定。
- Scanner adapter 已 TLS/fail-closed，收到失敗不會冒充 clean；核准 flag、host、明確 access mode 及可解析的 TLS 設定會建立 scanner object，但不代表端點健康，且既有流程可能先儲存隔離附件才發現 scanner 不可達。新工具補足發布前負／正控制及病毒庫新鮮度檢查；**尚未把即時健康狀態接到現場 UI**。
- 建議後續以受控健康狀態區分「未設定／無法連線／服務正常」，短期故障關閉新上傳、保留隔離狀態與重試，不把 `APPROVED=true` 當作持續健康訊號。此 preflight 工具不自動變更 app 或 production 設定，不能將未經真端點驗收的設定當作已接通。

## 本輪測試證據

`pnpm exec vitest run infra/intake/preflight.test.mjs`：38/38。這些是明確注入的合成回應，驗證 gate 邏輯，不是正式 AWS/ClamAV 接通證明。實際無配置執行則正確阻擋、無網路請求；scanner adapter 也拒絕 SHUTDOWN 等指令與任意附件 bytes，只允許兩種合成控制字串。可選 CA 逐段使用 Node X509Certificate 真解析，避免 createSecureContext 默默接受錯誤 CA 字串；所有 TLS material 上限與 app 一致為 32768 字元。

## 一手依據

- [AWS Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)：COMPLIANCE 及版本保留特性。
- [Object Lock 管理注意事項](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html)：保留證據與金鑰保護責任。
- [KMS DescribeKey](https://docs.aws.amazon.com/kms/latest/APIReference/API_DescribeKey.html)：金鑰狀態 metadata。
- [ClamAV 掃描協議及警告](https://docs.clamav.net/manual/Usage/Scanning.html)：clamd TCP 不提供驗證／加密，不應直接公開。
