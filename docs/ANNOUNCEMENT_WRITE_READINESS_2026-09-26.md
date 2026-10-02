# 公告操作安全復原（頁68）

本文件只記錄本機候選的工程驗證，不是正式環境、實際員工授權、通知投遞或所有89頁上線證明。前一輪固定原寫入不變更資料庫；本輪R1新增只讀原操作回查API／RPC及一份migration，仍保留角色、近期AAL2與既有公告生命週期。

## 缺陷與改善範圍

舊版操作鍵綁在單列元件，逾時後重新開放編輯／取消，重新開啟或卸載後可能失去原鍵。新候選使用分頁記憶體journal及常駐workspace coordinator；草稿、發布、撤回、已讀共享操作入口與既有無資料navigation lease。

- 首次發送前凍結帳號／機構／分支、來源版本、內容及操作鍵，結果不明只提供原操作的手動重試。
- 確定第一次未提交的拒絕才能釋放；此前曾結果不明時，後續403／409不能證明前一次未提交。
- 格式正確但公告鏈或版本錯誤的成功回應也不是成功。回條沒有機構／分支／使用者欄位，不冒稱回條本身證明身分；由固定請求、全域權限epoch及伺服器重新授權共同約束。
- 重新掛載不自動送出；跨分支／帳號／模式不顯示原內容。登出清除本分頁資料並使舊回應失效，只釋放公告自己持有的鎖。
- 成功回條不等於清單已更新。相同公告的舊操作暫停，須取得同鏈的更新版本或本人已讀時間正向證據；分頁未包含該列不是更新證據。
- 表單沿用GovernanceDialog與useUnsavedChanges，不新增巢狀彈窗或瀏覽器confirm；錯誤連結欄位，中文組字不誤送出。

## 已驗證的安全機制

以下結論來自本機程式覆核及聚焦測試，不是正式資料庫或真人登入驗收：

- **固定身分與來源：** 機構、分支、使用者 UUID 正規化，展示模式不可寫入；目前觀察到的帳號／分支必須與操作身分相同。修改草稿、發布、撤回與已讀各自綁定實際來源 ID；已讀綁定目前發布版本，不會誤用較新的私人草稿。來源不符在取得鎖之前拒絕。
- **固定重試內容：** 首次確認送出後，內容、動作及操作鍵凍結於本分頁記憶體。逾時、無法解析或錯鏈／錯版本的 2xx 均保留未確認操作；元件卸載、列消失或清單載入失敗後，仍能在原授權範圍手動回查，且不自動 POST。重試的操作鍵及序列化內容完全相同。
- **拒絕不抹除先前的不確定性：** 可核對的第一次 403 拒絕會釋放本操作的鎖，不宣稱已保存；操作此前曾結果不明時，後續拒絕仍保留原操作及鎖。一般錯誤不被當成確定未提交。
- **晚到回應與 ABA：** 身分、分支、權限、驗證或操作能力變動使用單調遞增的 epoch，另核對操作 token、單次 attempt 及隱私 epoch。先失去授權再恢復，或登出後換人建立新操作，舊回應都不能顯示成功、刷新新範圍或釋放新操作的鎖。發布／撤回的近期 AAL2 也在實際回應邊界重新檢查。
- **共用作業鎖與離開防護：** 其他作業已持有共用鎖時，公告不能開始新寫入。未確認操作防護一般同分頁連結、跨來源入口、GET 表單、submitter／target 覆寫及可取消的瀏覽器導航；「回待確認清單」只關閉操作視窗，不放棄操作或鎖。完整重載／關閉只能提供瀏覽器離開警告，不能保證攔截或復原。
- **成功後仍需讀取證據：** 有效回條建立 confirmed marker；`router.refresh()`、刷新已排入佇列、空頁或該列不在當頁，都不能解除 marker。只接受較新、有效且同範圍的同鏈版本，或同發布版本的本人實際已讀時間。真正取得正向證據後，未更新警告才消失並顯示清單已確認更新。
- **操作資格與表單：** 排程中公告不能提前標為已讀；到期草稿不能發布，確認視窗開啟後跨過到期時間也在第一次 POST 前阻擋。必填、時間、有效受眾及修改／撤回理由有欄位錯誤與首個錯誤聚焦；中文組字期間不提交或誤關閉。未知結果的內容唯讀，僅能回查同一操作。
- **登出隱私：** 登出先清除公告 journal，再進行非同步登出工作；隱私 epoch 立即隱藏原編輯視窗，舊回應不能重建已清除的操作。正式 AppShell 立即停止顯示個案與員工畫面；只釋放公告自己持有的鎖。

## 驗收方式

| 情境 | 通過條件 |
|---|---|
| 重複點擊／桌機手機重複入口 | 一次送出；其他寫入及分支切換不能穿過共用鎖 |
| 逾時／壞回應／錯鏈成功 | 顯示結果未確認；內容與鍵不變，不允許改內容後以新鍵送出 |
| 重新掛載／換篩選 | 仍有原操作回復入口，沒有自動POST |
| 權限或範圍ABA | 舊回應不顯示成功、不清除新操作；恢復原身分後才可原鍵手動重試 |
| 已保存但舊清單／非當頁 | 保留更新提醒及相關操作防重送；同鏈最新正向證據才解除 |
| 排程已讀／草稿已過期 | 動作不誤開放；確認途中跨過草稿到期時間也不產生第一次POST |
| 編輯未送出離開 | 明確捨棄確認；取消保留原內容與焦點 |
| 390px／鍵盤／組字 | 16px輸入、可到達44px操作、不溢出；Escape、焦點返回、錯誤聚焦與IME不誤觸 |

## 證據與限制

### 本機聚焦驗證

獨立覆核後重新執行以下 7 個測試檔，**115／115 通過**：

```text
pnpm exec vitest run \
  src/components/staff-announcements/staff-announcement-controller.test.tsx \
  src/components/staff-announcements/staff-announcement-actions.test.tsx \
  src/components/staff-announcements/staff-announcements-workspace.test.tsx \
  src/components/app/app-shell-logout.test.tsx \
  src/lib/staff-announcements/pending-independent.test.ts \
  src/lib/staff-announcements/pending.test.ts \
  src/lib/staff-announcements/date.test.ts --maxWorkers=2
```

其中獨立回歸測試使用實際 canonical 身分簽章，驗證 B 身分已被觀察時拒絕 A 的開始／重試、登出後 A 的晚到回應不能影響 B 新操作，以及四類動作的錯誤來源 ID 在取得鎖前被拒絕。測試使用合成資料、實際 React 元件及 canonical GovernanceDialog；jsdom 的對話框平台方法有測試替身，不等同真實 Chrome 的焦點、原生離開警告或螢幕閱讀器驗收。

### 最終凍結工程與 Chrome 驗證

- 最後補齊首次明確拒絕的彈窗內錯誤，以及原按鈕停用時由公告owner指定的焦點備援。共享Dialog先回可用原控制，再回同區段anchor，最後才回明確指定的connected／非hidden／非inert備援，不全域搜尋。32項共享Dialog回歸、包含此owner連接的11檔／196項公告聚焦測試全部通過。
- 最終全量Vitest **495檔／6,556項通過，53.74秒，無略過**；Finance跨repo使用精確恢复候選。ESLint零warning、TypeScript及本機production build通過，build移除Supabase／LINE／Finance／AWS外部憑證並關閉展示與Google整合，不連正式雲端。公告／共享UI的premium strict配置0 findings，只涵蓋該配置規則與sourceRoots；不使用前輪結果替本輪來源背書。
- 本輪重跑相同139份migration的portable SQL：129套／6,001項斷言通過，包含93套legacy PGlite fixture與36套enforced開通fixture。原生PostgreSQL17.11共11／11套通過；包含真正獨立backend、撤權途中拒絕／回滾。公告精確native套件68／68；本輪沒有SQL source或hosted DDL變更。
- Chrome 390×844：dialog寬354px、自然內容可捲動；文字／日期16px、input46px、textarea不可拖曳；無頁面水平溢位。首次焦點在取消，必填錯誤0POST且聚焦標題並關聯錯誤；未保存確認Escape保留內容且只有一層open dialog。桌機1440×1000另保留畫面。
- lost ACK→重新掛載→手動403→手動成功：總共3次合成POST、1個操作鍵、1份完全相同body。未知時Escape不能關閉／編輯，view-only返回不丟棄journal；成功後焦點實際在「公告操作回查」section而非BODY。非當頁缺列仍保留防重送；取得同鏈正向快照才解鎖且移除誤導的舊清單提示。
- 第一次403錯誤在仍開啟的彈窗內可見，取消及欄位恢復；權限ABA的遲到回條0refresh、不顯示成功，失權時不顯示原內容。Chrome console errors為0。IME與發布／已讀來源版本在React及domain回歸測試驗證；沒有將假API宣稱成真正計時逾時、SQL提交或官方通知驗收。

合成瀏覽器 API 只證明介面控制及假回條復原，不證明真正 Google 登入、Supabase 提交、RLS、通知投遞、RSC更新或公開網域發布；未重跑本頁axe，人工螢幕閱讀器／完整WCAG仍待驗收。完整紀錄保留於私有目錄 `/Users/seniorlifepr/.codex/verification/daycare-20260926`，前綴 `announcement-write-`，包括測試／build／SQL log、strict JSON、before／after與final手機桌機圖、`announcement-write-browser-final.json`。畫面與測試不含真實個案資料。

### 尚未完成的正向回查與復原邊界

1. **歷史已讀的保存查證與清單同步分開：** R1已可依本人原鍵查證舊發布版、原已讀時間及原結果，即使後來發布新版或撤回。但精確原操作回條不是最新來源；防重送marker仍保留，目前清單／目前發布版明細也可能已無舊版。尚需最新同鏈定位及舊已讀guard完成路徑，不能憑新版、消失或回查成功直接放寬舊來源。
2. **篩選外的新公告：** R1已可不依目前篩選／分頁查證本人原成功操作，但沒有最新公告定位／載入入口。重新載入相同篩選不保證包含它；仍需取得實際同鏈新資料才能解除來源防護。
3. **32 個 marker 上限：** journal 全域最多保留 32 個尚未由正向讀取證據解除的 confirmed marker。達到上限時，新操作在取得鎖之前拒絕；不自動淘汰、假裝更新或用新鍵繞過。未解決的歷史回條／篩選外公告可能累積至此上限，屬正式營運前仍須驗收的可用性限制。
4. **只支援同一分頁記憶體復原：** React 卸載／重新掛載不等於完整頁面重載。完整重載、瀏覽器關閉、程序終止或另開分頁後，journal 無法復原；不為保存操作鍵而將公告內容寫進 localStorage、sessionStorage 或 history。瀏覽器警告不保證攔截，且沒有跨分頁／跨裝置操作協調或自動補送。

上述限制不得以清空 marker、關閉防護、重新建立操作鍵或放寬授權來假裝解決。正式部署仍須通過[全部上線門檻](PRODUCTION_GATES.md)；本文件不宣稱頁68所有正式作業、全部89頁或正式部署已完成。

## R1：原成功操作的獨立只讀查證

此輪增量為`20260926105727_staff_announcement_operation_receipt.sql`及`GET /api/staff-announcements/receipt`。操作鍵及一次性nonce使用header，不入URL；不接受指定別人的actor、不讀取正文、不呼叫公告寫入／replay RPC，也不使用service_role。原帳本、原不可變結果版及本人已讀回條逐筆核對；只回最小版本／動作識別與三種明確時間，不回標題、正文、受眾、雜湊或驗證資料。只新增查閱稽核，非業務寫入。

SQL依目前有效員工、機構／分支及原動作的read／manage／publish權限查證；發布／撤回仍要求近期AAL2與原已消耗但未失效驗證。稽核後重新檢查授權。查不到回`not_found/persisted:false`，不能表示原操作失敗／不存在進行中交易。

client保存原操作鍵、來源與結果版，精確核對nonce、身分範圍、動作、版本及原業務時間。查證只標`verifiedAt`；同一時刻只有一個手動GET，與公告寫入互斥。錯綁、403、未知錯誤／逾時、卸載、登出與權限ABA不會清除marker或解除新操作。UI沿用Finance框架及既有按鈕，只顯示動作與狀態；成功為「原操作保存已查證；清單仍需更新」。

### R1最終凍結驗證

- 最終全量Vitest **497檔／6,662項通過，180.09秒，無略過**。Finance跨repo使用精確恢復候選；jsdom整頁navigation未實作的診斷仍保留，不把它當作真瀏覽器證據。完整ESLint、TypeScript與production build通過；build明確關閉展示／synthetic preview／Google整合並移除Supabase、LINE、Finance及AWS外部憑證，不是正式登入或雲端部署驗收。
- API新增28項路由測試；焦點與token凍結後，独立覆核另跑controller／pending **100／100通過**。公告及共享UI的premium strict配置0 findings，只代表此配置規則與sourceRoots，非全產品可用性或安全掃描。
- 本輪**140份migration**重新編譯。Portable SQL **130套／6,055項斷言**通過，含93套legacy PGlite-only及37套enforced開通fixture；原生PostgreSQL17.11 **11／11套**通過。公告原套件68項、新receipt套件54項及3個真正獨立backend探測通過；查閱稽核等待途中撤權拒絕釋放回條，交易回滾，業務寫入0。這些不是正式Supabase／PITR／50人HTTP壓測。
- 最後一版Chrome 390×844與1440×1000使用實際元件及loopback合成API。390px頁面scrollWidth=390，重新載入按鈕118×44。未找到回條、錯nonce、403及權限失去→恢復後的晚到回覆均不冒稱成功；同一原鍵總共5次手動GET使用5個不同nonce，整段只有原本1次POST、1次原保存後refresh，查證成功不额外POST或refresh。
- 真Chrome重現並修掉查證按鈕成功後被移除而焦點落到BODY的問題：原按鈕仍持有焦點才回到具名「公告操作回查」section；使用者已移到其他link時不搶焦點。回復請求綁定原check token及身分／權限／隱私epoch，舊失敗不能清理新操作。沒有全域搜尋、延遲聚焦或版型變更。
- 未知原寫入不開放R1 GET，無自動送出；手動重試共2次合成POST、1個key、1份相同body、0 GET，成功後只有真正同鏈正向來源才清除marker並顯示清單更新。Chrome errors命令無錯誤輸出；未執行本頁axe或人工螢幕閱讀器，不能宣稱完整WCAG。
- 本機Supabase CLI安全顧問先因Unix socket URL解析失敗；另一次經socket／TCP核對同一隨機DB、程序、埠與sentinel的127.0.0.1替代連線仍因CLI強制TLS而失敗。**沒有advisor findings，不稱顧問通過或警告0**。兩次失敗证据分别保留於`/tmp/daycare-announcement-advisors-native.8kx7QB`及`/tmp/daycare-announcement-advisors-tcp.RFQ9Wb`；程序已停止，未碰hosted資料或放寬安全設定。

R1原始證據在私有驗證目錄，最後凍結檔前綴`announcement-receipt-focus-final-`；Chrome紀錄見`announcement-receipt-browser-final.json`，portable／native另保留同輪log。此前「最終凍結」495檔／139份等段落是前一輪歷史，不替本輪背書。

### R1仍未涵蓋

- 結果不明的原寫入仍只有原body／key手動POST重試；未實作payload-bound唯讀查證。
- 查證成功不移除舊來源guard或提高32上限；最新來源定位與歷史已讀guard的安全完成仍待下一階段。
- 完整重載時，未提交操作的key／body不能靠成功帳本恢復；尚需durable intent及明確執行流程。沒有寫入瀏覽器儲存或自動補送。
- 本機隔離DB、合成API及瀏覽器驗證不證明正式員工Google登入、hosted RPC、RSC清單刷新、通知或全部89頁上線。
