import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  REASSURANCE_CALENDAR_CATEGORIES,
  REASSURANCE_CALENDAR_STATUSES,
  type ReassuranceCalendarItem,
  type ReassuranceCalendarSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positive = count.refine((value) => value > 0);
const single = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const audience = z.object({
  target_kind: z.enum(["branch", "client"]),
  target_id: uuid,
  display_name: single(200),
  client_code: z.string().min(1).max(120).optional(),
}).strict();
const history = z.object({
  version_id: uuid, version: positive, previous_version_id: uuid.nullable(),
  record_kind: z.enum(["original", "revision", "cancellation"]),
  reason: narrative(500).nullable(), status: z.enum(REASSURANCE_CALENDAR_STATUSES),
  published_at: timestamp, publisher_display_name: single(120), content_hash: hash,
}).strict();
const item = z.object({
  version_id: uuid, event_key: uuid, version: positive,
  previous_version_id: uuid.nullable(),
  record_kind: z.enum(["original", "revision", "cancellation"]),
  revision_reason: narrative(500).nullable(),
  category: z.enum(REASSURANCE_CALENDAR_CATEGORIES),
  title: single(200), summary: narrative(2000), starts_at: timestamp,
  ends_at: timestamp, location: single(200),
  audience_kind: z.enum(["all_branch_clients", "selected_clients"]),
  audience: z.array(audience).min(1).max(200),
  responsible_user_id: uuid, responsible_display_name: single(120),
  status: z.enum(REASSURANCE_CALENDAR_STATUSES),
  cancellation_reason: narrative(500).nullable(),
  publication_state: z.literal("published"),
  publisher_display_name: single(120), published_at: timestamp,
  signature_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
  notification_delivery: z.literal("none_not_sent"),
  history: z.array(history).min(1).max(100),
}).strict();
const source = z.object({
  organization_id: uuid, organization_name: single(160),
  branch_id: uuid, branch_name: single(160), generated_at: timestamp,
  snapshot_token: hash, month_start: date,
  items: z.array(item).max(200), matching_total: count,
  scheduled_total: count, cancelled_total: count, today_total: count,
  upcoming_total: count, items_truncated: z.boolean(),
  category_options: z.array(z.enum(REASSURANCE_CALENDAR_CATEGORIES)).max(5),
  staff_options: z.array(z.object({
    user_id: uuid, display_name: single(120),
  }).strict()).max(200),
  client_options: z.array(z.object({
    client_id: uuid, display_name: single(120), client_code: single(120),
  }).strict()).max(200),
  can_manage: z.boolean(), can_cancel: z.boolean(),
  publication_boundary: z.literal("published_versions_only"),
  signature_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
  notification_delivery: z.literal("none_not_sent"),
}).strict();

export type ReassuranceCalendarSnapshotSourceRow = z.input<typeof source>;

function invalid(): never { throw new Error("INVALID_REASSURANCE_CALENDAR_PROJECTION"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }

function monthDays(monthStart: string, items: readonly ReassuranceCalendarItem[]) {
  const [year, month] = monthStart.split("-").map(Number);
  if (!year || !month) invalid();
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: total }, (_, index) => {
    const day = index + 1;
    const value = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    const starts = Date.parse(`${value}T00:00:00+08:00`);
    const next = starts + 86_400_000;
    return {
      date: value, day, inMonth: true as const,
      events: items.filter((entry) =>
        Date.parse(entry.startsAt) < next && Date.parse(entry.endsAt) >= starts),
    };
  });
  const calendarKeys = new Set(days.flatMap((day) => day.events.map((entry) => entry.eventKey)));
  if (calendarKeys.size !== items.length || items.some((entry) => !calendarKeys.has(entry.eventKey))) invalid();
  return days;
}

export function projectReassuranceCalendarSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedMonth: string;
  expectedCanManage: boolean;
  expectedCanCancel: boolean;
  demo: boolean;
}): ReassuranceCalendarSnapshot {
  const parsed = source.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
      row.month_start !== `${input.expectedMonth}-01` ||
      row.can_manage !== input.expectedCanManage || row.can_cancel !== input.expectedCanCancel ||
      !unique(row.items.map((value) => value.event_key)) ||
      !unique(row.category_options) || !unique(row.staff_options.map((value) => value.user_id)) ||
      !unique(row.client_options.map((value) => value.client_id)) ||
      row.matching_total < row.items.length ||
      row.items_truncated !== (row.matching_total > row.items.length) ||
      row.scheduled_total + row.cancelled_total !== row.matching_total ||
      row.today_total > row.matching_total || row.upcoming_total > row.scheduled_total) invalid();

  const items = row.items.map((value): ReassuranceCalendarItem => {
    if (value.ends_at <= value.starts_at ||
        (value.status === "cancelled") !== (value.cancellation_reason !== null) ||
        (value.record_kind === "cancellation") !== (value.status === "cancelled") ||
        (value.version === 1) !== (value.previous_version_id === null) ||
        (value.version === 1) !== (value.record_kind === "original") ||
        value.history[0]?.version_id !== value.version_id ||
        value.history[0]?.version !== value.version ||
        value.history.some((entry, index, all) =>
          index > 0 && entry.version >= all[index - 1]!.version) ||
        value.history.at(-1)?.version !== 1 ||
        (value.audience_kind === "all_branch_clients" &&
          (value.audience.length !== 1 || value.audience[0]?.target_kind !== "branch")) ||
        (value.audience_kind === "selected_clients" &&
          value.audience.some((entry) => entry.target_kind !== "client"))) invalid();
    return {
      versionId: value.version_id, eventKey: value.event_key,
      version: value.version, previousVersionId: value.previous_version_id,
      recordKind: value.record_kind, revisionReason: value.revision_reason,
      category: value.category, title: value.title, summary: value.summary,
      startsAt: value.starts_at, endsAt: value.ends_at, location: value.location,
      audienceKind: value.audience_kind,
      audience: value.audience.map((target) => ({
        targetKind: target.target_kind, targetId: target.target_id,
        displayName: target.display_name, clientCode: target.client_code ?? null,
      })),
      responsibleUserId: value.responsible_user_id,
      responsibleDisplayName: value.responsible_display_name,
      status: value.status, cancellationReason: value.cancellation_reason,
      publicationState: value.publication_state,
      publisherDisplayName: value.publisher_display_name,
      publishedAt: value.published_at, signatureStatus: value.signature_status,
      notificationStatus: value.notification_status,
      notificationDelivery: value.notification_delivery,
      history: value.history.map((entry) => ({
        versionId: entry.version_id, version: entry.version,
        previousVersionId: entry.previous_version_id,
        recordKind: entry.record_kind, reason: entry.reason, status: entry.status,
        publishedAt: entry.published_at,
        publisherDisplayName: entry.publisher_display_name,
        contentHash: entry.content_hash,
      })),
    };
  });
  if (!row.items_truncated && (
    items.filter((value) => value.status === "scheduled").length !== row.scheduled_total ||
    items.filter((value) => value.status === "cancelled").length !== row.cancelled_total
  )) invalid();
  const calendarDays = monthDays(row.month_start, items);
  return {
    organizationId: row.organization_id, organizationName: row.organization_name,
    branchId: row.branch_id, branchName: row.branch_name,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    snapshotToken: row.snapshot_token, monthStart: row.month_start, items,
    calendarDays, matchingTotal: row.matching_total,
    metrics: { scheduled: row.scheduled_total, cancelled: row.cancelled_total,
      today: row.today_total, upcoming: row.upcoming_total },
    itemsTruncated: row.items_truncated, categoryOptions: row.category_options,
    staffOptions: row.staff_options.map((value) => ({
      userId: value.user_id, displayName: value.display_name,
    })),
    clientOptions: row.client_options.map((value) => ({
      clientId: value.client_id, displayName: value.display_name,
      clientCode: value.client_code,
    })),
    canManage: row.can_manage, canCancel: row.can_cancel,
    publicationBoundary: row.publication_boundary,
    signatureStatus: row.signature_status,
    notificationStatus: row.notification_status,
    notificationDelivery: row.notification_delivery, demo: input.demo,
  };
}
