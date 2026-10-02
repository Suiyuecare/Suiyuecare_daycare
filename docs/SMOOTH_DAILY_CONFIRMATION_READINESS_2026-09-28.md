# 每日記錄：連續填寫與確認驗收

日期：2026-09-28。狀態：本機候選，尚未發布。

本輪依 `SMOOTH_DAILY_CONFIRMATION_PLAN_2026-09-28.md` 執行。先改善出勤、生命徵象、照顧日誌，不宣稱全89頁已完成或正式營運已驗收。Finance header／sidebar、runtime色碼、字型及frame幾何未更動。

## 已改善

| 現場問題 | 實作 | 驗收重點 |
|---|---|---|
| 填到一半離開，瀏覽器提示不一致 | 三張每日表單共用系統內「繼續填寫／捨棄」視窗，縮短提示 | 取消、Escape、背景點擊保留原輸入；一次只有一個模態；明確捨棄才接續 |
| 提交或簽署容易誤按 | 日誌四種操作先顯示個案、原版本、時間、理由及後果 | 確認前與取消後零POST；不把草稿／提交當正式完成 |
| 回覆內容一直等，重送可能新增一筆 | fetch、拒絕回條及JSON共用20秒預算，原操作固定body／key | 超時保留unknown；不自動重送或換鍵；晚回覆不能清空新畫面 |
| 來源更新或權限變更後，舊畫面仍能操作 | 可見scope取消舊request；日誌明確401／403隱藏舊內容 | 權限ABA／卸載後晚回覆無效；網路故障保留唯讀輸入，手動GET恢復 |

GovernanceDialog／useUnsavedChanges為本輪確認owner；日誌草稿編輯也採noValidate、inline欄位錯誤、首錯焦點與中文組字保護。原生日期與選單仍是平台例外。沒有新增權限、資料庫migration、敏感快取、write lease或跨掛載journal。

## 本機驗證

- 最後全套Vitest：597檔通過、1檔跳過；10,616項通過、1項跳過。保留既有conditional skip及jsdom導覽警告，不當成hosted驗收證據。
- 全專案ESLint零警告、Typecheck與production build通過；產生101頁不是全部89頁功能驗收。
- 日誌41項元件測試；deadline helper13項、三張每日表單request/decode12項、visible-scope owner2項，以及既有日常、共同導覽、模態、安全登出與舊頁相容回歸全部通過。
- 最後實際改動來源的strict UI audit：18個來源／測試／CSS檔，0 findings。報告：`/Users/seniorlifepr/.codex/verification/daycare-daily-confirmation-audit-20260928.json`。
- 較廣task-first UI audit仍有12項既有finding（個案及通用工作區表單／fixture）；不是全站0缺陷。報告：`/Users/seniorlifepr/.codex/verification/daycare-daily-confirmation-broad-audit-20260928.json`。前一登入切片17項中，本輪日誌相關5項已移除，其餘未以擴大此切片方式宣稱完成。
- DESIGN官方lint：0 errors、7項既有orphan-token warnings；globals仍為唯一runtime token來源。

## 瀏覽器證據

固定baseline為395655a；候選使用實際React元件、CSS與loopback合成API，沒有真實個資或正式POST。證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-draft-guard-20260928.vc1g9L/`。

最後候選30組真Chrome流程全部通過：三表單取消／捨棄6組、pending／unknown原筆重試6組、日誌編輯2組、提交／簽署／更正／退回8組、401／403隱藏及502恢復8組。桌機1440px與手機390px使用同一最終bundle，確認前／取消後零POST；回覆不明後只明確重試原body／key。

另通過390×844、中文欄位16px／操作44px、無橫向溢位、取消回焦及reduced-motion檢查。實測鍵盤outline3px、繼續填寫對比14.19:1、捨棄7.82:1、焦點對白底6.65:1。root已目視最終手機確認畫面，標題改短後不再拆行。36份實際候選bundle來源SHA-256與checkout差異0；`report.json`／`README.md`保存完整before／after、限制及重現方式。所有自用Chrome／loopback server已關閉，不沿用修正前證據。

## 邊界／尚未通過

- 其他六個無參數guard消費者保留legacy native-confirm相容行為，離線裝置草稿刪除未遷移；不是全站確認視窗已統一。
- 可見scope只來自傳入的個案、日期、班別、demo、操作旗標與名單；日誌sourceRevision只來自原daily snapshot.generatedAt。不是完整actor／tenant／assignment／新登入authority generation。
- unknown仍沿用既有mounted attempt；完整重載、跨分頁、跨掛載或重新登入不保證原操作定位。GET成功不等於原unknown已保存，不自動POST。
- 未送出內容捨棄不刪既有裝置草稿。離線capture／saved／retain並非fetch/decode20秒預算，不宣稱全保存SLA。Abort不是SQL rollback證據。
- 正式Google登入、hostedRLS／保存／真人簽署、CMS封存／掃毒、正式量表採用、Finance來源、50人HTTP、Safari／輔具、備份恢復及全部89頁仍須獨立驗收；合成Chrome不是上述證明。

## 發布限制

本輪重新只讀查詢全部可見Vercel teams（next=null）：僅`entrepreneur-9585s-projects`，方案仍Hobby，沒有可見既有Pro／Enterprise team。未升級、未扣款、未改Supabase、未push觸發Vercel部署。

[Vercel官方商業用途規定](https://vercel.com/docs/limits/fair-use-guidelines)（本輪重新讀取，頁面更新2026-09-14）限制Hobby為非商業個人使用。使用者先前要求不增加費用，故正式發布需要指定已付費team或明確核准費用處理；不把本機commit／build稱為前台已更新。

同一發布限制已在前三個連續切片記錄：`VISUAL_TASK_FIRST_READINESS_2026-09-28.md`、`SMOOTH_CONTINUOUS_WORK_READINESS_2026-09-28.md`、`SMOOTH_AUTH_READINESS_2026-09-28.md`。本輪批准的局部實作與驗證完成後，必須取得這項發布決定，不再以額外未發布切片替代所要求的正式部署。
