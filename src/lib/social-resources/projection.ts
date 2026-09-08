import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  SOCIAL_RESOURCE_INFORMATION_STATES,
  SOCIAL_RESOURCE_STATUSES,
  SOCIAL_RESOURCE_VALIDITY_STATES,
  type SocialResourceFilters,
  type SocialResourceItem,
  type SocialResourceSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const timestamp = z.string().refine(
  (value) =>
    isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);

const itemSchema = z.object({
  resource_id: uuid,
  reference_year: z.number().int().min(2000).max(2200),
  name: z.string().trim().min(1).max(160),
  resource_type: z.string().trim().min(1).max(80),
  audience_state: z.enum(SOCIAL_RESOURCE_INFORMATION_STATES),
  audience_detail: z.string().trim().min(1).max(500).nullable(),
  eligibility_state: z.enum(SOCIAL_RESOURCE_INFORMATION_STATES),
  eligibility_detail: z.string().trim().min(1).max(2000).nullable(),
  contact_state: z.enum(SOCIAL_RESOURCE_INFORMATION_STATES),
  contact_detail: z.string().trim().min(1).max(1000).nullable(),
  validity_state: z.enum(SOCIAL_RESOURCE_VALIDITY_STATES),
  valid_from: date.nullable(),
  valid_until: date.nullable(),
  last_confirmed_on: date.nullable(),
  status: z.enum(SOCIAL_RESOURCE_STATUSES),
  row_version: positiveInteger,
  updated_at: timestamp,
  expired: z.boolean(),
  effective: z.boolean(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: count,
  effective_total: count,
  pending_confirmation_total: count,
  inactive_total: count,
  expired_total: count,
  items_truncated: z.boolean(),
  type_options: z.array(z.string().trim().min(1).max(80)).max(200),
  audience_options: z.array(z.string().trim().min(1).max(500)).max(200),
  type_options_truncated: z.boolean(),
  audience_options_truncated: z.boolean(),
  expiry_rule_status: z.literal("not_configured"),
  confirmation_rule_status: z.literal("missing_date_only"),
}).strict();

export type SocialResourceSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_SOCIAL_RESOURCE_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function normalizeItem(
  row: z.output<typeof itemSchema>,
  generatedDate: string,
): SocialResourceItem {
  const informationPairs = [
    [row.audience_state, row.audience_detail],
    [row.eligibility_state, row.eligibility_detail],
    [row.contact_state, row.contact_detail],
  ] as const;
  if (
    informationPairs.some(([state, detail]) =>
      state === "provided" ? detail === null : detail !== null,
    ) ||
    (row.validity_state === "date_range" &&
      (row.valid_until === null ||
        (row.valid_from !== null && row.valid_until < row.valid_from))) ||
    (row.validity_state === "open_ended" &&
      (row.valid_from === null || row.valid_until !== null)) ||
    (["not_applicable", "missing"].includes(row.validity_state) &&
      (row.valid_from !== null || row.valid_until !== null)) ||
    (row.last_confirmed_on !== null && row.last_confirmed_on > generatedDate)
  ) invalid();

  const expired =
    row.validity_state === "date_range" &&
    row.valid_until !== null &&
    row.valid_until < generatedDate;
  const effective =
    row.status === "active" &&
    row.validity_state !== "missing" &&
    (row.validity_state === "not_applicable" ||
      ((row.valid_from === null || row.valid_from <= generatedDate) &&
        (row.valid_until === null || row.valid_until >= generatedDate)));
  if (row.expired !== expired || row.effective !== effective) invalid();

  return {
    id: row.resource_id,
    referenceYear: row.reference_year,
    name: row.name,
    resourceType: row.resource_type,
    audienceState: row.audience_state,
    audienceDetail: row.audience_detail,
    eligibilityState: row.eligibility_state,
    eligibilityDetail: row.eligibility_detail,
    contactState: row.contact_state,
    contactDetail: row.contact_detail,
    validityState: row.validity_state,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastConfirmedOn: row.last_confirmed_on,
    status: row.status,
    rowVersion: row.row_version,
    updatedAt: row.updated_at,
    expired,
    effective,
  };
}

export function projectSocialResourceSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): SocialResourceSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const expectedOrganization = uuid.safeParse(input.expectedOrganizationId);
  const expectedBranch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !expectedOrganization.success || !expectedBranch.success) invalid();
  const row = parsed.data;
  if (
    row.organization_id !== expectedOrganization.data ||
    row.branch_id !== expectedBranch.data
  ) invalid();

  const generatedDate = taipeiDate(row.generated_at);
  const items = row.items.map((item) => normalizeItem(item, generatedDate));
  if (
    !unique(items.map((item) => item.id)) ||
    !unique(row.type_options) ||
    !unique(row.audience_options) ||
    (row.type_options_truncated && row.type_options.length !== 200) ||
    (row.audience_options_truncated && row.audience_options.length !== 200) ||
    row.item_total < items.length ||
    row.items_truncated !== (row.item_total > items.length) ||
    (!row.items_truncated && row.item_total !== items.length) ||
    [
      row.effective_total,
      row.pending_confirmation_total,
      row.inactive_total,
      row.expired_total,
    ].some((value) => value > row.item_total) ||
    (!row.type_options_truncated &&
      items.some((item) => !row.type_options.includes(item.resourceType))) ||
    items.some(
      (item) =>
        item.audienceState === "provided" &&
        !row.audience_options_truncated &&
        !row.audience_options.includes(item.audienceDetail!),
    ) ||
    (!row.items_truncated &&
      (items.filter((item) => item.effective).length !== row.effective_total ||
        items.filter(
          (item) => item.status === "active" && item.lastConfirmedOn === null,
        ).length !==
          row.pending_confirmation_total ||
        items.filter((item) => item.status === "inactive").length !==
          row.inactive_total ||
        items.filter((item) => item.expired).length !== row.expired_total))
  ) invalid();

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(),
    items,
    itemTotal: row.item_total,
    metrics: {
      effective: row.effective_total,
      pendingConfirmation: row.pending_confirmation_total,
      inactive: row.inactive_total,
      expired: row.expired_total,
      expiringSoon: null,
    },
    itemsTruncated: row.items_truncated,
    typeOptions: row.type_options,
    audienceOptions: row.audience_options,
    typeOptionsTruncated: row.type_options_truncated,
    audienceOptionsTruncated: row.audience_options_truncated,
    expiryRuleStatus: row.expiry_rule_status,
    confirmationRuleStatus: row.confirmation_rule_status,
    demo: input.demo,
  };
}

export function filterDemoSocialResourceSnapshot(
  snapshot: SocialResourceSnapshot,
  filters: SocialResourceFilters,
): SocialResourceSnapshot {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  const items = snapshot.items.filter((item) =>
    (filters.referenceYear === null || item.referenceYear === filters.referenceYear) &&
    (filters.resourceType === null || item.resourceType === filters.resourceType) &&
    (filters.status === "all" || item.status === filters.status) &&
    (filters.audience === null ||
      (filters.audience === "__missing__" && item.audienceState === "missing") ||
      (filters.audience === "__not_applicable__" && item.audienceState === "not_applicable") ||
      (item.audienceState === "provided" && item.audienceDetail === filters.audience)) &&
    (!query || `${item.name} ${item.resourceType} ${item.audienceDetail ?? ""} ${item.eligibilityDetail ?? ""} ${item.contactDetail ?? ""}`
      .toLocaleLowerCase("zh-TW").includes(query)),
  );
  return {
    ...snapshot,
    items,
    itemTotal: items.length,
    itemsTruncated: false,
    metrics: {
      effective: items.filter((item) => item.effective).length,
      pendingConfirmation: items.filter(
        (item) => item.status === "active" && item.lastConfirmedOn === null,
      ).length,
      inactive: items.filter((item) => item.status === "inactive").length,
      expired: items.filter((item) => item.expired).length,
      expiringSoon: null,
    },
  };
}
