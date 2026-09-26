# 頁28／29未知操作旁的授權資料回查

本機候選，未GitHub push、未Vercel發布、未hosted DDL；不能投入真實個案作業。此切片不解除任何[正式上線門檻](PRODUCTION_GATES.md)，不冒稱全部89頁完成。

## 已修正

- 共用協調器辨識原unknown操作的私有opaque lease。只有自己唯一有效lease能取得暫時read fence；原lease不釋放，其他寫入、refresh與分支切換仍拒絕。偽造、已釋放、foreign lease或舊read callback均不能解除別人的fence。
- 心理社會與社工紀錄各提供手動GET按鈕，不POST、不改原key/body、不用router.refresh。GET成功與原操作保存是不同狀態，成功資料沒有原版本history也不解除待確認標記。
- API先驗目前真員工AAL2、clients.read與social_work_records.read，再驗機構／分支、nonce及精確filters。使用各自原audited loader與social專用recent evidence，回傳目前能力與canonical authority；private/no-store，錯誤無個案內容。
- 嚴格transport檢查actor／範圍／nonce／filters／權限旗標、欄位、來源時間與非展示資料。workspace採用該能力bundle而非舊SSR can*；原簽署MFA條件不變。
- 未掛載、登出、帳號／分支／authority／privacy／filters ABA及遲到結果全部失效。授權／畸形／不可信來源回覆隔離舊資料並提高來源floor，舊props重掛不能復活。只有純網路失敗保留前次授權內容，明示不是最新回查結果。
- 獨立覆核發現頁28原catch只隱藏401／403，會在malformed200／不可信來源／503仍顯示舊資料；RED/GREEN修正為只有純transport失敗例外。錯誤提示也不會在原保存成功或真正新SSR復原後繼續聲稱原操作仍未確認。

兩頁仍共用GovernanceDialog、useUnsavedChanges與既有Finance frame，新增狀態只用inline短提示；未新增modal owner、toast或frame樣式。

## 驗證範圍

各GET實際route與真正parser／client接合的合成transport155项、頁28focused173项、頁29UI46项及私有lease／journal79项曾各自通過。這些有重疊，不相加稱全量結果。API與Auth loader為mock，不是hosted Google／RLS驗收；最終整體程式及Chrome結果另列於[部署恢復紀錄](DEPLOYMENT_RECOVERY_2026-09-26.md)。

凍結後全量Vitest為517檔／7389项、808.87秒、全通過且無略過；maxWorkers=1，未放寬原5秒測試期限，Finance跨repo使用精確候選來源。Chrome重新編譯最終來源的兩頁測試通過，桌機1440×1000及手機390×844無水平溢位、輸入16px且至少44px，無JS錯誤。必填／合成composition不POST；GET403與malformed200跨remount不復活舊資料，新的授權GET不重送write，再手動retry仍完全同key/body；deferredGET後branch ABA的晚回覆無效。

最後全量ESLint零警告、TypeScript、兩頁strict premium零findings、diff-check及隔離production build通過，101個静態輸出完成。build及start清空所有外部設定、關閉demo／Google整合，Chrome登入頁無JS錯誤且Google按鈕停用。真正本機Next HTTP兩個GET皆503／SERVICE_NOT_CONFIGURED、data=null、private/no-store；不是設定好的Supabase下實際401／403、真人Google或RLS證據。所有本輪browser及owned loopback server均已停止。

證據保存於`/Users/seniorlifepr/.codex/verification/daycare-20260926`，此次前綴`social-recovery-`，只有合成資料。最終Chrome重新編譯凍結來源，測試桌機及390px表單、unknown→GET403→remount→新GET→相同key/body人工retry、malformed200隔離及deferredGET後branch ABA。假loopback HTTP不代表真實資料保存、RSC或雲端部署。

## 仍缺的門檻

GET不取得或偽造近期MFA；已變更canonical登入角色／AAL的context不會被GET自行重建。完整重載沒有durable intent、32個待確認標記及有界history仍需精確來源定位，護理未知操作旁的獨立GET尚未補。正式員工／實際Supabase／50人HTTP、官方量表與申報、CMS封存掃毒、Finance真同店、家屬、備份與所有營運門檻仍未通過。SQL本切片未變更，143份migration與最後hosted130份的差異未套用。
