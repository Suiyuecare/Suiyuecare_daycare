# 題目式量表：本人原操作唯讀查證候選

本輪新增工程候選仍未推送GitHub、發布Vercel或升級正式Supabase。範圍只包含九份題目式工具草稿的原操作查證；不是正式計分、簽署、來源採用、89頁完成或營運許可。前台完成檢查另見[已保存量表前台候選](QUESTIONNAIRE_READINESS_UI_2026-09-27.md)。

## 問題與解法

保存逾時可能是伺服器已寫入、瀏覽器卻沒有收到結果。最新清單沒有列出一筆資料，不足以證明未保存；不能因此換識別碼新增。查證介面只讀本人原識別碼，核對不可變操作帳本、原結果版本與原請求內容，並再次檢查當前權限。

查到完整原證據才表示「該草稿已保存」。`not_found`只表示本次讀取未取得已提交證據；可能仍在提交中，也可能已回滾，兩者都不授權換鍵、修改重試內容或解除未知操作。查到原保存亦不表示最新列表已更新、正式結果完成或風險已確認。

## 契約

- `GET /api/questionnaire-assessments/receipt`不接受query、body、替代操作鍵或非零內容長度。機構、分支、個案、量表、action、原鍵與nonce使用限定headers，登入人只能來自真正登入context。
- 真正已核准Google員工可依原AAL1例行量表讀取政策查本人原筆；仍需`clients.read`、該表read、有效機構／分支／session及個案指派。不以護理簽署的AAL2政策誤擋草稿查證，也不授予manage、sign或新驗證證據。
- SQL只查原actor＋key，不呼叫寫入／重播、不取原寫入advisory lock。原request/content使用既有PostgreSQL JSONB雜湊算法重建，create原baseline為null／null／0，revise綁原previous鏈；不同新評估或較新修訂不取代原證據。
- 回傳固定`committed`或`not_found`結構，包含完整範圍與nonce、查證時間及非展示狀態。命中後壞hash、內容、作者、狀態、鏈或receipt不降為`not_found`。原`committedAt`保留時區字串並與資料列比較同一時刻，不重新改寫歷史。
- 最小查閱稽核不得記錄答案、context、key或nonce；稽核等待後再次查權限與原來源。API包含解碼的20秒獨立上限，失敗用固定訊息；敏感結果private/no-store，不回傳堆疊或供應商原文。
- 原POST正規化機械抽成共享純契約：UUID小寫、不適用原因及補充文字trim、空context省略、測量字串與原日期／選項限制不變。重試仍保存原wire body；原證據核對正規化語意，不能重寫原body或借用候選計分核心。
- 原actor＋key使用既有唯一索引，未新開資料表讀取權限；函式固定search_path、公用wrapper為invoker、私有guard為definer。更新有5秒鎖等待與30秒statement限制；既有writer、權限predicate及27份原規則／驗證／組合catalog bytes不變。
- 舊資料若有不符合嚴格完整性規則的作者名稱、前一版或內容，會回不可確認，不降為「查無」或解除unknown。原毫秒以下精度保留：parser逐字核對原時間字串並以微秒比較，不拿JS毫秒等值代替精確原證據。

## 驗收狀態

2026-09-27本輪實作與獨立唯讀安全審查完成，未發現阻擋項。這是147份migration下的新本機證據，不引用前輪146份作為新增介面的完成證明。

| 驗收 | 本輪結果 |
|---|---|
| 完整程式回歸 | 544檔／8,706項通過；原有1檔／1項條件式跨Finance測試仍skip，非Finance hosted驗收 |
| 完整portable SQL | 147份建立成功；136套／6,425斷言；93套既有PGlite-only admission fixture、43套真predicate。兩者不能混稱真實Auth驗收 |
| 原生PostgreSQL | PG17.11全17套通過，每套套用精確147份；新介面62項pgTAP、九表create／revise實際RPC→Node parser及UTC／臺北／紐約原時間字串一致 |
| 真實獨立backend競態 | 原寫入未提交時查無→原transaction commit後查到／rollback後仍查無；查核不取得寫入lock。audit等待時撤個案指派、Google、分支、session、read權限均42501；原source改動23514，無payload且失敗audit回滾 |
| API期限／回覆 | 52項測試含本人AAL1無manage／sign、原nonce／範圍、provider忽略取消、auth／server／RPC卡住、owner abort、壞proof及晚回應；自有abortSignal與獨立20秒race，固定安全錯誤 |
| 工程檢查 | 零警告lint、完整型別、production build、production dependency audit均通過；兩份strict靜態UI audit零finding，不等於正式CRUD或native confirm已遷移 |
| 實際建置HTTP | 只在127.0.0.1啟動；匿名完整receipt401、壞headers／query400、POST405、原readiness401皆private/no-store。匿名量表頁HTTP200僅streaming登入導向，沒有editor；未測真人成功或hosted新增介面 |

新SQL的corruption測試只在隔離合成資料庫、superuser fixture中暫時關閉append-only trigger以模擬既有資料損壞，交易回滾／復原後再驗證；未在正式或寫入政策中移除guard。獨立backend競態不替換Auth／業務predicate。真實員工登入、正式DPA／PITR與完整HTTP多人壓測仍未驗收。

證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-20260926/`，本輪`questionnaire-operation-receipt-{vitest,database,native-all,lint,types}.log`、`questionnaire-operation-receipt-production-http.json`、兩份`questionnaire-operation-receipt-premium-*.json`。最終聚合原生新介面證據：`/tmp/daycare-questionnaire-operation-native.zVtf20/evidence.json`；各所屬PG data已停機安全清除，log／證據保留。本機3187也已停止，未碰使用者Chrome或部署。

## 仍未完成

本輪不接前台unknown復原按鈕，也不建立跨重新掛載journal、POST解碼硬期限或共享確認遷移。這些是下一個獨立切片；不能因有GET便宣稱現場unknown已完整解決。完整重載／關閉瀏覽器／登出後的原筆定位仍需伺服器端設計，不把個案內容存進localStorage或history。

雲端授權、區域及方案決定、真正員工驗收、CMS封存／掃毒、完整正式量表、官方申報、Finance同店金額、實際備份還原、50人HTTP、安全及人工無障礙門檻維持[正式清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。不新增費用或移動資料區域。
