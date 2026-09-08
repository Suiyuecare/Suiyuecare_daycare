import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildDemoAuthorizedCarePlanViewSnapshot } from "./demo";
import { projectAuthorizedCarePlanViewSnapshot } from "./projection";
import type {
  AuthorizedCarePlanFilters,
  AuthorizedCarePlanVersion,
  AuthorizedCarePlanViewSnapshot,
} from "./types";

const ORGANIZATION_ID = "55000000-0000-4000-8000-000000000001";
const BRANCH_ID = "55000000-0000-4000-8000-000000000002";
const CLIENT_A = "55010000-0000-4000-8000-000000000001";
const fixedNow = new Date("2026-09-08T04:00:00.000Z");
const filters: AuthorizedCarePlanFilters = {
  asOf: "2026-09-08",
  clientId: CLIENT_A,
  authorizedFrom: null,
  authorizedTo: null,
  effectiveState: "all",
  sourceSystem: null,
  page: 1,
  pageSize: 25,
};

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceEnvelope(value: AuthorizedCarePlanVersion["planData"]) {
  return {
    value_state: value.valueState,
    mapping_status: value.mappingStatus,
    needs_mapping: value.needsMapping,
    canonical_json: value.canonicalJson,
    content_hash: value.contentHash,
    byte_size: value.byteSize,
    node_count: value.nodeCount,
    top_level_field_count: value.topLevelFieldCount,
  };
}

function sourceProvenance(value: AuthorizedCarePlanVersion["sourceProvenance"]) {
  return {
    value_state: value.valueState,
    canonical_json: value.canonicalJson,
    content_hash: value.contentHash,
    byte_size: value.byteSize,
    node_count: value.nodeCount,
    top_level_field_count: value.topLevelFieldCount,
  };
}

function sourceVersion(value: AuthorizedCarePlanVersion) {
  return {
    version_id: value.versionId,
    plan_key: value.planKey,
    version: value.version,
    previous_version_id: value.previousVersionId,
    next_version_id: value.nextVersionId,
    status: value.status,
    effective_from: value.effectiveFrom,
    effective_to: value.effectiveTo,
    source_system: value.sourceSystem,
    source_record_id: value.sourceRecordId,
    source_provenance: sourceProvenance(value.sourceProvenance),
    authorized_on: value.authorizedOn,
    authorization_reference: value.authorizationReference,
    service_limits: sourceEnvelope(value.serviceLimits),
    plan_data: sourceEnvelope(value.planData),
    correction_reason: value.correctionReason,
    created_at: value.createdAt,
    approved_at: value.approvedAt,
    signed_at: value.signedAt,
    content_hash: value.contentHash,
    is_workflow_head: value.isWorkflowHead,
    is_published_head: value.isPublishedHead,
    is_current_published: value.isCurrentPublished,
    differences_from_previous: {
      changed_fields: value.differencesFromPrevious.changedFields,
      previous_plan_data_hash: value.differencesFromPrevious.previousPlanDataHash,
      previous_service_limits_hash: value.differencesFromPrevious.previousServiceLimitsHash,
      previous_source_provenance_hash:
        value.differencesFromPrevious.previousSourceProvenanceHash,
    },
  };
}

function payloadFromSnapshot(snapshot: AuthorizedCarePlanViewSnapshot) {
  return {
    schema_version: "page55-authorized-care-plan-view.v1",
    organization_id: snapshot.organizationId,
    branch_id: snapshot.branchId,
    generated_at: snapshot.generatedAt,
    expires_at: snapshot.expiresAt,
    filters: {
      as_of: snapshot.filters.asOf,
      client_id: snapshot.filters.clientId,
      authorized_from: snapshot.filters.authorizedFrom,
      authorized_to: snapshot.filters.authorizedTo,
      effective_state: snapshot.filters.effectiveState,
      source_system: snapshot.filters.sourceSystem,
      page: snapshot.filters.page,
      page_size: snapshot.filters.pageSize,
    },
    metrics: {
      matching_stream_total: snapshot.metrics.matchingStreamTotal,
      page_stream_count: snapshot.metrics.pageStreamCount,
      history_version_count: snapshot.metrics.historyVersionCount,
      current_total: snapshot.metrics.currentTotal,
      future_total: snapshot.metrics.futureTotal,
      expired_total: snapshot.metrics.expiredTotal,
      voided_total: snapshot.metrics.voidedTotal,
      not_published_total: snapshot.metrics.notPublishedTotal,
      needs_mapping_total: snapshot.metrics.needsMappingTotal,
      effective_conflict_total: snapshot.metrics.effectiveConflictTotal,
    },
    plans: snapshot.plans.map((plan) => ({
      plan_key: plan.planKey,
      client_id: plan.clientId,
      client_code: plan.clientCode,
      display_name: plan.displayName,
      effective_state: plan.effectiveState,
      client_current_stream_count: plan.clientCurrentStreamCount,
      effective_conflict: plan.effectiveConflict,
      workflow_head: {
        version_id: plan.workflowHead.versionId,
        version: plan.workflowHead.version,
        status: plan.workflowHead.status,
      },
      published_head: plan.publishedHead ? {
        version_id: plan.publishedHead.versionId,
        version: plan.publishedHead.version,
        status: plan.publishedHead.status,
      } : null,
      current_published_id: plan.currentPublishedId,
      date_terminal_id: plan.dateTerminalId,
      date_terminal_status: plan.dateTerminalStatus,
      display_version_id: plan.displayVersionId,
      display_authorized_on: plan.displayAuthorizedOn,
      display_source_system: plan.displaySourceSystem,
      display_source_record_id: plan.displaySourceRecordId,
      display_effective_from: plan.displayEffectiveFrom,
      display_effective_to: plan.displayEffectiveTo,
      display_authorization_reference: plan.displayAuthorizationReference,
      display_needs_mapping: plan.displayNeedsMapping,
      history_count: plan.historyCount,
      history: plan.history.map(sourceVersion),
    })),
    client_options: snapshot.clientOptions.map((option) => ({
      client_id: option.clientId,
      client_code: option.clientCode,
      display_name: option.displayName,
    })),
    client_option_total: snapshot.clientOptionTotal,
    client_options_truncated: snapshot.clientOptionsTruncated,
    source_options: snapshot.sourceOptions.map((option) => ({
      source_system: option.sourceSystem,
      record_count: option.recordCount,
    })),
    source_option_total: snapshot.sourceOptionTotal,
    source_options_truncated: snapshot.sourceOptionsTruncated,
    bounds: {
      max_page_size: 25,
      max_history_versions_per_stream: 50,
      max_content_bytes: 65_536,
      max_provenance_bytes: 16_384,
      max_json_nodes: 1_024,
      max_snapshot_bytes: 2_097_152,
    },
    mapping_registry_status: "not_configured",
    central_promotion_status: "not_configured",
    official_limit_rules_status: "not_configured",
    claim_eligibility_status: "not_asserted",
    mutation_status: "read_only",
  };
}

function createSource() {
  const snapshot = buildDemoAuthorizedCarePlanViewSnapshot({
    organizationId: ORGANIZATION_ID,
    branchId: BRANCH_ID,
    filters,
    now: fixedNow,
  });
  const payload = payloadFromSnapshot(snapshot);
  return { snapshot, payload, row: rowFor(payload, snapshot) };
}

function rowFor(payload: ReturnType<typeof payloadFromSnapshot>, snapshot: AuthorizedCarePlanViewSnapshot) {
  const snapshotJson = JSON.stringify(payload);
  return {
    snapshot_id: "55090000-0000-4000-8000-000000000001",
    snapshot_hash: digest(snapshotJson),
    generated_at: snapshot.generatedAt,
    expires_at: snapshot.expiresAt,
    snapshot_json: snapshotJson,
  };
}

function project(payload: ReturnType<typeof payloadFromSnapshot>, snapshot: AuthorizedCarePlanViewSnapshot) {
  return projectAuthorizedCarePlanViewSnapshot({
    row: rowFor(payload, snapshot),
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    filters,
    demo: false,
  });
}

function refreshChangedFields(plan: ReturnType<typeof payloadFromSnapshot>["plans"][number]) {
  const ascending = [...plan.history].sort((left, right) => left.version - right.version);
  for (let index = 1; index < ascending.length; index += 1) {
    const previous = ascending[index - 1]!;
    const current = ascending[index]!;
    const pairs = [
      ["status", current.status, previous.status],
      ["effective_from", current.effective_from, previous.effective_from],
      ["effective_to", current.effective_to, previous.effective_to],
      ["source_system", current.source_system, previous.source_system],
      ["source_record_id", current.source_record_id, previous.source_record_id],
      ["source_provenance", current.source_provenance.content_hash,
        previous.source_provenance.content_hash],
      ["authorized_on", current.authorized_on, previous.authorized_on],
      ["authorization_reference", current.authorization_reference,
        previous.authorization_reference],
      ["service_limits", current.service_limits.content_hash, previous.service_limits.content_hash],
      ["plan_data", current.plan_data.content_hash, previous.plan_data.content_hash],
      ["correction_reason", current.correction_reason, previous.correction_reason],
      ["approved_at", current.approved_at, previous.approved_at],
      ["signed_at", current.signed_at, previous.signed_at],
      ["content_hash", current.content_hash, previous.content_hash],
    ] as const;
    current.differences_from_previous.changed_fields = pairs
      .filter(([, currentValue, previousValue]) => currentValue !== previousValue)
      .map(([field]) => field);
  }
}

describe("Page 55 authorized-care-plan projection", () => {
  it("keeps a signed current version effective when a newer draft exists", () => {
    const { payload, snapshot } = createSource();
    const result = project(payload, snapshot);
    expect(result.plans[0]).toMatchObject({
      effectiveState: "current",
      currentPublishedId: "55030000-0000-4000-8000-000000000001",
      displayVersionId: "55030000-0000-4000-8000-000000000001",
      workflowHead: { version: 2, status: "draft" },
      publishedHead: { version: 1, status: "signed" },
    });
    expect(result.consistencyStatus).toBe("single_database_statement_snapshot");
  });

  it("does not let a newer future signed version hide the as-of signed version", () => {
    const { payload, snapshot } = createSource();
    const plan = payload.plans[0];
    const current = plan.history.find((version) => version.version === 1)!;
    const future = plan.history.find((version) => version.version === 2)!;
    future.status = "signed";
    future.effective_from = "2026-10-01";
    future.effective_to = "2026-10-31";
    future.authorized_on = "2026-09-20";
    future.authorization_reference = "SYNTH-FUTURE";
    future.approved_at = snapshot.generatedAt;
    future.signed_at = snapshot.generatedAt;
    future.content_hash = "b".repeat(64);
    future.is_published_head = true;
    current.is_published_head = false;
    plan.workflow_head.status = "signed";
    plan.published_head = { version_id: future.version_id, version: 2, status: "signed" };
    plan.display_version_id = future.version_id;
    plan.display_authorized_on = future.authorized_on;
    plan.display_source_record_id = future.source_record_id;
    plan.display_effective_from = future.effective_from;
    plan.display_effective_to = future.effective_to;
    plan.display_authorization_reference = future.authorization_reference;
    refreshChangedFields(plan);

    const result = project(payload, snapshot).plans[0];
    expect(result.publishedHead).toMatchObject({ version: 2, status: "signed" });
    expect(result.currentPublishedId).toBe(current.version_id);
    expect(result.effectiveState).toBe("current");
  });

  it("treats a later same-period void as terminal without inventing a current plan", () => {
    const { payload, snapshot } = createSource();
    const plan = payload.plans[0];
    const signed = plan.history.find((version) => version.version === 1)!;
    const terminal = plan.history.find((version) => version.version === 2)!;
    terminal.status = "voided";
    terminal.authorized_on = signed.authorized_on;
    terminal.authorization_reference = signed.authorization_reference;
    terminal.approved_at = snapshot.generatedAt;
    terminal.signed_at = snapshot.generatedAt;
    terminal.content_hash = "c".repeat(64);
    terminal.is_published_head = true;
    signed.is_published_head = false;
    signed.is_current_published = false;
    plan.workflow_head.status = "voided";
    plan.published_head = { version_id: terminal.version_id, version: 2, status: "voided" };
    plan.current_published_id = null;
    plan.date_terminal_id = terminal.version_id;
    plan.date_terminal_status = "voided";
    plan.display_version_id = terminal.version_id;
    plan.display_authorized_on = terminal.authorized_on;
    plan.display_source_record_id = terminal.source_record_id;
    plan.display_authorization_reference = terminal.authorization_reference;
    plan.effective_state = "voided";
    payload.metrics.current_total = 0;
    payload.metrics.voided_total = 1;
    refreshChangedFields(plan);

    expect(project(payload, snapshot).plans[0]).toMatchObject({
      effectiveState: "voided",
      currentPublishedId: null,
      dateTerminalStatus: "voided",
    });
  });

  it("preserves explicit missing and unknown-needs-mapping envelopes", () => {
    const { payload, snapshot } = createSource();
    const plan = project(payload, snapshot).plans[0];
    expect(plan.history[0].planData).toMatchObject({
      valueState: "unknown", mappingStatus: "needs_mapping", needsMapping: true,
    });
    expect(JSON.parse(plan.history[0].planData.canonicalJson)).toHaveProperty("legacy_service");
  });

  it("preserves large legacy numbers only in exact canonical text without exposing lossy numbers", () => {
    const { payload, snapshot } = createSource();
    const planData = payload.plans[0].history[0].plan_data;
    planData.canonical_json = '{"legacy_integer":9007199254740993}';
    planData.content_hash = digest(planData.canonical_json);
    planData.byte_size = Buffer.byteLength(planData.canonical_json, "utf8");
    planData.node_count = 2;
    planData.top_level_field_count = 1;
    refreshChangedFields(payload.plans[0]);
    const projected = project(payload, snapshot).plans[0].history[0].planData;
    expect(projected.canonicalJson).toContain("9007199254740993");
    expect(projected).not.toHaveProperty("canonicalValue");
  });

  it("fails closed on outer hash, content hash, chain, scope and metric tampering", () => {
    const cases: ((input: ReturnType<typeof payloadFromSnapshot>) => void)[] = [
      (input) => { input.organization_id = "55000000-0000-4000-8000-000000000099"; },
      (input) => { input.metrics.current_total = 99; },
      (input) => { input.plans[0].history[0].previous_version_id = null; },
      (input) => { input.plans[0].history[0].plan_data.content_hash = "f".repeat(64); },
      (input) => { input.plans[0].date_terminal_id = null; },
    ];
    for (const mutate of cases) {
      const { payload, snapshot } = createSource();
      mutate(payload);
      expect(() => project(payload, snapshot)).toThrow("INVALID_AUTHORIZED_CARE_PLAN_VIEW_SNAPSHOT");
    }

    const { row } = createSource();
    expect(() => projectAuthorizedCarePlanViewSnapshot({
      row: { ...row, snapshot_hash: "0".repeat(64) },
      expectedOrganizationId: ORGANIZATION_ID,
      expectedBranchId: BRANCH_ID,
      filters,
      demo: false,
    })).toThrow("INVALID_AUTHORIZED_CARE_PLAN_VIEW_SNAPSHOT");
  });
});
