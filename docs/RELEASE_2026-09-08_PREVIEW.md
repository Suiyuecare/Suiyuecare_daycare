# 2026-09-08 評估、報表入口與合成試用發布紀錄

## 範圍

本次不是 89 頁完整營運上線。新增 #19 人工身體觀察、#51 人工護理評估的專用 UI／API／不可變資料模型，以及 #70 每日／每月來源報表入口。

- 身體評估：明確選取部位、正常／異常／缺值／不適用、理由、異常描述與人工處置；草稿、修訂、簽署、更正版及版本歷程。照片／附件與官方必填部位規則未配置。
- 護理評估：人工觀察、問題、措施、反應與人工複評安排；護理角色、明確指派、近期 AAL2、版本差異及嚴格回執。官方分數／風險／表單規則、附件與匯出未配置。
- 統計入口：嚴格臺北日期／月份、來源權限、連至 #54／#42 實際快照；不另算總數、不冒充來源更新時間。自訂統計、跨分支合併與小樣本遮蔽未配置，維持 partial。
- 成熟度為 71 dedicated、8 partial、10 shared workspace、0 verified。dedicated 不等於通過原計畫全部驗收。

## 試用部署邊界

- 獨立 Vercel 專案 `suiyue-daycare-preview`，ID `prj_eiwNI6buPlPXynMCWhatuzqxD74H`；團隊 `entrepreneur-9585s-projects`。
- 僅 Preview target；保留 Vercel Authentication `all_except_custom_domains`，不綁定自訂網域、不 promote production、不修改其他公司網站。
- 本機測試 Node.js 22.23.2；專案設定 22.x，但雲端因 `engines.node >=22.0.0` 實際選用 24.x（deployment API 已核對）。符合計畫 22 以上，不宣稱雲端與本機為相同 Node 版本。Next.js 16.3.3、Function region hnd1。這不代表完成正式跨境、DPA、SLA 或個資儲存區域驗收。
- 正常 production build，加上獨立 synthetic-read-only flag／purpose／project ID 綁定。保留原本本機 DEMO_MODE 的 production 禁用規則；正式外部憑證存在即停止建置／啟動。
- 全部 API（含 GET 匯出）、非 GET／HEAD 請求、偽造 demo header 與 Server Action 在 proxy 讀 body 前拒絕；Supabase adapters 停用。
- 不註冊 service worker、不開啟 IndexedDB；固定合成分支、返回入口不呼叫正式登出 API。
- #80 僅開發者另製的 3 區段固定合成樣本，沒有上傳、iframe、遠端圖片或正式核准。不是使用者三份真實 HTML，也不是黃金樣本完整驗收。
- `.vercelignore` 排除環境檔、根目錄文件／測試／SQL／腳本／輸出與附件，保留 `src/lib/supabase` 程式。修正後 CLI dry manifest：845 entries／840 regular files，沒有 symlink；禁止路徑及已提供個案姓名／帳密字串匹配均為 0，必要 adapter 與模式 guard 缺檔為 0。此掃描不是通用個資偵測器。
- 修正後 source manifest SHA-256：`17efbdebcf17b3fbadabfd631db69d5d5c2d57b5c54f42b0fa2c176bd1831cd9`。

## 驗證證據

- 一般 production build 與 synthetic preview production build 均成功。
- 本機 PGlite：90 migrations、89 SQL test files、3,638 assertions 全通過；不是正式 Supabase 或雙連線競態證明。
- 護理時鐘回歸另證明長交易中到期的 membership／assignment 不可沿用交易起始時間授權。
- 本機 production preview `127.0.0.1:3114`：89／89 路由通過；#19／#51／#70／#80 在 390px 無橫向溢出，axe WCAG 2／2.1／2.2 AA 自動檢查 violations=0、incomplete=0。不是全站人工 WCAG 驗收。
- #70 日期／月份 GET 提交保留到來源連結；不合法日期或月份顯示錯誤且不產生報表連結。鍵盤可到達入口並有可見焦點。
- 本機 8 組 API／方法反向探針全回 403 `SYNTHETIC_PREVIEW_READ_ONLY`；#80 無上傳欄位；家屬試用瀏覽器 service worker=0、IndexedDB databases=0、對外資源=0。
- `pnpm audit --prod`：未發現已知漏洞（本次執行時點）。
- 最終全套：ESLint 零警告、TypeScript 通過，284 個 Vitest 檔／2,689 項測試全通過。

## 不包含的正式能力

沒有建立 Supabase 正式資料庫、MFA 帳號、AWS WORM、公司 LINE OA、簡訊供應商；沒有真實資料上傳、中央登入、自動申報、七年資料移轉、正式法律／業務驗收。沒有購買方案、綁定付款方式或更改 DNS。

## 發布狀態

首輪 `dpl_6g3fqvM4bfbtrHFCTafgRga4UanP` 建置失敗，原因為未錨定根目錄的排除規則誤排除 `src/lib/supabase`。Vercel 同時依首次部署規則將該輪分類為 production；狀態為 ERROR，未產生可用應用或成功 production 上線。

修正後第二輪 `dpl_9SSFxrUU32TPAhVG3Wxb3BFDBVcS` 的 API 已確認 `readyState:READY`、`target:null`（Preview）、`regions:[hnd1]`、`alias:[]`，source manifest 與上述雜湊完全相同。無需建立靜態 production 初始化；未調降 protection、未 promote 或指定任何自訂網域。

試用入口：https://suiyue-daycare-preview-5u4hxtgo2-entrepreneur-9585s-projects.vercel.app/login

匿名 GET `/login` 回 302 至 Vercel 存取驗證；官方 CLI 授權 GET 回 200、`x-daycare-mode: synthetic-read-only`、private/no-store、noindex/nofollow/noarchive，顯示合成試用入口且沒有密碼欄位。8 組線上 API／方法／偽造 demo header 反向測試全回 403 `SYNTHETIC_PREVIEW_READ_ONLY`。

線上逐頁煙霧檢查完成：89／89 頁、712／712 checks 通過。每頁驗證 HTTP 200、正確 h1（沿既有 #1／#84 標題覆寫）、synthetic-read-only header、唯讀合成 banner、禁止真實個資文案、no-store、noindex 及非空頁面。這些證據是線上合成試用的路由／安全標示驗證，不等於正式業務流程與真實資料權限驗收。
