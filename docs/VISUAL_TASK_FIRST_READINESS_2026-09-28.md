# 任務優先改版：第一批實作與發布狀態

日期：2026-09-28。此文件區分本機候選、合成操作驗證與正式發布，不代表全89頁已完成。

## 追加：選案後接續評估與精簡每日明細（本機候選）

- 個案中心與已選個案的每日工作新增「評估這位個案」，沿用同一個案 ID；評估入口在伺服器重新核對可查看名單與量表權限，無效、無權限或已結案的 ID 不會顯示他案。九份題目式量表可返回同一個案的評估清單；未保存內容仍受既有離頁保護。
- 展示模式的個案中心、評估入口與九份題目式量表共用合成名冊，避免「看得到捷徑卻選不到同一個案」；正式環境仍只讀授權後的個案快照，不以展示資料補救正式讀取失敗。
- 已選個案的出勤、量測、日誌頁將單人完整紀錄預設收起，當前步驟、異常與權限提醒維持可見；資料來源規則按需展開，更新時間仍直接顯示。未選案時保留完整當日清單。
- 最後來源全量 Vitest：600 檔／10,650 項通過，1 檔／1 項略過；142 個本機資料庫相容測試檔／6,763 項斷言、lint、typecheck、Next 正式建置、嚴格 UI 靜態稽核 0 finding 及隔離展示服務 89/89 路由 smoke 通過。路由檢查只證明可載入，不代表 89 頁都有正式可用功能。
- 本機 Chrome 桌機 1440 與手機 390px 驗證：DEMO-010 從個案中心→評估→SPMSQ→返回保持同一人；終止個案被拒絕；每日紀錄可用 Enter／Space 展開，未混入他案；390px 無整頁橫向溢位。證據位於 `/Users/seniorlifepr/.codex/verification/daycare-ux-browser-20260928.az80MQ/`。此驗收使用合成資料，未涵蓋正式 Google 登入、RLS 實際寫入、非問卷評估、Safari、螢幕閱讀器或真人新手任務。

此追加切片尚未推送 GitHub 或部署 Vercel；下方既有發布門檻仍有效。當前可存取的 Vercel 團隊為 Hobby，而公司商業系統需合適付費方案；在使用者「不增加費用」的限制與正式營運門檻未解決前，不觸發連到 `main` 的正式自動部署。

## 本輪完成範圍

| 工作流 | 已實作 | 保持原樣的界線 |
|---|---|---|
| 今日工作 | 所選班別短狀態、每人一個下一步、完整分工按需展開、立即搜尋／清除 | 原指派／日期／班別／無權限判斷；沒有排程不能當今日應到；草稿和待簽署仍可見 |
| 個案中心 | 搜尋／名單置前、常用狀態捷徑、完整篩選及統計按需展開 | 原GET查詢、分頁、日期、責任範圍、120 UTF-16搜尋上限；受限不當零 |
| 九份題目式工具 | 選個案後題卡先行、日期／本人記錄者／進度、整列選項、補充文字、來源詳情收起 | 完整題文／選項／公式、草稿狀態、正式分數／簽署門檻；不是全13個評估入口正式能力已啟用 |
| CMS收案 | 五步等高卡、真實基本資料缺項、精簡步驟行、來源及帳號背景收起 | 原操作 journal、逐欄核對、未知後同鍵重試、保存後GET-only讀回；封存未配置仍停用HTML上傳 |
| 共用外框 | 已授權評估／每日彙整捷徑、全部功能收起、直達模組自動展開、選案16px／44px | Finance字型／header/sidebar幾何與品牌；原權限、89頁入口、登出及mobile focus trap |

內容區今日、個案、收案及量表主要操作使用既有深橘 `--brand-strong`＋白字，實測／計算對比5.02:1；不改Finance header。SearchField保留原明確GET模式，另提供無網路請求的local controlled模式，不把搜尋變成新的資料來源。

## 驗證

- 全專案型別檢查與正式Next建置：通過。
- 全專案ESLint及差異格式：最後版本通過。
- 最後來源完整回歸：579檔／10,356項通過，1檔／1項略過；使用`pnpm exec vitest run --maxWorkers=4`，沒有放寬timeout或降低斷言。
- 改動source的嚴格靜態掃描：0 findings。掃描器只接受目錄，故由`verify-task-first-ui-audit.mjs`複製實際改動檔至新暫存快照後掃描，沒有把單一檔案的sourceRoots誤當已掃描。
- 原default manifest限定範圍：0 findings，但不能代表全站。
- 較廣相鄰元件掃描：仍有23項既有form validation owner／textarea設定發現，全部位於本轮未修改的檔案，包含測試fixture命中；未靜默移除或當成通過。報告為`premium-task-first-broader-audit.json`，需後續逐筆業務／可用性判斷。
- 獨立只讀review發現今日主按鈕對比不足，已修正；未有剩餘可确认P1／P2。這不代表未知缺陷為零。

### Chrome實際元件與相同合成內容

Before由git HEAD `bfbad95`的實際來源與globals編譯；After由本輪來源編譯，使用相同scope、內容與viewport。沒有重畫Before；所有API transport為隔離合成回覆，沒有真實個資／雲端寫入。

- 今日／個案：67項通過，1440×1000及390×844。涵蓋搜尋清除0 fetch、GET保留篩選、client/date/shift實際連結、詳情鍵盤、受限／空資料／錯誤／排程未取得、選單焦點循環／Escape／inert、選取頁白字。
- 量表：25項及最後按鈕對比補測通過，桌機／390px／CSS200%重排。涵蓋完整題文與選项等價、unknown回查位於題卡前、查無仍保留原筆、原body/key重試、保存後正向讀回、捨棄視窗取消／Escape保留輸入、44px保存與焦點。CSS縮放不是原生200%zoom驗收。
- 收案：桌機／390px步驟等高、選案16px／46px、無橫向溢位；封存未配置具體原因、手動建檔、真實缺項、未知原鍵重試、保存後GET-only回補均通過。收案scoped axe為0 violations；全外框仍有既有header登出橘白對比2.61及clock/gradient待人工判讀，不能稱全站WCAG通過。

完整證據在本機：

- [今日／個案報告](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/lists/results.json)
- [量表報告](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/questionnaire/report.json)
- [收案報告](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/intake/REPORT.md)
- [本輪實際改動掃描](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/premium-changed-source-audit.json)
- [較廣範圍未完成項](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/premium-task-first-broader-audit.json)

| 畫面 | Before | After |
|---|---|---|
| 今日工作桌機 | [原版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/lists/today-before-desktop.png) | [新版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/lists/today-after-desktop.png) |
| 個案中心手機 | [原版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/lists/case-before-mobile.png) | [新版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/lists/case-after-mobile.png) |
| 量表桌機 | [原版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/questionnaire/before-desktop.png) | [新版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/questionnaire/after-desktop.png) |
| 收案手機 | [原版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/intake/before-mobile-selected.png) | [新版](/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/intake/after-mobile-selected.png) |

## 尚未驗收或未完成

1. 10位新手9位無協助完成、個案搜尋15秒、說明文字降低50%等產品目標尚未真人測量；可見總字數縮短不是該目標的證據。
2. 全89頁、全部角色首頁、用藥／交班／店務等後续工作流尚未全量重設計；本輪沒有啟用正式量表簽署、CMS封存／掃毒或改MFA。
3. hosted Auth／API／資料庫／Finance收支、真正CMS原檔、真人保存與收案仍需正式環境驗收；本機假回條不能代替。
4. iOS／Android實際鍵盤、原生200%zoom、螢幕閱讀器、完整人工WCAG與50人並行／效能目標尚未驗收。
5. 收案選案卡的次要補充文字仍可能省略顯示；完整基本資料缺項在下方待核對區可讀。

## 正式發布狀態與所需決定

本輪只讀確認GitHub已登入、Vercel已登入；專案`prj_eiwNI6buPlPXynMCWhatuzqxD74H`連結main，執行區hnd1，所屬團隊目前為Hobby。最後讀到的既有正式部署為READY、來源`aa0b64f0f2f9168489f08ba615aa7b6c96ce059d`，不是本輪候選。

Vercel官方[Fair Use規則](https://vercel.com/docs/limits/fair-use-guidelines)規定商業用途需Pro或Enterprise，Hobby只供非商業個人用途。官方[價格](https://vercel.com/pricing)當日顯示Pro每月US$20，不含稅；實際席次／超額用量與支出上限須先確認。尚未取得新增費用／移轉至其他付費團隊的授權，不自行升級、啟用付費試用或觸發可能自動部署的Git推送。

因此：此輪沒有git push、Vercel部署／promotion、雲端設定修改或Supabase migration；公開網址仍非這個新版。即使方案問題解決，仍須先核對正式環境schema／版本／功能門檻，預覽驗收後才可升到前台。

### 最後整合結果

最後來源已通過`pnpm typecheck`、`pnpm lint`、`DAYCARE_DISABLE_FILESYSTEM_CACHE=true pnpm build`（101個靜態產生項目、保留原API與動態路由）、`git diff --check`及改動source嚴格掃描。`node --check scripts/verify-task-first-ui-audit.mjs`也通過。

最後一次全測與建置並行曾使A／B／C表既有5000ms測試超時，該輪為10,355通過／1超時／1略過，不能稱通過。沒有修改該測試或時限；停止其他建置工作後，原11項獨立測試通過（3.55秒），再以4 workers單獨執行完整全套，579檔／10,356項通過、1項略過（88.85秒）。這是本機測試資源競爭的驗證，不能推論正式50人效能目標通過。

已保存為本機Git候選；沒有推送或部署。下一步仍需部署方案／費用決定、正式環境版本與門檻核對，以及預覽→實際作業→正式發布的獨立驗收。
