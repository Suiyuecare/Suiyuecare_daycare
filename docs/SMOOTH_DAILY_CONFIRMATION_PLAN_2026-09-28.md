# 日常照顧：連續填寫與確認改善

## 本輪範圍與設計

沿用 Finance 外框、字型、顏色及控制項尺寸；不改登入、角色、臨床公式、資料庫與正式上線門檻。改善出勤、生命徵象、照顧日誌的未保存離開，以及日誌草稿提交／簽署／更正確認。裝置草稿刪除與其他舊頁的 native confirm 不在這個切片，不能宣稱全站完成。

權威來源：`core-care/write-attempt.ts`、`write-receipts.ts`、`attendance-client.ts`、`care-diary/schema.ts`、原 API 與 `UX-CONTRACT.md`。未知送出固定原內容與原鍵，只能明確重試；修改介面不能取消已提交操作或增加授權。

| 行為 | 唯一 owner | 本輪用途 |
|---|---|---|
| 未保存離開 | `navigation/use-unsaved-changes.ts`／`unsaved-changes.ts` | 三張新增表單及日誌草稿編輯 |
| 模態確認 | `ui/governance-dialog.tsx` | 繼續填寫／明確捨棄，以及日誌狀態確認 |
| 欄位錯誤 | `core-care/daily-form-validation.tsx`／既有 schema | inline 提示、首錯焦點、IME 保護 |
| 未知重試 | `use-care-write-attempt.ts`／原回條契約 | 不換鍵、不改內容、不重建原操作 |
| 樣式／捲動 | `globals.css`／既有 daily module | 16px 欄位、44px 主要操作、自然高度 |

原生 select／datetime-local 保持具名平台例外。一般文字與內容只留既有記憶體／已治理裝置草稿；不新增 storage、history 或額外個資快取。確認視窗與編輯視窗不得同時開啟，取消回到原輸入。安全登出優先，不要求捨棄確認。

## 驗收

1. 取消、Escape、模態外點擊均保留未送出的輸入；只有明確「捨棄」才離開。恢復編輯不能重設個案、日期、班別、欄位或操作鍵。
2. 同頁連結、GET 篩選、重新整理沿用共享 guard；不重播 POST、不把 POST 轉 GET。目的地、來源或可用權限改變後舊確認失效。
3. 一次只能有一個 top-layer modal；初始焦點是較安全動作，取消恢復原輸入／觸發器，捨棄後回存活的控制／具名區段。
4. 送出中不重複發送；結果不明不能被捨棄或新建。關閉原操作視窗不等於取消，重新開啟／重試維持原 body、key、個案與版次。
5. 日誌提交／簽署／更正確認必須顯示對象、版本、實際後果；取消不呼叫 API。等待期間維持視窗與安全鎖，錯誤可回查，不假稱完成。
6. 日誌編輯的 noValidate、inline 錯誤、首錯焦點、中文組字保護與既有 schema 一致；不把草稿或提交計為正式簽署。
7. desktop 1440px 與 mobile 390px 使用同一合成個案做 before／after；檢查焦點、16px／44px、溢位、取消、捨棄、unknown、重送與原個案／日期／班別連結。
8. relevant 與全套本機測試、lint、typecheck、production build、實際改動來源的嚴格 UI audit。另列全站既有問題，不用 scoped audit 宣稱全站通過。

## 發布邊界

本機與合成瀏覽器驗證不代表正式 Google 登入、資料保存、正式簽署、89 頁全功能、50 人並行或真人初次使用驗收。發布需有效部署權限與符合商業用途的已核准方案；不自行升級扣款、不解除封存／掃毒等安全門檻。
