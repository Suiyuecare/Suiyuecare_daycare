import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  MEAL_DISCLOSURE_STATES,
  MEAL_KINDS,
  MEAL_TEXTURE_STATES,
  type MealManagementFilters,
  type MealManagementSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const integer = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const text = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/u),
  label: text(120),
}).strict();
const references = z.array(reference).max(50);
const conflict = z.object({
  key: sha256,
  kind: z.enum([
    "requirement_missing", "texture_missing", "allergy_unknown",
    "contraindication_unknown", "allergen_match", "contraindication_match",
  ]),
  client_id: uuid,
  item_code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/u).nullable(),
  label: text(160),
}).strict();
const assignment = z.object({
  client_id: uuid,
  client_code: text(120),
  client_display_name: text(160),
  requirement_version_id: uuid.nullable(),
  texture_state: z.enum(MEAL_TEXTURE_STATES).nullable(),
  texture_label: text(120).nullable(),
  allergy_status: z.enum(MEAL_DISCLOSURE_STATES).nullable(),
  allergen_labels: z.array(text(120)).max(50),
  contraindication_status: z.enum(MEAL_DISCLOSURE_STATES).nullable(),
  contraindication_labels: z.array(text(120)).max(50),
  planned_portions: z.literal(1),
  conflicts: z.array(conflict).max(250),
}).strict();
const resolution = z.object({
  conflict_key: sha256,
  disposition: z.enum(["verified_safe", "substituted", "excluded"]),
  note: text(1_000),
}).strict();
const actual = z.object({
  client_id: uuid,
  portions: z.number().int().min(0).max(5),
}).strict();
const client = z.object({
  client_id: uuid,
  client_code: text(120),
  display_name: text(160),
  requirement_version_id: uuid.nullable(),
  requirement_version: positiveInteger.nullable(),
  effective_from: date.nullable(),
  texture_state: z.enum(MEAL_TEXTURE_STATES).nullable(),
  texture_label: text(120).nullable(),
  allergy_status: z.enum(MEAL_DISCLOSURE_STATES).nullable(),
  allergens: references,
  contraindication_status: z.enum(MEAL_DISCLOSURE_STATES).nullable(),
  contraindications: references,
}).strict();
const plan = z.object({
  plan_version_id: uuid,
  plan_key: uuid,
  version: positiveInteger,
  previous_version_id: uuid.nullable(),
  status: z.enum(["review", "prepared"]),
  service_date: date,
  meal_kind: z.enum(MEAL_KINDS),
  menu_title: text(160),
  ingredients: references.min(1),
  attendance_count: integer,
  extra_planned_portions: z.number().int().min(0).max(100),
  planned_portion_total: integer,
  extra_actual_portions: z.number().int().min(0).max(100).nullable(),
  actual_portion_total: integer.nullable(),
  conflict_count: integer,
  attendance_snapshot_hash: sha256,
  variance_reason: text(1_000).nullable(),
  created_by_display_name: text(120),
  created_at: timestamp,
  assignment_snapshot: z.array(assignment).max(500),
  conflict_snapshot: z.array(conflict).max(500),
  resolution_snapshot: z.array(resolution).max(500).nullable(),
  actual_portions: z.array(actual).max(500).nullable(),
}).strict();
const source = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  clients: z.array(client).max(200),
  client_total: integer,
  clients_truncated: z.boolean(),
  plans: z.array(plan).max(100),
  matching_plan_total: integer,
  plans_truncated: z.boolean(),
  expected_portion_total: integer,
  actual_portion_total: integer,
  special_texture_total: z.null(),
  conflict_total: integer,
  attendance_reconciliation_status: z.literal("available"),
  texture_taxonomy_status: z.literal("manual_unstandardized"),
  offline_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
}).strict();

export type MealManagementSnapshotSourceRow = z.input<typeof source>;

function invalid(): never {
  throw new Error("INVALID_MEAL_MANAGEMENT_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function checkDisclosure(
  status: "recorded" | "none_declared" | "unknown" | null,
  itemCount: number,
) {
  return status === null ? itemCount === 0 :
    status === "recorded" ? itemCount > 0 : itemCount === 0;
}

function checkClientRequirement(item: z.output<typeof client>) {
  const dependent = [item.requirement_version, item.effective_from,
    item.texture_state, item.allergy_status, item.contraindication_status];
  if (item.requirement_version_id === null) {
    return dependent.every((value) => value === null) && item.texture_label === null &&
      item.allergens.length === 0 && item.contraindications.length === 0;
  }
  return dependent.every((value) => value !== null) &&
    ((item.texture_state === "recorded") === (item.texture_label !== null)) &&
    checkDisclosure(item.allergy_status, item.allergens.length) &&
    checkDisclosure(item.contraindication_status, item.contraindications.length) &&
    unique(item.allergens.map(({ code }) => code)) &&
    unique(item.contraindications.map(({ code }) => code));
}

function checkAssignmentRequirement(item: z.output<typeof assignment>) {
  const dependent = [item.texture_state, item.allergy_status,
    item.contraindication_status];
  if (item.requirement_version_id === null) {
    return dependent.every((value) => value === null) && item.texture_label === null &&
      item.allergen_labels.length === 0 && item.contraindication_labels.length === 0 &&
      item.conflicts.some(({ kind }) => kind === "requirement_missing");
  }
  return dependent.every((value) => value !== null) &&
    ((item.texture_state === "recorded") === (item.texture_label !== null)) &&
    checkDisclosure(item.allergy_status, item.allergen_labels.length) &&
    checkDisclosure(item.contraindication_status,
      item.contraindication_labels.length);
}

export function projectMealManagementSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: MealManagementFilters;
  demo: boolean;
}): MealManagementSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    !unique(row.clients.map(({ client_id }) => client_id)) ||
    !unique(row.plans.map(({ plan_version_id }) => plan_version_id)) ||
    row.client_total < row.clients.length ||
    row.clients_truncated !== (row.client_total > row.clients.length) ||
    (row.clients_truncated && row.clients.length !== 200) ||
    row.matching_plan_total < row.plans.length ||
    row.plans_truncated !== (row.matching_plan_total > row.plans.length) ||
    (row.plans_truncated && row.plans.length !== 100) ||
    row.clients.some((item) => !checkClientRequirement(item))) invalid();

  const plans = row.plans.map((item) => {
    const assignments = item.assignment_snapshot;
    const conflicts = item.conflict_snapshot;
    const assignmentConflicts = assignments.flatMap((entry) => entry.conflicts);
    if (item.service_date !== input.filters.serviceDate ||
      (input.filters.mealKind !== "all" &&
        item.meal_kind !== input.filters.mealKind) ||
      item.attendance_count !== assignments.length ||
      item.planned_portion_total !== item.attendance_count +
        item.extra_planned_portions ||
      item.conflict_count !== conflicts.length ||
      !unique(assignments.map(({ client_id }) => client_id)) ||
      !unique(conflicts.map(({ key }) => key)) ||
      assignments.some((entry) => !checkAssignmentRequirement(entry) ||
        entry.conflicts.some(({ client_id }) => client_id !== entry.client_id)) ||
      JSON.stringify(assignmentConflicts) !== JSON.stringify(conflicts) ||
      !unique(item.ingredients.map(({ code }) => code))) invalid();

    const resolutionKeys = item.resolution_snapshot?.map(
      ({ conflict_key }) => conflict_key) ?? [];
    const actualIds = item.actual_portions?.map(({ client_id }) => client_id) ?? [];
    if (item.status === "review") {
      if (item.resolution_snapshot !== null || item.actual_portions !== null ||
        item.extra_actual_portions !== null || item.actual_portion_total !== null ||
        item.variance_reason !== null) invalid();
    } else {
      if (item.resolution_snapshot === null || item.actual_portions === null ||
        item.extra_actual_portions === null || item.actual_portion_total === null ||
        !unique(resolutionKeys) || !unique(actualIds) ||
        resolutionKeys.length !== conflicts.length ||
        conflicts.some(({ key }) => !resolutionKeys.includes(key)) ||
        actualIds.length !== assignments.length ||
        assignments.some(({ client_id }) => !actualIds.includes(client_id)) ||
        item.actual_portion_total !== item.actual_portions.reduce(
          (total, entry) => total + entry.portions, item.extra_actual_portions) ||
        ((item.actual_portion_total === item.attendance_count) !==
          (item.variance_reason === null))) invalid();
    }
    const resolutionSet = new Set(resolutionKeys);
    const actualByClient = new Map(item.actual_portions?.map(
      (entry) => [entry.client_id, entry.portions]) ?? []);
    return {
      planVersionId: item.plan_version_id,
      planKey: item.plan_key,
      version: item.version,
      previousVersionId: item.previous_version_id,
      status: item.status,
      serviceDate: item.service_date,
      mealKind: item.meal_kind,
      menuTitle: item.menu_title,
      ingredients: item.ingredients,
      attendanceCount: item.attendance_count,
      extraPlannedPortions: item.extra_planned_portions,
      plannedPortionTotal: item.planned_portion_total,
      extraActualPortions: item.extra_actual_portions,
      actualPortionTotal: item.actual_portion_total,
      conflictCount: item.conflict_count,
      attendanceSnapshotHash: item.attendance_snapshot_hash,
      varianceReason: item.variance_reason,
      createdByDisplayName: item.created_by_display_name,
      createdAt: item.created_at,
      assignments: assignments.map((entry) => ({
        clientId: entry.client_id,
        clientCode: entry.client_code,
        clientDisplayName: entry.client_display_name,
        requirementVersionId: entry.requirement_version_id,
        textureState: entry.texture_state,
        textureLabel: entry.texture_label,
        allergyStatus: entry.allergy_status,
        allergenLabels: entry.allergen_labels,
        contraindicationStatus: entry.contraindication_status,
        contraindicationLabels: entry.contraindication_labels,
        plannedPortions: entry.planned_portions,
        actualPortions: actualByClient.get(entry.client_id) ?? null,
        conflicts: entry.conflicts.map((entryConflict) => ({
          key: entryConflict.key,
          kind: entryConflict.kind,
          clientId: entryConflict.client_id,
          itemCode: entryConflict.item_code,
          label: entryConflict.label,
        })),
        resolutionStatus: entry.conflicts.length === 0 ? "not_required" as const :
          entry.conflicts.every(({ key }) => resolutionSet.has(key)) ?
            "resolved" as const : "pending" as const,
      })),
    };
  });

  if (!row.plans_truncated && (
    row.expected_portion_total !== plans.reduce(
      (total, item) => total + item.plannedPortionTotal, 0) ||
    row.actual_portion_total !== plans.reduce(
      (total, item) => total + (item.actualPortionTotal ?? 0), 0) ||
    row.conflict_total !== plans.reduce(
      (total, item) => total + item.conflictCount, 0)
  )) invalid();

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    filters: input.filters,
    clients: row.clients.map((item) => ({
      clientId: item.client_id,
      clientCode: item.client_code,
      displayName: item.display_name,
      requirementVersionId: item.requirement_version_id,
      requirementVersion: item.requirement_version,
      effectiveFrom: item.effective_from,
      textureState: item.texture_state,
      textureLabel: item.texture_label,
      allergyStatus: item.allergy_status,
      allergens: item.allergens,
      contraindicationStatus: item.contraindication_status,
      contraindications: item.contraindications,
    })),
    clientTotal: row.client_total,
    clientsTruncated: row.clients_truncated,
    plans,
    matchingPlanTotal: row.matching_plan_total,
    plansTruncated: row.plans_truncated,
    expectedPortionTotal: row.expected_portion_total,
    actualPortionTotal: row.actual_portion_total,
    specialTextureTotal: null,
    conflictTotal: row.conflict_total,
    attendanceReconciliationStatus: row.attendance_reconciliation_status,
    textureTaxonomyStatus: row.texture_taxonomy_status,
    offlineStatus: row.offline_status,
    exportStatus: row.export_status,
    demo: input.demo,
  };
}
