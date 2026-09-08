import { describe, expect, it } from "vitest";

import {
  parseOrganizationProfileDecisionInput,
  parseOrganizationProfileDecisionReceipt,
  parseOrganizationProfileProposalInput,
  parseOrganizationProfileProposalReceipt,
} from "./parser";
import {
  projectOrganizationProfileSnapshot,
  type OrganizationProfileSnapshotSourceRow,
} from "./projection";

const ORG = "58000000-0000-4000-8000-000000000001";
const BRANCH = "58000000-0000-4000-8000-000000000002";
const KEY = "58000000-0000-4000-8000-000000000003";
const PROFILE = "58000000-0000-4000-8000-000000000004";
const PROPOSAL = "58000000-0000-4000-8000-000000000005";
const PROPOSAL_KEY = "58000000-0000-4000-8000-000000000006";
const VERSION = "58000000-0000-4000-8000-000000000007";
const DECISION = "58000000-0000-4000-8000-000000000008";
const ACTOR = "58000000-0000-4000-8000-000000000009";
const REVIEWER = "58000000-0000-4000-8000-000000000010";
const SOURCE = "58000000-0000-4000-8000-000000000011";
const SERVICE = "58000000-0000-4000-8000-000000000012";
const RATE = "58000000-0000-4000-8000-000000000013";
const HASH = "a".repeat(64);
const filters = { status: "all" as const, effectiveOn: null, query: "" };

function proposalBody(override: Record<string, unknown> = {}) {
  return {
    action: "propose", proposal_action: "create", proposal_key: PROPOSAL_KEY,
    profile_key: PROFILE, base_version_id: null, expected_base_version: 0,
    effective_from: "2026-01-01", effective_to: "2026-12-31",
    permit_number: "合成許可", permit_issuing_authority: "合成發證單位",
    permit_issued_on: "2025-12-01", permit_valid_through: "2026-12-31",
    permit_status_text: "人工有效", organization_type_text: "合成類型",
    service_items: [{ service_key: SERVICE, name: "合成服務", description: null,
      taxonomy_status: "manual_unstandardized" }],
    rate_items: [{ rate_key: RATE, label: "合成費目",
      amount_decimal_text: "001200.00", currency_code: "TWD",
      effective_from: "2026-01-01", effective_to: "2026-12-31",
      taxonomy_status: "manual_unstandardized" }],
    approved_capacity: 30, capacity_unit_text: "合成人數單位",
    capacity_basis_text: "合成依據", contact_name: "合成窗口",
    contact_phone: "02-0000-0000", contact_email: "synthetic@example.invalid",
    contact_address: "合成地址", change_reason: "建立合成版本", ...override,
  };
}

function decisionBody(override: Record<string, unknown> = {}) {
  return { action: "decide", proposal_id: PROPOSAL,
    expected_proposal_number: 1, expected_base_version: 0,
    expected_profile_key: PROFILE, expected_content_hash: HASH,
    expected_effective_from: "2026-01-01", expected_effective_to: "2026-12-31",
    decision: "approve", decision_reason: "獨立核准", ...override };
}

function sourceRow(): OrganizationProfileSnapshotSourceRow {
  const content = {
    effective_from: "2026-01-01", effective_to: "2026-12-31",
    permit_number: "合成許可", permit_issuing_authority: "合成發證單位",
    permit_issued_on: "2025-12-01", permit_valid_through: "2026-12-31",
    permit_status_text: "人工有效", organization_type_text: "合成類型",
    service_items: [{ service_key: SERVICE, name: "合成服務", description: null,
      taxonomy_status: "manual_unstandardized" as const }],
    rate_items: [{ rate_key: RATE, label: "合成費目",
      amount_decimal_text: "001200.00", currency_code: "TWD",
      effective_from: "2026-01-01", effective_to: "2026-12-31",
      taxonomy_status: "manual_unstandardized" as const }],
    approved_capacity: 30, capacity_unit_text: "合成人數單位",
    capacity_basis_text: "合成依據", contact_name: "合成窗口",
    contact_phone: "02-0000-0000", contact_email: "synthetic@example.invalid",
    contact_address: "合成地址", change_reason: "建立合成版本",
    taxonomy_status: "manual_unstandardized" as const,
    attachment_pipeline_status: "not_configured" as const, content_hash: HASH,
  };
  return {
    organization_id: ORG, branch_id: BRANCH,
    generated_at: "2026-09-02T04:00:00.000Z", snapshot_date: "2026-09-02",
    versions: [{ version_id: VERSION, profile_key: PROFILE, version: 1,
      previous_version_id: null, source_proposal_id: SOURCE, ...content,
      approved_by: REVIEWER, approved_by_display_name: "合成審核人",
      approved_at: "2026-01-01T00:00:00.000Z" }],
    version_total: 1, versions_truncated: false,
    history: [{ version_id: VERSION, profile_key: PROFILE, version: 1,
      previous_version_id: null, source_proposal_id: SOURCE,
      effective_from: "2026-01-01", effective_to: "2026-12-31",
      content_hash: HASH, approved_by_display_name: "合成審核人",
      approved_at: "2026-01-01T00:00:00.000Z", change_reason: "建立合成版本" }],
    history_total: 1, history_truncated: false,
    proposals: [{ proposal_id: PROPOSAL, proposal_key: PROPOSAL_KEY,
      proposal_number: 1, action: "create", profile_key: PROFILE,
      base_version_id: null, expected_base_version: 0, ...content,
      proposed_by: ACTOR, proposed_by_display_name: "合成提案人",
      proposed_at: "2025-12-31T00:00:00.000Z", status: "approved",
      decision_id: DECISION, decision: "approve", decision_reason: "獨立核准",
      decided_by: REVIEWER, decided_by_display_name: "合成審核人",
      decided_at: "2026-01-01T00:00:00.000Z", result_version_id: VERSION }],
    proposal_total: 1, proposals_truncated: false,
    active_version_total: 1, pending_proposal_total: 0,
    expired_permit_total: 0, active_capacity: 30,
    official_taxonomy_status: "not_configured",
    manual_taxonomy_status: "manual_unstandardized",
    permit_expiry_reminder_status: "not_configured",
    attachment_pipeline_status: "not_configured", export_status: "disabled",
    regulator_sync_status: "disabled", offline_status: "disabled",
    recent_aal2_max_age_minutes: 15,
  };
}

describe("Page-58 organization profile contracts", () => {
  it("preserves exact decimal text and explicit manual taxonomy", () => {
    const parsed = parseOrganizationProfileProposalInput(proposalBody(), KEY);
    expect(parsed.content.rateItems[0]?.amountDecimalText).toBe("001200.00");
    expect(parsed.content.rateItems[0]?.taxonomyStatus).toBe("manual_unstandardized");
  });

  it("rejects malformed contact email at the strict API parser", () => {
    expect(() => parseOrganizationProfileProposalInput(
      proposalBody({ contact_email: "not-an-email" }), KEY,
    )).toThrow();
  });

  it("rejects unknown attachment, export, and regulator fields", () => {
    expect(() => parseOrganizationProfileProposalInput(proposalBody({
      attachment_reference: "browser://fake", export: true,
      regulator_sync: "pretend",
    }), KEY)).toThrow();
  });

  it("rejects overlapping same-label and same-currency rate periods", () => {
    const first = proposalBody().rate_items as Array<Record<string, unknown>>;
    expect(() => parseOrganizationProfileProposalInput(proposalBody({ rate_items: [
      ...first, { ...first[0], rate_key: "58000000-0000-4000-8000-000000000099",
        effective_from: "2026-06-01", effective_to: null },
    ] }), KEY)).toThrow();
  });

  it("rejects reverse profile and permit date ranges", () => {
    expect(() => parseOrganizationProfileProposalInput(proposalBody({
      effective_from: "2026-12-31", effective_to: "2026-01-01",
    }), KEY)).toThrow();
    expect(() => parseOrganizationProfileProposalInput(proposalBody({
      permit_issued_on: "2026-12-31", permit_valid_through: "2026-01-01",
    }), KEY)).toThrow();
  });

  it("strictly correlates proposal scope, action, version, and identity", () => {
    const input = parseOrganizationProfileProposalInput(proposalBody(), KEY);
    const receipt = { organization_id: ORG, branch_id: BRANCH,
      proposal_id: PROPOSAL, proposal_key: PROPOSAL_KEY, proposal_number: 1,
      proposal_status: "pending", action: "create", profile_key: PROFILE,
      expected_base_version: 0, content_hash: HASH,
      proposed_at: "2026-09-02T04:00:00.000Z", replayed: false };
    expect(parseOrganizationProfileProposalReceipt(receipt, input, ORG, BRANCH))
      .toMatchObject({ proposalNumber: 1, persisted: true });
    expect(() => parseOrganizationProfileProposalReceipt({ ...receipt,
      branch_id: ACTOR }, input, ORG, BRANCH)).toThrow();
    expect(() => parseOrganizationProfileProposalReceipt({ ...receipt,
      action: "correct" }, input, ORG, BRANCH)).toThrow();
  });

  it("accepts nullable result fields for a correlated reject replay", () => {
    const input = parseOrganizationProfileDecisionInput(decisionBody({
      decision: "reject", decision_reason: "資料仍需確認",
    }), KEY);
    expect(parseOrganizationProfileDecisionReceipt({
      organization_id: ORG, branch_id: BRANCH, proposal_id: PROPOSAL,
      decision_id: DECISION, decision: "reject", proposal_status: "rejected",
      result_version_id: null, profile_key: PROFILE, result_version: null,
      effective_from: null, effective_to: null, content_hash: HASH,
      decided_at: "2026-09-02T04:00:00.000Z", replayed: true,
    }, input, ORG, BRANCH)).toMatchObject({
      proposalStatus: "rejected", resultVersionId: null, replayed: true,
    });
  });

  it("rejects a reject receipt that fabricates an effective version", () => {
    const input = parseOrganizationProfileDecisionInput(decisionBody({
      decision: "reject", decision_reason: "資料仍需確認",
    }), KEY);
    expect(() => parseOrganizationProfileDecisionReceipt({
      organization_id: ORG, branch_id: BRANCH, proposal_id: PROPOSAL,
      decision_id: DECISION, decision: "reject", proposal_status: "rejected",
      result_version_id: VERSION, profile_key: PROFILE, result_version: 1,
      effective_from: "2026-01-01", effective_to: "2026-12-31",
      content_hash: HASH, decided_at: "2026-09-02T04:00:00.000Z", replayed: false,
    }, input, ORG, BRANCH)).toThrow();
  });

  it("projects a complete matching version, history, and approved proposal", () => {
    const snapshot = projectOrganizationProfileSnapshot({ row: sourceRow(),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    });
    expect(snapshot).toMatchObject({ versionTotal: 1, proposalTotal: 1,
      activeVersionTotal: 1, activeCapacity: 30,
      officialTaxonomyStatus: "not_configured" });
  });

  it("accepts safe bigint count strings from a PostgreSQL adapter", () => {
    const row = sourceRow() as unknown as Record<string, unknown>;
    for (const key of ["version_total", "history_total", "proposal_total",
      "active_version_total", "pending_proposal_total", "expired_permit_total"]) {
      row[key] = String(row[key]);
    }
    expect(projectOrganizationProfileSnapshot({
      row: row as OrganizationProfileSnapshotSourceRow,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    }).versionTotal).toBe(1);
  });

  it("rejects an approved proposal whose result version is absent from history", () => {
    const row = sourceRow();
    row.proposals[0]!.result_version_id =
      "58000000-0000-4000-8000-000000000099";
    expect(() => projectOrganizationProfileSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow();
  });

  it("rejects approved proposal drift in profile, hash, or effective period", () => {
    for (const patch of [
      { profile_key: "58000000-0000-4000-8000-000000000099" },
      { content_hash: "b".repeat(64) },
      { effective_to: "2026-11-30" },
    ]) {
      const row = sourceRow(); Object.assign(row.proposals[0]!, patch);
      expect(() => projectOrganizationProfileSnapshot({ row,
        expectedOrganizationId: ORG, expectedBranchId: BRANCH,
        filters, demo: false,
      })).toThrow();
    }
  });

  it("rejects forged aggregate counts and overlapping terminal periods", () => {
    const badCount = sourceRow(); badCount.active_version_total = 0;
    expect(() => projectOrganizationProfileSnapshot({ row: badCount,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow();
    const overlap = sourceRow(); overlap.versions.push({ ...overlap.versions[0]!,
      version_id: "58000000-0000-4000-8000-000000000098",
      profile_key: "58000000-0000-4000-8000-000000000097",
      source_proposal_id: "58000000-0000-4000-8000-000000000096" });
    overlap.version_total = 2; overlap.active_version_total = 2;
    expect(() => projectOrganizationProfileSnapshot({ row: overlap,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow();
  });
});
