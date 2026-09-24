# 個案附件處理邊界

本地垂直切片包含：六類附件清單、條件權限、具冪等鍵的使用者預留、伺服器雜湊與檔頭檢查、Supabase 私有 no-upsert 儲存、獨立掃毒結果、人工覆核版次、不適用理由、60 秒附件下載授權及稽核。附件不會變成有效醫囑、用藥計畫或本中心給藥執行證據。

## 正式環境前置

- 依正常遷移審查套用 `20260913180653_client_documents_intake_pipeline.sql`。遷移在存在 Supabase Storage 的環境建立私有 `client-intake-documents` bucket，並增加 `anon`／`authenticated` 限制政策，阻止繞過 API 直接存取。
- 現有後端 Supabase secret key 僅使用於預留成功後的私有物件上傳、雜湊確認、server-only 掃毒登記及經使用者授權的短效下載；瀏覽器不得取得此 key。
- 部署負責人完成掃毒服務／資料區域／DPA 審查後，才可設定 `CLIENT_DOCUMENTS_SCANNER_APPROVED=true`、`CLIENT_DOCUMENTS_CLAMAV_HOST`、`CLIENT_DOCUMENTS_CLAMAV_PORT`（預設 3310）。沒有設定即回覆 503，在預留、儲存與掃描之前停止。
- ClamAV 必須經過具有效憑證的 TLS gateway 提供 INSTREAM；程式強制 TLS 及憑證驗證，不支援明文傳輸或略過憑證驗證。端點由伺服器環境設定，不能由上傳請求指定。此工作未建立服務、增加費用或傳送真實附件。
- 必須指定 `CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE`：`mtls` 需成對設定 `CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM` 與 `CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM`；`private_network` 需另外確認只有受授權系統可連線的網路控制，不能以公開匿名 TLS 代理代替。兩者皆可指定受信任的 `CLIENT_DOCUMENTS_CLAMAV_CA_PEM`，強制 TLS 1.2 以上及主機名／憑證驗證。PEM 只在伺服器使用，不能放入公開變數或紀錄檔。
- 設定存在不等於服務健康；啟用前須依 `infra/intake/` 文件跑真正的基礎設施檢查，確認憑證、病毒碼更新、正常檔與 EICAR 偵測、逾時／失敗隔離。應用程式掃描時仍獨立拒絕握手、回條及服務錯誤，不得把錯誤當成 clean。
- 單檔上限 4MB，支援 PDF/JPEG/PNG；不支援 Office、HTML、SVG。PDF 除檔頭早期檢查外，再使用 pdf-lib 解析物件圖與 object streams、解碼 PDF names，拒絕已知 action／JavaScript／內嵌檔／互動表單／加密，無法解析則拒絕。這是結構政策檢查，**不是完整 PDF 消毒或惡意碼安全保證**，仍必須經病毒掃描及上線前弱點驗收。較大的文件須先縮小，不宣稱已實作大檔續傳。

## 狀態與操作

`missing`（未提供）與 `not_applicable`（授權人員填理由）不同。
預留但未獲掃毒結果為 `scanning`；clean 仍是 `needs_review`，只有人工覆核才是 `reviewed`。感染、掃描失敗或補正要求為 `needs_replacement`；未 clean 絕不產生下載授權。

掃毒結果及原檔不可覆寫，只能重新上傳新版本。掃毒失敗後可用新操作上傳新版本；若原預留超過 15 分鐘且尚無終局掃描回條，舊操作不會變成已完成。原操作已有終局回條時，重試經授權與 blob 雜湊核對後直接讀回原回條，不重掃或修改其 verdict。尚需營運端盤點保留已隔離檔與過期預留，不自動刪除資料。

每份文件保存名稱、院所／開立單位、文件日期、有效期限、用藥／歷史紀錄起迄（未知可留空）。最新類別摘要仍使用相容的 200 筆歷史上限；新增「逐份文件與歷史」入口使用獨立 RPC，每頁 50 份，單次個案／類別最多 5,000 份，超限拒絕並要求縮小範圍，不靜默截斷。伺服器建立五分鐘、綁定使用者／機構／分支／個案／類別的固定清單；每次伺服器分頁請求重新驗權，前端已讀頁只在同一快照效期內供返回查看，過期清空。新文件不混入已開始的查詢。

逐份覆核、待補正、停用與重新覆核採用使用獨立版本、理由及冪等回條。不同藥袋可並存，不以類別上傳順序推定舊藥袋失效；明確停用或有效期限已過才標示歷史用途。最新類別摘要與補件報表對逐份停用／待補正採保守狀態；類別註記、逐份理由與有效狀態分開保存。**文件覆核不是醫囑核准，不代表已完成完整多藥袋臨床用藥管理。**

原始檔、掃描結果、逐份處置事件及冪等回條不可刪改。五分鐘導覽快照不是臨床證據；同一人重新查閱同案時，僅清理最多三個已過期快照，保留原文件與稽核。沒有公開清除入口。發布及測試結果另見 `docs/DOCUMENT_LIFECYCLE_BATCH_2026-09-15.md`，本文件描述程式契約，不當作正式服務已啟用的證據。

讀取使用個案範圍及類別權限；身份文件需 `clients.manage` 及敏感基本資料讀取權限，藥物類需 `medications.read`，體檢需 `health.read`。寫入分別需 `clients.manage`、`medications.manage`、`health.write`，以及最近 15 分鐘 AAL2。下載同樣需要最近 AAL2。駕駛預設無敏感附件類別權限。沒有更動角色或機構權限。

下載網址是 60 秒 bearer capability，產生前留下個案、文件版次、操作者與時效稽核，前端 55 秒移除連結。網址發行後的 60 秒內無法逐一撤銷；這不是長時間外部分享功能。下載方式為 attachment，不提供 PDF/HTML iframe 或原始預覽。

## 驗證層級

單元測試使用明確注入的合成 scanner／記憶儲存，驗證真實 bytes→hash→reserve→storage→scan→register 次序、拒絕惡意與錯誤 scope、未知結果不當成 clean。SQL tests 使用本地 PGlite、真實 admission predicate 與合成 Storage metadata fixture；它們不代表已完成正式 Storage、TLS gateway、網路或真實帳號端到端驗收。

附件基礎遷移已於 2026-09-14 前一批正式發佈，相關原生 PostgreSQL／Storage 政策證據見 `docs/INTAKE_PRODUCTION_RELEASE_2026-09-14.md`。目前仍未配置正式掃毒連線；真實 TLS 掃描及登入後下載 URL 行為仍需驗收，通過後才可開放真實個資上傳。

依據：[Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)、[Standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)。
