# 題目式量表規則管理：前台候選驗收

## 範圍與結論

本輪只完成第 82 頁新增的九份題目式量表規則管理入口，以及相關候選程式修正；不是全部 89 頁、正式臨床簽署、真人核准或已部署證據。既有 Finance frame、字型、色彩與按鈕 token 不另建立一套。

來源為 `DESIGN.md`、`UX-CONTRACT.md`、正式七鍵審核／退休 API 與不可變資料庫契約。前台能查看題目與版本、送審、另一人核准／退回、本人撤回、申請版本退休及分頁查閱；伺服器仍重新驗證權限，不由瀏覽器授權。

## 本輪修正

- 只讀取固定機構／分支／使用者範圍；切換量表／角色／範圍時立即隔離舊資料及過期請求。
- 未登入／未授權、讀取失敗及空資料分開處理；展示模式不呼叫正式審核 API；一般 Google 工作仍不增設驗證器，治理高風險動作沿用現有近期驗證條件。
- 寫入首次發送前固定內容和操作鍵，未知結果沿用原操作重試。收到成功回執但重新載入失敗時，保留確認視窗與回查入口，只重讀、不再次寫入。
- 修正父工作區載入／錯誤條件卸載操作元件的問題。過期清單仍顯示但停用新寫入；確認視窗與操作鎖保留，避免已保存卻永遠無法解除鎖定。
- 原生模態視窗提供背景 inert；關閉回原控制，原控制因申請完成而停用則回所屬區段標題。取消／返回均不視為提交；結果不明不能直接丟失原操作。
- 支援 Navigation API 的同文件歷程返回保留原位置與操作；沒有可信 entry index 的瀏覽器只能提供離頁警告，不能宣稱所有瀏覽器的返回都可攔截。
- 技術資料與完整公式預設收起，保留非 hover 的來源／版本核對入口。手機控制至少 44px，不另改其他舊頁版型。
- 特殊無效版本名稱（例如繼承自 Object prototype 的名稱）安全拒絕，不再觸發未知型別計分錯誤；九份候選雜湊未改。

## 可重跑驗證

`scripts/verify-questionnaire-rule-ui.mjs` 僅啟動 loopback 合成 HTTP 服務，使用真實 React 工作區、操作、原生 dialog、瀏覽器契約與既有 CSS。禁止載入環境秘密及連接正式 Supabase；Next 路由、真正身份、RLS／SQL 和真人核准都不在此 fixture 證明範圍。

```sh
node scripts/verify-questionnaire-rule-ui.mjs --self-test
node scripts/verify-questionnaire-rule-ui.mjs
```

後者回傳本機 URL；模式包含 `lost-ack`、`invalid-receipt`、`read-fail`、`timeout`，種子包含 `other`、`self`、`approved`。重新開啟根 URL 會重置該本機合成案例，不能多位測試者同時對同一 fixture 驗證不同案例。

### 已取得的證據

- 合成 HTTP 契約自測：九份量表 × 九種情境，81 項通過。不是 81 次真人操作。
- 真 Next 展示入口：1440px／390px 均可載入新增治理區；390px 無水平溢位，切至 BSRS 可核對六題，技術說明預設收起，正式審核 API 呼叫為零。
- 該只讀治理區 axe：16 項通過、0 個違規／0 個 incomplete。不等於全部頁面或人工 WCAG 驗收。
- 真 Chrome、真元件、合成 API：503 發生於提交後，原鍵與原內容重播只产生一筆申請；成功回執後 GET 失敗會保留「已保存，但清單尚未更新」，回查成功沒有增加 POST。
- Chrome 同文件返回：由兩個合成 history entry 測試，結果不明時保持 `#current`，原生 modal 仍開啟，焦點回其標題。沒有寫入操作鍵／理由至 localStorage、sessionStorage 或 history。
- 真 Chrome 逾時：合成 API 已提交但延遲 22 秒回應，瀏覽器 20 秒逾時後仍保留原操作；原鍵重播只一筆事件。長時間送出期間及狀態切換後，焦點保持在彈窗內；同 DOM 確認按鈕變成 disabled 也有專屬回歸。
- 真 Chrome 合成正常流程：核准另一人的採用申請 → 選擇核准版本 → 申請截止 → 本人附理由撤回，可重新取得操作，已撤回狀態可見且焦點回區段標題。不是兩個正式 Google 員工身份測試；fixture 尚未驗退休由另一人核准／退回。
- 原生背景測試使用實際存在的 `fixture-background-focus` 按鈕，確認模態期間不能把焦點移至該按鈕；不存在元素的探針不算證據。
- 模態 axe 初次掃描 0 違規，但色彩對比有 1 項 incomplete（兩個節點）；不得將該次自動掃描宣稱為無障礙全通過。
- Premium 嚴格 scoped audit 為 0 findings；DESIGN.md 官方 lint 為 0 errors、7 個未被 frontmatter component 直接引用的 token warnings。runtime CSS 仍是既有 Finance 視覺權威，不因消除警告另改配色。

### 磁碟與測試結果的邊界

本機磁碟不足曾使全量 Vitest 在模組轉換前出現 ENOSPC，該次未通過，不視為產品測試成功或 437 個已確認程式 bug。停止後只清除本輪生成且可重建的 `.next` 產物，保留原始碼、備份與證據；以兩個 worker 重跑，467 個檔案／6,003 項測試全部通過。這次重跑發生在最後的導航焦點及父子整合測試新增前，最終凍結另驗。

`DAYCARE_DISABLE_FILESYSTEM_CACHE=true pnpm build` 可在這台低空間機器上停用本次 Next 檔案快取；預設配置仍保留快取，不改業務、安全或雲端區域設定。該次 production build 通過 101 個產生頁面，不等於 89 頁功能驗收。

最後來源凍結後，再以同一 Finance 候選來源及 `--maxWorkers=2` 完整重跑：468 個檔案／6,014 項 Vitest 全數通過，無略過。新父子整合測試使用真實 Action、Dialog 和操作鎖（僅替換 HTTP adapter），採用及退休都驗證成功回執後 GET 失敗、回查恢復、POST 仍僅一筆；分頁失敗時舊操作保留但新寫入停用。

最終 ESLint（零警告）、production build（101 個產生頁面）、TypeScript 與 diff 檢查通過。建置期間另一次 Turbopack 出現無法開啟 panic log 的失敗，不列為通過；關閉本輪自建測試瀏覽器／服務並清理該次生成 `.next` 後，乾淨重建成功。沒有清除日常 Chrome、使用者檔案或其他歷史測試產物。UI 自動稽核只涵蓋新增治理區，不把舊 UI audit 的未解問題標為已修復。

## 雲端現況（本輪唯讀）

- Supabase migration 列表仍為 130 項，最新 `20260925141114`；候選來源為 137 項。本輪沒有 hosted DDL、移轉、還原或真人個案寫入。
- `.vercel/project.json` 指向使用者指定專案。`get_project` connector 有參數契約衝突；改用部署清單與網域查詢後，實際 API 回 403，目前 OAuth 不具該團隊權限。沒有發現可用既有 CLI；未安裝、未使用聊天公開 token。
- 公開網域根頁的 HEAD 回應 200；這只能證明既有網站回應，不能識別本輪候選 commit 或驗證登入後功能。
- 未推送 GitHub、觸發 Actions／Vercel、合併 main、變更正式 alias、修改 Finance 或建立付費資源。

## 正式上線仍須完成

1. 正式量表簽署後端／前台、有效規則查詢、伺服器重算、不可變簽署與更正；GDS／SPMSQ 機構政策及逐表合格人員須由真人確認。MNA-SF 六題不等於完整 MNA 十八題。
2. 將候選增量資料庫版本精準部署並驗收正式 Google 員工、跨範圍權限及兩人作業；不能以合成 props／本機 pgTAP 替代。
3. CMS 原始檔不可變封存、附件掃毒、正式收案全流程及正式備份還原；一般 Storage 不替代 WORM。
4. 確認 Finance E6 是否僅為萬華一館，部署唯讀整合後以真實金額核對；不自動寫回 Finance。
5. 重連具正確團隊權限的 Vercel；確認商用方案、資料區域與費用，通過 `PRODUCTION_GATES.md` 後才發布。

使用者已確認題目授權並允許公開原始碼，本輪沒有重新以版權作為阻擋條件。
