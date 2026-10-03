import { describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";

import type { ClientDirectorySupabaseClient } from "./directory";
import { ClientDirectorySnapshotError, loadAllClientDirectoryRows } from "./directory";

vi.mock("server-only", () => ({}));

const context: TenantContext = {
  organizationId: "84710000-0000-4000-8000-000000000001",
  organizationName: "合成機構",
  branchId: "84720000-0000-4000-8000-000000000001",
  branchName: "合成分支",
  userId: "84700000-0000-4000-8000-000000000001",
  displayName: "合成同仁",
  roles: ["care_worker"],
  scopes: ["clients.read"],
  assuranceLevel: "aal1",
  recentAal2At: null,
  demo: false,
};

function syntheticRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    client_id: `84750000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    organization_id: context.organizationId,
    branch_id: context.branchId,
    client_code: `CASE-${String(index + 1).padStart(4, "0")}`,
    display_name: `合成個案 ${index + 1}`,
    status: "active",
    admitted_on: "2026-01-01",
    ended_on: null,
    row_version: 1,
    updated_at: "2026-10-03T01:00:00.000Z",
  }));
}

function syntheticDatabase(count: number) {
  const rows = syntheticRows(count);
  const rpc = vi.fn(async (name: string, args: {
    p_page_size: number;
    p_after_client_code: string | null;
  }) => {
    expect(name).toBe("client_directory_snapshot");
    const offset = args.p_after_client_code
      ? rows.findIndex((row) => row.client_code === args.p_after_client_code) + 1
      : 0;
    const page = rows.slice(offset, offset + args.p_page_size);
    return {
      data: page.map((row) => ({
        ...row,
        visible_count: count,
        has_more: offset + page.length < count,
      })),
      error: null,
    };
  });
  return { rpc, client: { rpc } as unknown as ClientDirectorySupabaseClient };
}

describe("client directory batch size", () => {
  it("reads 501 case-center clients in two bounded keyset calls", async () => {
    const { rpc, client } = syntheticDatabase(501);

    const rows = await loadAllClientDirectoryRows(client, context, "case_center");

    expect(rows).toHaveLength(501);
    expect(rows[0]?.client_code).toBe("CASE-0001");
    expect(rows.at(-1)?.client_code).toBe("CASE-0501");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => [args.p_page_size, args.p_after_client_code]))
      .toEqual([[500, null], [500, "CASE-0500"]]);
  });

  it("keeps other directory purposes at 200 rows per call", async () => {
    const { rpc, client } = syntheticDatabase(201);

    const rows = await loadAllClientDirectoryRows(client, context, "client_registry");

    expect(rows).toHaveLength(201);
    expect(rpc.mock.calls.map(([, args]) => [args.p_page_size, args.p_after_client_code]))
      .toEqual([[200, null], [200, "CASE-0200"]]);
  });

  it("still fails closed when a later case-center page repeats an ID", async () => {
    const { rpc, client } = syntheticDatabase(501);
    const original = rpc.getMockImplementation();
    rpc.mockImplementation(async (name, args) => {
      const result = await original!(name, args);
      if (args.p_after_client_code && result.data[0]) {
        result.data[0].client_id = "84750000-0000-4000-8000-000000000001";
      }
      return result;
    });

    await expect(loadAllClientDirectoryRows(client, context, "case_center"))
      .rejects.toThrow(ClientDirectorySnapshotError);
  });
});
