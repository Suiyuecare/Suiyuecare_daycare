# CMS 原上傳查證與續做候選

這是本機第153份 migration 與現場 UI 候選，不是正式部署。尚未 GitHub push、Vercel 發布或套用 hosted Supabase；整體依 [正式部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)，不可投入真實個案作業。

## 本輪完成的範圍

- 單案收案與頁80通用匯入共用 `CmsUploadControl`：選檔、上傳結果未知、手動查原結果、明確續做與只重讀預覽。一般已核准 Google 收案維持 AAL1；通用仍要求真正 AAL2，不借此放寬其他簽署或治理。
- 新 queryless GET `/api/client-intake/imports/operations`、`/api/imports/operations` 以原 `Idempotency-Key` header 找本人、同機構／分支／模式的精確來源。原 ACK 遺失、不知道 reservation ID 也能查；沒有自動 POST、姓名模糊合併或 admin client。
- SQL153 public wrapper 為 SECURITY INVOKER、空 search_path；authenticated 只可執行具實際 Auth／session／即時權限檢查的 private entry。來源 projector 不授予一般角色或 worker；直接 private 呼叫亦需完整授權。查閱本身留下稽核，不修改正式個案。
- 原來源建立时间、原檔 SHA、解析回條、封存版本與七年期限不可改。歷史原 session 已過期可以由本人目前有效授權查閱，但不能復活舊寫入權限。原結果 `completed` 只證明來源暫存；通用還需明確第151份 recovery 接入原批次才讀預覽。
- 分頁記憶體 journal 只保存原鍵、穩定識別及檔案 metadata，不保存 HTML 或 File bytes。重新掛載不自動重送；續做需重新選取原名稱、MIME、大小及 SHA 相同原檔。查不到原結果不是回滾或新操作授權。
- 檔案讀取／雜湊、POST／JSON、locator GET／JSON及預覽各有有界等待。登出、分支、帳號、角色及權限 epoch／ABA 使舊回覆失效；撤權清除真正 native file owner，舊 props 不復活原檔。
- 新檔嘗試包含非法檔案，均清除舊核准預覽與勾選；取消 picker 不代表新檔。成功來源回條與核對預覽分開，預覽失敗只重讀、不重新上傳。
- Finance frame、全域 token 及幾何不變。主要按鈕只在 CMS 內容區使用既有深橘色修正白字對比；短狀態留在現場，工程證據不作現場提示。

## 最終本機驗證

以下最終證據對應凍結後候選，不能擴張為整套89頁或 hosted 成功證明。

- 完整程式576檔／10,238項全部通過，`--maxWorkers=2`、329.61秒，包含真正Finance候選handler的合成loopback契約；沒有提高timeout或skip。八行jsdom「navigation to another Document」為測試環境diagnostics，不作實際瀏覽器導航成功或應用錯誤證據。
- Portable142套／6,763斷言通過：93套legacy PGlite-only admission fixture、49套實際enforcing admission；不是正式Supabase驗收。原foundation第9項架構守門不變。
- 最終全repo lint、型別、隔離production build、正式依賴audit均exit0；依賴零已知弱點。沒有新增套件、正式`.env`或ambient雲端憑證，實際HTTP伺服器另使用清空環境的固定loopback。

- 修正後 PostgreSQL17.11 全23套通過。新 locator 58／58、原 foundation 24／24，以及10組真正 audit 等待／撤權／來源變更探測通過；沒有替換 admission、JWT、AMR或共用授權函式來假造成功。
- 340個唯一 native 來源 SHA 與1558個 child 具名來源參照末讀相同。23個自有資料庫均實際 shutdown，owned data／socket 移除，證據保留；没有 skip。
- 最終 SQL153 SHA `871c7f480b23d455fed6e575ce94e4d612618bd171edf1eb67b644c5ea5079de`；fixture SHA `72dd723f9f9a153fadfda62fbf44fe1d1f7abe510f0b847b8b02d2b3c72f9332`。八個既有 native adapter 更新精確153基線，不放寬舊守門。
- 實際本機新建置產物 HTTP 原26＋recovery18＋locator20，共64項拒絕契約通過，錯誤不反射來源／憑證，private/no-store，無雲端請求、Cookie或有效登入。不是 HTTPS 授權上傳成功閉環。
- 隔離 Chrome 使用實際 AppShell、CmsIntakeStep、File／WebCrypto及 bounded fake HTTP，23項桌機／390px、原 ACK 遺失、重掛載、換檔、null、預覽失敗／重讀、scope ABA、JSON逾時及403隔離檢查均通過。五個 CMS owner 狀態的窄範圍 axe 沒有 violation／incomplete，另實測 forced colors／reduced motion、CSS200%與鍵盤 disclosure。不是全部 WCAG、實體 IME、真 Auth/RLS/WORM或正式收案驗收。自有isolated browser與兩個server均已停止，三個生成UI runtime移除；screenshots／logs與fixture源保留。
- `premium-cms-upload.json` strict audit 零 finding，範圍限定 imports owner；不將 legacy 收案 composer 的技術債隱藏成整頁 premium 通過。

證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-20260926`。native 最終檔名前綴 `import-locator-native-all-post-fix-`，其他最終檔名為 `import-locator-*-post-fix`；Chrome 位於 `cms-upload-browser/verification-post-fix.json`及對應圖片。

`import-locator-candidate-source-hashes.json`保存2084份候選來源盤點，捕捉於browser／native／build後、完整JS執行期间，不偽裝成所有suite的初始manifest；原生另有真正pre/post source hash證據。本機最終驗證摘要見`import-locator-candidate-verification-summary.json`。最後再讀工程來源雜湊，僅本節驗收文件在補實際結果後更新。

## 已修問題與保留的失敗證據

1. 初次 native 雖通過，但完整 portable 的原 foundation 第9項抓到 public SECURITY DEFINER 違反架構。已改 invoker／受檢 private entry，新增直接 private 越權拒絕測試，原 foundation 24不變；舊 native summary 明列 superseded_pre_fix，不作目前結果。
2. 初次完整 JS 在一般匯入測試仍更新中時失敗11項，保留 log；不冒稱該次通過。原缺 context／原檔 owner／預覽契約測試已更新為实际接線，驗證強度未減。
3. 獨立覆核找到無效新檔保留舊預覽、commit失敗晚回覆、拒絕後 native原檔 owner，以及 null→原登入權限 ABA；修正並保留回歸，未撤除權限守門。
4. Chrome enabled primary 原白字／橘底對比2.59:1，已用既有深橘色改善；只改 CMS scoped CSS。早期測試 selector／未等待 axe 的測試程式錯誤也保留，不能作通過證據。
5. HTTP probe 最初預期空 `?`400，但此 transport／Next 會先正規化，實際合法鍵仍503 fail closed。修正 probe 對可觀察邊界的描述；直接 Request handler 測試保留原拼字拒絕，不宣稱 wire 能辨識已被正規化的空query。

## 正式部署仍缺

1. **完整重載的原鍵定位、重新登入的新context復原**：目前journal限同tab生命週期，不寫瀏覽器持久化。一般 reparse 原鍵／原body僅保留於掛載期間，未知結果禁止新操作；不留無owner全域死鎖，但不冒稱跨掛載恢復已完成。
2. **舊收案核准 owner**：本輪已修 preview／權限epoch與晚回覆，不代表舊核准操作本身已有全reload journal、整體JSON期限、完整離頁確認或新同鏈receipt定位。
3. **整個上傳HTTP初始登入期限**：新 locator 有全讀取deadline，但既有reserve／worker／repository／UI個別期限不等於完整 HTTP跨Auth／S3／DB期限。最後授權重查亦非全跨表COMMIT序列化。
4. **正式 WORM/KMS／隔離掃毒／孤兒對帳及欄位業務驗收**：沒有配置正式桶或付費服務。三份原樣本的42／41／40區段歷史讀取，不是本輪 hosted驗收。
5. **通用正式欄位提升與 general payload SHA 契約**：通用preview目前無payloadSha256，僅嚴格核對實際可得batch／file SHA／size／mapping／fingerprint／counts，不製造重序列化JSONB雜湊。單案基本資料已有交易，但不代表全部來源欄位、照顧計畫／資格／服務均完整入檔。
6. **量表採用、專業完整工具、證照核驗、官方申報、Finance真資料、家屬、七年移轉、真人平行作業、備份還原與50人HTTP驗收**，以及商用方案、區域與資料治理仍須通過整體清單。歷史cloud唯讀資料須正式發布前刷新，不沿用成目前狀態。

下一步可以繼續補原操作持久定位與舊核准回查、全HTTP期限及孤兒清冊等安全工程；不藉此開啟尚無雲端封存／掃毒證據的真實個資上傳。
