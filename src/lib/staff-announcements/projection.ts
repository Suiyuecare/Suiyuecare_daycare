import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  STAFF_ANNOUNCEMENT_LIFECYCLES,
  type StaffAnnouncementFilters,
  type StaffAnnouncementItem,
  type StaffAnnouncementSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const version = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const text = (max: number) => z.string().min(1).max(max);

const rowSchema = z.object({
  generated_at: timestamp,
  version_id: uuid,
  announcement_key: uuid,
  version,
  version_state: z.enum(["draft", "release", "withdrawal"]),
  title: text(200),
  body: text(10_000),
  publish_at: timestamp,
  expires_at: timestamp.nullable(),
  lifecycle: z.enum(STAFF_ANNOUNCEMENT_LIFECYCLES),
  has_pending_draft: z.boolean(),
  audience_user_ids: z.array(uuid).max(500),
  audience_role_ids: z.array(uuid).max(500),
  active_release_version_id: uuid.nullable(),
  active_release_version: version.nullable(),
  active_release_title: text(200).nullable(),
  active_release_body: text(10_000).nullable(),
  active_release_publish_at: timestamp.nullable(),
  active_release_expires_at: timestamp.nullable(),
  recipient_count: count,
  read_count: count,
  unread_count: count,
  actor_is_recipient: z.boolean(),
  actor_read_at: timestamp.nullable(),
  withdrawal_reason: text(1_000).nullable(),
  can_manage: z.boolean(),
}).strict();

const staffOptionSchema = z.object({
    user_id: uuid,
    display_name: text(120),
    employee_code: z.string().max(120).nullable(),
    profile_kind: z.enum(["staff", "professional", "driver", "finance"]),
  }).strict();
const roleOptionSchema = z.object({
    role_id: uuid,
    role_name: text(120),
  }).strict();
const audienceSchema = z.object({
  generated_at: timestamp,
  staff_options: z.array(staffOptionSchema).max(500),
  role_options: z.array(roleOptionSchema).max(100),
}).strict();

const recipientSchema = z.object({
  recipient_user_id: uuid,
  recipient_display_name: text(120),
  recipient_employee_code: z.string().max(120).nullable(),
  recipient_profile_kind: z.enum(["staff", "professional", "driver", "finance"]),
  resolution_kind: z.enum(["direct", "role", "direct_and_role"]),
  read_at: timestamp.nullable(),
}).strict();

const summarySchema = z.object({
  available_total: count,
  items_truncated: z.boolean(),
  draft_total: count,
  unreleased_total: count,
  scheduled_total: count,
  published_total: count,
  expired_total: count,
  withdrawn_total: count,
  unread_recipient_total: count,
}).strict();

const managementSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  announcements: z.array(rowSchema).max(100),
  summary: summarySchema,
  staff_options: z.array(staffOptionSchema).max(500),
  role_options: z.array(roleOptionSchema).max(100),
  selected_release_version_id: uuid.nullable(),
  selected_recipients: z.array(recipientSchema).max(500),
  can_manage: z.boolean(),
  delivery_boundary: z.literal("staff_portal_read_receipts_only"),
  expiry_rule: z.literal("explicit_datetime_or_explicit_no_expiry"),
}).strict();

export type StaffAnnouncementSourceRow = z.input<typeof rowSchema>;
export type StaffAnnouncementAudienceSourceRow = z.input<typeof audienceSchema>;
export type StaffAnnouncementRecipientSourceRow = z.input<typeof recipientSchema>;
export type StaffAnnouncementManagementSourceRow = z.input<typeof managementSchema>;

function invalid(): never {
  throw new Error("INVALID_STAFF_ANNOUNCEMENT_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function expectedLifecycle(item: z.output<typeof rowSchema>) {
  if (item.active_release_version_id === null) return "draft";
  if (item.withdrawal_reason !== null) return "withdrawn";
  if (item.generated_at < item.active_release_publish_at!) return "scheduled";
  if (item.active_release_expires_at !== null && item.generated_at >= item.active_release_expires_at) {
    return "expired";
  }
  return "published";
}

function projectItem(row: z.output<typeof rowSchema>, expectedCanManage: boolean): StaffAnnouncementItem {
  const releaseValues = [
    row.active_release_version_id, row.active_release_version,
    row.active_release_title, row.active_release_body, row.active_release_publish_at,
  ];
  const hasRelease = row.active_release_version_id !== null;
  if (
    row.can_manage !== expectedCanManage ||
    releaseValues.some((value) => (value !== null) !== hasRelease) ||
    row.read_count + row.unread_count !== row.recipient_count ||
    (!hasRelease && (
      row.active_release_expires_at !== null || row.recipient_count !== 0 ||
      row.read_count !== 0 || row.unread_count !== 0 || row.actor_is_recipient ||
      row.actor_read_at !== null || row.withdrawal_reason !== null
    )) ||
    !unique(row.audience_user_ids) || !unique(row.audience_role_ids) ||
    (!expectedCanManage && (row.audience_user_ids.length > 0 || row.audience_role_ids.length > 0)) ||
    (row.actor_read_at !== null && !row.actor_is_recipient) ||
    row.lifecycle !== expectedLifecycle(row) ||
    (row.lifecycle === "withdrawn") !== (row.withdrawal_reason !== null) ||
    (row.has_pending_draft && (
      !expectedCanManage || row.version_state !== "draft" || !hasRelease ||
      row.lifecycle === "withdrawn"
    )) ||
    (!expectedCanManage && (
      row.version_id !== row.active_release_version_id ||
      row.version !== row.active_release_version || row.version_state !== "release" ||
      row.title !== row.active_release_title || row.body !== row.active_release_body ||
      row.publish_at !== row.active_release_publish_at || row.expires_at !== row.active_release_expires_at ||
      !row.actor_is_recipient || row.lifecycle === "scheduled" || row.lifecycle === "withdrawn"
    ))
  ) invalid();
  return {
    versionId: row.version_id, announcementKey: row.announcement_key,
    version: row.version, versionState: row.version_state, title: row.title,
    body: row.body, publishAt: row.publish_at, expiresAt: row.expires_at,
    lifecycle: row.lifecycle, hasPendingDraft: row.has_pending_draft,
    audienceUserIds: row.audience_user_ids,
    audienceRoleIds: row.audience_role_ids,
    activeReleaseVersionId: row.active_release_version_id,
    activeReleaseVersion: row.active_release_version,
    activeReleaseTitle: row.active_release_title,
    activeReleaseBody: row.active_release_body,
    activeReleasePublishAt: row.active_release_publish_at,
    activeReleaseExpiresAt: row.active_release_expires_at,
    recipientCount: row.recipient_count, readCount: row.read_count,
    unreadCount: row.unread_count, actorIsRecipient: row.actor_is_recipient,
    actorReadAt: row.actor_read_at, withdrawalReason: row.withdrawal_reason,
  };
}

function metrics(items: readonly StaffAnnouncementItem[]) {
  return {
    drafts: items.filter((item) => item.versionState === "draft").length,
    scheduled: items.filter((item) => item.lifecycle === "scheduled").length,
    published: items.filter((item) => item.lifecycle === "published").length,
    expired: items.filter((item) => item.lifecycle === "expired").length,
    withdrawn: items.filter((item) => item.lifecycle === "withdrawn").length,
    unreadRecipients: items.reduce((sum, item) => sum + item.unreadCount, 0),
  };
}

export function projectStaffAnnouncementSnapshot(input: {
  rows: readonly unknown[];
  audienceRow: unknown | null;
  recipientRows: readonly unknown[];
  selectedReleaseId: string | null;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanManage: boolean;
  generatedAtFallback: string;
  demo: boolean;
}): StaffAnnouncementSnapshot {
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  const fallback = timestamp.safeParse(input.generatedAtFallback);
  const rows = z.array(rowSchema).max(100).safeParse(input.rows);
  if (!organization.success || !branch.success || !fallback.success || !rows.success) invalid();
  const generatedAt = rows.data[0]?.generated_at ?? fallback.data;
  if (rows.data.some((row) => row.generated_at !== generatedAt)) invalid();
  const items = rows.data.map((row) => projectItem(row, input.expectedCanManage));
  if (!unique(items.map((item) => item.versionId)) || !unique(items.map((item) => item.announcementKey))) invalid();

  const audience = input.expectedCanManage
    ? audienceSchema.safeParse(input.audienceRow)
    : null;
  if (input.expectedCanManage && !audience?.success) invalid();
  if (!input.expectedCanManage && input.audienceRow !== null) invalid();
  const audienceStaff = audience?.success ? audience.data.staff_options.map((item) => ({
    userId: item.user_id, displayName: item.display_name,
    employeeCode: item.employee_code, profileKind: item.profile_kind,
  })) : [];
  const audienceRoles = audience?.success ? audience.data.role_options.map((item) => ({
    roleId: item.role_id, roleName: item.role_name,
  })) : [];
  if (!unique(audienceStaff.map((item) => item.userId)) || !unique(audienceRoles.map((item) => item.roleId))) invalid();

  const selectedRelease = input.selectedReleaseId === null
    ? null : uuid.safeParse(input.selectedReleaseId);
  if (selectedRelease !== null && !selectedRelease.success) invalid();
  const recipients = z.array(recipientSchema).max(500).safeParse(input.recipientRows);
  if (!recipients.success || (!input.expectedCanManage && recipients.data.length > 0) ||
    (selectedRelease === null && recipients.data.length > 0) ||
    !unique(recipients.data.map((item) => item.recipient_user_id))) invalid();
  if (selectedRelease?.success) {
    const owner = items.find((item) => item.activeReleaseVersionId === selectedRelease.data);
    if (!owner || recipients.data.length !== owner.recipientCount ||
      recipients.data.filter((item) => item.read_at !== null).length !== owner.readCount) invalid();
  }

  return {
    organizationId: organization.data, branchId: branch.data, generatedAt,
    staleAfter: new Date(new Date(generatedAt).getTime() + 60_000).toISOString(),
    items, availableTotal: items.length, itemsTruncated: false,
    metrics: metrics(items), canManage: input.expectedCanManage,
    audienceStaff, audienceRoles,
    selectedReleaseId: selectedRelease?.success ? selectedRelease.data : null,
    selectedRecipients: recipients.data.map((item) => ({
      userId: item.recipient_user_id, displayName: item.recipient_display_name,
      employeeCode: item.recipient_employee_code, profileKind: item.recipient_profile_kind,
      resolutionKind: item.resolution_kind, readAt: item.read_at,
    })),
    demo: input.demo, deliveryBoundary: "staff_portal_read_receipts_only",
    expiryRule: "explicit_datetime_or_explicit_no_expiry",
  };
}

export function projectStaffAnnouncementManagementSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanManage: boolean;
  expectedSelectedReleaseId: string | null;
  demo: boolean;
}) {
  const parsed = managementSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  const selected = input.expectedSelectedReleaseId === null
    ? { success: true as const, data: null }
    : uuid.safeParse(input.expectedSelectedReleaseId);
  if (!parsed.success || !organization.success || !branch.success || !selected.success ||
    parsed.data.organization_id !== organization.data ||
    parsed.data.branch_id !== branch.data ||
    parsed.data.can_manage !== input.expectedCanManage ||
    parsed.data.selected_release_version_id !== selected.data ||
    parsed.data.announcements.some((row) => row.generated_at !== parsed.data.generated_at) ||
    parsed.data.summary.available_total < parsed.data.announcements.length ||
    parsed.data.summary.items_truncated !== (parsed.data.summary.available_total > parsed.data.announcements.length) ||
    parsed.data.summary.unreleased_total + parsed.data.summary.scheduled_total +
      parsed.data.summary.published_total + parsed.data.summary.expired_total +
      parsed.data.summary.withdrawn_total !== parsed.data.summary.available_total ||
    [
      parsed.data.summary.draft_total, parsed.data.summary.unreleased_total,
      parsed.data.summary.scheduled_total, parsed.data.summary.published_total,
      parsed.data.summary.expired_total, parsed.data.summary.withdrawn_total,
    ].some((value) => value > parsed.data.summary.available_total) ||
    (!input.expectedCanManage && (
      parsed.data.staff_options.length > 0 || parsed.data.role_options.length > 0 ||
      parsed.data.selected_recipients.length > 0 || parsed.data.selected_release_version_id !== null
    ))) invalid();
  const projected = projectStaffAnnouncementSnapshot({
    rows: parsed.data.announcements,
    audienceRow: input.expectedCanManage ? {
      generated_at: parsed.data.generated_at,
      staff_options: parsed.data.staff_options,
      role_options: parsed.data.role_options,
    } : null,
    recipientRows: parsed.data.selected_recipients,
    selectedReleaseId: parsed.data.selected_release_version_id,
    expectedOrganizationId: parsed.data.organization_id,
    expectedBranchId: parsed.data.branch_id,
    expectedCanManage: parsed.data.can_manage,
    generatedAtFallback: parsed.data.generated_at,
    demo: input.demo,
  });
  const loaded = metrics(projected.items);
  const summary = parsed.data.summary;
  if (
    loaded.drafts > summary.draft_total || loaded.scheduled > summary.scheduled_total ||
    loaded.published > summary.published_total || loaded.expired > summary.expired_total ||
    loaded.withdrawn > summary.withdrawn_total || loaded.unreadRecipients > summary.unread_recipient_total ||
    (!summary.items_truncated && (
      loaded.drafts !== summary.draft_total || loaded.scheduled !== summary.scheduled_total ||
      loaded.published !== summary.published_total || loaded.expired !== summary.expired_total ||
      loaded.withdrawn !== summary.withdrawn_total || loaded.unreadRecipients !== summary.unread_recipient_total
    ))
  ) invalid();
  return {
    ...projected,
    availableTotal: summary.available_total,
    itemsTruncated: summary.items_truncated,
    metrics: {
      drafts: summary.draft_total,
      scheduled: summary.scheduled_total,
      published: summary.published_total,
      expired: summary.expired_total,
      withdrawn: summary.withdrawn_total,
      unreadRecipients: summary.unread_recipient_total,
    },
  };
}

export function filterStaffAnnouncementSnapshot(
  snapshot: StaffAnnouncementSnapshot,
  filters: StaffAnnouncementFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  const items = snapshot.items.filter((item) =>
    (filters.status === "all" || item.lifecycle === filters.status) &&
    (!query || `${item.title} ${item.body} ${item.activeReleaseTitle ?? ""} ${item.activeReleaseBody ?? ""}`
      .toLocaleLowerCase("zh-TW").includes(query)),
  );
  return { ...snapshot, items };
}
