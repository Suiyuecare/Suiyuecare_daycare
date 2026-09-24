import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TAIPEI_ABCD_TEMPLATE, TAIPEI_SECTIONS, taipeiFields } from "./catalog";
import { parseTaipeiAnswers, parseTaipeiIdentity, parseTaipeiMutation } from "./parser";
import { taipeiDraftTotals, taipeiProgress } from "./progress";
import type { TaipeiAnswers } from "./types";
import { profileToTaipeiPrefill } from "./prefill";
const key = "aa010000-0000-4000-8000-000000000001";
const recorded = (value: string | number | string[]) => ({ state: "recorded" as const, value, reason: null });
const input = { client_id: key, form: "A", usage_year: 115, month: 0,
  template_key: TAIPEI_ABCD_TEMPLATE.key, source_revision: "114.11", source_sha256: TAIPEI_ABCD_TEMPLATE.sourceSha256,
  expected_version: 0, expected_content_hash: null, answers: { "A1.name": recorded("合成個案") }, idempotency_key: key };
describe("Taipei official-source draft input", () => {
  it("locks every A1–A24 and B1–B19 plus problem/plan and C1–C3 section", () => {
    for (let i = 1; i <= 24; i++) expect(TAIPEI_SECTIONS.A.some(s => s.code === `A${i}`)).toBe(true);
    for (let i = 1; i <= 19; i++) expect(TAIPEI_SECTIONS.B.some(s => s.code === `B${i}`)).toBe(true);
    expect(TAIPEI_SECTIONS.B.map(s => s.code)).toContain("B_PROBLEMS"); expect(TAIPEI_SECTIONS.B.map(s => s.code)).toContain("B_PLAN");
    expect(TAIPEI_SECTIONS.C.map(s => s.code)).toEqual(["C1", "C2", "C3"]);
    const keys = Object.values(TAIPEI_SECTIONS).flatMap(s => s.flatMap(x => x.fields.map(f => f.key)));
    expect(new Set(keys).size).toBe(keys.length); expect(keys.length).toBeGreaterThan(400);
  });
  it("database and application lock identical field kinds/options/bounds", () => {
    const sql = readFileSync("supabase/migrations/20260913175206_taipei_abcd_intake_drafts.sql", "utf8");
    const match = sql.match(/select '(\{"A":.+\})'::jsonb;/u); expect(match).not.toBeNull();
    const spec = JSON.parse(match![1].replaceAll("''", "'"));
    for (const form of ["A", "B", "C"] as const) expect(spec[form]).toEqual(Object.fromEntries(taipeiFields(form).map(f => [f.key,
      { kind: f.kind, options: f.options ?? null, min: f.min ?? null, max: f.max ?? null, prefillAllowed: f.prefillAllowed ?? false }])));
    expect(sql.trim()).toMatch(/commit;$/u); expect(sql).not.toMatch(/insert into public\.form_versions/iu);
  });
  it("accepts versioned draft with idempotency binding", () => expect(parseTaipeiMutation(input, key)).toEqual(input));
  it.each([{ form: "D" }, { usage_year: 114 }, { source_revision: "115.01" }, { source_sha256: "a".repeat(64) }, { template_key: "official.published" },
    { signed_by: key }, { expected_version: 1 }, { month: 1 }, { expected_version: -1 }, { idempotency_key: "bad" }])("rejects wrong identity/version or extra key %j", extra => expect(() => parseTaipeiMutation({ ...input, ...extra }, key)).toThrow());
  it("requires exact idempotency header", () => expect(() => parseTaipeiMutation(input, "bb010000-0000-4000-8000-000000000001")).toThrow());
  it.each(["client=bad&form=A&year=115&month=0", `client=${key}&form=A&year=115&month=0&client=${key}`, `client=${key}&form=C&year=115&month=0`, `client=${key}&form=C&year=115&month=13`, `client=${key}&form=C&year=115&month=1&signed=true`])("strict read identity %s", query => expect(() => parseTaipeiIdentity(new URLSearchParams(query))).toThrow());
  it("separates missing and NA, requires reason, never coerces zero", () => {
    expect(parseTaipeiAnswers("B", { "B1.pain_score": recorded(0) })["B1.pain_score"].value).toBe(0);
    expect(parseTaipeiAnswers("B", { "B1.pain_score": { state: "missing", value: null, reason: null } })["B1.pain_score"].value).toBeNull();
    expect(() => parseTaipeiAnswers("B", { "B1.pain_score": { state: "not_applicable", value: null, reason: null } })).toThrow();
  });
  it.each([recorded(11), recorded("5"), recorded(-1), recorded(Number.NaN), recorded(Number.POSITIVE_INFINITY)])("rejects invalid pain value %j", answer => expect(() => parseTaipeiAnswers("B", { "B1.pain_score": answer })).toThrow());
  it("validates enums/multiselect/date and forbids raw derived C values", () => {
    expect(() => parseTaipeiAnswers("A", { "A4.sex": recorded("arbitrary") })).toThrow();
    expect(() => parseTaipeiAnswers("A", { "A8.status": recorded(["一般戶", "一般戶"]) })).toThrow();
    expect(() => parseTaipeiAnswers("A", { "A6.birth_date": recorded("2026-02-30") })).toThrow();
    expect(() => parseTaipeiAnswers("C", { "C1.temperature": recorded(36.5) })).toThrow();
    expect(() => parseTaipeiAnswers("B", { "B13.center.0": { state: "unconfirmed", value: "10", reason: null } })).toThrow();
    expect(parseTaipeiAnswers("B", { "B13.central.0": { state: "unconfirmed", value: "10", reason: null } })["B13.central.0"].state).toBe("unconfirmed");
  });
  it("draft completion and missing totals never imply formal approval", () => {
    expect(taipeiProgress("A", {})).toMatchObject({ formallyComplete: false, recorded: 0 });
    expect(taipeiDraftTotals({})).toEqual({ nutrition: null, sppb: null, fallFactors: null, spmsqErrors: null, clinicalClassification: null });
  });
  it("sums only fully confirmed nutrition responses and fall factors", () => {
    const answers: TaipeiAnswers = Object.fromEntries(["intake", "weight", "mobility", "stress", "neuro", "bmi"].map((k, i) => [`B4.nutrition.${k}`, recorded(`${[2, 3, 2, 2, 2, 3][i]}＝test`)]));
    for (let i = 1; i <= 12; i++) answers[`B12.factor.${i}`] = recorded(i < 4 ? "是" : "否");
    expect(taipeiDraftTotals(answers)).toMatchObject({ nutrition: 14, fallFactors: 3 });
    answers["B4.nutrition.intake"] = { state: "not_applicable", value: null, reason: "尚未確認" };
    expect(taipeiDraftTotals(answers).nutrition).toBeNull();
  });
  it("SPMSQ counts only one of phone/residence alternative", () => {
    const answers: TaipeiAnswers = { "B18.phone_question": recorded("4-1電話") };
    for (let i = 0; i <= 10; i++) answers[`B18.correct.${i}`] = recorded(i === 4 ? "錯誤" : "正確");
    expect(taipeiDraftTotals(answers).spmsqErrors).toBe(0);
    answers["B18.phone_question"] = recorded("4-2住址"); expect(taipeiDraftTotals(answers).spmsqErrors).toBe(1);
  });
  it("maps saved profile only to semantically matching unconfirmed A fields", () => {
    const hints = profileToTaipeiPrefill({ displayName: "合成姓名", clientCode: "SYN-001", dateOfBirth: "1940-01-01", sex: "male", phone: "", registeredAddress: null,
      residentialAddress: null, cmsLevel: 4, contacts: [{ name: "合成關係人", relationship: "親友", phone: "0000000000", address: "", isPrimary: true, isEmergency: true }] });
    expect(hints.find(h => h.fieldKey === "A4.sex")?.value).toBe("男"); expect(hints.find(h => h.fieldKey === "A6.birth_date")?.value).toBe("1940-01-01");
    expect(hints.some(h => /A3\.|primary_carer|B13\.center/u.test(h.fieldKey))).toBe(false);
    for (const hint of hints) expect(() => parseTaipeiAnswers("A", { [hint.fieldKey]: { state: "unconfirmed", value: hint.value, reason: null } })).not.toThrow();
    const pending = Object.fromEntries(hints.map(h => [h.fieldKey, { state: "unconfirmed" as const, value: h.value, reason: null }]));
    expect(taipeiProgress("A", pending)).toMatchObject({ recorded: 0, unconfirmed: hints.length, formallyComplete: false });
  });
});
