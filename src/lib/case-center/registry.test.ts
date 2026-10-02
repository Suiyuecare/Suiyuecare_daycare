import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";
import { parseCaseCenterFilters } from "./query";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  directory: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  lte: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  returns: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
vi.mock("@/lib/clients/directory", () => ({ loadAllClientDirectoryRows: mocks.directory }));

import { loadCaseCenterSnapshot } from "./registry";

const clientId = "c0000000-0000-4000-8000-000000000001";
const userId = "a0000000-0000-4000-8000-000000000001";
const context: TenantContext = {
  organizationId: "d0000000-0000-4000-8000-000000000001",
  organizationName: "合成機構",
  branchId: "b0000000-0000-4000-8000-000000000001",
  branchName: "合成分支",
  userId,
  displayName: "合成同仁",
  roles: ["care_worker"],
  scopes: ["clients.read"],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.mockResolvedValue({ from: mocks.from });
  mocks.from.mockReturnValue({ select: mocks.select });
  const query = {
    eq: mocks.eq,
    lte: mocks.lte,
    order: mocks.order,
    range: mocks.range,
    returns: mocks.returns,
  };
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.lte.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  mocks.range.mockReturnValue(query);
  mocks.returns.mockResolvedValue({
    data: [{ id: "e0000000-0000-4000-8000-000000000001", client_id: clientId, assignee_user_id: userId, assignment_kind: "daily_care", starts_at: "2026-01-01T00:00:00Z", ends_at: null }],
    count: 1,
    error: null,
  });
  mocks.directory.mockResolvedValue([{
    id: clientId,
    client_code: "CASE-001",
    display_name: "合成個案",
    status: "active",
    admitted_on: "2026-01-01",
    ended_on: null,
    updated_at: "2026-09-01T00:00:00Z",
  }]);
});

describe("case-center assignment paging", () => {
  it("uses a stable unique tie-breaker without widening self-only visibility", async () => {
    const filters = parseCaseCenterFilters({ date: "2026-10-03" });
    const result = await loadCaseCenterSnapshot(context, filters);

    expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), context, "case_center");
    expect(mocks.from).toHaveBeenCalledWith("client_assignments");
    expect(mocks.eq).toHaveBeenCalledWith("assignee_user_id", userId);
    expect(mocks.order.mock.calls).toEqual([["client_id"], ["id"]]);
    expect(result.clients).toHaveLength(1);
    expect(result.clients[0]?.responsibility.people[0]?.userId).toBe(userId);
  });

  it("fetches 1,001 assignments sharing one client ID across a stable page boundary", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: `e0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      client_id: clientId,
      assignee_user_id: userId,
      assignment_kind: `kind-${index + 1}`,
      starts_at: "2026-01-01T00:00:00Z",
      ends_at: null,
    }));
    mocks.range.mockImplementation((from: number, to: number) => ({
      returns: async () => ({
        data: rows.slice(from, to + 1),
        count: from === 0 ? rows.length : null,
        error: null,
      }),
    }));

    const result = await loadCaseCenterSnapshot(
      context,
      parseCaseCenterFilters({ date: "2026-10-03" }),
    );

    expect(mocks.range.mock.calls).toEqual([[0, 999], [1_000, 1_999]]);
    expect(mocks.order.mock.calls).toEqual([
      ["client_id"], ["id"], ["client_id"], ["id"],
    ]);
    expect(result.clients[0]?.responsibility.people).toHaveLength(1);
  });

  it("fails closed when a later page repeats an assignment ID", async () => {
    const row = {
      id: "e0000000-0000-4000-8000-000000000001",
      client_id: clientId,
      assignee_user_id: userId,
      assignment_kind: "daily_care",
      starts_at: "2026-01-01T00:00:00Z",
      ends_at: null,
    };
    mocks.range.mockImplementation((from: number) => ({
      returns: async () => ({
        data: Array.from({ length: from === 0 ? 1_000 : 1 }, () => row),
        count: from === 0 ? 1_001 : null,
        error: null,
      }),
    }));

    await expect(loadCaseCenterSnapshot(
      context,
      parseCaseCenterFilters({ date: "2026-10-03" }),
    )).rejects.toThrow("CASE_CENTER_REGISTRY_UNAVAILABLE");
  });

  it("does not mistake a missing exact count for a complete assignment directory", async () => {
    mocks.returns.mockResolvedValue({ data: [], count: null, error: null });

    await expect(loadCaseCenterSnapshot(
      context,
      parseCaseCenterFilters({ date: "2026-10-03" }),
    )).rejects.toThrow("CASE_CENTER_REGISTRY_UNAVAILABLE");
  });
});
