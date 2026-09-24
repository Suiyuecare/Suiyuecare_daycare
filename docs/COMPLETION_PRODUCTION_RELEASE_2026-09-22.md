# 日照系統日常作業與自訂表單：正式發布紀錄

2026-09-22，Asia/Taipei。本批已部署公司前台；不是 89 頁全部完工，也不是真人正式營運驗收完成。

## 已發布版本

| 項目 | 證據 |
|---|---|
| 公司網址 | https://daycare.suiyuecare.com |
| Vercel project | `prj_eiwNI6buPlPXynMCWhatuzqxD74H` |
| 部署 | `dpl_HkESJhehN8rbZZZXuex9CfxvZ6n7`，READY，production |
| 不可變網址 | https://suiyue-daycare-preview-9cnfxkeo6-entrepreneur-9585s-projects.vercel.app |
| 應用來源 | `6a1c35333c9dd43be85494c62b9b68eaa329ff3c` |
| 上傳清單 | 1,027 檔，SHA-256 `08d37e82545a61c88acf2b87eebaedb6b63443065ad95c4b2fc29fee70b8b8bc` |
| 建置 | 94.756 秒，應用函式 `hnd1`；不把此項推論為所有 middleware 都只在東京 |
| Supabase | `mmxqxsokpcdvuzmdhptg`，119 → 125 migrations，最新 `20260922072008` |

先以 production target、skip-domain 建立候選，保留平台保護，驗證後 promote 同一 artifact。公司網址 inspect 已核對部署 ID。沒有推送公開 GitHub 分支、沒有升級付費方案、沒有搬遷既有首爾 Supabase、沒有替任何帳號擴權。後續測試／文件 commit 不改變上述應用來源。

## 現場可見功能

- 今日照顧名單依每週安排、例外、資格及實際出勤計算；不適用個案不誤列漏填。
- 已核准 Google 帳號依原角色與逐案範圍辦理收案／分工，不新增一般登入驗證器門檻；簽署、匯出等重要動作仍保留原驗證要求。
- 已發布交通趟次可填理由取消，保留紀錄，已開始執行不得取消。
- `/app/client-forms` 支援機構自訂表單填答、草稿、簽署、更正、歷史與同版預覽／PDF。
- 第 82 頁支援自訂表單複製下一版及獨立第二人覆核停用。

本批不替代官方量表、ABC 文件完整性、申報或 CMS 封存／掃毒。

## 發布前追加修正

1. 派車舊 RPC 保留舊格式；新 UI 使用 `transport_trip_plan_snapshot_v2`。舊版回退時先排除已取消趟次，再計算總數／分頁，不會因新欄位而整頁解析失敗。
2. 表單已停用後仍允許顯示原發布核准證據；草稿、自批、缺失證據仍拒絕。
3. 表單填答 POST 在解析本文前拒絕匿名；後續仍執行動作專屬權限及簽署驗證。
4. 趟次取消在稽核鎖等待後重查逐案授權及驗證期限，失敗整筆回滾。
5. 既有 ABC 測試改為等待 dirty 狀態 effect 回呼，不以畫面文字出現推論回呼已完成；沒有改動 ABC 實際作業邏輯。

## 資料保全與設定

- 升級前已確認最近雲端實體備份狀態 COMPLETED，UTC `2026-09-21 18:45:18`。本次未執行還原演練，不宣稱 RPO 15 分鐘／RTO 4 小時已達成。
- dry-run 精確列出本批六檔；逐檔交易套用成功，再次 dry-run 為 up to date；未執行 seed。
- 25 類既有業務／帳號／權限／表單資料，升級前後筆數及排序內容指紋一致。比較既有欄位時排除本批新加的 nullable `auth_context`；未建立正式測試個案或填答。
- 六個新私有表均啟用且強制 RLS；anon／authenticated 無直接讀寫權限。九個相關公開 RPC 為 SECURITY INVOKER、postgres owner、固定空 search_path；anon 與 service_role 無 execute，authenticated 經守衛函式驗權。
- 新增 production-only `DOCUMENT_DOWNLOAD_SIGNING_SECRET`，隨機產生並透過 stdin 儲存為 sensitive；沒有將值輸出、寫入 repo 或放到 NEXT_PUBLIC。
- 安全 advisor 沒有 ERROR；既有 [leaked-password protection WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 1 項未變。[RLS no-policy INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 173 → 179，新增六個封閉私有表刻意不提供直接存取 policy，不能為消除提示開放資料。

## 驗證與界線

| 層級 | 已取得證據 | 不代表 |
|---|---|---|
| 應用 | 全套 429 檔、4,826 項 Vitest 通過，1 個跨 Finance 選用測試未啟用；ESLint、型別、diff 檢查通過 | 不是業務全項驗收 |
| 本機 SQL | 125 migrations、121 檔、5,594 斷言通過；93 legacy fixture、28 enforced suites 分列 | PGlite 不等於正式 Auth／Storage |
| 原生 PostgreSQL | 本批額外重跑交通取消 54 斷言、7 組實際競態；前一輪表單／生命週期／列印另有 25 組競態證據 | 不把分開執行的測試當成 50 人壓測 |
| 候選 | 9/9：匿名 API 拒絕、頁面登入與 Google 按鈕設定正常 | 平台保護通過不等於應用登入 |
| 正式 HTTP | 89 頁匿名轉正確登入且 no-store；新表單 17/17、收案／文件 20/20、先前補強 7/7 | 不是登入後填寫、簽署與下載驗收 |
| 正式瀏覽器 | 新匿名工作階段，390／1440px 無橫向溢出、破圖、錯誤遮罩或 JS error；Google 按鈕可用，截圖已檢視 | 未代使用者登入、簽署或讀取個案 |
| 錯誤抽查 | 此 deployment 最近 30 分鐘、上限 100 筆 error 查詢為 0；未輸出 raw logs | 不代表長期監控／SLA 已驗收 |

## 仍待驗收與回復限制

- 核准帳號的新版本送審→第二人發布→個案填答／簽署→完整 PDF 下載→停用，需要真人完整驗收；本次沒有繞過 MFA 或建立假工作階段。
- 完整中文字型的合成 PDF 約 4.5 MB；採串流回應，依 [Vercel 官方说明](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) 不屬一般緩衝回應限制，但仍未取得正式有效 PDF 完整下載／耗時證據。
- 下一輪另行實作撤回、退修及新申請重送；不包含在本批部署。
- CMS 原檔封存／附件掃毒、官方表單及申報格式、Finance／家屬端、備份還原及容量驗收仍依既有未完成清單處理。
- 前一 artifact 為 `dpl_3whXwFqWN7zoC5P33ekrPBemtLjx`。應用回退不執行 down migration、不刪除不可變資料；舊版沒有新表單停用 UI，且若已產生 retired+approved 資料，其舊治理 projection 不相容，應採修正版向前發布而非無條件回退。

本機與下一輪證據分別見 `COMPLETION_PHASE2_ACCEPTANCE_2026-09-22.md` 及後續下一輪紀錄；不混用實作、部署與營運驗收狀態。
