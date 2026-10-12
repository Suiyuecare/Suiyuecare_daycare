import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));

import { loadActualTransportCaseSnapshot } from "./snapshot";

const actorId = "a1111111-1111-4111-8111-111111111111";
const clientId = "a2222222-2222-4222-8222-222222222222";
const outsiderId = "a3333333-3333-4333-8333-333333333333";
const date = "2026-10-10";
const actor: TenantContext = {
  organizationId: actorId, branchId: actorId, userId: actorId,
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員",
  roles: ["care_worker"], scopes: ["clients.read", "transport_case_status.read"],
  demo: false, assuranceLevel: "aal2", recentAal2At: null,
};
const roster: CareRosterSnapshot = {
  status: "ready", manager: false, staffOptions: [], demo: false,
  assignments: [{ id: actorId, clientId, staffUserId: actorId, staffName: "合成人員",
    serviceDate: date, shift: "morning", version: 1, state: "scheduled",
    sourceNote: "合成分工", tasks: [], isServiceEligible: true, serviceEligibility: "eligible" }],
};
const payload = { serviceDate: date, generatedAt: "2026-10-10T02:00:00+00:00",
  rows: [{ clientId, pickupStatus: "boarded", dropoffStatus: "scheduled_unreported" }] };

describe("assigned-client actual transport projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockReturnValue({ maybeSingle: mocks.single });
    mocks.single.mockResolvedValue({ data: { payload }, error: null });
  });

  it("loads only the assigned client's actual status", async () => {
    expect(await loadActualTransportCaseSnapshot(actor, date, roster)).toEqual({ status: "ready", ...payload });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("care_worker_actual_transport_status", {
      p_organization_id: actor.organizationId, p_branch_id: actor.branchId, p_service_date: date,
    });
  });

  it("accepts a redacted passenger exception without guessing no ride", async () => {
    const incident = { ...payload, rows: [{ clientId, pickupStatus: "exception", dropoffStatus: "scheduled_unreported" }] };
    mocks.single.mockResolvedValue({ data: { payload: incident }, error: null });
    expect(await loadActualTransportCaseSnapshot(actor, date, roster)).toEqual({ status: "ready", ...incident });
  });

  it("keeps assigned transport status available to a care worker with an additional clinical role", async () => {
    expect(await loadActualTransportCaseSnapshot({ ...actor, roles: ["care_worker", "nurse"] }, date, roster))
      .toEqual({ status: "ready", ...payload });
  });

  it.each([
    { ...payload, rows: [{ clientId: outsiderId, pickupStatus: "boarded", dropoffStatus: "scheduled_unreported" }] },
    { ...payload, rows: [payload.rows[0], payload.rows[0]] },
    { ...payload, rows: [] },
    { ...payload, serviceDate: "2026-10-09" },
    { ...payload, rows: [{ ...payload.rows[0], pickupStatus: "not_ride" }] },
    { ...payload, rows: [{ ...payload.rows[0], pickupStatus: "not_reported" }] },
    { ...payload, rows: [{ ...payload.rows[0], vehicleCode: "SECRET" }] },
  ])("rejects unexpected identities, missing cases, fields and invented status", async (bad) => {
    mocks.single.mockResolvedValue({ data: { payload: bad }, error: null });
    expect((await loadActualTransportCaseSnapshot(actor, date, roster)).status).toBe("unavailable");
  });

  it("never turns RPC failure into an actual no-report finding", async () => {
    mocks.single.mockRejectedValue(new Error("network"));
    expect(await loadActualTransportCaseSnapshot(actor, date, roster)).toEqual({
      status: "unavailable", serviceDate: date, generatedAt: null, rows: [],
    });
  });

  it("keeps the optional panel unavailable when the client cannot be created", async () => {
    mocks.create.mockRejectedValue(new Error("session unavailable"));
    expect(await loadActualTransportCaseSnapshot(actor, date, roster)).toEqual({
      status: "unavailable", serviceDate: date, generatedAt: null, rows: [],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  const deniedCases: [TenantContext, CareRosterSnapshot][] = [
    [{ ...actor, demo: true }, roster],
    [{ ...actor, scopes: ["clients.read"] }, roster],
    [{ ...actor, roles: ["branch_supervisor"] }, roster],
    [actor, { ...roster, status: "unavailable" }],
  ];
  it.each(deniedCases)("does not query absent, demo, or non-care-worker authority", async (context, assignedRoster) => {
    expect((await loadActualTransportCaseSnapshot(context, date, assignedRoster)).status).toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
