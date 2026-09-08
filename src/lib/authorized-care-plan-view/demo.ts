import { createHash, randomUUID } from "node:crypto";

import type {
  AuthorizedCarePlanContentEnvelope,
  AuthorizedCarePlanFilters,
  AuthorizedCarePlanProvenanceEnvelope,
  AuthorizedCarePlanStream,
  AuthorizedCarePlanVersion,
  AuthorizedCarePlanViewSnapshot,
  CanonicalJsonObject,
  CanonicalJsonValue,
} from "./types";

const CLIENT_A = "55010000-0000-4000-8000-000000000001";
const CLIENT_B = "55010000-0000-4000-8000-000000000002";
const PLAN_A = "55020000-0000-4000-8000-000000000001";
const PLAN_B = "55020000-0000-4000-8000-000000000002";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nodeCount(value: CanonicalJsonValue): number {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value)) {
    return 1 + value.reduce<number>((total, entry) => total + nodeCount(entry), 0);
  }
  return 1 + Object.values(value).reduce<number>(
    (total, entry) => total + nodeCount(entry),
    0,
  );
}

function contentEnvelope(value: CanonicalJsonObject): AuthorizedCarePlanContentEnvelope {
  const canonicalJson = JSON.stringify(value);
  const missing = Object.keys(value).length === 0;
  return {
    valueState: missing ? "missing" : "unknown",
    mappingStatus: missing ? "missing" : "needs_mapping",
    needsMapping: !missing,
    canonicalJson,
    contentHash: digest(canonicalJson),
    byteSize: Buffer.byteLength(canonicalJson, "utf8"),
    nodeCount: nodeCount(value),
    topLevelFieldCount: Object.keys(value).length,
  };
}

function provenanceEnvelope(value: CanonicalJsonObject): AuthorizedCarePlanProvenanceEnvelope {
  const canonicalJson = JSON.stringify(value);
  return {
    valueState: Object.keys(value).length === 0 ? "missing" : "recorded",
    canonicalJson,
    contentHash: digest(canonicalJson),
    byteSize: Buffer.byteLength(canonicalJson, "utf8"),
    nodeCount: nodeCount(value),
    topLevelFieldCount: Object.keys(value).length,
  };
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function createVersions(asOf: string, generatedAt: string) {
  const planDataA = contentEnvelope({
    note: "展示：中央核定資料尚待欄位映射",
    legacy_service: { code: "SYNTH-A", quantity: 12 },
  });
  const limitsA = contentEnvelope({
    legacy_limit: "展示值；不解讀為官方額度",
  });
  const provenanceA = provenanceEnvelope({
    source: "synthetic_html",
    section: "authorized_care_plan",
  });
  const missing = contentEnvelope({});
  const missingProvenance = provenanceEnvelope({});
  const signedA: AuthorizedCarePlanVersion = {
    versionId: "55030000-0000-4000-8000-000000000001",
    planKey: PLAN_A,
    version: 1,
    previousVersionId: null,
    nextVersionId: "55030000-0000-4000-8000-000000000002",
    status: "signed",
    effectiveFrom: shiftDate(asOf, -15),
    effectiveTo: shiftDate(asOf, 15),
    sourceSystem: "synthetic_central_html",
    sourceRecordId: "SYNTH-P55-A-V1",
    sourceProvenance: provenanceA,
    authorizedOn: shiftDate(asOf, -20),
    authorizationReference: "SYNTH-AUTH-A",
    serviceLimits: limitsA,
    planData: planDataA,
    correctionReason: null,
    createdAt: generatedAt,
    approvedAt: generatedAt,
    signedAt: generatedAt,
    contentHash: "a".repeat(64),
    isWorkflowHead: false,
    isPublishedHead: true,
    isCurrentPublished: true,
    differencesFromPrevious: {
      changedFields: [],
      previousPlanDataHash: null,
      previousServiceLimitsHash: null,
      previousSourceProvenanceHash: null,
    },
  };
  const draftA: AuthorizedCarePlanVersion = {
    ...signedA,
    versionId: "55030000-0000-4000-8000-000000000002",
    version: 2,
    previousVersionId: signedA.versionId,
    nextVersionId: null,
    status: "draft",
    sourceRecordId: "SYNTH-P55-A-DRAFT",
    authorizedOn: null,
    authorizationReference: null,
    correctionReason: "展示中的未完成草稿",
    approvedAt: null,
    signedAt: null,
    contentHash: null,
    isWorkflowHead: true,
    isPublishedHead: false,
    isCurrentPublished: false,
    differencesFromPrevious: {
      changedFields: ["status", "source_record_id", "authorized_on", "authorization_reference",
        "correction_reason", "approved_at", "signed_at", "content_hash"],
      previousPlanDataHash: planDataA.contentHash,
      previousServiceLimitsHash: limitsA.contentHash,
      previousSourceProvenanceHash: provenanceA.contentHash,
    },
  };
  const draftB: AuthorizedCarePlanVersion = {
    versionId: "55030000-0000-4000-8000-000000000003",
    planKey: PLAN_B,
    version: 1,
    previousVersionId: null,
    nextVersionId: null,
    status: "draft",
    effectiveFrom: shiftDate(asOf, 1),
    effectiveTo: shiftDate(asOf, 31),
    sourceSystem: "synthetic_manual_migration",
    sourceRecordId: null,
    sourceProvenance: missingProvenance,
    authorizedOn: null,
    authorizationReference: null,
    serviceLimits: missing,
    planData: missing,
    correctionReason: null,
    createdAt: generatedAt,
    approvedAt: null,
    signedAt: null,
    contentHash: null,
    isWorkflowHead: true,
    isPublishedHead: false,
    isCurrentPublished: false,
    differencesFromPrevious: {
      changedFields: [],
      previousPlanDataHash: null,
      previousServiceLimitsHash: null,
      previousSourceProvenanceHash: null,
    },
  };
  return { signedA, draftA, draftB };
}

function allStreams(asOf: string, generatedAt: string): AuthorizedCarePlanStream[] {
  const { signedA, draftA, draftB } = createVersions(asOf, generatedAt);
  return [
    {
      planKey: PLAN_A,
      clientId: CLIENT_A,
      clientCode: "DEMO-P55-001",
      displayName: "展示個案甲",
      effectiveState: "current",
      clientCurrentStreamCount: 1,
      effectiveConflict: false,
      workflowHead: { versionId: draftA.versionId, version: 2, status: "draft" },
      publishedHead: { versionId: signedA.versionId, version: 1, status: "signed" },
      currentPublishedId: signedA.versionId,
      dateTerminalId: signedA.versionId,
      dateTerminalStatus: "signed",
      displayVersionId: signedA.versionId,
      displayAuthorizedOn: signedA.authorizedOn,
      displaySourceSystem: signedA.sourceSystem,
      displaySourceRecordId: signedA.sourceRecordId,
      displayEffectiveFrom: signedA.effectiveFrom,
      displayEffectiveTo: signedA.effectiveTo,
      displayAuthorizationReference: signedA.authorizationReference,
      displayNeedsMapping: true,
      historyCount: 2,
      history: [draftA, signedA],
    },
    {
      planKey: PLAN_B,
      clientId: CLIENT_B,
      clientCode: "DEMO-P55-002",
      displayName: "展示個案乙",
      effectiveState: "not_published",
      clientCurrentStreamCount: 0,
      effectiveConflict: false,
      workflowHead: { versionId: draftB.versionId, version: 1, status: "draft" },
      publishedHead: null,
      currentPublishedId: null,
      dateTerminalId: null,
      dateTerminalStatus: null,
      displayVersionId: draftB.versionId,
      displayAuthorizedOn: null,
      displaySourceSystem: draftB.sourceSystem,
      displaySourceRecordId: null,
      displayEffectiveFrom: draftB.effectiveFrom,
      displayEffectiveTo: draftB.effectiveTo,
      displayAuthorizationReference: null,
      displayNeedsMapping: false,
      historyCount: 1,
      history: [draftB],
    },
  ];
}

export function buildDemoAuthorizedCarePlanViewSnapshot({
  organizationId,
  branchId,
  filters,
  now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: AuthorizedCarePlanFilters;
  now?: Date;
}): AuthorizedCarePlanViewSnapshot {
  const generatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  const source = allStreams(filters.asOf, generatedAt);
  const matching = source.filter((stream) =>
    (filters.clientId === null || stream.clientId === filters.clientId) &&
    (filters.authorizedFrom === null || (
      stream.displayAuthorizedOn !== null && stream.displayAuthorizedOn >= filters.authorizedFrom
    )) &&
    (filters.authorizedTo === null || (
      stream.displayAuthorizedOn !== null && stream.displayAuthorizedOn <= filters.authorizedTo
    )) &&
    (filters.effectiveState === "all" || stream.effectiveState === filters.effectiveState) &&
    (filters.sourceSystem === null || stream.displaySourceSystem === filters.sourceSystem)
  );
  const pageStart = (filters.page - 1) * filters.pageSize;
  const plans = matching.slice(pageStart, pageStart + filters.pageSize);
  const countState = (state: AuthorizedCarePlanStream["effectiveState"]) =>
    matching.filter((stream) => stream.effectiveState === state).length;
  const snapshotHash = digest(JSON.stringify({
    organizationId, branchId, filters, planKeys: plans.map((plan) => plan.planKey), generatedAt,
  }));

  return {
    snapshotId: randomUUID(),
    snapshotHash,
    generatedAt,
    expiresAt,
    organizationId,
    branchId,
    filters,
    metrics: {
      matchingStreamTotal: matching.length,
      pageStreamCount: plans.length,
      historyVersionCount: plans.reduce((total, plan) => total + plan.historyCount, 0),
      currentTotal: countState("current"),
      futureTotal: countState("future"),
      expiredTotal: countState("expired"),
      voidedTotal: countState("voided"),
      notPublishedTotal: countState("not_published"),
      needsMappingTotal: matching.filter((plan) => plan.displayNeedsMapping).length,
      effectiveConflictTotal: matching.filter((plan) => plan.effectiveConflict).length,
    },
    plans,
    clientOptions: source.map((plan) => ({
      clientId: plan.clientId,
      clientCode: plan.clientCode,
      displayName: plan.displayName,
    })),
    clientOptionTotal: source.length,
    clientOptionsTruncated: false,
    sourceOptions: [...new Set(source.map((plan) => plan.displaySourceSystem))].map(
      (sourceSystem) => ({
        sourceSystem,
        recordCount: source.filter((plan) => plan.displaySourceSystem === sourceSystem).length,
      }),
    ),
    sourceOptionTotal: new Set(source.map((plan) => plan.displaySourceSystem)).size,
    sourceOptionsTruncated: false,
    bounds: {
      maxPageSize: 25,
      maxHistoryVersionsPerStream: 50,
      maxContentBytes: 65_536,
      maxProvenanceBytes: 16_384,
      maxJsonNodes: 1_024,
      maxSnapshotBytes: 2_097_152,
    },
    mappingRegistryStatus: "not_configured",
    centralPromotionStatus: "not_configured",
    officialLimitRulesStatus: "not_configured",
    claimEligibilityStatus: "not_asserted",
    mutationStatus: "read_only",
    consistencyStatus: "single_database_statement_snapshot",
    demo: true,
  };
}
