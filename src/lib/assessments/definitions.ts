import type {
  AssessmentAlert,
  AssessmentClassification,
  AssessmentContextDefinition,
  AssessmentInstrument,
  AssessmentItemDefinition,
  AssessmentRuleSnapshot,
  AssessmentVersionId,
} from "./types";
import { GDS_QUESTIONS } from "@/lib/gds-assessments/types";

export interface AssessmentDefinition extends AssessmentRuleSnapshot {
  readonly items: readonly AssessmentItemDefinition[];
  readonly context: readonly AssessmentContextDefinition[];
  readonly scoreMin: number;
  readonly scoreMax: number;
  readonly scoreUnit: "points" | "errors";
  readonly classify: (score: number) => AssessmentClassification;
  readonly adjustScore: (
    rawScore: number,
    context: Readonly<Record<string, string>>,
  ) => number;
  readonly buildAlerts: (
    score: number,
    classification: AssessmentClassification,
  ) => readonly AssessmentAlert[];
}

const answer = (value: string, points: number) => ({ value, points }) as const;

const requiredItem = (
  id: string,
  label: string,
  choices: readonly ReturnType<typeof answer>[],
): AssessmentItemDefinition => ({
  id,
  label,
  required: true,
  allowNotApplicable: false,
  choices,
});

const band = (
  key: string,
  label: string,
  minInclusive: number,
  maxInclusive: number,
  interpretation: AssessmentClassification["interpretation"],
): AssessmentClassification => ({
  key,
  label,
  minInclusive,
  maxInclusive,
  interpretation,
});

function findBand(
  bands: readonly AssessmentClassification[],
  score: number,
): AssessmentClassification {
  const found = bands.find(
    (candidate) =>
      score >= candidate.minInclusive && score <= candidate.maxInclusive,
  );
  if (!found) {
    throw new Error(`No classification band for score ${score}`);
  }
  return found;
}

const noAdjustment = (rawScore: number) => rawScore;
const noAlerts = () => [] as const;

const spmsqBands = [
  band("reference_0_2_errors", "0–2 個錯誤參考區間", 0, 2, "screening_only"),
  band("mild_3_4_errors", "3–4 個錯誤篩檢區間", 3, 4, "screening_only"),
  band(
    "moderate_5_7_errors",
    "5–7 個錯誤篩檢區間",
    5,
    7,
    "screening_only",
  ),
  band("high_8_10_errors", "8–10 個錯誤篩檢區間", 8, 10, "screening_only"),
] as const;

const gdsBands = [
  band("reference_0_4", "0–4 分參考區間", 0, 4, "screening_only"),
  band("elevated_5_8", "5–8 分篩檢區間", 5, 8, "screening_only"),
  band("high_9_11", "9–11 分篩檢區間", 9, 11, "screening_only"),
  band("very_high_12_15", "12–15 分篩檢區間", 12, 15, "screening_only"),
] as const;

const barthelBands = [
  band("total_dependency_0_20", "完全依賴功能區間", 0, 20, "functional_description"),
  band("severe_dependency_21_60", "嚴重依賴功能區間", 21, 60, "functional_description"),
  band("moderate_dependency_61_90", "中度依賴功能區間", 61, 90, "functional_description"),
  band("slight_dependency_91_99", "輕度依賴功能區間", 91, 99, "functional_description"),
  band("independent_100", "100 分功能區間", 100, 100, "functional_description"),
] as const;

const iadlBands = [
  band("low_function_0", "0 分功能區間", 0, 0, "functional_description"),
  band(
    "support_in_one_or_more_domains_1_7",
    "1–7 分功能區間",
    1,
    7,
    "functional_description",
  ),
  band("high_function_8", "8 分功能區間", 8, 8, "functional_description"),
] as const;

const mnaBands = [
  band("malnourished_screen_0_7", "MNA-SF 0–7 分篩檢區間", 0, 7, "screening_only"),
  band("at_risk_screen_8_11", "MNA-SF 8–11 分篩檢區間", 8, 11, "screening_only"),
  band("normal_screen_12_14", "MNA-SF 12–14 分篩檢區間", 12, 14, "screening_only"),
] as const;

const spmsqItems = Array.from({ length: 10 }, (_, index) =>
  requiredItem(`spmsq_${String(index + 1).padStart(2, "0")}`, `SPMSQ 原量表第 ${index + 1} 題`, [
    answer("correct", 0),
    answer("incorrect", 1),
  ]),
);

const gdsScoredYes = new Set([2, 3, 4, 6, 8, 9, 10, 12, 14, 15]);
const gdsItems = GDS_QUESTIONS.map((question, index) => {
  const itemNumber = index + 1;
  const yesPoints = gdsScoredYes.has(itemNumber) ? 1 : 0;
  return requiredItem(
    `gds_${String(itemNumber).padStart(2, "0")}`,
    question,
    [answer("yes", yesPoints), answer("no", 1 - yesPoints)],
  );
});

const barthelItems = [
  requiredItem("feeding", "進食", [
    answer("unable", 0),
    answer("needs_help", 5),
    answer("independent", 10),
  ]),
  requiredItem("bathing", "洗澡", [
    answer("dependent", 0),
    answer("independent", 5),
  ]),
  requiredItem("grooming", "個人衛生", [
    answer("dependent", 0),
    answer("independent", 5),
  ]),
  requiredItem("dressing", "穿脫衣物", [
    answer("unable", 0),
    answer("needs_help", 5),
    answer("independent", 10),
  ]),
  requiredItem("bowels", "排便控制", [
    answer("incontinent", 0),
    answer("occasional_accident", 5),
    answer("continent", 10),
  ]),
  requiredItem("bladder", "排尿控制", [
    answer("incontinent", 0),
    answer("occasional_accident", 5),
    answer("continent", 10),
  ]),
  requiredItem("toilet_use", "如廁", [
    answer("dependent", 0),
    answer("needs_help", 5),
    answer("independent", 10),
  ]),
  requiredItem("transfers", "移位", [
    answer("unable", 0),
    answer("major_help", 5),
    answer("minor_help", 10),
    answer("independent", 15),
  ]),
  requiredItem("mobility", "平地行動", [
    answer("immobile", 0),
    answer("wheelchair_independent", 5),
    answer("walks_with_help", 10),
    answer("independent", 15),
  ]),
  requiredItem("stairs", "上下樓梯", [
    answer("unable", 0),
    answer("needs_help", 5),
    answer("independent", 10),
  ]),
] as const;

const iadlItems = [
  requiredItem("telephone", "使用電話", [
    answer("telephone_dials_numbers", 1), answer("telephone_familiar_numbers", 1),
    answer("telephone_answer_only", 0), answer("telephone_unable", 0),
  ]),
  requiredItem("shopping", "上街購物", [
    answer("shopping_independent_all", 1), answer("shopping_small_items_only", 0),
    answer("shopping_accompanied", 0), answer("shopping_unable", 0),
  ]),
  requiredItem("food_preparation", "做飯", [
    answer("meal_independent", 1), answer("meal_prepared_ingredients", 0),
    answer("meal_reheat_or_inadequate", 0), answer("meal_needs_prepared", 0),
  ]),
  requiredItem("housekeeping", "做家事", [
    answer("housework_independent", 1), answer("housework_light_tasks", 0),
    answer("housework_below_standard", 0), answer("housework_all_help", 0),
    answer("housework_unable", 0),
  ]),
  requiredItem("laundry", "洗衣", [
    answer("laundry_all", 1), answer("laundry_small_items", 0),
    answer("laundry_needs_help", 0),
  ]),
  requiredItem("transportation", "使用交通工具", [
    answer("transport_public_or_drive", 1), answer("transport_taxi_only", 1),
    answer("transport_with_companion", 0), answer("transport_private_with_help", 0),
    answer("transport_unable_to_leave", 0),
  ]),
  requiredItem("medications", "自己負責用藥", [
    answer("medication_independent", 1), answer("medication_prepared", 0),
    answer("medication_needs_help", 0),
  ]),
  requiredItem("finances", "財務管理", [
    answer("finances_independent", 1), answer("finances_daily_only", 0),
    answer("finances_unable", 0),
  ]),
] as const;

const mnaItems = [
  requiredItem("food_intake", "近三個月食物攝取變化", [
    answer("severe_decrease", 0),
    answer("moderate_decrease", 1),
    answer("no_decrease", 2),
  ]),
  requiredItem("weight_loss", "近三個月體重變化", [
    answer("greater_than_3kg", 0),
    answer("unknown", 1),
    answer("between_1_and_3kg", 2),
    answer("no_weight_loss", 3),
  ]),
  requiredItem("mobility", "行動能力", [
    answer("bed_or_chair_bound", 0),
    answer("gets_up_but_does_not_go_out", 1),
    answer("goes_out", 2),
  ]),
  requiredItem("acute_stress_or_disease", "近三個月心理壓力或急性疾病", [
    answer("yes", 0),
    answer("no", 2),
  ]),
  requiredItem("neuropsychological", "神經心理問題選項", [
    answer("severe", 0),
    answer("mild", 1),
    answer("none", 2),
  ]),
  requiredItem("anthropometry", "BMI；無法取得 BMI 時以小腿圍替代", [
    answer("bmi_lt_19", 0),
    answer("bmi_19_lt_21", 1),
    answer("bmi_21_lt_23", 2),
    answer("bmi_gte_23", 3),
    answer("calf_lt_31", 0),
    answer("calf_gte_31", 3),
  ]),
] as const;

const yesNoItems = (prefix: string, count: number, labels: readonly string[], weights?: readonly number[]) =>
  Array.from({ length: count }, (_, index) => requiredItem(
    `${prefix}_${String(index + 1).padStart(2, "0")}`,
    labels[index] ?? `${prefix} 第 ${index + 1} 題`,
    [answer("yes", weights?.[index] ?? 1), answer("no", 0)],
  ));

const fallRiskItems = yesNoItems("fall", 12, [
  "年齡大於 65 歲", "最近三個月曾跌倒", "步態或平衡曾失調", "肢體功能障礙",
  "認知障礙", "下肢無力或殘障", "頭暈或暈眩", "視力模糊", "睡眠障礙",
  "診斷腦中風", "服用可能影響意識活動之藥物", "患有可能影響跌倒之疾病",
]);

const nsiItems = yesNoItems("nsi", 10, [
  "疾病或狀況改變飲食種類或份量", "每天少於兩餐", "少吃水果蔬菜或乳製品",
  "幾乎每天喝三杯或更多酒類", "牙齒或口腔問題影響進食", "沒有足夠錢購買所需食物",
  "大部分時間獨自吃飯", "每天服用三種或更多藥物", "六個月內非刻意增減約 10 磅",
  "身體上無法總是自行購物烹調或進食",
], [2, 3, 2, 2, 2, 4, 1, 1, 2, 2]);

const eat10Items = Array.from({ length: 10 }, (_, index) => requiredItem(
  `eat10_${String(index + 1).padStart(2, "0")}`,
  `EAT-10 第 ${index + 1} 題`,
  [0, 1, 2, 3, 4].map((points) => answer(String(points), points)),
));

const allBsrsItems = [
  ...Array.from({ length: 5 }, (_, index) => requiredItem(
    `bsrs_${String(index + 1).padStart(2, "0")}`,
    `BSRS-5 第 ${index + 1} 題`,
    [0, 1, 2, 3, 4].map((points) => answer(String(points), points)),
  )),
  requiredItem("bsrs_suicide", "自殺想法（額外安全題，不列入前五題總分）",
    ["0", "1", "2", "3", "4"].map((value) => answer(value, 0))),
] as const;

const fallRiskBands = [
  band("below_high_risk_threshold_0_2", "0–2 項・未達臺北市表單高風險門檻", 0, 2, "screening_only"),
  band("high_risk_threshold_3_12", "3 項以上・臺北市表單列為高風險群", 3, 12, "screening_only"),
] as const;

const nsiBands = [
  band("low_0_2", "0–2 分・低風險參考區間", 0, 2, "screening_only"),
  band("moderate_3_5", "3–5 分・中度營養風險", 3, 5, "screening_only"),
  band("high_6_21", "6 分以上・高營養風險", 6, 21, "screening_only"),
] as const;

const eat10Bands = [
  band("below_screening_threshold_0_2", "0–2 分・未達篩檢參考門檻", 0, 2, "screening_only"),
  band("possible_swallowing_problem_3_40", "3 分以上・可能有吞嚥問題", 3, 40, "screening_only"),
] as const;

const bsrsBands = [
  band("adaptation_0_5", "0–5 分・身心適應狀況良好", 0, 5, "screening_only"),
  band("mild_6_9", "6–9 分・輕度情緒困擾", 6, 9, "screening_only"),
  band("moderate_10_15", "10–15 分・中度情緒困擾", 10, 15, "screening_only"),
  band("high_16_20", "16–20 分・重度情緒困擾參考區間", 16, 20, "screening_only"),
] as const;

const commonDisclaimer =
  "本結果只重現指定版本的量表計分，不構成診斷、醫囑或自動處置；應由具權限人員結合完整資料判讀。";

const definitions = [
  {
    versionId: "spmsq-pfeiffer-10-education-adjusted-v1",
    instrument: "spmsq",
    title: "SPMSQ 10 題教育程度調整版",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy:
      "10 題以錯誤數計分；低教育程度將調整後錯誤數減 1，高於高中將增加 1，結果限制於 0–10。任何缺值或 N/A 均不推估。",
    disclaimer: commonDisclaimer,
    sources: [
      {
        label: "Pfeiffer 1975 original SPMSQ record (PubMed PMID 1159263)",
        url: "https://pubmed.ncbi.nlm.nih.gov/1159263/",
      },
    ],
    items: spmsqItems,
    context: [
      {
        id: "education_adjustment",
        label: "教育程度調整",
        required: true,
        choices: [
          "grade_school_or_less",
          "middle_or_high_school",
          "beyond_high_school",
        ],
      },
    ],
    scoreMin: 0,
    scoreMax: 10,
    scoreUnit: "errors",
    classify: (score: number) => findBand(spmsqBands, score),
    adjustScore: (rawScore: number, context: Readonly<Record<string, string>>) => {
      const education = context.education_adjustment;
      if (education === "grade_school_or_less") return Math.max(0, rawScore - 1);
      if (education === "beyond_high_school") return Math.min(10, rawScore + 1);
      return rawScore;
    },
    buildAlerts: (score: number) =>
      score >= 3
        ? [
            {
              code: "SPMSQ_PROFESSIONAL_REVIEW",
              level: "warning",
              message: "分數位於需由專業人員結合教育、文化、感官及臨床資料判讀的篩檢區間。",
            },
          ]
        : [],
  },
  {
    versionId: "gds-15-strict-complete-v1",
    instrument: "gds_15",
    title: "GDS-15 嚴格完整作答版",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy:
      "依 15 題正反向鍵計 0 或 1 分，總分 0–15。本版本不使用缺題比例推估，任何缺值或 N/A 均不產生總分。",
    disclaimer: commonDisclaimer,
    sources: [
      {
        label: "Stanford/VA Geriatric Depression Scale forms and scoring",
        url: "https://web.stanford.edu/~yesavage/GDS.html",
      },
    ],
    items: gdsItems,
    context: [],
    scoreMin: 0,
    scoreMax: 15,
    scoreUnit: "points",
    classify: (score: number) => findBand(gdsBands, score),
    adjustScore: noAdjustment,
    buildAlerts: (score: number) =>
      score >= 5
        ? [
            {
              code: "GDS_PROFESSIONAL_REVIEW",
              level: "warning",
              message: "篩檢分數達進一步專業評估區間；系統不自動判定診斷或處置。",
            },
          ]
        : [],
  },
  {
    versionId: "barthel-adl-0-100-v1",
    instrument: "barthel_adl",
    title: "Barthel ADL 0–100 分版",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy:
      "10 個 ADL 領域依固定選項加總為 0–100；任何缺值或 N/A 均不產生總分。商業上線前須確認正式授權與採用版本。",
    disclaimer: commonDisclaimer,
    sources: [
      {
        label: "Shirley Ryan AbilityLab Rehabilitation Measures Database — Barthel Index",
        url: "https://www.sralab.org/rehabilitation-measures/barthel-index",
      },
      {
        label: "NCBI Bookshelf — Common Measures of Disability",
        url: "https://www.ncbi.nlm.nih.gov/books/NBK613292/",
      },
    ],
    items: barthelItems,
    context: [],
    scoreMin: 0,
    scoreMax: 100,
    scoreUnit: "points",
    classify: (score: number) => findBand(barthelBands, score),
    adjustScore: noAdjustment,
    buildAlerts: noAlerts,
  },
  {
    versionId: "lawton-iadl-8-domain-expanded-v1",
    instrument: "lawton_iadl",
    title: "Lawton-Brody IADL 八領域二元計分版",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy:
      "八個領域各以依賴 0 分、獨立 1 分計算，總分 0–8；所有人一律評估八領域，不依性別排除題目，任何缺值或 N/A 均不產生總分。",
    disclaimer: commonDisclaimer,
    sources: [
      {
        label: "AHRQ/NCBI evidence update — Lawton IADL 0–8 summary",
        url: "https://www.ncbi.nlm.nih.gov/books/NBK554651/table/appa.tab12/",
      },
      {
        label: "Graf 2008 Lawton IADL review (PubMed PMID 18367931)",
        url: "https://pubmed.ncbi.nlm.nih.gov/18367931/",
      },
    ],
    items: iadlItems,
    context: [],
    scoreMin: 0,
    scoreMax: 8,
    scoreUnit: "points",
    classify: (score: number) => findBand(iadlBands, score),
    adjustScore: noAdjustment,
    buildAlerts: (score: number) =>
      score < 8
        ? [
            {
              code: "IADL_DOMAIN_REVIEW",
              level: "info",
              message: "至少一個工具性日常活動領域記錄為需要協助，請由人員檢視各題而非只看總分。",
            },
          ]
        : [],
  },
  {
    versionId: "mna-sf-revised-2009-v1",
    instrument: "mna_sf",
    title: "MNA-SF 2009 修訂版（BMI／小腿圍替代）",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy:
      "六個領域加總為 0–14；BMI 無法取得時才以小腿圍選項替代。任何缺值或 N/A 均不產生總分；不得任意改題或改選項。商業上線前須確認商標與使用授權。",
    disclaimer: commonDisclaimer,
    sources: [
      {
        label: "MNA official 2009 revised English form",
        url: "https://www.nestlehealthscience.com/sites/default/files/2019-09/mna_mini_english.pdf",
      },
      {
        label: "MNA official user guide",
        url: "https://www.mna-elderly.com/user-guide",
      },
    ],
    items: mnaItems,
    context: [],
    scoreMin: 0,
    scoreMax: 14,
    scoreUnit: "points",
    classify: (score: number) => findBand(mnaBands, score),
    adjustScore: noAdjustment,
    buildAlerts: (score: number) =>
      score < 12
        ? [
            {
              code: "MNA_FURTHER_ASSESSMENT",
              level: "warning",
              message: "MNA-SF 分數位於需進一步營養評估的篩檢區間；系統不自動建立診斷或治療。",
            },
          ]
        : [],
  },
  {
    versionId: "fall-risk-taipei-115-b12-v1",
    instrument: "fall_risk_taipei_115",
    title: "臺北市社區式品質抽監測表 B12 跌倒高風險評估（115 年）",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy: "依使用者提供之 115 年版臺北市社會局 B12，12 項每項符合計 1 項；3 項以上符合表單所列高風險群。結果僅供篩檢與人工確認，不自動產生處置。",
    disclaimer: commonDisclaimer,
    sources: [],
    items: fallRiskItems,
    context: [],
    scoreMin: 0,
    scoreMax: 12,
    scoreUnit: "points",
    classify: (score: number) => findBand(fallRiskBands, score),
    adjustScore: noAdjustment,
    buildAlerts: (score: number) => score >= 3 ? [{
      code: "TAIPEI_B12_HIGH_RISK_REVIEW",
      level: "warning",
      message: "依臺北市 B12 表單門檻，需由人員覆核並依機構流程評估預防措施；系統不自動建立處置。",
    }] : [],
  },
  {
    versionId: "nsi-determine-10-weighted-v1",
    instrument: "nsi_determine",
    title: "NSI DETERMINE 10 題加權營養風險檢核表",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy: "十題依 NSI 原表加權，最高 21 分；0–2、3–5、6 以上為低、中、高營養風險參考區間。此警訊檢核不構成營養不良診斷。",
    disclaimer: commonDisclaimer,
    sources: [{
      label: "U.S. Administration for Community Living: Determine Your Nutritional Health Checklist",
      url: "https://acl.gov/sites/default/files/nutrition/NSI_checklist_508%20with%20citation.pdf",
    }],
    items: nsiItems,
    context: [],
    scoreMin: 0,
    scoreMax: 21,
    scoreUnit: "points",
    classify: (score: number) => findBand(nsiBands, score),
    adjustScore: noAdjustment,
    buildAlerts: (score: number) => score >= 3 ? [{
      code: "NSI_NUTRITION_REVIEW",
      level: "warning",
      message: "NSI 警訊分數達中度以上參考區間，請由人員查看各題並安排適當營養評估。",
    }] : [],
  },
  {
    versionId: "eat10-tw-v1",
    instrument: "eat10",
    title: "EAT-10 吞嚥困難自我評估工具表",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy: "十題各 0–4 分加總，最高 40 分；總分 3 分或更高為可能有吞嚥能力或安全問題，應與醫師或相關專業人員討論。",
    disclaimer: commonDisclaimer,
    sources: [{
      label: "衛生福利部 EAT-10 吞嚥困難篩選工具表",
      url: "https://www.mohw.gov.tw/dl-81939-7ac68e25-be5e-470f-ae90-3bafa976f5c0.html",
    }],
    items: eat10Items,
    context: [],
    scoreMin: 0,
    scoreMax: 40,
    scoreUnit: "points",
    classify: (score: number) => findBand(eat10Bands, score),
    adjustScore: noAdjustment,
    buildAlerts: (score: number) => score >= 3 ? [{
      code: "EAT10_CLINICIAN_DISCUSSION",
      level: "warning",
      message: "達 EAT-10 篩檢參考門檻，建議由人員協助與醫師或相關專業人員討論。",
    }] : [],
  },
  {
    versionId: "bsrs5-zh-tw-v1",
    instrument: "bsrs5",
    title: "BSRS-5 心情溫度計（附加安全題）",
    ruleRevision: 1,
    activatedAt: null,
    reviewRequired: true,
    scoringPolicy: "前五題 0–4 分加總，附加自殺想法題不計入總分；依衛福部版本呈現分數區間。附加題有非零作答時須立即依機構流程人工關懷。",
    disclaimer: commonDisclaimer,
    sources: [{
      label: "衛生福利部心理及口腔健康司：BSRS-5 心情溫度計",
      url: "https://mohw.gov.tw/fp-16-19441-1.html",
    }],
    items: allBsrsItems,
    context: [],
    scoreMin: 0,
    scoreMax: 20,
    scoreUnit: "points",
    classify: (score: number) => findBand(bsrsBands, score),
    adjustScore: noAdjustment,
    buildAlerts: noAlerts,
  },
] as const satisfies readonly AssessmentDefinition[];

export const ASSESSMENT_DEFINITIONS: readonly AssessmentDefinition[] =
  definitions;

export const ASSESSMENT_VERSIONS: Readonly<
  Record<AssessmentVersionId, AssessmentDefinition>
> = Object.freeze(
  {
    "spmsq-pfeiffer-10-education-adjusted-v1": definitions[0],
    "gds-15-strict-complete-v1": definitions[1],
    "barthel-adl-0-100-v1": definitions[2],
    "lawton-iadl-8-domain-expanded-v1": definitions[3],
    "mna-sf-revised-2009-v1": definitions[4],
    "fall-risk-taipei-115-b12-v1": definitions[5],
    "nsi-determine-10-weighted-v1": definitions[6],
    "eat10-tw-v1": definitions[7],
    "bsrs5-zh-tw-v1": definitions[8],
  } satisfies Record<AssessmentVersionId, AssessmentDefinition>,
);

export function getAssessmentDefinition(
  versionId: string,
): AssessmentDefinition | undefined {
  return ASSESSMENT_VERSIONS[versionId as AssessmentVersionId];
}

export const ASSESSMENT_INSTRUMENTS: readonly AssessmentInstrument[] = [
  "spmsq",
  "gds_15",
  "barthel_adl",
  "lawton_iadl",
  "mna_sf",
  "fall_risk_taipei_115",
  "nsi_determine",
  "eat10",
  "bsrs5",
];
