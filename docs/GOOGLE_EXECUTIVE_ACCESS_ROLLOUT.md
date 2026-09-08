# 執行長限定 Google 登入：啟用與驗證紀錄

更新：2026-09-09（Asia/Taipei）。本文件不包含真實帳號識別值、Google subject、OAuth secret 或 Token。

## 範圍

採用會計系統的「驗證 Google 身分 → 核准帳號綁定 → 機構角色／權限」模型；不修改會計系統、不共用兩個 Supabase 專案的 session、Auth UUID 或資料。日照只接受一名事先核准的執行長。

登入授權不是臨床資格。既有 MFA、近期 AAL2、分支／個案範圍、專業資格、版本化簽署與第二位獨立覆核者的要求均保留。只有一名使用者時，需要第二人的流程仍不可完成。

## 已實作的安全邊界

- 正常登入頁只有 Google 入口，無密碼、手機、家屬或自行註冊入口；合成資料唯讀展示維持原有隔離。
- `/auth/google` 僅接受同源 POST，使用固定站點與固定 callback，不接受瀏覽器指定 email、角色或回跳網址。
- Supabase SDK 的 PKCE flowId 綁定短效 HttpOnly、Secure、SameSite=Lax cookie；callback 核對實際 user、JWT claims 與資料庫 allowlist，成功固定導向 `/mfa`。
- 拒絕時僅回傳固定、無個資的錯誤；清除本專案 Auth cookies，不干擾會計系統工作階段。
- `private.executive_access_policy` 是只有一筆的封閉核准綁定；API 角色不能讀取或變更，缺少綁定即拒絕。
- 比對固定日照 Auth UUID、email、Supabase 持有的 verified Google subject、實際 auth session 與 AMR；不依可編輯的 user metadata 授權。
- 六個底層權限判斷加入相同入口限制，保留原 OID、ACL 與業務條件。MFA 入口與伺服器 tenant context 另行核對。
- 外部 Google OAuth 憑證只可設定於 Supabase Auth；不得放入前端、公開 repository、Vercel 公開環境變數或紀錄檔。

## 雲端目前狀態

- 正式網址：`https://daycare.suiyuecare.com`。
- Supabase：既有專案 `mmxqxsokpcdvuzmdhptg`；未遷移區域、升級方案或建立付費資源。
- 雲端 migration：`20260908160122_executive_google_access_gate`。
- 外鍵索引補充 migration：`20260908160716_executive_access_policy_user_id_index`；不改變登入授權。
- Auth `site_url` 已設定正式網址；redirect allowlist 僅為 `https://daycare.suiyuecare.com/auth/callback`。
- 自行註冊、email、phone、anonymous、manual identity linking、OAuth server 均停用。Google 尚未配置完成，因此目前沒有可用的登入 provider。
- 核准 allowlist 仍為零筆，Auth users、profiles、memberships 仍為零筆。**尚未建立或啟用執行長帳號，不可宣稱已能登入。**
- `GOOGLE_LOGIN_ENABLED=false`：介面明確顯示尚未設定，伺服器拒絕啟動 OAuth。

## 外部待辦與啟用順序

1. 由具公司 Google Cloud 專案權限的公司帳號登入。目前可用的個人瀏覽器帳號沒有該專案權限；不得代替公司新開專案、修改 Finance OAuth client、申請付費方案或擅自提出權限申請。
2. 在公司既有 Google Cloud 專案建立獨立日照 Web OAuth client。JavaScript origin 為 `https://daycare.suiyuecare.com`；Google authorized redirect URI 為 `https://mmxqxsokpcdvuzmdhptg.supabase.co/auth/v1/callback`（注意不是日照應用程式 callback）。
3. 將 Client ID／Secret 存入日照 Supabase Google provider，保留其他 provider／manual linking／OAuth server 停用；以最小範圍設定，不覆寫整份 Auth 配置。
4. 再次唯讀核對 Finance 核准執行長的 active 狀態與已驗證 Google identity。透過受支援的 Auth Admin API 預建單一日照帳號，不設定密碼、不寄測試信、不直接偽造 `auth.identities`。
5. 以獨立、受稽核的單一交易建立實際機構／分支、profile、membership、日照 `organization_manager` 角色綁定及 singleton allowlist。Google subject 與日照 UUID 不得提交到公開 source。不得啟用 TEST 機構或授予臨床資格。
6. 真實 Google OAuth 必須由執行長親自完成，由 Supabase 建立 Google identity；不得索取或代填帳號密碼、OTP 或驗證器密碼。
7. 確認 provider、固定 URI、單一帳號綁定後才將 `GOOGLE_LOGIN_ENABLED=true` 並重建／發佈。若尚未可做真人驗證，保留停用狀態。
8. 完成實際 Google → MFA 設定／登入 → 機構頁 → API／RLS → 登出清除、session 撤銷的端到端驗證；測試其他 Google 帳號不得進入，且臨床資格、獨立覆核仍被阻擋。

## 測試口徑

- 新 executive policy 的 pgTAP 必須在全部正式 migrations、沒有任何 admission override 下執行。
- 既有 93 份多角色業務 pgTAP 在新建記憶體 PGlite 中，以明列的 frozen suite 清單替换新單人入口 predicate，僅用於原角色／AAL／機構隔離業務回歸；不可把這些結果當成正式單人入口的權限驗收。
- 此測試專用處理不存在正式 SQL、seed、共用 bootstrap、環境旗標或 hosted DB connection。新測試預設都使用未修改的 gate。
- 單元／本機資料庫通過，不代表真實 Google Cloud provider、正式 Auth identity、自動連結、MFA、CSP redirect 或撤銷時序已端到端通過。

## 復原限制

Google 設定失敗時維持登入停用與 default-deny，不得以重開密碼／手機、自行註冊、移除 gate 或降低 MFA 作為替代。登入問題不構成放寬臨床與簽署規則的理由。

## 本次正式發佈證據

- 日期：2026-09-09（Asia/Taipei）。部署 `dpl_GagJG1PvqXHjNfz4nm2fXFPC1uKt`，READY／production。
- 執行碼 commit：`11b53f9e450ab2451e864a46d056542241210566`；本文件後續證據補充不改變已部署的執行碼。
- 部署網址：`https://suiyue-daycare-preview-mffz9ise9-entrepreneur-9585s-projects.vercel.app`。
- 已驗證正式 domain alias `daycare.suiyuecare.com` 指向上述部署與既有 Vercel 專案；function region `hnd1`，雲端建置約 74 秒。建置區域 `iad1` 不等於執行區域。
- 採 production staged deploy → 受保護驗證 → promote，未關閉 deployment protection。第一個雲端建置因登入旗標帶換行而失敗，未推進正式 alias；改為精確 `false` 設定後重建成功，未放寬環境驗證。
- 全套 Vitest：302 檔／2,979 tests；ESLint 零警告；TypeScript 與正式 build 通過。
- 全套 pgTAP：96 migrations 編譯，94 檔／3,894 assertions 通過。115 項是未修改 gate 的 executive suite；其餘 3,779 項是上文已說明的 93 份 legacy 業務回歸。
- 針對跨午夜修正三份測試 fixture：attendance、external health devices、hand hygiene；沒有修改正式出勤或設備業務規則。
- 正式 89 頁匿名存取全數包含 Next 串流登入轉址及 no-store，沒有受保護頁面標題。串流轉址 HTTP 200 不等於授權成功；已用瀏覽器獨立確認日常照顧、家屬首頁、MFA 實際導航回登入頁。
- 正式六個匿名 API 探測：MFA challenge、clients、claims export、role request、HTML import 均 401；有效格式但未授權的 reauth RPC 回 403；全部 private／no-store。空 reauth body 回 400 是既有輸入驗證，非已登入。
- 同源／跨來源 Google 啟動、無效 callback 與未登入 MFA 共四項均返回登入，沒有啟動外部 OAuth。
- 正式登入頁：1440px、390px Google 單一入口與停用說明正確，無帳密／電話欄位、無橫向溢出；按鈕高度 44px，字級 16px。固定錯誤訊息不回顯惡意參數。瀏覽器 console／error 為零，已檢視三張截圖。
- 發佈後觀測：該部署最近 10 分鐘 error logs 查詢沒有結果；這僅為當下觀測，不代表已具備持續監控或 SLA 保證。
- 尚未執行真人 Google → MFA → 機構頁測試，尚未完成公司 Cloud 授權或建立執行長帳號。**前台已發佈登入限制，不代表系統已可登入或可承載正式個案資料。**
- 未推送 GitHub；程式與證據保留於隔離 release branch，原本的使用者 dirty checkout 未被覆寫。
