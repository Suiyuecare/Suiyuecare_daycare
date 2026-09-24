import type { TenantContext } from "@/lib/domain/types";

export type OpeningReadinessStatus = "ready" | "needs_attention" | "unavailable" | "manual_review";
export type OpeningReadinessItem = {
  id: "institution" | "staff" | "qualifications" | "clients" | "contacts" | "roster" | "care_basis" | "data_safety" | "recovery";
  title: string;
  status: OpeningReadinessStatus;
  summary: string;
  owner: string;
  actionLabel: string;
  href: string;
  sourceLabel: string;
};
export type OpeningReadinessSnapshot = {
  status: "forbidden";
} | {
  status: Exclude<OpeningReadinessStatus, "ready">;
  scope: Pick<TenantContext, "organizationId" | "organizationName" | "branchId" | "branchName">;
  serviceDate: string;
  generatedAt: string;
  staleAfter: string;
  demo: boolean;
  items: OpeningReadinessItem[];
  counts: Record<OpeningReadinessStatus, number>;
  fullLaunchApproved: false;
  realDataIntakeApproved: false;
};

export function canViewOpeningReadiness(context: TenantContext): boolean {
  return !context.roles.includes("family") && !context.roles.includes("platform_ops") &&
    context.roles.some((role) => role === "organization_manager" || role === "branch_supervisor");
}
