import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUESTIONNAIRE_FORMS } from "./forms";
import { parseQuestionnaireMutation } from "./mutation-contract";
import type { QuestionnaireFormKey } from "./types";

const clientId = "3000000a-0000-4000-8000-000000000001";
const assessmentKey = "4000000b-0000-4000-8000-000000000001";
const previousVersionId = "5000000c-0000-4000-8000-000000000001";
const key = "6000000d-0000-4000-8000-000000000001";
const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
function body(formKey: QuestionnaireFormKey = "spmsq") {
  const form = QUESTIONNAIRE_FORMS[formKey];
  const answers: Record<string, { state: string; value?: string }> = Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }]));
  return { action: "create", clientId, formKey, formVersion: form.version, assessedOn: "2026-09-25",
    answers, context: {} };
}
function revised() { return { ...body(), action: "revise", assessmentKey, previousVersionId, expectedVersion: 7 }; }

describe("mechanically extracted original questionnaire POST preprocessing", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-27T00:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it.each(keys)("keeps all %s missing answers and unsigned create shape", (formKey) => {
    const input = body(formKey), before = JSON.stringify(input), output = parseQuestionnaireMutation(input, key)!;
    expect(output).toEqual({ action: "create", client_id: clientId, form_key: formKey, form_version: input.formVersion,
      assessed_on: input.assessedOn, answers: input.answers, context: {}, idempotencyKey: key });
    expect(JSON.stringify(input)).toBe(before); expect(output).not.toHaveProperty("assessment_key");
  });
  it.each(keys)("accepts the registered %s choices without clinical completion requirements", (formKey) => {
    const input = body(formKey), form = QUESTIONNAIRE_FORMS[formKey];
    for (const question of form.questions) {
      if (formKey !== "mna_sf" || question.id !== "anthropometry") input.answers[question.id] = { state: "answered", value: question.choices[0]!.value };
    }
    expect(parseQuestionnaireMutation(input, key)?.answers).toEqual(input.answers);
  });
  it("normalizes all request UUIDs but keeps the caller-owned key unchanged", () => {
    expect(parseQuestionnaireMutation({ ...revised(), clientId: clientId.toUpperCase(), assessmentKey: assessmentKey.toUpperCase(),
      previousVersionId: previousVersionId.toUpperCase() }, key.toUpperCase())).toMatchObject({
      client_id: clientId, assessment_key: assessmentKey, previous_version_id: previousVersionId, expected_version: 7, idempotencyKey: key.toUpperCase() });
  });
  it("defaults omitted context and does not manufacture required education", () => {
    const input: Record<string, unknown> = body(); delete input.context;
    expect(parseQuestionnaireMutation(input, key)?.context).toEqual({});
    expect(parseQuestionnaireMutation({ ...body(), context: { education_adjustment: "" } }, key)?.context).toEqual({});
  });
  it.each(["2000-01-01", "2000-02-29", "2024-02-29", "2026-09-27"])("accepts original valid date %s", (assessedOn) => {
    expect(parseQuestionnaireMutation({ ...body(), assessedOn }, key)?.assessed_on).toBe(assessedOn);
  });
  it.each(["1999-12-31", "2026-09-28", "2026-02-29", "2026-02-30", "2024-04-31", "2026-9-25", "2026-13-01", ""])("rejects original invalid date %s", (assessedOn) => {
    expect(parseQuestionnaireMutation({ ...body(), assessedOn }, key)).toBeNull();
  });
  it("uses Taipei date at the UTC date boundary", () => {
    vi.setSystemTime(new Date("2026-09-26T16:00:00Z"));
    expect(parseQuestionnaireMutation({ ...body(), assessedOn: "2026-09-27" }, key)).not.toBeNull();
  });
  it.each([0, -1, 1.2, 1_000_001, "7", null])("keeps expected revision limit %s", (expectedVersion) => {
    expect(parseQuestionnaireMutation({ ...revised(), expectedVersion }, key)).toBeNull();
  });
  it.each([1, 1_000_000])("accepts original revision boundary %s", (expectedVersion) => {
    expect(parseQuestionnaireMutation({ ...revised(), expectedVersion }, key)?.expected_version).toBe(expectedVersion);
  });
  it.each([null, [], "body", 1, {}, { ...body(), extra: true }, { ...body(), assessmentKey },
    { ...body(), clientId: "not-a-uuid" }, { ...body(), formKey: "__proto__" }, { ...body(), formVersion: "other" }])("rejects malformed or extraneous original request %#", (input) => {
    expect(parseQuestionnaireMutation(input, key)).toBeNull();
  });
  it.each(keys)("rejects missing/extra/invalid answer structure on %s", (formKey) => {
    const input = body(formKey), first = QUESTIONNAIRE_FORMS[formKey].questions[0]!.id;
    const missing = { ...input.answers }; delete missing[first];
    for (const answers of [missing, { ...input.answers, extra: { state: "missing" } },
      { ...input.answers, [first]: { state: "answered", value: "forged" } },
      { ...input.answers, [first]: { state: "missing", value: "yes" } },
      { ...input.answers, [first]: { state: "answered", value: 0 } }, { ...input.answers, [first]: null }]) {
      expect(parseQuestionnaireMutation({ ...input, answers }, key)).toBeNull();
    }
  });
  it.each(["barthel_adl", "lawton_iadl"] as const)("retains original ADL-only N-A trim and no added 500 limit on %s", (formKey) => {
    const input = body(formKey), first = QUESTIONNAIRE_FORMS[formKey].questions[0]!.id;
    for (const reason of ["  不適用 \n", "x".repeat(501), "\u0085原因"]) {
      const result = parseQuestionnaireMutation({ ...input, answers: { ...input.answers, [first]: { state: "not_applicable", reason } } }, key);
      expect(result?.answers[first]).toEqual({ state: "not_applicable", reason: reason.trim() });
    }
    expect(parseQuestionnaireMutation({ ...input, answers: { ...input.answers, [first]: { state: "not_applicable", reason: "  " } } }, key)).toBeNull();
  });
  it.each(keys.filter((item) => !["barthel_adl", "lawton_iadl"].includes(item)))("rejects N-A on %s as before", (formKey) => {
    const input = body(formKey), first = QUESTIONNAIRE_FORMS[formKey].questions[0]!.id;
    expect(parseQuestionnaireMutation({ ...input, answers: { ...input.answers, [first]: { state: "not_applicable", reason: "原因" } } }, key)).toBeNull();
  });
  it("keeps JS note trim/blank omission and C1 acceptance", () => {
    for (const [raw, result] of [["  筆記\n", "筆記"], [" \t\n", undefined], ["\u0085筆記", "\u0085筆記"]]) {
      expect(parseQuestionnaireMutation({ ...body(), context: { qualitative_note: raw } }, key)?.context.qualitative_note).toBe(result);
    }
  });
  it.each(["a".repeat(3001), " ".repeat(3000) + "a", "😀".repeat(1501), "x\u0000", "x\u000b", "x\u007f"])("keeps note raw length/control limit %#", (qualitative_note) => {
    expect(parseQuestionnaireMutation({ ...body(), context: { qualitative_note } }, key)).toBeNull();
  });
  it("accepts note raw code-unit boundary", () => {
    expect(parseQuestionnaireMutation({ ...body(), context: { qualitative_note: "😀".repeat(1500) } }, key)?.context.qualitative_note.length).toBe(3000);
  });
  it.each([{ unknown: "a" }, { qualitative_note: 1 }, { education_adjustment: "invalid" }, { education_adjustment: " grade_school_or_less " }])("rejects unrecognized context %#", (context) => {
    expect(parseQuestionnaireMutation({ ...body(), context }, key)).toBeNull();
  });
  it.each(["050", "050.0", "240"])("retains original MNA numeric spelling %j with missing F answer", (height_cm) => {
    expect(parseQuestionnaireMutation({ ...body("mna_sf"), context: { height_cm } }, key)?.context.height_cm).toBe(height_cm);
  });
  it.each(["49.9", "240.1", " 150", "150 ", "150\n", "150.00", "1e2", "", "NaN"])("rejects original MNA height syntax/range %j", (height_cm) => {
    expect(parseQuestionnaireMutation({ ...body("mna_sf"), context: { height_cm } }, key)).toBeNull();
  });
  it("keeps MNA branch measurement validation", () => {
    const input = body("mna_sf"), answers = { ...input.answers, anthropometry: { state: "answered", value: "calf_gte_31" } };
    expect(parseQuestionnaireMutation({ ...input, answers, context: { calf_circumference_cm: "31" } }, key)).not.toBeNull();
    for (const context of [{}, { calf_circumference_cm: "30" }, { calf_circumference_cm: "31", height_cm: "150" }]) {
      expect(parseQuestionnaireMutation({ ...input, answers, context }, key)).toBeNull();
    }
  });
});
