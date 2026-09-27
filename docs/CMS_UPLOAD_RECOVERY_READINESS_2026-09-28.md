# CMS 上傳中斷續做候選驗收

本輪為本機後端候選，**未發布、未套用正式 Supabase，不可據此投入真實個案作業**。續做只恢復可信暫存，不直接建立正式個案、核定計畫、簽署、用藥或申報。既有單案基本資料正式交易與通用暫存的不同範圍仍依 [中央匯入門檻](CENTRAL_IMPORT_PROMOTION_GATES.md)。

## 修正的問題

原預約不可變地綁定當時登入與驗證證據。登入過期或換新工作階段後，以原鍵重送仍受舊證據限制；換新鍵又會碰到來源雜湊唯一限制。不能刪除原預約、改寫當時證據，或用「同分支同檔案」查詢冒充本人原操作。

新增獨立、不可變的續做授權與完成帳本，以目前真實登入重新授權**本人、同範圍、同原鍵、同原預約及同來源**。原預約、原物件路徑、原建立時間及七年 Compliance 保留不變；通用批次也沿用原批次 ID 與原上傳鍵，不產生替代批次。

## 已接入的界面與守門

| 範圍 | 界面 | 權限與結果 |
| --- | --- | --- |
| 4 MiB 單案收案 | `GET/POST /api/client-intake/imports/recovery` | 已核准、具有此分支匯入權限的真正 Google 登入；一般未簽收案仍不強制驗證器。POST 只回可信暫存，正式基本資料仍須預覽、逐欄決定及既有交易。 |
| 25 MiB 通用匯入 | `GET/POST /api/imports/recovery` | 寫入要求真正 AAL2 與近期 15 分鐘 MFA；查證要求目前可讀授權，不因查證而授予新寫入。POST 將續做回執接回原鍵的持久化暫存版本。 |
| 本人回查 | `import_upload_recovery_receipt` | 僅查精確本人續做鍵；不啟動封存或完成工作。不明／查不到仍是未知，不能當作已回滾。 |
| 明確續做 | `reserve_import_upload_recovery` | 原操作、來源中繼資料、模式及範圍逐項核對；新續做鍵與意圖不可變，不能改變原預約登入證據。 |
| 受控完成 | `complete_recovered_import_upload` | 僅伺服器 worker；使用帳本捕捉的實際登入證據，核對解析內容、固定來源、封存證據及效期。只能形成一份原來源完成紀錄。 |

- 第 151 份 migration：`20260927160222_import_upload_recovery.sql`。私有帳本 FORCE RLS，禁止公開角色及 service_role 直接寫入；只能使用窄範圍介面。雙層權限、固定搜尋路徑、外鍵索引與不可變觸發器均保留。
- 新續做介面在鎖、插入、稽核等待後重新核對目前角色、分支、真實 session/JWT/MFA 與效期。撤權或失效在交易末發現時，寫入與稽核一起回滾，不披露舊回執。
- 原始 HTML 靜態解析，不執行程式、不抓外部附件。續做資料須精確重現原解析內容、來源大小、雜湊與映射版本。
- 同來源、完整格式與限時串流檢查沿用既有入場規則；呼叫端不能把通用模式改成一般收案。兩種入口都拒絕演示模式寫入正式資料。
- coordinator 自開始起 20 秒限時，接取消訊號並阻擋晚到的後續封存／完成。通用 repository 的原回執接入亦在取消前後檢查；回應未知不宣稱回滾。**這不是整個 HTTP／初次登入的期限。**
- 已完成原來源可由目前合法讀取權限查回；這只證明原暫存完成，不是把過期續做授權恢復有效。查證 GET 不取得 MFA、不自動 POST。
- SQL 保留微秒時間順序，Node 回執核對亦避免毫秒截斷造成錯誤接受；已完成原來源時間可以早於後來的續做建立時間。

## 獨立原生證據

全部使用合成資料、自有 Unix socket 本機 PostgreSQL 17.11；沒有 hosted 連線、真實個資或取代業務授權。

- 72／72 pgTAP 通過；150 → 151 升級的既有業務指紋不變。
- 7 組實際等待探測：同鍵授權唯一、雙 worker 只完成一次、鍵等待途中撤權、插入後稽核等待撤權、完成後稽核等待 session 失效、回查輸出前撤分支、原資料列鎖等待期間捕捉的 JWT 真實到期。
- 實際儲存庫 TypeScript coordinator／GeneralProductionImportRepository → 真正 SQL RPC 閉環通過；不是只測 mock handler。
- 原預約上傳後回應遺失 → 新 session 明確續做 → 完成回應再遺失 → 本人 GET 查回 → 原鍵重播，只有兩個原來源各一個合成不可變物件；查證／重播沒有追加封存或 worker 完成。
- 通用續做接回原批次 ID、原上傳鍵與第 1 版，精確重播不增加版本。正式個案／照顧／計畫／用藥變更為 0；解析程式執行與外部網路請求為 0。
- 151 份 migration、12 份實際程式來源、fixture 與 runner 共 165 個來源雜湊，root 獨立核對一致。自有叢集停止，客戶端／鎖持有者皆為 0，測試資料目錄已清除，證據保留。

獨立證據複本：`/Users/seniorlifepr/.codex/verification/daycare-20260926/import-recovery-native-focused-evidence.json`；原件 `/tmp/daycare-import-recovery-native.9OijEU/evidence.json`。封存傳輸以記憶體合成物件替代，**不代表實際 S3 WORM、雲端登入或 production HTTP 成功作業**。

原生測試初次找出新增複合外鍵缺少 covering index，已補真索引後重跑；沒有略過測試。另將測試 fixture 改為真正存在的 OAuth-only 身分，不虛構不存在的 TOTP Auth 證據；守門不放寬。

## 完整回歸

完整程式測試 569 檔／10,017 項通過，包含 Finance 候選真正 handler 的合成 loopback 契約。這不是正式 Finance 單店金額驗收。新 root 回歸 58 項、coordinator／回執 113 項均包含於上述總數，不能重複加總。

| 本輪檢查 | 實際結果 | 證據檔案 |
| --- | --- | --- |
| 全程式回歸 | 569 檔／10,017 項通過 | `import-recovery-vitest-full.log` |
| portable 資料庫 | 140 套／6,675 斷言通過，含新 72 項；僅 PGlite 相容性，不取代原生／hosted | `import-recovery-portable-full.log` |
| 原生全量 | PostgreSQL 17.11 全 21／21 套通過，精確 151 份 migration；新 72 項、7 組實際競態及程式→SQL 閉環再次通過，165 個來源雜湊與候選一致 | `import-recovery-native-full.log`、`import-recovery-native-full-evidence.json` |
| lint／型別 | 當輪最終版本均通過 | `import-recovery-lint-final.log`、`import-recovery-typecheck-final.log` |
| production build | Next.js 16.3.3，隔離無雲端憑證環境建置通過，新增路由為 dynamic Node handlers | `import-recovery-build.log` |
| 正式依賴掃描 | `No known vulnerabilities found` | `import-recovery-dependency-audit.log` |
| 新入口實際建置 HTTP | 18 項同來源、參數、匿名／未配置拒絕、private/no-store、結構化錯誤及無敏感回覆通過 | `import-recovery-production-http.json` |
| 原入口實際建置 HTTP | 26 項既有拒絕回歸通過 | `import-recovery-original-production-http.json` |

以上檔案位於 `/Users/seniorlifepr/.codex/verification/daycare-20260926/`。全量最後的續做原生原件為 `/tmp/daycare-import-recovery-native.9gHsLs/evidence.json`，其自有叢集、連線及鎖持有者已清理。HTTP 自有 PID 92720 已停止，4177 埠不再監聽；未使用雲端憑證、cookie、外部請求或登入 bypass。這些拒絕不是 HTTPS 授權成功、真員工或 hosted 部署證明。本輪沒有修改 UI，不沿用前輪 Chrome 作本輪新證據。

依完整流程驗證技能核對的使用故事為：**員工從原上傳操作選擇原檔續做 → 專用 API → 不可變來源及權限帳本 → 精確原回執 → 現場顯示結果**。目前第一個未完成邊界是現場續做入口，因此停止宣稱此完整使用故事已驗收；後端閉環與匿名 HTTP 證據只記錄其實際涵蓋範圍。

## 尚未完成，禁止誤稱已正式啟用

1. **舊一般上傳 RPC 的最後撤權檢查**：原 `reserve_import_upload`／收案 reserve／原 `complete_import_upload` 的等待後完整 fence 本輪未改；新續做路徑通過不能替舊路徑作保證。必須另補直接 RPC 與實際競態回歸。
2. **現場續做介面**：目前只有後端 API，必須知道原預約 ID 與原上傳鍵；尚未製作本人原上傳鍵精確定位／預約入口、原操作 journal、明確選原預約／原檔／續做按鈕、重掛載／完整重載復原。原預約首次回應就遺失時，不能假設員工已取得 ID。不能把「API 可回查」當成員工已能自助續做。完整頁面重載不能依賴 component ref 找回原鍵。
3. **整個 HTTP 與登入期限**、封存孤兒清冊／對帳、逾期可操作恢復、附件清冊、真雲端 WORM／掃毒及正式欄位業務核准仍待補。原 S3 物件不可刪除或縮短保留以假裝回滾。
4. **通用正式提升**、完整 CMS 映射、真員工與雲端端到端流程仍未完成；本輪沒有新簽署或臨床資格。
5. 量表正式採用／完整工具、官方申報、Finance 真金額、持續營運、安全與人工無障礙，以及商用方案／區域決定，仍依 [正式部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。不能因上傳可續做就宣稱 89 頁皆可正式作業。

未推 GitHub、未發布 Vercel、未寫入正式 Supabase；所有正式門檻未通過前不切換正式環境。
