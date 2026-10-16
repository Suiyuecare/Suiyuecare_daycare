import type { QuestionnairePrompt } from "@/lib/assessments/question-content";

// Candidate-only transcription of the eight AD8 domains and examples in the
// Taitung County Health Bureau's 110-04-30 form. This is not an activated
// scoring rule, diagnosis, referral, or signed assessment.
// https://ttshbltc.ttshb.gov.tw/ttshb/other/%E8%87%BA%E6%9D%B1%E7%B8%A3AD8%E6%A5%B5%E6%97%A9%E6%9C%9F%E5%A4%B1%E6%99%BA%E7%97%87%E7%AF%A9%E6%AA%A2%E9%87%8F%E8%A1%A8.pdf
const AD8_CHOICES = [
  { value: "changed", label: "是，有改變" },
  { value: "unchanged", label: "否，無改變" },
  { value: "unknown", label: "不知道" },
] as const;

export const AD8_CANDIDATE_QUESTIONS: readonly QuestionnairePrompt[] = [
  { id: "ad8_01", prompt: "判斷力有困難，例如容易受騙、做出不好的財務決定，或買了不合宜的禮物。", choices: AD8_CHOICES },
  { id: "ad8_02", prompt: "對活動和嗜好的興趣降低。", choices: AD8_CHOICES },
  { id: "ad8_03", prompt: "重複相同的問題、故事或陳述。", choices: AD8_CHOICES },
  { id: "ad8_04", prompt: "學習使用工具、設備或小器具有困難，例如電視、音響、冷氣、洗衣機、熱水器、微波爐或遙控器。", choices: AD8_CHOICES },
  { id: "ad8_05", prompt: "忘記正確的月份或年份。", choices: AD8_CHOICES },
  { id: "ad8_06", prompt: "處理複雜財務有困難，例如平衡個人或家庭收支、所得稅或繳費單。", choices: AD8_CHOICES },
  { id: "ad8_07", prompt: "記住約會時間有困難。", choices: AD8_CHOICES },
  { id: "ad8_08", prompt: "持續有思考或記憶方面的問題。", choices: AD8_CHOICES },
];
