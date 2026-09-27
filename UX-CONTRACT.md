# UX Contract

## Product context

臺灣日照機構工作台，繁體中文 `zh-TW`、`Asia/Taipei`、西元日期，目標 WCAG 2.2 AA。視覺依據為 [DESIGN.md](DESIGN.md) 及使用者的 Finance 畫面。此次契約落地範圍是頁 82 的新增題目式規則治理、頁 49 的申報驗證安全重試、頁 19 的人工身體觀察原筆回查、頁68公告讀寫與店務摘要有界定時讀取，不宣稱其他流程已遷移。

## Business-context sources

| 領域 | 權威來源 | 類型 | 核對日期 |
|---|---|---|---|
| 固定機構／分支／Google 員工及近期驗證 | `src/app/api/questionnaire-rule-reviews/route.ts`、`questionnaire-rule-retirements/route.ts`、`docs/PRODUCTION_GATES.md` | API／產品門檻 | 2026-09-26 |
| 七鍵、獨立核准、不可變採用／退休 | `rule-review-contract.ts`、`rule-retirement-shared.ts`、`docs/QUESTIONNAIRE_RULE_GOVERNANCE_2026-09-26.md` | Domain contract／增量 SQL | 2026-09-26 |
| 重試與跨分支保護 | `client-fetch.ts`、`pending-operation-lock.ts` | 共用實作與回歸測試 | 2026-09-26 |
| 保留／刪除 | `docs/PRODUCTION_GATES.md` | 原計畫門檻 | 2026-09-26 |
| 財務／法遵 | `docs/RELEASE_READINESS_2026-09-26.md` | 未通過門檻 | 2026-09-26 |
| 申報驗證 | `claim-validation-client.ts`、`api/claims/validate/route.ts` | API／完整回執契約 | 2026-09-26 |
| 店務摘要 | `store-overview/snapshot.ts`、`store-overview/access.ts` | 伺服器授權與來源驗證 | 2026-09-26 |
| 人工身體觀察 | `body-assessments/parser.ts`、`api/body-assessments/route.ts` | 固定範圍／版本／簽署回執與 API 授權 | 2026-09-26 |
| 九份量表已保存版完成檢查 | `questionnaire-assessments/readiness-source.ts`、`readiness-client.ts`、`readiness-view.ts`、原只讀API／RPC | 嚴格來源、純共用候選、正式阻擋契約 | 2026-09-27 |

業務政策引用來源，不在 UI 中另定臨床角色、費用、資料保留期限或法律認定。本次不處理付款、刪除紀錄或真人規則核准。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | 原生 select＋`.control` | DESIGN.md | native；平台 popup 可接受 | 元件鍵盤＋窄版瀏覽器 |
| Date | 治理：格式提示 text input；店務／身體／公告／護理／轉介：native date／month／datetime-local | API 七鍵契約／period schema／body parser／announcement date／referral parser | typed YYYY-MM-DD；native 具名例外 | 閏日／順序／first-error／原生鍵盤與手機 |
| Form | `governance-dialog.tsx`＋各流程的嚴格 client 契約 | API＋本契約 | review／retirement／claim validation／body signature／announcements／nursing／referrals | validation、unknown retry |
| Scrollbar | `src/app/globals.css` | DESIGN.md | 穩定 gutter | computed style＋forced-colors |
| Toast | 共用 dialog 的持續 inline status／alert | 本契約 | success／error | live region test |
| CRUD | `questionnaire-rule-workspace.tsx` | Domain contract | stay-inline／cursor load-more | state／full-flow tests |

原規則治理無 bulk selection、search 或硬刪除。公告頁的搜尋沿用下述共享 owner，不新增硬刪除。

## 公告全量搜尋與即時分頁（頁68）

權威來源是 `staff-announcements/query.ts`、`snapshot.ts`、`projection.ts` 與增量 migration `20260926094309_staff_announcement_paged_snapshot_v2.sql`；2026-09-26 核對。既有 API／mutation RPC、角色與 AAL2 規則不因分頁變更；當頁成員資格不是寫入授權條件。

搜尋欄唯一 owner 為 `ui/search-field.tsx`；套用方式明示為 GET 手動送出，不是打字即查詢或 debounce。X 清除立即提交空關鍵字、保留狀態／筆數並回第一頁。120 Unicode 字元上限由 UI／伺服器驗證；不截短、trim 或將 `%`／`_` 解作 wildcard。IME 組字 Enter／清除不發查詢。超長保留輸入，錯誤關聯輸入且聚焦。手機搜尋獨佔一行，輸入16px／44px，原生 select 使用同一 field owner與平台選單例外。

伺服器先確定可見範圍再搜尋、計數與分頁；清單是符合篩選的總數／起訖，上方卡片為全部授權公告統計，兩者明示不同口徑。20／50／100筆，超出尾頁回最後合法頁。前後頁與收件明細由 `NavigationLink` 保留查詢；重新套用清除舊明細與頁码。不用本地100筆假装完整查詢。

收件明細透過獨立的目前發布版 owner回傳，不能因不在當頁而拒絕，也不能讀跨分支／舊版／非管理者明細。每次 audited bundle重新檢查權限與內容，變動時整筆拒絕回傳並回滾查阅紀錄。UI分開顯示條件錯誤、載入失敗、授權空資料與查無符合資料；不填入展示資料。

這是即時 OFFSET分頁，不是跨頁固定歷史快照；多人新增／改版時下一頁可能移動，不能作為七年移轉或不可變匯出證據。公告寫入採下列共享控制器與journal；合成瀏覽器只送記憶體假API，不替代真正員工 Auth／hosted RPC驗收。

## 公告固定原操作與共享確認（頁68）

`staff-announcement-controller.tsx` 是表單、確認及原操作回查的唯一owner；row actions只提供入口。`staff-announcements/pending.ts` 在同一分頁記憶體保留凍結的內容、機構／分支／使用者、來源公告鏈及版本、操作鍵、privacy與authority epoch；AppShell觀察全域權限變動並在登出同步清除本journal。不同使用者或範圍不可看原內容；遲到回覆不得跨範圍或權限ABA變動填回。

草稿、發布、撤回及已讀共享既有無資料 navigation lease，首次送出前固定內容及操作鍵。timeout、壞回應、錯鏈／錯版2xx皆結果不明；重新掛載不自動POST，只能以原內容與鍵明確手動重試。第一次已知未保存的拒絕可釋放鎖並在表單內顯示可處理錯誤；曾結果不明後的4xx不能證明前次沒保存。未送出修改使用既有useUnsavedChanges；中文組字不誤送出。已送出的未知操作不能捨棄；「回待確認清單」只是關閉原內容視窗，仍保留回查入口、原鍵與離頁鎖，不是取消操作。安全登出仍可由共用入口清除該分頁內容。

來源欄位使用標籤、inline error、noValidate及first-error focus。公告日期沿用native datetime-local，嚴格驗證台北分鐘與合法西元日期，不自建calendar；有偏移來源時間先驗證再轉台北顯示。新草稿到期設定須明確選擇；新版理由必填；已失效對象須明確取消而非靜默遺失。排程未發布不可提前已讀，過期草稿不可發布；送出時再次核對即時權限與近期AAL2，UI不替代API／RPC授權。

GovernanceDialog維持取消初始焦點、44px按鈕、16px輸入、textarea不拖曳、未知內容唯讀。關閉先回可用觸發器；原入口停用或消失時回同區段anchor或此owner明確傳入的回查區段，不搜尋別的模組、不落到BODY。未保存確認不與原表單疊成巢狀modal。

成功回條只建立無內容的待回查標記，保留原操作鍵及精確來源／結果版本。router.refresh不是清單更新證明；分頁缺列也不是證據。相同範圍的有效新快照須有同鏈更新版或本人在原release的已讀時間，才解除相關操作防重送並顯示「清單已確認更新」。

R1原操作查證的權威來源是`receipt.ts`、`/api/staff-announcements/receipt`與migration `20260926105727_staff_announcement_operation_receipt.sql`。使用者明確按「查證原操作保存」才做一筆有界GET；不自動POST、重試、刷新或清空待確認寫入。鍵與nonce放header，不放URL；登入、原動作權限、目前機構／分支、本人原鍵、来源及結果版本逐一核對。發布／撤回仍須近期AAL2及原有效驗證證據。只讀原不可變operation/version/read-receipt，僅新增查閱稽核；舊發布版被替換或撤回不會拿新版回條補位。effectiveAt是原業務時間，recordedAt是帳本記錄時間，verifiedAt是此次查證時間，不叫交易提交時間。

R1查證成功顯示「原操作保存已查證；清單仍需更新」，**不**解除舊來源防重送或假稱清單已更新。not_found、403、逾時、錯格式或錯綁回條保留原標記並允許再次手動查證；權限ABA、換分支、卸載或登出後晚到結果無效。查證與公告寫入互斥，沒有新增modal／表單owner，沿用既有按鈕與公告回查區段。

目前最多32個待回查標記；R1已能獨立查證歷史release與篩選外公告的原成功操作，但尚未提供最新同鏈來源定位，且不清空舊來源guard，因此仍可能達上限。結果不明的寫入尚未有payload-bound唯讀查證；完整重載／關閉瀏覽器也不能還原記憶體journal。這些後續復原與真人hosted驗收仍是正式上線門檻，不能用缺列、较新版公告、提高上限或放寬授權冒充完成。

## Flow ledger

| 作業 | Pending | 成功與目的地 | 失敗恢复 | Focus | Source |
|---|---|---|---|---|---|
| 載入量表歷程 | 有界載入，舊資料標示非最新 | 固定原分支與量表 | 重試；不可補假資料 | 保留選擇控制 | review GET |
| 送審／核准／退回／撤回 | 顯式確認，按鈕防重複，不樂觀成功 | 完整回執才顯示成功，原列表重新載入 | 保留內容，錯誤在 dialog | 關閉後回原 trigger；原控制已停用則回區段標題 | review POST |
| 退休 | 顯示原期限、申請截止日與原規則 | 完整退休回執，重新查歷程 | 不改原採用日期 | 同上 | retirement POST |
| 結果不明重試 | 原 input、原 UUID，禁止編輯／換量表 | 原始事件回執，不推定今日狀態 | 不自動換鍵；提供人工回查路径 | 留在 dialog | API 冪等契約 |
| 載入更多 | 真正 paired microsecond cursor | 每批最多 20 件，顯示總數 | 已有資料保留，不重複追加 | 保留 control | GET cursor |

## Navigation and responsive behavior

保留 page 82 標題／metadata／AppShell；量表選擇本次為管理區段暫存狀態，不放入 URL，避免和既有 page 82 篩選及 server remount 相互影響。這是明示的 architecture override；關閉後不承諾歷程游標 restoration。歷程項目同一語意 list 在桌機與手機 reflow，不重複兩個 DOM 操作入口。

載入失敗、無權限與無資料分開呈現；不將 403 當空清單。可見技術資訊均有非 hover 的 details 入口。無新 sticky actions；所有表單欄位均能自然捲動到。

已發送且結果不明時，支援 Navigation API 的瀏覽器阻擋可取消的同文件歷程返回；不可取消的 traversal 以原 entry index 回復，不寫入或修改 history payload。沒有 Navigation API／可信 index 的瀏覽器只能提供 beforeunload 警告，不能宣稱所有瀏覽器的返回都可攔截。整頁離開仍可能清除記憶體中的操作內容，禁止藉此自動重建新操作。

## Overlays and feedback

`governance-dialog.tsx` 使用 app-owned 原生 `<dialog>.showModal()`，由 top layer 提供背景 inert 與焦點隔離，取消初始焦點。忙碌時取消停用，若焦點因停用控制落到外部則回彈窗標題；關閉回可用 trigger，原控制停用則回所屬區段標題。重要操作不靠點 backdrop 自動確認；未送出時 Escape 等於取消，已發送／結果不明時不因 Escape 遺失原操作。不同送審及退休動作共用這個 owner，不巢狀 modal。

noValidate、文字 inline errors、first-invalid focus；拒絕 IME Enter 誤提交。輸入只保留在記憶體，不用 localStorage、sessionStorage、browser history 保存理由或操作鍵。不引入 toast queue；成功／錯誤維持 dialog inline live region。

## Async and resilience

所有治理寫入 pessimistic，使用既有 20 秒 timeout。寫入內容與鍵在第一次發送前固定，重送不能取目前變更的欄位。503／壞回執／timeout 不明；400／409／403 只有第一次且未曾不明時才能視為已知拒絕；先前可能已提交時保留原操作，不能另建鍵。成功回執不等於最新歷程；重讀失敗顯示「已保存，但清單尚未更新」。

GET 有 AbortController 與 request sequence 保護，舊量表／舊游標結果不得覆蓋新狀態，斷網不排程權限變更。無權限／session 到期停止寫入，展示模式不呼叫正式審核或退休 API。授權由伺服器與 RPC 重新核對，不以 UI 權限替代。

## 申報驗證與店務摘要的追加邊界

申報驗證送出前固定使用者、機構、分支、展示模式、批次、內容與操作鍵。同一分頁的記憶體作業狀態須跨元件重新掛載保留，不放入 localStorage、sessionStorage 或 history；整頁重載只能提出離頁警告，不能宣稱會自動還原。未知結果保留共同操作鎖，同分頁 HTTP 連結（含公司入口）、GET 篩選及可取消的 Navigation API 不能藉離頁建立新鍵。安全登出先清除本分頁作業與它自己的鎖；遲到回覆不可重新放入、清掉其他新操作或替換目前使用者畫面。

已核對成功回執不代表清單已更新；舊草稿仍在時不得再建立新驗證操作。明示只讀回查，不將正式格式、下載或送件顯示為已完成。跨範圍或權限失效的遲到回覆不顯示成功。伺服器及 RPC 的近期 AAL2 與授權規則不因本次 UI 改動而解除。

店務頁僅在前景、連線、非展示、條件有效且沒有共同寫入／換頁鎖時定時讀取。來源時間決定是否最新，`router.refresh()` 完成不等於來源更新；無新來源的重試有界，回到人工更新。斷線後仍需一次完整 no-store GET 重新核對登入，不靠背景重讀恢復顯示舊財務。已送出的 RSC 請求不能宣稱可由客戶端取消；後續排程須停止。所有新請求仍由伺服器重新核對機構、分支及帳號，瀏覽器不直接連 Finance，不保存財務內容。

## 人工身體觀察的追加邊界

本頁仍是非標準化人工觀察，不將文字草稿稱作官方量表或完整體檢。照片與附件尚未配置時維持明示限制；不因本次安全回查而解除正式簽署近期 AAL2。

首次發送前固定操作鍵、個案、版本及完整內容，與申報共用不含資料的 `pending-navigation-guard.ts`，但各自保有獨立 journal／lease；任何 journal 不能清除別的寫入鎖。重新掛載保留原請求，跨帳號／機構／分支／模式不顯示原個案或臨床內容。先前結果不明時，後續 4xx 不能證明前次未保存。安全登出清除該分頁暫存內容並使遲到回覆失效，不使用 localStorage、sessionStorage 或 history 存臨床內容。

已確認回執只建立待回查標記，不能把刷新當作新清單。只有完整、未過期、含原提交版或更高版的同範圍伺服器快照，才能解除重複寫入保護。簽署與更正版共用 GovernanceDialog，取消初始焦點、忙碌停用取消、未知結果提供原筆回查。正式照片／官方表單仍須另外完成，不把本次 scoped 驗收說成整頁最終驗收。

## 未保存人工觀察與分支切換

`unsaved-changes.ts` 只協調 owner，`use-unsaved-changes.ts` 由人工觀察編輯器擁有輸入與確認。改後又還原基準值不再視為有修改；範圍、權限、指派、來源版本及卸載使已排定的操作失效。只有「捨棄填寫並繼續」才丟棄未送出的內容；「繼續填寫」及 Escape 保留內容。來源刷新不自行丟棄同範圍編輯；資料／目的地已變則取消舊確認，要求重新選擇操作。

頂部重新整理、取消編輯、切換／新增評估、簽署其他紀錄、同分頁 HTTP 連結、GET 篩選及可取消的 Navigation API 共用這一入口。不重播 POST，也不以 Navigation API 把 POST 轉 GET；GET submitter 的 method／action／target／欄位內容在明確捨棄前再次核對。新分頁、修飾鍵及不離開文件的 anchor 不算丟棄。命名目前視窗仍是同分頁。未知寫入／視圖鎖比未保存確認優先，不能藉捨棄繞過。沒有支援／不可取消的瀏覽器歷程只承諾 beforeunload 警告，不宣稱全瀏覽器可攔截或跨整頁重載復原。

分支確認移除 native confirm，沿用 GovernanceDialog；先完成未保存確認，再顯示分支確認，初始焦點為取消。確認關閉與清理後，POST 前再次核對目前分支、選項、其他寫入與新未保存 owner。結果不明沿用既有 fail-closed 舊畫面遮蔽／重新載入處置，不重送 POST。登出不要求丟棄確認，先移除全部舊 owner 再清除其記憶體，單一回呼異常不能阻擋安全登出或污染新帳號。

這不是其他量表編輯器的全域遷移，也不取代正式簽署、近期 AAL2、伺服器權限或不可變版本。所有文字草稿仍只在記憶體，不放入 browser storage／history／離線佇列。

## ADL／IADL 草稿答案狀態

完整題目與原計分選項保持不變。只有 API 已允許的 Barthel ADL／Lawton IADL 提供另外的「不適用（需原因）」草稿狀態；不是新的官方分數選項。已保存及歷史版本顯示原狀態、原因，已作答／不適用／未填分開計數。清除答案產生真正 missing，移除舊值與原因，不能轉為零分；合法已作答的零分仍是答案。

不適用原因必填，按伺服器契約以去除頭尾空白後的 Unicode 字元數驗證1–500字，拒絕控制字元。錯誤保留其他內容，aria-invalid／help／inline alert 關聯並聚焦第一個問題；不呼叫 POST。歷史檢視、無管理權限與未知結果均不可編輯；不改原內容／操作鍵重試規則。草稿 UI 不啟用規則、不補正式分數，不代替真人核准。編輯欄位由既有 module CSS 統一16px，保留 compact labels及原卡片幾何。

後續此九份題目式工具工作區已移除兩處 native confirm 與自造歷程 guard，改用共享 unsaved owner／GovernanceDialog；未知写入由原操作journal的navigation guard處理。這是限定工作區的遷移，不把人工觀察或題目式工具的驗收套用到全部89頁。

### 已保存量表完成檢查（九份題目式工具）

2026-09-27接入候選唯讀panel，沿用Finance frame及同頁workspace，只有明確按下「檢查已保存評估」才GET。全context、authority/privacy epoch、表單與個案、來源generation、保存版、hash及nonce共同綁定；不以router.refresh、成功HTTP或新的分數取代原保存證據。AppShell在工作區外追蹤權限與登出；401／403、不可信回覆及來源內容不一致隔離臨床內容，真正較新且仍授權的來源才可重新入場。合法同個案SSR保留原編輯與未知原筆；被動切換不把原答案移至別案。

查核持有自己的短期read fence，不解開任何write unknown。包含JSON解碼20秒獨立期限、可取消及晚callback owner檢查；報告60秒到期，不自動重查。dirty或未知操作不查、不POST、不取得MFA、不確認風險、不簽署。純browser core核對候選結構與分數；九份原canonical bytes／27個hash及server-only核對保持不變。結果永遠formalScore=null、signable=false，四個正式門檻收於details，安全警示不可收掉。

10px內容卡及控制項、16px輸入、44px主要操作；typedDate沿用具名平台例外，inline真實日期錯誤與焦點，單一main、手機與放大後內層不橫向溢位。前一階段隔離Chrome23項、strict scope零finding、完整541檔／8,440項與本機原生全16套通過；該階段尚未遷移native confirm／component-local未知journal，不代表正式計分採用、真人hosted或89頁上線。後續原操作遷移見下節，前階段證據見QUESTIONNAIRE_READINESS_UI_2026-09-27.md。

### 九份題目式工具原操作與共享確認

`pending.ts`為單一分頁記憶體journal，`operation-client.ts`為原筆transport，`questionnaire-assessment-editor.tsx`為工作區owner；AppShell在其他頁仍觀察canonical authority／view epoch，登出先同步清除journal且不得由旧context重新入場。首次写入固定actor、機構、分支、個案、表單、原JSON body／key及來源；重新掛載恢复同一未知原筆但不自動POST或GET。raw body不放browser storage、history、離線佇列；完整重載失去分頁journal，durable定位仍未製作。

初始／重新授權來源須實際60秒內且通過scope與privacy floor。已入場的相同owner／來源可完成超過一分鐘的填寫及原筆回查，不改寫來源時間、不稱作新授權。真正epoch或scope改變、來源撤銷及同generation ABA隔離舊內容；單調floor不因登出而清零。250項不相關scope可被結構容納，但不增授任一表單權限。每次API／RPC仍以真實登入重新授權，不新增MFA捷徑、簽署能力或假職務。

「確認保存結果」只在本人目前未知原操作持有private write lease時取得單一read fence；bodyless／queryless GET以headers傳遞原範圍與原筆定位，所有回條嚴格核對原request、actor／tenant、key、form、版本及微秒時間。not_found仍unknown；首次嚴格未提交拒絕才釋放lease，未知後拒絕不能證明前筆未保存。讀取含JSON解碼獨立20秒期限，mount／attempt／epoch／privacy及晚回覆皆核對。不自動retry、不換body／key、不用router.refresh當成功。

POST201只是薄保存證據，不能單靠它核對完整actor／tenant／answers；正向confirmed guard需歷史中同一原版本、hash、原完整答案／情境與時間才能解除。原版已被後續版取代時以有界before_version窗口取原版，不把最新版代原筆；缺列及截斷不是完成證據。32個confirmed guard及128個private source floor有界且不靜默淘汰；容量耗盡保留安全阻擋。

未送出修改用原共享useUnsavedChanges／GovernanceDialog，取消、Escape及模態外點擊保留輸入；只有明確捨棄按鈕才继续，使用button--danger。未知／讀取／写入中不能藉捨棄繞過。IME不誤送出，typed日期、inline驗證及first-error focus維持；成功讀回若原入口停用或移除，聚焦具名「評估紀錄」，不得搶走使用者已移往其他控制的焦點。單一main、既有16px輸入／44px控制及Finance frame不變。可取消Navigation API沿用共享機制；不支援或不可取消的歷程僅承諾beforeunload警告，不宣稱所有瀏覽器皆攔截。

目前歷史GET不是fresh context／nonce授權復原來源；撤權或不可信回覆隔離後需安全登出／重新登入及核對紀錄，不用舊SSR偽造解鎖。九份工具仍只有草稿及候選完成檢查，formalScore=null、signable=false；正式來源採用、資格證明、真實簽署更正、完整工具與hosted真人驗收不在此切片內。完整證據見QUESTIONNAIRE_OPERATION_RECOVERY_UI_2026-09-27.md。

## Migration and verification

### 人工護理評估（頁51）

權威來源為`nursing-assessments/parser.ts`、`pending.ts`、`api/nursing-assessments/route.ts`及既有護理RPC；2026-09-26核對。保持manual-nursing-v1非標準化文字紀錄、缺值／不適用理由與人工複評安排；不是正式官方量表，計分、附件、匯出、通知與離線服務仍未配置。新增incremental員工開通修正僅對齊已核准且固定機構的員工登入，不放寬護理職務、個案指派、讀寫scope、AAL2或近期簽署要求。

單一workspace是選個案、歷史、文字編輯、簽署確認與回查owner。GovernanceDialog擁有簽署／更正與未保存捨棄確認；useUnsavedChanges擁有導覽語意，pending-navigation-guard只保護已送出未知操作。native select／date為具名平台例外；noValidate、欄位標籤、inline錯誤與first-error focus、中文IME不誤送出、16px輸入及44px控制。新成功／錯誤採持續inline status，不新增toast queue。

`pending.ts`在同一分頁記憶體固定機構、分支、actor、原鍵、完整body及原來源版本／內容。create_draft、revise_draft、sign、correct都共享無資料lease但各自journal不清除其他owner。卸載／重新掛載不自動POST；未知後的403／409不能證明前次未保存，也不能換鍵／修改body。AppShell在工作區外觀察authority epoch；帳號、機構、分支、讀寫權限／AAL、指派ABA及卸載／登出使晚到回覆無效。讀取授權失效即遮蔽歷史及原臨床內容；只有管理權限失效不隱藏仍授權的唯讀歷史。

第一個有結構化拒絕證據、且未曾未知的未提交操作可釋放本lease；未知寫入保留原操作等待明確手動原鍵重試。簽署回條額外核對原草稿內容，不把不同簽署hash誤當作前版hash。成功回條只標保存確認，不是清單更新；完整、有效、同範圍、正向同鏈結果版或較新版快照才能解除原個案防重送。缺列、截斷、過期、router.refresh完成均不是證據。

2026-09-27追加手動GET：`/api/nursing-assessments/snapshot`只使用原授權與有稽核的snapshot RPC，不接收寫入鍵／body、不新增臨床紀錄。工作區「更新授權資料（不重送）」保留唯一原unknown lease，另取得自己的read fence；查詢中禁止另一寫入、重試或換分支。nonce、機構／分支／本人、canonical五段角色／scope／AAL2／原近期證據、來源時間與伺服器can*旗標嚴格綁定。管理者可合法唯讀，不因此取得護理寫入或簽署權限。未來／退步／過期或不可信資料不能替代目前授權；真實時間在資料入場驗證，不用每秒顯示時鐘判定新GET。

GET及body讀取共有20秒上限，可取消；回覆不自動POST、取得MFA、刷新RSC、解除unknown或宣稱原筆已保存。純連線失敗保留尚可合法查看的舊資料並提示不是最新；授權拒絕、壞回覆及同generation指派撤銷遮蔽舊內容並提升來源floor。較新的授權GET可恢復原筆回查，仍只能由使用者明確重試原body／key，伺服器再核對冪等。floor及已接受時間在重新掛載、撤權還原、登出後不退步；舊props不能復活資料。讀取嘗試與override亦綁定發起時的伺服器props來源／loadError；新來源到達即取消舊GET，新權限縮減不能被保留的override遮住。來源generation更新但個案範圍未變不自行丟棄編輯；保存仍須核對編輯發起時的實際版本，不能靜默重定基準。

snapshot GET只恢復已授權資料，不提供原操作保存證據。後續独立`/api/nursing-assessments/receipt`與「查證原紀錄（不重送）」只讀目前本人原鍵；GET不POST／重播／取得MFA，20秒包含body、有自己的可取消read fence，不釋放原unknown lease。完整原body、scope／actor／action／key／nonce及actual admission物件、權限／privacy／capability epoch／發起server props均須匹配。只有完整committed receipt將unknown轉為保存確認，清單仍待正向核對；not_found保留unknown，不能當作失敗或重建依據。授權／壞回覆隔離內容，純傳輸錯誤不偽裝未保存。現有合法讀取可查原過期簽署證據，但不能因此新簽或重播。查證成功入口移除時回到具名回查區段；使用者已移焦到其他控制則不搶焦點。

兩種GET都不提供真正重新驗證取得或scope改變後context重建；完整重載與分頁限制仍是正式門檻。資料庫歷史查證保留原receipt與hash，跨session TimeZone只接受原raw時間與資料列同一時刻；最終權限重查不是直到COMMIT的完整序列化。READ COMMITTED合成native證據不替代hosted HTTP或真人簽署驗收。

登出同步清除本journal及舊editor，不能阻擋安全登出。無browser storage/history／離線佇列，完整重載不承諾恢復；32個待清單確認標記與100個案／50版本有界讀取仍須後續分頁／唯讀定位驗收。這些限制與真正hosted Auth、SQL、50位員工HTTP及人工WCAG完整驗收不得用合成Chromefixture代替。

護理簽署的context時間只使用目前機構／分支／本人、實際同session一次性挑戰取得的四欄唯讀證據；缺少、過期、錯範圍或未來時間維持null。API每次簽署再次查證，不以context快取授權。只新增已核准護理員的範圍化MFA取得路徑，既有CEO／表單治理與通用近期驗證規則不變；一般頁面的登入與權限不因本次擴大。

既有 custom form 工作區是 sibling 比較來源，frame、按鈕、field 與 error vocabulary 延用；旧 native confirm 與 bubble 差異不本次全域洗版。審核與退休 UI 檢查為 scoped 候選，真人核准、hosted HTTP 與正式量表簽署仍是上線門檻。

### 轉介原操作（頁39）

權威來源為`referral-management/parser.ts`、`projection.ts`、`pending.ts`、`reauth.ts`、`api/referrals/route.ts`與原轉介RPC及增量`20260926134208_referral_approved_staff_admission.sql`；2026-09-26核對。前台原操作與共享編輯器保留原風險規則，後續限定修正已核准社工的轉介scope與實際MFA入口；通用登入、權限與近期AAL2不變。四欄證據只在轉介伺服器消費，不複製到全域context。正式hosted尚未套用，不把本機原生開通RED／GREEN說成真人可用；站內queued也不表示外部送達，接收單位目錄／附件／匯出／provider仍未配置。

同一workspace擁有建立、狀態轉換、更正、確認及回查，桌機與手機入口不得各保有獨立操作鍵。首次寫入固定actor／機構／分支、完整原body、key、來源事件及sequence；未知結果、已知拒絕在未知之後、重新掛載均保留原筆。只有第一次有嚴格未提交證據的拒絕才釋放本lease。AppShell在其他頁追蹤authority並在登出同步清除本journal；切換範圍／撤權及ABA使舊callback失效，舊actor的snapshot不得作重新授權證據。

新增作業須有效60秒資料來源與實際server can*旗標／指定個案；context不偽造generic近期MFA時間。已經未知的原筆回查不單因原snapshot超過60秒便永久封鎖，仍以目前範圍、scope、server旗標與個案核對，再由原API重新授權；不可修改原body或換鍵。完整重載沒有durable intent、32個正向清單待確認標記及scope恢復的唯讀定位仍須後續驗收。

成功回條只標保存，不把router.refresh視為清單更新；需同機構／分支、個案、轉介鏈、原確定event／sequence／state及時間的正向history證據才解除原鏈防重送。缺列或較新但沒有原事件的資料不是證據；部分清單內確切包含該原事件可作正向證據，不能由截斷清單的缺列推論完成。

GovernanceDialog／useUnsavedChanges維持同一模態與捨棄owner；只有未送出內容可明確捨棄，未知操作不可捨棄而重建。沿用native select／datetime-local台北時間具名例外、noValidate／inline欄位錯誤及first-error focus、IME不誤送出、16px文字、44px控制及不可拖曳textarea。此次只調整頁39內容區，不改Finance frame。合成Chrome／API假回條、61項domain覆核不等於真人社工、hosted RPC／外部投遞、所有頁面或完整人工WCAG驗收。

必要證據：source lint/typecheck/Vitest/build、嚴格 premium scoped audit、desktop／390px 瀏覽器、鍵盤／模態取消與焦點回復、loading／empty／error／offline／conflict／unknown retries、跨scope壞回執不顯示。靜態報告不能代替真人驗收。

### 心理社會評估與社工服務紀錄（頁28／29）

兩頁新增明確手動、唯讀的授權資料GET回查。只有自己目前unknown原操作持有唯一有效write lease時可取得暫時read fence；不釋放原lease、不POST、不换key/body、不用router.refresh假裝清單更新。機構／分支／actor、nonce、精確filters、canonical角色／scope／AAL2 tuple與來源時間全部匹配才接受；有效canManage／canSign／近期驗證旗標来自伺服器，不從舊SSR旗標補位。查詢中其他寫入／分支切換不可進行，卸載、登出、authority或privacy ABA、filters改變及晚回覆均拒絕。授權或不可信回覆使內容隔離且提升來源floor，舊props重新掛載不能復活；只有純網路失敗可保留已授權舊資料並明示不是最新。GET不取得MFA、不重建已變更的登入context、不提供完整重載durable intent；簽署與正式門檻維持不變。

權威來源為各模組parser、snapshot-contract、pending、workspace controller、原API／RPC與增量20260926141155_social_work_approved_staff_admission.sql；2026-09-26核對。manual-psychosocial-v1保持人工文字評估；社工服務、結果與追蹤是版本化人工紀錄，未製造正式量表分數或外部送達。附加Auth只准已核准、有效機構／分支、職務及個案指派，不改通用Auth、角色上限或AAL2。

每頁單一workspace擁有全部草稿、簽署、更正及追蹤操作；GovernanceDialog與useUnsavedChanges擁有確認／未保存離開行為。native date／datetime-local／datalist為具名平台例外，日期仍經正式schema檢查；欄位noValidate、first-error focus、inline錯誤、IME防誤送出、16px文字及44px操作。只有sign而沒有manage的合法員工不被誤標唯讀；實際API每次仍重新授權。

首次送出固定actor、機構／分支、原鍵、完整body及來源版。未知後的4xx不能證明前次未保存；重新掛載不自動POST／refresh，手動重試只用原鍵／內容。AppShell在其他頁仍觀察authority，登出先同步清除journal；權限／指派ABA、卸載、跨範圍令舊callback失效。同一或更舊generation的個案指派移除建立privacy floor，舊props重掛不可復活資料；必須真正較新的授權來源才可恢復原操作。

成功receipt只證明保存，不代表清單更新；只有同範圍、有效且包含確切原版本／事件、序號、狀態及時間的positive history proof才移除該鏈防重送標記。缺列、截斷、refresh完成不是證據。近期驗證只查本人／機構／分支／同session的真實已consumed事件，嚴格四欄證據、15分鐘及非未來；兩頁SSR只取得boolean，API簽署／更正含replay再次查證，不將模組證據假填全域context時間。

邊界：32個待清單確認標記、有界讀取、完整重載無durable intent；未知鎖下獨立GET已補，真正MFA與scope變更後context復原仍未製作，不以釋放unknown或舊props代替。合成Chrome／mock transport、portable與本機native測試均不是hosted真人登入、正式營運或全站WCAG證明。
