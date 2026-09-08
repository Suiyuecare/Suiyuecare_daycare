export const MEAL_KINDS = [
  "breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner",
] as const;
export const MEAL_TEXTURE_STATES = ["recorded", "missing", "not_applicable"] as const;
export const MEAL_DISCLOSURE_STATES = ["recorded", "none_declared", "unknown"] as const;
export const MEAL_CONFLICT_FILTERS = ["all", "with_conflicts", "clear"] as const;

export type MealKind = (typeof MEAL_KINDS)[number];
export type MealTextureState = (typeof MEAL_TEXTURE_STATES)[number];
export type MealDisclosureState = (typeof MEAL_DISCLOSURE_STATES)[number];
export type MealConflictFilter = (typeof MEAL_CONFLICT_FILTERS)[number];

export type MealReferenceItem = { code: string; label: string };

export type MealManagementFilters = {
  serviceDate: string;
  mealKind: "all" | MealKind;
  textureQuery: string;
  conflict: MealConflictFilter;
};

export type MealClientOption = {
  clientId: string;
  clientCode: string;
  displayName: string;
  requirementVersionId: string | null;
  requirementVersion: number | null;
  effectiveFrom: string | null;
  textureState: MealTextureState | null;
  textureLabel: string | null;
  allergyStatus: MealDisclosureState | null;
  allergens: readonly MealReferenceItem[];
  contraindicationStatus: MealDisclosureState | null;
  contraindications: readonly MealReferenceItem[];
};

export type MealConflict = {
  key: string;
  kind: "requirement_missing" | "texture_missing" | "allergy_unknown" |
    "contraindication_unknown" | "allergen_match" | "contraindication_match";
  clientId: string;
  itemCode: string | null;
  label: string;
};

export type MealAssignment = {
  clientId: string;
  clientCode: string;
  clientDisplayName: string;
  requirementVersionId: string | null;
  textureState: MealTextureState | null;
  textureLabel: string | null;
  allergyStatus: MealDisclosureState | null;
  allergenLabels: readonly string[];
  contraindicationStatus: MealDisclosureState | null;
  contraindicationLabels: readonly string[];
  plannedPortions: number;
  actualPortions: number | null;
  conflicts: readonly MealConflict[];
  resolutionStatus: "not_required" | "pending" | "resolved";
};

export type MealPlan = {
  planVersionId: string;
  planKey: string;
  version: number;
  previousVersionId: string | null;
  status: "review" | "prepared";
  serviceDate: string;
  mealKind: MealKind;
  menuTitle: string;
  ingredients: readonly MealReferenceItem[];
  attendanceCount: number;
  extraPlannedPortions: number;
  plannedPortionTotal: number;
  extraActualPortions: number | null;
  actualPortionTotal: number | null;
  conflictCount: number;
  attendanceSnapshotHash: string;
  varianceReason: string | null;
  createdByDisplayName: string;
  createdAt: string;
  assignments: readonly MealAssignment[];
};

export type MealManagementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: MealManagementFilters;
  clients: readonly MealClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  plans: readonly MealPlan[];
  matchingPlanTotal: number;
  plansTruncated: boolean;
  expectedPortionTotal: number;
  actualPortionTotal: number;
  specialTextureTotal: number | null;
  conflictTotal: number;
  attendanceReconciliationStatus: "available";
  textureTaxonomyStatus: "manual_unstandardized";
  offlineStatus: "not_configured";
  exportStatus: "not_configured";
  demo: boolean;
};

type VersionExpectation = {
  previousVersionId: string | null;
  expectedVersion: number;
  idempotencyKey: string;
};

export type SetMealRequirementInput = VersionExpectation & {
  action: "set_requirement";
  clientId: string;
  effectiveFrom: string;
  textureState: MealTextureState;
  textureLabel: string | null;
  allergyStatus: MealDisclosureState;
  allergens: readonly MealReferenceItem[];
  contraindicationStatus: MealDisclosureState;
  contraindications: readonly MealReferenceItem[];
  note: string | null;
};

export type SaveMealPlanInput = VersionExpectation & {
  action: "save_plan";
  serviceDate: string;
  mealKind: MealKind;
  menuTitle: string;
  ingredients: readonly MealReferenceItem[];
  extraPortions: number;
};

export type CompleteMealPlanInput = {
  action: "complete_plan";
  planVersionId: string;
  expectedVersion: number;
  resolutions: readonly {
    conflictKey: string;
    disposition: "verified_safe" | "substituted" | "excluded";
    note: string;
  }[];
  actualPortions: readonly { clientId: string; portions: number }[];
  extraActualPortions: number;
  varianceReason: string | null;
  idempotencyKey: string;
};

export type MealMutationInput = SetMealRequirementInput | SaveMealPlanInput |
  CompleteMealPlanInput;

export type MealMutationReceipt = {
  operationId: string;
  action: MealMutationInput["action"];
  entityType: "requirement" | "plan";
  entityId: string;
  stableKey: string;
  version: number;
  status: "recorded" | "review" | "prepared";
  clientId: string | null;
  serviceDate: string | null;
  mealKind: MealKind | null;
  attendanceCount: number | null;
  conflictCount: number | null;
  plannedPortionTotal: number | null;
  actualPortionTotal: number | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
