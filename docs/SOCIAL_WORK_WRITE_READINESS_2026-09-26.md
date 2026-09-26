# 心理社會／社工紀錄部署候選

本文件只涵蓋頁28／29的限定開通、共享表單與原操作保護；不是89頁正式營運驗收，沒有hosted DDL、GitHub push或Vercel發布。

## 已修正

- 七種社工操作、四種心理社會操作由各自單一workspace controller與journal擁有；桌機／手機按鈕不再保有獨立鍵或編輯器。
- 首次送出固定原key、完整body、個案／來源版及actor／機構／分支。lost ACK、後續403、元件重掛不自動送出、不換鍵、不允許改未知內容；未送出的內容才可經共享確認捨棄。
- AppShell在其他頁面仍觀察authority；登出在網路呼叫前清除journal。撤權／指派、scope ABA、卸載及晚到回覆不能恢復舊資料。獨立覆核重現同generation指派移除後舊props復活，已RED／GREEN修正為privacy floor，真正較新來源才准恢復原操作。
- 保存receipt與新清單分开。只有確切版本／事件、序號、狀態及時間的正向同鏈history才能解除重複保護；缺列與refresh完成不是證據。
- 頁29新PATCH統一201，真正相同鍵replay200；沒有放寬原frontend parser。sign-only員工不被誤標為唯讀；一般草稿与簽署仍各核對原scope。

## 限定Auth與資料庫邊界

新增143號CLI增量`20260926141155_social_work_approved_staff_admission.sql`，只修正已核准非CEO社工被原專用入口擋住的問題；原Google核准、機構／分支、有效membership／role／grant、職务上限與個案指派不放寬。草稿／修訂保留原AAL2，簽署／更正含replay必須真同session consumed證據、非未來且15分鐘內。

`social_work_recent_aal2_evidence`只回null或嚴格四欄；API查現在的org／branch／actor／verifiedAt，不接受全域cached時間，也不採nursing／referral fallback。SSR僅傳boolean。MFA鎖後選定原模組路徑，證據寫入後再次驗證同一路徑；失效全部回滾。

原生PostgreSQL17.11精確143份migration之新suite：84項pgTAP＋21個獨立backend探測通過，原142份基線RED；用真正合成Auth/session/AMR而非替換授權函式。涵蓋兩頁原RPC、稽核途中撤權、權限生效時間、真時鐘過期與鎖等待、MFA跨路徑變動及臨床／稽核／證據回滾。獨立review核對same-session唯一約束及事件／挑戰鎖，未證明新auth放寬。

既有referral suite只在ROLLBACK的synthetic fixture把新social簽署grant延後，以繼續隔離原路徑測試；63項＋12個backend探測仍通過。文件列印fixture用單一captured clock消除兩次clock_timestamp產生的1微秒誤差，不變更正式五分鐘TTL或不可變trigger。custom form lifecycle的舊測試只更新AMR卻保留transaction-start JWT iat，慢跑時被原兩秒界線正確拒絕；142／143均deterministic RED。測試改為模擬真正factor驗證後同步刷新iat／jti，同一challenge成功、terminal replay仍拒絕，原66斷言不變；原生66＋6個backend探測及portable66均GREEN。

## 表單與UI證據

兩頁沿用GovernanceDialog、useUnsavedChanges與既有Finance AppShell，不改frame字體／顏色／幾何。原生日期／時間／datalist接受平台選單；noValidate、16px輸入、44px控制、不可拖曳textarea、inline錯誤與first-error focus。心理社會仍是manual-psychosocial-v1人工非標準化文字，不冒稱正式量表分數。

本機Chrome真正UI＋loopback假transport驗：空必填0POST、composition事件0POST、unknown→403→remount→success三POST同鍵同body；receipt不能假更新，缺原history不解除，正向history才解除。離頁scope ABA與late receipt不顯示內容；同generation指派移除／原props重掛隱藏，較新snapshot才准原鍵重試。1440×1000及390×844無水平溢位、欄位16px／44px、無JS錯誤。Tab不进入背景可聚焦控制，但允許Chrome焦點到browser chrome；不是完整人工鍵盤／WCAG驗收。composition是合成事件，不是實際中文鍵盤。

私有證據於`/Users/seniorlifepr/.codex/verification/daycare-20260926`，前綴`social-work-`、`psychosocial-`；Before來自固定HEAD1ba1dba原inline編輯器，After為共享modal。假transport沒有真正Auth/RLS／持久化／RSC證據，不據此宣布正式可工作。

真正Next展示頁29重現Node U+2009／Chrome ASCII時間分隔引起hydration failure；改formatToParts固定年月日時分。兩項測試覆蓋三種ICU空白及台北跨日；重新用全新Chrome session開啟390px頁29／頁28無error dialog、無JS錯誤／溢位，展示寫入仍停用。這是SSR／hydration合成載入，不是正式Google工作流程。

## 未完成的正式門檻

- 32個待清單確認標記、有界200筆／50歷程等來源可能找不到原成功版本；需精確授權定位／receipt讀回，不由absence解除。
- unknown鎖下尚無獨立GET／MFA復原；重新取得授權來源不能靠普通refresh繞過lease。完整重載無durable intent；明示限制仍是P0，不能稱完整復原。
- hosted143增量尚未套用；真人角色／Google登入、真HTTP、真Supabase及50人並行尚未驗收。
- 所有[正式上線門檻](PRODUCTION_GATES.md)仍有效：Vercel授權、區域／DPA／備份、CMS封存掃毒、官方量表／申報、Finance真同店及家屬／持續營運等不得由本切片通過解除。

完整回歸最終數量及來源凍結記錄另見[部署恢復紀錄](DEPLOYMENT_RECOVERY_2026-09-26.md)；中斷／資源壅塞跑次不作最後通過證據。
