import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildDemoIntegrationsAuditSnapshot } from "./demo";
import { projectIntegrationsAuditSnapshot } from "./projection";
import {
  INTEGRATIONS_AUDIT_SOURCE_KEYS,
  INTEGRATIONS_AUDIT_SOURCE_PATHS,
  type IntegrationsAuditFilters,
} from "./types";

const ORG = "83100000-0000-4000-8000-000000000001";
const BRANCH = "83100000-0000-4000-8000-000000000002";
const ACTOR = "83100000-0000-4000-8000-000000000003";
const filters: IntegrationsAuditFilters = {
  startDate: "2026-09-01", endDate: "2026-09-08", integrationKey: "all",
  activityState: "all", auditAction: "all", resourceCategory: "all",
  actorUserId: null, correlationId: null,
};

function payload() {
  return {
    schema_version: "page83-integrations-audit.v1",
    organization_id: ORG,
    branch_id: BRANCH,
    generated_at: "2026-09-08T04:00:00.000Z",
    stale_after: "2026-09-08T04:01:00.000Z",
    window: { start_date: "2026-09-01", end_date: "2026-09-08", time_zone: "Asia/Taipei" },
    filters: { start_date: "2026-09-01", end_date: "2026-09-08",
      integration_key: "all", activity_state: "all", audit_action: "all",
      resource_category: "all", actor_user_id: null, correlation_id: null },
    inventory: INTEGRATIONS_AUDIT_SOURCE_KEYS.map((integrationKey) => ({
      integration_key: integrationKey,
      source_path: INTEGRATIONS_AUDIT_SOURCE_PATHS[integrationKey],
      activity_state: integrationKey === "central_html_import" ? "attention" : "no_activity",
      record_total: integrationKey === "central_html_import" ? 1 : 0,
      attention_total: integrationKey === "central_html_import" ? 1 : 0,
      pending_total: integrationKey === "central_html_import" ? 1 : 0,
      latest_activity_at: integrationKey === "central_html_import"
        ? "2026-09-08T03:00:00.000Z" : null,
      governance_status: "unconfigured", provider_region_status: "unconfigured",
      owner_status: "unconfigured", retry_command_status: "unconfigured",
      deactivation_command_status: "unconfigured", reconciliation_command_status: "unconfigured",
    })),
    inventory_matching_total: 7,
    signals: [{ signal_id: "83110000-0000-4000-8000-000000000001",
      integration_key: "central_html_import", occurred_at: "2026-09-08T03:00:00.000Z",
      state: "pending", correlation_id: null, error_category: "import_mapping_required",
      error_code_status: "available", source_path: "/app/staff/governance/central-html-import" }],
    signal_matching_total: 1,
    signals_truncated: false,
    audit_events: [{ audit_event_id: "1", occurred_at: "2026-09-08T02:00:00.000Z",
      action: "integration", resource_category: "import", actor_user_id: ACTOR,
      record_id: { kind: "uuid", value: "83120000-0000-4000-8000-000000000001" },
      request_id: "83130000-0000-4000-8000-000000000001", idempotency_key: null }],
    audit_matching_total: 1,
    audit_events_truncated: false,
    options: {
      integration_keys: ["all", "central_html_import", "notification_delivery", "pwa_sync",
        "claims", "consultation_notification_outbox", "referral_notification_outbox",
        "family_communication_delivery"],
      activity_states: ["all", "observed", "attention", "no_activity"],
      audit_actions: ["all", "select", "insert", "update", "delete", "export", "print",
        "sign", "correct", "permission_change", "rule_change", "integration"],
      resource_categories: ["all", "governance", "import", "notification", "sync", "claim",
        "communication", "professional_service", "client", "staff", "care", "billing",
        "operations", "other"],
    },
    bounds: { max_date_window_days: 90, max_signal_rows: 100, max_audit_rows: 200,
      max_snapshot_bytes: 1_048_576 },
    access_requirements: { permission: "audit.view", employee_aal2_required: true,
      recent_same_session_aal2_required: true, recent_maximum_age_minutes: 15 },
    capabilities: { integration_registry_status: "unconfigured",
      provider_regional_compliance_status: "unconfigured", owner_assignment_status: "unconfigured",
      retry_commands_status: "unconfigured", deactivation_commands_status: "unconfigured",
      reconciliation_commands_status: "unconfigured", payload_inspection_status: "prohibited",
      mutation_status: "read_only" },
    consistency_status: "single_database_statement_snapshot",
    demo: false,
  };
}

function row(value = payload()) {
  const snapshotJson = JSON.stringify(value);
  return { snapshot_id: "83140000-0000-4000-8000-000000000001",
    snapshot_hash: createHash("sha256").update(snapshotJson, "utf8").digest("hex"),
    generated_at: value.generated_at, stale_after: value.stale_after, snapshot_json: snapshotJson };
}

describe("Page 83 integrations/audit projection", () => {
  it("verifies a hashed, scoped, bounded and redacted formal snapshot", () => {
    const result = projectIntegrationsAuditSnapshot({ row: row(),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters });
    expect(result).toMatchObject({ demo: false, snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      inventoryMatchingTotal: 7, signalMatchingTotal: 1, auditMatchingTotal: 1,
      consistencyStatus: "single_database_statement_snapshot" });
    expect(result.signals[0]?.errorCategory).toBe("import_mapping_required");
    expect(JSON.stringify(result)).not.toContain("metadata");
  });

  it("rejects hash, tenant, count, path, vocabulary and calendar timestamp drift", () => {
    expect(() => projectIntegrationsAuditSnapshot({ row: { ...row(), snapshot_hash: "0".repeat(64) },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    expect(() => projectIntegrationsAuditSnapshot({ row: row(), expectedOrganizationId: BRANCH,
      expectedBranchId: BRANCH, filters })).toThrow();
    const wrongCount = payload(); wrongCount.signal_matching_total = 0;
    expect(() => projectIntegrationsAuditSnapshot({ row: row(wrongCount),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    const wrongPath = payload(); wrongPath.signals[0]!.source_path = "/app/staff/other";
    expect(() => projectIntegrationsAuditSnapshot({ row: row(wrongPath),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    const extra = payload() as ReturnType<typeof payload> & { metadata?: object };
    extra.metadata = { token: "must-not-pass" };
    expect(() => projectIntegrationsAuditSnapshot({ row: row(extra),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    const invalidTime = payload(); invalidTime.audit_events[0]!.occurred_at = "2026-02-30T02:00:00Z";
    expect(() => projectIntegrationsAuditSnapshot({ row: row(invalidTime),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    const crossVocabulary = payload();
    crossVocabulary.signals[0]!.state = "completed";
    crossVocabulary.signals[0]!.error_category = "import_validation_failed";
    expect(() => projectIntegrationsAuditSnapshot({ row: row(crossVocabulary),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    const omittedCatalogSource = payload();
    omittedCatalogSource.inventory.pop();
    omittedCatalogSource.inventory_matching_total -= 1;
    expect(() => projectIntegrationsAuditSnapshot({ row: row(omittedCatalogSource),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
    const reorderedCatalog = payload();
    reorderedCatalog.inventory.reverse();
    expect(() => projectIntegrationsAuditSnapshot({ row: row(reorderedCatalog),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters })).toThrow();
  });

  it("keeps synthetic demo data explicit and applies correlation to inventory and rows", () => {
    const demo = buildDemoIntegrationsAuditSnapshot({ organizationId: ORG, branchId: BRANCH,
      filters: { ...filters, correlationId: "83000000-0000-4000-8000-000000000084" },
      now: new Date("2026-09-08T04:00:00.000Z") });
    expect(demo).toMatchObject({ demo: true, consistencyStatus: "synthetic_demo_snapshot" });
    expect(demo.signals).toHaveLength(1);
    expect(demo.inventory.find((item) => item.integrationKey === "central_html_import"))
      .toMatchObject({ activityState: "no_activity", recordTotal: 0 });
    expect(demo.capabilities.retryCommandsStatus).toBe("unconfigured");
  });
});
