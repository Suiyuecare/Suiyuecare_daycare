/** Approved by the institution: Wanhua direct ledger only, beginning July 2026. */
export const WANHUA_FINANCE_POLICY = {
  version: "wanhua-j1101-e6-ledger-2026-07-v1",
  entityId: "E6",
  departmentCode: "J1101",
  startsMonth: "2026-07",
  incomeAccountGroups: ["4", "7"],
  expenseAccountGroups: ["5", "6", "9"],
  scopeBasis: "department_direct_only",
  nettingBasis: "source_ledger_net",
  label: "帳本分錄，非已結帳",
} as const;

export function isApprovedWanhuaFinanceBinding(value: { entityId: string; departmentCode: string }) {
  return value.entityId === WANHUA_FINANCE_POLICY.entityId &&
    value.departmentCode === WANHUA_FINANCE_POLICY.departmentCode;
}
