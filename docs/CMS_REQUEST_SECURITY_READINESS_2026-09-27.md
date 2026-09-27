# CMS 請求安全候選與部署邊界

狀態：本機候選，尚未 GitHub 推送、Vercel 發布或正式 Supabase 變更。不得用本頁宣稱 CMS 正式上線或全部 89 頁可用。

## 本輪修正

- 所有單案 CMS 與通用匯入寫入入口先驗證配置的完整來源、Origin、Fetch Metadata、完整 MIME 及無額外查詢；代理提供的 Host 不作信任來源。這不是代替登入、分支、角色或資料庫權限檢查。
- 私有預覽不再默默忽略未知、重複查詢或附帶本文的請求；通用批次 ID 採嚴格 UUID。
- 通用上傳只接受一份檔案，拒絕多份檔案、重複操作鍵、未知欄位；JSON 拒絕未知欄位、非法映射型別及不一致的 header／body 操作鍵。非法衝突欄位錯誤只回固定欄位名稱，不反射使用者提供的鍵。
- 單案及通用入口都依實際串流位元組限制，不相信 Content-Length；本文讀取最多十秒，同時檢查單調時間與計時器、支援取消、拒絕已讀／鎖定本文，且不等待卡住的取消程序。用固定 64 KiB 自有區塊避免一個小片段一份配置；七萬個單位元組片段實測只合併兩個區塊。逾時回「內容未完整送達」而不是成功。
- JSON 最大 64 KiB 且採嚴格 UTF-8；單案 HTML 仍為 4 MiB、multipart overhead 64 KiB；通用 HTML 仍為 25 MiB、overhead 512 KiB，沒有放寬界限。
- 保留單案收案已核准 Google AAL1 專用授權；沒有新增一般建檔 MFA。通用 AAL2／近期驗證、東京 KMS／WORM 七年、靜態解析及原子基本資料交易未移除。

## 更正此前 CMS 完成度描述

| 入口 | 儲存庫中的現況 | 不可宣稱的結果 |
| --- | --- | --- |
| 單案收案 `/api/client-intake/imports` | 已接 `find_cms_intake_source`、受控預約、S3 Compliance 封存及 worker 完成暫存 | 不等於雲端桶已配置、本人原鍵操作可完整復原或附件已掃毒 |
| 單案核准 `/api/client-intake/imports/approve` | 已接 `commit_cms_intake` 基本資料、逐欄決定、版本及正式回執交易 | 不等於全量照顧計畫／資格／服務欄位已提升，亦不是真人 hosted 驗收 |
| 通用 `/api/imports/*` | 未註冊完整 production repository，正式環境仍 503；demo 核准僅 `staging_only: true` | 不可把單案交易借作通用 adapter，不可把暫存回執改名正式入檔 |

先前「所有 CMS 都未接正式交易」過於籠統；本輪依實際路由及既有 migration 更正，沒有以文件更正冒充新增雲端能力。

## 驗收證據與限制

證據目錄：`/Users/seniorlifepr/.codex/verification/daycare-20260926/`。測試僅使用合成資料、供應商替身或 loopback，不讀取使用者個案原檔或正式帳號秘密。

| 項目 | 本輪結果 | 證據檔 |
| --- | --- | --- |
| 精準回歸 | 6 檔／140 項通過：共用讀取 27、單案來源／串流 38、通用真路由 46、既有收案／通用測試 29 | `cms-request-security-focused-final.log` |
| 全程式回歸 | 561 檔／9,737 項全部通過，包含實際 Finance 候選 handler 的合成 loopback；沒有 skipped 項 | `cms-request-security-vitest-final.log` |
| 靜態及正式建置 | 全案 lint、型別及 production build 通過；沒有擴大 schema 或放寬原權限 | `cms-request-security-lint-final.log`、`cms-request-security-typecheck-final.log`、`cms-request-security-build-final.log` |
| 正式依賴掃描 | 沒有已知弱點；這不是第三方滲透測試 | `cms-request-security-audit.log` |
| 實際建置 HTTP | 26 項來源拒絕、查詢／UUID 驗證、匿名或未配置拒絕通過；均 private/no-store、結構化錯誤及 request ID，未洩漏合成來源／附件 | `cms-request-security-production-http.json` |
| 獨立唯讀覆核 | 最新 3 檔／111 項重跑通過；另以原生 Request 串流確認七萬個片段全部值、6 組 block 邊界、單調期限及不等待取消。先前找出的兩個單案本文漏網已修正 | 本輪 agent 覆核紀錄 |
| 測試環境清理 | 合成來源、清空繼承環境、只監聽 loopback；兩次測試伺服器均停止，沒有 Chrome 個人資料或雲端請求 | `cms-request-security-cleanup.json` |

HTTP 使用非 TLS 的 loopback transport，不是配置的正式 HTTPS origin，因此只證明來源拒絕及私有 GET 守門；MIME、實際本文大小／期限、合法 AAL1 正向收案及通用 demo 暫存成功由真 handler 的合成測試覆蓋，沒有冒稱真人 TLS／Google／hosted 成功。沒有 UI 改動，不把前輪 Chrome 截圖當成本輪新驗收。

沒有 SQL 改動，本機維持 149 份 migration；先前原生／portable SQL 證據仍是歷史基線，不能冒稱本輪重跑。

關鍵候選雜湊：`request-security.ts` 為 `67bef70c44992dc8c6c317ffb43c3ebd699b64eacc86babf0e63d661bbf3ca25`，`multipart.ts` 為 `5275f7dbaf050d411960ffe501d98671bd19be4802cedbc5294cd8325f84a33e`，通用核准路由為 `74dc1a25aff7eeb66aa6c725580b9a4e53b5631f595bb98ea3907a3e70f18760`。

## 後續仍須完成

1. auth／RPC／S3 的全流程期限、確切本人原鍵與意圖回查、逾期預約及孤兒對帳。十秒本文期限不涵蓋遠端執行，也不證明逾時交易已回滾；不得改新鍵重送或刪除 WORM 物件補償。
2. 通用完整 durable repository 與窄 RPC；用實際 challenge 時間替代目前 general importer 將 boolean 近期驗證投影為現在時間的舊程式。禁止借用護理專用證據或將 routine AAL1 例外擴大到通用核准。
3. 原始檔東京 KMS／WORM Compliance 七年、附件隔離掃毒、實際配置／拒絕刪除／完整 hash 回條；普通 Supabase Storage 不是 WORM。
4. 完整來源字典與主權、三份黃金樣本、正式欄位差異覆核、失敗零業務變更、本人／跨機構／跨分支／撤權／多人重送及真實員工完整收案驗收。
5. 商用部署方案與資料區域決定、保護預覽、精準資料庫升級、真實 Finance 單店只讀、正式量表完整鏈及備份還原等共同營運門檻；見[部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。
