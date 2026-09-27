# 連續工作與表單回饋：實作／驗收紀錄

日期：2026-09-28。狀態：本機候選，未發布。延續 `VISUAL_TASK_FIRST_PLAN_2026-09-28.md`，不代表89頁全部完成。

## 本輪交付與驗收

| 改善 | 已實作 | 驗收依據／範圍 |
|---|---|---|
| 快速切頁少閃爍 | transition視覺延後150ms，立即保護操作；完成即消失 | 51項相關測試、15項Chrome合成檢查；初始fallback與登出不延後 |
| 表單可直接修正 | 出勤／量測／日誌欄位旁提示、首錯焦點、內容保留、IME防誤送 | 21檔282測試；三表單×桌機1440／手機390實際React/CSS與合成API |
| 忙碌時版面穩定 | 等寬footer、不可拖曳文字框、欄位鎖定 | 同上述六組Chrome；未知回覆仍以原內容／原鍵重試 |
| 名冊重讀安全 | 保存／更新鎖下停用refresh，完成才放自己的view鎖 | 35項相關測試；Chrome驗證write/view拒絕、復原、一次refresh、forbidden／unavailable分開 |
| 查詢不無限等待 | core／case／roster／daily各有單次20秒共同預算；取消相依與晚結果 | 獨立覆核7組71測試；原機構／分支／scope／purpose與名字來源不變 |
| 選案狀態不截斷 | 手機補充文字可換行 | 相同HEAD／候選合成收案畫面；390px顯示完整「已保存基本資料 · 待核對5項」、輸入16px/46px、無頁面水平溢位 |

## 證據與檢核

- 換頁：`/tmp/daycare-navigation-browser.W0zmLN/evidence.json`。
- 三張表單：`/Users/seniorlifepr/.codex/verification/daycare-task-first-20260928/daily-forms/after-report.json`，同目錄before/after及欄位錯誤截圖。
- 選案／名冊：`/Users/seniorlifepr/.codex/verification/daycare-smooth-selection-20260928.J31ETc/`；before-mobile、after-mobile、after-desktop、refresh-mobile及verification.json。
- 修改來源strict audit：同目錄`changed-source-audit.json`，0 finding；包含所有實際git tracked修改及untracked新增來源。修正audit工具的relative-config問題，確實採用snapshot中的絕對config，不把未掃到的新增檔案當通過。
- 更廣的既有UI範圍strict audit：`broad-ui-audit.json`仍17 findings，包含其他工作區驗證／textarea及測試fixture，不隱藏或當作整站通過。
- 彙整ESLint零警告、typecheck及production build通過；全套Vitest：584檔通過／1檔skip，10,415測試通過／1項skip。jsdom的Document navigation警告不是hosted瀏覽器驗收。未執行新的正式DB migration或hosted SQL測試。
- DESIGN.md經designmd lint為0 errors、7 orphan-token warnings；既有Model B以globals.css作runtime來源，這些文件token未在frontmatter components內被引用，不將其宣稱為全runtime無差異。

## Design drift核對

| 規則 | 本輪runtime證據 | 判定 |
|---|---|---|
| Finance frame不洗版 | header/sidebar tokens、font及幾何未修改 | 維持；不表示與線上Finance像素逐項驗收 |
| 選案卡18px／108px最小高度 | 只改補充換行，不改card、input高度 | 維持；內容增加可自然長高 |
| 表單同行錯誤／穩定控制 | 新共享validation、scoped footer與resize-none | 三张高頻表單改善；其餘工作區17 findings保留 |
| 不以動畫代替資料 | 新loading只延後視覺；四個loader保留unavailable而非0 | 維持；全Auth／首頁串接期限仍待改善 |

## 發布門檻（未通過）

本輪只讀查證Vercel：連接team為Hobby；project `suiyue-daycare-preview`、東京hnd1，正式版本仍`aa0b64f0f2f9168489f08ba615aa7b6c96ce059d`（deployment `dpl_Cde52jZutniyJHsALsMB8YRNYxRh`）。本輪未push、未deploy、未修改Supabase、未升級或加費用。

[Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines)將Hobby限於非商業個人使用，公司的正式系統須使用合適方案。需要使用者指定已具付費方案的team，或明確同意先確認費用再處理升級；不能繞過方案限制發布。

## 下一輪與仍未完成

1. 真人CEO／主任登入、指派、建檔、保存、讀回與登出；正式RLS、CMS封存、掃毒／下載及Finance來源另外验收。
2. Auth的有界讀取與首頁瀑布等待；目前20秒是各loader預算，不是整頁或全89頁限制，不代表正式p95達標。
3. native未保存確認遷移、其他17項UI findings與完整鍵盤／螢幕閱讀器、Safari／真實中文輸入法。
4. 10位首次使用者任務測試、50人並行、備份還原；以真實結果確認學習成本與速度。
5. 正式量表版本採用／簽署、申報、資料移轉等沿原門檻，不能用本輪外觀與合成測試解除。
