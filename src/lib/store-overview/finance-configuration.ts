import { z } from "zod";

export const FINANCE_CONFIGURATION_FIELDS = [
  "FINANCE_STORE_SUMMARY_URL", "FINANCE_STORE_SUMMARY_TOKEN", "FINANCE_STORE_ORGANIZATION_ID",
  "FINANCE_STORE_BRANCH_ID", "FINANCE_STORE_ENTITY_ID",
] as const;
export type FinanceConfigurationField = typeof FINANCE_CONFIGURATION_FIELDS[number];
export type FinanceConfigurationInput = Partial<Record<FinanceConfigurationField, string>>;

export const financeConnectionSchema = z.object({
  url: z.string().regex(/^https:\/\/[a-z]{20}\.supabase\.co\/functions\/v1\/daycare-store-finance-summary$/u),
  token: z.string().regex(/^[a-f0-9]{64}$/u),
  organizationId: z.uuid(), branchId: z.uuid(),
  entityId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/u),
});
export type FinanceConnection = z.infer<typeof financeConnectionSchema>;

const fields = {
  FINANCE_STORE_SUMMARY_URL: "url", FINANCE_STORE_SUMMARY_TOKEN: "token",
  FINANCE_STORE_ORGANIZATION_ID: "organizationId", FINANCE_STORE_BRANCH_ID: "branchId",
  FINANCE_STORE_ENTITY_ID: "entityId",
} as const;

/** Configuration values are consumed only on the server. Never send this result to a component. */
export function financeConnection(source: FinanceConfigurationInput): FinanceConnection | null {
  const parsed = financeConnectionSchema.safeParse(Object.fromEntries(
    FINANCE_CONFIGURATION_FIELDS.map((key) => [fields[key], source[key]]),
  ));
  return parsed.success ? parsed.data : null;
}

export type FinanceConfigurationCheck = {
  status: "missing" | "invalid" | "scope_mismatch" | "configured_unverified";
  missing: FinanceConfigurationField[];
  invalid: FinanceConfigurationField[];
  /** Syntax checks cannot establish endpoint availability or financial reconciliation. */
  connectionVerified: false;
};

/** Allowlisted field names and status only: never return URLs, IDs, keys or Zod errors. */
export function inspectFinanceConfiguration(source: FinanceConfigurationInput,
  scope?: { organizationId: string; branchId: string }): FinanceConfigurationCheck {
  const missing: FinanceConfigurationField[] = [];
  const invalid: FinanceConfigurationField[] = [];
  for (const key of FINANCE_CONFIGURATION_FIELDS) {
    const value = source[key];
    if (value === undefined || (typeof value === "string" && value.trim() === "")) missing.push(key);
    else if (!financeConnectionSchema.shape[fields[key]].safeParse(value).success) invalid.push(key);
  }
  const connection = financeConnection(source);
  const status = invalid.length ? "invalid" : missing.length ? "missing"
    : scope && connection && (connection.organizationId !== scope.organizationId || connection.branchId !== scope.branchId)
      ? "scope_mismatch" : "configured_unverified";
  return { status, missing, invalid, connectionVerified: false };
}
