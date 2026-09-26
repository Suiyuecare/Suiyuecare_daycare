# UX Contract

## Product context

臺灣日照機構工作台，繁體中文 `zh-TW`、`Asia/Taipei`、西元日期，目標 WCAG 2.2 AA。視覺依據為 [DESIGN.md](DESIGN.md) 及使用者的 Finance 畫面。此次契約落地範圍是頁 82 的新增題目式規則治理，不宣稱其他流程已遷移。

## Business-context sources

| 領域 | 權威來源 | 類型 | 核對日期 |
|---|---|---|---|
| 固定機構／分支／Google 員工及近期驗證 | `src/app/api/questionnaire-rule-reviews/route.ts`、`questionnaire-rule-retirements/route.ts`、`docs/PRODUCTION_GATES.md` | API／產品門檻 | 2026-09-26 |
| 七鍵、獨立核准、不可變採用／退休 | `rule-review-contract.ts`、`rule-retirement-shared.ts`、`docs/QUESTIONNAIRE_RULE_GOVERNANCE_2026-09-26.md` | Domain contract／增量 SQL | 2026-09-26 |
| 重試與跨分支保護 | `client-fetch.ts`、`pending-operation-lock.ts` | 共用實作與回歸測試 | 2026-09-26 |
| 保留／刪除 | `docs/PRODUCTION_GATES.md` | 原計畫門檻 | 2026-09-26 |
| 財務／法遵 | `docs/RELEASE_READINESS_2026-09-26.md` | 未通過門檻 | 2026-09-26 |

業務政策引用來源，不在 UI 中另定臨床角色、費用、資料保留期限或法律認定。本次不處理付款、刪除紀錄或真人規則核准。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | 原生 select＋`.control` | DESIGN.md | native；平台 popup 可接受 | 元件鍵盤＋窄版瀏覽器 |
| Date | 格式提示的 text input＋正式 input schema | API 七鍵契約 | typed YYYY-MM-DD | 閏日／順序／first-error |
| Form | `governance-dialog.tsx`＋`rule-governance-client.ts` | API＋本契約 | review／retirement | validation、unknown retry |
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

## Migration and verification

既有 custom form 工作區是 sibling 比較來源，frame、按鈕、field 與 error vocabulary 延用；旧 native confirm 與 bubble 差異不本次全域洗版。審核與退休 UI 檢查為 scoped 候選，真人核准、hosted HTTP 與正式量表簽署仍是上線門檻。

必要證據：source lint/typecheck/Vitest/build、嚴格 premium scoped audit、desktop／390px 瀏覽器、鍵盤／模態取消與焦點回復、loading／empty／error／offline／conflict／unknown retries、跨scope壞回執不顯示。靜態報告不能代替真人驗收。
