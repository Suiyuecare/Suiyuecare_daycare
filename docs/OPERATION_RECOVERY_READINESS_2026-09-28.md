# 用藥、收案與附件操作復原驗收（2026-09-28）

## 結論

本輪完成限定前台修正，工程回歸通過；**沒有 GitHub push、Vercel 發布或正式 Supabase 寫入**，既有正式站尚未換成此候選。不宣稱全部 89 頁、正式量表、真人登入或正式營運已驗收。

## 完成的修正

| 現場問題 | 修正 | 通過證據 |
|---|---|---|
| 用藥送出後斷線，不確定是否已保存 | 桌機／手機及同分頁重新掛載共用唯一原操作；固定原內容與操作鍵。未知結果可返回清單但不取消原操作，須明確重試；不自動重新給藥或簽署。 | 原鍵／原內容、重新掛載、重複操作、取消、撤權及晚回覆回歸；合成 Chrome 實際拒藥重試兩次內容與鍵完全相同。 |
| 已確認舊劑量，較新的來源到達後仍可送出 | 劑量、來源列或 snapshot generation 變動即取消尚未送出的確認，必須重新核對。保存回條與清單更新分開，舊清單不能再次送出同筆。 | 新劑量／新來源 UI 回歸；成功回條後舊列停用。32 個待核对標記上限顯示原因，不再無聲失敗。 |
| 建檔已有保存回條，讀取失敗卻可能另建或切到錯誤版本 | 核對精確原版本、內容、個案與 CMS 批次後，才變更所選個案與步驟。保存後失敗只重讀，不重新寫入；原操作保留在原入口。 | CREATE 原 null-client owner、CMS 更新原 step 0、不同版本讀回及 GET-only recovery 回歸；合成 Chrome mismatch 時選案保持空值且重讀仍可見，恢復後 POST 數維持 1。 |
| 待核對鎖定被說成「沒有權限」 | 有原保存操作時先顯示「核對原次保存／暫不能修改」；真的無權限且無原操作才顯示只讀提示。 | 新 UI 回歸及最終合成 Chrome 文案檢查。沒有放寬任何權限。 |
| 封存／上傳等待，不知道停在哪裡 | CMS 分別顯示檔案檢查、原檔核對、傳送解析與讀取預覽；不使用假的百分比。取消後的遲到檔案描述不得開始 POST。 | upload-client／control 回歸；保存原檔不誤稱完成收案。 |
| 取得操作鎖時同步登出或撤權，舊內容可能復活 | 用藥、收案與 CMS 取得鎖後再次核對 owner／authority。AppShell 在其他頁仍觀察範圍變化，登出同步清除原操作與鎖。 | logout／revoke／authority ABA／lease-reentry 回歸及獨立唯讀複核。 |
| 附件保存後清單讀取失敗，又要求上傳一次 | 上傳固定原 FormData／鍵；有效回條後只讀取清單，不重新傳檔。讀取失敗收起過期摘要，提供「核對已上傳附件（不重送）」。 | 48 項附件相關測試；最終合成 Chrome 讀取失敗時卡片為 0，GET 重試後卡片為 6／第 2 版，寫入數維持原值。 |
| 下載連結失效或文件看不到 | 驗證設定的 Storage origin、個案、文件及版本；短效連結保守於 55 秒到期，可更新連結，不重新上傳。清楚說明未提供頁內預覽與掃毒／權限限制。 | 來源／範圍／版本／到期回歸；合成 Chrome 只產生正確個案與文件的短效連結，未呼叫外部下載。 |
| 手機收案步驟高度與操作尺寸不一致 | 同一 grid 等高，換行不壓縮操作區；16px 輸入、至少 44px 主要操作。依介面簡化與前端一致性規範保留現有 Finance frame，不改全站品牌或導航。 | 最終 Chrome：1280px 桌機五步等高；390px 手機五步皆 70px、輸入 16px／46px，無水平溢位。 |

## 最終工程驗證

- 全量 Vitest：579 檔通過，1 檔略過；10,328 項通過，1 項略過。略過項目不算驗收完成。此結果來自提示與 CSS 修正後的完整重跑。
- `pnpm lint`、`pnpm typecheck`、`DAYCARE_DISABLE_FILESYSTEM_CACHE=true pnpm build`、`git diff --check` 通過。
- `premium-operation-recovery.json` 限定嚴格介面稽核：0 findings。
- 獨立唯讀複核：新來源確認重設、32-cap、CMS lease 重入及收案 readback-before-mutation，未發現剩餘 P1。
- 本輪沒有 SQL 修改，不以先前原生／portable 資料庫測試當作本輪 hosted 驗收。

## 瀏覽器證據的範圍

實際 React 元件、AppShell、CSS、File／WebCrypto，搭配本機合成個案與攔截的假回應；瀏覽器只允許 loopback，fixture CSP 禁止外部連線。未使用真實個資、正式登入 cookie 或外部附件。此證據不代表真實上傳速度、檔案持久化、掃毒、RLS、實際簽署、官方申報或部署通過。

附件及收案代表狀態的 axe WCAG A／AA／2.2 AA 自動掃描為 0 violations；color-contrast 仍有 incomplete，不能宣稱全站 WCAG 人工驗收完成。未完成的補充鍵盤／縮放檢查不列為通過證據。

本機證據根目錄（不放真實資料或憑證）：`/Users/seniorlifepr/.codex/verification/daycare-20260928`。

- `full-vitest.log`：最終完整測試。
- `production-build-final.log`：最終正式建置。
- `operation-premium-audit.json`：限定介面稽核。
- `intake-mobile-final.png`、`intake-desktop-final.png`：最終等高收案介面。
- `medication-recovery-mobile.png`：固定原操作的手機拒藥復原。
- `attachment-readback-final.png`：回條已取得、摘要未讀回的手機狀態。

## 本輪雲端唯讀現況與發布門檻

已透過既有連線核對，不再沿用先前 403／不可見的連線結果：

- Vercel 團隊 `entrepreneur-9585s-projects`，方案 **Hobby**。
- 日照專案 `prj_eiwNI6buPlPXynMCWhatuzqxD74H`，Git 分支 main，Function 區域 hnd1。
- 正式部署 `dpl_Cde52jZutniyJHsALsMB8YRNYxRh` READY，仍為 `aa0b64f0f2f9168489f08ba615aa7b6c96ce059d`，不是本輪候選。
- Supabase `mmxqxsokpcdvuzmdhptg` ACTIVE_HEALTHY，區域 **首爾 ap-northeast-2**，不是原規劃東京。
- 雲端 130 份 migration，最後 `20260925141114_governed_questionnaire_drafts`；本機 153 份，相差 **23 份**。未套用。

Vercel [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) 限定 Hobby 為非商用個人使用；公司營運系統的正式發布需選擇合適付費方案。使用者先前要求不增加費用，因此沒有擅自升級、建立付費資源或替換正式站，已詢問方案選擇。

下一步仍須：取得商用方案／費用決定與資料區域核准，精準核對這 23 份增量與先前候選的相容性，完成備份及回滾排演，再於受保護預覽驗收本人 Google 登入、主管／員工權限、同店 Finance 收支、附件保存／下載及關鍵業務流程；全數通過後才正式切換。不把自動 Git 部署當成避開上述門檻的方式。

## 明確保留的缺口

- 完整頁面重載、跨分頁或重新登入沒有 durable 原操作復原；沒有新 Auth session nonce。未知結果請先完成原操作核對，不用舊 props 代替新登入。
- 用藥尚無原回條唯讀查證／確切新來源解除保存標記的完整介面；附件尚無跨卸載 journal／完整 authority context，類別處置重試沿用既有流程。
- 真實 WORM／七年封存、掃毒設定與驗收、完整 CMS 正式欄位提升、正式量表採用、官方申報格式、真人簽署、hosted 備份還原與 50 人 HTTP 並行仍未全部通過。前台提示改善不解除這些安全與營運門檻。
