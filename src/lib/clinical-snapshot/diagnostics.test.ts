import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mock = vi.hoisted(() => ({
  createClient: vi.fn(),
  clientMaster: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mock.createClient }));
vi.mock("@/lib/clients/master-snapshot", () => ({
  ClientMasterSnapshotError: class ClientMasterSnapshotError extends Error {},
  loadClientMasterSnapshot: mock.clientMaster,
}));

import { loadBodyAssessmentSnapshot } from "@/lib/body-assessments/snapshot";
import { loadAbcdAssessmentSnapshot } from "@/lib/abcd-assessments/snapshot";
import { loadBehaviorEventSnapshot } from "@/lib/behavior-events/snapshot";
import { loadMedicationAdministrationSnapshot } from "@/lib/medications/snapshot";
import { loadClientToccSnapshot } from "@/lib/client-tocc/snapshot";
import { loadInsulinAdministrationSnapshot } from "@/lib/insulin-administrations/snapshot";
import { loadClientInspectionReportSnapshot } from "@/lib/client-inspection-reports/snapshot";

const context: TenantContext = {
  organizationId: "org-private", organizationName: "PRIVATE ORG", branchId: "branch-private-123",
  branchName: "PRIVATE BRANCH", userId: "PRIVATE USER", displayName: "PRIVATE NAME",
  roles: ["nurse"], scopes: ["clients.read", "health.read", "body_assessments.read",
    "medications.read", "insulin_administrations.read", "client_reports.read"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};

const cases = [
  { route: "body_assessment", load: () => loadBodyAssessmentSnapshot(context, {} as never) },
  { route: "abcd_assessment", load: () => loadAbcdAssessmentSnapshot(context, {} as never) },
  { route: "behavior_event", load: () => loadBehaviorEventSnapshot(context, {} as never) },
  { route: "medication_administration", load: () => loadMedicationAdministrationSnapshot(context, "2026-10-08") },
  { route: "client_tocc", load: () => loadClientToccSnapshot(context) },
  { route: "insulin_administration", load: () => loadInsulinAdministrationSnapshot(context, {} as never, false) },
  { route: "client_inspection_report", load: () => loadClientInspectionReportSnapshot(context, {} as never) },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mock.createClient.mockResolvedValue({ rpc: mock.rpc });
  mock.clientMaster.mockResolvedValue({ clients: [] });
});

describe("clinical snapshot diagnostics", () => {
  for (const entry of cases) {
    it(`${entry.route} keeps RPC failure diagnostic-only`, async () => {
      const privateError = { code: "42501", message: "PRIVATE NAME JWTSECRET SQL BODY" };
      const result = { data: null, error: privateError, status: 403 };
      mock.rpc.mockImplementation(() => entry.route === "medication_administration" || entry.route === "client_tocc"
        ? Promise.resolve(result)
        : { maybeSingle: () => Promise.resolve(result) });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      let caught: unknown;
      try { await entry.load(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      const requestId = (caught as Error & { requestId?: string }).requestId;
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(log).toHaveBeenCalledTimes(1);
      const event = JSON.parse(log.mock.calls[0][0] as string);
      expect(Object.keys(event).sort()).toEqual([
        "atUtc", "branchScopeHash", "postgrestCode", "requestId", "routeKey", "rpcStatus",
      ]);
      expect(event).toMatchObject({ requestId, routeKey: `${entry.route}.rpc`, rpcStatus: 403, postgrestCode: "42501" });
      expect(event.branchScopeHash).toMatch(/^[0-9a-f]{16}$/u);
      expect(log.mock.calls[0][0]).not.toMatch(/PRIVATE|JWTSECRET|SQL BODY|branch-private-123/u);
      log.mockRestore();
    });
  }

  it("rejects untrusted status and error code from the support event", async () => {
    const result = { data: null, error: { code: "42501\nJWTSECRET", message: "PRIVATE NAME" }, status: "403\nPRIVATE" };
    mock.rpc.mockReturnValue({ maybeSingle: () => Promise.resolve(result) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadBodyAssessmentSnapshot(context, {} as never)).rejects.toThrow();
    const event = JSON.parse(log.mock.calls[0][0] as string);
    expect(event.rpcStatus).toBeNull();
    expect(event.postgrestCode).toBeNull();
    expect(log.mock.calls[0][0]).not.toMatch(/PRIVATE|JWTSECRET/u);
    log.mockRestore();
  });

  it("does not call the inspection-report RPC without AAL2", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadClientInspectionReportSnapshot({ ...context, assuranceLevel: "aal1" }, {} as never))
      .rejects.toThrow();
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string).routeKey).toBe("client_inspection_report.authorization");
    log.mockRestore();
  });
});
