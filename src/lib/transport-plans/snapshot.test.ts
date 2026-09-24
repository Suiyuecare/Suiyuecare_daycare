import { beforeEach, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), single: vi.fn(), project: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
vi.mock("./projection", () => ({ projectTransportPlanSnapshot: mocks.project }));
import { loadTransportPlanSnapshot, TransportPlanSnapshotError } from "./snapshot";

const context = { demo: false, organizationId: "d7300000-0000-4000-8000-000000000001", branchId: "d7400000-0000-4000-8000-000000000001", scopes: ["clients.read", "transport_plans.read"] } as TenantContext;
const filters = { serviceDate: "2026-09-22", direction: "all", vehicleQuery: "", driverQuery: "", status: "all" } as const;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ maybeSingle: mocks.single });
  mocks.single.mockResolvedValue({ data: { trips: [] }, error: null });
  mocks.project.mockReturnValue({ trips: [] });
});
it("uses the versioned cancellation snapshot without changing the old frontend RPC", async () => {
  await loadTransportPlanSnapshot(context, filters);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("transport_trip_plan_snapshot_v2", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
    p_service_date: filters.serviceDate, p_direction: "all", p_vehicle_query: "", p_driver_query: "", p_status: "all",
  });
  expect(mocks.project).toHaveBeenCalledWith({ row: { trips: [] }, expectedOrganizationId: context.organizationId, expectedBranchId: context.branchId, filters, demo: false });
});
it("does not silently fall back to v1 when the new migration is missing", async () => {
  mocks.single.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  await expect(loadTransportPlanSnapshot(context, filters)).rejects.toBeInstanceOf(TransportPlanSnapshotError);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.project).not.toHaveBeenCalled();
});
it("rejects a missing permission before accessing either RPC", async () => {
  await expect(loadTransportPlanSnapshot({ ...context, scopes: ["clients.read"] }, filters)).rejects.toBeInstanceOf(TransportPlanSnapshotError);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
