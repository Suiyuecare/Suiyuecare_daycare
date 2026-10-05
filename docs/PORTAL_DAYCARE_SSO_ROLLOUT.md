# 公司入口與日照單一登入驗收

本版讓已登入公司入口的使用者點選「日間照顧系統」後，以一次性、10 分鐘內有效的簽署票證建立**日照自己**的 Supabase 工作階段。兩個應用不共用 Cookie、Refresh Token 或 Service Role Key；正式權限仍由日照現有的 Google 主體、職務、分支與資料庫守門判定。

## 發布前條件

1. 先套用 `20261005033608_portal_google_handoff_session_grants.sql`，並在正式 PostgreSQL 執行相應 pgTAP 與既有 Google 登入迴歸。遷移前不得打開公司入口的日照模組。
2. 公司入口與日照正式環境各設定**同一組、專屬日照、由密碼學亂數產生且至少 32 bytes** 的 `PORTAL_DAYCARE_HANDOFF_SECRET`。不得與 APM、Finance、eDoc 或 Supabase 金鑰共用；不得寫入 Git、瀏覽器或日誌。
3. 日照 `NEXT_PUBLIC_APP_ORIGIN` 必須是 `https://daycare.suiyuecare.com`，Supabase URL、publishable key、server-only secret key 必須指向**同一日照專案**。公司入口只將表單 POST 至固定的日照 `/api/auth/handoff`；日照只接受 `https://login.suiyuecare.com` 或公司持有的 OAuth bridge `https://suiyuecare-website.vercel.app` 兩個精確 Origin 與其對應 Fetch Metadata，不接受萬用網域。
4. 開通使用者必須先有日照本地、已核准且有效的 Google subject、員工身分、職務、機構與分支。僅有公司入口權限或相同 email 不足以登入日照。現有主任如只有待啟用邀請，先以日照原生 Google 登入完成**一次**啟用；票證交換不會替她自動建帳號。

## 交換與安全邊界

- 票證僅含 `email`、`googleSub`、`aud=daycare`、`iat`、`exp`、`jti`、`returnTo`；HMAC 驗證、受限 `/app` 內部返回路徑、一次性 JTI 先於 Auth 換票處理。
- 日照用已核准的本地 Auth UUID 產生一次性 magiclink 並在伺服器端 `verifyOtp`，比較新核發、已驗證的 JWT 與目前 Cookie 所對應的 `session_id`，再將**實際** `auth.sessions.session_id` 綁到已使用的 JTI；後續每次資料查閱仍由本地資料庫重新檢查撤權和活躍分支。
- B 帳號票證失敗時不自動沿用既有 A 帳號，也不因任意無效票證強制登出 A 帳號；畫面會明確顯示修復入口。有效 B 票證應取代日照 Cookie，這點仍須用真實瀏覽器與 Auth 驗收。
- 已有有效日照工作階段重新打開 `/login` 會回工作台。未登入直接開 `/app/...` 的瀏覽器頁面會轉到公司入口並保留安全深連結；明確登出後的 `/login` 不會自動把人登入回來。
- 原 Google PKCE 登入路徑保留供首次啟用與故障備援。簽署、匯出等操作仍須日照本地最近 15 分鐘的 AAL2；公司入口票證本身不是第二因素。
- 缺少任何簽署密鑰、資料庫 RPC、授權、工作階段證據，或偵測到重播時一律拒絕。不得為排除錯誤改為 email-only 登入。

## 正式上線驗收（未完成前不得宣稱生產可用）

1. 在**隔離的 Supabase Auth 環境**完成真實 `generateLink` → `verifyOtp`，核對 Cookie、JWT `iss`、`session_id`、AMR 的 `otp`/`magiclink` 方法及資料庫綁定；本機 mock/PGlite 不能取代這項驗收。
2. 實測執行長：公司入口已登入 → 點日照 → 不再挑一次 Google 帳號 → 進日照工作台；另測直接貼上 `/app/...` 深連結。
3. 實測主任：待啟用時明確引導一次原生 Google 啟用；啟用後同樣免重複登入，僅見萬華分支資料。
4. 實測錯誤密鑰、錯誤 Google subject、未開通帳號、票證重播、過期、跨機構/分支、工作階段撤銷與日照登出；拒絕後不留可用 Auth Cookie，且不在 URL 或日誌洩漏票證/個資。
5. 原 Google PKCE、AAL2 重新驗證、89 頁路由與行動版登入回歸通過。確認兩端部署同一協議版本，關鍵錯誤監控不包含明文 email、subject、票證、OTP 或 Cookie。

若上述任一條不過，先停用公司入口日照模組連結；原日照 Google 登入可獨立使用，**不要**放寬資料庫守門或直接操作既有使用者的瀏覽器工作階段。

## 單次登入票證帳本的資料保留

`private.portal_sso_ticket_claims` 保存核對撤權所需的 email、Google subject 與工作階段 ID；表已強制 RLS，只能由資料庫擁有者的核准函式處理，變更會另外留下 `audit_events` 的欄位名稱／紀錄 ID 稽核（不複製這些明文值）。因此**不能**在票證到期 10 分鐘後立刻刪除仍在使用的 session 對應列，否則使用者會失去正常存取。

建議資料負責人與法務先核准：已登出／已撤銷的票證帳本於建立 **90 天後**清除，仍存在 `auth.sessions` 的列延後至該工作階段結束且滿 90 天；稽核事件依機構正式稽核保留政策管理。清理應由受控、可重試的資料庫管理作業執行，條件同時檢查 `claimed_at < clock_timestamp() - interval '90 days'` 與 `bound_session_id is null OR NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = bound_session_id)`，每批限量、記錄清理筆數與核准單號，先在測試庫驗證再排程。正式保留年限未核准前不啟用自動清理，也不允許一般 API/使用者刪除帳本；受控試辦期間由資料負責人監看帳本量。
