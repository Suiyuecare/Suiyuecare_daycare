import type { TenantContext } from "@/lib/domain/types";
import { buildDemoOrganizationProfileSnapshot } from "@/lib/organization-profile/demo";
import { buildDemoStaffManagementSnapshot } from "@/lib/staff-management/demo";
import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";
import type { OpeningReadinessSources } from "./projection";
import { isDailyWorkClient } from "@/lib/core-care/selection-query";

/** Explicit synthetic fixture, never used to fill gaps in a production snapshot. */
export function buildDemoOpeningReadinessSources(context: TenantContext, serviceDate: string, now = new Date()): OpeningReadinessSources {
  if (!context.demo) throw new Error("OPENING_READINESS_DEMO_ONLY");
  const institution = buildDemoOrganizationProfileSnapshot({ organizationId: context.organizationId,
    branchId: context.branchId, filters: { status: "all", effectiveOn: serviceDate, query: "" }, now });
  const staff = buildDemoStaffManagementSnapshot({ organizationId: context.organizationId, branchId: context.branchId,
    filters: { status: "all", roleId: null, qualification: "all", query: "" }, now });
  const clients = { ...buildDemoClientMasterSnapshot(), generatedAt: now.toISOString() };
  const assignedStaff = staff.employees.find((person) => person.membershipStatus === "active" && person.profileIsActive);
  return { institution: { status: "available", data: institution }, staff: { status: "available", data: staff },
    clients: { status: "available", data: clients }, roster: { status: "available", data: {
      status: "ready", manager: true, demo: true, staffOptions: [],
      assignments: clients.clients.filter((client) => isDailyWorkClient({ status: client.status, admitted_on: client.admittedOn, ended_on: client.endedOn }, serviceDate)).flatMap((client, index) =>
        (["morning", "afternoon"] as const).map((shift) => ({
          id: `f1111111-1111-4111-8111-${String(index * 2 + (shift === "morning" ? 1 : 2)).padStart(12, "0")}`,
          clientId: client.id, staffUserId: index === 1 ? null : assignedStaff?.profileId ?? null,
          staffName: index === 1 ? null : "合成當班員工", serviceDate, shift, version: 1,
          state: "scheduled" as const, sourceNote: "合成驗收安排，不代表正式排班",
          isServiceEligible: true, serviceEligibility: "eligible" as const,
          tasks: [{ kind: "care_diary" as const, status: "pending" as const, evidenceAt: null }],
        }))),
    } } };
}
