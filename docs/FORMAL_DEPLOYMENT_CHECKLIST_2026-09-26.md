# 正式部署剩餘工作與驗收

目前是本機候選，**未發布正式環境，不可投入真實個案作業**。程式測試通過不等於所有89頁可以使用；完整門檻以 [正式上線門檻](PRODUCTION_GATES.md) 為準，當前工程證據見 [本次修正與驗證](DEPLOYMENT_RECOVERY_2026-09-26.md)。

最新頁72進度見[員工證照唯讀前台](STAFF_CERTIFICATE_SOURCE_UI_READINESS_2026-09-27.md)：本機已接非CEO授權來源與附件狀態，尚未完成上傳／核驗／下載／原操作復原UI／可信provided／掃毒或hosted驗收。下方歷次證據的「尚未接前台」是各輪凍結時的歷史，不代表新唯讀入口尚未製作。

CMS 重新查核更正：4 MiB 單案收案已接封存／暫存及 `commit_cms_intake` 基本資料正式交易；缺完整 production repository 的是 25 MiB 通用匯入，不是所有 CMS 路由。後續來源、格式、限時串流及持久化暫存已補，沒有啟用正式雲端；詳見[CMS 請求安全與未完成門檻](CMS_REQUEST_SECURITY_READINESS_2026-09-27.md)。本人明確續做及精確唯讀查證後端見[2026-09-28 續做候選](CMS_UPLOAD_RECOVERY_READINESS_2026-09-28.md)；第152份候選另補[原上傳流程等待後授權重查](CMS_UPLOAD_AUTHORITY_READINESS_2026-09-28.md)。兩者都不是已完成現場 UI 或正式雲端啟用。

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
- 後續第149份候選新增非CEO授權證照來源、本人精確原操作GET及過期預留的明確終止。掃描已完成與真正終止分開；兩種結果皆將處置鍵綁定不可變原意圖。證照合法修訂／作廢後仍可在目前授權內結束精確歷史預留，不復活舊版上傳、掃描或資格。前台journal、可信provided新版本與正式雲端仍未完成；詳見[來源與復原候選](STAFF_CERTIFICATE_RECOVERY_READINESS_2026-09-27.md)。
- 頁72後續已接独立唯讀workspace；非CEO不必依賴執行長舊snapshot，明確選版後才讀附件。換頁保留員工、清版號；空頁直接回第一頁；非法舊篩選不轉成全員，沒有新寫入授權。完整回歸與未完成動作見[唯讀前台驗收](STAFF_CERTIFICATE_SOURCE_UI_READINESS_2026-09-27.md)。

## 還要製作／驗收的功能

| 工作 | 解決方式 | 正式驗收 |
|---|---|---|
| 真正員工跨模組開通 | 護理頁51及轉介頁39已有本機限定修正；逐模組核對社工／護理／照服員等原Auth與RPC，不將Google登入成功當作業務授權成功 | 非CEO員工使用原Auth/session/AMR、真實角色與指派完成各核心工作；未開通、停權、未生效角色、跨店、未指派均拒絕；不能以全域放寬權限消除CEO-only問題 |
| 完整評估、正式簽署 | 九份結構及私有組合候選／已存版本查核已補；仍需來源原件、新雙人採用、員工證明安全上傳與核驗、逐表核簽資格／風險／補登政策、完整工具／專業表單及正式簽署更正交易；不得用 seed 代替核准 | 題目／公式及驗證契約固定、缺值與不適用分開、Node／DB 逐欄重現；員工選個案→填寫→保存→讀回→風險確認→簽署→更正版全流程與真實多人競爭通過 |
| 社工、轉介及護理復原 | 頁39、頁28／29與頁51原unknown鎖旁的手動授權GET本機已補；頁51另補精確本人receipt GET，維持原操作、private lease及canonical權限綁定。仍需其他模組精確receipt、真正MFA取得、scope變更後context復原與完整重載定位 | lost ACK→修改／還原→重試／重新掛載只用同一原鍵及內容；晚回覆／撤權／跨分支不假成功；新建紀錄與版本各只有一份，成功回條不替代新清單；未知鎖與重新驗證不互相卡死；GET0POST、auth或壞回覆不復活舊資料；not_found不擅自當失敗 |
| CMS收案與附件 | 單案收案已接 WORM 暫存及基本資料正式交易；通用候選已接持久化暫存／版本／真MFA及20秒repository期限，仍非正式提升。本人明確續做與只讀查證後端、第152份原 reserve／原 worker 等待後授權重查已補；仍須現場原鍵定位／journal／續做入口、真雲端封存／掃毒、孤兒對帳、欄位業務驗收及整個HTTP／初始auth期限；局部防護不等於全流程完成 | 三份樣本區段差異正確；0腳本／外部請求；單一交易失敗時正式欄位0變更；封存、掃毒有實際回條；逾時保留原操作且無重複入檔；所有新舊寫入在等待後撤權／失效均拒絕 |
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
2. **資料區域與費用：** 最近一次雲端唯讀結果為上述首爾與130份migration；本輪未重新讀取雲端。本機新增通用匯入持久化、明確續做與原流程授權檢查後為152份候選，與該次雲端結果相差22份，均未套用。原核准規劃是東京；保留首爾須重新核准資料治理及正式門檻，或先評估東京遷移／商用備份成本。未決定前不新增費用、不擅自搬資料；正式資料庫安全小版本升級也須先排演與備份。
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

本輪證照來源／復原後端候選（2026-09-27）：149份migration；全程式553檔／9,454項通過，另行Finance候選handler合成loopback1項；portable138套／6,534斷言、原生PG17.11全19套、lint／型別／production build／正式依賴audit通過。新SQL57項與4組限定鎖競態、原附件52項与5組既有競態、本機production HTTP拒絕／登入轉向21項均通過；來源、原鍵查證、歷史過期終止及已完成處置鍵不可變意圖已補。尚未接頁72操作、啟用掃毒或產生可信provided；既有胰島素consumer可能採用provided，後續須明確資格啟用授權及下游回歸，不可把附件回覆當作資格隔離保證。詳見[最新後端證據與下一步](STAFF_CERTIFICATE_RECOVERY_READINESS_2026-09-27.md)。沒有GitHub推送、Vercel發布或正式Supabase變更。

最新頁72唯讀前台候選（2026-09-27）：授權來源、明確選版與附件狀態已接入；558檔／9,626項全部通過（包含真正Finance候選handler合成loopback），lint／型別／production build／依賴audit及兩份限定strict audit通過。本機production API拒絕21項、新唯讀URL匿名轉向6項通過，不是authenticated或hosted成功證明。本輪沒有SQL修改，保留149份及前輪資料庫證據，不冒稱重新執行；上傳、核驗、下載、journal、provided與正式門檻不變。詳見[本輪完整範圍](STAFF_CERTIFICATE_SOURCE_UI_READINESS_2026-09-27.md)。沒有GitHub推送、Vercel發布或正式Supabase變更。

後續 CMS 請求安全候選（2026-09-27）：兩類匯入已補同來源、完整格式、嚴格查詢、本文實際大小／10秒／取消／自有區塊與錯誤不反射輸入；單案仍保留核准 Google AAL1。561檔／9,737項、140項精準回歸、lint／型別／production build／正式依賴掃描及實際建置 HTTP 26項拒絕均通過。獨立覆核確認已修正單案兩個本文漏網。更正「所有CMS無正式交易」舊說法：單案基本資料已接交易，通用 durable repository 仍缺；本文期限不是 auth／RPC／S3 整體期限。沒有 SQL／UI 改動，不沿用前輪資料庫／Chrome作本輪新證據，未發布或操作正式資料。詳見[CMS候選驗證與剩餘門檻](CMS_REQUEST_SECURITY_READINESS_2026-09-27.md)。

最新通用CMS持久化候選（2026-09-27）：150份migration；564檔／9,846項程式、portable139套／6,603斷言、原生PostgreSQL17.11全20套、lint／型別／production build／依賴audit及實際建置HTTP26项全部通過。新增69項SQL、5組真backend等待及真正程式→RPC→資料庫上傳／重解析／暫存核准／歷史回執閉環；149→150既有資料不變、10個來源雜湊與固定程式一致。修復兩個實際SQL錯誤、直接RPC未來MFA及預約／封存前後撤權缺口，五個runner更新精確150基線，未放寬守門或期限。20秒只從repository建構起算，非完整HTTP／初始登入期限；核准仍`staging_only`且不寫正式個案。真雲端WORM、掃毒、正式提升、現場原操作入口與其餘正式門檻未完成，沒有GitHub推送、Vercel發布或Supabase正式變更。完整範圍見[本輪儲存驗收與未完成項](GENERAL_IMPORT_REPOSITORY_READINESS_2026-09-27.md)。

最新 CMS 明確續做後端候選（2026-09-28）：151份 migration；569檔／10,017項程式、portable140套／6,675斷言、原生 PostgreSQL17.11 全21套、lint／型別／隔離 production build／正式依賴audit及建置HTTP新18項＋舊26項均通過。新SQL72項、7組真backend等待、實際coordinator／repository→SQL原鍵续做閉環與165份來源雜湊一致；150→151既有業務不變，原建立時間／来源／七年封存保留不變，正式業務0變更。已修正新增複合外鍵索引與取消後接入回執不得送RPC的缺口。現場原操作定位／journal／續做入口、舊上傳RPC最後撤權fence、真雲端WORM／掃毒、正式提升及其餘營運門檻尚未完成；20秒亦不是整個HTTP／初始登入期限。沒有GitHub推送、Vercel發布或Supabase正式變更；詳見[新後端驗收與明確缺口](CMS_UPLOAD_RECOVERY_READINESS_2026-09-28.md)。

最新原上傳授權檢查候選（2026-09-28）：152份migration；569檔／10,017項程式、portable141套／6,705斷言、原生PostgreSQL17.11全22套、最終lint／型別／隔離production build／正式依賴audit及建置HTTP44項均通過。新SQL30項，在同cluster151實際15個unsafe缺口＋4個既有安全控制→152全部19項42501／無成功回條／原操作與稽核回滾，154份來源雜湊一致、既有ACL／RLS／全域授權函式與業務不變。一般Google AAL1收案未加MFA；通用AAL2原challenge不因重驗證偷偷換綁，需新授權走明確recovery。修正測試資料後重新執行，初次高並行JS逾時改較低並行量全套通過，未增加期限或放寬守門。仍未接現場原鍵locator／journal／續做UI、真雲端封存／掃毒及其他正式門檻；不保證所有權限異動與COMMIT跨表全序列化。沒有GitHub推送、Vercel發布或正式Supabase變更。詳見[最新候選與可重現驗收](CMS_UPLOAD_AUTHORITY_READINESS_2026-09-28.md)。
