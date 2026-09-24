import { taipeiFields, type TaipeiForm } from "./catalog";
import type { TaipeiAnswers } from "./types";
export function taipeiProgress(form: TaipeiForm, answers: TaipeiAnswers) {
  const fields = taipeiFields(form); let recorded = 0; let notApplicable = 0; let unconfirmed = 0;
  for (const field of fields) { const state = answers[field.key]?.state; if (state === "recorded") recorded++; if (state === "not_applicable") notApplicable++; if (state === "unconfirmed") unconfirmed++; }
  return { total: fields.length, recorded, notApplicable, unconfirmed, missing: fields.length - recorded - notApplicable - unconfirmed, formallyComplete: false as const };
}
/** Informational draft totals only: no diagnosis, signatures or care-decision writes. */
export function taipeiDraftTotals(answers: TaipeiAnswers) {
  const selectedScore = (key: string) => { const a = answers[key]; return a?.state === "recorded" && typeof a.value === "string" && /^\d＝/u.test(a.value) ? Number(a.value[0]) : null; };
  const sum = (keys: string[]) => { const values = keys.map(selectedScore); return values.some(v => v === null) ? null : values.reduce<number>((a, b) => a + (b ?? 0), 0); };
  const nutrition = sum(["intake", "weight", "mobility", "stress", "neuro", "bmi"].map(k => `B4.nutrition.${k}`));
  const sppb = sum(["side", "semi", "tandem", "walk", "chair"].map(k => `B11.sppb.${k}`));
  const falls = Array.from({ length: 12 }, (_, i) => answers[`B12.factor.${i + 1}`]);
  const fallFactors = falls.some(a => a?.state !== "recorded" || !["是", "否"].includes(String(a.value))) ? null : falls.filter(a => a.value === "是").length;
  const phone = answers["B18.phone_question"]; const question = phone?.state === "recorded" ? phone.value : null;
  const indexes = question === "4-1電話" ? [0, 1, 2, 3, 5, 6, 7, 8, 9, 10] : question === "4-2住址" ? [0, 1, 2, 4, 5, 6, 7, 8, 9, 10] : [];
  const cognition = indexes.map(i => answers[`B18.correct.${i}`]);
  const spmsqErrors = cognition.length !== 10 || cognition.some(a => a?.state !== "recorded" || !["正確", "錯誤"].includes(String(a.value))) ? null : cognition.filter(a => a.value === "錯誤").length;
  return { nutrition, sppb, fallFactors, spmsqErrors, clinicalClassification: null };
}
