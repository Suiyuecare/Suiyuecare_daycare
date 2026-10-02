# 公告搜尋與分頁候選验收

日期：2026-09-26。頁68、授權管理者與公告收件者的讀取切片。**未正式部署、未寫入hosted Supabase、未推GitHub，不代表89頁全部完成。** 正式門檻仍見 `PRODUCTION_GATES.md` 及 `FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md`。

## 修改與前後差異

舊v1只載最近100筆，本地篩選不能找到後面的公告；收件明細又依賴當頁owner。新v2一次經稽核取得伺服器搜尋、狀態、符合總數、20／50／100筆分頁，以及獨立目前發布版明細。上方全授權統計与清單篩選總數明示不同口徑；使用者不必理解資料契約。無資料、無符合、條件錯誤、讀取失敗不混為同一狀態。

仍沿用Finance AppShell／tokens／table／手機cards，沒有重製header／sidebar。搜尋只在套用或X清除時發GET，字元數與IME受保護；手機搜尋整行，輸入16px／44px。清除保留狀態與每頁筆數，重設第一頁。分頁與明細保留原篩選；重新套用移除舊明細。不新增硬刪除、creator-only限制或草稿／發布／撤回的前置列表授權。

## 最終本機工程證據

- 全量Vitest：491檔／6,459項全通過；`FINANCE_CONTRACT_REPO` 指向獨立Finance候選。jsdom仍有不支援整頁導覽的診斷，未把它當真人瀏覽器證據。
- 全量ESLint零warning、TypeScript及production build通過；101個靜態輸出。是本機build，不是Vercel部署。
- Portable SQL：139份migration、129套／6,001斷言全通過。其中93套歷史PGlite-only開通替代fixture、36套強制開通；本次新增68項使用真開通規則，沒有替換權限函式。
- 本機PostgreSQL17.11：11／11 native gates全通過。公告原樣139份migration、68項SQL全部通過；真正獨立backend在audit等待時新增第251筆或撤銷登入開通，舊snapshot均42501、不回傳筆數／資料、不留下成功查閱audit。合法新增草稿保留，不將真實另筆異動回滾掉。無SQL相容轉換、無雲端連線。
- 第二位代理獨立複跑本次68項及檢查grants、pinned search_path、actor來自auth.uid、先後授權與snapshot重查；未發現新增讀取阻斷。
- 舊mutation API源碼不變；新增測試確保不在列表中的授權ID仍走原RPC。250則／13頁全ID無缺漏，邊界時間、查詢／wildcard字元、非法參數、非當頁owner、跨分支／非管理者明細拒絕等有回歸。
- 既有premium規則治理／共用UI範圍strict audit零finding。新增`premium-announcements.json`擴至整個公告工作區的report audit**仍有5項違規**：舊actions兩個form未遷canonical validation、三個textarea未宣告canonical不可拖曳。完整公告範圍不可標記strict通過。

## 實際Chrome合成UI

固定250則合成公告，無真人帳號、無API／DB、寫入按鈕停用。fixture使用實際AppShell／Workspace／CSS與假資料分頁；不替代真正Next登入／RSC／Supabase／mutation驗收。

- 1440px與390px各有相同250則資料、空篩選／首筆內容的前後畫面；before是Git `3738dfe` workspace，仅前100筆。新手機搜尋寬324px，頁寬390px無整頁水平溢位；native select／search16px、44px。
- 真fill／select／click提交`250`／published／50筆，找到第250則；打字未導覽、X立即清空但保留其他條件。121個ASCII字元Enter保留輸入／聚焦／inline錯誤且未導覽；120個emoji完整接受，未截半。
- 第13頁顯示241–250／共250，10張卡、下一頁停用。`q=001`仍能讀到第250則獨立owner與三位合成收件者；沒有把第250則塞入篩選列表。
- IME測試透過Chrome注入composition事件，clear在組字時停用、Enter被攔截、結束恢復；不是實體輸入法真人驗收。條件錯誤／讀取失敗／查无符合具各自可操作出口，應用錯誤清單為空。
- 原生select popup接受平台行為；表格内部横向捲動為既有具名例外。沒有宣称全89頁WCAG2.2AA、offline或真載入中網路行為已通過。本輪未重跑axe；早先別頁的axe不能套用。

證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-20260926`。本輪檔名`announcement-final-*`、`announcement-paging-final-*`、`announcements-native.json`與`announcement-workspace-premium-audit.json`。原native各suite runtime路径保留在完整log；cluster已停且只清除自己建立的臨時data。

## 未完成與下一切片

1. **公告未知寫入安全：** 舊actions逾時後容許關閉／修改，開啟或修改旋轉鍵、卸載遺失原鍵；跨頁重試可能重複產生版本。需要memory-only pending journal、固定原scope／actor／payload／key、attempt token與scope epoch、shared lease／navigation／unsaved guards、安全logout清理。
2. **共用表單／模態：** 遷GovernanceDialog、明確捨棄未送出的草稿、canonical validation與textarea；未知結果不能藉捨棄或新鍵繞過。獨立workspace回復入口不依賴當頁row尚存在。
3. **成功但清單尚未更新：** 保留confirmed marker，只靠同範圍有效快照正面包含相應版本／更高版本／本人已讀回條才解除；filtered／paged absence、router.refresh或權限ABA不能當成功證據。
4. **分頁限制：** 現在是live OFFSET，跨頁新增／改版可能移動，不是不可變歷史export；不承諾七年移轉筆數驗收。
5. **正式配對發布：** 新前端依賴新增v2RPC，不fallback舊100筆。須先在保護預覽驗增量migration／真員工HTTP／權限，再配對發布。雲端權限、區域決定、正式量表、CMS安全封存／掃毒、申報實檔、Finance hosted同店、評鑑、家屬、備份／回補／多人HTTP等門檻未被這個切片解決。

不可只加noValidate消除audit，也不可移除原權限／AAL2或以合成規則核准冒充正式證據。使用者題庫授權已確認，不重問授權；臨床採用與真人營運驗收仍獨立。
