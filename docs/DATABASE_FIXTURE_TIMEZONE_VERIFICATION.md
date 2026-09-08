# 資料庫測試 fixture 時區驗證

日期：2026-09-08（Asia/Taipei）。範圍：**僅測試 fixture 與本機 PGlite 相容性檢查**；沒有修改 production migration、RPC、RLS、權限、計算公式或業務門檻。

## 問題與判定

PGlite 測試 session 預設可能使用 UTC，而正式資料庫函式會把事件時間明確換算為 `Asia/Taipei` 的業務日期。在台北時間 00:00–07:59 執行時，測試 fixture 的 `current_date` 仍可能是 UTC 的前一日；若同一測試又以 `clock_timestamp()`、`now() - interval ...` 或 production 的台北日期規則建立／查詢資料，便會把同一事件誤分到不同日期。

本次失敗都可由此邊界重現，且 production guard 本身依台北日期運作正確。因此修正策略是讓 fixture 使用其所驗證的業務日期，沒有放寬 future-date、服務期間、評估版本、每日彙整、帳務對帳或用藥簽署規則。

沒有在共用 runner 全域設定時區。逐檔設定可保留偵測 production SQL 誤用資料庫 session `current_date` 的能力；只有明確以台灣業務日為前提的 fixture 使用 `set local time zone 'Asia/Taipei'`。

## 精確變更清單

下列 12 個 pgTAP 檔案只在交易內加入 `set local time zone 'Asia/Taipei'`，讓 `current_date` fixture 與其 production 台北日期 guard 對齊：

- `supabase/tests/adaptation_assessment_page32.test.sql`
- `supabase/tests/billing_management_page64.test.sql`
- `supabase/tests/chewing_assessment_page35.test.sql`
- `supabase/tests/fall_event_workflow_page24.test.sql`
- `supabase/tests/fall_risk_assessment_page13.test.sql`
- `supabase/tests/gds_assessment_page12.test.sql`
- `supabase/tests/nsi_nutrition_screening_page14.test.sql`
- `supabase/tests/occupational_therapy_assessment_page33.test.sql`
- `supabase/tests/physical_therapy_assessment_page34.test.sql`
- `supabase/tests/physical_therapy_services_page40.test.sql`
- `supabase/tests/psychosocial_assessment_page28.test.sql`
- `supabase/tests/spmsq_assessment_page11.test.sql`

另有 3 個 fixture 需要依實際事件時間選擇業務日期，不能以固定 session 日期代替：

- `supabase/tests/complete_service_event.test.sql`：每日服務彙整的查詢日改由已保存 `service_events.started_at` 換算台北日期；若 `now() - 2 hours` 已跨越台北午夜，仍查到該筆服務所屬的正確日期。
- `supabase/tests/insulin_administrations_page5.test.sql`：同一快照內的預期筆數與劑量集合，依 `late_time` 與 `on_time` 是否落在同一台北日期決定；不再假設相差兩小時必定同日。
- `supabase/tests/medication_administration_workflow_test.sql`：高風險待覆核與逾時補登的每日快照查詢日，分別由其 `now() - 25 minutes` 與 `now() - 2 hours` 排程時間換算台北日期。

## 驗證結果

- Migration compile：85／85 通過。
- Page52 簽署時序修正與核定來源寫入邊界交接後的最終完整資料庫回歸：84 個檔案、3,445 項 assertions 全部通過；包含 `client_service_plan_workflow_page52.test.sql` 50／50、`authorized_care_plan_write_boundary.test.sql` 12／12 與 `core_care_plans.test.sql` 41／41。
- `foundation_schema.test.sql`：24／24 通過。
- Page34／40／41 相鄰驗證：167／167 通過，其中 Page40 為 54／54。
- Page11／12／13／14／28 評估群組：256／256 通過。
- Page23／24／25 品質事件群組：166／166 通過。
- Page5 胰島素：46／46 通過；用藥執行／計畫：125／125 通過。
- `complete_service_event.test.sql` 與 Page54 每日彙整：70／70 通過。
- Page63／64／65 相鄰驗證：104／104 通過。

這一輪本機 PGlite 資料庫 gate 已關閉。仍未宣稱正式 Supabase PostgreSQL、Supabase lint 或獨立連線競態驗收；上述項目須在正式環境另行執行。
