/**
 * Public source inventory only. Not consumed by claims, scoring, authorization,
 * or publication engines. Dates describe the source, not institutional approval.
 */
type PilotSource = {
  readonly id: string;
  readonly title: string;
  readonly authority: string;
  readonly jurisdiction: "臺北市" | "全國";
  readonly purpose: "directory" | "contract_reference" | "accreditation" | "api_reference" | "verification_intake" | "benefit_reporting" | "proposed_accreditation";
  readonly sourceUrl: string;
  readonly documentUrl?: string;
  readonly version: string;
  readonly dates: readonly { readonly label: string; readonly value: string }[];
  readonly caution: string;
  readonly reviewStatus: "unapproved";
  readonly enabled: false;
  readonly approvedBy: null;
  readonly approvedAt: null;
  readonly legalEffectiveDate: null;
  readonly institutionApplicability: "pending_document_verification";
  readonly retrievedOn: "2026-09-08";
};

const unapproved = {
  reviewStatus: "unapproved",
  enabled: false,
  approvedBy: null,
  approvedAt: null,
  legalEffectiveDate: null,
  institutionApplicability: "pending_document_verification",
  retrievedOn: "2026-09-08",
} as const;

export const pilotSources = [
  {
    ...unapproved,
    id: "taipei-daycare-directory-11508",
    title: "115 年 8 月社區式長照機構一覽表",
    authority: "臺北市政府社會局",
    jurisdiction: "臺北市",
    purpose: "directory",
    sourceUrl: "https://dosw.gov.taipei/cp.aspx?n=3E3C1D86A51BF473&s=B72AFFE457F98DE1",
    documentUrl: "https://www-ws.gov.taipei/001/Upload/358/relfile/16495/115913/e56f2871-89f3-413c-b1fc-492e11845ed0.pdf",
    version: "1150818 更新／PDF 115 年 8 月",
    dates: [{ label: "頁面更新（台北時間）", value: "2026-08-18 13:55" }],
    caution: "第 3 頁有機構全名精確匹配；列序不是機構代碼。名冊所列特約狀態不代替有效契約或正式帳號綁定。",
  },
  {
    ...unapproved,
    id: "taipei-daycare-contract-reference-1130510",
    title: "臺北市政府特約長期照顧服務契約書（空白範本）",
    authority: "臺北市政府社會局",
    jurisdiction: "臺北市",
    purpose: "contract_reference",
    sourceUrl: "https://dosw.gov.taipei/News_Content.aspx?n=5EF22734BA80A829&s=30C6B4E24B31CD4D&sms=96505C2A85F034FD",
    documentUrl: "https://www-ws.gov.taipei/001/Upload/358/relfile/40426/8366744/e48ae2ce-8cfc-43cf-b3cb-54aaf27b59a0.odt",
    version: "檔名版次 1130510",
    dates: [
      { label: "檔名日期", value: "2024-05-10" },
      { label: "頁面更新（台北時間）", value: "2026-08-18 13:52" },
    ],
    caution: "契約起訖空白，不是本機構 115 年有效契約；未取得現用批次申報模板及成功／退補件回覆樣本。",
  },
  {
    ...unapproved,
    id: "taipei-statutory-accreditation-procedure-115",
    title: "115 年臺北市長照機構法定評鑑作業程序",
    authority: "臺北市政府社會局",
    jurisdiction: "臺北市",
    purpose: "accreditation",
    sourceUrl: "https://dosw.gov.taipei/News_Content.aspx?n=5EF22734BA80A829&s=D220B496F1CA1609&sms=96505C2A85F034FD",
    documentUrl: "https://www-ws.gov.taipei/001/Upload/358/relfile/40426/7982072/5ec84530-282c-4933-89f2-cdb6b845f677.pdf",
    version: "115 年／北市社老字第1143201169號",
    dates: [
      { label: "公告發文日", value: "2025-12-18" },
      { label: "實施期程（月精度）", value: "2026-01 至 2026-12" },
      { label: "頁面更新（台北時間）", value: "2026-06-10 16:19" },
    ],
    caution: "尚未核對設立許可、上次評鑑效期及實際受評通知。名稱近似的居家機構不可匹配為萬華社區日照機構。",
  },
  {
    ...unapproved,
    id: "taipei-daycare-statutory-accreditation-115",
    title: "115 年法定評鑑基準：附件 2-4 日間照顧機構",
    authority: "臺北市政府社會局",
    jurisdiction: "臺北市",
    purpose: "accreditation",
    sourceUrl: "https://dosw.gov.taipei/News_Content.aspx?n=5EF22734BA80A829&s=1D39FA6010C02BEC&sms=96505C2A85F034FD",
    documentUrl: "https://www-ws.gov.taipei/001/Upload/358/relfile/40426/7963218/818225cd-7a4d-4572-ba45-370ef9dcd75e.pdf",
    version: "115 年／附件 2-4／18 頁",
    dates: [{ label: "頁面更新（台北時間）", value: "2026-06-10 16:19" }],
    caution: "第 18 頁列 43 個基本項目、另 2 加分題；不是 45 個一般必填指標。取得文件不代表完成逐題公式、不適用規則及雙人發布。",
  },
  {
    ...unapproved,
    id: "taipei-accreditation-proposed-116",
    title: "116 年評鑑基準預告修正（非 115 年執行版本）",
    authority: "臺北市政府社會局",
    jurisdiction: "臺北市",
    purpose: "proposed_accreditation",
    sourceUrl: "https://dosw.gov.taipei/News_Content.aspx?n=5EF22734BA80A829&s=1D39FA6010C02BEC&sms=96505C2A85F034FD",
    version: "附件 3／116 年預告修正",
    dates: [{ label: "頁面更新（台北時間）", value: "2026-06-10 16:19" }],
    caution: "只登錄預告存在；未逐題審查，不可提前套用或覆寫 115 年日照規則。",
  },
  {
    ...unapproved,
    id: "mohw-claims-api-reference-2_2_1",
    title: "支付審核系統 API 規格說明書（公開技術參考）",
    authority: "衛生福利部",
    jurisdiction: "全國",
    purpose: "api_reference",
    sourceUrl: "https://1966.gov.tw/ltc/cp-6443-75040-207.html",
    documentUrl: "https://www.mohw.gov.tw/dl-89174-b3a9a347-af95-4d8f-9544-dd5fd52d8a05.html",
    version: "2.2.1／40 頁 PDF",
    dates: [
      { label: "文件修訂日", value: "2024-05-09" },
      { label: "附件上架日期標籤", value: "2025-06-25" },
      { label: "公告頁更新", value: "2025-12-31" },
    ],
    caution: "已找到公開規格，但尚未確認 115 年現行適用版本、驗證受理、測試授權及本系統核准；不會因此啟用 API 或官方匯出。",
  },
  {
    ...unapproved,
    id: "mohw-claims-verification-114",
    title: "114 年自建資訊系統支付審核介接驗證公告（已截止）",
    authority: "衛生福利部",
    jurisdiction: "全國",
    purpose: "verification_intake",
    sourceUrl: "https://1966.gov.tw/ltc/cp-6443-75040-207.html",
    version: "114 年驗證受理公告",
    dates: [
      { label: "該年度申請截止", value: "2025-07-25" },
      { label: "該年度自評截止", value: "2025-10-31" },
      { label: "公告頁更新", value: "2025-12-31" },
    ],
    caution: "不能沿用已截止受理時程。測試通訊授權碼、帳號與測試資料須經初審；公開公告不代表本系統通過驗證。",
  },
  {
    ...unapproved,
    id: "taipei-daycare-meeting-1150617",
    title: "115 年第 1 次臺北市日照及小規模多機能業務聯繫會議",
    authority: "臺北市政府社會局",
    jurisdiction: "臺北市",
    purpose: "benefit_reporting",
    sourceUrl: "https://dosw.gov.taipei/News_Content.aspx?n=5EF22734BA80A829&s=C5B92B18AD9281BF&sms=96505C2A85F034FD",
    version: "1150617 會議紀錄",
    dates: [
      { label: "會議日期", value: "2026-06-17" },
      { label: "頁面更新（台北時間）", value: "2026-08-18 13:52" },
    ],
    caution: "效益表、通知承辦與核銷抽案是個別流程；不得將效益表期限當作服務費申報送件期限，也不得混用設置獎助規則。",
  },
] as const satisfies readonly PilotSource[];
