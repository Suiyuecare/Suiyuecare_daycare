---
version: alpha
name: "歲悅日照管理"
description: "沿用歲悅 Finance 的暖色工作台，讓現場與管理人員清楚完成下一項工作。"
colors:
  primary: "#ea880c"
  primary-text: "#b45309"
  background: "#fff9f2"
  surface: "#ffffff"
  soft: "#fff4e4"
  ink: "#2f2a26"
  muted: "#6e6259"
  border: "#f1cfa8"
  danger: "#8a1010"
  success: "#2a6010"
typography:
  sans:
    fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif'
  utility:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "10px"
  sm: "8px"
  md: "10px"
spacing:
  page-padding: "32px"
  control-height: "44px"
components:
  button:
    rounded: "10px"
  card:
    rounded: "10px"
  input:
    rounded: "10px"
---

# 歲悅日照管理設計依據

## Overview

使用者指定的 Finance 畫面為視覺依據，不另作品牌改造。既有 `src/app/globals.css` 是 runtime token 的唯一來源；本文件採 Model B，記錄已實作值，不產生第二套 CSS。

本次範圍包含頁面 82 的題目式量表規則審核入口、頁面 49 的申報驗證安全重試、頁面 19 的人工身體觀察原筆回查，以及單店出勤與收支的有界定時讀取；不代表重新驗收全部 89 頁。使用者為臺灣日照機構主任及授權管理者；繁體中文、`zh-TW`、`Asia/Taipei`，非日本市場。主要工作是核對版本、送審、獨立核准、查閱退休歷程、確認申報草稿與查閱當店收支。

保留熟悉的左側欄與頂部 frame；畫面辨識特徵是暖橘選中狀態與奶油色篩選區。不要大型宣傳標題、裝飾圖表、密集工程警告或另一套 header。安全限制不能因簡化文字而隱藏。

## Colors

`--brand`／`--brand-strong` 用於行動與可讀文字，`--ink`／`--ink-muted` 用於正文及說明，`--surface`／`--surface-soft` 區分內容與篩選區，`--line` 作邊界。成功、危險均須文字，不只靠顏色。新元件引用 CSS 變數，不複製色碼。

淺色是目前已實作主題；不宣稱已驗收深色。forced-colors 保留系統色與可操作捲軸。

## Typography

沿用 Finance 字型堆疊；標題、正文及控制項以字級與 600–700 粗細分層，不新增 display 字型。主頁標題沿用 `.page-heading` 的 28–36px，新管理區段標題 20px，正文 15px、表單輸入至少 16px。雜湊只放進預設收起的技術詳情，長值可換行，不做需要 hover 才看得到的截斷。

## Layout

既有 `--sidebar: 300px`、`--header-height: 82px`、`--content-padding: 32px` 與 AppShell 不變。新區段自然高度、沿用既有內容捲動者；不將整頁固定到 viewport。窄螢幕分成單欄，控制項與主要觸控目標至少 44px，不產生頁面水平溢位。

篩選只有一個量表選擇；歷程最多每批 20 件，明示載入筆數及總數，以「載入更多」取真正游標，不假裝任意頁碼。原頁 82 自訂表單工作區仍保留。

## Elevation & Depth

沿用 `--admin-shadow` 的低陰影與細邊框。不要逐卡強烈浮起；模態確認沿用 `.core-dialog` 與原生 dialog top layer，不自建任意 z-index。

## Shapes

一般卡片／控制項採現有 10px，44px 控制高度。既有 client selection 的 18px 與 sidebar pill 是具業務名稱的既有例外，不因此套到所有卡片。

## Components

2026-09-28 操作復原切片沿用 Finance frame、全域 token 與既有控制幾何，不重新設計品牌。用藥、收案的確認／未保存離開共用 `GovernanceDialog`／`useUnsavedChanges`；等待與讀回結果用同頁具名 status／error，不新增另一套 toast。用藥保留 native select／datetime-local，收案與附件保留 native select／date 的平台例外，popup 幾何及語系由瀏覽器／作業系統擁有，日期仍依正式 schema 驗證。textarea 改成不可拖曳，輸入 16px、觸控至少 44px，內容自然高度。

CMS／附件的回饋使用實際階段文字：檢查原檔、傳送／安全檢查、回條核對、讀回清單；沒有可測量的 byte progress 時不顯示百分比。保存原檔、保存業務資料、正式完成收案是不同狀態。附件下載仍依既有 CSP 採安全短效下載，不以新增 iframe 或直接渲染原檔突破政策；到期連結收起並提供更新入口。這是具名受限下載變體，不宣稱已有內嵌預覽。

| 角色 | 唯一 runtime owner | 本次 consumers |
|---|---|---|
| 文字／色彩／邊框／圓角 | `src/app/globals.css` | 全部新規則管理元件 |
| Header／sidebar | `src/components/app/app-shell.tsx` | 原 page 82，不另造 frame |
| Button／field／dialog surface | `.button`／`.field`／`.core-dialog` | 管理區段及確認視窗 |
| 模態確認行為 | `src/components/ui/governance-dialog.tsx` | 採用／退休／申報驗證共用確認入口 |
| 有界請求／範圍回執 | `client-fetch.ts`／`rule-governance-client.ts` | 讀取、寫入及原操作重試 |

Native select 的關閉外觀沿用 `.control`，開啟選單接受作業系統幾何與鍵盤行為，不宣称其 popup 和 Finance 完全相同。日期採有格式提示的 YYYY-MM-DD 文字欄位與正式 schema 驗證，不自製 calendar。文字欄位明確標籤；textarea 不可拖曳改變佈局，保留充分高度和內部捲動。

店務摘要是已存在的 Finance 篩選具名例外：沿用原生 date／month 控制；人工身體觀察保留既有 native datetime-local，以台北時間轉成帶偏移的正式 schema。兩者接受瀏覽器／作業系統選單、語系及幾何；不是規則治理的 typed 日期欄位，也不宣稱 popup 與 Finance 像素相同。表單關閉原生驗證氣泡，由日期／月份／觀察 input 契約驗證並顯示可操作的錯誤。

pending 按鈕保持原尺寸並標示忙碌；成功只在完整回執確認後出現。錯誤不消失、不展示原始資料庫文字。審核理由、期限與正式啟用後果始終可見；題庫原文、公式和雜湊在詳情中。

申報驗證沿用既有欄位、筆數與總額摘要，不另建 frame；結果未知時只提供原筆回查。店務頁不新增圖表或更改財務口徑，定時讀取不等於成功取得新資料；未更新及離線提示保持可見。

高風險確認視窗的主要按鈕使用既有 `--brand-strong` 配白字，以符合一般文字 AA 對比；只限 `.core-dialog`，不更改 Finance header／sidebar 的既有 token、位置或圓角。此具名無障礙例外來自 Chrome／axe 實測，而非另一套品牌配色。

取消／繼續填寫使用既有 secondary，捨棄未保存內容使用 danger-soft／danger。由 `.core-dialog` 統一擁有語意樣式，不能被工作區的泛用 button 規則改成主要橘色。視窗標題列的取消按鈕不收縮、不拆字；390px 仍須至少 44px 高度並可見。身體觀察的離頁與分支切換確認沿用同一 owner，前一視窗關閉後才開下一個，不疊加兩層確認。

圖示沿用 lucide-react，decorative 圖示 aria-hidden。新區段不另加進場動畫；共同 reduced-motion 保護與 focus-visible 生效。捲軸為全域 application 基線，幾何可局部穩定 gutter，不使用 opt-in class 才有色彩。

題目式量表的 ADL／IADL 草稿狀態修正延用原題卡、radio與 notes 欄位，不增加另一種 frame。不適用原因與日期／測量／條件輸入由既有 questionnaire module 統一16px，避免繼承 compact label 的14.4px；標籤、卡片、Finance header／sidebar不改。狀態使用短文字而非只靠顏色，欄位錯誤可讀且關聯輸入，readonly保留原內容。

## Do's and Don'ts

CMS原檔上傳由同一`imports/cms-upload-control.tsx`擁有選檔、原操作查證及續做入口；收案及通用匯入只提供各自原預覽讀取器，不另造frame／file picker／toast。原生HTML檔案選擇器是平台具名例外，不開啟或執行HTML；沿用`.field`、`.button`、16px輸入、44px控制與持續inline status／alert。未知結果顯示短下一步，原键、雜湊及來源證據不在現場提示內。原操作仍未確認時禁止另選不同檔案而建新操作；新檔嘗試（含驗證失敗）必須清除先前可核准預覽。只在逐欄核對資料讀回後解除上傳鎖，不顯示正式收案完成。Finance header/sidebar token及幾何不改，AppShell只接權限epoch與登出清除。完整重載的原操作定位及一般重新解析的跨掛載復原仍是未完成門檻；本機Chrome不替代hosted封存、真人收案或全部89頁驗收。

CMS上傳主按鈕採具名無障礙例外：只在`cms-upload-control.module.css`使用既有`--brand-strong`與白字。Chrome／axe實測原橘色與小型白字僅2.59:1；內容區改用既有深橘色，不更改Finance header／sidebar或全域token。

九份題目式工具新增同頁「完成檢查」：只查已保存版，短狀態、缺答與安全提醒在主畫面，四項正式設定預設收起，但「尚不可正式簽署」持續可見。內容卡與控制採10px、輸入16px及44px行動；個案選擇卡保留18px例外。日期沿用治理的typed YYYY-MM-DD及日期schema。正文grid採minmax(0,1fr)與有界控制，390px／CSS200%不把overflow藏進內層main。Header／sidebar及token不變。合法同scope SSR更新不清稿，撤權隔離全部內容。後續原操作journal與共享確認已接入這九份工具；完整整頁重載定位、撤權後真正新context復原及正式簽署仍未完成，不因read panel宣稱合規。

頁68公告讀取沿用同一 AppShell、metric／panel／filter-bar／table／mobile-records，未變更 Finance frame token或幾何。搜尋採共用 `ui/search-field.tsx` 的明確套用與44px X清除；手機整行搜尋，下方狀態／筆數自然排列。頁尾只有起訖／頁碼與前後頁，不新增裝飾圖表或第二套分頁器。一般畫面縮短工程解釋；全量統計與篩選筆數、目前發布版／草稿及安全／展示限制保持清楚。

公告草稿、發布、撤回與原操作回查共用 GovernanceDialog，自然高度及既有620px最大寬度，不另設920px／560px對話框。表單採`.field`、16px文字、44px操作、不可拖曳textarea及native datetime-local台北時間具名例外。一般忙碌／待回查訊息集中於workspace，不逐列重複長說明；個別停用原因仍可由aria-describedby讀取。未保存捨棄沿用共享確認，未知操作唯讀與明確回查入口。成功後觸發器不可用時回到公告owner指定的可聚焦區段；首次已知拒絕提示在原表單內。Finance header／sidebar保持原token与幾何，不新增frame。

本機假API與scoped audit不代表hosted資料寫入、歷史已讀回查、所有89頁或人工WCAG完整驗收；部署限制仍見正式門檻。

頁51人工護理評估遷移至同一GovernanceDialog與useUnsavedChanges：簽署／更正明確確認，未送出輸入離開前確認，未知操作集中在工作區回查區段。日期是沿用既有native date的具名人工護理例外，接受作業系統popup；以正式schema驗證西元日期與複評順序，不宣稱calendar與Finance像素相同。表單採16px輸入、至少44px控制、不可拖曳textarea、noValidate與first-error focus；不另造header/sidebar或模態owner。回查成功後原入口停用時回到護理owner指定區段，不落到BODY。manual-nursing-v1仍為人工文字紀錄，不因版型與安全修正變成官方量表、正式分數或附件服務。

護理工作區採具名無障礙例外：提示卡文字使用既有`--ink`，主要操作使用既有`--brand-strong`配白字。Chrome／axe實測原橘色小字與白字按鈕對比不足；僅調整頁51內容區，不更改Finance header／sidebar token、幾何或品牌配色基線。

頁39轉介沿用既有panel／metric／desktop table／mobile cards與Finance AppShell；所有桌機／手機操作只打開同一workspace-owned GovernanceDialog。16px輸入、44px操作、不可拖曳textarea、共用field／status與原生datetime-local台北時間具名例外，不自造日期popup或第二套frame。原事件／送達限制留在可展開歷程與管理说明；一般操作顯示短提示、原筆回查及明確可做的下一步。展示資料與尚未配置的外部送達不隱藏成假成功。

頁28心理社會評估與頁29社工服務紀錄延用同一workspace-owned GovernanceDialog；桌機與手機列按鈕只提供入口，不逐列建立編輯器或操作鍵。原生date／datetime-local及datalist是既有人工紀錄的平台例外，接受瀏覽器選單；16px欄位、44px控制、noValidate、inline錯誤、first-error focus與不可拖曳textarea由同一owner處理。心理社會仍為manual-psychosocial-v1人工非標準化紀錄，不冒稱官方量表或已驗證分數。兩頁短提示集中在回查區段，原內容及歷程可展開；未配置附件／匯出、未知結果與授權復原限制仍可見。Finance header／sidebar色彩、字型、幾何不在本切片改動，也不宣稱像素一致驗收。

未知操作另提供「更新授權資料（不重送）」／「重新核對原範圍授權」單一手動GET入口，保留原操作且不開第二個表單。忙碌、未取得最新資料、內容已隱藏與仍待確認分别用既有inline status呈現；不加入toast、modal、新的frame或技術payload。資料讀取與原鍵重試是兩個明確動作，讀取成功不冒充保存成功。

頁51護理採相同手動授權GET變體：既有回查區段保留原內容唯讀詳情，另有「更新授權資料（不重送）」與明確原鍵重試。讀取忙碌不另造模態或表單，拒絕時用短inline錯誤與可再回查入口；不把更新資料稱作簽署完成。僅新增此既有按鈕／status用法，未修改任何Finance frame或runtime token；真實權限、來源撤銷及未知寫入保護仍優先於視覺簡化。

頁51後續增加「查證原紀錄（不重送）」：只放在目前unknown的既有回查owner（確認視窗開啟時只顯示於該視窗），不重複status或建立新modal。與授權資料GET／原鍵重試分開命名；查不到仍待確認，查到只標示已保存而非清單已更新。成功後回到具名回查區段，但不搶走使用者已移往另一控制的焦點。延用既有button／inline status／GovernanceDialog／16px與44px規格，未修改Finance frame、全域token、欄位或動畫。

九份題目式工具的原操作回查延用同頁工作區，不新增frame、toast或modal。結果未知時提供「確認保存結果」與明確原鍵重試；查無仍保留原筆，不稱為失敗。薄保存回條與已讀回原版本分開呈現，原歷史未確認前不開新評估。未送出輸入改用同一GovernanceDialog／useUnsavedChanges，取消及Escape保留輸入、明確危險操作才捨棄；讀回後原控制移除時回到可聚焦的「評估紀錄」，不搶走使用者已移往其他控制的焦點。撤權隱藏原內容；無真正新授權來源時只提供安全登出／重新登入指引，不以舊props復活工作區。上述不啟用正式分數或簽署，不保留整頁重載的敏感內容。

### 2026-09-28：任務優先的第一批介面

此輪沿用 Finance AppShell 的字型、header/sidebar 幾何、品牌與 runtime tokens，不另造第二套 frame。共用工作入口保留；已授權的「評估量表」與「每日彙整」增加捷徑，其餘完整模組以「全部功能」原生 details 收起，直達模組時展開目前分類，不新增權限或刪除原入口。

評估捷徑進入獨立 `/app/assessments` 選案入口：先選具名個案，再看既有授權量表，不合併或移除原 79 個工作頁。選案沿用共用 ClientSelectionCard 的18px卡片／44px控制，僅擴充同行短錯誤與首錯焦點；切換草稿個案時先隱藏舊案連結。demo 只列九張共用個案主檔合成 ID 的問卷，正式資料仍以伺服器權限及原量表 snapshot 拒絕跨個案。外部結果登錄尚缺安全重試與未保存保護，故不在新入口啟用。此路由不是正式分數／簽署開通。今日工作切換任務卡保留本機搜尋，任務數字使用同一搜尋結果；「查看全部」才明確清除搜尋、班別與待指派。Finance 外框不變。

今日清單以姓名、班別、三項短狀態與下一步呈現；完整分工保留於可鍵盤展開的 details。個案中心以搜尋／名單優先，完整篩選與統計分別收起；所有 GET 欄位仍送出，既有查詢、日期與責任範圍不變。SearchField 新增具名 local controlled 變體，只篩本機授權名單，清除立即生效且保留班別／範圍，不取代預設 GET 搜尋。

九份題目式工具先顯示同一 ClientSelectionCard、日期、人員、完整題目；一般說明／来源／歷史置後或收起。草稿、未啟用正式分數／簽署、保存未知／待讀回與可行動回查仍在主畫面，不以視覺簡化解鎖臨床能力。收案五步卡桌機等比例、自然高度，520px 以下改單列可橫向捲動並露出下一步；點卡後捲至同頁工作表單，不改個案或資料。待查看不是完成，缺項來自正式 profile 而非點擊歷程。選案列統一 16px 輸入、44px 控制，保留原18px卡片例外；收案主要操作採既有 --brand-strong 白字的具名對比例外，Finance header 不改。

今日清單、個案清單與量表內容区的主要操作也沿用 --brand-strong 白字具名對比例外（5.02:1）；header 保留 Finance 亮橘背景、位置與幾何，登出文字採深色的局部對比例外。原生 select／date／file chooser 與 details 接受平台 popup／鍵盤行為，不宣稱系統 popup 像素一致。合成資料瀏覽器驗證、本機測試與靜態稽核不是正式部署、真人 usability、完整 WCAG、hosted 寫入或89頁完成功能的證明。

### 2026-10-02：表單入口簡化候選

九份題目式量表共用單一編輯器：已選個案以「個案／更換個案」短列取代常駐選案卡，切換仍走原表單及未保存保護；未選個案時保留原選案卡。量表名稱、日期與記錄人員後直接顯示完整題目和選項；施測說明放入可鍵盤展開的 details，個別題目提示與臨床安全警示仍可見。作答進度以螢幕閱讀器即時區及題目之後的可視摘要呈現。展示資料明示不可保存或簽署，不冒充真實個案。讀取錯誤顯示重試，撤權仍須遮蔽資料；不得把兩者混成同一狀態。

收案五步保持同一資料與驗證，只將目前步驟和基本資料缺項縮成一行行動入口；完整缺項仍在基本資料步驟。臺北市 A／B／C 保留「僅存草稿／尚未簽署」可視告知，版本、D 表範圍、原表頁碼及 C 表來源詳情可展開；C 表的實際執行來源限制維持可視。這些是內容密度和順序的局部調整，沒有改題庫、公式、API、權限、附件掃毒、Finance 外框或正式簽署條件。表單仍須真人及 hosted 驗收，不因本機展示版可操作而宣稱可營運。

### 2026-09-28：連續操作與欄位提示切片

不改 Finance header/sidebar、色碼、字型及 frame 幾何。ClientSelectionCard 的補充文字改為自然換行，手機不再截斷「已保存／待核對」；保留18px卡片、108px最小高度、16px欄位及44px控制，不宣稱不同內容有相同固定高度。

出勤、生命徵象、照顧日誌共用 `core-care/daily-form-validation.tsx` 的同行錯誤、首錯焦點與中文組字保護。內容區沿用現有 `.field`／`.core-dialog`；`daily-composer.module.css` 只擁有這三張表單的不可拖曳 textarea 及等寬、有界 footer 按鈕，pending不換寬度。native select／datetime-local接受平台popup例外，noValidate後仍以既有schema及API驗證；沒有簽署或角色的新權限。

`ModuleLoading` 是原導覽回饋的唯一owner：transition 的視覺顯示延後150ms，快速完成便不出現大畫面，inert、寫入保護及可安全登出立即生效。初始fallback即時顯示；不加最低等待、不新增JavaScript導覽計時器。Reduced-motion 保留原靜態bar，不加入新進場位移。

預計名冊的重新讀取沿用既有 inline status、busy 及 tab-local view/write lease；不得在原筆保存未知時重載。查詢期限是伺服器資料owner，不用動畫假裝資料已更新。實際本機Chrome的桌機／390px、before/after及權限／錯誤測試見 `docs/SMOOTH_CONTINUOUS_WORK_READINESS_2026-09-28.md`；該切片尚未遷移native未保存確認，後續每日確認切片另行驗收。hosted流程、Safari／輔具及全站效能仍須獨立驗收。

- 送審成功不是正式評估已完成；已採用也不等於臨床簽署能力已開放。
- 待審不能顯示「已由」；僅真人完成的核准事件才是核准證據。
- 不把別的分支、展示資料或資料庫服務密鑰拿來補載入失敗。
- 既有畫面存在 native confirm／validation bubbles 等差異，列為後續 migration，未以文件替它們宣稱合規；本次新區段不用這些模式。

### 2026-09-28：登入與載入復原切片

首頁的今日照顧、排班、應到名冊在同一已授權context後並行讀取，名冊仍沿用原Suspense／inline狀態；不增加另一個loader或改Finance frame。共用route error沿用既有centered-page／empty-card／button幾何，短標題「目前無法載入」，保留原reset重試，不宣稱寫入未送出；已送出者須核對原筆，不新增第二笔。只有`.route-error .button--primary`採現有`--brand-strong`配白字的具名AA對比例外，沒有新色碼／字型／radius，也不改header/sidebar。

此輪Auth、分支及Proxy期限屬伺服器read owner，不能用視覺變化冒充身分授權成功、保存完成或正式p95。即時傳輸／5xx與逾時不以「未登入」回條處理；真正缺少／無效session、AAL及資料範圍政策保持原邏輯。測試與發布邊界見`docs/SMOOTH_AUTH_READINESS_2026-09-28.md`。

### 2026-09-28：每日記錄確認切片

出勤、生命徵象、照顧日誌的編輯與未保存離開確認沿用同一GovernanceDialog；欄位保持掛載，捨棄確認出現時先關閉編輯模態，取消則帶原內容回到編輯器。CoreDraftConfirmation只提供「繼續填寫」與明確捨棄；不新增toast、frame、巢狀模態或原生confirm。取消／Escape／背景關閉不是保存也不是捨棄。原有離線裝置草稿刪除與其他尚未遷移工作區不在此切片範圍。

日誌送審、簽署、更正及退回修改各自呈現原個案、紀錄版本及操作後果，確認前不送出。未保存輸入由同一guard擁有，送出中或結果未知不能当成可捨棄草稿；原筆回查與明確重試仍分開。沿用16px欄位、44px操作、noValidate／同行錯誤／首錯焦點、中文組字保護、不可拖曳textarea及原生日期／選單平台例外。不改Finance header／sidebar字型、幾何或runtime tokens。

讀取與內容解碼共同期限是請求owner的安全邊界，不是loading動畫或正式效能承諾。逾時與取消不能表示資料庫未寫入；晚回覆不能清空新畫面或解除原unknown。工作區未提供完整登入／機構／分支來源generation時不假稱全context防護；本機測試與合成Chrome證據不代替hosted保存、真人簽署、完整重載復原、全89頁或人工WCAG驗收。
