export const INVENTORY_MOVEMENT_TYPES = [
  "receipt", "issue", "return", "adjustment", "client_issue", "stocktake",
] as const;
export const INVENTORY_EXPIRY_FILTERS = [
  "all", "valid", "near_expiry", "expired",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
export type InventoryMovementFilter = "all" | InventoryMovementType;
export type InventoryExpiryStatus = "valid" | "near_expiry" | "expired";
export type InventoryExpiryFilter = (typeof INVENTORY_EXPIRY_FILTERS)[number];

export type InventoryFilters = {
  itemId: string | null;
  query: string;
  batchQuery: string;
  expiryStatus: InventoryExpiryFilter;
  movementType: InventoryMovementFilter;
};

export type InventoryItemOption = {
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  status: "active" | "inactive";
  statusLedgerVersion: number;
  totalBalance: string;
  batchCount: number;
  safetyQuantity: string | null;
  isLowStock: boolean | null;
  lastMovementAt: string | null;
};

export type InventoryBatch = {
  batchId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemStatus: "active" | "inactive";
  itemStatusLedgerVersion: number;
  batchNumber: string;
  expiryDate: string;
  unit: string;
  balance: string;
  itemTotalBalance: string;
  ledgerVersion: number;
  movementCount: number;
  latestMovementId: string | null;
  latestMovementType: InventoryMovementType | null;
  latestMovementOccurredAt: string | null;
  lastStocktakeAt: string | null;
  expiryStatus: InventoryExpiryStatus;
  safetyQuantity: string | null;
  isLowStock: boolean | null;
  isNearExpiry: boolean | null;
  isStocktakeDue: boolean | null;
};

export type InventoryMovement = {
  movementId: string;
  itemId: string;
  batchId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  unit: string;
  expiryStatus: InventoryExpiryStatus;
  movementType: InventoryMovementType;
  ledgerVersion: number;
  quantity: string;
  quantityDelta: string;
  balanceAfter: string;
  occurredAt: string;
  originalMovementId: string | null;
  clientScopeVisible: boolean;
  clientId: string | null;
  clientCode: string | null;
  clientDisplayName: string | null;
  instructionReference: string | null;
  issuedToUserId: string | null;
  issuedToDisplayName: string | null;
  purpose: string | null;
  destinationUnit: string | null;
  reason: string | null;
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
};

export type InventoryClientOption = {
  clientId: string;
  clientCode: string;
  displayName: string;
};
export type InventoryStaffOption = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
};
export type InventoryReturnableIssue = {
  originalMovementId: string;
  itemId: string;
  batchId: string;
  movementType: "issue" | "client_issue";
  occurredAt: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  unit: string;
  outstandingQuantity: string;
  clientId: string | null;
  clientCode: string | null;
  clientDisplayName: string | null;
  instructionReference: string | null;
  purpose: string | null;
  destinationUnit: string | null;
};

export type InventoryManagementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: InventoryFilters;
  policyStatus: "not_configured" | "published";
  policyVersion: number | null;
  nearExpiryDays: number | null;
  stocktakeCycleDays: number | null;
  itemOptions: readonly InventoryItemOption[];
  itemTotal: number;
  itemsTruncated: boolean;
  batches: readonly InventoryBatch[];
  batchTotal: number;
  matchingBatchTotal: number;
  matchingItemTotal: number;
  batchesTruncated: boolean;
  movements: readonly InventoryMovement[];
  matchingMovementTotal: number;
  movementsTruncated: boolean;
  clientOptions: readonly InventoryClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  staffOptions: readonly InventoryStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  returnableIssueOptions: readonly InventoryReturnableIssue[];
  returnableIssueTotal: number;
  returnableIssuesTruncated: boolean;
  lowStockTotal: number | null;
  nearExpiryTotal: number | null;
  expiredBatchTotal: number;
  stocktakeDueTotal: number | null;
  supplierProcurement: "not_implemented";
  medicationOrderIntegration: "not_implemented";
  financialAutomation: "not_implemented";
  demo: boolean;
};

export type InventoryItemInput =
  | { action: "create"; itemCode: string; itemName: string; unit: string; idempotencyKey: string }
  | { action: "set_status"; itemId: string; status: "active" | "inactive"; reason: string; expectedStatusLedgerVersion: number; idempotencyKey: string };

export type InventoryItemReceipt = {
  itemId: string;
  organizationId: string;
  branchId: string;
  itemCode: string;
  unit: string;
  status: "active" | "inactive";
  statusLedgerVersion: number;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type InventoryMovementInput = {
  itemId: string;
  batchId: string | null;
  newBatchNumber: string | null;
  newExpiryDate: string | null;
  newUnit: string | null;
  movementType: InventoryMovementType;
  quantity: string | null;
  adjustmentDelta: string | null;
  countedQuantity: string | null;
  originalMovementId: string | null;
  clientId: string | null;
  instructionReference: string | null;
  issuedToUserId: string | null;
  purpose: string | null;
  destinationUnit: string | null;
  reason: string | null;
  occurredAt: string;
  expectedLedgerVersion: number;
  idempotencyKey: string;
};

export type InventoryMovementReceipt = {
  organizationId: string;
  branchId: string;
  itemId: string;
  batchId: string;
  movementId: string;
  movementType: InventoryMovementType;
  ledgerVersion: number;
  quantity: string;
  quantityDelta: string;
  balanceAfter: string;
  occurredAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
