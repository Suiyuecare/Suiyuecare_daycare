# 已保存量表完成檢查：前台候選

未推送GitHub、發布Vercel或升級正式Supabase。只新增九份題目式工具的已保存版本唯讀檢查，不是全部89頁完成或正式營運許可。後端見[查核來源](QUESTIONNAIRE_READINESS_2026-09-27.md)，正式門檻見[部署清單](FORMAL_DEPLOYMENT_CHECKLIST_2026-09-26.md)。

## 現場操作

選個案→填寫並保存草稿→點「檢查已保存評估」。短提示顯示題目完整、未填、需修正或已有較新版本；安全警示保持可見，技術設定預設收起。尚未保存的答案、日期、量測、條件或備註改變時，舊檢查結果立即收起。檢查不保存答案、不正式計分、不簽署、不確認風險、不自動通知或建立照顧決策。

沿用Finance AppShell、runtime字型與色彩，內容卡及控制項採既有10px；個案選擇卡保留18px具名例外。輸入16px、主要控制44px。日期沿用治理頁的YYYY-MM-DD文字輸入，真正日期schema驗證閏日及台北今日；錯誤保留答案且聚焦日期。不新增header／sidebar或第二套token。

## 安全與復原

- 真正context的個案讀取及該表讀取scope才可查；只讀人員不被要求變成管理員或增加AAL2。展示模式不呼叫正式查核。
- 每次手動GET綁機構、分支、登入人、個案、表單、保存版、hash、nonce及畫面來源。瀏覽器以與伺服器相同的純核心重現候選，核對分數、分類、缺答、警示、固定組合及四個正式阻擋原因。不接受偽分數或另一版結果。
- 原九份canonical JSON、27個hash及DB註冊身份不變。瀏覽器不引入Node crypto、server-only、Supabase密鑰、伺服器client或其他網路來源。
- AppShell在其他頁仍觀察權限，登出同步使舊owner失效。401／403、不可信回覆或同generation不同內容隔離整份量表；舊SSR、重新掛載及權限ABA不能復活內容。真正較新且授權的SSR才能重新入場。
- 同量表／同個案的合法SSR更新不重掛編輯器，保留答案及未知原請求，只讓舊查核失效並提示更新。被動切換個案時，原個案仍授權且待保存／回查便維持原owner，不把A答案帶到B；撤銷原個案則立即隱藏。
- 不同量表必須更換該表owner並核對來源，不沿用上一表baseline。畫面先檢查再入場，不先顯示新表＋舊答案。
- 每次查核只持有自己的暫時讀取鎖；dirty、其他操作或unknown鎖下不GET。晚回覆／卸載／舊finally不填回或釋放別人的鎖。成功不解除原寫入未知結果，不把refresh當作更新證明。
- 查核及歷程GET的20秒上限包含JSON解碼；中止不合作仍有獨立期限。失敗不顯示供應商原文，不改既有POST helper或API授權。結果60秒到期要求明確重查，不自動反覆請求。

## 本機證據

證據位於 `/Users/seniorlifepr/.codex/verification/daycare-20260926`。只用明示合成個案、隔離Chrome及Unix socket資料庫，未讀個人Chrome登入、真實個案或雲端密鑰。

- 完整程式541檔／8,440項通過，另1檔／1項原有略過；questionnaire設定範圍24檔／1,018項、原治理設定範圍5檔／177項通過。新增UI＋AppShell整合111項、來源owner18項、有界JSON helper43項均保留對抗斷言。
- 完整portable：135套／6,363斷言、146份migration編譯通過；93套legacy fixture與42套enforced admission分開標示。
- PG17.11原生readiness：146份migration、42／42 pgTAP、九份實際本機授權草稿RPC→Node候選及canonical bytes／hash相等；撤權稽核回滾與同鏈修訂競態通過。完整16套原生gate也通過。全部`signable=false`，沒有正式採用或臨床核准。
- 隔離Chrome：23項情境／斷言通過，含桌機1440、手機390、短viewport、鍵盤disclosure、CSS200%重排、真正forced-colors／reduced-motion、缺答、版本變更、BSRS安全、失敗重試、JSON逾時及撤權遮蔽；檢查全部0POST。CSS200%不是瀏覽器zoom／作業系統人工驗收。
- axe4.12.1：新增區零violation／incomplete；全量表頁零violation，Finance mobile header的裝飾分隔字元一項contrast incomplete待人工確認。不代表完整人工WCAG。
- 預設治理及完整questionnaire兩份strict靜態audit零finding；靜態結果不證明正式CRUD、原生confirm或未知journal已遷移。
- 零警告lint、完整型別檢查、production build及正式相依套件audit通過。正式建置產物只在loopback啟動，未登入查核401、無效查詢400、POST405及量表頁streaming登入導向均實際驗證；量表匿名頁HTTP200只含登入導向、沒有工作區，GET拒絕與頁面均private/no-store。未驗證真人成功流程或hosted環境。

首次完整Vitest因舊測試只mock寫入helper、未提供新GET helper而失敗；保留失敗紀錄，fixture改用真正有界GET helper＋合成fetch後重跑。下一次與設定範圍測試同時執行時，原ABCD一項超過既有5秒；該檔不修改，單獨11項通過，再跑完整8,440項全部通過。保留兩次失敗及最終通過紀錄，不延長期限、不跳過失敗。三個React deferred event.currentTarget錯誤、nested main及放大後內層overflow由實際驗證發現並修正，不是刪除失敗斷言或關掉guard。

## 尚未通過的正式門檻

1. 四項來源原件／真正雙人採用／逐表核簽政策／正式簽署更正交易仍缺。候選完整不是正式完成；MNA-SF非完整MNA，其他專業及ABCD仍需逐表驗收。
2. 原questionnaire仍有native confirm與component-local未知寫入refs，未完全遷移共享dialog／journal。同範圍SSR已保留原筆，完整卸載、跨表／權限改變、整頁重載的定位／復原及獨立receipt查證仍未完善；不能強解unknown鎖換鍵。
3. GET query的個案／版本ID、hash與nonce須實際驗收供應商access-log遮罩，不能用應用稽核替代Vercel／PostgREST／代理證據。
4. 真人資格、hosted migration、部署授權、CMS封存／掃毒、申報實檔、Finance同店金額、備份還原、50人HTTP、安全及人工可用性是獨立正式門檻。題庫公開原始碼授權已確認，不重複索取。

本輪不改臨床政策、Finance帳務口徑或資料區域，不新增費用。
