# CMS 原上傳流程等待後授權檢查候選

本文件記錄本機第152份 migration 候選，不是正式部署證明。正式 Supabase、GitHub、Vercel 尚未變更；整體仍依 [正式部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。

## 本輪修改

`20260927163540_import_upload_authority_fences.sql` 只在原位置替換三個私有函式：通用預約、單案收案預約、原後端完成保存。保留原函式 OID／owner／ACL、公有 wrapper、參數、metadata、來源 SHA、原建立時間、七年保留及回條契約；不保留可執行的舊實作旁路。

- 原預約在操作鍵鎖、內容鎖、insert／稽核後與回傳前，重新查當前身分、實際工作階段與資料範圍。
- 原後端完成操作在原預約 row lock 後的既有檢查之外，另於 completion insert／稽核後、還原 worker 身分前重查。成功及例外均還原三項請求身分設定。
- 單案收案沿用已核准 Google AAL1 的 `cms.stage` 窄範圍授權；沒有新增 MFA，也不擴張其他模組。
- 通用操作沿用真實 AAL2、同使用者／同 session／同 challenge／同 factor 與目前十五分鐘期限；未來 factor 拒絕。已消耗 nonce 的到期時間不是 factor 的有效期限。
- 普通同鍵重送不得以同 session 的新 challenge 悄悄接替不可變的原證據；需要新授權時，走第151份的[本人明確續做](CMS_UPLOAD_RECOVERY_READINESS_2026-09-28.md)，不改寫原預約。
- 新 helper 沒有額外稽核寫入，完全撤銷一般 caller／worker 的直接執行權，不能當作擴權入口。

最後重查是交易內可驗證的檢查點，不宣稱所有權限表異動與 COMMIT 跨表全序列化或不存在任何排程間隙。資料庫失敗回滾不刪除已建立的 WORM 原件。

## 驗收設計與目前狀態

獨立靜態覆核已完成，SQL SHA-256 為 `eb448c107ffa0459703e241092acb78234c09ec685f16402249f7f54cda7f42c`。新固定 SQL 測試使用實際合成 Auth／session／AMR／challenge，沒有替換正式 admission 或 shared 權限函式。

隔離 PostgreSQL17.11 原生測試已在同一個 cluster 先套原151份再套152，對同一組實際 backend 等待探測取得 **15個缺口 RED→GREEN、4個原本已拒絕的控制情境維持 GREEN**。19組修正版全部返回42501、不披露成功回條；每組都有阻擋 PID／holder／blockers 證據，原 actor／原操作鍵的來源與完成列及本操作 INSERT 稽核均回滾。撤權人的合法稽核不列入操作自身回滾計數。

8組 JWT／factor 到期情境在151與152各觀察實際資料庫時鐘越過原期限，共16個觀察；沒有修改等待中的 share-locked 驗證資料，也沒有用 consumed nonce 到期假扮 MFA 失效。原本已拒絕的兩種 routine 新預約等待與兩種 worker row-lock 控制，不重複算成新發現的缺口。

新固定 SQL 30／30、focused native 19／19 均通過。151→152 的既有 relation ACL／RLS、policy、函式安全設定／ACL、全部未修改的全域授權函式內容及業務數量不變。152份 migration、fixture 與 runner 共154份 SHA-256 逐份重讀一致。證據：`/Users/seniorlifepr/.codex/verification/daycare-20260926/import-authority-fences-native-focused-evidence.json`；原 runner 報告位於 `/tmp/daycare-import-authority-fences-native.8yw0hA/evidence.json`。owned cluster 已停止、client／holder 均0，成功 run 的資料目錄已移除，證據保留。

本輪曾先抓到測試 fixture 的 Auth AMR 唯一鍵、nonce 歷史順序及 baseline／functional 命名空間衝突，已修測試資料後重新完整執行；沒有放寬 production guard 或抹去151 unsafe success資料。

## 完整本機回歸結果

- 完整程式569檔／10,017項通過，包含真正 Finance 候選 handler 的合成 loopback 契約，不是正式店別金額。首次預設高並行 run 出現4項 ABCD 測試逾時，已停止該自有 run；同11項不改碼單 worker 重測通過，再以 `--maxWorkers=2` 跑完整569檔全部通過，沒有提高逾時標準。初次失敗 log 保留，不冒稱該次通過。
- Portable141套／6,705斷言通過：93套舊PGlite-only admission fixture、48套實際 enforcing admission；不是 hosted RLS 或 Auth 成功證據。
- 原生 PostgreSQL17.11 全22套通過，包含原 general repository 的真正程式→RPC閉環與明確 recovery 的真正程式→SQL續做回歸。新152測試另在全套中再次取得15 RED＋4 control→19 GREEN與30／30。這些是局部真實程式／SQL證據，不是真正登入的整個HTTP／UI閉環。
- 最終 lint、型別、隔離 production build、正式依賴 audit 通過；沒有新套件或環境憑證。隔離 checkout 只有 `.env.example`，沒有讀取正式 `.env`。
- 實際新建置產物 HTTP44項拒絕通過（原26＋recovery18）：錯誤來源、非法查詢、匿名及未配置拒絕；private／no-store及安全錯誤回條符合原契約。不是 HTTPS 合法授權上傳或 hosted 成功證明。
- 全套22個自有 cluster 的資料子目錄均不存在、server log 均確認 shutdown；只清除本輪自有合成測試資料，logs／backups／證據保留。自有建置伺服器PID63363已停止，未停止其他服務。

證據均位於 `/Users/seniorlifepr/.codex/verification/daycare-20260926`，檔名前綴 `import-authority-fences-`。全套新152報告另外保留為 `import-authority-fences-native-full-evidence.json`，原件 `/tmp/daycare-import-authority-fences-native.cld5dU/evidence.json`；最後再讀154份來源雜湊一致。七個原生 runner 更新精確152份／最後檔名守門，不放寬日期、權限、候選採用或既有資料不變檢查。

19項真等待探測沒有單獨涵蓋 future-factor、nested-invoker 或三個 GUC 還原；不能將靜態審查及其他 regression 說成這19案的專項證據。沒有額外第三方安全、50人HTTP壓測或人工WCAG新證據。

## 不包含的正式門檻

1. 現場原操作 locator／journal／結果未知的手動查證及明確續做 UI；第一個上傳 ACK 遺失時，僅知道原鍵、不知道 reservation ID 的定位仍待補。
2. 整個 HTTP／初始登入期限、跨系統孤兒清冊、正式雲端七年 WORM／KMS、附件隔離掃毒與真人 hosted 收案。
3. 通用匯入正式業務提升、逐欄來源字典與完整照顧計畫／資格／服務驗收。單案基本資料既有 `commit_cms_intake` 交易不代表所有來源欄位已完整入檔。
4. 正式量表採用、完整專業工具、核簽資格、申報／Finance 真資料、備份還原、多人壓測、安全及人工無障礙。
5. 商用部署方案與資料區域決定。未獲核准前不新增費用、不搬資料、不直接切換正式環境。

本輪沒有前台改版，不將歷次 Chrome 圖片或 UI 測試當作本輪新證據；沒有與真實使用者登入的完整閉環。
