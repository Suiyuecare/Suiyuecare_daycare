import { describe, expect, it } from "vitest";

import { buildDemoAbcdAssessmentSnapshot } from "./demo";
import { parseAbcdAssessmentMutation, parseAbcdAssessmentReceipt } from "./parser";
import { projectAbcdAssessmentSnapshot } from "./projection";
import { emptyAbcdAssessmentFilters, parseAbcdAssessmentFilters } from "./query";

const org = "21110000-0000-4000-8000-000000000001";
const branch = "21120000-0000-4000-8000-000000000001";
const client = "21130000-0000-4000-8000-000000000001";
const user = "21140000-0000-4000-8000-000000000001";
const challenge = "21150000-0000-4000-8000-000000000001";
const idempotency = "21160000-0000-4000-8000-000000000001";
const assessmentKey = "21170000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const filters = emptyAbcdAssessmentFilters();

function row(input: { suffix?: number; type?: "A" | "B" | "C" | "D"; year?: number;
  date?: string; state?: "draft" | "signed" } = {}) {
  const suffix = input.suffix ?? 1; const type = input.type ?? "A";
  const year = input.year ?? 2026; const state = input.state ?? "draft";
  const tail = String(suffix).padStart(12, "0");
  const id1 = `21180000-0000-4000-8000-${tail}`;
  const id2 = `21190000-0000-4000-8000-${tail}`;
  const key = `21170000-0000-4000-8000-${tail}`;
  const common = { assessment_key: key, client_id: client, client_display_name: "合成個案",
    assessment_type: type, assessment_year: year, assessment_date: input.date ?? `${year}-09-01`,
    manual_summary: "人工非標準化候選摘要", result_state: "recorded", result_text: "人工候選結果",
    result_reason: null, reassessment_state: "recorded", reassessment_date: `${year}-12-01`,
    reassessment_basis: "人工指定複評依據", author_user_id: user, author_display_name: "合成評估員",
    form_kind: "manual_unstandardized", formal_rule_status: "not_configured" };
  const draft = { ...common, version_id: id1, version: 1, previous_version_id: null,
    content_hash: String((suffix % 8) + 1).repeat(64), assessment_state: "draft", revision_reason: "建立候選初稿",
    correction_reason: null, signed_at: null, signed_by_user_id: null, signer_display_name: null,
    signer_role_keys: null, signature_purpose: null, signature_reauth_challenge_id: null,
    created_at: "2026-09-07T03:00:00Z" };
  if (state === "draft") return { ...draft, history: [draft], history_total: 1 };
  const signed = { ...common, version_id: id2, version: 2, previous_version_id: id1,
    content_hash: String((suffix % 7) + 2).repeat(64), assessment_state: "signed", revision_reason: null,
    correction_reason: null, signed_at: "2026-09-07T03:10:00Z", signed_by_user_id: user,
    signer_display_name: "合成簽署員", signer_role_keys: ["professional"],
    signature_purpose: "ABCD 人工候選評估簽署", signature_reauth_challenge_id: challenge,
    created_at: "2026-09-07T03:10:00Z" };
  return { ...signed, history: [draft, signed], history_total: 2 };
}

function source(assessments = [row()]) {
  return { organization_id: org, branch_id: branch, generated_at: "2026-09-07T03:00:00Z",
    assessments, matching_total: assessments.length, assessments_truncated: false,
    assessment_total: assessments.length,
    a_total: assessments.filter((item) => item.assessment_type === "A").length,
    b_total: assessments.filter((item) => item.assessment_type === "B").length,
    c_total: assessments.filter((item) => item.assessment_type === "C").length,
    d_total: assessments.filter((item) => item.assessment_type === "D").length,
    reassessment_missing_total: assessments.filter((item) => item.reassessment_state === "missing").length,
    draft_total: assessments.filter((item) => item.assessment_state === "draft").length,
    signed_total: assessments.filter((item) => item.assessment_state !== "draft").length,
    clients: [{ client_id: client, display_name: "合成個案" }], client_total: 1,
    clients_truncated: false, years: [...new Set(assessments.map((item) => item.assessment_year))]
      .sort((a, b) => b - a), year_total: new Set(assessments.map((item) => item.assessment_year)).size,
    years_truncated: false, form_kind: "manual_unstandardized", formal_rule_status: "not_configured",
    attachment_status: "not_configured", notification_status: "not_configured",
    export_status: "not_configured", offline_status: "not_configured" };
}

const createBody = { action: "save_assessment", mode: "create", assessment_key: null,
  previous_version_id: null, expected_version: 0, expected_content_hash: null, client_id: client,
  assessment_type: "A", assessment_year: 2026, assessment_date: "2026-09-01",
  manual_summary: "人工非標準化候選摘要",
  result: { state: "recorded", text: "人工候選結果", reason: null },
  reassessment: { state: "recorded", date: "2026-12-01", basis: "人工指定複評依據" },
  revision_reason: "建立候選初稿" };

describe("Page 21 ABCD manual candidate contracts", () => {
  it("parses only strict manual candidate fields and accepts no score or diagnosis", () => {
    expect(parseAbcdAssessmentMutation(createBody, idempotency)).toMatchObject({
      action: "save_assessment", assessmentType: "A", assessmentYear: 2026,
      result: { state: "recorded", text: "人工候選結果", reason: null } });
    expect(() => parseAbcdAssessmentMutation({ ...createBody, score: 8 }, idempotency)).toThrow();
    expect(() => parseAbcdAssessmentMutation({ ...createBody, diagnosis: "不得接受" }, idempotency)).toThrow();
  });

  it("preserves missing and not-applicable as reasoned states", () => {
    const missing = { ...createBody, result: { state: "missing", text: null, reason: "等待人工補登" },
      reassessment: { state: "not_applicable", date: null, basis: "人工判定不適用" } };
    expect(parseAbcdAssessmentMutation(missing, idempotency)).toMatchObject({
      result: { state: "missing", reason: "等待人工補登" },
      reassessment: { state: "not_applicable", date: null } });
    expect(() => parseAbcdAssessmentMutation({ ...missing,
      result: { state: "missing", text: "不得同時有文字", reason: "理由" } }, idempotency)).toThrow();
  });

  it("requires matching year/date, forward reassessment and exact baselines", () => {
    expect(() => parseAbcdAssessmentMutation({ ...createBody, assessment_year: 2025 }, idempotency)).toThrow(/日期/u);
    expect(() => parseAbcdAssessmentMutation({ ...createBody,
      reassessment: { state: "recorded", date: "2026-01-01", basis: "早於評估" } }, idempotency)).toThrow(/日期/u);
    expect(() => parseAbcdAssessmentMutation({ ...createBody, expected_version: 1 }, idempotency)).toThrow(/版本/u);
  });

  it("strictly parses all filters and rejects unknown or repeated values", () => {
    expect(parseAbcdAssessmentFilters(new URLSearchParams("year=2026&type=B&reassessment=missing&status=draft&q=%E5%80%8B%E6%A1%88")))
      .toMatchObject({ assessmentYear: 2026, assessmentType: "B", reassessmentState: "missing",
        status: "draft", query: "個案" });
    expect(() => parseAbcdAssessmentFilters(new URLSearchParams("type=A&type=B"))).toThrow();
    expect(() => parseAbcdAssessmentFilters(new URLSearchParams("year=1999"))).toThrow();
    expect(() => parseAbcdAssessmentFilters(new URLSearchParams("score=8"))).toThrow();
  });

  it("correlates receipt action, next version, type and year", () => {
    const input = parseAbcdAssessmentMutation(createBody, idempotency);
    const receipt = { organization_id: org, branch_id: branch, client_id: client,
      operation_id: user, idempotency_key: idempotency,
      action: "save_assessment", assessment_key: assessmentKey,
      version_id: "21180000-0000-4000-8000-000000000001", version: 1,
      assessment_state: "draft", assessment_type: "A", assessment_year: 2026,
      previous_version_id: null, source_content_hash: null, content_hash: hash,
      record_payload: { client_id: client, assessment_type: "A", assessment_year: 2026,
        assessment_date: "2026-09-01", manual_summary: "人工非標準化候選摘要",
        result: { state: "recorded", text: "人工候選結果", reason: null },
        reassessment: { state: "recorded", date: "2026-12-01", basis: "人工指定複評依據" },
        form_kind: "manual_unstandardized", formal_rule_status: "not_configured" },
      committed_at: "2026-09-07T03:00:00Z", replayed: false };
    expect(parseAbcdAssessmentReceipt(receipt, input, org, branch)).toMatchObject({ persisted: true, demo: false,
      assessmentType: "A", assessmentYear: 2026 });
    expect(() => parseAbcdAssessmentReceipt({ ...receipt, assessment_type: "B" }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt, version: 2 }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt, organization_id: user }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt, client_id: user }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt, previous_version_id: assessmentKey }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt, source_content_hash: hash }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt,
      record_payload: { ...receipt.record_payload, manual_summary: "遭置換的摘要" } }, input, org, branch)).toThrow(/回執/u);
    expect(() => parseAbcdAssessmentReceipt({ ...receipt,
      record_payload: { ...receipt.record_payload, assessment_year: 2025 } }, input, org, branch))
      .toThrow(/回執中的保存內容無效/u);
  });

  it("sorts by assessment date and preserves independent type-year chains", () => {
    const newer = row({ suffix: 1, type: "A", year: 2026, date: "2026-09-02" });
    const olderOtherType = row({ suffix: 2, type: "B", year: 2026, date: "2026-09-01" });
    const olderYear = row({ suffix: 3, type: "A", year: 2025, date: "2025-10-01" });
    const projected = projectAbcdAssessmentSnapshot({ row: source([newer, olderOtherType, olderYear]),
      expectedOrganizationId: org, expectedBranchId: branch, filters, demo: false });
    expect(projected.assessments.map((item) => `${item.assessmentYear}-${item.assessmentType}`))
      .toEqual(["2026-A", "2026-B", "2025-A"]);
  });

  it("rejects duplicate current chains for the same client type and year", () => {
    const forged = source([row({ suffix: 1 }), row({ suffix: 2 })]);
    expect(() => projectAbcdAssessmentSnapshot({ row: forged, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
  });

  it("validates signed evidence and immutable identity through history", () => {
    const signed = row({ state: "signed" });
    const projected = projectAbcdAssessmentSnapshot({ row: source([signed]),
      expectedOrganizationId: org, expectedBranchId: branch, filters, demo: false });
    expect(projected.assessments[0]?.history[1]).toMatchObject({ signerDisplayName: "合成簽署員",
      signaturePurpose: "ABCD 人工候選評估簽署", signerRoleKeys: ["professional"] });
    const forgedPurpose = source([row({ state: "signed" })]);
    forgedPurpose.assessments[0]!.signature_purpose = "錯誤目的";
    expect(() => projectAbcdAssessmentSnapshot({ row: forgedPurpose,
      expectedOrganizationId: org, expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
    const forgedType = source([row({ state: "signed" })]);
    forgedType.assessments[0]!.history[1]!.assessment_type = "B";
    expect(() => projectAbcdAssessmentSnapshot({ row: forgedType,
      expectedOrganizationId: org, expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
  });

  it("rejects forged tri-state, governance and full-set metrics", () => {
    const invalidResult: unknown = structuredClone(source());
    (invalidResult as { assessments: Array<{ result_text: string | null }> }).assessments[0]!.result_text = null;
    expect(() => projectAbcdAssessmentSnapshot({ row: invalidResult, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
    const formalLie = source(); formalLie.formal_rule_status = "configured";
    expect(() => projectAbcdAssessmentSnapshot({ row: formalLie, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
    const metric = source(); metric.a_total = 0; metric.b_total = 1;
    expect(() => projectAbcdAssessmentSnapshot({ row: metric, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
  });

  it("requires visible counts not to exceed complete totals when truncated", () => {
    const rows = Array.from({ length: 200 }, (_, index) => row({ suffix: index + 1,
      type: ["A", "B", "C", "D"][index % 4] as "A" | "B" | "C" | "D", year: 2000 + index }));
    const forged = source(rows); forged.assessments_truncated = true; forged.matching_total = 201;
    forged.assessment_total = 201; forged.a_total = 0; forged.b_total = 51;
    forged.c_total = 50; forged.d_total = 50; forged.draft_total = 201;
    expect(() => projectAbcdAssessmentSnapshot({ row: forged, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_ABCD/u);
  });

  it("keeps unsupported boundaries explicit in synthetic demo", () => {
    const demo = buildDemoAbcdAssessmentSnapshot(filters);
    expect(demo).toMatchObject({ formKind: "manual_unstandardized", formalRuleStatus: "not_configured",
      attachmentStatus: "not_configured", notificationStatus: "not_configured",
      exportStatus: "not_configured", offlineStatus: "not_configured", demo: true });
    expect(demo.assessments.map((item) => `${item.assessmentYear}-${item.assessmentType}`))
      .toEqual(["2026-A", "2026-B", "2026-C", "2026-D", "2025-A"]);
  });
});
