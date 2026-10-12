import type { AssessmentDefinition } from "./definitions";
import type { QuestionnairePrompt } from "./question-content";

/** Official Chinese source identity; this candidate is not a Taiwan-approved clinical publication. */
export const FULL_MNA_VERSION = "full-mna-chinese-amended-2023-v1" as const;
export const FULL_MNA_SOURCE_URL = "https://www.mna-elderly.com/sites/default/files/2024-10/Long-MNA_AU1.0_chinese.nonMapi.pdf";
export const FULL_MNA_SOURCE_SHA256 = "cd9d96d2f82fb256ce7999078428f241ac6136afe0dfd5851f3b5997c7add734";

const question = (id: string, prompt: string, choices: readonly (readonly [string, string, number])[], helpText?: string) => ({
  id, prompt, ...(helpText ? { helpText } : {}),
  choices: choices.map(([value, label, score]) => ({ value, label, score })),
});

export const FULL_MNA_QUESTIONS = [
  question("food_intake", "A 過去三個月內有沒有因為食慾不振、消化問題、咀嚼或吞嚥困難而減少食量？", [
    ["severe_decrease", "食量嚴重減少", 0], ["moderate_decrease", "食量中度減少", 1], ["no_decrease", "食量沒有改變", 2],
  ]),
  question("weight_loss", "B 過去三個月內體重下降的情況", [
    ["greater_than_3kg", "體重下降大於 3 公斤（6.6 磅）", 0], ["unknown", "不知道", 1],
    ["between_1_and_3kg", "體重下降 1–3 公斤（2.2–6.6 磅）", 2], ["no_weight_loss", "體重沒有下降", 3],
  ]),
  question("mobility", "C 活動能力", [
    ["bed_or_chair_bound", "需長期臥床或坐輪椅", 0], ["gets_up_but_does_not_go_out", "可以下床或離開輪椅，但不能外出", 1], ["goes_out", "可以外出", 2],
  ]),
  question("acute_stress_or_disease", "D 過去三個月內有沒有受到心理創傷或患上急性疾病？", [["yes", "有", 0], ["no", "沒有", 2]]),
  question("neuropsychological", "E 精神心理問題", [["severe", "嚴重痴呆或抑鬱", 0], ["mild", "輕度痴呆", 1], ["none", "沒有精神心理問題", 2]]),
  question("anthropometry", "F 身體質量指數（BMI）（公斤／米²，kg/m²）", [
    ["bmi_lt_19", "BMI 低於 19", 0], ["bmi_19_lt_21", "BMI 19 至低於 21", 1],
    ["bmi_21_lt_23", "BMI 21 至低於 23", 2], ["bmi_gte_23", "BMI 23 或以上", 3],
  ], "完整版本 F 題僅使用 BMI；R 題的小腿圍另外計分，不能代替 F 題。"),
  question("independent_living", "G 是否獨立生活（非居住於療養院或醫院）？", [["yes", "是", 1], ["no", "否", 0]]),
  question("prescription_drugs", "H 每天服用三種以上的處方藥物？", [["yes", "是", 0], ["no", "否", 1]]),
  question("pressure_sores", "I 是否有褥瘡或皮膚潰瘍？", [["yes", "是", 0], ["no", "否", 1]]),
  question("full_meals", "J 每天吃多少次主餐？", [["one", "1 餐", 0], ["two", "2 餐", 1], ["three", "3 餐", 2]]),
  question("protein_intake", "K 蛋白質攝取量指標", [
    ["zero_or_one_yes", "0 或 1 個「是」", 0], ["two_yes", "2 個「是」", 0.5], ["three_yes", "3 個「是」", 1],
  ], "逐項記錄下列三個子回答，依「是」的數量核對本題選項；任一子回答缺漏，不推估。"),
  question("fruit_vegetables", "L 每天有進食兩份或以上水果或蔬菜？", [["no", "否", 0], ["yes", "是", 1]]),
  question("fluid_intake", "M 每天喝多少流質（水、果汁、咖啡、茶、牛奶……）？", [["lt_three", "少於 3 杯", 0], ["three_to_five", "3 至 5 杯", 0.5], ["gt_five", "多於 5 杯", 1]]),
  question("feeding_mode", "N 進食模式", [["needs_help", "需輔助才能進食", 0], ["self_with_difficulty", "能自行進食但稍有困難", 1], ["self_without_difficulty", "能自行進食", 2]]),
  question("self_nutrition", "O 自我評估營養狀況", [["malnourished", "自覺營養不良", 0], ["uncertain", "不清楚自我的營養狀況", 1], ["no_problem", "自覺沒有營養問題", 2]]),
  question("self_health", "P 與同齡人士相比，病人如何評價自己的健康狀況？", [["worse", "比別人差", 0], ["unknown", "不知道", 0.5], ["same", "和別人一樣", 1], ["better", "比別人更好", 2]]),
  question("arm_circumference", "Q 上手臂中點臂圍（MAC）（公分，cm）", [["mac_lt_21", "MAC 低於 21", 0], ["mac_21_lt_22", "MAC 21 至低於 22", 0.5], ["mac_gte_22", "MAC 22 或以上", 1]]),
  question("calf_circumference", "R 小腿圍（CC）（公分，cm）", [["calf_lt_31", "CC 低於 31", 0], ["calf_gte_31", "CC 31 或以上", 1]]),
] as const satisfies readonly QuestionnairePrompt[];

export const FULL_MNA_PROTEIN_FIELDS = [
  { key: "protein_dairy", label: "每天進食至少一份乳製品（牛奶、芝士或乳酪）" },
  { key: "protein_legumes_eggs", label: "每週進食兩份以上乾豆類或蛋類" },
  { key: "protein_meat_fish_poultry", label: "每天均進食肉類、魚類或家禽類" },
].map((field) => ({ ...field, questionId: "protein_intake", required: true,
  choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }],
}));
export const FULL_MNA_MEASUREMENTS = [
  { key: "height_cm", label: "身高（公分）", questionId: "anthropometry" },
  { key: "weight_kg", label: "體重（公斤）", questionId: "anthropometry" },
  { key: "arm_circumference_cm", label: "上手臂中點臂圍（公分）", questionId: "arm_circumference" },
  { key: "calf_circumference_cm", label: "小腿圍（公分）", questionId: "calf_circumference" },
] as const;

export function fullMnaProteinChoice(context: Readonly<Record<string, string>>) {
  const values = FULL_MNA_PROTEIN_FIELDS.map((field) => context[field.key]);
  if (values.some((value) => value !== "yes" && value !== "no")) return null;
  const count = values.filter((value) => value === "yes").length;
  return count < 2 ? "zero_or_one_yes" : count === 2 ? "two_yes" : "three_yes";
}
const fullBands = [
  { key: "malnourished_full_0_16_5", label: "完整 MNA 少於 17 分參考區間", minInclusive: 0, maxInclusive: 16.5, interpretation: "screening_only" },
  { key: "at_risk_full_17_23_5", label: "完整 MNA 17–23.5 分參考區間", minInclusive: 17, maxInclusive: 23.5, interpretation: "screening_only" },
  { key: "normal_full_24_30", label: "完整 MNA 24–30 分參考區間", minInclusive: 24, maxInclusive: 30, interpretation: "screening_only" },
] as const;
export const FULL_MNA_DEFINITION: AssessmentDefinition = {
  versionId: FULL_MNA_VERSION, instrument: "full_mna", title: "Long MNA Chinese amended 2023（完整 18 題候選版）",
  ruleRevision: 1, activatedAt: null, reviewRequired: true,
  scoringPolicy: "A–R 共 18 題；A–F 最高 14 分、G–R 最高 16 分、總分 30 分。K、M、P、Q 保留 0.5 分精度；K 保留三個子回答。F 僅使用 BMI，Q／R 分別使用臂圍／小腿圍。任何缺值或 N/A 均不產生總分。官方 Chinese amended 2023 候選實作，不宣稱臺灣核定版；正式結果另須雙人發布。",
  disclaimer: "本結果只重現指定版本的量表計分，不構成診斷、醫囑或自動處置；應由具權限人員結合完整資料判讀。",
  sources: [{ label: "Official Long MNA Chinese amended 2023", url: FULL_MNA_SOURCE_URL, sha256: FULL_MNA_SOURCE_SHA256 }],
  items: FULL_MNA_QUESTIONS.map((item) => ({ id: item.id, label: item.prompt, required: true, allowNotApplicable: false,
    choices: item.choices.map((choice) => ({ value: choice.value, points: choice.score })),
  })),
  context: FULL_MNA_PROTEIN_FIELDS.map((field) => ({ id: field.key, label: field.label, required: true, choices: ["yes", "no"] })),
  scoreMin: 0, scoreMax: 30, scoreUnit: "points",
  classify: (score) => {
    const result = fullBands.find((candidate) => score >= candidate.minInclusive && score <= candidate.maxInclusive);
    if (!result) throw new Error("FULL_MNA_SCORE_OUT_OF_RANGE");
    return result;
  },
  adjustScore: (score) => score, buildAlerts: () => [],
  validateAnswers: (answers, context) => {
    const expected = fullMnaProteinChoice(context);
    const answer = answers.protein_intake;
    return expected && answer?.state === "answered" && answer.value !== expected
      ? [{ code: "INVALID_ANSWER", field: "protein_intake", message: "K 題選項與三個子回答不一致。", category: "invalid" }] : [];
  },
};
