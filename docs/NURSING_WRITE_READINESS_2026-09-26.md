# 人工護理評估：本機部署候選驗證

本文件只記錄頁51人工護理評估與其員工驗證邊界。**未推送GitHub、未套用正式Supabase、未發布Vercel；不是全89頁或真人正式作業驗收。** `manual-nursing-v1`仍是人工、非標準化文字紀錄，不提供官方量表分數、附件、匯出或自動照顧決策。

## 已修正

- 原正式員工已核准Google登入、具護理角色與指派，但最新資料庫的護理入口仍只認CEO。本機基線使用真正的合成Auth session／AMR／核准紀錄重現`42501`；新增增量遷移只開放目前核准、釘選機構與有效分支的護理邊界。
- 獨立覆核另重現有效護理員借用未生效主管角色的`view_all`查閱未指派個案。只修正護理專用權限的職務／授權生效時間；未生效角色不擴權，有效主管仍可合法查看所屬分支全部個案。
- 保留原CEO與表單治理的MFA路徑，不修改通用`is_active_user`／`has_recent_aal2`。護理員可進入原一次性驗證挑戰流程；護理簽署額外核對真實同一session、消耗的挑戰、因素時間及15分鐘效期。
- 新增唯讀`nursing_recent_aal2_evidence`；只回機構、分支、本人及原驗證時間四個欄位。伺服器拒絕多餘欄位、錯範圍、未來／過期時間及錯誤回覆。API每次簽署重新讀取，不以瀏覽器時間、AAL旗標或context快取取代授權。
- 首次送出固定個案、完整內容、來源版、使用者與操作鍵。逾時、壞回條、重新掛載及未知後的403／409保留原筆；不自動POST，不換鍵。安全登出先清除本分頁內容與其鎖，晚到回覆不能污染下一位員工。
- 簽署／更正版共用確認視窗；未保存編輯離開前明確確認。帳號、分支、讀取權限與指派改變遮蔽舊臨床內容；A→B→A仍需新授權快照。管理權限移除但讀取仍有效時，保留合法唯讀歷史。
- 清單讀取期間持有自己的共用視圖鎖；保存回条不等於清單更新。只有有效、完整、同範圍且正向同鏈的新快照才能解除原個案重複寫入保護。
- 16px輸入、44px操作、欄位錯誤與第一錯誤欄位聚焦、中文輸入法防誤送出、不可拖曳textarea。修正頁51提示／主要按鈕對比，不改Finance header／sidebar。

## 驗證證據與界線

| 層次 | 本次結果 | 不能替代 |
|---|---|---|
| 完整程式回歸 | 凍結護理來源500檔／6757測試全通過，162.37秒，無跳過；使用精確恢復Finance候選進行跨repo契約；lint、型別與正式版建置通過 | 正式登入、雲端資料寫入與全89頁功能驗收 |
| 完整套件逾時調查 | 初始高併行有兩項既有ABCD測試5秒逾時；單檔11／11、全套降低併行度後通過；未延長測試期限或削弱断言 | 真員工多人HTTP壓測 |
| 最新原生PG17.11護理套件 | 141份遷移、63個SQL斷言；原基線RED／目前GREEN。8組觀察到真backend等待的同鍵、同前版、停權、session撤銷、指派撤銷、因素逾期及MFA證據撤權測試通過；最終證據已取代早期55項版本 | hosted Auth／實際Google或真人TOTP、50人HTTP與正式PG版本驗收 |
| 原生全量套件 | 最終權限時間修正後12／12套通過；護理為63斷言＋8組真實等待；每套僅使用自己擁有的隔離Unix socket叢集並停止清理 | 雲端資料庫升級、PITR或真人OAuth／MFA |
| portable全量SQL | 最終141份遷移、131套／6118斷言通過；93套legacy相容fixture、38套強制開通fixture | legacy fixture不等於真正Auth開通；不替代hosted RLS／RPC驗收 |
| 護理權限與獨立覆核 | 最終護理63／63斷言；141份遷移可編譯；獨立132項相關前後端測試通過，未生效主管與授權不擴權、有效主管仍合法查閱 | 通用權限已放寬；本次沒有放寬它 |
| Chrome合成元件 | 1440px／390px；簽署先確認，未知後403與重新掛載仍同鍵／同內容；成功後舊清單仍鎖，正向快照才恢復；分支ABA遮蔽舊資料；必填失敗0POST，取消／Escape保留編輯，捨棄0POST | 真Next.js RSC完成、正式HTTP、整頁重載恢復或所有瀏覽器歷程攔截 |
| UI檢查 | strict scoped premium audit 0 findings；護理表單Chrome／axe 21項規則通過、0違反、0待人工判定 | 全站WCAG人工鍵盤／螢幕閱讀器與真人臨床驗收 |

本機原生護理證據：`/Users/seniorlifepr/.codex/verification/daycare-20260926/nursing-native-frozen-evidence.json`；完整回歸、建置、UI與資料庫日誌同目錄。第一次手機full-page截圖有離屏合成空白，改以實際viewport與DOM幾何核對，不將該截圖當成頁面排版通過的證據。輸入測試另改用原生選項觸發空內容狀態，避免工具對空字串填寫的行為被誤當成使用者輸入。

第一次portable全量在獨立覆核提出權限時間問題後主動終止；第一次原生全量55項護理版本則被最終63項取代。舊日誌僅留作調查，不冒充最終來源驗收。早期499檔／6756通過加1項跳過的回歸亦已被500檔／6757全通過取代。最後凍結的護理／頁面／API／context／登出及原生清理線路11檔194測試通過；全量Finance跨repo契約、portable與native最終結果均有獨立日誌。

## 上線前仍須完成

1. 32個待回查標記、100個案／50版本讀取上限仍須安全分頁／定位；完整重載沒有持久原操作復原，本次只保證同分頁元件重新掛載。
2. 2026-09-27本機已補保留原鎖的授權資料GET及本人原操作receipt GET，兩者均不重送原寫入。只有後者取得完整、匹配且目前授權的原始證據，才能標示保存已確認；`not_found`不能證明未保存。真正近期MFA取得及範圍改變後context復原仍待製作，不能以暫放鎖或router.refresh繞過；完整本機結果與正式環境界線見下列最新章節。
3. 正式專業／官方護理量表、計分、附件及匯出另行完成；目前人工文字紀錄不得稱作官方量表已啟用。
4. 精準套用未執行遷移、實際核准護理員Google→額外驗證→個案→草稿→讀回→簽署→更正→停權驗收；跨店、未指派及逾期驗證資料外洩必須為0。
5. 完整雲端部署、資料區域、備份還原、持續營運與全系統門檻仍以[正式上線門檻](PRODUCTION_GATES.md)及[正式部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)為準。

## 2026-09-27：手動授權資料回查的最新凍結證據

原unknown寫入鎖旁新增「更新授權資料（不重送）」；它只取得目前授權的資料，不查證原筆是否已保存。保留原內容、原來源版、原操作鍵與private lease；不自動POST、取得MFA、刷新RSC或釋放unknown。正常清單更新也使用同一有界GET與未保存確認。管理者可合法唯讀，但不能因此取得護理寫入／簽署權限。

來源須通過真正journal admission，而不是只有格式正確的個案ID。nonce、機構／分支／本人、canonical角色／scope／AAL／實際近期證據、來源generation與TTL、當前伺服器can*必須一致。授權或不可信回覆隔離舊資料，重新掛載、撤權還原及登出均不倒退已接受的來源時間；純網路失敗只保留仍合法的舊資料並明示不是最新。GET20秒上限含body讀取，可取消；新server props／loadError、帳號、指派或權限改變均使舊GET失效。

獨立覆核重現並修正三個漏洞：保留的GET override遮住同代指派撤銷、新GET被舊畫面時鐘拒絕、server來源變動後晚GET推進來源水位。再次唯讀複核16／16、額外journal／client／GET／渲染119／119通過；不是以削弱撤權或時間規則消除失敗。新generation且個案集合未變不丟棄編輯；保存仍依編輯發起時原版本，不能靜默重定基準。

| 最新驗證 | 結果與界線 |
|---|---|
| 全套Vitest | **527檔／7,672項全部通過，224.14秒，無略過**；單worker、原timeout。`FINANCE_CONTRACT_REPO`精確指定Finance隔離候選；首遍7671通過加1跳過保留作診斷，不作最終證據 |
| 集中與獨立回歸 | 15檔／346項通過，含journal實際入場、read fence、source／authority ABA及既有shared locks；四份独立測試118／118通過 |
| 品質與建置 | 全套ESLint零warning、TypeScript、diff-check、隔離production build通過；101靜態輸出及動態snapshot GET。清空外部配置並關閉demo，未連hosted服務 |
| UI規範 | 專案既有及護理scope的premium strict均0 findings，另有5檔／177項共享UI／規範回歸通過。未改Finance frame／design tokens；官方designmd工具本機不可用，不冒稱本轮designmd檢查通過 |
| 真Chrome合成UI | 1440×1000／390×844：無JS錯誤或水平溢位、16px輸入、最小欄位高46.78px；必填／合成composition事件0POST。lost ACK→拒絕GET→重掛→新GET→明確人工retry共2GET／2POST，兩POST鍵與body完全相同，GET無body／寫入鍵，不自動POST |
| 撤權與晚回覆 | 無效GET跨重掛仍隔離，讀取期間不能重試，branch／authority ABA晚GET或寫入不顯示舊內容；只有正向同鏈新資料解除清單防重送。這是實際React／CSS／dialog＋假loopback HTTP，不是hosted RLS／真Google／正式持久化 |
| 自動無障礙與局部複核 | 8狀態均0 axe violations；7狀態0 incomplete，手機簽署有1條color-contrast incomplete／5節點，原報告保留。另核對五節點均不透明黑字／白底、21:1，文字range中心均命中自身且位於可見modal內，viewport截圖可讀；不把這稱為axe全數通過或全站人工WCAG |
| 真Next正式版本機啟動 | 未配置且匿名的護理GET實際回503／SERVICE_NOT_CONFIGURED、data=null、private/no-store；Chrome登入內容正常、無overlay／JS錯誤，未配置Google按鈕停用。不是hosted401／403、真人登入或實際RLS證據 |

私有原始證據位於`/Users/seniorlifepr/.codex/verification/daycare-20260926`：`nursing-recovery-{focused,full-vitest-with-finance,lint,typecheck,build,premium-commands}.log`、`nursing-recovery-premium-{project,scoped}.json`、`nursing-recovery-production-denial.json`與`nursing-browser/{verification,axe,contrast-review}.json`及viewport截圖。早期錯環境或失敗原始報告不刪除、不冒充GREEN。

本輪SQL未變，仍143份migration；既有原生／portable結果只適用其當時來源，不稱本輪重新執行。没有GitHub push、Vercel公開預覽／promotion、hosted DDL、正式帳號開通、區域移轉或新增費用。前列的精確receipt、真正MFA／context復原、完整重載與有界分頁仍須完成；本機切片通過不解除正式部署門檻。

## 2026-09-27：本人原操作唯讀查證（後續候選）

unknown回查區段增加「查證原紀錄（不重送）」。它呼叫獨立`GET /api/nursing-assessments/receipt`，不帶body、不POST、不重播寫入、不取得新MFA。授權資料更新與原紀錄查證是兩個不同動作；取得新的清單不代表原筆已保存。

資料庫只查目前`auth.uid()`本人的原操作鍵；機構、分支、個案、四種action與目前讀取權限一致，且查詢前與稽核等待後重新驗證。資料庫／API／browser journal依次驗原request、版本鏈、內容hash與完整receipt；browser再綁定凍結原body、來源admission物件、nonce、帳號／權限／privacy／capability epoch及發起時server props。仿造handle、同generation撤指派、跨分支ABA、新來源及卸載後晚回覆均不得確認。GET使用自己的可取消read fence，查詢期間禁止重試或切分支；取消不釋放原unknown寫入鎖。

- `committed`只有完整正向證據可將原unknown轉為「保存已確認，清單仍待核對」；不自動刷新清單／POST，不因receipt解除同個案最新資料防重送。
- `not_found`只表示這次沒有讀到已提交且匹配的證據；原交易仍可能在進行中，保留原鍵、內容與unknown，不能改鍵或重建。
- 現在仍有合法讀取權限的人，可查自己先前已完成的簽署，即使其原15分鐘簽署驗證已過期；此歷史證據不能簽新紀錄或允許過期重播。
- 授權／格式／原body不匹配使舊內容隔離，重掛不能復活；純傳輸失敗保留仍合法的原操作並提供再查。成功焦點回到具名回查區段，使用者已移往另一控制項則不搶焦點。

新增第144份增量migration。舊版hash由session TimeZone產生，查證不得改寫原證據；只有原時間字串具嚴格offset並與資料列同一時刻，才用原字串重建完整歷史hash／receipt。錯誤時刻、額外欄位、錯request／hash仍拒絕，沒有改寫已簽紀錄。

本機驗證、瀏覽器與凍結來源的最終結果記錄於本章後續驗證表；正式hosted Auth／PostgREST／真正员工操作、雲端DDL、全89頁與人工WCAG均不由合成資料替代。最終授權重查不是持鎖至COMMIT的完整權限序列化；原生撤權競態證據適用READ COMMITTED，不宣稱REPEATABLE READ即時性。32標記、100個案／50版本、真正MFA／context復原與完整重載intent仍是未完成門檻。

| 本輪最新驗證 | 結果與明示界線 |
|---|---|
| 完整程式回歸 | **533檔／7,913項全部通過，250.47秒，無略過**；單worker、原timeout及精確Finance隔離候選。初次runner source與後續ABCD passive-effect測試失敗保留，不冒稱通過；後者只等待原callbacks，不減少斷言或改runtime |
| 集中／独立覆核 | 最新23檔／629項全部通過；涵蓋新receipt、既有snapshot、journal入場／撤權／來源ABA、UI及cleanup／packaging。兩份獨立新receipt測試97項；SQL／API另做唯讀review無新增阻斷，均不替代真人hosted驗收 |
| 原生PG17.11 | **144份原樣migration、15／15套全部通過**；新receipt 55項pgTAP、四動作跨UTC／臺北雙向、11種壞證據回滾、expired-signature只讀、真uncommitted→same-key committed與5種觀察到等待後實際撤權全部通過。沒有替換Auth謂詞、外部網路或雲端DDL |
| 完整portable SQL | **144份migration編譯、134套／6,321斷言全部通過，退出0**；93套legacy PGlite-only fixture、41套enforced admission。首次RED及三套184項針對GREEN保留；只修兩個舊expected-message，不把legacy fixture當hosted真Auth／RLS／多人證據 |
| 型別／lint／建置 | 最後ESLint零warning、TypeScript、diff-check通過；production build完成101靜態輸出及新動態receipt route。build後只有測試／文件修正、runtime不變；外部配置清空、demo關閉 |
| UI規範／相依套件 | 既有專案scope與護理scope strict audit均0 findings；新test-only focus target改成真輸入，未弱化focus斷言。曾錯用audit結果檔當config的全庫掃描不屬既有專案scope，原結果保留，不能稱全庫UX已通過。135個正式依賴／214含optional、已知advisory0；不是滲透／ASVS證明 |
| 真Chrome合成UI | 10場景各原寫入1次＋人工receipt GET1次；額外POST／PATCH、snapshot GET、refresh及branch API皆0。原key/body、not_found／拒絕／壞證據、read fence、晚回覆／卸載／ABA／換源、16分鐘後原簽署唯讀與焦點均通過；desktop1440／mobile390無溢位、16px輸入、可見操作≥44px，console/pageErrors空。沒有本輪axe或全WCAG聲明 |
| 證據對應 | browser七份runtime SHA-256與目前來源完全一致；原生144份migration hash全對應。首跑尺寸誤量closed dialog 0×0只修verifier、保留首敗；root另實際檢视手機保存狀態與簽署視窗，不把隱藏副本當可見UI |
| 真Next production本機 | 兩GET未配置實際503／SERVICE_NOT_CONFIGURED、data=null、private/no-store；新Chrome桌面／手機登入卡正常且Google未配置停用，0外部資源／Auth請求、overlay及JS錯誤。root owned server以SIGTERM明確停止（exit143、listener拒連），agent owned server及全新Chrome已關閉；保留build／證據 |
| 正式雲端唯讀核對 | 2026-09-26T17:28:24Z指定Vercel部署清單仍403；17:30:06Z Supabase首爾ACTIVE_HEALTHY、17.6.1.166、130份migration，相對候選14份未套用。不表示專案不存在，不新增／覆蓋專案、push、發布、DDL、區域或費用 |

私有證據前綴`nursing-receipt-`、`nursing-operation-all15-native-20260927.log`及`nursing-receipt-browser/`位於原verification目錄。第一次portable失敗是兩份舊社工測試精確錯誤文案與新guard不同，僅修expected string且維持42501及全部正負斷言；三套針對修復184／184及完整134套／6,321項GREEN均有獨立日誌。源碼已保存為本機候選，未push、未發布或套用正式DDL。
