import { describe, expect, it } from "vitest";

import { projectAdaptationAssessmentSnapshot } from "@/lib/adaptation-assessments/projection";
import { projectMnaAssessmentSnapshot } from "@/lib/mna-assessments/projection";
import { MNA_GOVERNANCE_VERSION } from "@/lib/mna-assessments/types";
import { projectOccupationalTherapyAssessmentSnapshot } from "@/lib/occupational-therapy-assessments/projection";
import { projectOccupationalTherapyServiceSnapshot } from "@/lib/occupational-therapy-services/projection";
import { projectPhysicalTherapyAssessmentSnapshot } from "@/lib/physical-therapy-assessments/projection";
import { projectPhysicalTherapyServiceSnapshot } from "@/lib/physical-therapy-services/projection";
import { projectPsychosocialAssessmentSnapshot } from "@/lib/psychosocial-assessments/projection";

const organizationId = "7f110000-0000-4000-8000-000000000001";
const branchId = "7f110000-0000-4000-8000-000000000002";
const pendingClient = {
  client_id: "7f110000-0000-4000-8000-000000000003",
  display_name: "待收案個案",
  service_status: "pending",
  admitted_on: null,
  ended_on: null,
};
const common = {
  organization_id: organizationId,
  branch_id: branchId,
  generated_at: new Date().toISOString(),
  client_options: [pendingClient],
  client_total: 1,
  client_options_truncated: false,
};
const emptyAssessment = {
  ...common,
  items: [],
  item_total: 0,
  matching_total: 0,
  items_truncated: false,
  assessed_total: 0,
  not_assessed_total: 0,
  due_total: 0,
  upcoming_total: 0,
  draft_total: 0,
  completed_total: 0,
};
const therapyAssessment = {
  ...emptyAssessment,
  therapist_options: [],
  therapist_total: 0,
  therapist_options_truncated: false,
  assessment_method_status: "manual_unstandardized_only",
  form_publication_status: "not_published_not_claimed",
  due_rule_status: "not_configured_manual_date_and_basis_only",
  formula_status: "not_configured",
  score_status: "not_configured",
  diagnosis_status: "not_configured",
  attachment_status: "not_configured",
  export_status: "not_configured",
  reminder_status: "not_configured",
  offline_sync_status: "not_configured",
};
const therapyService = {
  ...common,
  records: [],
  record_total: 0,
  matching_total: 0,
  records_truncated: false,
  today_total: 0,
  draft_total: 0,
  signed_total: 0,
  corrected_total: 0,
  linked_assessment_total: 0,
  therapist_options: [],
  therapist_total: 0,
  therapist_options_truncated: false,
  assessment_link_status: "readonly_latest_terminal",
  formula_status: "not_configured",
  diagnosis_status: "not_configured",
  automatic_recommendation_status: "not_configured",
  attachment_status: "not_configured",
  export_status: "not_configured",
  offline_sync_status: "not_configured",
};

const cases = [
  {
    name: "adaptation",
    project: projectAdaptationAssessmentSnapshot,
    row: {
      ...common,
      items: [], item_total: 0, matching_total: 0, items_truncated: false,
      assessed_total: 0, not_assessed_total: 0,
      reassessment_due_total: 0,
      needs_follow_up_total: 0,
      open_follow_up_total: 0,
      overdue_follow_up_total: 0,
      draft_total: 0, completed_total: 0,
      assessor_options: [],
      assessor_total: 0,
      assessor_options_truncated: false,
      assessment_method_status: "manual_unstandardized_only",
      form_publication_status: "not_published_not_claimed",
      offline_sync_status: "not_configured",
      follow_up_notification_status: "none_not_sent",
    },
  },
  {
    name: "MNA",
    project: projectMnaAssessmentSnapshot,
    row: {
      ...common,
      items: [], item_total: 0, matching_total: 0, items_truncated: false,
      not_assessed_total: 0, normal_total: 0, at_risk_total: 0,
      malnourished_total: 0, follow_up_pending_total: 0,
      governance_version_id: MNA_GOVERNANCE_VERSION,
      license_status: "license_required_not_configured",
      questionnaire_content_status: "not_configured",
      scoring_algorithm_status: "not_configured",
      risk_classification_status: "not_configured",
      formal_draft_status: "blocked_license_not_configured",
      formal_sign_status: "blocked_license_not_configured",
      formal_correction_status: "blocked_license_not_configured",
      automatic_reassessment_status: "not_configured",
      automatic_follow_up_status: "not_configured",
      attachment_status: "not_configured", export_status: "not_configured",
      offline_sync_status: "not_configured", notification_status: "not_configured",
    },
  },
  {
    name: "psychosocial",
    project: projectPsychosocialAssessmentSnapshot,
    row: {
      ...emptyAssessment,
      responsible_options: [], responsible_total: 0,
      responsible_options_truncated: false,
      assessment_method_status: "manual_unstandardized_only",
      form_publication_status: "not_published_not_claimed",
      due_rule_status: "not_configured_manual_date_and_basis_only",
      score_status: "not_configured", diagnosis_status: "not_configured",
      attachment_status: "not_configured", export_status: "not_configured",
      offline_sync_status: "not_configured",
    },
  },
  { name: "OT assessment", project: projectOccupationalTherapyAssessmentSnapshot,
    row: therapyAssessment },
  { name: "PT assessment", project: projectPhysicalTherapyAssessmentSnapshot,
    row: therapyAssessment },
  { name: "OT service", project: projectOccupationalTherapyServiceSnapshot,
    row: therapyService },
  { name: "PT service", project: projectPhysicalTherapyServiceSnapshot,
    row: therapyService },
] as const;

describe("pending-admission read-only snapshots", () => {
  it.each(cases)("keeps $name available without any formal record", ({ project, row }) => {
    const snapshot = project({ row, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false });
    expect(snapshot.clientOptions[0]?.serviceStatus).toBe("pending");
  });

  it.each(cases)("rejects an unknown $name lifecycle status", ({ project, row }) => {
    expect(() => project({ row: { ...row, client_options: [{ ...pendingClient,
      service_status: "invented" }] }, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false })).toThrow();
  });

  it.each([
    ["OT", projectOccupationalTherapyAssessmentSnapshot],
    ["PT", projectPhysicalTherapyAssessmentSnapshot],
  ] as const)("shows an unassessed pending client in the %s work list", (_name, project) => {
    const item = {
      client_id: pendingClient.client_id,
      client_display_name: pendingClient.display_name,
      service_status: "pending",
      admitted_on: null, ended_on: null,
      version_id: null, assessment_key: null, assessment_version: null,
      record_state: null, assessed_on: null, therapist_user_id: null,
      therapist_display_name: null, service_status_at_assessment: null,
      reassessment_due_on: null, reassessment_due: false, due_basis: null,
      measurements: null, functional_observation: null, goals: null,
      recommendations: null, follow_up_plan: null, form_basis: null,
      form_version_reference: null, correction_reason: null, signed_at: null,
      signer_display_name: null, created_at: null, version_history: [],
      version_history_total: 0,
    };
    const snapshot = project({ row: { ...therapyAssessment, items: [item],
      item_total: 1, matching_total: 1, not_assessed_total: 1 },
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    demo: false });
    expect(snapshot.items[0]).toMatchObject({ serviceStatus: "pending",
      admittedOn: null, recordState: null });
  });
});
