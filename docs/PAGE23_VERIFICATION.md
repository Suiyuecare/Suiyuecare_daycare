# 第 23 頁：疫苗紀錄本機驗證

日期：2026-09-08（Asia/Taipei）。狀態：dedicated，**未通過正式上線驗收**。

## 已實作

- 個案、疫苗、劑次、接種日期、批號、院所、證明狀態與來源保存。
- 不可變建立／更正／作廢；可信移轉來源不能被人工表單降級或清空證明，作廢仍保留原來源及證明。
- 同個案、正規化疫苗及劑次重複時警示，不自動合併或判斷醫療適用性。
- 單筆／最多 20 筆批次共用驗證及穩定紀錄識別。批次、更正與作廢要求同一工作階段最近 15 分鐘雙因素驗證。
- 未知送出結果鎖定原批次並精確重試；明確拒絕保留可編輯草稿；部分失敗保留原編號，不重送成功項目。
- 保存回執逐欄核對資料庫實際內容；快照核對篩選、機構／分支、60 秒效期、總數、選項與版本排序。

## 可重跑測試

```bash
pnpm exec vitest run src/lib/client-vaccinations src/components/client-vaccinations src/app/api/client-vaccinations src/lib/catalog/catalog.test.ts
pnpm test:database client_vaccinations_page23.test.sql foundation_schema.test.sql
```

此檢查點：前者 81 項通過（含目錄與 4 項真 PostgreSQL JSON → TypeScript 契約，以及伺服器拒絕過期 MFA 後保留草稿／刷新驗證狀態）；後者 Page23 56 項、基礎權限 24 項通過。資料庫為 PGlite 本機相容性測試，並非正式 Supabase 或雙連線競態驗證。

## 瀏覽器證據與界線

1. 真正展示路由：1440px／390px，合成唯讀個案，無整頁橫向溢出或框架錯誤。
2. 隔離操作元件：直接使用正式 React 表單，僅替換網路回應。實際操作單筆送出、兩筆批次部分失敗；確認成功後只剩「第 2 筆」，沒有重新編號造成錯誤成功提示。390px 輸入字級至少 16px，觸控高度至少 44px。
3. 隔離元件三個表單展開後，桌機／390px 的 axe WCAG 2／2.1／2.2 AA 掃描均為 0 violations、0 incomplete。自動掃描不取代完整人工無障礙驗收。

隔離元件 fixture 位於 `tests/browser/client-vaccination-harness.tsx`，使用合成個案與模擬保存回應；**不驗證登入、HTTP handler 或真實持久化**。測試時掛載於本機開發展示模式的臨時入口，完成後已移除該入口，正式應用程式未引用 fixture。API 與 SQL 另有上述測試，不把分段測試合稱為正式員工端 E2E。

畫面證據位於 `artifacts/page23-browser/`：`desktop-form-1440.png`、`mobile-partial-batch-390.png`、`mobile-batch-result-390.png`，以及兩張唯讀路由截圖。全部使用合成資料。

## 尚未啟用

正式附件上傳／掃毒／短效下載、提醒規則、可信來源安全更正、離線同步、正式 Supabase 與真實 MFA、雙連線競態、50 人壓測、正式員工端 E2E 及部署。未建立任何疫苗適用性、保護力、禁忌、下一劑或診斷規則。
