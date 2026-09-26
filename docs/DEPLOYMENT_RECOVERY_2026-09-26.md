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

## 第二輪：未保存保護與分支確認（仍未部署）

- 共用 registry／hook 與人工觀察編輯器：精確比較可編輯基準值，取消／Escape 保留內容；明確捨棄後才刷新、切換編輯或前往其他工作。只有一個 dirty owner 能被確認；未知寫入／視圖鎖優先。來源、身份、角色、指派、卸載及安全登出使舊操作失效；不重播 POST、不把 POST Navigation 轉 GET、不寫 browser storage／history。
- 分支切換移除 native confirm，沿用共用 GovernanceDialog；確認關閉與清理後才進入既有原子切換防護。POST 前再次檢查新未保存 owner、目前分支與選項；未知 503 仍遮蔽舊工作區，只提供安全重新載入，不重送切換。
- Chrome 發現工作區 button CSS 會把取消與危險操作蓋成同一橘色，且手機「繼續填寫」拆字。本輪以共用 dialog specificity 修正，沒有改 Finance frame。390px 實測白底取消／淡紅危險按鈕，高度 45.28px，取消文字 nowrap，頁寬仍為 390px。
- MNA-SF 測量缺漏不能把已存在的非法答案狀態降成 incomplete；改為保留 invalid，但仍不提供分數／分級。不啟用官方規則或正式簽署，不稱為完整版 MNA。
- 獨立窄範圍覆核確認 logout owner 先 detach、異常回呼隔離、舊 token 不移除新 owner、分支最後檢查與 POST-origin Navigation 不重播；獨立四檔 70 項通過。這不是全部角色／89 頁／正式雲端安全認證。

### 第二輪第一個凍結切片的工程及瀏覽器證據

- 全量 Vitest：485 檔／6,365 項全部通過，52.74 秒，無略過；Finance 跨 repo 使用精確恢復的候選。此數字只涵蓋本切片，後續量表狀態顯示修改須另跑，不混用。
- ESLint 零 warning、TypeScript、production build 通過。build 是本機編譯，不是 Vercel 部署或正式登入。
- 真實 Chrome 合成 UI：取消／Escape 留下原理由且 0 POST；明確捨棄後 header refresh 恰 1 次、編輯器關閉且 0 保存。未保存→捨棄→分支確認各階段僅 1 個 open dialog；分支取消恢復選項焦點、0 POST；明確切換後合成 503 僅 1 POST、舊編輯器不可見。fixture 明示為合成，不連 hosted Auth／SQL、不改正式 cookie。
- axe 4.13.0 scoped 未保存確認視窗，桌機／390px 均 0 違規、0 incomplete；僅限此視窗，不擴大為整站人工 WCAG 2.2 AA。
- strict premium 官方配置 0 findings；只涵蓋維護配置的規則治理／共用 UI，不宣稱新增 hook 或所有89頁自動通過該靜態配置。
- 原始紀錄、axe JSON 及新畫面保留於持久化證據目錄，檔名前綴 `unsaved-`／`body-unsaved-`／`body-branch-unknown-`。本輪無 SQL source 變更；先前 native 十套結果保留原有範圍，不改称本輪重新執行。

### 新確認但尚未完成的業務缺口

- 公告清單的 RPC 只取前 100 筆，篩選在客戶端，較舊已授權公告的版本入口可能被誤拒；尚需新的 server-side 篩選／分頁／直接明細授權與 101／250 筆回歸，不是只改錯誤文字。
- 評鑑管理雖有第79頁入口，正式證據指派、複核、發布與不可變送出快照流程仍未完成；不得將 fallback 工作區解除封鎖冒充功能完成。
- 家屬端正式發布、官方申報實檔及完整MNA／其他官方量表仍沒有通過證據。完整表單、真人核准、hosted 還原與實際員工驗收仍為正式 gate。
- Vercel 403 與資料區域／費用選擇尚未取得新授權或決定，本輪沒有以相同失敗連線反覆查詢，也沒有使用曝光 Token 或新增費用。

## 第二輪最終凍結：草稿狀態與輸入文字

- ADL／IADL 重現已保存不適用狀態／理由不可見後，補明確狀態、原因編輯、清除與三種狀態分開計數。原因必填且符合原 API／SQL 的去頭尾空白1–500 Unicode字元；inline錯誤及第一個錯誤焦點，不先送POST。清除丟棄舊原因並回真正missing，不轉為零分；歷史版仍唯讀、未知回覆仍沿用原內容／操作鍵。題目、公式、正式啟用、簽署與授權沒有變動。
- 14項RED重現，最終編輯器49項及預覽20項GREEN。另由獨立覆核者重跑編輯器／預覽／API共107項通過，未發現新的窄範圍缺陷。新增的native radio／textarea沿用既有題卡，不是官方計分選項或正式規則採用。
- 最後Chrome發現原compact label使日期／文字答案只有14.4px；由現有questionnaire module統一修至16px，增加靜態規範回歸。390px的實際日期、補充文字及不適用原因都是16px；textarea不可拖曳、無水平溢位，不改Finance frame。
- 新loopback fixture以固定合成ADL／IADL草稿驗證原理由可見、空白理由0POST與錯誤焦點、清除真正missing、鍵盤切到合法零分答案、原版讀回唯讀。它不連雲端，不能證明正式登入、保存、簽署或規則已啟用。新欄位為required；Native confirm／舊量表離頁guard未遷移，不混稱已使用新共用確認。
- 最終全部來源全量Vitest：**486檔／6,389項通過，41.90秒，無略過**；Finance跨repo仍使用精確候選。jsdom整頁導覽診斷仍保留，不當成Chrome證據。ESLint零warning、TypeScript、production build及diff-check通過；build明確清空全部外部憑證、關閉展示及Google整合，沒有呼叫正式雲端。
- 另重新跑portable SQL：138份migration、128套／5,933項斷言通過，仍包含93套legacy PGlite fixture及35套enforced開通測試。SQL未改；十套native是同一SQL來源的上一輪證據，本輪未重跑，不擴大為hosted還原或50名員工HTTP。
- 安全本機展示89/89路由smoke再次通過；執行於本輪量表文字大小最後修改前，只是入口載入，不作最終表單作業證據。真正Chrome已重驗最終IADL16px與必填錯誤。正式依賴掃描當次無已知advisory，不替代滲透測試。
- axe4.13.0 scoped IADL表單桌機／手機，以及最後16px表單手機錯誤狀態，均0違規、0 incomplete；只限已測表單，沒有聲稱全部89頁或人工WCAG2.2AA通過。當前官方premium配置strict為0 findings，其sourceRoots未涵蓋整份量表編輯器，不將該綠燈當全頁認證。

最終證據檔為 `second-round-final-vitest-with-typography.log`、`second-round-final-build-with-typography.log`、`unsaved-portable-database.log`、`unsaved-dependency-audit.log`、`assessment-iadl-typography-final-*` 等。工作保留在獨立checkout，未套用原dirty Finance，未GitHub push、Actions、Vercel發布或hosted DDL。短版待辦見 [正式部署剩餘工作與驗收](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。

## 最新公告切片：讀取分頁與固定原操作

以上138份migration、舊公告100筆限制與第二輪數字為歷史證據，不能視為當前候選狀態。父提交03ecf2d已補server-side公告搜尋／分頁與非當頁目前發布版owner：本機目前139份migration，hosted最後唯讀盤點仍130份，九份增量尚未套用；没有新的雲端核對或DDL。

本次完成頁68 workspace-owned controller／journal，草稿、發布、撤回、已讀都固定原內容、操作鍵、scope与來源版；結果不明不放棄／新鍵重送。保護跨元件卸載、範圍／權限ABA、登出與晚到回條；shared confirmation、未保存內容與IME使用既有owner。第一次已知拒絕在彈窗內可見，原入口停用時焦點回owner明確指定的區段；不改Finance frame或API／RPC／近期AAL2政策。

- 最終本機全量Vitest **495檔／6,556項通過，53.74秒，無略過**；Finance跨repo用精確恢復候選，不改原dirty Finance。
- ESLint零warning、TypeScript、production build及diff-check通過。build移除外部憑證，关闭展示與Google整合；不是Vercel部署或真人登入。
- 本輪139份migration重新跑portable **129套／6,001項斷言**；93套legacy fixture、36套enforced開通fixture。原生PostgreSQL17.11 **11／11套通過**，包含139份migration、真正獨立backend与撤權競態回滾；不稱為hosted PITR、七年資料量或50人HTTP壓測。
- 最終Chrome實際390px操作：必填0POST、inline錯誤與first-focus、未保存Escape保留、unknown唯讀与原鍵回查；lostACK→403→成功的三次合成POST只有一個鍵及相同body。回條後舊清單不解鎖，非當頁缺列也不解鎖，正向同鏈資料才顯示更新確認；成功後實際focus在公告回查section，0console errors。16px輸入、46px高度、textarea不拖曳，无頁面水平溢位。
- sharedDialog32項與公告focused11檔196項通過，strict公告／sharedUI配置0findings。既有axe數字不冒充本輪新檢查；人工WCAG完整驗收仍未完成。

精確內容與限制見[公告操作驗證](ANNOUNCEMENT_WRITE_READINESS_2026-09-26.md)。歷史release已讀正向回查、篩選外新公告定位、32筆待回查上限及完整重載復原仍須完成；全89頁、官方表單／申報、CMS封存掃毒、Finance真正同店資料、家屬、正式災難復原、真員工與團隊發布授權等門檻没有因本切片通過而解除。原始本輪證據前綴為`announcement-write-`，保留在同一私有驗證目錄；無GitHub push、公開預覽、Vercel promotion、hosted DDL或新增費用。

## 後續R1：精確原成功操作的只讀保存查證

以上139份／九份未套用是前一輪狀態。本機R1新增CLI產生的`20260926105727_staff_announcement_operation_receipt.sql`，目前140份migration；hosted仍僅有前次唯讀130份的證據，**沒有本輪雲端重新核對或套用**。若仍130份，候選增量為10份，不冒稱正式環境已升版。

新增本人原鍵GET回查，嚴格核對機構／分支／actor／action／nonce／原來源與結果，不回公告內容或受眾。歷史已讀已被新版取代、撤回，或新草稿不在當頁，都能獨立查證其原成功操作。保留原權限／近期AAL2與原驗證證據，查閱前後均重驗；只有select稽核，不新增公告、讀回條、受眾或操作帳本。

R1只標保存查證，不拿它假稱最新清單已更新；舊來源防護及32上限保留。未知寫入唯讀查證、最新同鏈來源定位／guard安全完成、完整重載durable intent仍未完成。手機實測發現查證按鈕消失的焦點問題後繼續修正並重跑，沒有為了發布略過。

安全顧問單次本機嘗試因Supabase CLI將Unix socket URL誤解為資料庫名稱而回3D000，沒有執行任何advisor檢查；**不**稱零警告或安全顧問通過。此前該隔離PostgreSQL17.11已編譯140份migration；本輪精確權限／撤權測試不替代顧問或正式ASVS／滲透測試。失敗資料、stdout／stderr與證據保留於`/tmp/daycare-announcement-advisors-native.8kx7QB`，程序已停止，無hosted連線。

其後只另試一次不同的127.0.0.1 TCP機制，先以socket及TCP核對同一隨機DB、PID、埠與唯一sentinel；140份migration編譯成功，但CLI仍強制TLS而被隔離DB拒絕。沒有advisor findings或JSON結果，不稱安全檢查通過。證據保留於`/tmp/daycare-announcement-advisors-tcp.RFQ9Wb/evidence.json`；程序已停止，沒有再試、修改正式設定或讀取憑證檔。

R1焦點／token最後凍結後全量Vitest **497檔／6,662項，180.09秒，全通過無略過**；ESLint、TypeScript、隔離production build及公告／共享UI premium strict通過。140份migration的portable **130套／6,055項**（93 legacy／37 enforced）及native **11／11套**通過；公告68項原套件、54項新receipt套件、3個真正backend撤權／資料變動探測均有原始證據。Chrome手機390×844無水平溢位，原查證成功焦點回具名section但不搶別的link；not_found／錯nonce／403／權限ABA晚回覆不假成功。同一成功原鍵5個手動GET／5個nonce只查證不重寫，未知操作仍原key／body人工POST重試。詳見[公告R1凍結驗證](ANNOUNCEMENT_WRITE_READINESS_2026-09-26.md)；未做本頁axe或人工WCAG、不證明hosted登入／RLS／通知／RSC或災難復原。

原始證據前綴`announcement-receipt-`在同一私有驗證目錄；正式登入、hosted RPC、通知、全89頁及所有[正式上線門檻](PRODUCTION_GATES.md)未因本機切片通過解除。仍未GitHub push、公開預覽或Vercel promotion，無雲端DDL及新增費用。

## 護理安全切片開始前：新的唯讀雲端核對

前述團隊空清單／連線403是歷史狀態，不沿用為本輪權限證據。現在團隊清單成功取得 `entrepreneur-9585s-projects`；其專案清單只回 `suiyuecare-hr2`，不能當作日照專案。指定日照 `prj_eiwNI6buPlPXynMCWhatuzqxD74H` 的部署清單實際回403，故仍無可確認的日照部署、production branch或預覽保護。專案詳情工具的兩次不同參數嘗試均被 `idOrName` 轉接驗證錯誤拒絕，停止該機制，不將工具錯誤說成專案不存在／授權拒絕。

Supabase唯讀重新確認：`mmxqxsokpcdvuzmdhptg` 為 ACTIVE_HEALTHY、首爾 `ap-northeast-2`、PostgreSQL 17.6.1.166；migration130份，最新 `20260925141114_governed_questionnaire_drafts`。本機140份的10份增量沒有套用。沒有變更區域、方案、Auth、RLS或雲端DDL。

本輪正式專案security advisor成功執行，2026-09-26T11:28:18.760Z記錄185項INFO `rls_enabled_no_policy`、1項WARN `auth_leaked_password_protection` 未啟用；沒有把它稱為安全顧問零警告。無policy資料表可能是RPC-only fail-closed設計，尚須逐項核對ACL／RPC，不能直接稱185項漏洞；密碼保護與Google-only政策也需实际Auth設定證據。這是正式專案當前唯讀發現，不是本機140份schema的advisor報告，亦不取代ASVS／滲透測試。

本輪不使用曝光Token、不讀取憑證檔、不呼叫他系統發布，也不新增費用。日照部署授權與區域／營運門檻仍須解決；有用的本機臨床工作流程修正繼續執行。

## 護理員實際開通與原操作安全修正

新增CLI增量`20260926113847_nursing_approved_staff_admission.sql`，本機141份、正式130份的11份差異尚未套用。真正合成Google／session／AMR核准護理員在原基線仍被CEO-only護理入口拒絕；本機修正其限定機構、分支、護理角色、指派與MFA取得／簽署路徑。未放寬通用權限或驗證；伺服器使用護理專用四欄唯讀證據的原驗證時間。獨立覆核另抓出未生效主管角色提前提供view_all的漏洞，已在護理專用權限修正生效時間；有效主管合法唯讀保留。

頁51加入同分頁原鍵／原内容重試、共享確認與未保存保護、讀取鎖、scope／actor／指派ABA遮蔽、登出同步清除及晚回覆拒絕。保存回條不假稱清單更新。手機16px輸入／44px操作／first-error focus與IME；實測修正局部對比，不更改Finance frame。`manual-nursing-v1`仍是人工文字紀錄，不冒稱官方量表已完成。最終範圍與原始證據見[護理部署候選驗證](NURSING_WRITE_READINESS_2026-09-26.md)。

本輪另以正式資料庫唯讀系統catalog核對185項無policy INFO：private138表、public47表，anon／authenticated均無直接SELECT／INSERT／UPDATE／DELETE授權。這排除了該185表的直接表授權問題，不代表每個security-definer RPC安全或可用；仍需逐項驗收。保留密碼保護WARN，不稱零安全警告。個人範圍Vercel列專案另被connector管理政策拒絕缺少必填teamId；沒有假造團隊或繞過政策。指定日照403仍是正式部署授權缺口。

### 護理切片凍結與公告演示載入

護理修正保存於本機提交`3bc9bdb`：全量500檔／6757項通過，162.37秒、無跳過；精確Finance候選跨repo契約已納入。141份migration的portable為131套／6118斷言（93 legacy／38 enforced），native為12／12套，護理最終63斷言＋8組實際backend等待；lint、型別、隔離production build、diff-check及護理strict scoped audit均通過。早期6756加1項跳過、55項SQL、主動停止的portable日誌均不作最後證據。

逐頁檢查發現公告演示loader先套用正式read scope，但既有demo context只有合成scope，導致頁68錯誤。提交`40ccd98`只准`context.demo`進入原合成builder；保留filter／release驗證、正式無權限拒絕及API展示寫入拒絕。focused loader／API28項通過；其後本機安全demo的89／89路由通過。Chrome實際公告頁可見合成清單，建立／發布／撤回／已讀仍停用，沒有JS錯誤。

Chrome另開實際Next頁51（不是單元fixture）：390px有正確標題與合成內容、無overlay／JS錯誤／水平溢位，合成寫入按鈕停用。這只證明demo SSR載入／hydration，不能取代真人Auth、正式HTTP或量表簽署。正式build在沒有Auth時轉登入是預期保護，沒有為路由smoke在production打開DEMO_MODE。後續轉介UI修改須重新驗證89路由及全量回歸。

## 轉介原操作、手動只讀回查與最後凍結

頁39六個寫入動作移到workspace層共用journal；首次原來源／內容／鍵不因逾時、4xx、編輯或元件重掛而更換。共用未保存確認、IME防誤送出、16px／44px操作；AppShell在離開頁39後仍觀察權限，登出同步清除原操作與鎖。全域不含個資的generation watermark與privacy floor另修正「取得新資料後重掛舊props又顯示舊個案」的漏洞。

新增`GET /api/referrals/snapshot`只用原授權與稽核snapshot RPC；nonce／actor／scope／篩選嚴格綁定，no-store、拒絕redirect，不傳寫入鍵、不重播POST或釋放原未知鎖。GET失敗在編輯器關閉時也顯示；晚到GET不越過帳號、權限、指派、範圍及卸載界線。MFA政策及通用CEO-only入口沒有放寬。

Chrome真正Next頁39重現Node與瀏覽器的日期分隔U+2009／ASCII差異造成hydration failure；改以formatToParts明確組成固定年月日時分，390px新session再次載入無overlay／JS錯誤／溢位。最終demo89／89入口通過。這不是全部89頁可工作，也不是正式登入證據。

最終全量Vitest **505檔／6963項全部通過，215.70秒，無跳過**；Finance跨repo精確候選納入，lint零警告、型別、隔離production build、diff-check與轉介strict scoped audit通過。獨立9檔231項通過。SQL未變更，141份／portable6118／native12套沿用上一護理切片最後證據的範圍。

實際Chrome手機lost ACK→403→重掛→分支ABA→拒絕GET→合法GET→手動成功僅3POST／1鍵／1份內容，2GET不自動寫入；正向同鏈事件才解除舊清單防護，登出與舊資料再掛仍隱藏。桌機composition事件0POST；手動GET期間鎖住重試，卸載後晚GET不假成功，重掛仍保留unknown。axe僅開啟表單範圍：手機15、桌機12規則通過且0違反／0 incomplete，不擴稱全站人工WCAG。詳細來源及未完成邊界見[轉介候選驗證](REFERRAL_WRITE_READINESS_2026-09-26.md)，證據前綴`referral-`。

另以未覆寫授權函式的原生PG17.11、141份migration、真正合成Auth/session/AMR實驗確認：已核准非CEO社工登入eligible=true，但轉介snapshot仍42501；合法CEO對照可讀，停用／過期／session撤銷拒絕，0events／operations／outbox及0外部連線。該後端開通為待修P0，不能用上述UI與mock API測試假稱真社工可工作；頁28／29安全復原也仍待補。

此次仍無GitHub push、公開預覽、Vercel發布、hosted DDL、區域遷移或新增費用。指定Vercel授權、區域決定、官方量表／申報、CMS封存掃毒、Finance真同店、家屬及持續營運門檻均未因局部回歸通過而解除。

## 轉介限定開通：最新142份候選與全量回歸

原141份schema的非CEO社工42501阻斷已重現並限定修正；新增CLI產生的`20260926134208_referral_approved_staff_admission.sql`，不放寬通用登入、權限或近期驗證。轉介六動作、MFA取得與四欄實際驗證證據維持機構／分支／本人／session及生效時間；MFA挑戰锁後選定的原路徑在寫入證據後仍須有效，不能跨模組fallback。原操作重播、事件完成及snapshot稽核後再次核對目前指派與完整可見個案集合。詳細邊界見[轉介候選驗證](REFERRAL_WRITE_READINESS_2026-09-26.md)。

- 最新全量Vitest **507檔／7010項全部通過，214.53秒，無略過**；跨repo Finance使用精確隔離候選。jsdom整頁導航診斷保留，不冒充Chrome或真人登入。
- 142份migration的portable **132套／6182項斷言通過**；其中93套為legacy PGlite fixture、39套enforced開通fixture。這不是正式Supabase PostgreSQL或真Auth登入驗收。
- 原生PostgreSQL17.11 **13／13套全部通過**；最新護理64項、轉介63項及12组真正backend競態，包含實際驗證時鐘到期、跨模組MFA fallback拒絕與業務／證據回滾。獨立覆核另重跑轉介native63／12，以及四套enforced portable308項；無替換授權判斷。這不是50位員工HTTP壓測、hosted PITR或外部轉介送達。
- 全套ESLint零警告、TypeScript、隔離production build及diff-check通過。build清空外部憑證並關閉展示／Google整合，沒有正式雲端寫入。
- 最終真正Next頁39手機390px內容載入、無overlay／JS錯誤／水平溢位，展示寫入仍停用；89／89安全demo路由再通過，僅證明入口載入，不表示全部功能已完成。版型未在本切片變更，未新增全站axe或人工WCAG認證。

2026-09-26T13:56:32Z唯讀重新確認正式Supabase：ACTIVE_HEALTHY、首爾`ap-northeast-2`、PostgreSQL17.6.1.166、migration130份，最新仍`20260925141114_governed_questionnaire_drafts`。本機142份的**12份增量尚未套用**。Vercel指定專案403／預覽保護、區域決定、官方量表與申報、CMS封存掃毒、Finance同店、家屬及營運門檻仍未通過；沒有push、公開預覽、production promotion、hosted DDL或新增費用。

新唯讀盤點還發現：頁29新PATCH回200但前端要求201，可能把真正保存顯示為結果未知；頁28／29編輯會清除未知原鍵、無共享journal；兩頁原RPC仍有CEO-only開通阻斷。護理未知鎖／MFA復原與舊快照ABA仍需補。這些列為下一輪P0，不用本次轉介通過證據擴稱完成。

私有原始證據前綴`referral-admission-`；native最终摘要`referral-admission-native-final.json`及13套集合日誌保留於同一私有驗證目錄。臨時資料庫均已停止，僅清除各runner明確擁有的測試pgdata，日誌／備份／證據保留；未刪除正式或使用者資料。

### 社工新寫入回覆的跨層契約修正

頁29實際PATCH新紀錄回200，但真正前端parser只接受新寫入201／原鍵重播200。新增跨層測試重現六種PATCH動作全部失敗（6 RED、10原有／create通過）；API改為依真正DB `replayed`旗標回201或200，未改parser、RPC、授權或近期AAL2。六種動作各驗新寫入／相同鍵重播，另驗create兩種回覆，實際API response經真正client parser全部通過；最終API／domain兩檔22項、該兩個API來源ESLint零警告通過。原始RED／GREEN日誌`social-work-http-contract-*`保留；這不代表原生社工開通或頁28／29未知寫入journal已修，兩頁後續變更須另凍結驗證。

## 社工兩頁限定開通與共享操作候選

最新本機143份migration；相對最後一次2026-09-26T13:56:32Z hosted130份唯讀證據有13份未套用候選，不稱新的live核對。頁28／29新增固定原內容／鍵journal、共享modal／未保存確認、AppShell跨頁authority與登出清除；限定真正核准非CEO社工的原scope、角色、指派及同session簽署證據。獨立review抓出same-generation指派撤銷ABA及sign-only誤示唯讀，均RED／GREEN修正。詳見[社工候選驗證](SOCIAL_WORK_WRITE_READINESS_2026-09-26.md)。

- 原生PostgreSQL17.11全套 **14／14** 通過，143份精確migration；新社工84項＋21實際backend探測、原轉介63／12、護理64／8均GREEN，沒有替換授權predicate。custom print五分鐘TTL測試單captured clock修復後67項／12探測通過；lifecycle測試真正factor後同步JWT時間的窄修，66項／6探測通過。
- 四個實際變動portable suite **280／280**（84社工、63轉介、66lifecycle、67print），0legacy overrides；不是正式Supabase或全133套最新通過證據。第一遍全套因舊lifecycle JWT時間fixture失敗，修復有142／143 deterministic RED與GREEN；第二遍全套主動停止，以精確變動回歸收斂，保留原日誌，不稱全量portable通過。142份的132套／6182項仍只是前一基線。
- 格式窄修前全量Vitest **511檔／7184項** 通過、523.17秒、無略過；之後頁29時間格式增加2項，最終社工121focused及心理社會96focused、獨立11檔240項通過。最新全量max3及max2跑次因ABCD大型表單5秒逾時主動停止，不稱完整來源GREEN；相同ABCD11項＋格式2項在max1隔離 **13／13通過、17.97秒**，未改test timeout或source。完整最新全量仍須在穩定資源／受保護CI重跑，不能把歷史全量與scoped結果加總冒稱一次完整通過。
- 凍結後lint零警告、型別、隔離production build、兩頁strict premium及diff-check通過。真正Next demo89／89路由通過；頁29ICU日期空白hydration問題已重現、修復、fresh Chrome重驗。合成Chrome兩頁desktop／390px、unknown→403→remount原鍵、same-generation指派ABA及positive history核對通過。沒有完整人工WCAG／真人Auth／正式保存證據。

所有完整正式上線門檻維持：未知鎖下GET／MFA復原、超出有界history的精確定位、完整重載intent、Vercel指定專案403、區域／DPA／商用備份、CMS WORM與掃毒、官方量表／申報、Finance同店真金額及家屬／持續營運。沒有GitHub push、Vercel公開預覽／promotion、hosted DDL、區域移轉或新增費用。所有owned測試cluster停止，成功runner僅清除明確owned pgdata；失敗資料及日誌／備份／證據保留。

## 頁28／29手動授權GET回查（最新候選，未發布）

在原unknown寫入鎖旁新增各自唯讀snapshot GET，原lease／key／body完整保留；共用private owner-aware read fence排除其他寫入與導覽。先驗實際權限再解析scope／nonce／filters，使用原audited loader及social專用recent證據；strict envelope／canonical authority／目前can*／新來源驗證。授權或壞回覆隔離舊資料、提高來源floor；純網路失敗明示非最新。卸載、登出、跨頁authority與privacy／filters ABA、晚回覆均拒絕，不POST、不中途換鍵、不假裝清單更新。獨立覆核找到頁28malformed200／untrusted source／503仍留舊內容的gap，已RED/GREEN修復。範圍見[社工唯讀回查驗證](SOCIAL_WORK_READ_RECOVERY_2026-09-26.md)。

- 最終凍結來源全量Vitest：**517檔／7389项全部通過，808.87秒，無略過**。maxWorkers=1且原timeout不放寬；Finance跨repo使用精確候選。不得再將上一段被停止的全量當目前結果，歷史日誌仍保留。
- 最終重新編譯Chrome fixture兩頁desktop1440×1000／mobile390×844通過：0POST必填／合成IME、unknown→GET403→remount→新GET→原key/body人工retry、malformed200隔離跨remount、in-flight read fence與branch ABA晚回覆、receipt／positive history分離，無JS錯誤／溢位、16px／44px。這是實際UI與假loopback HTTP，不是hosted Auth／RLS／持久化或完整人工WCAG。
- 私有證據`social-recovery-final-vitest.log`、`social-recovery-final-browser.json`、兩頁`social-recovery-*-premium.json`保留於原verification目錄。SQL未變更，143份／前輪native14套為原SQL來源證據，沒有本輪hosted核對或DDL。
- 凍結後全量lint零warning、TypeScript、strict premium兩頁零findings、diff-check及隔離production build通過，101静態輸出完成。明確清空外部配置並關閉demo，真正本機Next兩GET皆503／SERVICE_NOT_CONFIGURED、data=null、private/no-store；Chrome登入頁正常無JS錯誤且Google未配置按鈕停用。不是hosted401／403、真Google或RLS測試。證據`social-recovery-final-{lint,typecheck,build}.log`、`social-recovery-production-{denial.json,login.txt}`；owned server與browser已停止。

GET不取得MFA、不重建已改變的canonical context，也未解決fullreload durable intent、32個確認標記或有界歷程精確定位；護理獨立GET仍缺。所有正式門檻維持，包含未完成的評鑑頁79與家屬84–89真正資料／操作流程，不發布或新增費用。
