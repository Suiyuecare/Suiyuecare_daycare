/** Transcribed from the user-supplied 15-page Taipei form; this is a draft
 * input specification, not a formally approved/published clinical template. */
export const TAIPEI_ABCD_TEMPLATE = Object.freeze({
  key: "taipei.daycare.abcd.115.114-11.draft-v1", usageYear: 115,
  sourceRevision: "114.11", sourceSha256: "64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481",
  publicationStatus: "pending_approval", serviceType: "daycare_only",
} as const);
export type TaipeiForm = "A" | "B" | "C";
export type FieldKind = "text" | "date" | "number" | "choice" | "multi";
export type TaipeiField = { key: string; label: string; kind: FieldKind; options?: readonly string[];
  min?: number; max?: number; help?: string; prefillAllowed?: boolean };
export type TaipeiSection = { code: string; title: string; sourcePages: readonly number[]; fields: TaipeiField[]; help?: string };
const t = (key: string, label: string, extra: Partial<TaipeiField> = {}): TaipeiField => ({ key, label, kind: "text", ...extra });
const n = (key: string, label: string, min: number, max: number): TaipeiField => ({ key, label, kind: "number", min, max });
const d = (key: string, label: string): TaipeiField => ({ key, label, kind: "date" });
const c = (key: string, label: string, options: string): TaipeiField => ({ key, label, kind: "choice", options: options.split("|") });
const m = (key: string, label: string, options: string): TaipeiField => ({ key, label, kind: "multi", options: options.split("|") });
const yes = (key: string, label: string) => c(key, label, "無|有");
const sec = (code: string, title: string, sourcePages: number[], fields: TaipeiField[], help?: string): TaipeiSection => ({ code, title, sourcePages, fields, help });
const note = (code: string) => t(`${code}.notes`, "備註");
const contacts = [1, 2, 3].flatMap(i => [t(`A21.${i}.name`, `聯絡人 ${i} 姓名`), t(`A21.${i}.relationship`, "關係"),
  c(`A21.${i}.primary_carer`, "主要照顧者", "是|否"), t(`A21.${i}.address`, "聯絡地址"), t(`A21.${i}.email_line`, "Email／LINE"),
  t(`A21.${i}.phone`, "市話"), t(`A21.${i}.mobile`, "手機")]);
export const TAIPEI_A_SECTIONS: TaipeiSection[] = [
  sec("A0", "案號、收案日期與照片", [1], [t("A0.case_number", "案號"), d("A0.admitted_on", "收案日期（尚未核准請留待填）"),
    t("A0.photo_document_id", "2 吋證件照的文件編號（3.5×4.5cm）", { help: "照片應透過個案文件管線上傳；填入編號不代表已上傳或覆核。" })]),
  sec("A1", "個案姓名", [1], [t("A1.name", "個案姓名", { prefillAllowed: true })]),
  sec("A2", "稱呼／暱稱", [1], [t("A2.nickname", "稱呼／暱稱")]),
  sec("A3", "身分證字號", [1], [t("A3.identity_reference", "身分識別核對／主檔參照", { help: "完整身分證號請在受限個案主檔核對，此草稿不重複保存完整證號。" })]),
  sec("A4", "性別", [1], [c("A4.sex", "性別", "男|女")]),
  sec("A5", "出生地", [1], [t("A5.birthplace", "出生地")]),
  sec("A6", "生日", [1], [d("A6.birth_date", "生日"), n("A6.age", "填表當時年齡", 0, 130)]),
  sec("A7", "電話", [1], [t("A7.home", "電話（H）"), t("A7.office", "電話（O）")]),
  sec("A8", "身分別（複選）", [1], [m("A8.status", "身分別", "低收入戶|中低收入戶|中低收入老人生活津貼|一般戶|榮民／榮眷|原住民")]),
  sec("A9", "身心障礙證明", [1], [yes("A9.has_certificate", "身心障礙證明"), c("A9.level", "等級", "輕度|中度|重度|極重度"),
    t("A9.category", "類別（第幾類）"), d("A9.assessed_on", "鑑定日期"), t("A9.valid_until", "有效期限／永久有效"), note("A9")], "填寫資料以最新文件證明為主。"),
  sec("A10", "CMS 等級／失智診斷", [1], [n("A10.cms_level", "CMS 等級", 1, 8), yes("A10.dementia_diagnosis", "失智診斷（依有效來源）")]),
  sec("A11", "戶籍地址", [1], [t("A11.address", "戶籍地址")]),
  sec("A12", "居住住址", [1], [c("A12.same_as_registered", "同戶籍地址", "是|否"), t("A12.address", "居住住址")]),
  sec("A13", "婚姻狀況", [1], [c("A13.status", "婚姻狀況", "未婚|分居|同居|離婚|鰥寡|已婚|其他"), t("A13.other", "其他說明")]),
  sec("A14", "居住狀況（複選）", [1], [m("A14.status", "居住狀況", "與配偶同住|與固定子女同住|與子女輪住|獨自居住|其他"), t("A14.other", "其他說明")]),
  sec("A15", "溝通方式（複選）", [1], [m("A15.methods", "溝通方式", "國語|台語|客家語|筆談|圖片|手勢|其他"), t("A15.other", "其他說明")]),
  sec("A16", "教育程度", [1], [c("A16.education", "教育程度", "不識字|識字但未曾就學|小學|國（初）中|高中|專科／大學以上")]),
  sec("A17", "退休前職業", [1], [c("A17.occupation", "退休前職業", "工|商|軍|公|教|農|家管|其他"), t("A17.title", "職稱")]),
  sec("A18", "宗教信仰", [1], [c("A18.religion", "宗教信仰", "無|佛教|道教|天主教|基督教|回教|一貫道|一般民間信仰|其他"), t("A18.other", "其他說明")]),
  sec("A19", "經濟來源（複選）", [1], [m("A19.sources", "經濟來源", "個人積蓄／退休俸／就養金|配偶|子女／親友|政府補助|其他"),
    n("A19.subsidy", "政府補助（元／月）", 0, 10000000), t("A19.other", "其他說明")]),
  sec("A20", "個案來源", [1], [m("A20.sources", "個案來源", "長照轉介|家屬申請|親友介紹|醫院轉介|機構轉介"),
    ...["A 單位", "照管中心", "家屬申請聯絡人", "親友介紹人", "醫院轉介聯絡人", "機構主責社工"].flatMap((label, i) => [t(`A20.${i}.name`, label), t(`A20.${i}.phone`, `${label}電話`)])]),
  sec("A21", "聯絡人", [1], contacts),
  sec("A22", "家系及生態圖", [2], [t("A22.description", "三代家系、正式／非正式資源與目前／過去／期待資源"), t("A22.diagram_document_id", "家系／生態圖文件編號（另行上傳）")], "圖像附件尚需透過文件管線驗證；文字說明不等於已繪製家系圖。"),
  sec("A23", "生活紀錄／喜歡聽的話／生活作息／生活興趣", [2], [t("A23.life", "生活紀錄"), t("A23.words", "喜歡聽的話"), t("A23.routine", "生活作息"), t("A23.interests", "興趣、食物、物品與嗜好")]),
  sec("A24", "服務期待與目標", [2], [t("A24.expectations", "為什麼來日照？最想做的事？希望協助改善什麼？"), t("A24.goals", "服務目標")]),
];
const nutrition = [
  c("B4.nutrition.intake", "近三個月進食量減少", "0＝嚴重食慾不佳|1＝中度食慾不佳|2＝食慾無變化"),
  c("B4.nutrition.weight", "近三個月體重變化", "0＝減輕大於3公斤|1＝不知道|2＝減輕1至3公斤|3＝無改變或變重"),
  c("B4.nutrition.mobility", "行動力", "0＝臥床或輪椅|1＝可下床但無法自由走動|2＝可以自由走動"),
  c("B4.nutrition.stress", "三個月內精神壓力或急性疾病", "0＝是|2＝否"),
  c("B4.nutrition.neuro", "神經精神問題", "0＝嚴重失智或抑鬱|1＝輕度失智|2＝無精神問題"),
  c("B4.nutrition.bmi", "BMI 項目（依量測核對）", "0＝小於19|1＝19至小於21|2＝21至小於23|3＝大於等於23"),
];
const diseaseGroups = [
  ["cardio", "心血管系統", "高血壓|高血脂／高膽固醇|心臟病|心律不整|心衰竭|其他"],
  ["respiratory", "呼吸系統", "慢性阻塞性肺病|氣喘|肺結核|肺炎|其他"],
  ["digestive", "消化系統", "消化性潰瘍|消化道出血|肝炎|肝硬化|肝膽結石|胰臟炎|其他"],
  ["urinary", "泌尿系統", "腎炎|結石|腎衰竭|其他"],
  ["neuro", "神經精神系統", "腦中風|帕金森氏症|癲癇|失智|憂鬱|思覺失調症|其他"],
  ["musculoskeletal", "肌肉骨骼系統", "退化性關節炎|類風濕性關節炎|骨折|骨質疏鬆|其他"],
  ["endocrine", "內分泌系統", "糖尿病|高尿酸血症|甲狀腺功能亢進|甲狀腺功能低下|其他"],
  ["other", "其他", "惡性腫瘤|皮膚病|其他"],
];
const adl = ["進食", "洗澡", "個人衛生", "穿脫衣服", "排便控制", "排尿控制", "如廁", "移位（輪椅與床位）", "步行", "上下樓梯", "總分"];
const iadl = ["上街購物", "外出活動", "食物烹調", "家務維持", "洗衣服", "使用電話的能力", "服用藥物", "處理財務能力", "總分"];
const comparison = (code: string, labels: string[]) => labels.flatMap((label, i) => [
  t(`${code}.central.${i}`, `${label}－照專評估結果`, { prefillAllowed: true }),
  t(`${code}.center.${i}`, `${label}－中心評估結果`, { prefillAllowed: false }),
]);
const fallFactors = ["年齡大於65歲", "三個月內跌倒經驗", "步態平衡失調", "肢體功能障礙", "認知障礙", "下肢無力或殘障", "頭暈／暈眩", "視力模糊", "睡眠障礙", "診斷腦中風", "服用影響意識活動的藥物", "患有可能影響跌倒之疾病"];
const jointNames = ["頸部", "右腕指", "左腕指", "右手肘", "左手肘", "右肩", "左肩", "右踝", "左踝", "右膝", "左膝", "右髖", "左髖"];
const symptoms = ["幻覺", "妄想", "負性症狀", "冷漠／毫不在意", "自傷及自殺（意念及行為）", "怡然自得／欣快感", "其他精神症狀", "行為恰當但頻率問題", "不適當處理物品／不潔行為", "激動／激躁不安", "口語攻擊", "身體攻擊", "異常動作（重複語言或動作）", "遊走行為", "其他行為症狀"];
export const TAIPEI_B_SECTIONS: TaipeiSection[] = [
  sec("B0", "評估資料", [3], [c("B0.assessment_kind", "評估類別", "初評|複評"), d("B0.assessed_on", "評估日期"), d("B0.review_due", "下次複評日期"), t("B0.reassessment_reason", "重新評估原因"), d("B0.completed_on", "填表日期")], "原表註記每半年一次，若個案狀況明顯改變應重新評估。草稿不代表完成評估或簽署。"),
  sec("B1", "生命徵象", [3], [n("B1.temperature", "體溫（℃）", 25, 45), t("B1.blood_pressure", "血壓（mmHg，收縮／舒張）"), n("B1.pulse", "脈搏（次／分）", 1, 300),
    c("B1.pulse_pattern", "脈搏型態", "規則|不規則|其他"), t("B1.pulse_other", "其他脈搏型態"), n("B1.respiratory_rate", "呼吸（次／分）", 1, 100),
    m("B1.respiration", "呼吸型態", "正常|深|淺|快|慢|端坐"), yes("B1.pain", "疼痛"), t("B1.pain_site", "疼痛部位"), n("B1.pain_score", "疼痛分數（0 無痛至 10 最痛）", 0, 10),
    c("B1.pain_frequency", "疼痛頻率", "持續|規律|一陣一陣"), m("B1.pain_type", "疼痛性質", "無法測知|鈍痛|針刺痛|刀割痛|尖銳痛|壓痛|灼熱痛|絞痛|悶痛|麻痛|痠痛|脹痛|其他"), t("B1.pain_other", "其他疼痛性質"),
    m("B1.expression", "疼痛表達方式", "口述疼痛|臉部表情|語言和發聲|身體移動|人際互動改變|日常生活型態或常規改變|心理狀態改變"),
    m("B1.relief", "止痛方式（記錄既有處置，不形成醫囑）", "熱敷|冷敷|按摩|運動|口服藥|止痛藥膏|酸痛貼布|其他"), t("B1.relief_other", "其他止痛方式"), note("B1")]),
  sec("B2", "視力", [3], ["left", "right"].flatMap((side, i) => [m(`B2.${side}.status`, `${i ? "右" : "左"}眼`, "清晰|模糊|近視|失明|青光眼|老花眼|白內障|手術史|其他"), t(`B2.${side}.details`, "手術史／其他說明")]).concat(note("B2"))),
  sec("B3", "聽力", [3], ["left", "right"].flatMap((side, i) => [m(`B3.${side}.status`, `${i ? "右" : "左"}耳`, "清晰|重聽|失聰|輔助器"), t(`B3.${side}.aid`, "輔助器說明")]).concat(note("B3"))),
  sec("B4", "飲食與營養", [3, 4], [n("B4.height", "身高（cm）", 30, 250), n("B4.weight", "體重（kg）", 1, 500), n("B4.bmi", "BMI（kg/m²，人工核對）", 1, 150),
    m("B4.teeth", "牙齒", "有|無牙|活動假牙|固定假牙"), t("B4.denture", "假牙說明"), c("B4.bite", "咬合", "佳|尚可|差"),
    m("B4.route", "進食途徑／嗆咳", "由口進食|不曾嗆咳|偶嗆咳|水分或流質食物才會嗆咳|其他"), t("B4.route_other", "其他進食途徑"), c("B4.appetite", "食慾", "佳|普通|差"),
    c("B4.texture", "飲食性質", "一般|軟質|特殊飲食"), t("B4.special_diet", "特殊飲食"), t("B4.favorite", "最喜歡的食物"), t("B4.disliked", "最不喜歡的食物"),
    yes("B4.taboo", "飲食禁忌"), t("B4.taboo_details", "禁忌說明"), yes("B4.allergy", "過敏食物"), t("B4.allergy_details", "過敏食物說明"),
    m("B4.vegetarian", "葷素", "葷食|全素食|奶蛋素|早齋|初一十五"), t("B4.vegetarian_details", "早齋等補充說明"), c("B4.drinking", "飲水習慣", "主動|提醒|要求"), ...nutrition, note("B4")]),
  sec("B5", "健康習慣", [4], [c("B5.smoking", "吸菸", "不抽菸|戒菸|吸菸"), n("B5.smoking_quit_years", "戒菸年數", 0, 100), n("B5.packs_per_day", "每天包數", 0, 20),
    c("B5.alcohol", "飲酒", "不喝酒|戒酒|喝酒"), n("B5.alcohol_quit_years", "戒酒年數", 0, 100), c("B5.betelnut", "嚼檳榔", "不嚼檳榔|戒檳榔|嚼檳榔"), n("B5.betelnut_quit_years", "戒檳榔年數", 0, 100), n("B5.betelnuts_per_day", "每天顆數", 0, 1000), note("B5")]),
  sec("B6", "排泄", [4], [m("B6.urination", "排尿", "正常|失禁|偶尿濕|頻尿|少尿|多尿|解尿疼痛|尿滯留解不乾淨"), m("B6.urine_support", "輔助方式", "無|定時提醒協助|紙尿褲|尿管留置|其他"), t("B6.urine_other", "其他輔助方式"),
    n("B6.stool_days", "排便間隔（天）", 0, 60), n("B6.stool_count", "排便次數", 0, 100), c("B6.stool", "排便方式", "自解|失禁|其他"), t("B6.stool_other", "其他排便方式"),
    m("B6.constipation", "便秘處置", "無|口服軟便劑|塞劑|少量灌腸"), t("B6.constipation_details", "便秘處置補充（記錄既有處置，不形成醫囑）"),
    t("B6.oral_laxative", "口服軟便劑名稱"), n("B6.oral_laxative_frequency", "口服軟便劑（次／天）", 0, 100),
    t("B6.suppository", "塞劑名稱"), n("B6.suppository_frequency", "塞劑（次／天）", 0, 100),
    t("B6.enema", "少量灌腸名稱"), n("B6.enema_quantity", "少量灌腸（顆／次）", 0, 100),
    yes("B6.diarrhea", "腹瀉"), t("B6.avoid", "避免的食物或藥物"), note("B6")]),
  sec("B7", "睡眠", [4], [n("B7.hours", "夜間平均睡眠（小時／天）", 0, 24), m("B7.pattern", "睡眠狀況", "失眠|夜裡起床次數多|不易入睡|日夜顛倒|服用助眠藥物|有午睡習慣|其他"), t("B7.other", "其他睡眠狀況"), note("B7")]),
  sec("B8", "呼吸", [4], [c("B8.status", "呼吸", "正常|不正常"), yes("B8.sputum", "痰"), t("B8.sputum_type", "痰性質"), c("B8.sputum_amount", "痰量", "多痰|少痰"), t("B8.amount_details", "痰量說明"), c("B8.cough", "咳痰", "可自咳|需協助"), m("B8.support", "需協助方式", "氧氣|噴霧器|藥物"), t("B8.medication", "藥物（僅記錄來源，不改醫囑）"), note("B8")]),
  sec("B9", "皮膚", [5], [m("B9.skin", "皮膚", "正常|蒼白|乾燥|潮紅|黃疸|紅腫|腫塊|疹子|脫屑|瘀血|水疱|壓傷|其他"), t("B9.other", "其他皮膚狀況"), c("B9.integrity", "完整性", "完整|傷口"), t("B9.wound_site", "傷口部位"), t("B9.wound_size", "傷口大小與單位"), t("B9.wound_grade", "傷口級數"), yes("B9.edema", "水腫"), t("B9.edema_details", "水腫部位及程度"), t("B9.body_diagram_document_id", "人形圖標記文件編號（另行上傳）"), note("B9")]),
  sec("B10", "疾病史", [5], [t("B10.hospital", "就醫醫院"), t("B10.pharmacy_hospital", "領藥醫院"), t("B10.emergency_hospital", "急診醫院"), yes("B10.surgery", "手術史"),
    ...[1, 2].flatMap(i => [t(`B10.surgery.${i}.hospital`, `手術 ${i} 醫院`), t(`B10.surgery.${i}.name`, `手術 ${i} 名稱`)]),
    ...diseaseGroups.flatMap(([key, label, choices]) => [m(`B10.${key}.diseases`, label, choices),
      ...choices.split("|").map((disease, i) => t(`B10.${key}.history.${i}`, `${label}－${disease}罹病時間／治療情形`)),
      t(`B10.${key}.history`, `${label}－補充說明`)]),
    t("B10.cancer", "惡性腫瘤癌別及期別"), yes("B10.medication_allergy", "藥物過敏"), t("B10.medication_allergy_details", "藥物過敏說明"), note("B10")]),
  sec("B11", "活動型態", [6, 7], [...["右上肢", "左上肢", "右下肢", "左下肢"].map((x, i) => c(`B11.muscle.${i}`, `${x}肌力`, "0＝無收縮|1＝微弱收縮無關節活動|2＝僅能平行移動|3＝可對抗重力|4＝可對抗部分阻力|5＝可對抗重力及阻力")),
    ...jointNames.map((x, i) => c(`B11.joint.${i}`, `${x}關節活動度`, i === 0 ? "0＝正常|1＝達功能角度|2＝輕微僵硬|3＝嚴重僵硬" : "0＝正常|1＝達功能角度|2＝輕微攣縮／變形|3＝嚴重攣縮／變形")),
    m("B11.mobility", "活動型態", "自行活動|需扶持|手杖|助行器|輪椅|其他"), t("B11.mobility_other", "其他活動型態"), c("B11.attention", "活動專注力", "無法參加|每次少於15分鐘|每次15至30分鐘|每次超過30分鐘"),
    m("B11.daily_activity", "日常活動量", "無|輕度活動|中度活動"), n("B11.light_minutes", "輕度活動分鐘／天", 0, 1440), n("B11.moderate_minutes", "中度活動分鐘／天", 0, 1440), t("B11.activity_details", "活動量說明"),
    c("B11.sppb.side", "SPPB 並排站立", "1＝保持10秒|0＝少於10秒"), c("B11.sppb.semi", "SPPB 半並排站立", "1＝保持10秒|0＝少於10秒"), c("B11.sppb.tandem", "SPPB 直線站立", "2＝保持10秒|1＝3至9.99秒|0＝少於3秒"),
    n("B11.sppb.walk_seconds", "四公尺步行時間（秒）", 0, 9999), c("B11.sppb.walk", "步行速度分數（人工依原表核對）", "4＝小於4.82秒|3＝4.82至6.20秒|2＝6.21至8.70秒|1＝大於8.70秒|0＝無法完成"),
    n("B11.sppb.chair_seconds", "起立坐下五次時間（秒）", 0, 9999), c("B11.sppb.chair", "椅子起站分數（人工依原表核對）", "4＝小於11.19秒|3＝11.2至13.69秒|2＝13.7至16.69秒|1＝16.7至59.9秒|0＝大於60秒或無法完成"),
    c("B11.sppb.completion", "SPPB 完成狀態", "完成|無法完成"), note("B11")], "原表時間區間有未涵蓋邊界，不猜補時間到分數公式；由評估者選擇原表選項，疑義待主管機關確認。"),
  sec("B12", "跌倒", [7, 8], [yes("B12.history", "過去一年跌倒"), n("B12.count", "跌倒次數", 0, 1000), t("B12.occurred_at", "發生時間"), t("B12.cause", "跌倒原因"), c("B12.location", "跌倒地點", "室內|戶外"), t("B12.location_details", "地點說明"), c("B12.fear", "因害怕跌倒減少活動", "否|是"), yes("B12.injury", "跌倒後傷害"), t("B12.injury_details", "傷害說明"),
    ...fallFactors.map((x, i) => c(`B12.factor.${i + 1}`, `${i + 1}. ${x}`, "是|否")), note("B12")]),
  sec("B13", "ADLs：照專與中心分開記錄", [8], comparison("B13", adl).concat(note("B13")), "CMS 只可提示照專欄，中心評估必須由中心人員實際評估；原表沒有指定各題計分公式，這裡不猜分。"),
  sec("B14", "IADLs：照專與中心分開記錄", [8], comparison("B14", iadl).concat(note("B14")), "缺值與不適用分開，不將照專結果複製成中心評估。"),
  sec("B15", "家庭狀況", [8], [c("B15.interaction", "家人互動", "良好|維持基本互動|孤立|無家人|其他"), t("B15.other", "其他互動"), t("B15.carer_assessment", "家庭照顧者身心狀況、社會資源、照顧功能／能力／準備／負荷"), note("B15")]),
  sec("B16", "社會及長照資源使用", [8], [m("B16.resources", "使用資源", "日間照顧|家庭托顧|居家服務|居家護理|復能服務|喘息服務|交通接送|輔具服務|營養餐飲|住宿式機構服務|失智共照中心或關懷據點|小規模多機能|家庭照顧者支持服務|社區預防照顧|延伸出院準備|居家醫療|預防／延緩失能|其他"), t("B16.other", "其他正式／非正式資源（不啟用本機構住宿功能）"), note("B16")]),
  sec("B17", "社會與心理功能", [8, 9], [c("B17.relationships", "人際關係", "活躍|尚可|被動／習慣依賴人|獨來獨往|抗拒|其他"), t("B17.relationships_other", "人際關係其他"), c("B17.expression", "表達能力", "清楚表達|只能表達簡單語句|不能透過言語溝通|其他"), t("B17.expression_other", "表達能力其他"), c("B17.comprehension", "理解能力", "正常|只能理解簡單句語|缺乏理解能力|其他"), t("B17.comprehension_other", "理解能力其他"), m("B17.psychology", "心理功能", "正常|低自尊／低成就|未能接受現狀|否定自己或生命存在價值|情緒低落／憂鬱|焦慮|其他"), t("B17.psychology_other", "心理功能其他"), note("B17")]),
  sec("B18", "SPMSQ 認知功能量表", [9], [...["今天幾號（年月日）", "今天星期幾", "這是什麼地方", "電話號碼（有電話才問）", "住什麼地方（沒有電話才問）", "幾歲", "出生年月日", "現任總統", "前任總統", "媽媽名字", "20 開始連續減 3"].flatMap((x, i) => [t(`B18.answer.${i}`, x), c(`B18.correct.${i}`, `${x}－判定`, "正確|錯誤")]),
    c("B18.phone_question", "第 4 題適用題目", "4-1電話|4-2住址"), c("B18.education", "教育修正層級（按原表）", "小學|一般（國中）|高中以上"), note("B18")], "4-1／4-2 只能計其中一題。總統等答案由評估者當時核對，不把今日資料寫死。原表未載明不識字者修正规則，請留待確認。"),
  sec("B19", "精神及行為症狀", [9], [yes("B19.psychiatric_present", "精神性症狀"), yes("B19.behavior_present", "行為症狀問題"),
    ...symptoms.flatMap((x, i) => [c(`B19.symptom.${i}.present`, x, "無|有"), c(`B19.symptom.${i}.frequency`, `${x}頻率`, "1＝不曾|2＝每週少於一次|3＝每週1至2次|4＝每週數次|5＝每天1至2次|6＝每天數次|7＝每小時數次"), t(`B19.symptom.${i}.details`, `${x}補充說明`)]), note("B19")]),
];
const problemGroups = [
  ["B1", "生理偵測", "血壓不穩定|疼痛|其他"], ["B4", "飲食與營養", "咀嚼吞嚥能力差|需執行疾病飲食|體重過重或過輕|缺乏營養素|多水或限水|營養篩檢營養不良|其他"],
  ["B6", "排泄訓練", "便秘|腹瀉|失禁|其他"], ["B7", "睡眠", "日夜顛倒|失眠|其他"], ["B8", "呼吸", "痰多|痰不易自咳|其他"],
  ["B9", "皮膚照顧", "傷口|乾燥|皮膚癢或紅疹|營養狀況|皮膚疾病|水腫|其他"], ["B10", "慢病追蹤", "三高|肺結核|B型肝炎|其他"],
  ["B11", "復健與運動", "肌力不足|肢體協調差|活動度不足|關節活動度受限|平衡問題|其他"], ["B12", "跌倒", "跌倒高危險群|其他"],
  ["B17", "社會心理功能", "低自尊低成就|未能接受現狀|否定自己或生命存在價值|情緒低落憂鬱|焦慮|人際互動少|缺乏互動技巧|其他"],
  ["B18", "維持／促進認知功能", "定向感|注意力|計算力|記憶力|口語理解|其他"], ["B19", "情緒及行為", "幻覺|妄想|負性症狀|冷漠|自傷自殺意念|欣快感|不潔行為|激動激躁|口語攻擊|身體攻擊|異常動作|遊走|其他"],
];
TAIPEI_B_SECTIONS.push(sec("B_PROBLEMS", "二、個別化問題清單", [10, 11], [
  ...problemGroups.flatMap(([code, label, options]) => [m(`B_PROBLEMS.${code}.needs`, `${code} ${label}－問題／需求`, options),
    t(`B_PROBLEMS.${code}.details`, `${code} 問題補充`), t(`B_PROBLEMS.${code}.precautions`, `${code} 照顧注意事項`)]),
  t("B_PROBLEMS.other.needs", "其他問題／需求"), t("B_PROBLEMS.other.precautions", "其他照顧注意事項"),
], "問題與注意事項須人工評估核对，保存草稿不會自動發布為正式照顧決策。"));
TAIPEI_B_SECTIONS.push(sec("B_PLAN", "三、個別化照顧計畫", [12], [1, 2, 3, 4].flatMap(i => [
  t(`B_PLAN.${i}.problem`, `項次 ${i}－照顧問題／診斷／確立（人工依有效來源）`), t(`B_PLAN.${i}.cause`, "導因"), t(`B_PLAN.${i}.goal`, "目標"),
  t(`B_PLAN.${i}.strategy`, "照顧計畫／策略"), t(`B_PLAN.${i}.executor`, "執行者（文字不是本人簽署）"),
  m(`B_PLAN.${i}.evaluation`, "評值結果", "目標持續|改善程度|無變化|目標已達成|目標部分達成|修正目標|增加策略"), t(`B_PLAN.${i}.evaluation_details`, "改善程度／修正目標／增加策略說明"),
])));
export const TAIPEI_C_SECTIONS: TaipeiSection[] = [
  sec("C1", "生命徵象", [13], [t("C1.notes", "備註（例如左／右手禁測量）")], "日期、星期、量測時間、體溫、脈搏、呼吸、血壓、紀錄者與體重只取當月實際量測，不從 CMS 或到站排程生成。"),
  sec("C2", "照顧計畫執行狀況", [14], [t("C2.review_notes", "來源核對備註（不是執行證明）")], "只引用當月已签署的本中心照顧紀錄；未執行或未簽署不算完成。"),
  sec("C3", "照顧摘要", [14], [t("C3.review_notes", "活動參與度／同儕互動來源核對備註（不是執行證明）")], "摘要以當月已簽署照顧紀錄為依據；缺少活動或互動內容即顯示待補原始紀錄。"),
];
// Exact basic-profile suggestions only. No central source may prefill a center
// assessment, execution, signature, identity image or clinical decision.
const basicProfilePrefill = new Set(["A0.case_number", "A1.name", "A4.sex", "A6.birth_date", "A7.home", "A11.address", "A12.address", "A10.cms_level",
  ...[1, 2, 3].flatMap(i => ["name", "relationship", "address", "phone"].map(k => `A21.${i}.${k}`))]);
for (const section of TAIPEI_A_SECTIONS) for (const field of section.fields) if (basicProfilePrefill.has(field.key)) field.prefillAllowed = true;
export const TAIPEI_SECTIONS: Record<TaipeiForm, TaipeiSection[]> = { A: TAIPEI_A_SECTIONS, B: TAIPEI_B_SECTIONS, C: TAIPEI_C_SECTIONS };
export function taipeiFields(form: TaipeiForm): TaipeiField[] { return TAIPEI_SECTIONS[form].flatMap(s => s.fields); }
