# 第一批：個別核准員工 Google 登入與日常照顧資料權限

狀態：本機實作與 SQL 相容性測試通過；未套用正式資料庫、未新增正式授權、未發布。

此文件只說明工作包 01／03 的資料庫基礎，不代表員工邀請、全部角色管理、高風險本人確認或完整上線驗收已完成。

## 變更檔案

- `supabase/migrations/20260913111916_approved_staff_routine_care_access.sql`
- `supabase/tests/approved_staff_routine_care_access.test.sql`

只新增一個遷移檔及一份 SQL 測試；歷史遷移和既有測試未改寫。應用程式接線由同批前端／API 變更提供。

## 權限設計與實際範圍

### 個別核准，不是同網域全員開放

新增非公開表 `private.staff_google_access_grants`。每筆核准綁定：

- 固定的 Supabase Auth 使用者 UUID 與一個機構。
- 固定的 Google subject、已驗證公司電子郵件與公司郵件網域。
- 是否啟用、生效／到期時間及核准依據。

遷移檔 **零筆帳號 seed**，不包含真實姓名、電子郵件、Google subject 或 Auth UUID。`anon`、`authenticated`、`service_role` 均不能直接讀寫此授權表；表本身啟用並強制 RLS。

目前是資料庫維運端的受控核准基礎，**不是已完成的邀請或雙人核准管理畫面**。沒有經過人工確認的人員姓名、職務、機構／分支與 Google 身分，不得自動套用角色或開通。

`company_email_domain` 只是一項核對條件，不能取代固定帳號、subject 與已驗證郵件。個人 Gmail／Googlemail 不得當成公司郵件核准。若 Google 自己提供 `hd`，必須與核准的公司網域相符；沒有 `hd` 不會單獨造成拒絕，也不會因此放行其他身分條件。**不要求新增 Google Workspace 付費訂閱。**

不得為了通過檢查修改 Google 身分原始資料、偽造 AMR、AAL 或工作階段資料。

### 每次使用均檢查當前有效性

檢查真正存在且屬於本人的 `auth.sessions`，以及其期限、建立時間、OAuth client 條件；核對 JWT 的角色、受眾、期限與對應工作階段 AMR。

Google 身分必須唯一，不能同時連結其他 OAuth provider 後仍把所有 OAuth 會話視為 Google；只允許既有相容的 email 身分。Google 郵件驗證、固定 subject／email、Auth 帳號未刪除／封鎖、員工 profile、機構、分支、membership、角色及權限生效時間都必須通過。

`user_metadata`、單純的電子郵件網域、重新整理 token、前端傳來的角色或使用者 ID，都不是核准證據。

### 與原執行長登入相容，但不偷偷開放寫入

原 `is_executive_login_allowed()` 完全保留，不擴大成所有員工登入。

新增 `is_staff_login_allowed()`，允許「原本已核准且仍有有效機構／角色範圍的執行長」或「新個別核准且仍有效的員工」。原執行長可保留既有讀取流程。

**執行長的一般 AAL1 寫入也需要新的明確 routine grant。** 套用遷移或發布新版，不會自動將現有執行長從唯讀升級為可寫入。

### 四個應用程式 assurance key

應用程式使用唯讀 RPC：

`has_routine_care_access(target_org_id uuid, target_branch_id uuid, target_permission text)`

僅接受以下四種 permission：

| Permission | 可接通的操作 |
| --- | --- |
| `attendance.write` | 原出勤 RPC 的一般簽到、簽退、請假、缺席；補登仍使用既有高風險規則。 |
| `health.write` | 原生命徵象整組量測 RPC，保留伺服器欄位驗證及冪等。 |
| `care_records.write` | 原照顧日誌草稿與結構化快速草稿；日誌 `edit`、`submit` 可走 routine 路徑。 |
| `care_records.read` | 指定個案的照顧日誌快照；可只給讀取、不給寫入。 |

此 RPC 只確認當前本人與分支範圍，不接受任意使用者 ID，也不能替代寫入 RPC 的個案、資料版本、動作與內容檢查。

`submit` 仍是未簽署的 `submitted` 紀錄；不產生簽署人、簽署時間或假造 AAL2 證據。簽署、正式更正、退回重開、出勤補登、申報、匯出、權限／排班管理及原批次 sync 不因 routine grant 而開放。

原高風險權限鏈仍維持執行長限定及原本 AAL2／近期本人確認規則。**新員工即使另有 AAL2，也不會因此自動成為高風險業務使用者。** 不得在畫面上暗示所有角色、模組已全面啟用；後續須另外完成已核准的高風險驗證設計。

### 讀取與資料範圍

新增 SELECT-only RLS，不新增業務資料表 INSERT／UPDATE／DELETE 權限：

- 自己的有效機構、分支、profile、membership、角色與權限脈絡。
- 依個案指派及資料類別授權的出勤、量測、服務來源。
- `care_records` 的新 routine 讀取僅限 `staff/daily-care/care-diary`，不開放其他臨床類別。
- 個案中心、今日照顧、血糖、服務使用的最小個案目錄；不開放基本資料完整檔案、醫囑、附件或 legacy offline sync 目錄。
- 個案中心「我負責」所需的 `client_assignments`：只回本人、目前有效、且機構／分支／個案均在範圍內的指派，不暴露其他員工，也不授予 `clients.assign`。
- 每日名冊僅讀本人負責、已具個案讀取權限的名冊列與可讀工作證據；不開放名冊管理、全部員工選項或新增指派權。

CMS 注意事項來源／覆核／效期仍屬後續獨立驗收；本遷移沒有擴大其原授權。來源不可用時應顯示未能讀取，不能當作「個案沒有注意事項」。

## 授權異動稽核

使用專用 `audit_staff_google_access_grant()` trigger，避免通用 trigger 找不到 `allowed_user_id` 主鍵。

- 新增、撤銷、更新及刪除均保存受影響使用者的固定 UUID 作為 `row_pk`。
- 保存變更欄位名稱、動作、伺服器時間與核准依據的 SHA-256，不保存電子郵件、Google subject 或原始核准文字。
- 若維運操作沒有 Auth 操作者脈絡，明確記錄 `system_actor`，不能宣稱已有可辨識的人工操作者或雙人核准。
- 核准的使用者 UUID 與機構不可直接改成另一人／另一機構；需要撤銷原核准並建立另筆可追溯核准。

個案目錄、日誌、名冊快照維持原查閱稽核；不以此宣稱全系統每個直接 SELECT 均已具完整查閱稽核。

## 驗證證據

- 103 份遷移可在本機 PGlite 編譯。
- 新測試覆蓋：個別核准 Google AAL1、缺 `hd` 但完整固定身分、錯誤 `hd`、未邀請公司帳號、個人 Gmail、其他 OAuth provider、AMR 造假、過期／刪除／停用、跨機構／分支／個案、直接 RPC／資料表越權、10 次重送、日誌版本與未簽署提交、唯讀日誌、名冊與個案指派來源、授權目標稽核。
- 最終版本執行 `node scripts/test-database.mjs`：100 檔、4,434 assertions 全部通過；其中新增員工授權測試 206／206，包含個案中心指派來源。完整套件有 93 份歷史本機 admission fixture 測試及 7 份使用真實遷移 admission predicate 的測試；不能把全部 100 份描述成真實 Google 登入驗收。
- `supabase db advisors --local --type all --level warn --fail-on error` 已嘗試，但本機沒有 PostgreSQL 服務監聽 `127.0.0.1:54322`，因此未取得 advisor 通過結果；沒有改查其他正式專案代替。

PGlite 是本機相容性測試，不是正式 Supabase PostgreSQL 驗收、真實 Google 員工登入、API→資料庫→第二裝置讀回、多工作階段併發、壓測或正式 RLS／備援安全驗收。既有多角色測試有歷史本機 admission fixture；新增授權測試不覆寫任何正式登入 predicate。

## 後續部署／啟用順序（尚未執行）

1. 先確認正式人員姓名、公司 Google 帳號、必要角色、分支及指派；核對真正的 Google subject／已驗證郵件與 Auth UUID，不以顯示名稱或 email 模糊比對。未存在的 Auth 身分不捏造 UUID；帳號不能作多人共用登入。
2. 完成正式 PostgreSQL／RLS 與既定備份驗收後，先套用此 migration，確認新表預設零授權、RLS／函式權限及原執行長讀取相容。不得先發布依賴新 RPC 的前端後再補 migration。
3. 發布同批前端／API，確認一般操作只呼叫核准的 assurance key，高風險操作仍走原路徑；沒有 grant 時顯示尚未開放寫入而不是假成功。
4. 由具權限維運者逐人核對、明確核准並建立 routine grant；執行長同樣需要此步。這不是從 email 網域自動匯入全體員工或自動增加角色。
5. 以已核准實際帳號、授權範圍及安全測試資料驗證 Google 登入、三種例行寫入、重新讀回、第二裝置、越權拒絕、停用後拒絕與重送，再開放已驗收的小範圍平行試辦。個案真實資料仍須通過完整安全交付及開站門檻。
6. 發生問題時，先受控停用本批相關 routine grants 並驗證讀寫已拒絕，再回復應用程式版本；保留授權異動稽核與已寫入業務歷程，不以刪表或刪資料回滾。正式簽署／申報全面切換仍需後續獨立驗收。

本批沒有執行 production migration、建立 Google 帳號／正式人員、發送邀請、變更正式角色、購買方案或變更雲端區域。
