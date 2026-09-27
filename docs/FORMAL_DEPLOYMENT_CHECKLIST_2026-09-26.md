# 正式部署剩餘工作與驗收

目前是本機候選，**未發布正式環境，不可投入真實個案作業**。程式測試通過不等於所有89頁可以使用；完整門檻以 [正式上線門檻](PRODUCTION_GATES.md) 為準，當前工程證據見 [本次修正與驗證](DEPLOYMENT_RECOVERY_2026-09-26.md)。

## 已完成的本機修正

- 申報、人工身體觀察的未知結果保留原操作與內容；不能用新操作鍵重複送出。
- 未保存人工觀察離開前明確確認；取消保留輸入，確認捨棄才繼續。
- 分支切換使用共用確認視窗，切換結果未知時遮蔽舊頁，防止在錯誤分支工作。
- 登出、帳號／角色／指派改變使舊操作失效；不把個案內容存到瀏覽器儲存空間。
- 修正手機確認按鈕的語意顏色、拆字與焦點；保留 Finance frame，不另造版型。
- 修正 MNA-SF 非法答案與測量缺漏同時發生時的錯誤分類；仍不冒充正式完整 MNA。
- ADL／IADL 草稿明確區分已作答、未填、不適用；顯示原理由，必填原因錯誤不送出，清除不轉成零分。量表輸入文字修到16px；未啟用正式計分或簽署。
- 公告伺服器搜尋／分頁：250筆全量可查，非當頁發布版可取得授權明細；稽核途中權限撤銷／資料增量拒絕舊結果。這是本機候選，不是已套用正式Supabase。
- 公告草稿／發布／撤回／已讀固定原內容、來源版與操作鍵；未知結果、重新掛載及權限ABA採明確手動回查，接入共享確認與未保存保護。成功回條與清單更新分開判定；本機證據見[公告操作驗證](ANNOUNCEMENT_WRITE_READINESS_2026-09-26.md)，不代表真人hosted驗收。
- 修正真正已核准護理員的資料與MFA入口仍只認CEO的錯誤；保留機構、分支、個案指派及簽署15分鐘驗證。護理草稿／簽署／更正加入原筆重試、未保存保護與撤權遮蔽；證據及未完成邊界見[護理部署候選驗證](NURSING_WRITE_READINESS_2026-09-26.md)。
- 頁39轉介加入原操作帳本、手動只讀GET回查及未保存保護；後續補轉介專用員工開通、真正MFA證據與撤指派後的重試／查閱／寫入拒絕。142份migration下原生63項／12實際競態通過，非CEO社工本機後端阻斷已修；正式環境尚未套用，不冒稱真人可用；見[轉介候選驗證](REFERRAL_WRITE_READINESS_2026-09-26.md)。
- 頁28／29本機限定社工開通、原鍵journal、共享表單及未保存保護已補；修正新PATCH201／重播200、sign-only提示及同generation指派撤銷ABA。本機原生84項／21個backend探測通過，仍不代表hosted已套用；範圍與未完成復原見[社工候選驗證](SOCIAL_WORK_WRITE_READINESS_2026-09-26.md)。
- 九份題目式量表新增獨立的結構驗證候選，固定缺答／不適用／情境／MNA 實測與錯誤結果契約；原計分 v1 不變。候選仍未採用或接入正式簽署，不能把「資料庫草稿可保存」當成「評估完整」；見[驗證候選](QUESTIONNAIRE_VALIDATION_CANDIDATE_2026-09-26.md)。
- 頁51補上原unknown鎖旁獨立手動授權GET；不重送、不換內容或鍵、不取得MFA。嚴格來源入場、指派撤銷／props替換及晚GET隔離已有本機回歸，不能把原操作仍待確認稱作已保存；本輪證據追加於[護理候選驗證](NURSING_WRITE_READINESS_2026-09-26.md)。
- 頁51後續補本人原操作唯讀receipt GET；四種action、完整原body、目前授權及歷史不可變hash核對，查不到保留unknown；查到只確認保存，不冒稱清單更新。過期原簽署證據可依法定讀取範圍回查，但不授予新簽或重播；本機候選尚未套用正式環境。
- 九份題目式工具新增私有結構／組合候選與已保存版本只讀查核API；後續本機已接前台「完成檢查」，不借用舊計分採用或啟用正式簽署。完整範圍、MNA-SF非完整MNA及證照核驗缺口見[已保存評估查核](QUESTIONNAIRE_READINESS_2026-09-27.md)，前台與來源／權限保護見[本輪驗證](QUESTIONNAIRE_READINESS_UI_2026-09-27.md)。
- 九份題目式工具新增本人原操作精確receipt GET；原actor／key／request／版本／時間核對及稽核等待後撤權測試已通過，後續已接前台分頁journal、「確認保存結果」與共享未保存確認。查無仍保留unknown，薄回條後另查確切原歷史版本；不自動重播、不啟用簽署。完整重載及新context復原仍待製作。後端見[原操作查證驗證](QUESTIONNAIRE_OPERATION_RECEIPT_2026-09-27.md)，前台見[原操作復原驗證](QUESTIONNAIRE_OPERATION_RECOVERY_UI_2026-09-27.md)。
- 員工證照附件補上私有原件儲存、回讀雜湊、掃描完成、獨立人工覆核、本人歷史及短效下載後端；非CEO已核准員工採窄範圍實際權限及真正MFA，不放寬其他模組。尚未接前台、開啟正式掃毒、產生可信provided證照版本或核簽資格；逾期未完成附件仍待正式對帳恢復流程。詳見[附件後端候選](STAFF_CERTIFICATE_EVIDENCE_READINESS_2026-09-27.md)。

## 還要製作／驗收的功能

| 工作 | 解決方式 | 正式驗收 |
|---|---|---|
| 真正員工跨模組開通 | 護理頁51及轉介頁39已有本機限定修正；逐模組核對社工／護理／照服員等原Auth與RPC，不將Google登入成功當作業務授權成功 | 非CEO員工使用原Auth/session/AMR、真實角色與指派完成各核心工作；未開通、停權、未生效角色、跨店、未指派均拒絕；不能以全域放寬權限消除CEO-only問題 |
| 完整評估、正式簽署 | 九份結構及私有組合候選／已存版本查核已補；仍需來源原件、新雙人採用、員工證明安全上傳與核驗、逐表核簽資格／風險／補登政策、完整工具／專業表單及正式簽署更正交易；不得用 seed 代替核准 | 題目／公式及驗證契約固定、缺值與不適用分開、Node／DB 逐欄重現；員工選個案→填寫→保存→讀回→風險確認→簽署→更正版全流程與真實多人競爭通過 |
| 社工、轉介及護理復原 | 頁39、頁28／29與頁51原unknown鎖旁的手動授權GET本機已補；頁51另補精確本人receipt GET，維持原操作、private lease及canonical權限綁定。仍需其他模組精確receipt、真正MFA取得、scope變更後context復原與完整重載定位 | lost ACK→修改／還原→重試／重新掛載只用同一原鍵及內容；晚回覆／撤權／跨分支不假成功；新建紀錄與版本各只有一份，成功回條不替代新清單；未知鎖與重新驗證不互相卡死；GET0POST、auth或壞回覆不復活舊資料；not_found不擅自當失敗 |
| CMS收案與附件 | 接上原檔不可變封存、附件掃毒與正式欄位匯入，保留預覽與逐欄確認 | 三份樣本區段差異正確；0腳本／外部請求；單一交易失敗時正式欄位0變更；封存、掃毒有實際回條 |
| 官方申報 | 補目前年度／台北格式實檔與回覆檔對帳；metadata回條不是申報檔 | 主管機關實際格式驗收；服務明細、逐筆金額及總額完全一致；完整平行申報週期無重複 |
| Finance單店收支 | 部署已排演的只讀連接器，核准真正同店映射，再核對實際帳務 | 單店隔離、真正 hosted請求、實際金額100%一致；正常連線前景下55秒更新，逾時／過期有明示 |
| 公告與評鑑 | 公告分頁、原操作固定重試及R1本人歷史成功回條本機已補；仍需最新同鏈來源定位、未知寫入唯讀查證、32個guard安全完成、完整重載復原及真人驗收；完成評鑑證據、指派、複核、不可變送出快照 | 真員工第101／250筆可查且隔離；逾時／重新掛載／權限ABA只回查相同操作，成功後舊列表仍防重送；原歷史證據不冒稱最新清單，32筆待回查不永久卡住；評鑑保存→複核→送出→追溯來源通過 |
| 家屬與持續營運 | 接上真正授權發布、通知投遞、正式備份還原及停機回補流程 | 家屬跨個案／資料類別外洩0；登出清除快取；正式RPO≤15分／RTO≤4時；50人HTTP壓測、安全與人工無障礙通過 |

## 需要負責人決定／提供的事項

2026-09-27T11:19–11:23Z僅唯讀複查：已連線Vercel團隊仍只回一個HR2專案，指定日照project的deployment list仍403；這是目前OAuth無權查閱，不證明專案不存在。Supabase日照project為ACTIVE_HEALTHY、首爾`ap-northeast-2`、API版本17.6.1.166／資料庫實際17.6，雲端仍130份migration、最後20260925141114。未使用對話中暴露的歷史Token，也未寫入雲端。

後續2026-09-27T11:38Z唯讀使用本機既有Vercel CLI登入，已成功讀取同一指定專案，**不再把403當作所有發布通道都無法使用**。帳號`entrepreneur-9585`、團隊`entrepreneur-9585s-projects`為OWNER；project為`suiyue-daycare-preview`、GitHub `Suiyuecare/Suiyuecare_daycare`、production branch `main`、Node22、function default region東京`hnd1`（不是inspect中的Sandbox `iad1`）。`daycare.suiyuecare.com`已verified；目前production READY `dpl_Cde52jZutniyJHsALsMB8YRNYxRh`／commit `aa0b64f0f2f9168489f08ba615aa7b6c96ce059d`，不是本輪候選。

既有Vercel SSO為`all_except_custom_domains`，正式自訂網域不能假設有Vercel SSO保護，仍需真正App/Supabase登入與隔離驗收；未關閉保護或產生bypass。CLI team list僅一個**Hobby**團隊，無已連線商用團隊可直接重用。[Vercel現行規則](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)限定Hobby非商業個人使用；公司營運須Pro／Enterprise或另選經核准的商用部署方案。因使用者禁止新增費用，不自行升級或用免費trial代替商用採購／退出審查。僅驗證讀取與OWNER資格，沒有試送部署、更改設定、GitHub push、雲端migration或查看／輸出credential值。安全摘要見證據目錄`questionnaire-operation-receipt-vercel-readonly.json`。

同次hosted Security Advisor回185項「RLS無policy」INFO及1項密碼外洩保護WARN。唯讀catalog確認185表均FORCE RLS且anon／authenticated直接DML權限皆0，不能為消除INFO而開放policy；service_role僅兩張既有private重新驗證表有select/insert/update權限，需保持伺服器密鑰隔離。這是目前正式舊schema的檢查，不是新增本機SQL或完整滲透驗收。[Advisor說明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[Auth警示](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

[Supabase公告](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)安排2026-09-28提供既有專案17.11升級；正式切換前另需備份、相容性及升級後驗證，不自動升級或支付新費用。同次catalog只讀檢測ltree、float GiST及非內建custom estimator operator皆0；程式未見legacy PGP cipher呼叫，但未掃描實際加密資料，不宣稱所有升級前置已完成。

1. **商用部署與費用：** 本機既有Vercel登入可讀指定project且為OWNER，main／網域／保護設定已核對；工具OAuth403不再是唯一通道阻擋。但現有唯一團隊為Hobby，與公司正式營運不相符，商用方案／費用尚待核准。不必提供密碼或Token，也不擅自升級。保護預覽、真正員工hosted登入、部署及回滾實作仍須在所有門檻通過後驗證。
2. **資料區域與費用：** 最近一次雲端唯讀結果為上述首爾與130份migration；本輪未重新讀取雲端。本機新增證照附件後為148份候選，與該次雲端結果相差18份，均未套用。原核准規劃是東京；保留首爾須重新核准資料治理及正式門檻，或先評估東京遷移／商用備份成本。未決定前不新增費用、不擅自搬資料；正式資料庫安全小版本升級也須先排演與備份。
3. **業務依據：** 確認Finance實體只含萬華一館，提供適用年度的官方申報樣檔，指派實際專業規則覆核人員，以及資料／法遵與上線驗收負責人。題目授權已確認，無須重新提出。

## 發布順序

取得授權與區域決定 → 完成剩餘功能 → 本機完整回歸 → 私有保護預覽 → 精準增量資料庫升級與實際員工驗收 → 備份／回滾及營運門檻全通過 → GitHub正式release及Vercel正式切換 → 網域、Google登入與核心工作逐項覆核。

已通過的工程證據保留；任何後續修改須重新跑相應回歸。未通過的項目不得因排定上線日期而標示完成，也不能以普通Storage代替不可變封存、以演示個案冒充正式資料、以移除授權或簽署檢查消除錯誤。

前輪本機候選：完整程式533檔／7,913項、portable134套／6,321斷言、原生PG17.11全15套；頁51新本人原操作GET含跨時區與撤權、真Chrome桌面／390px合成操作驗證，詳見護理候選驗證表。

前輪後端候選（2026-09-27，已保存量表查核）：完整程式536檔／8,050項、portable135套／6,363斷言、原生PG17.11全16套、lint／型別／production build通過；九份實際本機草稿RPC→Node候選一致及撤權／修訂競態通過。當輪尚未接前台，詳見[後端驗證表](QUESTIONNAIRE_READINESS_2026-09-27.md)。

最新前台候選（2026-09-27）：九份題目式工具已接「完成檢查」，完整程式541檔／8,440項、portable135套／6,363斷言、原生全16套、lint／型別／production build通過；隔離Chrome23項、兩份strict audit零finding及實際本機建置HTTP拒絕通過。四項正式阻擋仍保留，非全部89頁或真人hosted驗收。詳見[前台驗證表](QUESTIONNAIRE_READINESS_UI_2026-09-27.md)。這些通過只縮減本機工程風險，沒有解除上表的業務與正式門檻；未執行GitHub推送、Vercel發布或正式資料庫升級。

後續原操作查證後端候選（2026-09-27）：147份migration；完整程式544檔／8,706項、portable136套／6,425斷言、原生17／17套、lint／型別／production build及相依套件audit通過。新增API52項、SQL62項、九表create／revise三時區與8組真backend探測通過，未接前台unknown journal／確認窗。Vercel既有CLI唯讀通道已找回，商用方案及其餘正式門檻不變；詳見[新後端證據](QUESTIONNAIRE_OPERATION_RECEIPT_2026-09-27.md)。

再後續原操作前台候選（2026-09-27）：九份工具的分頁journal、本人手動receipt GET、確切歷史防重送及共享確認已接入；修正同個案新SSR清稿、矛盾成功envelope及手機CSS200%條件欄位溢位。全程式547檔／8,953項通過，1項opt-in另以真正Finance候選handler合成loopback通過；Chrome36項／12截圖、production HTTP拒絕15項、兩份strict audit與lint／型別／build／audit通過。本輪未修改或重跑SQL，前輪原生／portable證據不可冒稱本輪新結果。正式分數／簽署、整頁重載及新context复原與其餘營運门檻不變；詳見[前台原操作復原](QUESTIONNAIRE_OPERATION_RECOVERY_UI_2026-09-27.md)。仍無GitHub推送、Vercel發布或正式Supabase變更。

再後續證照附件後端候選（2026-09-27）：148份migration；全程式551檔／9,227項、Finance候選真正handler合成loopback1項、portable137套／6,477斷言、原生PG17.11全18套及lint／型別／build／依賴audit通過。新證照SQL52項、5組實際backend競態及本機production產物HTTP拒絕／登入轉向12項通過，完整回歸發現的6個外鍵索引缺漏已補正。舊頁72的非CEO來源清單、前台附件操作與逾期原操作恢復仍未補；新的API不代表員工頁已可用。附件不自動形成provided資格，也未開啟正式量表簽署。詳見[附件後端與未完成驗收](STAFF_CERTIFICATE_EVIDENCE_READINESS_2026-09-27.md)。本輪未變更UI，不沿用前輪Chrome結果作本輪新證據；亦無GitHub推送、Vercel發布或正式Supabase變更。
