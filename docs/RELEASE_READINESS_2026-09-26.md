# 正式部署就緒檢查（2026-09-26）

## 結論

**目前不可正式切換或承載真實個案資料。** 本文件記錄本機候選版本的工程驗證，以及仍需外部核准／證據的正式上線門檻；不得將預覽、展示模式或路由通過視為正式營運驗收。

## 本輪已驗證

- `pnpm verify`：ESLint、TypeScript、441 個 Vitest 檔／4,969 項測試（另 1 項略過）、130 份 migration 編譯、124 份資料庫測試／5,723 項斷言及 Next.js production build 全數通過。第一次全量測試曾有 1 項 5 秒逾時；單獨重跑與後續全量重跑均通過。
- `pnpm test:routes`：安全本機合成展示環境 89/89 路由 smoke 通過。這僅檢查入口回應，不代表每頁操作流程已驗收。
- 瀏覽器：收案與 SPMSQ 表單可載入；390px 下頁面寬度沒有水平溢位；兩頁 axe WCAG 2 A／AA／2.2 AA 自動掃描為 0 個違規。裝飾分隔符仍有 1 項自動檢查 incomplete；不等於人工無障礙驗收。
- 正式 Supabase 與本機 migration 清單均為 130 項，版本與名稱逐項相符；本輪只讀取專案中繼資料，未對正式資料庫執行 DDL、匯入、還原或寫入。
- 本輪修正個案選擇框共用尺寸，以及量表來源連結對比度；移除 Next.js 已棄用的 route `preferredRegion` 宣告，沿用 `vercel.json` 的 `hnd1` 設定。相關 build、lint、typecheck 與指定回歸測試通過。

## 尚未通過的正式門檻

1. **主機方案：** 目前 Vercel 專案方案為 Hobby。Vercel 官方條款限定 Hobby 為個人／非商業用途，故不適用公司正式營運。Vercel 官方目前列 Pro 為 US$20/月、含 US$20 用量抵用額；超額用量另計。若要求合約 SLA，須另外確認方案與合約；官方定價頁將 99.99% SLA 列於 Enterprise。尚未升級方案或推送正式環境。
2. **資料區域：** Supabase 正式專案目前位於 Seoul（`ap-northeast-2`），而本系統既定目標為 Tokyo（`ap-northeast-1`）。Supabase 說明不能原地改區，須新建東京專案並遷移。新專案目前查得約 US$10/月；尚未建立資源或切換資料，等待費用與方案決定。
3. **登入與簽署：** 正式上線規格要求員工 AAL2；產品負責人先前要求不加系統第二層驗證。部分簽署與高風險 API 仍要求近期 AAL2。須先定義一致政策並驗收員工實際帳號，不能為通過測試而關閉授權檢查。
4. **頁面成熟度：** `IMPLEMENTATION_STATUS.md` 追蹤為 71 個專用頁、8 個部分實作、10 個共用工作區、0 個正式 verified。89/89 路由通過不代表 89 頁功能完整；官方量表／計分規則、正式 Supabase、跨分支角色矩陣與真人簽署仍需驗收。
5. **資料保護與持續營運：** DPA／次處理者／跨境審查、正式附件掃毒與不可變封存、備份還原（RPO 15 分鐘／RTO 4 小時）、七年資料移轉兩次彩排、平行申報週期、50 人並行、第三方滲透測試及人工 WCAG 2.2 AA 尚無完整證據。
6. **部署驗收：** 正式網域目前可回應 200，但本輪修改未上傳 GitHub、未觸發 Vercel 預覽、未合併 `main`，亦未提升 production alias。Vercel 管理連線目前回傳 403，因此無法由已連線的管理介面再次核對保護設定或部署細節。

## 決策與下一步

- 等待負責人確認是否承擔 Vercel 商用方案與 Tokyo Supabase 專案的 recurring cost；未確認前不升級、不新建、不遷移。
- 確認員工登入與高風險簽署的 MFA 政策後，執行完整角色矩陣及真人帳號驗收。
- 依 `PRODUCTION_GATES.md` 完成所有法遵、資料安全、實際營運與災難復原 gate；全部通過後才建立正式 release 並安排切換。

## 官方方案／區域依據

- [Vercel Hobby 條款](https://vercel.com/legal/terms)
- [Vercel 方案與定價](https://vercel.com/pricing)
- [Supabase 專案區域變更說明](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z)
