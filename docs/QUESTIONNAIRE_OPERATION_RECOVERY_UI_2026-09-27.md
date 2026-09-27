# 題目式量表原操作復原：前台候選驗證

本輪僅是本機候選，沒有GitHub推送、Vercel發布或正式Supabase變更；不能投入真實個案作業。原11模組／89頁不變，範圍為既有九份題目式工具的草稿保存、本人原操作確認、確切歷史讀回與未保存離開保護。正式簽署、完整MNA、專業表單及其他正式門檻並未完成。

## 已修改

- 首次送出固定完整原body、操作鍵、actor、機構／分支、個案及表單，結果未知後留在分頁記憶體journal。重新掛載保留原答案，不自動POST、GET或换鍵。
- 「確認保存結果」是有界、明確手動、header-only的本人receipt GET；不取得MFA、不重送、not_found不當作未保存。未知後的拒絕仍保留原筆。
- POST201只標已保存。只有歷史包含同一原版本、原答案／情境、hash及微秒時間才解除同筆防重送；原版被新版取代時再查有界原版本窗口。較新清單、空清單及router.refresh不是原筆證據。
- read／saved／原版本窗口均先驗成功envelope，HTTP200但status錯誤、errors非空或requestId非法一律隔離臨床內容，不能以附帶的真實原列解除guard。
- 未送出修改改用共用GovernanceDialog／useUnsavedChanges。取消、Escape與模態外點擊保留填答，明確危險按鈕才捨棄；未知或讀取中不能藉捨棄換筆。
- AppShell在其他頁仍追蹤authority／epoch，登出同步清除journal，不由旧props恢复登入內容。撤權、指派／來源變化、同generation ABA與晚回覆拒絕舊結果。
- 初次來源需真實60秒內；已合法入場的相同owner可完成超過一分鐘的填寫及原筆回查，不改來源時間、不宣稱重新授權。每次API／RPC仍重新核對真實登入。
- 修正同個案新SSR來源造成編輯器暫時卸載、答案重置的問題：保留先前合法owner直到layout接納新來源，開始新寫入仍要求精確新sourceAt；不是以保留owner授予新scope。
- 修正390px／CSS200%評估條件fieldset的min-content／220px固定下限造成橫向溢位；只改量表內容區的有界grid，不改Finance header／sidebar及全域token。
- 讀回後原操作入口已移除時，回到可聚焦「評估紀錄」；使用者若已移往其他控制則不搶焦點。保留16px輸入、44px操作、inline驗證及IME保護。

## 驗收與證據界線

證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-20260926`。途中失敗及調查紀錄保留；最後凍結版本的驗證如下，不把修正前結果說成通過。

| 驗證 | 凍結版本結果 | 證據 |
|---|---|---|
| 全程式回歸 | 547檔／8,953項通過；1檔／1項opt-in跨repo測試跳過，不計通過。為避免建置與多套測試競爭CPU而固定4 workers，未提高timeout | questionnaire-ui-recovery-vitest-final.log |
| 被跳過的Finance跨repo測試另執行 | 指定既有Finance候選repo，原Node fetch→實際Finance handler的合成loopback1項通過；不是hosted或真實金額對帳 | questionnaire-ui-recovery-finance-loopback.log |
| 量表配置命令 | 29檔／1,479項通過 | questionnaire-ui-recovery-configured-questionnaire.log |
| 治理配置命令 | 5檔／177項通過 | questionnaire-ui-recovery-configured-governance.log |
| lint／typecheck／production build | 均通過；建置與HTTP僅使用loopback、停用真實Supabase設定 | questionnaire-ui-recovery-lint-final.log、type-final.log、build-final.log |
| 正式相依套件audit | 未發現已知弱點，不等於滲透測試 | questionnaire-ui-recovery-audit-final.log |
| strict scoped design audit | 兩份零finding；各配置要求的測試、型別與建置另已實際執行，靜態audit本身不代表這些命令已跑 | questionnaire-ui-recovery-premium-questionnaire.json、premium-governance.json |
| 實際Chrome | 36項通過，12張最終截圖；390px、短手機、CSS200%及forced-colors／reduced-motion | questionnaire-ui-recovery-browser.json |
| 正式建置HTTP拒絕 | 15項通過：receipt有效未登入401、無效header／query400、POST405、history／readiness未登入401；九份頁面只streaming登入導向、無臨床form且private/no-store | questionnaire-ui-recovery-production-http.json |

實際Chrome另確認取消／Tab／Escape／backdrop與觸發器焦點、同owner較新SSR保留未送出答案、unknown重掛不自動送出、not_found保留lease、原bytes／key明確重試、薄201與確切history gate分開、讀回回到紀錄焦點，以及含JSON解析的約20秒獨立期限。登出測試證明本機內容遮蔽、journal／lease清除與晚回覆失效；合成fixture沒有真實Auth credential，因此登入終止仍明示未確認，不宣稱hosted sign-out成功。測試結束已關閉所有自有Chrome及loopback服務。

九份工具相關配置命令中包含journal76項、transport156項及實際AppShell復原15項。新增同owner新SSR、malformed成功envelope及權限隔離案例；configured命令不是全89頁或真人hosted驗收。

本輪沒有新增SQL或變更API後端；147份migration與後端測試來源保持上一輪原操作查證版本。上一輪原生17／17套及portable136套／6,425斷言是先前後端證據，**本輪不冒稱重新執行**；見[後端原操作查證](QUESTIONNAIRE_OPERATION_RECEIPT_2026-09-27.md)。

Chrome使用自有隔離session、loopback及合成資料；不讀個人Chrome profile、cookie或正式個資。手機／CSS200%、鍵盤模態、未知重新掛載、原body／key重試、實際20秒JSON逾時、權限撤銷與安全登出只證明此切片，不等於hosted登入／RLS成功流程、瀏覽器全族、正式簽署或完整人工WCAG。

## 仍未完成

1. 整頁重載沒有durable原操作定位；不能把分頁內重新掛載說成離線或跨重載復原。敏感body不放browser storage／history／離線佇列。
2. 來源被隔離後，舊歷史GET不是新context／nonce授權快照；需要安全登出／重新登入並由主管核對已保存紀錄，不能以舊SSR解鎖原筆。
3. 32個confirmed guard與128個source floor有界且不靜默淘汰；完整安全清理／跨重載恢復仍待後續。not_found不釋放未知鎖。
4. 九份仍是草稿與候選完成檢查，formalScore=null、signable=false。來源原件採用、資格附件、真人雙人覆核、正式簽署／更正與完整專業工具仍是正式門檻。
5. 商用部署方案／費用、資料區域、CMS不可變封存與掃毒、官方申報實檔、Finance同店帳務、家屬權限、實際備份還原／壓測及真人營運驗收仍未通過；不以本輪測試替代。見[正式部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。
