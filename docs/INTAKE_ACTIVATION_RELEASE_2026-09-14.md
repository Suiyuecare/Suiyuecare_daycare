# 一般收案、管理者啟用與 A/B/C 行政審核

日期：2026-09-14。本輪依使用者授權實作前述第 1–3 項，並依指定的兩位負責人及公司信箱處理第 4 項。信箱、Google subject、Auth UUID 及正式個案資料不寫入原始碼或此文件。

## 已完成的變更

- 一般個案建檔、單一 CMS 批次的預覽／正式提交、每週到站／交通需求、A/B/C 草稿與行政送審採獨立 Google AAL1 動作授權；仍重新驗證真 Google、有效工作階段、機構、分支、個案及欄位。沒有把一般 AAL1 宣稱為 AAL2。
- 正式臨床簽署、重要匯出、用藥及權限調整的既有保護沒有全域撤除。單份 ABC PDF 仍要求近期 AAL2 及文件 read/access/manage 權限。
- 第一位管理者沿用既有全機構角色及真 Google 身分，新增明確核准的日常工作授權。
- 第二位管理者以 Auth Admin API 預建未驗證帳號，不設定密碼、不寄信、不偽造 Google identity 或 session。資料庫保存有期限的一次性萬華單點管理核准；由本人完成真 Google OAuth 後，callback 才能原子建立 profile、單點 membership 與角色。不能自行選分支、職務或擴權；已用邀請不能重置來規避停權。
- A/B/C 新增行政送審、退回、獨立主管覆核、理由與不可變更正歷程。未填、不適用與中央來源待核對保持區分。行政核准不是電子簽署，也不代表官方表單已完整。
- C 畫面明確區分本版凍結來源與最新來源；輸出使用本版保存來源。PDF 預覽、列印及下載共用同一份有雜湊的 PDF，不重新組合不同來源。
- 字型為固定授權來源的本機伺服器資產；不依賴外部字型請求或假造已核准的臨床範本。完整來源與衍生版本雜湊見 `assets/fonts/README.md`。
- 附件掃毒增加明確 mTLS／受控私網模式、CA 真解析、握手前禁止送檔、12 秒總期限及失敗封鎖；展示模式清除或拒絕相關私密設定。預檢僅使用合成控制資料，不建立付費資源或自動啟用。

## 正式資料與基礎設施

- 本輪初始正式基線：108 migrations、2 個既有個案、1 個真 Google 使用者；預建第二個未驗證 Auth 帳號後為 2 人。
- 已成功套用 `20260914091707`、`20260914091746`、`20260914091755`，成為 111 migrations；原有個案仍為 2，沒有測試個案或 CMS 真檔寫入。
- 正式 advisor 找到兩個本輪新表的外鍵索引缺口；以另份 `20260914112708` 補齊，未改寫已套用 migration。確認兩表仍為空、無長交易後，以 5 秒鎖／30 秒語句期限套用成功，最終為 112 migrations。
- 以交易執行精確身分核對、既有全機構角色核對、單點分支核對，新增 1 筆已驗證 Google 的 enabled grant、1 筆待本人 Google 驗證的 activation。資料庫操作稽核如實標示 system actor 與核准參照摘要，沒有偽造人類登入或雙人核准。
- 沿用既有 Supabase 首爾與 Vercel 東京函式設定，不遷移區域、不新增付費方案。
- 正式及本機均未配置 AWS WORM 封存／ClamAV 連線。設定預檢正確回報 `operatorEnablementRecommended=false`、exit 2。CMS 原檔與附件上傳繼續停用，不把 private bucket 當作 WORM 或將無掃描當作通過。
- 需使用者確認公司既有 AWS／受控持續運行伺服器或另行核准費用後，才能做真實封存／掃毒接通與驗收；不使用公開掃毒網站傳送個資。

## 驗證狀態

- SQL 全回歸：109 檔、4,881 assertions 通過；93 舊 PGlite 相容性 fixtures 與 16 真 admission suites 分開計數，不宣稱全部為真人驗證。
- 原生 PostgreSQL：112 migrations、387 SQL assertions、9 ACL／Storage／索引檢查通過；兩個真獨立連線驗證週表衝突與同帳號啟用冪等。Auth 身分與資料仍為合成 fixtures。
- Vitest：380 檔通過／1 檔既有跳過，4,089 項通過／1 項既有跳過；ABC 及共用 PDF 共 103 項亦由實作者重跑。完整 lint、TypeScript、正式模式 Next build 通過；固定字型與授權檔已包含在 export route trace。
- 來源提交凍結後再次全量 Vitest 仍為相同 4,089 pass／1 skip；scanner 與 infra 最終修正另以 5 套 90 項覆蓋 X509、slow-drip、期限後不送檔及計時器清理。
- PDF：固定字型合成 B 表 22 頁，431 個欄位全數找回、頁界溢出 0、原稿雜湊完整、相同快照 PDF bytes 一致；逐頁檢視包含第一頁與最後照顧計畫。產物僅在本機忽略路徑，不上傳。
- 瀏覽器：安全展示模式 89/89 頁載入；收案 A/B/C 入口 390px、1440px 無水平溢出，無 runtime error，已檢視截圖。展示只讀，不代表真人操作送審或覆核。
- 本機正式模式用明確 loopback Supabase 位址與合成 public key（不接 hosted）：16/16 收案 API／頁面匿名阻擋，89/89 全頁回登入且 no-store。初次使用未配置環境及空週表 body 的探測分別得到 503／400，修正測試環境與使用合法合成輸入後通過，沒有降低任何授權條件。
- 正式發布結果於下方另記；上述本機檢查不作為已發布證明。

## 發布

- 公司網址：<https://daycare.suiyuecare.com>；收案入口：<https://daycare.suiyuecare.com/app/client-intake>。
- Source：`d3aeace1751bfe2ac650de7bf4820a89b1bee12f`，候選與正式為同一 artifact。
- Deployment：`dpl_38pbwj5piycFYB8N8c3SzitRRnEP`；target production、READY。
- Artifact：<https://suiyue-daycare-preview-6girq80jg-entrepreneur-9585s-projects.vercel.app>。
- 實際上傳 manifest：966 files、14,321,890 bytes；hash `feef921baebd630bcb0fbb163ac8eaa51e8364e17ce7174799fe913615e6f4d9`。檢查未包含環境檔、原始 HTML/PDF、測試產物、文件、SQL、infra 工具或偵測到的密鑰字面值；此為限定規則掃描，不宣稱通用個資偵測。
- 先 `deploy --prod --skip-domain`。CLI 建置串流曾中斷回報 fetch failed，沒有依建議重複 deploy；回查原 deployment 仍在建置，最後 READY。雲端編譯 24.3 秒、TypeScript 35.9 秒通過，2026-09-14 11:39:46 UTC 完成；不是用本機 build 冒稱雲端成功。
- 候選 metadata 的 releaseSource、gitCommitSha、sourceManifestHash 全相符，functions region `hnd1`。雲端 build 地點 iad1 不等於業務函式地點；既有多區域 middleware 未改。Node >=22 升版及 preferredRegion deprecation 警告仍存在，未因本輪更改套件或區域。
- 候選登入 HTML 的 Google 按鈕啟用，沒有未配置或合成使用者；兩個新 ABC POST、個案 GET 均 401/AUTH_REQUIRED。空建檔 body 先得到 400 結構錯誤，不將其冒稱授權成功或當成 401 證據。候選階段公司 alias 仍為上一版 `dpl_GXNbDw6q5ESdhdCdG5HDUMsDTHVw`。
- 檢查後 promote 同一 artifact 成功；公司 alias 回查為本版 READY，未關閉保護、重建另一版本或改正式環境設定。
- 正式公司網址 16/16 收案匿名 API／頁面拒絕與 89/89 全頁未登入隔離／no-store 通過。正式登入 390px 無橫向溢出、Google 按鈕啟用且無 browser error；已檢視截圖。點擊可到 `accounts.google.com/v3/signin/identifier`；沒有輸入任何帳號、密碼、驗證碼或完成 OAuth。
- 最終 hosted 回查：112 migrations、2 clients、1 enabled Google staff grant、1 待首次 Google activation；行政審核列、PDF快照與文件 bucket 物件仍為 0。沒有把本機合成測試寫入正式資料或宣稱第二位已登入。
- Security advisor 0 ERROR；既有密碼防護 WARN 與封閉 RPC 表的 RLS-no-policy INFO 保留，不以新增寬鬆 RLS 消除提醒。Performance advisor 本輪新增的兩個 FK 缺口已為 0；仍有既有 369 unindexed-FK INFO、13 multiple-permissive-policy WARN，不宣稱全資料庫調校完成。
- 候選及正式切換後錯誤日誌皆為 0 筆，只涵蓋本版存續及本輪測試期間；不等同一整小時監測或自動告警。
- 此後僅補本份被部署排除的發布證據，不因此重建前台。GitHub 公開 orphan 分支沒有被覆寫、推送舊歷史或 force-push；發布走既有 Vercel 專案。

需回復前台時可 promote 上述上一版 artifact；不要刪除新版本、稽核、個案或帳號。資料庫權限／啟用的停用須另行精確處理，回退前台不等於撤銷已核准的帳號。

## 不代表完成的驗收

本人 Google 首次啟用及登入後完整操作、真 CMS／附件安全服務、正式臨床簽署、官方表單完整認定、50 人並行、備份還原與營運 SLA 仍是獨立門檻。此版的 A/B/C 為「官方欄位對照副本（非官方原稿版面、未電子簽署）」，不是宣称官方原稿 PDF 已完整重製或取得法律認定。
