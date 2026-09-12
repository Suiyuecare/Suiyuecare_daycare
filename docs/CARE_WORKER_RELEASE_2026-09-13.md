# 照服員改善版發布紀錄（2026-09-13）

## 發布範圍與狀態

使用者授權發布照服員改善第 1、2、3、5、6 項。功能來源提交為 `6d42086`；本紀錄初版為發布前基線，正式部署結果將在驗證後追加，不能以此檔存在視為已上線。

- 當班個案、上午／下午工作、進食／飲水／如廁／活動快速紀錄。
- 日誌草稿、提交、簽署、退回與不可覆寫的更正歷程。
- 有效期內加密離線草稿與冪等重送；本機草稿不是正式紀錄。
- 中央來源的進食、移位、如廁、溝通候選提醒；人工確認後才可供照服員使用。
- 包含先前尚未發布的可信匯入暫存與店務摘要資料庫依賴。

不變更現有 CEO Google 准入、角色／個案授權、寫入驗證或付費方案；Vercel 東京執行區域與既有 Supabase 首爾專案皆保留。未新增照服員帳號或調整 Finance。

## 發布前窄修

- 查看模式不掛載需要較高驗證等級的日誌操作元件；既有授權摘要仍可查看。不修改後端權限。
- 補上不發出受保護請求、存取改變後移除舊觀察兩項測試。
- 歷史 `executive_read_only_login` 本機與 hosted SQL 的 MD5 同為 `98efde9f4a3149cf6a1b7e86c903947c`；本機檔名對齊 hosted `20260909083009`，沒有 revert 或 repair 雲端遷移歷程。

## 資料庫發布清單

依序套用下列五份既有、已在本機驗證的 migration；發布前 dry-run 只列出這五份。

1. `20260911140908_trusted_import_upload_staging.sql`
2. `20260911165630_store_overview_attendance_summary.sql`
3. `20260912150411_care_diary_lifecycle.sql`
4. `20260912150541_cms_care_reminders.sql`
5. `20260912150549_care_worker_daily_roster.sql`

遷移前：97 個 hosted 版本，care_records 筆數為 0，沒有超過 30 秒的長交易。舊每日服務彙整函式的三個預期更新位置各出現一次。遷移只增加結構／函式，不匯入個案或新增權限指派。

## 驗證與公開資料檢查

- 本輪完整單元測試：345 檔、3,633 項通過；1 項需外部原始檔的既有測試跳過。
- ESLint 通過。乾淨 checkout 先執行 `next typegen` 產生 Next.js 路由型別再執行 TypeScript 檢查。
- 前一輪相同功能基線：102 份 migrations 可編譯、99 份 SQL 測試 4,228 項通過，89 個合成頁面路由與 390px／桌機介面、瀏覽器離線／跨分頁登出通過。這些是本機證據，不當成正式帳號端到端驗收。
- 獨立掃描 HEAD 與 15 個待推送歷史提交，共 1,544 個文字版本及 1 個品牌圖檔；真實密鑰／原始個案資訊匹配為 0。疑似密鑰皆為明示測試 fixture 或環境引用。
- 真實 CMS HTML、私人路徑、環境檔、暫時驗收路由未加入公開原始碼或部署清單。

## 仍待接線與營運驗收

- 正式 HTML WORM storage/runtime、中央欄位 promotion 尚未接通；提醒候選不等於正式個案匯入完成。
- Finance 收支來源尚未配置，店務摘要不得把未連線冒充收入／支出 0。
- 實際照服員授權、真實登入後寫入、跨 session 併發、來源字典與臨床／營運人工驗收仍待完成。
- 發布前安全 advisor 既有 143 項「RLS 無政策」INFO 多為私有 RPC 專用表；不為消除提示增加寬鬆政策。另有既存密碼外洩防護 WARN，未變更 Google 登入或方案。[密碼安全說明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 回復方式

發布前 production deployment：`dpl_JCURJBEcXHi4zU5GRTDbgHXiH8kZ`，來源 `6700f06b6dc57f1180bdfe4948e096795973d997`。若新版本發生阻斷，回復 Vercel alias 至該版；不刪除新表／enum／紀錄，保留版本與稽核歷程。
