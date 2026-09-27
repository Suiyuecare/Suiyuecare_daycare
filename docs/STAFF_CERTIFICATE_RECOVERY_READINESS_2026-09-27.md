# 員工證照附件來源與原操作復原：部署候選

## 結論與範圍

本輪補上非CEO員工的授權證照來源、本人原操作唯讀查證、過期預留的明確終止及完整操作鍵綁定。**仍是本機後端候選，尚未接入員工頁面、啟用正式掃毒、套用雲端遷移或發布。** 不因metadata可讀或附件核驗通過而產生正式資格、量表分數或簽署權。

既有附件後端見[附件候選驗收](STAFF_CERTIFICATE_EVIDENCE_READINESS_2026-09-27.md)。本輪新增第149份增量migration，保留原148份的內容與既有證照writer權限。不是為消除前台錯誤而全域放寬CEO、角色或RLS限制。

## 新增功能與驗收契約

| 入口 | 可以做什麼 | 明確限制 |
|---|---|---|
| `GET /api/staff-certificate-documents/sources` | 查目前授權範圍的證照版本、員工與到期日期；每頁50筆，支援員工及頁數篩選 | 管理員限授權分支；只讀員工限本人。版本指標不等於附件或資格已具備；不授予舊證照writer、例外核准或簽署權 |
| `GET /api/staff-certificate-documents/receipt` | 用原人員、原操作鍵、完整原來源及檔案／核驗內容查證 | 不自動重送、不續期、不刪物件；查無結果仍是未知，不可當作前次未保存 |
| `POST /api/staff-certificate-documents/reconcile` | 有管理權與近期真正驗證的人員，明確結束本人已過期的原預留 | 不允許結束未過期或他人的操作；如果掃描先完成，回傳原完成結果，不新增終止紀錄 |

三個API都核對請求所見機構／分支與目前登入；舊分頁不能在分支切换後靜默操作另一間店。GET沒有body；原操作識別與綁定放header，不把原始核驗理由放URL。核驗回查使用理由的UTF-8 SHA-256，再核對回傳的原理由，不靠同一附件ID推定同一操作。

認證、來源讀取、RPC、解析與回覆共享20秒硬期限。支援取消且拒絕遲到回覆，不在取消或逾時後繼續發出下一階段寫入；取消清理本次計時器，但不能撤回已送到遠端的寫入。因此已發出的操作仍可能晚完成，需用原鍵查回，不宣稱取消等於回滾。

只讀metadata要求目前有效AAL2與真正讀取授權，不因15分鐘寫入驗證過期便禁止本人歷史查證；結束過期預留仍重新驗證目前管理權、同session近期證據與原操作來源。撤除管理權不會擴大本人只讀的範圍，也不能藉查證取得新寫入權。

## 查證結果的現場語意

| 結果 | 意義 | 後續前台必須怎麼呈現 |
|---|---|---|
| `not_found` | 目前沒有符合原內容與本人操作鍵的正向保存證據 | 保留未知操作與原檔，允許再次明確查證；不換鍵 |
| `reserved / pending` | 只證明資料庫已預留，未證明檔案已進入Storage或掃描完成 | 顯示「原上傳尚未完成」；不能顯示檔案已安全 |
| `reserved / expired` | 原預留或原驗證期限已過 | 提供有權限者的明確終止流程，不用重新MFA延長舊預留 |
| `completed` | 原掃描／人工核驗帳本已保存 | 原掃描可能是感染或失敗，必須顯示真正狀態；不當成專業資格有效 |
| `expired_closed` | 本人原預留已被不可變終止紀錄封住 | 原鍵不能重新預留或晚補掃描；前台只有核對完整終止回條後才可讓使用者另起新操作 |

`uploadedAt`仍是伺服器預留時間，不是實體上傳完成時間。原附件與Storage物件不因終止而刪除或覆寫；正式清理、保留年限與人工異常處置尚需另行規劃。

過期终止只處理原操作metadata，可對仍在目前讀取授權內的精確歷史來源進行，包括證照合法更正版或作廢後的舊預留。這不恢復舊版上傳、掃描、下載或核驗權；來源清單仍提供目前版，原回條仍固定歷史版，不用新版補位。操作人自己停權、跨分支或失去原資料讀取範圍時仍拒絕。

終止紀錄與明確處置intent帳本分開、不可變、FORCE RLS且不授予瀏覽器直接DML。即使掃描已完成而沒有新增終止，處置键也綁定原對象及完整request hash，不能拿同一鍵處理另一份附件或當作新的上傳／核驗鍵。原掃描與終止使用相同證照／掃描鎖；不把固定等待時間稱作競態證明。

## 驗證與證據

凍結後回歸結果如下。所有測試使用合成員工、原件與Auth資料，不含真實Google帳號Token或員工文件；不是正式環境或真人簽署驗收。

| 驗證 | 本輪實際結果 | 證據檔 |
|---|---|---|
| 新schema、路由及既有附件路由 | 344／344項；保留原路由107項，新增期限、取消、清理、權限及完整綁定驗證 | `staff-document-recovery-vitest-final-149.log` |
| 全程式回歸 | 553檔、9,454項通過；1項需要額外Finance候選設定而跳過，另行驗證如下 | `staff-document-recovery-vitest-final-149.log` |
| Finance實際候選handler合成loopback | 1／1項；非正式連線或真實金額證據 | `staff-document-recovery-finance-loopback.log` |
| 全量portable資料庫 | 138套、6,534項通過；93套legacy compatibility fixture、45套真正授權gate；不替代原生資料庫 | `staff-document-recovery-portable-all.log` |
| 原生PostgreSQL 17.11 | 全19／19套；新57項及4組真正獨立backend等待探測；原附件52項及5組既有探測通過 | `staff-document-recovery-native-all.log`、`staff-document-recovery-native-final-b7124a95-evidence.json`、`staff-documents-native-149-final-b7124a95-evidence.json` |
| 本機production建置HTTP | 21／21項拒絕／登入轉向通過，匿名無metadata、來源範圍／query／binding／跨來源及舊路由防護保留 | `staff-document-recovery-production-http.json` |
| 靜態與建置 | lint、型別、production build、正式依賴audit通過；沒有已知依賴漏洞 | `staff-document-recovery-lint.log`、`staff-document-recovery-typecheck.log`、`staff-document-recovery-build.log`、`staff-document-recovery-dependency-audit.log` |

上述證據保存在本機 `/Users/seniorlifepr/.codex/verification/daycare-20260926`。HTTP測試沒有authenticated成功操作、掃毒啟用或hosted證明；測試伺服器已停止。四組新競態是限定鎖順序的實際backend證明，不宣稱所有COMMIT時點的權限序列化。

凍結migration149的SHA-256：`b7124a9588387a5443331e8d175ede2e05b29227e57104ed166d93046628d43a`；新SQL測試：`ecf1b07d2de0950c7d17492851952aa206e770ea4549dce95c0cd35c54b28798`。migration148仍為 `530fcca84cbe19c9dbdffb89722cb5b117713dd97d0c6dcbc19d52021e6afb7e`，沒有為通過回歸而改写舊增量。

## 前台下一步及正式門檻

1. 接入頁72的非CEO授權來源、單一workspace、選員工／證照、掃描狀態、第二人核驗及原操作查證。維持Finance frame與既有共用確認／未保存owner，不以新來源擴大舊證照writer。
2. 首次上傳前在分頁記憶體凍結原File、內容雜湊、格式、大小、來源及操作鍵；雜湊只用於查證關聯，伺服器仍獨立檢查真實格式與原件。核驗同樣凍結原理由與鍵。未知、重新掛載、換分支、撤權及晚回覆不得重建新操作；不把檔案或理由存browser storage。
3. 製作由可信原件及獨立核驗形成`provided`新證照版本的正式交易，再完成逐表／逐服務核簽資格政策。注意：既有 `private.insulin_qualification_version` 會採用有效、登錄且核驗的`provided`版本；不能因附件API回覆`serviceEligibility: not_evaluated`、`signable: false`就宣稱新版本不影響資格。本輪沒有產生provided，後續必須新增明確啟用授權、真實證號／日期／登錄人工核對、已發布資格taxonomy及真實下游轉換回歸，不讓掃毒或一般附件理由代替專業资格確認；九份量表的正式來源、雙人採用、簽署政策及正式交易阻擋仍須分別完成。
4. 完成正式掃毒、Storage原件、區域與保留／退出審查、真人員工Google及MFA、權限撤銷、備份還原與受保護预覽驗收。普通Supabase Storage不等於CMS七年WORM封存。
5. 按[全系統正式部署門檻](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)處理商用方案、資料區域、正式量表／申報／Finance實帳／多人操作與回滾；全部通過後才做GitHub及Vercel正式切換。本輪沒有雲端寫入或發布。
