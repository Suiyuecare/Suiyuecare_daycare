import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoMnaAssessmentSnapshot } from "./demo";
import {
  MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT,
  mnaGovernanceSnapshotSchema,
  parseCreateMnaAssessment,
  parseMnaActionError,
  parseMnaAssessmentMutation,
} from "./parser";
import { filterDemoMnaAssessmentSnapshot, projectMnaAssessmentSnapshot } from
  "./projection";
import { parseMnaAssessmentFilters } from "./query";
import { MNA_GOVERNANCE_VERSION } from "./types";

const clientId = "12000000-0000-4000-8000-000000000001";
const assessmentKey = "13200000-0000-4000-8000-000000000001";
const previousVersionId = "13100000-0000-4000-8000-000000000002";
const idempotencyKey = "13900000-0000-4000-8000-000000000001";

function captureError(operation: () => unknown) {
  try {
    operation();
  } catch (error) {
    return error as IntegrationError;
  }
  throw new Error("expected error");
}

describe("page 36 MNA license-gated domain", () => {
  it("ships only an explicit unconfigured governance reference", () => {
    expect(mnaGovernanceSnapshotSchema.parse(
      MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT,
    )).toEqual(MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT);
    expect(MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT).toMatchObject({
      activation_status: "license_required_not_configured",
      formal_use_permitted: false,
      official_item_text_embedded: false,
      official_answer_options_embedded: false,
      official_scoring_formula_embedded: false,
      license_agreement_reference: null,
      scoring_algorithm_status: "not_configured",
    });
    expect(JSON.stringify(MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT))
      .not.toMatch(/question_0|item_0|answer_weight|thresholds/u);
  });

  it("builds a strictly synthetic immutable result history", () => {
    const snapshot = buildDemoMnaAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.licenseStatus).toBe("license_required_not_configured");
    expect(snapshot.metrics).toEqual({
      notAssessed: 1,
      normal: 1,
      atRisk: 1,
      malnourished: 0,
      followUpPending: 1,
    });
    const corrected = snapshot.items[0]!;
    expect(corrected.sourceFormVersionReference).toBe("SYNTHETIC-DEMO-NOT-MNA");
    expect(corrected.versionHistory.map((item) => item.assessmentVersion))
      .toEqual([2, 1]);
    expect(corrected.versionHistory[0]!.correctionOfVersionId)
      .toBe(corrected.versionHistory[1]!.versionId);
    expect(corrected.reassessmentBasis).toMatch(/人工輸入/u);
  });

  it("filters the complete synthetic collection before metrics", () => {
    const snapshot = buildDemoMnaAssessmentSnapshot();
    const filtered = filterDemoMnaAssessmentSnapshot(snapshot, {
      clientId: null,
      risk: "at_risk",
      followUp: "pending",
    });
    expect(filtered.items.map((item) => item.clientDisplayName))
      .toEqual(["合成個案 A"]);
    expect(filtered.metrics).toMatchObject({ atRisk: 1, followUpPending: 1 });
    expect(filtered.matchingTotal).toBe(1);
  });

  it.each([
    [{ client: "not-a-uuid" }, "invalid client"],
    [{ client: [clientId] }, "array client"],
    [{ risk: "unknown" }, "unknown risk"],
    [{ risk: ["all"] }, "array risk"],
    [{ follow_up: "later" }, "unknown follow-up"],
    [{ surprise: "all" }, "unknown key"],
  ])("fails closed for %s query", (query, label) => {
    expect(label.length).toBeGreaterThan(0);
    expect(parseMnaAssessmentFilters(query).invalidFilters).toBe(true);
  });

  it("accepts only known scalar query values", () => {
    expect(parseMnaAssessmentFilters({
      client: clientId,
      risk: "at_risk",
      follow_up: "pending",
    })).toEqual({
      filters: { clientId, risk: "at_risk", followUp: "pending" },
      invalidFilters: false,
    });
  });

  it("parses only the minimal blocked create contract", () => {
    expect(parseCreateMnaAssessment({
      action: "create_draft",
      clientId,
      assessedOn: "2026-09-02",
      formVariant: "mna_sf",
      governanceVersionId: MNA_GOVERNANCE_VERSION,
    }, idempotencyKey)).toMatchObject({
      action: "create_draft",
      clientId,
      idempotencyKey,
    });
  });

  it.each([
    [{ action: "create_draft", clientId, assessedOn: "2026-02-30", formVariant: "mna_sf", governanceVersionId: MNA_GOVERNANCE_VERSION }, idempotencyKey, "bad date"],
    [{ action: "create_draft", clientId, assessedOn: "2026-09-02", formVariant: "invented", governanceVersionId: MNA_GOVERNANCE_VERSION }, idempotencyKey, "bad variant"],
    [{ action: "create_draft", clientId, assessedOn: "2026-09-02", formVariant: "mna_sf", governanceVersionId: MNA_GOVERNANCE_VERSION, score: 12 }, idempotencyKey, "unexpected score"],
    [{ action: "create_draft", clientId, assessedOn: "2026-09-02", formVariant: "mna_sf", governanceVersionId: MNA_GOVERNANCE_VERSION }, "bad-key", "bad key"],
  ])("rejects %s create request", (body, key, label) => {
    expect(label.length).toBeGreaterThan(0);
    expect(captureError(() => parseCreateMnaAssessment(body, key)).code)
      .toBe("INVALID_MNA_ASSESSMENT");
  });

  it("requires expected version and a reason for correction", () => {
    const correction = parseMnaAssessmentMutation({
      action: "correct",
      clientId,
      assessmentKey,
      previousVersionId,
      expectedVersion: 2,
      correctionReason: "外部轉錄內容經授權人員確認後需更正。",
    }, idempotencyKey);
    expect(correction).toMatchObject({ action: "correct", expectedVersion: 2 });
    expect(captureError(() => parseMnaAssessmentMutation({
      action: "correct",
      clientId,
      assessmentKey,
      previousVersionId,
      expectedVersion: 0,
      correctionReason: " ",
    }, idempotencyKey)).code).toBe("INVALID_MNA_ASSESSMENT");
  });

  it("accepts only strict structured error receipts", () => {
    const payload = {
      requestId: "13900000-0000-4000-8000-000000000099",
      status: "error",
      data: null,
      errors: [{ code: "MNA_LICENSE_NOT_CONFIGURED", message: "授權未配置" }],
    };
    expect(parseMnaActionError(payload)?.errors[0]?.code)
      .toBe("MNA_LICENSE_NOT_CONFIGURED");
    expect(parseMnaActionError({ ...payload, token: "secret" })).toBeNull();
  });

  it("rejects malformed source projections", () => {
    expect(() => projectMnaAssessmentSnapshot({
      row: {},
      expectedOrganizationId: "11111111-1111-4111-8111-111111111111",
      expectedBranchId: "22222222-2222-4222-8222-222222222222",
      demo: false,
    })).toThrow("INVALID_MNA_ASSESSMENT_SNAPSHOT");
  });
});

