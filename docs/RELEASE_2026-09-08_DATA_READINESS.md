# 2026-09-08 資料盤點與匯入欄位追蹤

## 本批範圍

保留 11 模組、89 頁入口；擴充 #80 中央 HTML 匯入與 #83 整合與稽核中心。這是資料盤點／缺口追蹤的功能增補，不是所有資料已完整或正式營運上線。

- #80：全部解析欄位可每頁 20 欄分頁查看，依候選映射／待映射／衝突及精確父層路徑篩選；保留區段、控制項、來源路徑、映射鍵、候選路徑、遮罩值、警示及映射版本。未知且無可解析欄位的區段仍列入清單。
- #80：同一解析快照計算欄位總數與三種狀態；衝突群組和警示另外計數。零未知／零衝突或暫存核准皆不開放正式寫入。
- #83：六類、12 項固定的分支來源資料清冊；標示尚未取得、已取得待補齊、待人工覆核、已人工覆核及不適用。可記錄來源、資料負責角色、期間、來源／取得筆數、缺漏／未映射／衝突／重大差異、人工關鍵欄位／金額／附件核對及 UUID 證據參照碼。
- #83：實作不可變登錄／修訂與獨立覆核 API／SQL／UI。覆核綁定原版本 ID 與內容雜湊、最近 15 分鐘同工作階段 AAL2，作者不能自行覆核；新修訂取消舊覆核效力但保留歷史。未知操作結果沿用同一內容及冪等鍵，不靜默重建或覆蓋版本。
- #83：只有具有 `audit.view` 的有效機構管理員或分支主管可讀寫；資料庫重新驗證機構／分支／角色／有效期限及 AAL2。資料表不可由瀏覽器直接讀寫；保留查閱與新增稽核，機密與清冊內容不寫入稽核 metadata。

## 必須保留的邊界

1. 此清冊是人工填寫的中繼資料，不是自動掃描既有個案、財務、附件或七年資料的結果。
2. 「已人工覆核」只指本份盤點清單，不能啟用用藥、申報、正式匯入或當作 89 頁驗收。
3. UUID 證據參照碼不是實際上傳、保存、掃毒或核驗附件；資料負責角色不是具名承辦人指派。
4. 正式欄位映射／資料主權 promotion、WORM、正式 Supabase／MFA、完整申報、七年移轉仍待配置與驗收。沒有建立付費服務、買方案、改 DNS 或修改其他公司專案。
5. 線上仍為受保護合成唯讀 Preview；只顯示開發者編製固定範例，所有 API 與非 GET／HEAD 請求繼續拒絕。不開放編輯、覆核、上傳、個資持久化、Service Worker 或 IndexedDB。未讀取或上傳使用者三份原始 HTML。
6. 成熟度維持 71 dedicated／8 partial／10 shared workspace／0 verified；#83 仍為 partial。

## 驗證紀錄

- 來源欄位與匯入回歸：4 檔、19 項通過；含 43 欄分頁、篩選、遮罩與惡意文字不執行。
- 盤點 UI／請求：2 檔、39 項通過；含確切重試、操作鎖、回執、版本／範圍變更及合成資料不保存。
- 本機 390px：#80、#83 無橫向溢出；盤點輸入 16px、主要觸控元件至少 44px；雙向入口可導航，篩選數量正確。已修正合成固定快照誤顯示永久過期警告。
- 最終 ESLint 零警告、TypeScript 通過，291 個 Vitest 檔／2,791 項測試全通過。一般 production build 通過。
- 390px axe-core 4.10.3 的 WCAG 2／2.1／2.2 AA 自動檢查：#80／#83 主內容 violations=0、incomplete=0。補上來源入口底線以不只靠顏色辨識。這不是全站人工 WCAG 驗收。
- 全套資料庫：91 migrations 編譯、90 SQL 檔／3,684 assertions 全通過，其中盤點 46 項。Backend 48 項 Vitest 通過。不得把本機 PGlite 當作正式 Supabase、雙連線競態或正式權限驗收。完整歷史仍保存，畫面一次顯示最近 20 版並標明截斷，不宣稱已提供完整歷史分頁。
- 合成 Preview production build 通過；本機 production `127.0.0.1:3116` 的 89／89 頁入口與 6 組 API／非讀取方法封鎖驗證通過。`pnpm audit --prod` 本次未發現已知漏洞。
- Vercel 實際 dry manifest 預檢：857 entries／852 regular files、6,510,899 bytes；禁止路徑、symlink 與限定機密字串匹配均為 0。這不是通用個資／機密掃描器。Source manifest SHA-256：`8c9326593dafcb29a68d17c4ff51ba820045419d66583b3941bb0e8013eb0f08`。

## 發布

目標為既有獨立 `suiyue-daycare-preview`（`prj_eiwNI6buPlPXynMCWhatuzqxD74H`）的受保護 Preview，保留東京 `hnd1` 執行區域；不 promote production，不更改存取保護。

本批 `dpl_GJoVD1sxfTNaggQLxzJVrcJfGwSa` 已由 Vercel API 確認 `READY`、`target:null`（Preview）、`regions:[hnd1]`、正確 project ID 與上述 source manifest hash；`alias:[]`，未更改自訂網域。雲端實際 Node 24.x（專案 engines 允許 22 以上），本機 Node 22.23.2。

- [資料盤點入口](https://suiyue-daycare-preview-dmflbuz0n-entrepreneur-9585s-projects.vercel.app/app/staff/governance/integrations-audit#data-inventory)
- [中央匯入欄位追蹤](https://suiyue-daycare-preview-dmflbuz0n-entrepreneur-9585s-projects.vercel.app/app/staff/governance/central-html-import)

匿名登入頁回 302 至 Vercel 驗證；官方 CLI 授權查閱兩個入口皆為 200，正確新標題、合成唯讀標示、no-store 與 noindex 皆通過。6 組線上反向測試（盤點 GET／POST、HTML POST、申報匯出 GET、頁面 PATCH、偽裝圖片 API GET）皆回 403 `SYNTHETIC_PREVIEW_READ_ONLY`；沒有傳送真實個資。

發布後本次 `vercel logs` 查詢此部署最近 15 分鐘 error 級紀錄為 0；不代表已配置正式值班監控。瀏覽器本機 production 驗證未見錯誤 overlay，清除先前開發紀錄後 console 為空；Service Worker=0、IndexedDB=0、對外資源請求=0。

本批部署全 89／89 頁線上路由、712／712 項檢查通過：HTTP 200、正確 H1、非空回應、private／no-store、noindex、合成唯讀標頭與提示、未匹配使用者提供的三位樣本姓名。使用既有 CLI 授權，沒有修改存取保護或寫入應用資料。本次不將路由 smoke 當成正式角色隔離或端到端業務驗收。

部署後只補充 README 線上入口與本機文件驗證紀錄，未修改應用程式碼；上述 manifest hash 識別實際發布的檔案快照，不代表後續文件更新後的工作目錄雜湊。
