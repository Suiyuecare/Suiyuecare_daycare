# 歲悅日照業務管理系統

這個專案是「11 模組、89 頁」規劃的可執行產品基線。它使用 Next.js 16 App Router、TypeScript、Supabase 與 Vercel，並把中央系統 HTML 匯入、員工 MFA、家屬 OTP、分支資料範圍、RLS、離線草稿、LINE webhook、通知及申報介面放在同一套安全邊界內。

目前完成的是可驗證的工程基線與首批垂直流程，不應被宣稱為已可正式營運的 89 頁完整產品。各期實作與外部上線門檻請見 [實作狀態](docs/IMPLEMENTATION_STATUS.md)。

首間試辦已確認為「樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構」（臺北市）。[試辦設定、官方來源與待補文件](docs/PILOT_TAIPEI_WANHUA.md)皆與正式機構／規則綁定分離，尚未建立正式環境。

## 線上唯讀試用

2026-09-08 資料盤點版已發布至獨立受保護 Preview，需有權限的 Vercel 帳號。

- [資料盤點與缺漏追蹤](https://suiyue-daycare-preview-dmflbuz0n-entrepreneur-9585s-projects.vercel.app/app/staff/governance/integrations-audit#data-inventory)
- [中央匯入欄位追蹤](https://suiyue-daycare-preview-dmflbuz0n-entrepreneur-9585s-projects.vercel.app/app/staff/governance/central-html-import)

僅合成資料，可篩選與查閱，不接受真實個資或寫入。盤點／修訂／覆核後端已有本機驗證，但正式資料庫、匯入寫入、封存與七年移轉仍未上線。詳見 [本批發布證據與限制](docs/RELEASE_2026-09-08_DATA_READINESS.md)。

## 已具備

- 11 個模組、89 個穩定頁面定義與獨立路由；83 個機構端入口、6 個家屬端入口。
- 手機、平板、桌機共用的工作台、側邊導覽、篩選、清單、明細抽屜、空值與錯誤狀態；正式模式下，未完成專用驗收的頁面明確維持唯讀，不以展示表單偽裝成可用功能。
- 員工密碼登入、強制 TOTP MFA；家屬手機 OTP 且禁止登入時自動建立帳號。
- 機構／分支情境與切換、Supabase RLS、角色與欄位權限基礎、AAL2 高風險門檻及稽核資料表。
- 中央 HTML 25MB／MIME／UTF-8／SHA-256 驗證、純靜態解析、未知欄位與衝突預覽；不執行 JavaScript、不載入外部資源。
- 東京區 S3 KMS + Object Lock Compliance 七年封存元件；正式匯入儲存未完成設定時會拒絕操作。
- SPMSQ、GDS-15、Barthel ADL、Lawton IADL、MNA-SF 版本化純函式計分；目前全部標記為「未核准生效」。
- 去識別化展示草稿、限定照顧日誌的正式草稿 API、具使用者／機構／分支命名空間的 PWA 離線草稿、LINE HMAC webhook、通知預覽／佇列、申報快照／對帳與可替換簡訊介面。
- 展示模式只使用合成、去識別化資料；正式環境會強制停用展示模式。

## 本機預覽

需求：Node.js 22 以上、pnpm 11。

```bash
pnpm install
pnpm dev:demo
```

瀏覽 `http://127.0.0.1:3000`，選擇「使用去識別化展示資料」。如需改用其他本機連接埠：

```bash
pnpm dev:demo -- --port 3100
```

`dev:demo` 只綁定 `127.0.0.1`，強制使用 development 展示模式與 mock SMS，並在子程序中以空值覆蓋 Supabase、資料庫、AWS、LINE、簡訊及文件簽署設定。因此，即使 shell 或 `.env.local` 留有設定，也不會由此命令啟用外部介接。啟動器不會讀寫或修改任何 `.env` 檔；與本命令無關的系統環境變數會保留。`DEMO_MODE=true` 在 production build 中仍會被程式強制忽略。

一般 `pnpm dev` 不具上述隔離保證，只應在確定要測試已設定的外部服務時使用。不要用 `dev:demo` 進行正式資料、上線或整合驗收。

## 驗證

```bash
pnpm verify
```

此命令依序執行 ESLint、TypeScript、Vitest 單元測試、本機 PGlite pgTAP 相容性測試及正式建置。PGlite 可在沒有 Docker 時提早攔截 migration／權限／流程回歸；正式 Supabase PostgreSQL、資料庫 lint 與雙連線競態仍是獨立上線門檻。

啟動本機網站後，可另跑完整 89 頁入口煙霧測試；非預設連接埠可透過 `ROUTE_SMOKE_BASE_URL` 指定：

```bash
pnpm test:routes
```

## 正式環境

1. 在東京 `ap-northeast-1` 建立 Supabase 專案，套用 `supabase/migrations/`，再建立實際員工、分支、角色與權限。
2. 建立東京 S3 bucket，啟用 Versioning、Object Lock，使用 KMS key，並以最小權限 IAM role 提供執行環境。
3. 於 Vercel 付費專案設定 Node.js 22；`vercel.json` 已將 Functions 主區域固定為東京 `hnd1`。
4. 設定 LINE 公司 Provider、正式 SMS 供應商、DPA／次處理者／跨境傳輸及退出條款。
5. 依 [正式上線檢查表](docs/PRODUCTION_GATES.md) 完成第三方滲透測試、備份還原、七年移轉彩排與一個完整申報週期平行運行。

不要把帳號、密碼、Supabase secret、AWS 憑證或 LINE token 寫入程式碼或提交到版本控制。

## 公開原始碼與資料邊界

程式儲存庫：[Suiyuecare/Suiyuecare_daycare](https://github.com/Suiyuecare/Suiyuecare_daycare)。公開程式不代表正式業務環境已啟用，也不代表試用網站的存取保護已解除。

只提交程式、資料結構、文件及合成測試資料。`.env.example` 只提供無機密的設定範本；本機環境檔、雲端連結資料、匯出／截圖／驗證產物、原始個案 HTML、真實附件及資料庫備份不得提交。提交前必須檢查實際 staged 檔案與內容，不能只依賴 `.gitignore`。

唯一允許提交的 HTML 是 `tests/fixtures/imports/synthetic-central.html`，它是靜態解析安全測試，不得以瀏覽器執行。字型測試子集必須連同其 README 與 `OFL.txt` 授權一起保留。

目前 Vercel 已連接此儲存庫，`main` 為正式部署分支；初次公開來源使用 `codex/initial-public-source`。在正式環境與資料安全驗收前，不將此批次合併至 `main`，也不以程式推送代替正式上線核准。

## 重要目錄

- `src/lib/catalog/`：89 頁單一真實來源。
- `src/lib/imports/`：HTML 隔離解析、冪等與 WORM 封存。
- `src/lib/assessments/`：版本化量表計分。
- `src/lib/integrations/`：同步、通知、LINE、申報與簡訊。
- `supabase/migrations/`：資料模型、RLS、AAL2 與稽核。
- `docs/`：實作狀態、正式上線門檻與 API 邊界。
