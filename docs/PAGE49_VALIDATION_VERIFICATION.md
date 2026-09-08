# 第 49 頁：申報驗證回執與重試檢查

日期：2026-09-08（Asia/Taipei）。Page49 維持 **partial**，不是正式申報格式、送件或上線驗收。

## 本次補強

- 新增 SECURITY INVOKER `validate_claim_batch_receipt` 包裝既有原子驗證 RPC，在同一交易內由保存的批次讀回機構、分支、操作鍵與請求指紋。API 比對資料庫實際操作鍵，不只自行回填瀏覽器傳入的鍵。
- API 嚴格核對資料庫的範圍、批次 ID、validated 狀態、1–5,000 筆界限、確認筆數、精確十進位總額與 replay 布林值；不把型別斷言當作驗證。請求必須提供 `expected_item_count`；即使總額相同，只要筆數與確認不同，SQL 包裝函式仍在同一交易內拋錯，批次維持草稿且未保存驗證鍵。
- 瀏覽器另核對 request ID、原操作鍵、批次、確認筆數、金額、狀態、展示／持久化標記與 HTTP 200。空回覆、錯誤批次、展示回覆或未凍結狀態均不能顯示正式成功。
- 未知結果保留原批次、筆數、金額與操作鍵；關閉再開啟或清單更新都不改送另一批。核對前暫停選擇其他批次。網路失敗不宣稱資料庫一定沒寫入。
- 重複送出有同步鎖；處理中不能關閉確認視窗。批次、金額、筆數、期間或展示模式改變時先前同意即失效；未知重試仍使用原模式，未同意或近期 MFA 不符時不能送出。
- 只有首次請求的已知、結構化拒絕可以恢復編輯；先前曾結果未知時，不因後續拒絕就丟棄原操作。
- 頁首改為唯一可操作的「驗證草稿」入口；不再同時顯示名稱相近的停用假按鈕。正式匯出尚待驗收另以文字標示；同意勾選的整個文字區可點擊且至少 44px。

## 可重跑證據

```bash
pnpm exec vitest run src/lib/service-management/claim-validation-client.test.ts src/lib/service-management/claim-validation-database.test.ts src/components/service-management/claim-validation-composer.test.tsx src/app/api/claims/validate/claim-validation-route.test.ts
```

共 71 項：回執契約 34、React 操作 12、API 邊界 17、真 SQL JSON → TypeScript 8。SQL 測試重用既有合成申報 fixture，驗證首次保存、匯出後 exact replay、已存鍵／範圍、改鍵／改金額／跨機構／不同 session 拒絕、確認筆數不符整筆回滾與執行權限；PGlite 相容性檢查不是正式 Supabase 多連線。API 測試替換授權／資料庫 adapter，不當作真實 MFA。另加既有 integrations 測試共 25 項，合併執行為 96 項通過。

正式模式缺 `claims.manage` 時在讀取 body 前拒絕；展示模式刻意僅允許合成欄位驗證且不要求正式申報角色、不呼叫 Supabase。展示流程不能當作正式角色矩陣驗收。

本機真實展示路由 `/app/staff/service-management/claims` 實際呼叫本機 `/api/claims/validate`，觀測到 HTTP 200、`demo=true`、`persisted=false`、`status=draft`、`itemCount=null`，畫面明確告知沒有凍結展示批次。未呼叫正式主管機關、未產生正式申報檔。

1440px／390px 畫面與確認視窗無整頁橫向溢出；手機輸入至少 16px，主要按鈕及選單至少 44px。鍵盤 Tab 可進選單，Escape 關閉後焦點返回原按鈕。截圖位於 `artifacts/page49-browser/`。

兩種寬度的 axe WCAG 2／2.1／2.2 AA 掃描均 0 violations，但各有 **1 項 incomplete（color-contrast）**：提示文字與同意說明受背景判定影響。已檢視最終截圖未見文字遮蔽，並依實際前景／實色背景計算對比：提示為 rgb(21,84,73)／rgb(233,243,239)，7.73:1；同意文字為黑／白，21:1。此為兩個節點的補充檢查，保留 axe incomplete 原始結果，不能宣稱完整人工無障礙驗收已通過。最終截圖為 `desktop-confirmation-1440-final.png`、`mobile-confirmation-390-final.png`。

## 仍未完成

官方年度／縣市格式與費率／代碼／資格／額度治理、草稿逐筆修正、正式格式下載／送件、回覆檔 parser、完整正式員工端 E2E、Supabase 雙 session 競態、50 人壓測與法律／業務簽核。Page52 未配置正式規則的新計畫必須由資料庫阻擋申報資格；該跨模組 SQL 閘門需以 Page52 的獨立測試證據確認，不由本頁瀏覽器回執測試取代。
