# Jubo 來源清冊離線檢核

此工具只檢查**合成或已去識別化的清冊**，不是匯入器。不可直接傳入 Jubo 原始 JSON、姓名、身分證字號、聯絡資料、附件或帳密；未知欄位會被拒絕，錯誤不回顯輸入內容。

信任來源匯出程序須在隔離環境先產生 `jubo-source-manifest@1` JSON：每筆來源 ID、身分識別與來源分支使用同一受管金鑰計算 HMAC-SHA256；每筆原始資料使用固定欄位順序的規範化 JSON 算 SHA-256；完整原始檔另算 SHA-256。HMAC 金鑰及原檔不可放進清冊、Git、瀏覽器或紀錄檔。清冊的 `historicalRecordCount`、`attachmentCount` 用 `null` 表示尚未盤點，`0` 才表示已確認沒有。

預期範圍 JSON 僅含 `organizationId`、`targetBranchId`、`sourceBranchHmacSha256`、`hmacKeyId`。在取得兩份無個資的 JSON 後執行：

```sh
node src/lib/jubo-migration/check-source-manifest.mjs manifest.json expected-scope.json
```

輸出只有數量與錯誤代碼，不印來源鍵或欄位值。結構與內部雜湊一致時結束碼為 0；有阻斷項目或輸入格式不符為 2。**結束碼 0 也不代表可匯入**：此工具不能驗證原檔 SHA 是否對應實際封存、HMAC 來源、機構對應、身分與既有個案比對、狀態生效日期、資料主權、附件掃毒或東京保存，`approvedForCommit` 永遠是 `false`。以上均須後續授權人員及正式受控流程逐項驗收。
