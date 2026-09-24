import { describe, expect, it } from "vitest";
import { financeConnection, inspectFinanceConfiguration, FINANCE_CONFIGURATION_FIELDS } from "./finance-configuration";

const source = {
  FINANCE_STORE_SUMMARY_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/daycare-store-finance-summary",
  FINANCE_STORE_SUMMARY_TOKEN: "a".repeat(64),
  FINANCE_STORE_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  FINANCE_STORE_BRANCH_ID: "22222222-2222-4222-8222-222222222222",
  FINANCE_STORE_ENTITY_ID: "synthetic-store",
};
const scope = { organizationId: source.FINANCE_STORE_ORGANIZATION_ID, branchId: source.FINANCE_STORE_BRANCH_ID };
describe("Finance configuration preflight without secrets or network", () => {
  it("lists only allowlisted missing names, never assumes a successful connection", () => {
    expect(inspectFinanceConfiguration({})).toEqual({ status: "missing", missing: [...FINANCE_CONFIGURATION_FIELDS], invalid: [], connectionVerified: false });
    expect(financeConnection({})).toBeNull();
  });
  it("shared validation accepts a complete config but explicitly leaves live verification pending", () => {
    expect(inspectFinanceConfiguration(source, scope)).toEqual({ status: "configured_unverified", missing: [], invalid: [], connectionVerified: false });
    expect(financeConnection(source)).toMatchObject({ entityId: "synthetic-store", branchId: scope.branchId });
    const serialized = JSON.stringify(inspectFinanceConfiguration(source, scope));
    for (const value of Object.values(source)) expect(serialized).not.toContain(value);
  });
  it.each([
    ["FINANCE_STORE_SUMMARY_URL", "https://attacker.example/"],
    ["FINANCE_STORE_SUMMARY_URL", `${source.FINANCE_STORE_SUMMARY_URL}?extra=1`],
    ["FINANCE_STORE_SUMMARY_URL", "http://127.0.0.1/"],
    ["FINANCE_STORE_SUMMARY_TOKEN", "private-secret-not-a-token"],
    ["FINANCE_STORE_ORGANIZATION_ID", "invalid-private-org"],
    ["FINANCE_STORE_BRANCH_ID", "invalid-private-branch"],
    ["FINANCE_STORE_ENTITY_ID", "../other"],
  ])("rejects %s and never echoes invalid value", (key, value) => {
    const checked = inspectFinanceConfiguration({ ...source, [key]: value });
    expect(checked.status).toBe("invalid"); expect(checked.invalid).toEqual([key]);
    expect(JSON.stringify(checked)).not.toContain(value);
    expect(financeConnection({ ...source, [key]: value })).toBeNull();
  });
  it("distinguishes missing, whitespace, invalid and scope mismatch", () => {
    expect(inspectFinanceConfiguration({ ...source, FINANCE_STORE_SUMMARY_TOKEN: "  " }).missing).toEqual(["FINANCE_STORE_SUMMARY_TOKEN"]);
    expect(inspectFinanceConfiguration(source, { ...scope, branchId: scope.organizationId }).status).toBe("scope_mismatch");
    expect(inspectFinanceConfiguration(source, { ...scope, organizationId: scope.branchId }).status).toBe("scope_mismatch");
    expect(inspectFinanceConfiguration({ ...source, FINANCE_STORE_SUMMARY_URL: "bad", FINANCE_STORE_SUMMARY_TOKEN: undefined })).toMatchObject({ status: "invalid", missing: ["FINANCE_STORE_SUMMARY_TOKEN"], invalid: ["FINANCE_STORE_SUMMARY_URL"] });
  });
});
