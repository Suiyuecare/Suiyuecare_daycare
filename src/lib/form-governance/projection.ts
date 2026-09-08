import type {
  FormGovernanceFilters,
  FormGovernanceSnapshot,
  FormGovernanceVersion,
  FormPublicationEvidence,
  FormVersionStatus,
} from "./types";
import { FORM_VERSION_STATUSES } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export type FormDefinitionSourceRow = {
  id: string;
  organization_id: string | null;
  form_key: string;
  name: string;
  category: string;
  is_official: boolean;
};

export type FormVersionSourceRow = {
  id: string;
  form_definition_id: string;
  version: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  schema_field_count: number;
  scoring_rule_count: number;
  published_at: string | null;
  content_hash: string | null;
};

export type FormPublicationSourceRow = {
  id: string;
  form_definition_id: string;
  form_version_id: string;
  status: string;
  requested_at: string;
  requested_by_current_user: boolean;
  approved_at: string | null;
  approved_by_current_user: boolean;
};

export type FormGovernanceSnapshotSourceRow = {
  organization_id: string;
  branch_id: string;
  generated_at: string;
  definitions: FormDefinitionSourceRow[];
  versions: FormVersionSourceRow[];
  publications: FormPublicationSourceRow[];
  definition_total: number | string;
  version_total: number | string;
  publication_total: number | string;
  pending_total: number | string;
  definitions_truncated: boolean;
  versions_truncated: boolean;
  publications_truncated: boolean;
};

function invalid(): never {
  throw new Error("INVALID_FORM_GOVERNANCE_PROJECTION");
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function text(value: unknown, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    invalid();
  }
  return value.trim();
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) invalid();
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid();
  }
  return value;
}

function optionalDate(value: unknown): string | null {
  return value === null ? null : calendarDate(value);
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/u.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) invalid();
  return parsed as number;
}

function dateOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function periodsOverlap(
  left: Pick<FormGovernanceVersion, "effectiveFrom" | "effectiveTo">,
  right: Pick<FormGovernanceVersion, "effectiveFrom" | "effectiveTo">,
) {
  const leftStart = left.effectiveFrom ? dateOrdinal(left.effectiveFrom) : -Infinity;
  const leftEnd = left.effectiveTo ? dateOrdinal(left.effectiveTo) : Infinity;
  const rightStart = right.effectiveFrom ? dateOrdinal(right.effectiveFrom) : -Infinity;
  const rightEnd = right.effectiveTo ? dateOrdinal(right.effectiveTo) : Infinity;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function actorLabel(current: boolean, kind: "requester" | "approver") {
  if (current) return kind === "requester" ? "本人申請" : "本人核准";
  return kind === "requester" ? "另一位授權人員" : "第二位授權人員";
}

export function projectFormGovernanceSnapshot(input: {
  definitionRows: readonly FormDefinitionSourceRow[];
  versionRows: readonly FormVersionSourceRow[];
  publicationRows: readonly FormPublicationSourceRow[];
  expectedOrganizationId: string;
  expectedBranchId: string;
  today: string;
  generatedAt: string;
  definitionTotal?: number | string;
  versionTotal?: number | string;
  publicationTotal?: number | string;
  pendingTotal?: number | string;
  definitionsTruncated?: boolean;
  versionsTruncated?: boolean;
  publicationsTruncated?: boolean;
  demo: boolean;
}): FormGovernanceSnapshot {
  const organizationId = uuid(input.expectedOrganizationId);
  uuid(input.expectedBranchId);
  const today = calendarDate(input.today);
  const generatedAt = timestamp(input.generatedAt);
  const definitionTotal = nonNegativeInteger(
    input.definitionTotal ?? input.definitionRows.length,
  );
  const versionTotal = nonNegativeInteger(
    input.versionTotal ?? input.versionRows.length,
  );
  const publicationTotal = nonNegativeInteger(
    input.publicationTotal ?? input.publicationRows.length,
  );
  const pendingTotal = nonNegativeInteger(
    input.pendingTotal ?? input.publicationRows.filter(
      (row) => row.status === "pending",
    ).length,
  );
  const definitionsTruncated = input.definitionsTruncated ?? false;
  const versionsTruncated = input.versionsTruncated ?? false;
  const publicationsTruncated = input.publicationsTruncated ?? false;
  if (
    typeof definitionsTruncated !== "boolean" ||
    typeof versionsTruncated !== "boolean" ||
    typeof publicationsTruncated !== "boolean" ||
    definitionTotal < input.definitionRows.length ||
    versionTotal < input.versionRows.length ||
    publicationTotal < input.publicationRows.length ||
    pendingTotal > publicationTotal ||
    definitionsTruncated !== (definitionTotal > input.definitionRows.length) ||
    versionsTruncated !== (versionTotal > input.versionRows.length) ||
    publicationsTruncated !== (publicationTotal > input.publicationRows.length)
  ) {
    invalid();
  }
  const definitions = new Map<string, FormDefinitionSourceRow>();

  for (const row of input.definitionRows) {
    const id = uuid(row.id);
    if (definitions.has(id) || typeof row.is_official !== "boolean") invalid();
    const rowOrganizationId = row.organization_id === null
      ? null
      : uuid(row.organization_id);
    if (
      (row.is_official && rowOrganizationId !== null) ||
      (!row.is_official && rowOrganizationId !== organizationId)
    ) {
      invalid();
    }
    text(row.form_key, 128);
    text(row.name, 240);
    text(row.category, 120);
    definitions.set(id, row);
  }

  const rawVersions = new Map<string, FormVersionSourceRow>();
  const projectedVersions = new Map<string, FormGovernanceVersion>();
  for (const row of input.versionRows) {
    const id = uuid(row.id);
    const definitionId = uuid(row.form_definition_id);
    const definition = definitions.get(definitionId);
    if (
      rawVersions.has(id) ||
      !definition ||
      !Number.isSafeInteger(row.version) ||
      row.version <= 0 ||
      !Number.isSafeInteger(row.schema_field_count) ||
      row.schema_field_count < 0 ||
      !Number.isSafeInteger(row.scoring_rule_count) ||
      row.scoring_rule_count < 0 ||
      !FORM_VERSION_STATUSES.includes(row.status as FormVersionStatus)
    ) {
      invalid();
    }
    const effectiveFrom = optionalDate(row.effective_from);
    const effectiveTo = optionalDate(row.effective_to);
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) invalid();
    const publishedAt = optionalTimestamp(row.published_at);
    const contentHash = row.content_hash;
    if (contentHash !== null && !HASH_PATTERN.test(contentHash)) invalid();
    if (
      (row.status === "draft" &&
        (publishedAt !== null || contentHash !== null)) ||
      (row.status !== "draft" && publishedAt === null)
    ) {
      invalid();
    }
    rawVersions.set(id, row);
    projectedVersions.set(id, {
      id,
      definitionId,
      formKey: text(definition.form_key, 128),
      name: text(definition.name, 240),
      category: text(definition.category, 120),
      official: definition.is_official,
      version: row.version,
      status: row.status as FormVersionStatus,
      effectiveFrom,
      effectiveTo,
      schemaFieldCount: row.schema_field_count,
      scoringRuleCount: row.scoring_rule_count,
      publishedAt,
      contentHash,
      publication: null,
    });
  }

  const publicationByVersion = new Map<string, FormPublicationEvidence>();
  const publicationIds = new Set<string>();
  for (const row of input.publicationRows) {
    const id = uuid(row.id);
    const definitionId = uuid(row.form_definition_id);
    const versionId = uuid(row.form_version_id);
    const definition = definitions.get(definitionId);
    const version = projectedVersions.get(versionId);
    if (
      publicationIds.has(id) ||
      publicationByVersion.has(versionId) ||
      !definition ||
      definition.is_official ||
      !version ||
      version.definitionId !== definitionId ||
      !["pending", "approved"].includes(row.status) ||
      typeof row.requested_by_current_user !== "boolean" ||
      typeof row.approved_by_current_user !== "boolean"
    ) {
      invalid();
    }
    const requestedAt = timestamp(row.requested_at);
    const approvedAt = optionalTimestamp(row.approved_at);
    if (
      (row.status === "pending" &&
        (approvedAt !== null ||
          row.approved_by_current_user ||
          version.status !== "draft")) ||
      (row.status === "approved" &&
        (approvedAt === null ||
          (row.requested_by_current_user && row.approved_by_current_user) ||
          version.status !== "published" ||
          version.contentHash === null))
    ) {
      invalid();
    }
    publicationIds.add(id);
    publicationByVersion.set(versionId, {
      id,
      status: row.status as "pending" | "approved",
      requestedAt,
      requesterLabel: actorLabel(row.requested_by_current_user, "requester"),
      requestedByCurrentUser: row.requested_by_current_user,
      approvedAt,
      approverLabel: approvedAt
        ? actorLabel(row.approved_by_current_user, "approver")
        : null,
      approvedByCurrentUser: row.approved_by_current_user,
    });
  }

  const versions = [...projectedVersions.values()]
    .map((version) => ({
      ...version,
      publication: publicationByVersion.get(version.id) ?? null,
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, "zh-TW") || right.version - left.version,
    );
  const returnedPending = versions.filter(
    (version) => version.publication?.status === "pending",
  ).length;
  if (
    pendingTotal < returnedPending ||
    (!publicationsTruncated && pendingTotal !== returnedPending)
  ) {
    invalid();
  }

  let overlapWarnings = 0;
  for (let leftIndex = 0; leftIndex < versions.length; leftIndex += 1) {
    const left = versions[leftIndex]!;
    if (!(["published", "retired"] as FormVersionStatus[]).includes(left.status)) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < versions.length; rightIndex += 1) {
      const right = versions[rightIndex]!;
      if (
        left.definitionId === right.definitionId &&
        (["published", "retired"] as FormVersionStatus[]).includes(right.status) &&
        periodsOverlap(left, right)
      ) {
        overlapWarnings += 1;
      }
    }
  }

  const todayOrdinal = dateOrdinal(today);
  return {
    generatedAt,
    today,
    metrics: {
      active: versions.filter((version) =>
        version.status === "published" &&
        (!version.effectiveFrom || version.effectiveFrom <= today) &&
        (!version.effectiveTo || version.effectiveTo >= today),
      ).length,
      drafts: versions.filter((version) => version.status === "draft").length,
      pending: versions.filter(
        (version) => version.publication?.status === "pending",
      ).length,
      upcoming: versions.filter((version) =>
        version.status === "published" &&
        version.effectiveFrom !== null &&
        dateOrdinal(version.effectiveFrom) > todayOrdinal &&
        dateOrdinal(version.effectiveFrom) <= todayOrdinal + 30,
      ).length,
      overlapWarnings,
    },
    versions,
    definitionLoaded: input.definitionRows.length,
    versionLoaded: input.versionRows.length,
    publicationLoaded: input.publicationRows.length,
    definitionTotal,
    versionTotal,
    publicationTotal,
    pendingTotal,
    definitionsTruncated,
    versionsTruncated,
    publicationsTruncated,
    incomplete:
      definitionsTruncated || versionsTruncated || publicationsTruncated,
    demo: input.demo,
  };
}

export function filterFormGovernanceVersions(
  snapshot: FormGovernanceSnapshot,
  filters: FormGovernanceFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  return snapshot.versions.filter((version) => {
    const matchesQuery =
      !query ||
      `${version.name} ${version.formKey} ${version.category}`
        .toLocaleLowerCase("zh-TW")
        .includes(query);
    const matchesStatus =
      filters.status === "all" ||
      (filters.status === "pending"
        ? version.publication?.status === "pending"
        : version.status === filters.status);
    const matchesScope =
      filters.scope === "all" ||
      (filters.scope === "official" ? version.official : !version.official);
    return (
      matchesQuery &&
      matchesStatus &&
      matchesScope &&
      (filters.category === "all" || version.category === filters.category)
    );
  });
}

export function formGovernanceCategories(snapshot: FormGovernanceSnapshot) {
  return [...new Set(snapshot.versions.map((version) => version.category))]
    .sort((left, right) => left.localeCompare(right, "zh-TW"));
}
