# UX Contract

## Product context

臺灣日照機構工作台，繁體中文 `zh-TW`、`Asia/Taipei`、西元日期，目標 WCAG 2.2 AA。視覺依據為 [DESIGN.md](DESIGN.md) 及使用者的 Finance 畫面。此次契約落地範圍是頁 82 的新增題目式規則治理、頁 49 的申報驗證安全重試、頁 19 的人工身體觀察原筆回查與店務摘要有界定時讀取，不宣稱其他流程已遷移。

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

業務政策引用來源，不在 UI 中另定臨床角色、費用、資料保留期限或法律認定。本次不處理付款、刪除紀錄或真人規則核准。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | 原生 select＋`.control` | DESIGN.md | native；平台 popup 可接受 | 元件鍵盤＋窄版瀏覽器 |
| Date | 治理：格式提示 text input；店務／身體：既有 native date／month／datetime-local | API 七鍵契約／period schema／body parser | typed YYYY-MM-DD；既有 native 具名例外 | 閏日／順序／first-error／原生鍵盤與手機 |
| Form | `governance-dialog.tsx`＋各流程的嚴格 client 契約 | API＋本契約 | review／retirement／claim validation／body signature | validation、unknown retry |
| Scrollbar | `src/app/globals.css` | DESIGN.md | 穩定 gutter | computed style＋forced-colors |
| Toast | 共用 dialog 的持續 inline status／alert | 本契約 | success／error | live region test |
| CRUD | `questionnaire-rule-workspace.tsx` | Domain contract | stay-inline／cursor load-more | state／full-flow tests |

無 bulk selection、search 或硬刪除；不新增不需要的操作。後續需要時先擴充共同 owner。

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

此工作區的既有 native confirm 與歷程 guard 尚未遷入新的 shared unsaved owner，為明示的後續工作；不能把人工觀察的 scoped 確認驗收套用到全部量表。

## Migration and verification

既有 custom form 工作區是 sibling 比較來源，frame、按鈕、field 與 error vocabulary 延用；旧 native confirm 與 bubble 差異不本次全域洗版。審核與退休 UI 檢查為 scoped 候選，真人核准、hosted HTTP 與正式量表簽署仍是上線門檻。

必要證據：source lint/typecheck/Vitest/build、嚴格 premium scoped audit、desktop／390px 瀏覽器、鍵盤／模態取消與焦點回復、loading／empty／error／offline／conflict／unknown retries、跨scope壞回執不顯示。靜態報告不能代替真人驗收。
