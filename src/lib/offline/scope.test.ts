import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { assertOfflineCareScope } from "./scope";
const actor = { organizationId: "org", branchId: "branch", userId: "user" } as TenantContext;
describe("offline replay actor boundary", () => {
  it("keeps normal online requests compatible", () => expect(() => assertOfflineCareScope(new Request("https://local.invalid"), actor)).not.toThrow());
  it("accepts only complete matching actor scope", () => {
    const headers = { "x-care-organization": "org", "x-care-branch": "branch", "x-care-user": "user" };
    expect(() => assertOfflineCareScope(new Request("https://local.invalid", { headers }), actor)).not.toThrow();
    for (const key of Object.keys(headers)) {
      expect(() => assertOfflineCareScope(new Request("https://local.invalid", { headers: { ...headers, [key]: "other" } }), actor)).toThrow(/分支已變更/u);
    }
    expect(() => assertOfflineCareScope(new Request("https://local.invalid", { headers: { "x-care-user": "user" } }), actor)).toThrow();
  });
});
