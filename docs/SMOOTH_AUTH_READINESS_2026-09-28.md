# 登入與首頁等待：實作／驗收紀錄

日期：2026-09-28。狀態：本機候選，未發布。承接`SMOOTH_CONTINUOUS_WORK_READINESS_2026-09-28.md`，不宣稱全部89頁或正式營運已通過。

## 本輪改善與驗收方式

| 改善 | 方法 | 必須通過的檢查 |
|---|---|---|
| 首頁少串行等待 | 今日照顧、排班、應到名冊同時讀取；原名冊Promise共用 | 已授權且合法日期後才開始；未回覆時其他來源已開始；只讀一次；原錯誤各自保留 |
| 現場紀錄入口較順 | 頁3／6／46原權限preflight與core並行 | 原permission／scope不變；false或失敗不假造寫入權；非法selection先拒絕 |
| 登入來源不無限等待 | 單次20秒owner，assurance／membership與branch／organization分階段並行 | stalled client／user／admission／AAL／membership／branch／organization／nursing；late值不能進場 |
| 服務故障不冒充登出 | retryable／5xx或逾時回安全503 | 無login redirect；已知缺session／無效token仍拒絕；不回raw provider字串 |
| 每次取消有效 | 將owner／Request／init取消傳給實際SDK fetch，no-store | before-request／headers／JSON卡住都取消；default client行為不變；lateCookie值與刪除被拒絕 |
| 分支失敗可辨識 | auth503 envelope；分支查詢獨立20秒 | unavailable不變403，不發切換Cookie；真denied仍403；正常Cookie／demo／DELETE不變 |
| 入口更新有界 | Proxy更新完成才套用staged cookies與SDK cache headers | 20秒／request取消後late更新無效；可選refresh失敗仍由原下游驗證；synthetic禁寫不變 |
| 登入失效清理完整 | request-local shadow讓SDK讀到已stage的新Cookie分段 | 實際安裝SDK刷新產生分段後session_not_found401須移除每個新分段；只用fake provider，不連真實帳號 |
| 錯誤提示不誤導 | 只說「目前無法載入」，要求核對原筆，沿用reset | 不宣稱「沒有送出」；不要求不存在requestID；原按鈕只reset；桌機／390px鍵盤、對比、overflow |

## 不改動的安全與版型

Google admission、個案指派、RLS、資料範圍、角色與MFA規則不變。沒有service-role、editable user metadata授權、public CDN cache或跨request患者內容快取。護理／社工／轉介的近期證據仍分開，兩個原source-wiring tests只更新新增signal參數的精確assertion，不移除隔離檢查。

Finance header/sidebar的色彩、文字、圓角與幾何不變。唯一內容區contrast修復為`.route-error .button--primary`引用原`--brand-strong`與白字；不改全域brand值。

## 驗證結果

最後整合全套Vitest：594檔通過、1檔skip；10,548項通過、1項skip。保留jsdom「navigation to another Document」警告及conditional既有skip，不作hosted瀏覽器通過證據。全專案ESLint零警告、Typecheck與production build通過（101個產生頁面不是89頁全部功能已驗收）；未改DB migration、未執行新的hosted SQL或真人登入測試。

- 首頁／routine orchestration23項新測試；原頁72共用煙霧另驗證，沒有預讀越權個案。
- server fetch／Cookie factory／實際SDK本機loopback3組22項通過；loopback涵蓋headers前及JSON body卡住。Proxy含實際已安裝SDK的分段刷新／清除；首次獨立覆核抓到stage後read-your-writes缺失，修正shadow後強assertions通過，不放寬預期。
- Proxy及全synthetic-preview8組90項通過；最後獨立重跑Proxy23項通過，原P2確定關閉，沒有新增可處理問題。這仍不是hosted token rotation／rollback或取消證據。
- 分支4組60項通過，其中專屬29項；auth／branch／nursing／social／referral及audit path7組163項通過。兩個舊source-wiring tests原先因新增signal參數不符而失敗，更新精確assertion後通過；原隔離檢查保留。
- 錯誤頁實際React/CSS vs HEAD4042a72的Chrome before／after共16項，1440×1000／390×844、鍵盤／offline pointer、reduce-motion、0 document overflow、90×44px按鈕、5.02163257594014:1對比。證據：`/Users/seniorlifepr/.codex/verification/daycare-route-error-20260928.2SpQqW/report.json`及README／final screenshots。reset callback1次、component0fetch只證明此元件，不作實際Next復原或未提交證據；root已檢視final mobile畫面。
- 修改來源snapshot strict audit為0 finding；`/Users/seniorlifepr/.codex/verification/daycare-smooth-auth-20260928/changed-source-audit.json`。較廣既有UI strict audit仍17 findings（含舊工作區及fixture），不是全站通過。稽核工具原誤把App Router `[...slug]`當parent traversal，已改逐segment判定並以15項測試保留真正`..`／非source拒絕。
- DESIGN官方lint0errors、7既有orphan-token warnings；Model B以globals作唯一runtime來源，frame無新token值或幾何變更。

## 明確未完成／限制

- 20秒為各owner／階段預算；Proxy、Auth及业务loader可能相加，不是整個route的20秒或正式p95。首頁仍等core／roster後呈現主要內容。
- Abort不證明provider refresh、SQL或其他外部狀態沒有提交；真實Google／token輪替與hostedCookie仍待验收。
- 真正CEO／主任登入、89頁、正式量表採用／簽署、CMS封存與掃毒、Finance來源、50人並行、備份還原與人工WCAG／Safari驗收未由本輪本機合成測試取代。
- 既有其他頁的native未保存confirm／驗證差異與17項廣域UI findings另案處理，不宣稱整站已零缺陷。

## 發布狀態

本輪重新只讀檢查：連接團隊`entrepreneur-9585s-projects`仍為Hobby；可見teams分頁已讀完，沒有其他Pro／Enterprise團隊。project`prj_eiwNI6buPlPXynMCWhatuzqxD74H`、`suiyue-daycare-preview`為東京hnd1；正式READY仍是`aa0b64f0f2f9168489f08ba615aa7b6c96ce059d`，deployment`dpl_Cde52jZutniyJHsALsMB8YRNYxRh`。

[Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines)（本輪重新讀取，頁面更新2026-09-14）將Hobby限於非商業個人使用。公司使用需要合適方案；使用者先前要求不增加費用，因此未push觸發雲端部署、未deploy、未升級、未修改Supabase。須指定已付費team或明確核准費用處理才可完成正式發布，不能將本機commit／build當成已上線。
