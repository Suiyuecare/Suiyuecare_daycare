# 已保存評估：正式作業準備查核

本輪為本機工程候選，未套用正式 Supabase、未推送 GitHub 或發布 Vercel。查核不是完成評估、正式計分、簽署或臨床核准；正式門檻仍以 [部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md) 為準。

## 已核對的實際範圍

| 頁面 | 目前題目工具 | 題數 | 已有工作 | 未完成的正式作業 |
|---|---|---:|---|---|
| 11 | SPMSQ | 10 | 授權個案、日期、登入評估人、作答、草稿、修訂、候選預覽、版本歷程 | 來源原件、核簽政策、正式簽署及更正 |
| 12 | GDS-15 | 15 | 同上 | 同上 |
| 13 | 臺北115 B12跌倒評估 | 12 | 同上 | 同上；正式風險追蹤政策 |
| 14 | NSI | 10 | 同上 | 同上 |
| 15 | Barthel ADL | 10 | 同上；不適用原因與未填分開 | 同上；不適用不視為完整或零分 |
| 16 | Lawton IADL | 8 | 同上；不適用原因與未填分開 | 同上；適用版本須由真人審核 |
| 17 | EAT-10 | 10 | 同上 | 同上；高風險確認政策 |
| 18 | BSRS-5＋安全題 | 6 | 同上；安全題獨立警示 | 同上；警示確認、處置與追蹤證據 |
| 36 | MNA-SF | 6 | 同上；BMI／小腿圍實測與互斥驗證 | **不是完整版MNA**；完整工具及正式政策仍待製作 |

合計87題、九份題目式工具，不代表全部評估／專業頁完成。頁19人工身體觀察、頁28人工心理社會及頁51人工護理文字紀錄不是正式標準化量表；官方ABCD、PT／OT及其他專業工具須另行依原表單驗收。現有欄位只有單選選項與全表質性備註，不冒稱所有工具皆有多選題或逐題質性欄位。

## 本輪工程交付

1. 新增私有、不可變的結構驗證目錄與組合候選，綁定原計分目錄、結構驗證目錄、表單及規則版本。原九份canonical JSON／hash、既有採用／退休紀錄與草稿不改寫；不把舊計分採用挪用為新組合核准。
2. `questionnaire_assessment_readiness_source` 只讀實際已保存版本。機構、分支、目前使用者、個案、表單、版本、原內容雜湊及本次讀取nonce皆須相符。權限由既有真正員工入場與個案指派檢查，不以後端密鑰或展示資料替代。
3. `GET /api/questionnaire-assessments/readiness` 接受五個單值篩選：`form_key`、`client_id`、`version_id`、`content_hash`、`read_nonce`。沒有答案body或寫入／簽署介面；呼叫者不能提交另一組答案再宣稱是已保存版本。
4. 伺服器核對實際資料庫原件的精確目錄bytes／hash，再由已凍結驗證器重現完整性、缺答、量測矛盾、候選分數、分類及警示。不執行資料庫提供的任意公式或程式。
5. 報告不回傳原答案、備註、評估人姓名、目錄JSON或原始錯誤。查閱稽核不放上述內容、雜湊或nonce；API使用private/no-store，跨範圍、版本不一致、過期／錯誤回覆不補入其他資料。
6. 被修訂的原版本仍可依法定讀取權限查核，但顯示`version_superseded`。查核不更改原草稿、未知寫入鎖或正式結果，也不重送原操作。一般讀取不新增核簽資格或要求寫入權限；資料庫原有員工登入規範仍生效。

後續本機候選已接入九份量表工作區的「完成檢查」，只查當前選定的已保存版本，不取代正式評估、採用或簽署。前台與復原邊界見[前台驗證](QUESTIONNAIRE_READINESS_UI_2026-09-27.md)。原量表未知寫入在完整卸載後的內容／精確回條仍需安全改善，不冒稱已與護理journal等效；未部署正式環境。

## 必須始終保留的正式阻斷

即使答案完整、候選分數正確，仍回傳`candidateOnly=true`、`formalScore=null`、`signable=false`，並保留：

- `source_evidence_missing`：來源URL不是來源原件、封存回條或規則驗收證據；使用授權已確認，不重新要求授權。
- `bundle_not_adopted`：新結構＋計分組合尚無獨立真人雙人採用；舊計分目錄採用不能代替。
- `signing_policy_missing`：逐工具的資格、風險確認、補登、跨規則期間與更正政策未完成真人決議。
- `formal_signing_unavailable`：共用正式結果、簽署及更正交易尚未接好。

來源或政策尚不存在時不可由前台成功旗標、管理員角色、付款聲明或候選hash存在解除。下一版本若加入上述能力，須新增不可變政策／組合與審核，不改寫本候選語意。

## 新發現的資格鏈缺口

頁72雖已有證照版本、registered／verified及證明reference/hash欄位，現有正式輸入／RPC只接受`missing`／`not_applicable`且附件必須null；胰島素資格判斷卻要求`provided`。因此還須建立員工專用安全附件ACL、掃毒回條、證明核驗與資格生效流程；不能直接沿用個案附件權限，也不能代填專業資格或讓主任職稱自動代表護理／社工資格。

## 驗收契約

- 九份組合與結構目錄固定，原九份計分原件保持逐byte／hash一致；資料表/RPC最低權限、不可變及不存在假採用有測試。
- 每份已保存的完整／缺答／非法資料重現原候選結果；缺值、不適用不當零分；SPMSQ情境、MNA實測邊界／互斥與BSRS獨立安全警示保留。
- SQL重新計算原內容hash，現在版本屬於同一評估鏈；錯機構、分支、個案、表單、版本、hash與nonce不能獲得他人結果。
- 讀取／稽核等待途中修訂或撤權不得回傳假最新／舊授權結果。原生獨立backend競態與HTTP條件測試分開；READ COMMITTED最後檢查不是全程到COMMIT的全序列化保證。
- 查核前後臨床版本、操作鍵、簽署／採用、權限與重新驗證筆數不變；只留下經授權的查閱稽核。
- API失敗回傳結構化一般錯誤；沒有PHI、Token、原始DB訊息、外部請求、寫入或fallback。正式分數與簽署始終拒絕。
- GET查詢包含個案／版本ID、內容hash及讀取nonce；應用程式沒有自行記錄查詢，但正式Vercel／PostgREST／代理access log是否保留完整URL尚未驗證。上線前須核對並遮罩查詢字串，不能以本機稽核測試代替供應商紀錄驗收。

## 本輪驗證狀態

2026-09-27本機候選已凍結；所有資料庫測試均為自行建立、僅Unix socket可連線的合成資料叢集，未使用真實個案或正式雲端憑證。

| 檢查 | 實際結果／證據 |
|---|---|
| 完整程式回歸，含Finance跨儲存庫契約 | 536檔／8,050項通過；`questionnaire-readiness-full-vitest.log`，261.19秒 |
| 原生PostgreSQL17.11 | 全16套通過；`questionnaire-readiness-native-all16.log` |
| 新查核原生資料契約 | 146份實際migration、42／42 pgTAP；九份真實本機授權寫入→原RPC JSON→Node候選逐欄一致；原144版資料目錄、Auth、writer、採用與退休不變 |
| 原生多人競爭 | 六個獨立後端探測：撤機構／指派／Google／讀取權限拒絕且稽核回滾、同鏈修訂拒絕舊回查、另一評估不污染本鏈；證據`/tmp/daycare-questionnaire-readiness-native.DlzFLL/evidence.json` |
| lint／型別 | 零警告、型別檢查通過；baseline位置修正另跑lint／16項cleanup回歸通過 |
| production編譯 | 101／101靜態輸出及新動態API路由通過；`questionnaire-readiness-production-build.log` |
| 依賴套件 | production依賴掃描無已知弱點；`questionnaire-readiness-dependency-audit.log` |
| 實際production artifact HTTP | 未登入完整GET401、錯誤／重複篩選400、POST405，全部private/no-store且不含個案或堆疊；`questionnaire-readiness-production-http.json`；自己的服務已停止 |
| 完整portable資料庫 | 135套／6,363斷言通過；93套legacy PGlite fixture、42套enforced admission，非全部真人Auth；`questionnaire-readiness-portable-all.log` |

上述log／JSON在`/Users/seniorlifepr/.codex/verification/daycare-20260926`，原生JSON另外保留於該次獨立執行的臨時證據目錄，不提交合成runtime到Git。獨立review逐一核對146份migration名稱及SHA-256與證據相符，未發現本切片blocking defect。

HTTP401測試不是登入成功流程。未登入SPMSQ頁的HTTP200實為Next streaming的loading與登入redirect，沒有評估工作區；未冒稱頁面可用。89頁heading smoke曾在未啟動預設3000服務時返回fetch failed，保留`questionnaire-readiness-routes.log`為測試環境未設置的失敗，不列為頁面缺陷或通過證據。上表是後端切片凍結時的證據；後續前台另有本機瀏覽器驗證，不代表真人／hosted流程、89頁完成或可以正式切換。
