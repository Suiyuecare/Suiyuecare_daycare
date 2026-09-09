# 執行長限定 Google 登入：啟用與驗證紀錄

更新：2026-09-09（Asia/Taipei）。本文件不包含真實帳號識別值、Google subject、OAuth secret 或 Token。

目前已完成 Google provider、首位管理員預建與正式入口啟用，正式按鈕可前往 Google 帳號選擇頁。**仍待執行長本人完成 OAuth、MFA 與工作台驗證；不代表已能使用全部功能或承載正式個案資料。**

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

## 前次停用發佈時的雲端狀態（歷史）

以下是同日較早、公司 Google Cloud 尚未授權時的紀錄，已由下節目前狀態取代，不應再用來描述現在的入口。

- 正式網址：`https://daycare.suiyuecare.com`。
- Supabase：既有專案 `mmxqxsokpcdvuzmdhptg`；未遷移區域、升級方案或建立付費資源。
- 雲端 migration：`20260908160122_executive_google_access_gate`。
- 外鍵索引補充 migration：`20260908160716_executive_access_policy_user_id_index`；不改變登入授權。
- Auth `site_url` 已設定正式網址；redirect allowlist 僅為 `https://daycare.suiyuecare.com/auth/callback`。
- 自行註冊、email、phone、anonymous、manual identity linking、OAuth server 均停用。當時 Google 尚未配置完成，沒有可用的登入 provider。
- 核准 allowlist 仍為零筆，Auth users、profiles、memberships 仍為零筆。**尚未建立或啟用執行長帳號，不可宣稱已能登入。**
- `GOOGLE_LOGIN_ENABLED=false`：介面明確顯示尚未設定，伺服器拒絕啟動 OAuth。

## 目前雲端狀態（2026-09-09）

- 使用者已親自登入具權限的公司 Google Cloud 帳號。在公司既有專案新增獨立 Daycare Web OAuth client，保留 Finance、Website 既有 client；未建立新付費專案或修改既有 client。
- 日照 Supabase Google provider 已啟用。自行註冊、email、phone、anonymous、manual identity linking、OAuth server 維持停用；既有固定 `site_url` 與 redirect allowlist 保留，不整份覆寫 Auth 設定。
- 重新核對 Finance 的有效執行長帳號及已驗證 Google identity 後，透過受支援 Auth Admin API 預建唯一日照 Auth 帳號（已確認 email）。不寄測試信、不提供帳密登入、不偽造 Google identity。未傳入 password 不等於斷言底層沒有 password hash；Admin API 可能自行產生不可知的隨機密碼。
- 以單一、受稽核交易建立 active 真實機構／分支各 1 筆、profile 1 筆、membership 1 筆、既有 `organization_manager` 角色綁定 1 筆及 singleton allowlist 1 筆。核對固定日照 UUID／email／Google subject，但不在本文件或公開 source 記載其值。
- 初始化共有 7 筆稽核：6 筆新增，加上既有角色觸發器造成的 membership 版本更新 1 筆。未新增臨床資格授權、護理／專業角色、證照或個案指派；臨床個案指派為 0，既有專業與獨立覆核條件不變。
- 原有 inactive TEST 機構及隔離分支原封不動，未啟用、改名或轉為真實資料。新機構使用使用者已確認的名稱與臺北市資訊；UUID／slug 僅為內部識別碼。未知法定代碼、許可、地址與核定容量留空，未捏造正式機構核准版本。
- `GOOGLE_LOGIN_ENABLED=true` 已重建並發佈；正式登入按鈕已啟用。已實測從正式入口前往 `accounts.google.com` 帳號選擇頁，這僅證明 OAuth 起始導向，不證明已完成 callback 交換、身分自動連結或登入。
- Google identity 須由執行長本人後續完成真實 OAuth 才能建立。本人授權、首次 TOTP 設定／驗證、AAL2 工作台、直接 API／RLS 與登出撤銷仍待端到端驗證；不可宣稱全部功能已可使用。

## 外部待辦與啟用順序

1. **已完成：**由使用者親自登入具公司 Google Cloud 專案權限的公司帳號；不得以新開專案、修改 Finance OAuth client 或申請付費方案代替公司授權。
2. **已完成：**在公司既有 Google Cloud 專案建立獨立日照 Web OAuth client。JavaScript origin 為 `https://daycare.suiyuecare.com`；Google authorized redirect URI 為 `https://mmxqxsokpcdvuzmdhptg.supabase.co/auth/v1/callback`（注意不是日照應用程式 callback）。
3. **已完成：**將 Client ID／Secret 存入日照 Supabase Google provider，保留其他 provider／manual linking／OAuth server 停用；以最小範圍設定，不覆寫整份 Auth 配置。
4. **已完成：**唯讀核對 Finance 核准執行長的 active 狀態與已驗證 Google identity，透過 Auth Admin API 預建單一、已確認 email 的日照帳號；不提供帳密登入、不寄測試信、不偽造 `auth.identities`。
5. **已完成：**以單一交易建立實際機構／分支、profile、membership、既有 `organization_manager` 角色綁定及 singleton allowlist。不得將識別值提交到公開 source、啟用 TEST 機構或額外授予臨床資格。
6. **已完成：**先確認 provider、固定 URI、預建單一帳號與核准綁定，再將 `GOOGLE_LOGIN_ENABLED=true`，重建、受保護驗證及發佈；此時才能提供真人 OAuth 入口。不能要求在入口停用時先完成真人 OAuth。
7. **待本人完成：**由執行長親自選擇公司 Google 帳號並授權，讓 Supabase 建立／自動連結真實 Google identity，再核對原先固定的日照 UUID、email 與 subject；不得索取或代填帳號密碼、OTP 或驗證器密碼。
8. **待驗證：**完成實際 Google → MFA 設定／登入 → 機構工作台 → API／RLS → 登出清除、session 撤銷的端到端驗證；測試其他 Google 帳號不得進入，且臨床資格、獨立覆核仍被阻擋。

## 測試口徑

- 新 executive policy 的 pgTAP 必須在全部正式 migrations、沒有任何 admission override 下執行。
- 既有 93 份多角色業務 pgTAP 在新建記憶體 PGlite 中，以明列的 frozen suite 清單替换新單人入口 predicate，僅用於原角色／AAL／機構隔離業務回歸；不可把這些結果當成正式單人入口的權限驗收。
- 此測試專用處理不存在正式 SQL、seed、共用 bootstrap、環境旗標或 hosted DB connection。新測試預設都使用未修改的 gate。
- 單元／本機資料庫通過，不代表真實 Google Cloud provider、正式 Auth identity、自動連結、MFA、CSP redirect 或撤銷時序已端到端通過。

## 復原限制

Google 設定失敗時維持登入停用與 default-deny，不得以重開密碼／手機、自行註冊、移除 gate 或降低 MFA 作為替代。登入問題不構成放寬臨床與簽署規則的理由。

## 前次停用狀態正式發佈證據（歷史）

以下驗證針對舊的 disabled 部署；其 Google 按鈕與 Auth 零帳號狀態不代表目前狀態。

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

## 本次啟用入口的正式發佈證據（2026-09-09）

- 正式網址：`https://daycare.suiyuecare.com`；部署 `dpl_3WsjAxQwn91rPhGyFRhubsiM8doC`，READY／production；Next.js `16.3.3`，建置部署約 39 秒。
- 部署網址：`https://suiyue-daycare-preview-119756l9b-entrepreneur-9585s-projects.vercel.app`。
- Source commit：`12cf5b17aed877718f333774993a3726a762fb2d`；runtime code 基線：`11b53f9e450ab2451e864a46d056542241210566`。本次文件補充不改寫已部署的程式或部署來源。
- 維持既有 Vercel 專案與 `hnd1` 執行區域；採 staged deployment → 受保護驗證 → promote。正式旗標為 `GOOGLE_LOGIN_ENABLED=true`，沒有降低 deployment protection、MFA 或資料庫 gate。
- 本次針對性回歸：139 項 Auth Vitest、115 項未修改 gate 的 executive pgTAP 通過；不把 93 份 legacy admission fixture 當成正式單人入口驗收。
- 已實測正式頁面的啟用按鈕可沿固定 OAuth 路徑前往 Google `accounts.google.com` 帳號選擇頁，未代替本人選帳號或授權。
- 正式頁面 1440px／390px 視覺 QA：Google 按鈕均為 enabled，高度 44px、字級 16px；鍵盤焦點可見、無水平溢出，pageerror 為 0；已由主流程實際檢視兩張 PNG 截圖。
- 正式安全探測：跨來源 `POST /auth/google` 與無效 code 的 `/auth/callback` 均回傳 303、固定錯誤入口及 no-store；未授權 `POST /api/clients` 回傳 401／no-store。這些為本次 enabled 部署的實測，不沿用舊 disabled 部署結果。
- 雲端唯讀確認：本次 onboarding 的六張資料表 RLS 均啟用；anon 無法讀取 allowlist，authenticated／service_role 無法更新 allowlist。既有 MFA、資料範圍與資料庫 gate 未放寬。
- 該部署最近 10 分鐘錯誤紀錄查詢為 0 筆；僅代表本次觀測窗口，不能作為持續監控或 SLA 保證。
- 本次最後核對時，真實 Google identity 為 0、MFA factor 為 0；仍等待本人完成 Google 授權及驗證器設定，不能以預建 Auth 帳號替代真人登入驗證。
- **目前完成的是 provider 設定、預建授權與 OAuth 起始導向，不是本人登入成功。** 尚待使用者自行選帳號授權，完成 callback、自動連結、首次 MFA 與工作台驗證後，才能記錄該條完整登入流程通過；不得據此宣稱全部模組或正式個案作業已驗收。
