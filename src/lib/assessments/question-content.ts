/**
 * Approved Taiwanese-language prompt set used by the assessment workspaces.
 * Scoring and clinical interpretation remain governed separately by each
 * immutable rule version; displaying wording does not activate a scale.
 */
export const SPMSQ_QUESTIONS = [
  "今天是幾號？",
  "今天是星期幾？",
  "這是什麼地方？",
  "您的電話號碼是幾號？（若沒有電話，改問：您住在什麼地方？）",
  "您幾歲了？",
  "您的出生年月日是？",
  "現任的總統是誰？",
  "前任的總統是誰？",
  "您媽媽叫什麼名字？",
  "從 20 減 3 開始算，一直減 3 減下去。",
] as const;

export const SPMSQ_ADMINISTRATION_NOTES = [
  "年、月、日都正確才算答對。",
  "星期答對才算答對。",
  "說出所在地的任何正確描述均可接受。",
  "核對電話號碼；沒有電話時改問住址。",
  "年齡須與出生年月日相符。",
  "年、月、日都正確才算答對。",
  "姓氏正確即可。",
  "姓氏正確即可。",
  "說出一位不同於受評者本人的女性姓名即可。",
  "過程出現任何錯誤或無法繼續即記為錯誤。",
] as const;

export const GDS15_INSTRUCTIONS = "請依據最近一週的感受回答以下問題。";

export const GDS15_QUESTIONS = [
  "基本上，您對您的生活滿意嗎？",
  "您是否減少很多的活動和興趣的事？",
  "您是否覺得您的生活很空虛？",
  "您是否常常感到厭煩？",
  "您是否大部分時間精神都很好？",
  "您是否會常常害怕將有不幸的事情發生在您身上？",
  "您是否大部分的時間都感到快樂？",
  "您是否常常感到無論做什麼事，都沒有用？",
  "您是否比較喜歡待在家裡，而較不喜歡外出及做新的事？",
  "您是否覺得現在有記憶力不好的困擾？",
  "您是否覺得現在還能活著是很好的事？",
  "您是否覺得您現在活得很沒有價值？",
  "您是否覺得精力很充沛？",
  "您是否感覺您現在的情況是沒有希望的？",
  "您是否覺得大部分的人都比您幸福？",
] as const;

export interface QuestionnaireChoice {
  readonly value: string;
  readonly label: string;
}

export interface QuestionnairePrompt {
  readonly id: string;
  readonly prompt: string;
  readonly helpText?: string;
  readonly choices: readonly QuestionnaireChoice[];
}

export const BARTHEL_FORM_VERSION = "barthel-adl-0-100-v1" as const;
export const BARTHEL_QUESTIONS: readonly QuestionnairePrompt[] = [
  { id: "feeding", prompt: "進食", helpText: "自己能在合理時間（約 10 秒鐘吃一口）用筷子取食眼前食物；若需進食輔具，應能自行穿脫。", choices: [
    { value: "independent", label: "10 分・可自行完成上述動作" },
    { value: "needs_help", label: "5 分・需他人協助穿脫輔具或只會用湯匙進食" },
    { value: "unable", label: "0 分・無法自行取食或耗費時間過長" },
  ] },
  { id: "grooming", prompt: "個人衛生：能否自行洗手、刷牙、洗臉及梳頭？", choices: [
    { value: "independent", label: "5 分・可以自行完成" },
    { value: "dependent", label: "0 分・需要他人部分或完全協助" },
  ] },
  { id: "toilet_use", prompt: "上廁所：能否自行上下馬桶、穿脫衣服、不弄髒衣服並使用衛生紙清潔？", choices: [
    { value: "independent", label: "10 分・可自行完成上述動作" },
    { value: "needs_help", label: "5 分・需協助平衡、整理衣服或使用衛生紙" },
    { value: "dependent", label: "0 分・無法自行完成" },
  ] },
  { id: "bathing", prompt: "洗澡：能否獨立完成盆浴或沐浴，且不需別人在旁？", choices: [
    { value: "independent", label: "5 分・能獨立完成" },
    { value: "dependent", label: "0 分・需要他人協助" },
  ] },
  { id: "dressing", prompt: "穿脫衣服：能否自行穿脫衣服、鞋子，扣釦子、拉拉鍊或綁鞋帶？", choices: [
    { value: "independent", label: "10 分・能自行完成" },
    { value: "needs_help", label: "5 分・在他人協助下可自行完成一半以上" },
    { value: "unable", label: "0 分・不會自行完成" },
  ] },
  { id: "bowels", prompt: "大便控制：最近一週能否控制排便？", choices: [
    { value: "continent", label: "10 分・不會失禁，能自行灌腸或使用塞劑" },
    { value: "occasional_accident", label: "5 分・偶爾失禁（每週不超過一次），需協助灌腸或塞劑" },
    { value: "incontinent", label: "0 分・失禁，無法自行控制且需他人處理" },
  ] },
  { id: "bladder", prompt: "小便控制：最近一週能否控制排尿，或自行使用並清潔尿套、尿袋？", choices: [
    { value: "continent", label: "10 分・能自行控制或使用並清潔尿套、尿袋" },
    { value: "occasional_accident", label: "5 分・偶爾失禁、尿急或需協助處理尿套" },
    { value: "incontinent", label: "0 分・失禁，無法自行控制且需他人處理" },
  ] },
  { id: "mobility", prompt: "平地行走：使用或不使用輔具，能否在平地行走 50 公尺以上？", choices: [
    { value: "independent", label: "15 分・可獨立行走 50 公尺以上" },
    { value: "walks_with_help", label: "10 分・需他人稍微扶持或口頭指導，方可行走 50 公尺以上" },
    { value: "wheelchair_independent", label: "5 分・不能行走，但可操作並自行推輪椅 50 公尺以上" },
    { value: "immobile", label: "0 分・無法自行行走，需他人推輪椅" },
  ] },
  { id: "stairs", prompt: "上下樓梯：能否自行上下樓梯？", choices: [
    { value: "independent", label: "10 分・可自行上下樓梯，可使用扶手或拐杖等輔具" },
    { value: "needs_help", label: "5 分・需他人協助或監督" },
    { value: "unable", label: "0 分・無法上下樓梯" },
  ] },
  { id: "transfers", prompt: "上下床或椅子：能否自行完成床椅間移位？", choices: [
    { value: "independent", label: "15 分・整個過程可獨立完成" },
    { value: "minor_help", label: "10 分・移動時需要稍微協助、提醒或安全監督" },
    { value: "major_help", label: "5 分・可以自行坐起，但起身或移動時需要他人協助" },
    { value: "unable", label: "0 分・不會自行移動" },
  ] },
] as const;

export const IADL_FORM_VERSION = "lawton-iadl-8-domain-expanded-v1" as const;
export const IADL_QUESTIONS: readonly QuestionnairePrompt[] = [
  { id: "telephone", prompt: "使用電話的能力", choices: [
    { value: "telephone_dials_numbers", label: "自動自發使用電話、查電話號碼並撥號" },
    { value: "telephone_familiar_numbers", label: "只會撥幾個熟知的電話" },
    { value: "telephone_answer_only", label: "會接電話，但不會撥號" },
    { value: "telephone_unable", label: "完全不會使用電話" },
  ] },
  { id: "shopping", prompt: "上街購物", choices: [
    { value: "shopping_independent_all", label: "獨立處理所有購物需求" },
    { value: "shopping_small_items_only", label: "可以獨立執行小額購買" },
    { value: "shopping_accompanied", label: "每次上街購物都需要有人陪伴" },
    { value: "shopping_unable", label: "完全不會上街購物" },
  ] },
  { id: "food_preparation", prompt: "做飯", choices: [
    { value: "meal_independent", label: "獨立計畫、烹煮並擺設一頓適當的飯菜" },
    { value: "meal_prepared_ingredients", label: "若備好所有材料，可做一頓適當的飯菜" },
    { value: "meal_reheat_or_inadequate", label: "會加熱並擺設已做好的飯菜，或做飯但不夠充分" },
    { value: "meal_needs_prepared", label: "需要別人把飯菜煮好、擺好" },
  ] },
  { id: "housekeeping", prompt: "做家事", choices: [
    { value: "housework_independent", label: "能單獨處理家事，或偶爾需要協助較重家事" },
    { value: "housework_light_tasks", label: "能做較輕的家事，例如洗碗、鋪床、疊被" },
    { value: "housework_below_standard", label: "能做較輕家事，但清潔程度未達可接受程度" },
    { value: "housework_all_help", label: "所有家事都需要別人協助" },
    { value: "housework_unable", label: "完全不會做家事" },
  ] },
  { id: "laundry", prompt: "洗衣", choices: [
    { value: "laundry_all", label: "會洗所有個人衣物" },
    { value: "laundry_small_items", label: "會洗小件衣物，例如襪子、褲襪" },
    { value: "laundry_needs_help", label: "所有衣物都要由別人代洗" },
  ] },
  { id: "transportation", prompt: "使用交通工具", choices: [
    { value: "transport_public_or_drive", label: "能自己搭乘公共交通或自己開車" },
    { value: "transport_taxi_only", label: "能自己搭計程車，但不會搭公共交通工具" },
    { value: "transport_with_companion", label: "有人協助或陪伴時，可以搭公共交通工具" },
    { value: "transport_private_with_help", label: "只能在別人協助下搭計程車或私用車" },
    { value: "transport_unable_to_leave", label: "完全不能出門" },
  ] },
  { id: "medication", prompt: "自己負責用藥", choices: [
    { value: "medication_independent", label: "能自行在正確時間服用正確藥物" },
    { value: "medication_prepared", label: "若事先備妥藥物分量，可以自行服用" },
    { value: "medication_needs_help", label: "不能自己負責服藥" },
  ] },
  { id: "finances", prompt: "財務管理", choices: [
    { value: "finances_independent", label: "能獨立做預算、付帳單、處理銀行事務並清楚掌握收支" },
    { value: "finances_daily_only", label: "能處理日常購買，但需協助銀行往來或大宗購買" },
    { value: "finances_unable", label: "不能處理錢財" },
  ] },
].map((question) => ({
  ...question,
  helpText: "依衛福部《失智症診療手冊》附錄五逐項選擇；本系統先保存答案，不計算正式總分或分級。",
}));

export const EAT10_FORM_VERSION = "eat10-tw-v1" as const;
export const EAT10_INSTRUCTIONS = "請依個案近期實際吞嚥經驗，逐題選擇困難程度；0 代表沒有問題，4 代表問題很嚴重。此為初篩，不取代吞嚥專業評估。";
export const EAT10_QUESTIONS = [
  "吞嚥問題是否導致我的體重下降？",
  "吞嚥是否干擾我外出飲食？",
  "吞嚥液狀物需額外費力？",
  "吞嚥固狀物需額外費力？",
  "吞服藥丸時需額外特別費力？",
  "吞嚥是否會導致疼痛？",
  "飲食的愉悅是否受吞嚥問題影響？",
  "吞嚥食物時會黏著咽喉？",
  "吃東西時是否會咳嗽？",
  "吞嚥時是否有壓迫感？",
] as const;
export const EAT10_CHOICES: readonly QuestionnaireChoice[] = [
  { value: "0", label: "0・沒有問題" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4・問題很嚴重" },
];

export const BSRS5_FORM_VERSION = "bsrs5-zh-tw-v1" as const;
export const BSRS5_INSTRUCTIONS = "請依最近一週（含今天）造成困擾的程度作答。第 1–5 題為情緒困擾題；自殺想法為額外安全題，不能與總分混為一談。";
export const BSRS5_QUESTIONS = [
  "睡眠困難，譬如難以入睡、易醒或早醒。",
  "感覺緊張或不安。",
  "覺得容易苦惱或動怒。",
  "感覺憂鬱、心情低落。",
  "覺得比不上別人。",
  "有自殺的想法。（安全關懷題，不列入前五題總分）",
] as const;
export const BSRS5_CHOICES: readonly QuestionnaireChoice[] = [
  { value: "0", label: "0・完全沒有" },
  { value: "1", label: "1・輕微" },
  { value: "2", label: "2・中等程度" },
  { value: "3", label: "3・嚴重" },
  { value: "4", label: "4・非常嚴重" },
];

export const TAIPEI_FALL_RISK_FORM_VERSION = "fall-risk-taipei-community-115-b12-v1" as const;
export const TAIPEI_FALL_RISK_QUESTIONS: readonly QuestionnairePrompt[] = [
  { id: "fall_01", prompt: "年齡是否大於 65 歲？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_02", prompt: "最近三個月內是否曾跌倒？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_03", prompt: "步態或平衡是否曾失調（例如帕金森氏症）？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_04", prompt: "是否有肢體功能障礙（例如關節炎）？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_05", prompt: "是否有認知障礙？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_06", prompt: "是否有下肢無力或殘障？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_07", prompt: "是否有頭暈或暈眩？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_08", prompt: "是否有視力模糊？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_09", prompt: "是否有睡眠障礙？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_10", prompt: "是否診斷過腦中風？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_11", prompt: "是否服用可能影響意識或活動的藥物（利尿劑、止痛劑、輕瀉劑、鎮靜安眠藥、心血管用藥或抗精神病藥物）？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "fall_12", prompt: "是否患有可能影響跌倒的疾病（例如骨質疏鬆症或中樞神經退化疾病）？", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
] as const;

export const NSI_DETERMINE_FORM_VERSION = "nsi-determine-10-weighted-v1" as const;
export const NSI_DETERMINE_QUESTIONS: readonly QuestionnairePrompt[] = [
  { id: "nsi_01", prompt: "我有疾病、病況或慢性問題，讓我必須改變吃的食物種類或份量。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_02", prompt: "我每天吃不到兩餐。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_03", prompt: "我很少吃水果、蔬菜或乳製品。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_04", prompt: "我幾乎每天喝三杯或以上啤酒、烈酒或葡萄酒。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_05", prompt: "牙齒或口腔問題讓我吃東西困難。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_06", prompt: "我不一定有足夠的錢購買所需食物。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_07", prompt: "我大部分時間獨自吃飯。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_08", prompt: "我每天服用三種或以上處方藥或非處方藥。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_09", prompt: "過去六個月內，我在非刻意情況下減輕或增加了 10 磅（約 4.5 公斤）。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
  { id: "nsi_10", prompt: "我並非總能在身體上自行購物、烹調和／或進食。", choices: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
] as const;

export const MNA_SF_FORM_VERSION = "mna-sf-revised-2009-traditional-chinese-v1" as const;
export const MNA_SF_QUESTIONS: readonly QuestionnairePrompt[] = [
  { id: "food_intake", prompt: "過去三個月中，是否因食慾不佳、消化問題、咀嚼或吞嚥困難而使進食量減少？", choices: [
    { value: "severe_decrease", label: "嚴重減少・0 分" }, { value: "moderate_decrease", label: "中度減少・1 分" }, { value: "no_decrease", label: "沒有減少・2 分" },
  ] },
  { id: "weight_loss", prompt: "近三個月的體重變化？", choices: [
    { value: "greater_than_3kg", label: "減輕超過 3 公斤・0 分" }, { value: "unknown", label: "不知道・1 分" }, { value: "between_1_and_3kg", label: "減輕 1 至 3 公斤・2 分" }, { value: "no_weight_loss", label: "沒有體重減輕・3 分" },
  ] },
  { id: "mobility", prompt: "目前行動能力？", choices: [
    { value: "bed_or_chair_bound", label: "臥床或坐輪椅・0 分" }, { value: "gets_up_but_does_not_go_out", label: "能下床或離開椅子，但不外出・1 分" }, { value: "goes_out", label: "能外出・2 分" },
  ] },
  { id: "acute_stress_or_disease", prompt: "過去三個月內是否曾有心理壓力或急性疾病？", choices: [
    { value: "yes", label: "是・0 分" }, { value: "no", label: "否・2 分" },
  ] },
  { id: "neuropsychological", prompt: "神經心理問題？", choices: [
    { value: "severe", label: "嚴重失智症或憂鬱症・0 分" }, { value: "mild", label: "輕度失智症・1 分" }, { value: "none", label: "沒有神經心理問題・2 分" },
  ] },
  { id: "anthropometry", prompt: "身體質量指數（BMI）；若無法取得 BMI，改用小腿圍（CC）作答。", helpText: "請先輸入可取得的實測身高、體重或小腿圍。 BMI = 體重（公斤）÷ 身高（公尺）²。BMI 與小腿圍只能擇一計分。", choices: [
    { value: "bmi_lt_19", label: "BMI < 19・0 分" }, { value: "bmi_19_lt_21", label: "BMI 19 至 < 21・1 分" }, { value: "bmi_21_lt_23", label: "BMI 21 至 < 23・2 分" }, { value: "bmi_gte_23", label: "BMI ≥ 23・3 分" }, { value: "calf_lt_31", label: "BMI 無法取得；小腿圍 < 31 公分・0 分" }, { value: "calf_gte_31", label: "BMI 無法取得；小腿圍 ≥ 31 公分・3 分" },
  ] },
] as const;

export const MNA_SF_MEASUREMENTS = [
  { key: "height_cm", label: "身高（公分）" },
  { key: "weight_kg", label: "體重（公斤）" },
  { key: "calf_circumference_cm", label: "小腿圍（公分）" },
] as const;
