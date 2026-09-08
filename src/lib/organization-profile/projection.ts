import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isOrganizationProfileDate, organizationProfileTaipeiDate } from "./date";
import type {
  OrganizationProfileContent,
  OrganizationProfileFilters,
  OrganizationProfileProposal,
  OrganizationProfileSnapshot,
  OrganizationProfileVersion,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isOrganizationProfileDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.preprocess((value) => typeof value === "string" && /^\d+$/u.test(value)
  ? Number(value) : value, z.number().int().nonnegative().safe());
const service = z.object({
  service_key: uuid, name: clean(160), description: clean(1_000, true).nullable(),
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();
const rate = z.object({
  rate_key: uuid, label: clean(160),
  amount_decimal_text: z.string().regex(/^[0-9]{1,18}(?:\.[0-9]{1,6})?$/u),
  currency_code: z.string().regex(/^[A-Z]{3}$/u),
  effective_from: date, effective_to: date.nullable(),
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();

const contentShape = {
  effective_from: date, effective_to: date.nullable(),
  permit_number: clean(160), permit_issuing_authority: clean(200),
  permit_issued_on: date, permit_valid_through: date.nullable(),
  permit_status_text: clean(160), organization_type_text: clean(160),
  service_items: z.array(service).max(50), rate_items: z.array(rate).max(100),
  approved_capacity: z.number().int().min(1).max(1_000_000).safe(),
  capacity_unit_text: clean(40), capacity_basis_text: clean(500, true),
  contact_name: clean(160), contact_phone: clean(80),
  contact_email: z.string().email().max(254).nullable(),
  contact_address: clean(500, true), change_reason: clean(1_000, true),
  taxonomy_status: z.literal("manual_unstandardized"),
  attachment_pipeline_status: z.literal("not_configured"), content_hash: hash,
};

const versionSchema = z.object({
  version_id: uuid, profile_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  source_proposal_id: uuid, ...contentShape,
  approved_by: uuid, approved_by_display_name: clean(120), approved_at: timestamp,
}).strict();

const historySchema = z.object({
  version_id: uuid, profile_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  source_proposal_id: uuid, effective_from: date, effective_to: date.nullable(),
  content_hash: hash, approved_by_display_name: clean(120), approved_at: timestamp,
  change_reason: clean(1_000, true),
}).strict();

const proposalSchema = z.object({
  proposal_id: uuid, proposal_key: uuid,
  proposal_number: z.number().int().positive().safe(),
  action: z.enum(["create", "correct"]), profile_key: uuid,
  base_version_id: uuid.nullable(),
  expected_base_version: z.number().int().nonnegative().safe(),
  ...contentShape,
  proposed_by: uuid, proposed_by_display_name: clean(120), proposed_at: timestamp,
  status: z.enum(["pending", "approved", "rejected"]),
  decision_id: uuid.nullable(), decision: z.enum(["approve", "reject"]).nullable(),
  decision_reason: clean(1_000, true).nullable(), decided_by: uuid.nullable(),
  decided_by_display_name: clean(120).nullable(), decided_at: timestamp.nullable(),
  result_version_id: uuid.nullable(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  snapshot_date: date, versions: z.array(versionSchema).max(100),
  version_total: count, versions_truncated: z.boolean(),
  history: z.array(historySchema).max(300), history_total: count,
  history_truncated: z.boolean(), proposals: z.array(proposalSchema).max(100),
  proposal_total: count, proposals_truncated: z.boolean(),
  active_version_total: count, pending_proposal_total: count,
  expired_permit_total: count,
  active_capacity: z.number().int().min(1).max(1_000_000).safe().nullable(),
  official_taxonomy_status: z.literal("not_configured"),
  manual_taxonomy_status: z.literal("manual_unstandardized"),
  permit_expiry_reminder_status: z.literal("not_configured"),
  attachment_pipeline_status: z.literal("not_configured"),
  export_status: z.literal("disabled"), regulator_sync_status: z.literal("disabled"),
  offline_status: z.literal("disabled"), recent_aal2_max_age_minutes: z.literal(15),
}).strict();

export type OrganizationProfileSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("ORGANIZATION_PROFILE_SNAPSHOT_INVALID");
}

function overlaps(
  left: { effective_from: string; effective_to: string | null },
  right: { effective_from: string; effective_to: string | null },
) {
  return left.effective_from <= (right.effective_to ?? "9999-12-31") &&
    right.effective_from <= (left.effective_to ?? "9999-12-31");
}

function validateContent(content: z.output<typeof versionSchema> |
  z.output<typeof proposalSchema>) {
  if ((content.effective_to !== null &&
      content.effective_to < content.effective_from) ||
    (content.permit_valid_through !== null &&
      content.permit_valid_through < content.permit_issued_on)) invalid();
  const serviceKeys = content.service_items.map((item) => item.service_key);
  const serviceNames = content.service_items.map((item) =>
    item.name.toLocaleLowerCase("zh-TW"));
  const rateKeys = content.rate_items.map((item) => item.rate_key);
  if (new Set(serviceKeys).size !== serviceKeys.length ||
    new Set(serviceNames).size !== serviceNames.length ||
    new Set(rateKeys).size !== rateKeys.length) invalid();
  for (const [index, item] of content.rate_items.entries()) {
    if (item.effective_to !== null && item.effective_to < item.effective_from) invalid();
    for (const other of content.rate_items.slice(index + 1)) {
      if (item.label.toLocaleLowerCase("zh-TW") ===
          other.label.toLocaleLowerCase("zh-TW") &&
        item.currency_code === other.currency_code && overlaps(item, other)) invalid();
    }
  }
}

function mapContent(content: z.output<typeof versionSchema> |
  z.output<typeof proposalSchema>): OrganizationProfileContent {
  return {
    effectiveFrom: content.effective_from, effectiveTo: content.effective_to,
    permitNumber: content.permit_number,
    permitIssuingAuthority: content.permit_issuing_authority,
    permitIssuedOn: content.permit_issued_on,
    permitValidThrough: content.permit_valid_through,
    permitStatusText: content.permit_status_text,
    organizationTypeText: content.organization_type_text,
    serviceItems: content.service_items.map((item) => ({
      serviceKey: item.service_key, name: item.name,
      description: item.description, taxonomyStatus: item.taxonomy_status,
    })),
    rateItems: content.rate_items.map((item) => ({
      rateKey: item.rate_key, label: item.label,
      amountDecimalText: item.amount_decimal_text,
      currencyCode: item.currency_code, effectiveFrom: item.effective_from,
      effectiveTo: item.effective_to, taxonomyStatus: item.taxonomy_status,
    })),
    approvedCapacity: content.approved_capacity,
    capacityUnitText: content.capacity_unit_text,
    capacityBasisText: content.capacity_basis_text,
    contactName: content.contact_name, contactPhone: content.contact_phone,
    contactEmail: content.contact_email, contactAddress: content.contact_address,
    changeReason: content.change_reason,
    taxonomyStatus: content.taxonomy_status,
    attachmentPipelineStatus: content.attachment_pipeline_status,
    contentHash: content.content_hash,
  };
}

function matchesQuery(value: OrganizationProfileVersion | OrganizationProfileProposal,
  query: string) {
  if (!query) return true;
  const haystack = [value.permitNumber, value.permitIssuingAuthority,
    value.permitStatusText, value.organizationTypeText, value.contactName,
    value.contactPhone, value.contactEmail ?? "", value.contactAddress,
    ...value.serviceItems.flatMap((item) => [item.name, item.description ?? ""]),
    ...value.rateItems.map((item) => item.label),
  ].join("\n").toLocaleLowerCase("zh-TW");
  return haystack.includes(query.toLocaleLowerCase("zh-TW"));
}

export function projectOrganizationProfileSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: OrganizationProfileSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: OrganizationProfileFilters;
  demo: boolean;
}): OrganizationProfileSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.snapshot_date !== organizationProfileTaipeiDate(new Date(row.generated_at)) ||
    row.versions_truncated !== (row.version_total > 100) ||
    row.history_truncated !== (row.history_total > 300) ||
    row.proposals_truncated !== (row.proposal_total > 100) ||
    row.versions.length > row.version_total || row.history.length > row.history_total ||
    row.proposals.length > row.proposal_total || row.active_version_total > 1 ||
    row.pending_proposal_total > row.proposal_total ||
    row.expired_permit_total > row.version_total) invalid();

  const versionIds = new Set<string>();
  const profileKeys = new Set<string>();
  for (const [index, version] of row.versions.entries()) {
    validateContent(version);
    if (versionIds.has(version.version_id) || profileKeys.has(version.profile_key) ||
      (version.version === 1) !== (version.previous_version_id === null) ||
      row.versions.slice(index + 1).some((other) => overlaps(version, other))) invalid();
    versionIds.add(version.version_id); profileKeys.add(version.profile_key);
  }

  const historyIds = new Set<string>();
  for (const history of row.history) {
    if (historyIds.has(history.version_id) ||
      (history.version === 1) !== (history.previous_version_id === null) ||
      (history.effective_to !== null && history.effective_to < history.effective_from)) {
      invalid();
    }
    historyIds.add(history.version_id);
  }
  if (!row.history_truncated && row.versions.some((version) =>
    !row.history.some((history) => history.version_id === version.version_id &&
      history.profile_key === version.profile_key && history.version === version.version &&
      history.content_hash === version.content_hash))) invalid();

  const proposalIds = new Set<string>();
  const proposalKeys = new Set<string>();
  const proposalNumbers = new Set<number>();
  for (const proposal of row.proposals) {
    validateContent(proposal);
    const createContract = proposal.action === "create" &&
      proposal.base_version_id === null && proposal.expected_base_version === 0;
    const correctionContract = proposal.action === "correct" &&
      proposal.base_version_id !== null && proposal.expected_base_version > 0;
    const pendingContract = proposal.status === "pending" &&
      proposal.decision_id === null && proposal.decision === null &&
      proposal.decision_reason === null && proposal.decided_by === null &&
      proposal.decided_by_display_name === null && proposal.decided_at === null &&
      proposal.result_version_id === null;
    const approvedContract = proposal.status === "approved" &&
      proposal.decision_id !== null && proposal.decision === "approve" &&
      proposal.decision_reason !== null && proposal.decided_by !== null &&
      proposal.decided_by_display_name !== null && proposal.decided_at !== null &&
      proposal.result_version_id !== null && proposal.decided_by !== proposal.proposed_by;
    const rejectedContract = proposal.status === "rejected" &&
      proposal.decision_id !== null && proposal.decision === "reject" &&
      proposal.decision_reason !== null && proposal.decided_by !== null &&
      proposal.decided_by_display_name !== null && proposal.decided_at !== null &&
      proposal.result_version_id === null && proposal.decided_by !== proposal.proposed_by;
    if (proposalIds.has(proposal.proposal_id) ||
      proposalKeys.has(proposal.proposal_key) ||
      proposalNumbers.has(proposal.proposal_number) ||
      (!createContract && !correctionContract) ||
      (!pendingContract && !approvedContract && !rejectedContract)) invalid();
    proposalIds.add(proposal.proposal_id); proposalKeys.add(proposal.proposal_key);
    proposalNumbers.add(proposal.proposal_number);
  }
  if (!row.history_truncated && row.proposals.some((proposal) =>
    proposal.status === "approved" && !row.history.some((history) =>
      history.version_id === proposal.result_version_id &&
      history.profile_key === proposal.profile_key &&
      history.content_hash === proposal.content_hash &&
      history.effective_from === proposal.effective_from &&
      history.effective_to === proposal.effective_to))) invalid();

  const active = row.versions.filter((version) =>
    version.effective_from <= row.snapshot_date &&
    (version.effective_to === null || version.effective_to >= row.snapshot_date));
  const expiredPermits = row.versions.filter((version) =>
    version.permit_valid_through !== null &&
    version.permit_valid_through < row.snapshot_date);
  if (!row.versions_truncated && (row.version_total !== row.versions.length ||
    row.active_version_total !== active.length ||
    row.expired_permit_total !== expiredPermits.length ||
    row.active_capacity !== (active[0]?.approved_capacity ?? null))) invalid();
  if (!row.history_truncated && row.history_total !== row.history.length) invalid();
  if (!row.proposals_truncated && (row.proposal_total !== row.proposals.length ||
    row.pending_proposal_total !== row.proposals.filter((item) =>
      item.status === "pending").length)) invalid();

  const versions: OrganizationProfileVersion[] = row.versions.map((version) => ({
    versionId: version.version_id, profileKey: version.profile_key,
    version: version.version, previousVersionId: version.previous_version_id,
    sourceProposalId: version.source_proposal_id, ...mapContent(version),
    approvedBy: version.approved_by,
    approvedByDisplayName: version.approved_by_display_name,
    approvedAt: version.approved_at,
  }));
  const proposals: OrganizationProfileProposal[] = row.proposals.map((proposal) => ({
    proposalId: proposal.proposal_id, proposalKey: proposal.proposal_key,
    proposalNumber: proposal.proposal_number, action: proposal.action,
    profileKey: proposal.profile_key, baseVersionId: proposal.base_version_id,
    expectedBaseVersion: proposal.expected_base_version, ...mapContent(proposal),
    proposedBy: proposal.proposed_by,
    proposedByDisplayName: proposal.proposed_by_display_name,
    proposedAt: proposal.proposed_at, status: proposal.status,
    decisionId: proposal.decision_id, decision: proposal.decision,
    decisionReason: proposal.decision_reason, decidedBy: proposal.decided_by,
    decidedByDisplayName: proposal.decided_by_display_name,
    decidedAt: proposal.decided_at, resultVersionId: proposal.result_version_id,
  }));
  const visibleVersions = versions.filter((version) =>
    matchesQuery(version, filters.query) && (!filters.effectiveOn ||
      (version.effectiveFrom <= filters.effectiveOn &&
        (version.effectiveTo === null || version.effectiveTo >= filters.effectiveOn))));
  const visibleProposals = proposals.filter((proposal) =>
    matchesQuery(proposal, filters.query) &&
    (filters.status === "all" || proposal.status === filters.status));

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters, versions, visibleVersions,
    versionTotal: row.version_total, versionsTruncated: row.versions_truncated,
    history: row.history.map((history) => ({
      versionId: history.version_id, profileKey: history.profile_key,
      version: history.version, previousVersionId: history.previous_version_id,
      sourceProposalId: history.source_proposal_id,
      effectiveFrom: history.effective_from, effectiveTo: history.effective_to,
      contentHash: history.content_hash,
      approvedByDisplayName: history.approved_by_display_name,
      approvedAt: history.approved_at, changeReason: history.change_reason,
    })),
    historyTotal: row.history_total, historyTruncated: row.history_truncated,
    proposals, visibleProposals, proposalTotal: row.proposal_total,
    proposalsTruncated: row.proposals_truncated,
    activeVersionTotal: row.active_version_total,
    pendingProposalTotal: row.pending_proposal_total,
    expiredPermitTotal: row.expired_permit_total,
    activeCapacity: row.active_capacity,
    officialTaxonomyStatus: row.official_taxonomy_status,
    manualTaxonomyStatus: row.manual_taxonomy_status,
    permitExpiryReminderStatus: row.permit_expiry_reminder_status,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    exportStatus: row.export_status, regulatorSyncStatus: row.regulator_sync_status,
    offlineStatus: row.offline_status,
    recentAal2MaxAgeMinutes: row.recent_aal2_max_age_minutes, demo,
  };
}
