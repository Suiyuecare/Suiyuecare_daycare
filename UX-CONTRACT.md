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
| CMS原上傳查證與續做 | `imports/operation-locator.ts`、`upload-client.ts`、`upload-pending.ts`、SQL153與既有151續做RPC | 本人精確唯讀查證／不可變來源與分頁記憶體操作 | 2026-09-28 |

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

### CMS原上傳（收案與頁80）

選檔／查證／續做唯一owner是`imports/cms-upload-control.tsx`；button／field／scrollbar依既有globals，成功、錯誤及unknown均用持續inline訊息，不新增modal或toast。原生file picker接受作業系統選單；格式／大小／SHA與錯誤由同一client及實際server檢查。新檔嘗試先清除舊預覽和核對選擇，非法檔不保留先前可核准資料；pending原操作只能重新選相同名稱／MIME／size／SHA，不可換檔或重鍵。取消未開始的新選擇不是取消已提交操作。

每分頁單一記憶體journal保留原actor／機構／分支／模式／目標個案、UUID原鍵與原來源ID、檔案必要metadata；不保留HTML／File bytes，不進storage/history/offline。AppShell觀察authority epoch，登出同步清除本journal與本lease；scope／權限ABA與晚callback無效。實際查證queryless GET只在header帶原鍵，SQL153只讀目前本人原來源及原receipt並稽核。null不是rollback，completed只是source staging；通用模式須151明確續做attach同一batch，不能假造預覽或正式入檔。新session讀取歷史不等於取得新寫入或近期MFA。例行單案核對保持已核准Google AAL1，通用高風險仍要求真AAL2。

client讀取／JSON與每個選檔或上傳stage均有20秒deadline，可取消；原鍵／原檔不因timeout而替換。預覽嚴格綁來源回條與同一scope/epoch；單案有payloadSHA，通用現有preview契約無payloadSHA，只比較實際提供的batch/fileSHA/mapping/fingerprint/count及metadata，不假算JSONB hash。只有可信同源預覽才完成上傳guard，尚需人工逐欄核准與正式交易。preview失敗可只重讀，不重POST。查證拒絕／不可信內容隔離舊資料；沒有真正新context入口時需安全登出／重新登入，不能以舊props復活。

導覽共用pending lock防止切換個案／分支／refresh，自己的手動查證借read fence但不釋放原write lease；安全登出可用。成功入口移除且焦點無可用控制時回本owner anchor，不搶其他控制的焦點。完整重載會失去journal；歷史非UUID鍵的首尾空白／逗號不保證header可傳；一般reparse仍component-local原意圖，跨掛載復原未完成。舊收案approve／profile等native confirm及整體HTTP時限未在此切片遷移。Scoped自動audit及合成桌機／390px不宣稱全站WCAG、封存／掃毒、hosted Auth、正式收案或上線通過。

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

### 員工證照附件唯讀來源（頁72）

頁72的`view=documents`為同頁具名唯讀variant，來源為`staff-certificate-documents/workspace-source.ts`、`snapshot.ts`、第149份來源RPC及第148份附件snapshot RPC；2026-09-27核對。既有CEO證照snapshot成功時保持原workspace，失敗時可獨立進入新授權來源，絕不將新`canManageDocuments`映射成舊writer或例外核准權限。示範資料不讀真附件；無read未取資料、AAL1提供手動身分確認入口，不自動取得MFA。

此切片只查閱：native select沿既有具名平台popup例外，`.field`／`.button`／`.panel`、global scrollbar及AppShell為canonical owner；臺北时间、16px輸入、44px操作、10px內容卡。版本與50筆分頁由GET／URL保存，未選版本不讀附件，不自動展開第一位員工。版號必須在本次授權來源頁內；非法、重複、空值及不支援的舊type／status／q不默默改成全部。選頁會清除已選版本，保留員工；不預取員工資料，不存browser storage，不新增client refresh／toast／overlay。

掃描、獨立人工核驗、版本及資格分開呈現。reserved只表示原預留，不表示原件上傳或安全檢查完成；uploadedAt以「原預留時間」呈現。來源沒有證號／登錄／核验欄位時不補假值；選取版不冒稱永遠最新。資料只代表本次查閱快照，需明確重新載入取得新的授權與狀態。來源及附件RPC以實際使用者入場、目前scope和精確actor／機構／分支／membership／user／key／version／hash綁定；單次SSR來源及選附件查閱共有20秒期限，取消／晚結果不回顯，錯誤不顯示局部或示範fallback。

本切片沒有上傳、核驗、下載、過期終止、原操作journal、provided新版本或服務簽署按鈕；不把唯讀畫面當完整證照工作流程。舊證照管理表單的未保存、驗證、完整重載復原與真正hosted工作仍須獨立改善驗收；不沿用此切片的GET或合成Chrome證據作其通過證據。

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

### 2026-09-28：用藥、收案與附件的操作復原

權威來源：用藥 `action-response.ts`、原 record／verify API；收案 `client-intake/model.ts`、profile／CMS API 與既有 RPC；附件 `client-documents/schema.ts`、lifecycle 與原 API。此切片沒有變更臨床公式、醫囑、簽署授權、掃毒、封存規則或資料庫 migration。

- 用藥同一分頁只有一個原操作 owner，桌機／手機共用。原 body、操作鍵、來源 row／snapshot generation 與本人機構分支固定；送出中不能編輯。未知結果可返回清單但不等於取消，保留原 lease；重新開啟只重試同筆。新來源在未送出前取消舊確認，需再次核對。成功回條與清單更新分開，32 個尚待正向讀回標記達上限時明示停用新筆及安全重新登入指引，不讓第 33 筆按鈕無聲失效。
- 收案基本資料／CMS 核准共用原操作 journal。已保存但讀回失敗只重新 GET；原版本、內容與 source batch 不符時保持原個案 scope／原步驟，不先改選案、切頁或更換 key。重新掛載不自動 POST，未知後的拒絕不能證明前次未保存。未送出輸入沿用共用捨棄確認；未知／已保存待核對操作不可捨棄後另建。
- AppShell 在其他頁面仍觀察用藥及收案 authority。登出先同步清除 journal／內容與 lease，舊 props／authority ABA 不能復活；lease 取得會同步通知其他 owner，因此 CMS、收案、用藥均須取得後再次核對原 state／authority。完整 fetch 與 JSON 有期限，卸載、來源／範圍變動及晚回覆不得更新舊畫面。
- 附件此次是 `ClientDocumentsWorkspace`／`DocumentHistoryPanel` 的具名限縮變體：上傳固定原 FormData／key，已有有效回條後只核對清單，不重送原檔。GET 20 秒、寫入 25 秒均包含 JSON，傳入取消訊號與 generation fence。清單更新失敗收起舊摘要；下載回條驗證設定的 storage origin、個案、文件與版次，55 秒保守到期後需重新取得，未通過掃毒仍禁止下載。

邊界：完整頁面重載、跨分頁或重新登入沒有 durable 原操作復原；附件尚無跨卸載 journal／完整 authority context，類別覆核仍沿用原流程。用藥尚無原 receipt 唯讀查證／可正向解除保存標記的資料來源。沒有新的 Auth session nonce，不以舊 props 代替新登入。真實掃毒、七年封存、正式量表採用、hosted schema／Auth／收支、真人簽署及 50 人並行仍須另行驗收。此切片的本機合成 Chrome 與單元測試不能作正式上線證明。

### 2026-09-28：任務優先介面切片

權威來源維持原 today-work／case-center 投影、query schema、questionnaire form/schema/rule snapshot、client-intake model／journal及每次API授權；本輪不改資料庫、臨床公式、正式題庫、角色或MFA。短狀態不能把無權限／未取得資料當零，不能把部分紀錄當整班完成，舊已簽版不能掩蓋新草稿／待簽版。不同班別只比較該班證據。

AppShell 只從伺服器過濾後 navigation 建常用捷徑，全部既有授權入口保留；模組直達展開目前分類。原 privacy epochs、未保存捨棄、navigation pending、mobile focus trap、登出／清除順序均不變。SearchField local controlled 模式無網路請求，IME輸入不觸發送出；原GET模式保持明確套用、X清除、欄位與分頁語義。

評估捷徑 `/app/assessments` 先依既有目錄權限過濾量表，再讀已授權個案；GET `client` 只能匹配當前名單，不能因直接改網址切入他案。選案沿用 ClientSelectionCard owner；沒選個案的送出顯示短錯誤／聚焦，改選另一個案尚未按開始時不顯示原案卡片。9 份題目式量表保留各自原路由與安全快照；展示版只列共用個案主檔合成 ID 的九張問卷，未知 ID 仍無法進入量表。外部結果登錄元件仍缺穩定冪等及未保存保護，本入口不掛載。手機收案步驟僅視覺改為可觸控／鍵盤的單列橫向捲動，不把已瀏覽當完成。今日工作本機搜尋切換任務卡時保留，任務數與表列同一口徑；只有「查看全部」明確清空搜尋、班別與待指派。

個案中心名單先於可選統計；收起篩選仍序列化原選值，快捷狀態保留日期／查詢／負責人且重設第1頁。沒有今日排程的名單不得稱今日應到；跨scope與權限不足仍拒絕，不用demo補位。

量表先填寫，但回查原操作／保存待讀回置於表單之前。所有完整題目、必填、安全提醒與草稿／尚不可正式簽署保留；來源說明收起不等於規則已正式啟用。收案progress僅表現選定步驟／profile真實缺項，不把visited計為完成；CMS缺封存仍明示原因並停用原檔上傳。未保存離開、未知後原鍵重試及拒絕回條處理不變。

驗證必須包含 desktop／390px實際元件、搜尋清除／GET篩選序列化、date/client/shift連結、native details鍵盤、選案16px與控制44px、unknown回查可見、權限與登出回歸。baseline與candidate均只用同一合成scope；fake transport不作hosted Auth／保存／掃毒證明。10位初次使用者、50人並行、真正200%縮放／輔具與正式資料验收仍獨立列為未完成，不以本機測試代替。

### 2026-09-28：連續操作、期限與表單回饋

出勤／量測／日誌的首次送出由同一 `daily-form-validation` owner 關閉原生氣泡，保留required／單位／範圍／精度、血壓成對及本次觀察條件。錯誤與label／control關聯，移到首錯但不清內容；中文composition與229 Enter不送出。送出中fieldset唯讀，unknown沿用原body／key重試，不能讓新驗證改寫原筆。server schema與授權仍最後決定；離線草稿不因此視為正式保存。該前一切片尚未遷移useCoreDraftGuard的native未保存confirm；後續每日確認切片另行驗收，不以先前證據冒稱通過。

ModuleLoading的150ms只控制視覺揭露，status/inert/登出與操作lease即時生效；完成後立即消失，無最低等待。預計名冊refresh先同步取得共享view lease，blocked write／view、demo／forbidden／offline／hidden均不另讀；確切自身transition完成或卸載只釋放自身view lease，未知write不釋放。

`api/server-read-deadline.ts`只擁有read-only的單次20秒期限，core-care／case-center／care-roster／daily-projection各自涵蓋client初始化、其RPC／query及相依名字查詢。必要signal傳至原PostgREST transport，在每個followup前及await後核對；晚到初始化、分頁、profile及結果不得入場。原client_factory、本人cookie、機構／分支、purpose／interaction、assignment與parser均不變；不cache個資、不用service role、不自动retry、不把逾時變成empty/zero。共用timer在settle清除，abort僅是transport取消，不能宣稱已終止資料庫SQL。

該前一切片的期限不是整個authenticated route的SLA；後續Auth與首頁瀑布改善見下節。其他89頁、正式RLS、hosted登入／寫入、50並行及備份恢復不由本次測試代替。選案補充內容自然換行；不可用ellipsis藏掉已保存待核對，但也不能把自然高度說成所有內容固定同高。

### 2026-09-28：登入來源與並行讀取

權威來源仍為server驗證的getUser、database-owned admission、active_memberships、目前機構／分支、原scope、AAL及護理同session證據；沒有getSession／editable metadata授權、跨request個資快取、service role或新增角色。`getTenantContext`涵蓋client／cookie初始化到相依資料及護理證據的單次20秒owner；getUser與admission先完成，才並行讀assurance／membership，之後並行branch／organization。原branch fallback只能在有效同機構查詢已完成且原條件允許時發生。近期通用AAL檢查也有含context的自身總預算；不造近期時間。

所有owned server fetch合併owner、Request及init訊號，no-store並保留原method／headers／body；取消後不開始下一個fetch、不收晚回條、不寫late Cookie值或移除值。SDK可能自帶重試，不新增自動重試層；owner結束拒絕其後續transport。取消不證明SQL或provider token refresh未提交。快速retryable／5xx auth失敗及deadline expiry回AUTH_CONTEXT_UNAVAILABLE503，不重新導向登入；已知無／無效session仍null，既有admission／membership error拒絕政策不在此輪變更。

Proxy只是可選session更新，不做授權；自身20秒及request signal内完成才套用staged cookies與SDK的cache headers。SDK透過request-local shadow讀到自己已stage的新增分段及移除值，確保刷新後真正session_not_found可清完所有新分段；原request在整階段完成前不變。不可用時保留原request继续原Server Component／API／RLS檢查，不清Cookie或偽造登入，讓登出與簽章webhook仍可到達。下游仍须自已驗證，不以Proxy放行當已授權。

分支GET／POST精確承接上述503；分支lookup另有client與query共同20秒預算，只有成功完整名單中缺requestedID才403。失敗／缺名單503，不發switch cookie；原AAL2與成功Cookieflags、demo及DELETE不變。這是分階段限制，非整端點或整頁20秒。首頁core／roster／expected在已授權context後同時開始且expected只讀一次；頁3／6／46的原authority preflight與原core讀取同時開始，不把未完成或false權限當true。首頁仍先等core／roster才呈現主內容，並非完整獨立streaming或hosted速度達標。

共用route error只陳述無法載入，原reset只重試呈現，不承諾資料未送出或展示不存在的請求編號；未知寫入須先核對原筆。沿用原empty-card與button，route-error按鈕用既有深橘白字具名AA對比例外，不改Finance frame。實際Chrome合成畫面不替代真實Google登入、provider refresh、正式RLS、全部89頁或人工輔具驗收。

### 2026-09-28：每日記錄的未保存確認與日誌操作

權威來源仍為core-care schema、既有API／RPC、CareWriteAttempt、原snapshot及每次伺服器授權。此切片不更改資料庫、出勤判定、量測精度、日誌狀態機、簽署角色或近期驗證。CoreDraftConfirmation／GovernanceDialog擁有三張每日表單與日誌的確認；useUnsavedChanges擁有已驗證GET導覽與安全登出清稿。僅明確確認捨棄未送出輸入後才繼續原操作，取消／Escape保留原值；busy及unknown不是未送出草稿。送出時即刻ref fence不得等下一次React commit才生效。

三張每日表單編輯模態與捨棄確認不能同時在top layer；欄位保持掛載但視窗先關閉，再開確認。取消復原原編輯器及焦點；明確捨棄先關閉編輯器，然後由共同owner檢查scope、revision、允許操作及原GET目標，清理後才接續。安全登出不能被未保存或unknown阻擋。未納入本轮的其他表單維持具名相容邊界，不宣稱全部工作區均已遷移。

日誌送審、簽署、更正、退回修改需對原紀錄ID／版本／狀態及目前可見權限再次核對；確認前與取消後皆零POST。同個案的可見操作權限撤銷／還原與卸載取消舊寫入來源，晚到結果不更新新畫面；props沒有完整tenant／actor／來源generation時不宣稱完整authority ABA或跨掛載原操作journal。草稿編輯的未保存輸入由共享guard保護，更正／退回理由仍維持原欄位owner，不宣稱全部輸入已全域遷移。原attempt未知時body／key固定，新的拒絕不能證明前次未保存。noValidate、inline錯誤／first-error focus、IME組字及原生日期平台例外延用每日表單契約。

withCareRequestDeadline涵蓋fetch、結構化拒絕clone解碼與JSON讀取的同一20秒預算，傳入owner取消訊號，每段await後仍須檢查signal／generation才可有副作用。GET timeout只能稱未取得新資料，寫入timeout維持原筆unknown；無自動POST重試、換鍵、敏感瀏覽器儲存或新增共享write lease。取消transport不是SQL rollback證據。既有離線佇列、原裝置草稿及未遷移刪除確認不變。

三張新增表單的useCareRequestOwner只觀察實際傳入的date／client／shift／demo／enabled／名單及出勤可做動作；變更與ABA取消舊request，原unknown留在既有mounted attempt，切回原可見範圍後才可明確重試，不依新日期重新解釋原body。這不是完整tenant／actor／assignment證據，整頁重載／跨掛載不保證原筆定位。離線capture／saved／retain的既有儲存不是fetch deadline範圍，不把20秒擴稱全保存SLA。

日誌GET明確401／403隱藏舊紀錄、歷程、編輯器及尚未送出確認；原unknown只保留在既有記憶體attempt，禁止POST直到使用者手動GET取得合法來源。純網路／5xx失敗保留未送出欄位唯讀，不清掉輸入，也不將舊資料當成最新；同一工作區提供手動GET恢復入口。最新來源可以恢復已授權操作，不能由GET成功推論原unknown已提交或自動POST。

必要證據為單元／元件回歸、actual changed-source premium audit、桌機與390px真Chrome取消／Escape／捨棄／焦點、日期／個案／班別接續、結果未知原筆重試。完整整頁重載、跨分頁、hosted RLS／簽署、50人HTTP、Safari／輔具與正式效能仍是獨立門檻。

### 2026-09-28：主管分工、每週安排與 A／B／C 表的相鄰切換

主管分工沿用 `CoreDraftConfirmation` 的站內單一捨棄 owner。個案、班別及不適用既有安排的切換，在未送出欄位有變更時須先確認；取消或 Escape 保留原欄位，明確捨棄才切換。有效成功回條只標已儲存，不能直接開放下一筆；相同分工 ID、個案、班別、日期與回條版本在新快照正向讀回後才解除當頁鎖。`router.refresh()` 不是讀回證據，讀取期間持有共用 view lease；未知送出固定原 body/key，換日期不能把舊操作當新筆。Dashboard 以機構、分支、本人、權限及服務日期為 key 隔離元件狀態；真正伺服器授權仍每次重查。成功後若尚未讀回，允許安全離頁但當頁不再送另一筆。

每週安排的固定週表與單日草稿分別保留。換單日日期只捨棄該日未送出內容，固定週表不受影響；重新讀取在 GET 成功前不得清掉任一草稿。兩種操作都使用站內 `GovernanceDialog`，取消、Escape 及 GET 失敗不改日期或清內容。未知 POST 不因 UI 捨棄而換鍵，已確認與衝突仍須依原回條及讀回規則處理。

臺北市 A／B／C 表保留既有正式規則／簽署封鎖，不以草稿冒充官方完成。未送出欄位切表、換月或重新讀取先顯示同一站內確認；結果不明的草稿、審核或匯出仍鎖住原 payload/key，不可切換後另建。第一次收到完整、明確且格式可信的未提交拒絕才可修正重送；畸形回條、5xx、網路中斷或結果不一致保留原操作。401／403 不開放新的寫入，須重新取得授權來源。

此節只描述本機候選行為。真 Chrome 合成頁、聚焦測試與樣式稽核不等於真人 CEO／主任登入、hosted RLS、正式量表採用、89 頁全驗收或正式營運發布；額外的託管方案與 `docs/PRODUCTION_GATES.md` 仍是獨立上線門檻。

### 2026-09-28：裝置草稿刪除確認

裝置草稿的權威來源維持 `src/lib/offline/draft-store.ts` 的機構／分支／本人命名空間、24 小時效期、storage revision compare-and-delete 與登出清除。刪除只影響這台裝置，不能撤銷伺服器已接收或正在傳送的原紀錄。現場確認沿用 `GovernanceDialog`，列表與確認框顯示同一非敏感草稿編號末 12 碼，明示日期、紀錄種類與後果；取消／Escape 不呼叫刪除，初始焦點在保留草稿。確認時固定原 ID 與 revision，另一分頁改動後拒絕刪除新版；忙碌時同筆不可重複執行，錯誤留在對話框。成功回訊僅稱本機草稿移除，不稱正式照顧紀錄刪除或未曾送出。此切片不改離線同步、伺服器冪等及個資本機留存政策。

### 2026-09-28：評估找人與今日唯一待辦班別

評估入口的姓名／編號搜尋是 `SearchField` 的本機變體，只查已由原伺服器授權回傳的名單；不持久化搜尋字，也不新增遠端搜尋或授權。超過 12 位才顯示，結果只縮小原生 `ClientSelectionCard` 選單。選中的選項始終保留在 DOM，避免選單變動暗中選到另一人；若搜尋不符目前選取，原個案表單連結立即隱藏且「開始」停用，直到選取符合結果或清除搜尋。選案提交後仍由原 server 路由核對名單，網址中的個案 ID 不成為授權。

今日工作仍由 `core-care/today-work.ts` 的同一已授權分工與本班證據判定。若同日已排兩班而目前任務只有一個可執行班別，卡片狀態、可存取名稱與下一頁網址直接使用該班；兩班皆可處理時保持明確選班。出勤與需留意事項是日期級，不因唯一班別而改為班別完成。這只是減少一個選擇步驟，不更改簽署、量測、日誌與權限資料契約。

### 2026-09-28：出勤後的工作班別接續

出勤仍是一位個案在同一服務日的一筆狀態，不改成上午／下午出勤。今日清單只在有已確認的唯一班別或人員明確選班時，將班別當作量測／日誌的下一步脈絡帶入出勤網址；出勤按鈕與畫面須明確標示其日期級語意。兩班未選、無排班或直接開頁時不得推定班別；新日誌表單顯示「請選擇班別」且未選不得送出，只有明確選擇才可建立全日草稿。班別 query 不是授權或完成證據，寫入仍依原 API／角色／個案檢查。範圍與本機驗收見 `docs/DAILY_SHIFT_CONTINUITY_PLAN_2026-09-28.md`；不因元件與合成瀏覽器通過而聲稱正式營運已發布。

### 2026-10-02：切換個案與手機量表儲存

每日照顧三步驟只在同一位個案之間保留已選班別；「更換個案」清除班別，避免上一位的上午／下午直接變成下一位的預設值。網址中的班別只顯示為目前工作脈絡，不稱已核定或已完成；無班別時日誌仍須明確選擇。

題目式量表在 640px 以下提供表單內唯一的黏附儲存按鈕，不複製第二個提交入口。`.main-stage` 已保留固定底部導覽的 68px 與 24px 間距，儲存列沿用其捲動容器 `bottom: 0`，不可再加一次導覽高度；文字或數值輸入取得焦點時儲存列回到自然位置，避免短視窗鍵盤遮住正在填寫的欄位。儲存中、未知結果與禁止新筆的原操作邊界不因按鈕位置改變。展示模式只可檢視；合成瀏覽器量測按鈕幾何不能證明正式帳號已成功保存。

結構化照顧日誌的班別與實際發生時間由前端及 API 同時檢查，以臺北時間 12:00 分上午／下午；全日不受半日界線限制。跨日補登不得用填表當下時間冒充照顧發生時間。新本地資料庫 `NOT VALID` 約束擋住日後寫入與修訂的矛盾值，不掃描、回寫或否認既有歷史列；歷史缺班別資料仍需另行清查。任何一層拒絕時，原表單內容與焦點須保留，不能建立半完成紀錄。

### 2026-10-02：收案首步與 MNA-SF 連續填寫

CMS 原檔封存未設定、展示模式或帳號沒有匯入權限時，初次空狀態不顯示不能操作的 HTML 檔案欄與上傳按鈕；有原上傳操作、選檔草稿或來源預覽時，原共用上傳／回查元件仍保持掛載，不能因設定變動而隱藏原操作。可建立個案的帳號在未選案、無未保存或待確認操作時，只顯示一個首屏手動建檔入口；未授權帳號不能用此入口繞過建檔權限。展示模式入口只稱查看畫面，欄位與保存均停用。
原上傳已進入待確認狀態後，即使新上傳因封存暫停，仍可在同一有效授權下唯讀查詢原操作，不能偷偷重送；權限撤銷後查詢也須停用。只有個人無匯入權限時，不得將訊息說成全機構的 CMS 服務暫停。

手動建立待收案個案時，先顯示姓名與機構個案編號兩個必填欄位；其他身份、聯絡、告知同意與備註保持完整但預設收起，現有個案預設展開供核對。收起只影響呈現，不改 profile schema、缺項數、欄位主權、保存 payload 或正式收案狀態；可展開補填。選填欄位驗證失敗時先展開並回焦原欄位，原值不清除。只用同一個正式保存按鈕與原 idempotency owner；未明結果的重試與讀回不變。

MNA-SF 的 A–E 題先呈現，原身高、體重、小腿圍輸入區緊接 F 題之前；欄位值、量測範圍、BMI／小腿圍擇一規則、版本與保存結果均不變。此調整只是題目位置，沒有啟用正式量表計分或簽署。390×560 合成瀏覽器首屏可見 A 題第一選項且無橫向溢出；此證據不替代真人正式作答、授權或臨床驗收。

### 2026-10-02：選案後直達評估表

評估入口沿用已授權的個案清單、原生 ClientSelectionCard 與 GET 選案；按鈕明示「查看表單」，有效選案後以同頁片段定位並聚焦原評估表區段，鍵盤下一步可直接進入表單連結。直接開啟帶個案 ID、沒有片段的網址仍保留原頁面位置；個案 ID 不能代替伺服器授權。表單區在一行顯示個案姓名與機構編號，不再重複兩張個案標題卡；展示資料仍明示不可保存／簽署。這是選案與閱讀順序改善，不變更題庫、計分、簽署、儲存或跨分支權限。

主管今日工作只在分工來源已就緒且有實際例外班別時，於個案清單前呈現「不適用待核對／待指派」數量；具備正式分工管理權限者才有可操作入口，唯讀執行長只見數量，合成展示可操作但不能保存。點擊後展開並聚焦原有分工編輯區。分工表單固定在清單後方；背景刷新若僅暫時無法取得來源，保留未送草稿並鎖住儲存，待來源恢復後再核對；若來源明確證實已無主管權限，停止顯示先前個案細節。同一分工重選不清值，換分工仍須依原草稿捨棄確認。來源不可用時不顯示零例外，也不開放寫入。
