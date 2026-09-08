import { projectAbcdAssessmentSnapshot } from "./projection";
import type { AbcdAssessmentFilters, AbcdAssessmentState, AbcdAssessmentType,
  AbcdValueState } from "./types";

const ORG = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CLIENT_A = "21010000-0000-4000-8000-000000000001";
const CLIENT_B = "21010000-0000-4000-8000-000000000002";
const stableText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

type Demo = { key: string; client: string; name: string; type: AbcdAssessmentType; year: number;
  date: string; state: AbcdAssessmentState; summary: string; resultState: AbcdValueState;
  resultText: string | null; resultReason: string | null; reassessmentState: AbcdValueState;
  reassessmentDate: string | null; reassessmentBasis: string };

const rows: Demo[] = [
  { key: "21000000-0000-4000-8000-000000000001", client: CLIENT_A, name: "日照個案甲",
    type: "A", year: 2026, date: "2026-09-07", state: "signed",
    summary: "合成示例：工作人員依機構尚未正式發布的 A 類人工候選格式完成摘要。",
    resultState: "recorded", resultText: "合成示例：人工記錄之候選結果，未產生分數或診斷。",
    resultReason: null, reassessmentState: "recorded", reassessmentDate: "2026-12-07",
    reassessmentBasis: "合成示例：由評估人員人工指定三個月後檢視。" },
  { key: "21000000-0000-4000-8000-000000000002", client: CLIENT_A, name: "日照個案甲",
    type: "B", year: 2026, date: "2026-09-06", state: "draft",
    summary: "合成示例：B 類候選摘要與 A 類各自保存，不互相覆寫。",
    resultState: "missing", resultText: null, resultReason: "合成示例：等待專業人員補登人工結果。",
    reassessmentState: "missing", reassessmentDate: null,
    reassessmentBasis: "合成示例：正式規則未配置，尚未人工指定複評日期。" },
  { key: "21000000-0000-4000-8000-000000000003", client: CLIENT_B, name: "日照個案乙",
    type: "C", year: 2026, date: "2026-08-20", state: "signed",
    summary: "合成示例：C 類人工候選摘要；不聲稱為官方題本或標準化結果。",
    resultState: "not_applicable", resultText: null, resultReason: "合成示例：本次人工標記結果不適用。",
    reassessmentState: "not_applicable", reassessmentDate: null,
    reassessmentBasis: "合成示例：評估人員人工判定目前不適用複評。" },
  { key: "21000000-0000-4000-8000-000000000004", client: CLIENT_A, name: "日照個案甲",
    type: "A", year: 2025, date: "2025-11-15", state: "corrected",
    summary: "合成示例：2025 年 A 類更正版，與 2026 年 A 類為不同版本鏈。",
    resultState: "recorded", resultText: "合成示例：人工更正候選結果文字。", resultReason: null,
    reassessmentState: "recorded", reassessmentDate: "2026-02-15",
    reassessmentBasis: "合成示例：人工依個案服務檢討日指定。" },
  { key: "21000000-0000-4000-8000-000000000005", client: CLIENT_B, name: "日照個案乙",
    type: "D", year: 2026, date: "2026-07-03", state: "draft",
    summary: "合成示例：D 類獨立草稿；正式 D 類題本與公式目前未配置。",
    resultState: "recorded", resultText: "合成示例：僅為人工候選文字。", resultReason: null,
    reassessmentState: "missing", reassessmentDate: null,
    reassessmentBasis: "合成示例：尚待人員指定複評日。" },
];

function sourceRow(row: Demo, index: number) {
  const id = (version: number) => `21020000-0000-4000-8000-${String(index * 10 + version).padStart(12, "0")}`;
  const challenge = (version: number) => `21030000-0000-4000-8000-${String(index * 10 + version).padStart(12, "0")}`;
  const common = { client_id: row.client, client_display_name: row.name, assessment_type: row.type,
    assessment_year: row.year, assessment_date: row.date, manual_summary: row.summary,
    result_state: row.resultState, result_text: row.resultText, result_reason: row.resultReason,
    reassessment_state: row.reassessmentState, reassessment_date: row.reassessmentDate,
    reassessment_basis: row.reassessmentBasis, author_user_id: USER, author_display_name: "合成評估員",
    form_kind: "manual_unstandardized" as const, formal_rule_status: "not_configured" as const };
  const make = (version: number, state: AbcdAssessmentState) => {
    const signed = state !== "draft";
    return { ...common, version_id: id(version), assessment_key: row.key, version,
      previous_version_id: version === 1 ? null : id(version - 1),
      content_hash: String((index + version) % 10).repeat(64), assessment_state: state,
      revision_reason: state === "draft" ? (version === 1 ? "建立人工候選初稿" : "補充人工候選摘要") : null,
      correction_reason: state === "corrected" ? "合成示例：更正人工輸入文字，未重新計分。" : null,
      signed_at: signed ? `2026-09-0${Math.min(index + version, 8)}T02:30:00.000Z` : null,
      signed_by_user_id: signed ? USER : null, signer_display_name: signed ? "合成簽署員" : null,
      signer_role_keys: signed ? ["professional"] : null,
      signature_purpose: state === "signed" ? "ABCD 人工候選評估簽署" :
        state === "corrected" ? "ABCD 人工候選評估更正簽署" : null,
      signature_reauth_challenge_id: signed ? challenge(version) : null,
      created_at: `2026-09-0${Math.min(index + version, 8)}T02:30:00.000Z` };
  };
  const history = row.state === "draft" ? [make(1, "draft")] : row.state === "signed" ?
    [make(1, "draft"), make(2, "signed")] :
    [make(1, "draft"), make(2, "signed"), make(3, "corrected")];
  return { ...history.at(-1)!, history, history_total: history.length };
}

export function buildDemoAbcdAssessmentSnapshot(filters: AbcdAssessmentFilters) {
  const all = rows.map(sourceRow);
  const needle = filters.query?.toLocaleLowerCase("zh-Hant-TW") ?? null;
  const assessments = all.filter((item) => (!filters.clientId || item.client_id === filters.clientId) &&
    (!filters.assessmentYear || item.assessment_year === filters.assessmentYear) &&
    (filters.assessmentType === "all" || item.assessment_type === filters.assessmentType) &&
    (filters.reassessmentState === "all" || item.reassessment_state === filters.reassessmentState) &&
    (filters.status === "all" || item.assessment_state === filters.status) &&
    (!needle || item.client_display_name.toLocaleLowerCase("zh-Hant-TW").includes(needle) ||
      item.assessment_key.includes(needle))).sort((left, right) =>
    stableText(right.assessment_date, left.assessment_date) ||
      stableText(left.client_id, right.client_id) ||
      stableText(left.assessment_type, right.assessment_type) ||
      stableText(left.assessment_key, right.assessment_key));
  const total = assessments.length;
  return projectAbcdAssessmentSnapshot({ expectedOrganizationId: ORG, expectedBranchId: BRANCH,
    filters, demo: true, row: { organization_id: ORG, branch_id: BRANCH,
      generated_at: new Date().toISOString(), assessments, matching_total: total,
      assessments_truncated: false, assessment_total: total,
      a_total: assessments.filter((item) => item.assessment_type === "A").length,
      b_total: assessments.filter((item) => item.assessment_type === "B").length,
      c_total: assessments.filter((item) => item.assessment_type === "C").length,
      d_total: assessments.filter((item) => item.assessment_type === "D").length,
      reassessment_missing_total: assessments.filter((item) => item.reassessment_state === "missing").length,
      draft_total: assessments.filter((item) => item.assessment_state === "draft").length,
      signed_total: assessments.filter((item) => item.assessment_state !== "draft").length,
      clients: [{ client_id: CLIENT_A, display_name: "日照個案甲" },
        { client_id: CLIENT_B, display_name: "日照個案乙" }], client_total: 2,
      clients_truncated: false, years: [2026, 2025], year_total: 2, years_truncated: false,
      form_kind: "manual_unstandardized", formal_rule_status: "not_configured",
      attachment_status: "not_configured", notification_status: "not_configured",
      export_status: "not_configured", offline_status: "not_configured" } });
}
