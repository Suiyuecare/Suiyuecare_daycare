import { describe, expect, it } from "vitest";

import {
  ClientDirectoryContractError,
  parseClientDirectoryPage,
} from "./directory-contract";

const organizationId = "84710000-0000-4000-8000-000000000001";
const branchId = "84720000-0000-4000-8000-000000000001";

function row(overrides: Record<string, unknown> = {}) {
  return {
    client_id: "84750000-0000-4000-8000-000000000001",
    organization_id: organizationId,
    branch_id: branchId,
    client_code: "A-001",
    display_name: "第一個案",
    status: "active",
    admitted_on: null,
    ended_on: null,
    row_version: 1,
    updated_at: "2026-09-01T04:00:00.000Z",
    visible_count: 2,
    has_more: true,
    ...overrides,
  };
}

describe("client directory result contract", () => {
  it("accepts only the bounded minimum row and projects pending lifecycle inputs", () => {
    expect(
      parseClientDirectoryPage({
        value: [row()],
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        pageSize: 1,
      }),
    ).toEqual({
      rows: [{
        id: "84750000-0000-4000-8000-000000000001",
        organization_id: organizationId,
        branch_id: branchId,
        client_code: "A-001",
        display_name: "第一個案",
        status: "active",
        admitted_on: null,
        ended_on: null,
        row_version: 1,
        updated_at: "2026-09-01T04:00:00.000Z",
      }],
      visibleCount: 2,
      hasMore: true,
    });
  });

  it.each([
    [row({ date_of_birth: "1940-01-01" })],
    [row({ organization_id: crypto.randomUUID() })],
    [row({ visible_count: 1, has_more: true })],
    [row({ row_version: 0 })],
    [row({ admitted_on: "2026-02-30" })],
  ])("rejects widened, cross-scope, inconsistent, or malformed RPC rows", (value) => {
    expect(() =>
      parseClientDirectoryPage({
        value,
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        pageSize: 1,
      }),
    ).toThrow(ClientDirectoryContractError);
  });

  it("treats an empty exact projection as no visible client", () => {
    expect(
      parseClientDirectoryPage({
        value: [],
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        pageSize: 1,
      }),
    ).toEqual({ rows: [], visibleCount: 0, hasMore: false });
  });
});
