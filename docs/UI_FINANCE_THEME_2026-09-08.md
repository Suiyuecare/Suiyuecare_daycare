# Finance 同款配色、框架及載入動畫：本機驗證

## 範圍與來源

本次為日照系統的外觀與導覽載入狀態調整，沒有推送 Git、Vercel 部署、Supabase 變更、真實資料匯入或 Finance 程式修改。日照工作目錄基線為 `970d1af`。89 個功能入口、伺服器端權限過濾、業務資料與既有表單操作保留。

參考的是 Finance 正式版 `faf7527b5eb76c08f95d64938f19f412a276fe50`，不是 Finance 工作目錄中的未提交 CSS。核對公開 release manifest，以及 finance-core.css、mobile-operations.css、workflow-simplification.css 與該 commit 的檔案位元組一致。只讀公開樣式與本機原始碼，沒有登入 Finance 查閱業務資料。

- [正式版 manifest](https://finance.suiyuecare.com/release-manifest.json)
- [共用樣式](https://finance.suiyuecare.com/assets/styles/finance-core.css)
- [手機框架](https://finance.suiyuecare.com/assets/styles/mobile-operations.css)

配色固定為主橘 `#ea880c`、深橘 `#b45309`、深棕 `#2f2a26`、次文字 `#6e6259`、紙色 `#fff9f2`、柔底 `#fff4e4`、邊線 `#f1cfa8`。內容區為 `#f7f3ec`；字型順序 PingFang TC、Microsoft JhengHei、Noto Sans TC。共用標章沿用 Finance 的公司 PNG。

## 已實作

- 全高 frame、分離捲動的側欄與內容、固定高度頂欄、橘色選中選單、圖示底塊、使用者卡片、標題與快捷入口。
- 手機左側抽屜及四項常用導覽；僅從伺服器傳入的已授權頁面生成快捷入口。選单保留 Escape、焦點圈限、關閉後焦點還原。
- 共用卡片、表格、輸入欄、按鈕改為 Finance 視覺。62 份 CSS module 共 433 處一般品牌／中性色宣告改接共用變數；未改 module 的版面结构與業務狀態選擇條件。
- 原本有成功、已簽署、已支付、無衝突等意義的狀態色保留。模組 CSS 結構稽核確認 181 組狀態規則及 808 處既有變數宣告不變。
- 根頁、員工區與家屬區加入相同載入卡片。導覽用 Next `useLinkStatus`，保留原 Link 的預先載入、修飾鍵、新分頁、歷史紀錄與取消行為，沒有人工等待或假的完成百分比。
- 讀取條高 6px、移動區塊寬 44%、`authLoading 1.1s ease-in-out infinite alternate`、從 -80% 至 210%；完成或取消即移除。Finance 原本主要在登入／工作台進入時使用此視覺，日照另將相同視覺接到實際模組導覽 pending。
- pending 卡片透過 portal 顯示，不受收合選單或 transform 遮蔽；舊工作頁暫時 inert 且 aria-busy，避免在遮罩下提交舊表單。重疊導覽使用引用計數，最後一個 pending 結束後才還原。
- 家屬導覽與通知入口保留所選 `client` 查詢參數；不增加家屬資料權限。

## 實測

本機 `pnpm dev:demo --port 3040` 使用合成資料；啟動器清空外部資料庫、AWS、LINE、簡訊設定。沒有使用三份真實個案 HTML。

| 視窗寬度 | 側欄寬 | 頂欄高 | 內容內距 | 文件橫向溢出 |
|---:|---:|---:|---|---|
| 1440px | 300px | 82px | 34px | 無 |
| 1024px | 300px | 96px | 34px | 無 |
| 920px | 240px | 96px | 24px | 無 |
| 800px | 196px | 96px | 24px | 無 |
| 390px | 預設隱藏；展開約 319.8px | 56px | 16px / 14px；底部含 68px 導覽與安全區 | 無 |

瀏覽器抽查：首頁、個案中心、生命徵象、跨專業照會、交通趟次、中央匯入及家屬首頁。手機下方導覽高 68px；抽屜開啟時主內容 inert，Escape 後回到開啟按鈕。由已捲動首頁進入個案中心時，新頁從頂端開始。

以只作用於本機瀏覽器的 fetch gate 暫停實際 RSC 請求，確認載入卡片出現、舊主內容禁止焦點／指標互動、釋放請求後解除；另用鍵盤選取其他頁面確認取消 pending 後沒有殘留遮罩或 inert。gate 均已移除。測得卡片桌機寬 360px、手機寬 334px、高 219.375px；條高 6px、寬比約 0.44。啟用減少動態效果時 animation-name 為 none。

- ESLint：通過，零警告。
- TypeScript：通過；最終 production build 亦完成型別檢查。
- Vitest：294 個檔案、2,827 項測試通過。
- 89／89 頁本機路由與原標題煙霧測試通過。
- production build：清空外部 adapter 設定、停用 demo／synthetic flag 後通過。這是本機建置，不是部署或正式登入驗收。
- `git diff --check`：通過。未新增或修改 SQL／API，因此本輪未重跑正式資料庫測試。

本機截图保存在 `artifacts/finance-theme/`（不進 Git），含 before/after 桌機與手機、抽屜、平板、載入卡片、跨專業、交通、匯入與家屬頁。截圖中的 Next 開發工具按鈕是本機開發環境附加元件，不屬於正式產品框架；手機取消導覽另以鍵盤驗證，避開該按鈕對點擊位置的遮擋。

## 已知差異及未通過項目

「同款」指配色、共用框架與載入動畫來源一致，不代表日照業務內容、模組內每個版面或整站每個像素與 Finance 相同。保留日照名稱、機構／分支切換、功能表與家屬專用資訊架構。UI/UX 檢查也保留至少 44px 的共用觸控目標及減少動態效果；這兩點刻意不複製 Finance 的較小點擊區與強制動畫。

為遵循本次「完全相同配色」要求，沒有自行加深 Finance 品牌橘。這與原計畫 WCAG AA 有已知衝突：

- 桌機選中側欄及主按鈕的白字／`#ea880c` 對比約 2.61:1，未達 4.5:1。
- 手機導覽一般字約 4.13:1，選中字約 3.06:1，未達 4.5:1。
- 漸層背景尚有 axe 無法自動判定項目。

因此本次不是完整 WCAG AA 驗收通過。正式營運前需由產品負責人決定是否調整上述文字／選中態配色並重新驗收；不得把本紀錄當作 89 頁功能、MFA、RLS、正式資料或醫療流程的完整驗收。
