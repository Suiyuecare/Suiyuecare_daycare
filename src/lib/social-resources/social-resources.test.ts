import { describe, expect, it } from "vitest";

import {
  parseCreateSocialResource,
  parseSocialResourceActionSuccess,
  parseSocialResourceOperationResult,
} from "./parser";
import { projectSocialResourceSnapshot } from "./projection";

const organizationId = "31000000-0000-4000-8000-000000000001";
const branchId = "31000000-0000-4000-8000-000000000002";
const futureId = "31000000-0000-4000-8000-000000000010";
const expiredId = "31000000-0000-4000-8000-000000000011";

function item(overrides: Record<string, unknown>) {
  return {
    resource_id: futureId,
    reference_year: 2026,
    name: "測試資源",
    resource_type: "社區支持",
    audience_state: "provided",
    audience_detail: "照顧者",
    eligibility_state: "missing",
    eligibility_detail: null,
    contact_state: "not_applicable",
    contact_detail: null,
    validity_state: "date_range",
    valid_from: "2026-10-01",
    valid_until: "2026-12-31",
    last_confirmed_on: null,
    status: "active",
    row_version: 1,
    updated_at: "2026-08-31T03:00:00.000Z",
    expired: false,
    effective: false,
    ...overrides,
  };
}

function snapshotRow() {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-01T02:00:00.000Z",
    items: [
      item({}),
      item({
        resource_id: expiredId,
        name: "已到期資源",
        valid_from: "2025-01-01",
        valid_until: "2025-12-31",
        expired: true,
      }),
    ],
    item_total: 2,
    effective_total: 0,
    pending_confirmation_total: 2,
    inactive_total: 0,
    expired_total: 1,
    items_truncated: false,
    type_options: ["社區支持"],
    audience_options: ["照顧者"],
    type_options_truncated: false,
    audience_options_truncated: false,
    expiry_rule_status: "not_configured",
    confirmation_rule_status: "missing_date_only",
  };
}

const fields = {
  action: "create" as const,
  referenceYear: 2026,
  name: "社區窗口",
  resourceType: "社區支持",
  audienceState: "provided" as const,
  audienceDetail: "主要照顧者",
  eligibilityState: "missing" as const,
  eligibilityDetail: null,
  contactState: "not_applicable" as const,
  contactDetail: null,
  validityState: "date_range" as const,
  validFrom: "2026-01-01",
  validUntil: "2026-12-31",
};

describe("social resource projection and parser", () => {
  it("does not count a future start as effective and independently marks an expired row", () => {
    const snapshot = projectSocialResourceSnapshot({
      row: snapshotRow(),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    });
    expect(snapshot.items[0]).toMatchObject({ expired: false, effective: false });
    expect(snapshot.items[1]).toMatchObject({ expired: true, effective: false });
    expect(snapshot.metrics).toMatchObject({ effective: 0, expired: 1 });
    expect(snapshot.metrics.expiringSoon).toBeNull();
  });

  it("fails closed on a forged effective flag or cross-branch response", () => {
    const forged = snapshotRow();
    forged.items[0] = { ...forged.items[0], effective: true };
    expect(() => projectSocialResourceSnapshot({
      row: forged,
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    })).toThrow("INVALID_SOCIAL_RESOURCE_PROJECTION");
    expect(() => projectSocialResourceSnapshot({
      row: snapshotRow(),
      expectedOrganizationId: organizationId,
      expectedBranchId: "31000000-0000-4000-8000-000000000099",
      demo: false,
    })).toThrow("INVALID_SOCIAL_RESOURCE_PROJECTION");
  });

  it("requires explicit missing/not-applicable states to agree with detail values", () => {
    expect(parseCreateSocialResource(
      fields,
      "31000000-0000-4000-8000-000000000020",
    )).toMatchObject({ eligibilityState: "missing", eligibilityDetail: null });
    expect(() => parseCreateSocialResource(
      { ...fields, eligibilityState: "provided", eligibilityDetail: null },
      "31000000-0000-4000-8000-000000000020",
    )).toThrow(/資源欄位/u);
    expect(() => parseCreateSocialResource(
      { ...fields, validityState: "open_ended", validUntil: null },
      "31000000-0000-4000-8000-000000000020",
    )).not.toThrow();
    expect(() => parseCreateSocialResource(
      { ...fields, validityState: "date_range", validFrom: "2026-12-31", validUntil: "2026-01-01" },
      "31000000-0000-4000-8000-000000000020",
    )).toThrow(/資源欄位/u);
  });

  it("rejects unexpected request keys and malformed database receipts", () => {
    expect(() => parseCreateSocialResource(
      { ...fields, organizationId },
      "31000000-0000-4000-8000-000000000020",
    )).toThrow(/資源欄位/u);
    expect(() => parseSocialResourceOperationResult({
      operation_id: "31000000-0000-4000-8000-000000000021",
      resource_id: futureId,
      row_version: 1,
      status: "active",
      last_confirmed_on: null,
      replayed: false,
      actor_id: "forbidden",
    })).toThrow(/完成憑證/u);
  });

  it("correlates browser success receipts to the target and expected version", () => {
    const envelope = {
      requestId: "31000000-0000-4000-8000-000000000022",
      status: "ok",
      data: {
        operationId: "31000000-0000-4000-8000-000000000023",
        resourceId: futureId,
        rowVersion: 2,
        status: "active",
        lastConfirmedOn: "2026-09-01",
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(parseSocialResourceActionSuccess(envelope, {
      action: "confirm",
      resourceId: futureId,
      expectedRowVersion: 1,
    }).data.rowVersion).toBe(2);
    expect(() => parseSocialResourceActionSuccess(envelope, {
      action: "confirm",
      resourceId: expiredId,
      expectedRowVersion: 1,
    })).toThrow("MISMATCHED_SOCIAL_RESOURCE_SUCCESS");
  });
});
