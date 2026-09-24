# 收案主檔與正式 CMS 匯入：資料庫契約

狀態：本機實作與測試；本文件不代表 hosted migration、正式帳號開通、S3 掃毒或生產匯入已完成。範圍只有版本化主檔與可信來源轉正式資料，不包含到站排程、ABCD 評估、附件內容或正式收案核准。

## RPC 與必要權限

全部 public RPC 使用 SECURITY INVOKER、呼叫 private SECURITY DEFINER；後者固定空 search_path、postgres owner，驗證目前 Auth 使用者、組織、有效分支及個案範圍。表格 private + ENABLE/FORCE RLS，匿名、authenticated、service_role 均無直接 DML。讀取會記錄不含欄位值的稽核；寫入維持既有 immutable AAL2 / 15 分鐘重新驗證證據，不修改登入或角色政策。

| RPC | 參數 | 回應 |
|---|---|---|
| create_intake_client | p_org, p_branch, p_operation UUID, p_profile JSONB | mutation receipt |
| update_intake_profile | 同上加 p_client、p_expected_version、p_expected_client_version | mutation receipt |
| client_intake_snapshot | p_org, p_branch, p_client | snapshot |
| cms_intake_preview | p_org, p_branch, p_batch, p_client nullable | source preview |
| find_cms_intake_source | p_org, p_branch, p_file_sha256 | scoped source receipt or null |
| commit_cms_intake | p_org, p_branch, p_operation, p_batch, p_payload_sha256, p_client nullable, p_expected_version nullable, p_expected_client_version nullable, p_client_code, p_decisions, p_source_review_reason nullable/default null | mutation receipt + formallyImported / batchId |

讀取需 clients.read + clients.demographics.read 與目前指派範圍；沿用現有 executive read 例外供核准帳號唯讀，不擴大原本可見範圍。建立另需 clients.manage + clients.view_all；更新需個案 clients.manage。CMS preview 額外需 imports.manage；commit 額外需 imports.manage + imports.approve。寫入結尾重新確認授權；任何中途錯誤整個 RPC 交易回滾。

`snapshot`：`{ clientId, profileVersion, clientRowVersion, pending, status, profile, fieldAuthority, sourceBatchId }`。舊案尚無 intake version 時 profileVersion=0，以既有目錄欄位提供起始資料，不假造聯絡人、地址或身分證。`pending` 依 admitted_on=null 判定；沿用既有 clients.status enum，不改 enum/既有每日流程。

`mutation receipt`：`{ clientId, profileVersion, clientRowVersion, pending, replayed, operationId }`，不含明文個資。operationId 對應 caller 提供的冪等 UUID；同 actor/key/相同內容回傳原結果，改內容使用同 key 拒絕。正式操作另保存內部 UUID、請求雜湊及 challenge id。

## 主檔資料

`profile`：displayName、clientCode、dateOfBirth、identityNumber、sex、phone、registeredAddress、residentialAddress、cmsLevel、disability、contacts、consent、notes。未知 key 拒絕；物件總長 64KB。名字必填 <=120 字、個案編號必填 <=64 字；其餘一般字串 <=120 字，電話 <=80、地址 <=500、disability <=500、notes <=4000。控制字元拒絕；notes 保留一般換行／tab。

- dateOfBirth：YYYY-MM-DD 或 null，1900-01-01 至台北今日；真實曆日驗證，不接受 2/30。
- identityNumber：nullable，保存前 trim/uppercase，ASCII 字母開頭、總長 8–20 字母或數字。這是格式與遮罩拒絕，不宣稱完成台灣身分證／居留證所有校驗碼驗證。已有精確 identity 不可改掉或清空；若有誤需另行設計雙人 identity 更正，不可用一般主檔更新。
- sex：male / female / other / unknown。
- cmsLevel：整數 1–8 或 null；不把 CMS 等級當成本中心重新評估結果。
- contacts：最多 10 個 `{ name, relationship, phone, address, isPrimary, isEmergency }`；name 必填，最多一位 primary；其餘缺值正規化為 null/false，不推斷誰是緊急聯絡人。
- consent：`{ status: pending|confirmed|declined, confirmedOn: YYYY-MM-DD|null }`；confirmed 必須有非未來日期，其他狀態日期必須 null。這只是收案資料核對狀態，不會取代 public.consents 家屬授權／OTP 證據。

版本寫入 private.client_intake_versions 永不可更新／刪除。identity 雜湊在機構內唯一，建立時鎖定精確 identity，禁止同名模糊合併。主檔敏感值存在未公開 private JSON 欄位；此 migration **不實作應用層欄位加密**，仍需部署時確認託管儲存加密與機構保留政策。索引涵蓋 scoped client/version、source、actor、identity 和 reauth FK。

## CMS 預覽與正式建案

來源只讀既有 private.import_upload_completions，其不可變 parsed_payload 與 private.import_upload_reservations scope FK 已由 server-only worker 完成。API/browser 不能傳 parser payload、archive、任意欄位新值或來源旗標給 commit。原始 HTML 的 WORM 證明仍由原有 server worker / 外部 S3 驗證；SQL 不宣稱能驗證 S3。

預覽回傳：`{ batchId,payloadSha256,mappingVersion,fields,sections,warnings,conflicts,current,imported,importReceipt,sourceReviewRequired,sourceOfficialDate,currentSourceOfficialDate,sourceIsOlder }`。每個 trusted field 附加 `intakeTarget:string|null, intakeValue:JSON|null, intakeWarning:string|null`。完整未知欄位保留，轉換失敗只在該欄顯示 safe code，不讓整個預覽失敗。

重新選取相同 HTML 時，server 先自行計算檔案 SHA-256，再呼叫 `find_cms_intake_source`，不可採信瀏覽器宣稱的雜湊。RPC 僅查當前機構／分支／映射版本，需主檔讀取及 imports.manage；查無回 null，找到回 `{ status: queued|completed, reservationId, payloadSha256, clientId }`，不回傳檔名、來源內容或儲存路徑。完成批次可重用預覽入口，queued 不可誤認成功；已正式匯入的 clientId 僅在呼叫者目前有該案讀取權限時回傳。預覽已匯入來源也會再驗正式個案權限，不因 p_client=null 繞過範圍。

決策：`{ fieldId, target, choice: use_source|keep_current }`。相同 target 多個候選必須明確選其中一個，不以排序／最後一筆覆蓋；所有辨識到的 target 都要有決策。新案 displayName/identityNumber 必須 use_source；可選欄位 keep_current 代表先留白待補。既有案 keep_current 保留當前值。

允許 target：displayName/dateOfBirth/identityNumber/sex/phone/registeredAddress/residentialAddress/cmsLevel/disability，以及 primaryContactName/Relationship/Phone/Address。DB 驗證區段、精確標籤、父層 path 結構與 mappingKey (section + U+001F + label + U+001F + parentPath)。僅接受既有 parser mappingVersion、mapped/conflict；有欄位 warnings 或無法轉換不可直接 use_source。

已含三份使用者樣本的**去識別 selector**：CLIENT_BASIC「個案姓名 傳統姓名」「個案身分證」「個案生日」「個案電話」及戶籍／通訊地址；PRIMARY_CONTACT 姓名、H/O/手機、關係、地址；ICF 障礙程度；CARE_PLAN 的 `CMS等級 ※ 此計畫已計算N次`。測試只用合成值，不把三位個案原始內容納入 repo。

民國兩／三碼年及西元四碼日期經 calendar 驗證後轉西元；男／女等來源轉 sex enum；CMS 第 N 級轉數字。沒有允許的官方量表／醫囑／用藥目標欄位，因此不會建立假簽署或覆蓋服務紀錄。

### 來源主權與版本順序

central 受保護 keys 為 displayName/dateOfBirth/identityNumber/sex/cmsLevel/disability；不得從 local editor 修改。聯絡方式、地址、機構備註仍可補正；CMS 更新不能覆蓋已有非空的機構補充，必須 keep_current。

CMS 更新既有案必須指定個案、當前 profileVersion + clientRowVersion，且來源 identity 精確匹配 private identity。缺 identity 的舊案不能僅憑姓名直接合併；先人工核對補足 identity。每批最多一次正式 promotion，每次保留該批全來源及 decision ids，來源 staged receipt 的 staging_only 歷史不改，正式 imported 狀態由新 operation receipt 表示。

所有既有案 CMS 更新必填 10–1000 字 p_source_review_reason，明確記錄人工核對來源先後，不依上傳時間認定為新版本。若可信 CARE_PLAN 核定日期／核定日／計畫生效日期可辨識且早於目前來源，一律拒絕；缺值、格式未知、多日期衝突維持 unknown 並要求人工覆核。這不是完整官方版本序列 API；部署前業務仍需確認來源日期欄位適用性。

舊 public.update_local_client 對已有 intake version 的個案回 INTAKE_USE_PROFILE_WORKFLOW，以防繞過 profile history；無 intake 的舊案保留原有行為。新流程不建立 admission transition、不排定正式醫囑、不改寫 signed records。正式收案仍走既有 lifecycle 核准。

## 驗證與上線邊界

本機 SQL 以真實 executive Google session + consumed MFA fixture 驗證（合成資料、無 auth predicate 替換），新 suite 94 assertions 通過。主檔測試涵蓋匿名/AAL1/跨分支/無 demographics/未知 keys/日期、冪等、精確 identity、append-only、回滾、來源偽造、ROC、欄位決策、同名不同人、舊版官方日期阻擋、legacy editor 旁路、相同檔案的受限來源收據查詢及讀回正規化。既有 master 48 / directory 21 / staging 74 suites 同時回歸，共 237 assertions 通過；其中兩個舊 master suites 使用原有 PGlite-only legacy admission fixture，新 intake 與 staging 使用真實 admission gate。

PGlite 是相容性檢查，不等於 hosted PostgreSQL 交易／並行、S3 Object Lock、真掃毒、手機操作或正式個案驗收。本子任務未執行 hosted DDL 或正式個案寫入。發布需先 migration dry run、真 PostgreSQL/ACL advisor、確認舊UI導向新版個案編輯，再做授權瀏覽器完整收案測試。

## 預計到站與接送需求前台投影

獨立 `DailyExpectedClients` Server Component 只讀 `public.client_weekly_projection`，並向既有授權 client master 查名字；查名失敗只顯示 opaque ID 末四碼，不查其他來源擴權。只有 status=scheduled 納入預計人數，取消、未收案、停用、過期不算；失敗／無權限／demo 不顯示假零。

送入 Client Component 的欄位限個案 ID、授權姓名、到離站時間及去回程需求 boolean。地址、電話、輪椅資訊、原始週表不序列化到此面板。畫面清楚區分預計名冊與實際出勤；需求未與已發布派車資料對帳，因此用「派車待核對」，不宣稱一定尚未派車。不會寫 attendance_records 或 transport_trip_plans。

功能包含每次十人漸進展開、台北資料時間、60 秒過期提示、離線提示與 server refresh；收案詳情／派車入口依角色權限分開。純投影、loader、畫面共 18 個 Vitest tests 通過，包含新快照會解除舊過期提示；另需整合頁面後的真實瀏覽器響應式驗證，不能以元件單元測試取代。
