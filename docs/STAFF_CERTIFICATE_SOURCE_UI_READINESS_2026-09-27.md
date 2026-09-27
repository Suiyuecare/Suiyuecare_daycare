# 員工證照唯讀前台：部署候選驗收

## 結論

頁72新增獨立唯讀入口 `?view=documents`，可選擇授權證照版本並查看附件狀態。舊證照來源失敗時，非展示模式可進入這個獨立來源；不因此開啟原來只限執行長的建檔、修訂或例外核准。**這是已完成本機驗證的候選，不是正式雲端已發布，亦非完整證照作業已完成。**

沿用 Finance 的 AppShell、字型、顏色與共用卡片／欄位／按鈕；本輪沒有修改 AppShell 或全域版型。這不等於所有89頁已完成視覺或操作驗收。

## 功能與驗收邊界

| 功能 | 驗收要求與本輪範圍 |
|---|---|
| 授權來源 | 真正使用者 RPC；只讀员工限本人，管理權限仍限授權分支。無read或展示模式不讀正式附件。敏感查閱仍需真正AAL2，畫面只有手動確認身分入口，不自動取得或假造驗證。 |
| 明確選擇 | 不預選第一位員工或證照；版號必須存在於目前授權來源頁；選定後才讀附件。非法、重複及不支援的舊篩選拒絕，不默默變成全部員工。 |
| 分頁與錯誤復原 | 每頁50筆，總數與hasMore依來源；換頁保留員工並清除版號。空白越界頁可直接回第一頁，不必逐頁退回。未知錯誤不显示局部資料、示範資料或原始伺服器訊息。 |
| 狀態語意 | 原預留、檔案檢查、獨立人工核驗分開；reserved不表示原件已保存，clean不表示資格核准。`uploadedAt`標示預留時間；選取版本不冒稱永久最新；截斷歷程不冒稱完整。 |
| 請求完整性 | 來源／附件讀取共有20秒上限；取消、晚到結果與過期快照拒絕。精確核對actor、機構、分支、membership、user、key、version、hash，以及兩份快照微秒先後。 |
| 使用者介面 | native select沿具名平台例外；16px輸入／至少44px主要控制、共用scroll owner、GET選擇，不新增自製popup／modal／toast／browser storage。私人資料連結不預取。 |
| 明確未提供 | 此入口沒有上傳、掃毒啟用、人工核驗寫入、下載、過期終止、操作journal、可信provided證照版本或正式服務簽署。唯讀metadata不授予舊writer或資格。 |

## 本輪實際工程驗證

證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-20260926`。使用合成資料，不包含真實Google帳號session或員工文件。

| 檢查 | 實際結果 | 證據 |
|---|---|---|
| 全程式回歸 | 558檔、9,626項全部通過；包含真正Finance候選handler的合成loopback，沒有跳過項 | `staff-document-source-ui-vitest-final.log` |
| 新伺服器讀取／頁面 | 新helpers135項、元件25項、實際page dispatch11項納入上列；元件使用await後DOM測試，不冒稱Next RSC整合 | `snapshot.test.ts`、`workspace-source.test.ts`、`staff-certificate-documents-workspace.test.tsx`、`staff-certificate-documents-page.test.tsx` |
| 靜態／建置 | lint、型別及production build通過；正式依賴audit沒有已知漏洞 | `staff-document-source-ui-lint-final.log`、`staff-document-source-ui-typecheck-final.log`、`staff-document-source-ui-build-final.log`、`staff-document-source-ui-audit.log` |
| 本機production HTTP | 原附件API21項拒絕／登入轉向與新唯讀URL6項匿名登入轉向通過。沒有authenticated成功、掃毒或hosted證明 | `staff-document-source-ui-production-api-http.json`、`staff-document-source-ui-production-http.json` |
| 範圍限定介面audit | 新component／module CSS掃描及project治理manifest各零finding；不是全部舊證照表單或WCAG驗收 | `staff-document-source-premium-scoped.json`、`staff-document-source-premium-project.json` |
| 隔離Chrome唯讀画面 | 16個情境通過、17張截圖；1440px／390px、選版GET、分頁、空頁回第一頁、本人範圍及錯誤畫面。主要控制至少44px，select16px；無水平溢位、POST、私人cookie或本機內容儲存 | `staff-document-source-browser/report.json`及同目錄截圖 |

本機HTTP伺服器使用清空繼承環境及合成HTTPS來源設定，僅監聽loopback；沒有連線正式Supabase或Google。首次未提供合規HTTPS來源時，既有寫入guard正確回503；設定合成HTTPS來源後完整拒絕矩陣通過，沒有弱化guard。測試伺服器已停止。

Chrome使用實際async元件await後、實際AppShell／global與module CSS，僅替换合成唯讀loader及Next browser adapter；不是Next RSC transport、正式Google、RPC／Storage或所有Finance側欄功能證明。程式指定select後的原生form GET與鍵盤focus／Tab已驗證；headless與獨立headed Chrome均無法穩定操作作業系統native popup，不冒稱已完成popup鍵盤人工驗收。200%項使用CSS zoom重排，不替代瀏覽器選單縮放或完整WCAG人工驗收；仍需真人驗證。先前fixture在手機點擊隱藏側欄按鈕失敗，改回桌面前置後重跑通過，沒有修改AppShell以遷就測試。

本輪没有新增或修改SQL。第149份migration及第148份附件migration雜湊不變；前輪portable138套／6,534項、原生PG17.11全19套的證據保留在[後端驗收](STAFF_CERTIFICATE_RECOVERY_READINESS_2026-09-27.md)，不可冒稱本輪重新執行的結果。

## 下一步與正式部署阻擋

1. 完成前台上傳／核驗／下載、原操作journal與未知結果復原；掃毒和可信provided啟用須分別驗收。既有胰島素資格會採用合格provided版本，不能只靠附件API的`signable:false`宣稱隔離。
2. 正式量表仍需原件來源、新bundle雙人採用、資格／風險／補登政策、原子簽署與更正鏈。草稿保存及完成檢查不是正式結果，不能移除阻擋代替實作。
3. CMS不只缺雲端設定：目前正式import repository尚未在runtime註冊，需接上安全封存、儲存與正式欄位提升；普通Supabase Storage不等於七年WORM。
4. 核准商用部署方案與資料區域，完成精準雲端增量、正式員工驗收、掃毒、官方申報、Finance實帳、備份還原及多人操作等[正式門檻](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。本輪沒有GitHub push、Vercel發布或Supabase正式變更。
