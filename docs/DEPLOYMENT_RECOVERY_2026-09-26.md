# 部署候選恢復與前台安全補強（2026-09-26）

## 狀態

此批是本機候選，**未正式部署，也不能承載真實個案資料**。正式就緒仍依 `PRODUCTION_GATES.md`；不以量表授權、路由存在或本機測試取代正式驗收。

主機重新啟動後，先前 `/private/tmp` 的候選 checkout、runtime 與暫存證據已不存在。本次由持久化 Git 物件 `82d227662b733204bba883d5b5bfe196729958c7` 恢復到獨立 checkout，未清理或覆寫使用者／Finance 原有修改。本次重新跑的證據與歷史紀錄分開，不沿用已失去的暫存證據聲稱當前通過。

## 改進與驗收邊界

- 申報驗證：同一分頁跨元件重新掛載保留原批次、範圍、內容與操作鍵。未知結果只能原筆回查；先前未知後的拒絕不推定原次未提交。跨範圍不顯示原金額；權限／帳號 ABA、卸載及登出使遲到回覆失效。成功回執不等於新清單，舊草稿不得再用新鍵驗證。
- 人工身體觀察：獨立記憶體 journal；固定原個案、版本及 payload，重新掛載不丟掉原鍵。完整同範圍快照含已提交版或更高版後才解除重複保護。帳號、分支、角色及目前個案指派異動皆使遲到回覆失效；撤銷指派遮蔽原個案，恢復後只能回查原筆。正式簽署／更正使用共用確認視窗，但仍要求原有近期 AAL2；不是完整官方身體評估，也未補齊照片服務。
- 共用離頁保護：只管理導覽語意，不保存資料／鍵；各 journal 保有自己的鎖。HTTP 同分頁連結、GET 篩選、submitter overrides 與可取消 Navigation API 被保護；整頁重載只警告，不承諾跨重載自動恢復。申報與身體評估不得越過其他未確認作業。
- 申報清單：嚴格驗證原 RPC 欄位、日期、狀態、筆數、精確金額及重複 ID；畸形資料不變成假零或展示資料。版本名稱沿用資料庫不限長的 text 契約，121／4096 字舊版本不被截斷、不使全表無法載入。此 RPC 不回傳持久化 scope receipt，不誤稱其已提供該證據。200 批上限與缺少真正歷史分頁仍待改善。
- 店務摘要：55 秒前景、有連線、非展示且無其他作業時讀取；無新來源最多兩次重試，再轉人工。來源時間才是資料新鮮度，不把 `router.refresh()` 視為資料已更新。正式 Finance gateway／同店映射仍未完成。
- 實際 Chrome 發現並修正 Node／Chrome 不同日期分隔符造成的 hydration 錯誤。確認視窗白字／亮橘原對比 2.61:1，改用既有深橘 token；只限確認視窗及人工觀察按鈕，Finance header／sidebar token 與幾何不變。店務 date／month 與身體 datetime-local 明示為既有 native 具名例外；使用原生選單不代表 popup 與 Finance 像素相同。

## 本次重新執行的工程證據

- 修改中途的全量回歸曾失敗，修正後的第一個凍結切片為 476 檔／6,220 項全通過；不是後續全部修改的最終證據。
- 138 份 migration、128 份 portable SQL 測試／5,933 項斷言通過。包含 93 套舊式開通替代 fixture 與 35 套強制開通 fixture，不等於 hosted Auth／RLS 驗收。
- PostgreSQL 17.11 十套隔離 native 回歸全部通過，沒有替換登入判斷。包含 104→138 保留既有合成資料、真正 backend 等待期間撤銷、量表 50 個同人員連線一筆提交／49 次重播、完整資料指紋及 RLS／ACL／trigger 的第二庫還原約 1.492 秒。不等於正式 PITR、50 位員工 HTTP 壓測或七年資料量。
- 本機安全展示 89/89 路由 smoke 通過，不能當作每頁功能完整。
- Finance 的 14 檔候選精確恢復，patch SHA-256 `0da01f7709a81130c3662a9bb80f6a8d8bb5969649e85af1da832e504e627014`；42 adapter、22 lineage、16 SQL 與真正 Deno／PostgREST／PostgreSQL 的 16 情境、20 HTTP／8 附加探測重新通過。原 dirty Finance checkout 未套用，也未 hosted 部署。
- 申報真實 Chrome 合成 UI：原生 top-layer、取消焦點、46px select、390px 無水平溢位、未知結果／重新掛載／權限 ABA／跨分支遮蔽／相同鍵與內容回查／已確認舊清單／只讀刷新通過。假的 HTTP 回覆不證明正式 Auth、SQL 寫入或 Finance。
- 身體評估真實 Chrome 合成 UI：選個案建立文字草稿、未知→重新掛載→拒絕→成功均沿用相同鍵和 payload；跨分支不顯示原個案；成功後保留舊清單限制，完整新快照才解除。日期測試輸入經原生 setter＋事件注入，未將該項稱為真人日期選單驗收。
- Chrome／axe 4.12.1 的 scoped 確認視窗與身體工作區自動檢查各為 0 違規，但有 color-contrast incomplete（重疊／被遮蔽元素）；不是全站或人工 WCAG 2.2 AA 通過。
- `DESIGN.md` 官方 lint 為 0 errors、7 orphaned-token warnings：本專案 Model B 的 runtime CSS 是唯一 token owner，文件引用不由元件 token map 自動產生。沒有隱藏警告或新增重複色碼。

原生 JSON、畫面及 scoped audit 保留於 `/Users/seniorlifepr/.codex/verification/daycare-20260926`；其中皆為合成證據，不包含真實個案或憑證。

## 最終凍結來源驗收（16:42–16:45）

- 全量 Vitest：482 檔、6,298 項全通過，無略過，耗時 140.99 秒。執行前提供精確恢復的 `FINANCE_CONTRACT_REPO`，沒有以其他 Finance checkout 補位。另有 jsdom 不支援整頁導覽的診斷輸出，沒有隱藏；其不代表真人瀏覽器通過。
- 全量 ESLint（零 warning）、TypeScript 及 `git diff --check` 通過；最終 production build 成功，101 個靜態輸出完成。最後修改後再跑 TypeScript 通過。
- 專案既有頁 82 靜態規範及申報／身體／店務／共用 guard 的 12 份精確來源 scoped audit 均零 findings。鏡像來源的 SHA-256 清單與 JSON 報告留在證據目錄；不將鏡像的 native 日期例外套到其他未驗收頁。
- 最後身體評估 scoped 測試 67 項、申報 51 項均包含於全量回歸。Chrome 再驗取消焦點、共用原生模態、重新掛載、跨分支遮蔽、未知後拒絕保留及相同鍵／內容回查；新完整快照解除身體標記，新申報資料移除草稿後不再殘留「清單尚未更新」。
- 手機 390px 重新驗證人工觀察 select／input／textarea 為 16px、控制高度約 46.78px、textarea 80px 且不可拖曳；頁寬 390px。保存通知只保留版次／狀態，回執 UUID 仍在服務端與 journal，不再常駐現場畫面。瀏覽器錯誤清單為空。這不是全 89 頁的人工無障礙認證。
- 頁面 smoke 原先錯把带 `tabindex` 的正確 H1 判成缺失；已改為靜態 DOM 的實際 H1 精確比對，三項測試排除 script、跳脫文字及錯頁標題；89/89 再跑通過。此項只是路由載入，不是功能完整或權限驗收。
- 最終 production build 在本機啟動成功；刻意清空全部雲端憑證／整合設定並關閉展示。Chrome 登入頁正常、無錯誤；Google 按鈕因未配置而停用。未登入業務入口為安全錯誤／未配置狀態、不含合成個案，POST 400／503 且 no-store。不能把這項隔離啟動當作正式 Google 登入、hosted API 或員工可用證據。

## 新鮮雲端核對與不能自行解決的事項

- Supabase 唯讀專案中繼資料：現有專案 ACTIVE_HEALTHY，仍為首爾 `ap-northeast-2`，不是東京；hosted migration 130 項，最新 `20260925141114_governed_questionnaire_drafts`。本機 138 的八份增量未套用。
- Vercel 指定團隊／指定專案的一次實際查詢回 403，現有連線未獲 `entrepreneur-9585s-projects` 範圍授權；團隊清單為空。不是專案不存在。未使用曝光 Token，未更動團隊、方案、區域或帳號。
- GitHub 追蹤 workflow 只有檢查；README 記錄 main production，但目前 Vercel production branch 與預覽保護無法核對。因此未盲目推分支，避免未知自動部署。
- 正式上線還缺：員工真登入／高風險政策、正式量表及完整 89 頁、官方申報實檔／回覆對帳、Finance 同店範圍與 hosted connector、CMS WORM／掃毒、hosted 還原、法遵、七年資料／平行申報及多人 HTTP 測試。
- 不自動新增收費資源；區域／商用方案須由負責人決定，真人專業覆核不得用合成員工代替。

本次未 GitHub push、觸發 Actions、Vercel preview／promotion、hosted DDL、匯入真實個案或新增費用。
