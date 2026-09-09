# 執行長限定 Google 登入：啟用與驗證紀錄

更新：2026-09-09（Asia/Taipei）。本文件不包含真實帳號識別值、Google subject、OAuth secret 或 Token。

執行長本人已完成真實 Google OAuth，已確認 Google identity 與工作階段各 1 筆，並到達舊版 `/mfa`。使用者於 2026-09-09 16:10 明確要求取消登入第二層驗證；本機已改為 Google 登入後直接進工作台，重要操作仍另行驗證。**新版 build、SQL 驗證與正式發佈尚未全部完成；不能宣稱正式工作台已免登入 MFA，更不代表 89 頁全部免驗證、已完成正式營運驗收或可承載真實個案資料。**

## 範圍

採用會計系統的「驗證 Google 身分 → 核准帳號綁定 → 機構角色／權限」模型；不修改會計系統、不共用兩個 Supabase 專案的 session、Auth UUID 或資料。日照只接受一名事先核准的執行長。

登入授權不是臨床資格。本次政策變更僅取消進入工作台的 MFA 門檻；寫入（含草稿）、敏感資料查閱、簽署、匯出、申報與權限調整仍依原有 AAL2／近期驗證、分支／個案範圍、專業資格、版本化簽署及獨立覆核條件執行。只有一名使用者時，需要第二人的流程仍不可完成。

## 已實作的安全邊界

以下包含本機已完成、尚待此次正式發佈的登入政策調整；不可直接視為目前正式部署行為。

- 正常登入頁只有 Google 入口，無密碼、手機、家屬或自行註冊入口；合成資料唯讀展示維持原有隔離。
- `/auth/google` 僅接受同源 POST，使用固定站點與固定 callback，不接受瀏覽器指定 email、角色或回跳網址。
- Supabase SDK 的 PKCE flowId 綁定短效 HttpOnly、Secure、SameSite=Lax cookie；callback 核對實際 user、JWT claims 與資料庫 allowlist，成功固定導向 `/app/dashboard`，不再自動導向 MFA。
- 拒絕時僅回傳固定、無個資的錯誤；清除本專案 Auth cookies，不干擾會計系統工作階段。
- `private.executive_access_policy` 是只有一筆的封閉核准綁定；API 角色不能讀取或變更，缺少綁定即拒絕。
- 比對固定日照 Auth UUID、email、Supabase 持有的 verified Google subject、實際 auth session 與 AMR；不依可編輯的 user metadata 授權。
- 六個底層權限判斷加入相同入口限制，保留原 OID、ACL 與業務條件。MFA 入口與伺服器 tenant context 另行核對。
- `requireTenantContext` 不再因真實 AAL1 而自動導向 MFA，也不把 AAL1 偽裝為 AAL2；`hasRecentAal2` 仍須取得原有伺服器／資料庫驗證證據。
- 已授權人員直接開啟舊 `/mfa`、缺少或使用無效／多值 purpose 時，固定返回工作台，不掛載會啟動驗證器設定的元件。只有明確 `purpose=sensitive-action` 且通過伺服器授權，才顯示重要操作驗證頁。
- 42 個既有重要操作／敏感資料查閱的手動驗證連結僅補上 purpose；不改變業務 canWrite、scope、專業資格或核准條件。驗證器標題改為「重要操作：設定驗證器」，保留既有設定、挑戰及驗證行為。
- 外部 Google OAuth 憑證只可設定於 Supabase Auth；不得放入前端、公開 repository、Vercel 公開環境變數或紀錄檔。

## 前次停用發佈時的雲端狀態（歷史）

以下是同日較早、公司 Google Cloud 尚未授權時的紀錄，已由下節目前狀態取代，不應再用來描述現在的入口或帳號。

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
- `GOOGLE_LOGIN_ENABLED=true` 已於較早部署重建並發佈；正式登入按鈕已啟用。較早的帳號選擇頁探測與部署資料保留於下方歷史證據；不把它當成此次登入政策變更已發佈的證據。
- 執行長本人現已完成真實 Google OAuth，雲端確認 Google identity 1 筆、session 1 筆，並到達舊版 `/mfa`。這次是真實身分連結與工作階段，不再是僅有預建帳號或 OAuth 起始導向；但工作台操作尚未完成端到端驗收。
- 舊 MFA 頁自動設定產生 1 筆未驗證 TOTP，verified factor 為 0。依使用者取消登入第二層的要求，主代理透過受支援 Auth Admin API 撤銷該筆精確未驗證 factor；回讀 remaining factor 0、移除的 verified factor 0。過程未索取、記錄或代填使用者密碼／Token，亦未移除已驗證因素；不在文件記載帳號 UUID、Google subject 或 factor ID。
- 目前沒有替本人完成 TOTP 驗證，也沒有把工作階段升級或偽裝為 AAL2。登入政策變更需與下節本機 migration／程式一起完成驗證及正式發佈；重要操作仍須符合各自原有條件。

## 外部待辦與啟用順序

1. **已完成：**由使用者親自登入具公司 Google Cloud 專案權限的公司帳號；不得以新開專案、修改 Finance OAuth client 或申請付費方案代替公司授權。
2. **已完成：**在公司既有 Google Cloud 專案建立獨立日照 Web OAuth client。JavaScript origin 為 `https://daycare.suiyuecare.com`；Google authorized redirect URI 為 `https://mmxqxsokpcdvuzmdhptg.supabase.co/auth/v1/callback`（注意不是日照應用程式 callback）。
3. **已完成：**將 Client ID／Secret 存入日照 Supabase Google provider，保留其他 provider／manual linking／OAuth server 停用；以最小範圍設定，不覆寫整份 Auth 配置。
4. **已完成：**唯讀核對 Finance 核准執行長的 active 狀態與已驗證 Google identity，透過 Auth Admin API 預建單一、已確認 email 的日照帳號；不提供帳密登入、不寄測試信、不偽造 `auth.identities`。
5. **已完成：**以單一交易建立實際機構／分支、profile、membership、既有 `organization_manager` 角色綁定及 singleton allowlist。不得將識別值提交到公開 source、啟用 TEST 機構或額外授予臨床資格。
6. **已完成：**先確認 provider、固定 URI、預建單一帳號與核准綁定，再將 `GOOGLE_LOGIN_ENABLED=true`，重建、受保護驗證及發佈；此時才能提供真人 OAuth 入口。不能要求在入口停用時先完成真人 OAuth。
7. **已完成：**執行長親自選擇公司 Google 帳號並完成授權，Supabase 建立／自動連結真實 Google identity；雲端確認單一 identity 與 session，本人到達舊版 `/mfa`。未索取或代填帳號密碼、OTP 或驗證器密碼。
8. **本機已修改、發佈未完成：**依使用者 16:10 的明確政策變更，將 Google callback 與已授權 AAL1 tenant context 改為進工作台，加入最小唯讀投影 migration，保留所有其他 AAL2／資格／覆核條件；完成 build、SQL 測試、審查與正式發佈後才記錄上線。
9. **待新版正式驗證：**完成實際 Google → AAL1 工作台（沒有自動 QR／驗證器設定）→ 僅授權唯讀投影 → API／RLS → 登出清除／session 撤銷的端到端驗證。明確敏感操作才前往 `?purpose=sensitive-action`，其他 Google 帳號、未驗證寫入、臨床資格與第二人覆核缺漏仍須被阻擋；不可把一般登入改動當成全部功能免 MFA。

## 登入政策變更與短版 release note（2026-09-09 16:10，尚未完成發佈）

- **變更依據：**使用者明確取消登入時的第二層驗證，這是經授權的登入政策變更，不是用放寬安全條件掩蓋 Google 設定故障。
- **本機程式：**Google callback 成功固定回工作台；AAL1 不再自動導向 MFA；一般 `/mfa` 不掛載設定元件，重要操作需明確 purpose。CEO 單人入口、資料隔離及建置驗證版「勿輸入真實個案資料」提示保留。
- **本機資料庫：**新增 `20260909081737_executive_read_only_login.sql`，僅讓通過既有單人 Google gate 的 AAL1 取得 tenant／dashboard 所需唯讀投影。沒有授予新的角色、scope、臨床資格或寫入能力；寫入、草稿、敏感查閱、簽署、匯出、申報及權限流程仍依各自原有 AAL2／近期驗證與資格覆核條件拒絕不足授權。
- **已確認的本機結果：**主流程 ESLint、TypeScript 與全套 Vitest 已通過；Vitest 為 304 檔／2,999 tests。針對登入／MFA／連結的測試亦已通過，不把重疊測試數相加當成不同案例。
- **尚未完成的驗證／發佈：**正式 build 及新增 SQL suite 正在執行，尚未取得此次全部 SQL／build 通過、migration 正式套用、新部署或正式工作台實測證據。本節不填猜測的部署 ID、commit 或成功結果；下方較早部署證據不適用此版登入行為。

## 測試口徑

- 新 executive policy 的 pgTAP 必須在全部正式 migrations、沒有任何 admission override 下執行。
- 既有 93 份多角色業務 pgTAP 在新建記憶體 PGlite 中，以明列的 frozen suite 清單替换新單人入口 predicate，僅用於原角色／AAL／機構隔離業務回歸；不可把這些結果當成正式單人入口的權限驗收。
- 此測試專用處理不存在正式 SQL、seed、共用 bootstrap、環境旗標或 hosted DB connection。新測試預設都使用未修改的 gate。
- 單元／本機資料庫通過，不代表真實 Google Cloud provider、正式 Auth identity、自動連結、MFA、CSP redirect 或撤銷時序已端到端通過。

## 復原限制

Google 設定失敗時維持登入停用與 default-deny，不得以重開密碼／手機、自行註冊或移除 gate 作為替代。本次僅有使用者明確授權的「取消登入 MFA、保留重要操作驗證」政策變更；不得擴大成其他 AAL2／近期驗證豁免。登入問題不構成放寬臨床、簽署或獨立覆核規則的理由。

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

## 較早啟用入口的正式發佈證據（2026-09-09，歷史）

以下為此次 16:10 政策變更前的 Google → MFA 部署及其當時觀測，保留供追溯；不代表新版 Google → 工作台已發佈，也不代表最新 identity／factor 數量。

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
- 該次最後核對時，真實 Google identity 為 0、MFA factor 為 0；當時仍等待本人完成 Google 授權及驗證器設定，不能以預建 Auth 帳號替代真人登入驗證。最新已完成 OAuth 及清除未驗證因素的紀錄見上方目前雲端狀態。
- **該次發佈僅完成 provider 設定、預建授權與 OAuth 起始導向，當時尚非本人登入成功。** 原先待本人完成 callback、自動連結、首次 MFA 與工作台的流程，現已由使用者明確變更為 Google → 工作台、重要操作另外驗證；舊部署證據不可用來宣稱新流程或全部模組／正式個案作業已驗收。
