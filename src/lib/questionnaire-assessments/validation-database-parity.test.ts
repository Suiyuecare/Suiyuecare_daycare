import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireRuleCatalogEntry } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCandidate } from "./validation-evaluator";

const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
type Case = { id: string; answers: unknown; context: unknown };

function base(key: QuestionnaireFormKey) {
  const answers: Record<string, unknown> = Object.fromEntries(QUESTIONNAIRE_FORMS[key].questions.map(({ id, choices }) =>
    [id, { state: "answered", value: choices[0]!.value }]));
  const context: Record<string, unknown> = key === "spmsq" ? { education_adjustment: "middle_or_high_school" }
    : key === "mna_sf" ? { height_cm: "200", weight_kg: "70" } : {};
  return { answers, context };
}

// Execute exactly the latest production pure validators, not a rewritten SQL
// mirror, fake authority function, RPC, or hosted schema. Extraction must be
// unique and fail closed if the checked-in function layout changes.
function validatorSql(name: "questionnaire_answers_valid" | "questionnaire_context_valid") {
  const migration = readFileSync("supabase/migrations/20260926041116_questionnaire_admission_json_hardening.sql", "utf8");
  const functions = [...migration.matchAll(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "gu"))];
  expect(functions).toHaveLength(1);
  const sql = functions[0]![0];
  expect(sql).toMatch(/immutable security invoker/u);
  expect(sql).not.toMatch(/auth\.|security definer|public\./u);
  return sql;
}

describe("candidate database draft-wire parity with exact PostgreSQL JSON validators", () => {
  let database: PGlite;
  let comparedRows = 0;
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`create schema private;\n${validatorSql("questionnaire_answers_valid")}\n${validatorSql("questionnaire_context_valid")}`);
  }, 30_000);
  afterAll(async () => {
    await database?.close();
    expect(comparedRows).toBe(3224);
  });

  async function parity(key: QuestionnaireFormKey, cases: readonly Case[]) {
    const { rows } = await database.query<{ id: string; valid: boolean }>(`
      select item->>'id' as id,
        private.questionnaire_answers_valid($1, item->'answers') is true
        and private.questionnaire_context_valid($1, item->'answers', item->'context') is true as valid
      from jsonb_array_elements($2::jsonb) with ordinality as cases(item,position) order by position`,
    [key, JSON.stringify(cases)]);
    expect(rows).toHaveLength(cases.length);
    const validation = buildQuestionnaireValidationCatalogEntry(key);
    const scoring = buildQuestionnaireRuleCatalogEntry(key);
    for (const [index, row] of rows.entries()) {
      const fixture = cases[index]!;
      expect(row.id).toBe(fixture.id);
      const actual = evaluateQuestionnaireValidationCandidate(validation, scoring, fixture.answers, fixture.context);
      expect(actual.storageValid, `${key}: ${fixture.id}`).toBe(row.valid);
      comparedRows += 1;
      expect(actual.candidateOnly).toBe(true);
      if (!row.valid) { expect(actual.score).toBeNull(); expect(actual.classification).toBeNull(); }
    }
  }

  it.each(keys)("matches every registered %s choice and malformed state boundary", async (key) => {
    const { answers, context } = base(key);
    const cases: Case[] = [{ id: "complete baseline", answers, context }];
    for (const { id, choices } of QUESTIONNAIRE_FORMS[key].questions) {
      for (const { value } of choices) cases.push({ id: `${id}: registered ${value}`, answers: { ...answers, [id]: { state: "answered", value } },
        context: key === "mna_sf" && id === "anthropometry" ? value === "calf_lt_31" ? { calf_circumference_cm: "30.9" }
          : value === "calf_gte_31" ? { calf_circumference_cm: "31" }
          : { height_cm: "200", weight_kg: value === "bmi_lt_19" ? "70" : value === "bmi_19_lt_21" ? "76" : value === "bmi_21_lt_23" ? "84" : "92" } : context });
      const absent = { ...answers }; delete absent[id];
      cases.push({ id: `${id}: absent`, answers: absent, context });
      for (const [name, value] of Object.entries({ missing: { state: "missing" }, null: null, array: [], primitive: true,
        unknownState: { state: "bad" }, numericState: { state: 1 }, missingValue: { state: "answered" },
        numericValue: { state: "answered", value: 0 }, booleanValue: { state: "answered", value: false },
        unknownValue: { state: "answered", value: "unregistered" }, extraMissing: { state: "missing", reason: "extra" },
        extraAnswered: { state: "answered", value: choices[0]!.value, reason: "extra" },
        na: { state: "not_applicable", reason: "合成原因" }, naNoReason: { state: "not_applicable" },
        naNumericReason: { state: "not_applicable", reason: 1 }, naExtra: { state: "not_applicable", reason: "合成原因", value: "extra" } })) {
        cases.push({ id: `${id}: ${name}`, answers: { ...answers, [id]: value }, context });
      }
    }
    for (const value of [null, [], true, 1, "invalid"]) {
      cases.push({ id: `root answers ${JSON.stringify(value)}`, answers: value, context });
      cases.push({ id: `root context ${JSON.stringify(value)}`, answers, context: value });
    }
    cases.push({ id: "unknown answer", answers: { ...answers, synthetic_unknown: { state: "missing" } }, context });
    cases.push({ id: "unknown context", answers, context: { ...context, synthetic_unknown: "unregistered" } });
    await parity(key, cases);
  });

  it.each(keys)("matches %s reason code-point/ASCII-trim/control-class and qualitative text boundaries", async (key) => {
    const { answers, context } = base(key); const id = QUESTIONNAIRE_FORMS[key].questions[0]!.id;
    const cases: Case[] = [];
    const reasons = ["", "x", "合成原因", "x".repeat(500), "x".repeat(501), "😀".repeat(500), "😀".repeat(501),
      " leading", "trailing ", " ", "x y", "\t", "\n", "\r", "\t中文\n", "\u00a0", "\u3000", "\u200b",
      "x\u0001y", "x\u0008y", "x\u000by", "x\u000cy", "x\u001fy", "x\u007fy", "x\u0085y", "x\u009fy"];
    for (const [index, reason] of reasons.entries()) {
      cases.push({ id: `N/A reason ${index}`, answers: { ...answers, [id]: { state: "not_applicable", reason } }, context });
      cases.push({ id: `qualitative text ${index}`, answers, context: { ...context, qualitative_note: reason } });
    }
    for (const [index, note] of ["x".repeat(3000), "x".repeat(3001), "😀".repeat(3000), "😀".repeat(3001), 1, false, null, [], {}].entries()) {
      cases.push({ id: `qualitative max/typed ${index}`, answers, context: { ...context, qualitative_note: note } });
    }
    await parity(key, cases);
  });

  it("matches SPMSQ absent/empty/registered and malformed education contexts", async () => {
    const { answers } = base("spmsq");
    await parity("spmsq", [{ id: "absent education", answers, context: {} },
      ...["", "unknown", "grade_school_or_less", "middle_or_high_school", "beyond_high_school", null, false, 1, [], {}]
        .map((education_adjustment, index) => ({ id: `education ${index}`, answers, context: { education_adjustment } }))]);
  });

  it("matches MNA physical range/precision grammar even when anthropometry is unanswered", async () => {
    const { answers } = base("mna_sf"); const missing = { ...answers, anthropometry: { state: "missing" } };
    const cases: Case[] = [];
    for (const [field, min, max] of [["height_cm", 50, 240], ["weight_kg", 20, 300], ["calf_circumference_cm", 10, 80]] as const) {
      for (const value of [String(min), `${min}.0`, String(max), `${max}.0`, String(min - 0.1), String(max + 0.1), "",
        "1e2", "+50", "-50", "50.00", "50.", ".5", "050", "0050", " 50", "50 ", "50\n", "５０", "NaN", "Infinity", 50, null, false]) {
        cases.push({ id: `${field}=${JSON.stringify(value)}`, answers: missing, context: { [field]: value } });
      }
    }
    await parity("mna_sf", cases);
  });

  it("matches MNA exact BMI and calf bands with no division/display rounding", async () => {
    const { answers } = base("mna_sf"); const cases: Case[] = [];
    const bmiValues = ["bmi_lt_19", "bmi_19_lt_21", "bmi_21_lt_23", "bmi_gte_23"];
    for (const value of bmiValues) {
      for (const height_cm of ["100", "120", "150", "160", "170", "180", "200", "220", "240", "169.9", "170.1"]) {
        for (const weight_kg of ["20", "30", "48", "50", "60", "70", "75.9", "76", "76.1", "83.9", "84", "84.1", "91.9", "92", "92.1", "300"]) {
          cases.push({ id: `${value} H${height_cm} W${weight_kg}`, answers: { ...answers, anthropometry: { state: "answered", value } }, context: { height_cm, weight_kg } });
        }
      }
      for (const [index, context] of [{}, { height_cm: "200" }, { weight_kg: "76" },
        { height_cm: "200", weight_kg: "76", calf_circumference_cm: "31" }].entries()) {
        cases.push({ id: `${value}: missing/conflict ${index}`, answers: { ...answers, anthropometry: { state: "answered", value } }, context });
      }
    }
    for (const value of ["calf_lt_31", "calf_gte_31"]) {
      for (const calf_circumference_cm of ["10", "30.9", "31", "31.0", "31.1", "80"]) {
        cases.push({ id: `${value} C${calf_circumference_cm}`, answers: { ...answers, anthropometry: { state: "answered", value } }, context: { calf_circumference_cm } });
      }
      for (const [index, context] of [{}, { calf_circumference_cm: "31", height_cm: "200" },
        { calf_circumference_cm: "31", weight_kg: "76" }, { calf_circumference_cm: "31", height_cm: "200", weight_kg: "76" }].entries()) {
        cases.push({ id: `${value}: missing/conflict ${index}`, answers: { ...answers, anthropometry: { state: "answered", value } }, context });
      }
    }
    await parity("mna_sf", cases);
  });
});
