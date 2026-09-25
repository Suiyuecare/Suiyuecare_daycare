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
  "telephone",
  "shopping",
  "food_preparation",
  "housekeeping",
  "laundry",
  "transportation",
  "medications",
  "finances",
].map((id) =>
  requiredItem(id, id, [answer("dependent", 0), answer("independent", 1)]),
);

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
    versionId: "lawton-iadl-binary-8-v1",
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
    "lawton-iadl-binary-8-v1": definitions[3],
    "mna-sf-revised-2009-v1": definitions[4],
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
];
