import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { JuboProfileReviewWorkspace } from "@/components/jubo-review/jubo-profile-review-workspace";
import { requireTenantContext, hasRecentAal2 } from "@/lib/auth/context";
import { hasSupabaseConfiguration, isSyntheticPreviewMode } from "@/lib/env";
import { canReviewJuboProfiles, juboReviewFeatureEnabled } from "@/lib/jubo-review/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JUBO 個案主檔逐筆覆核" };

export default async function JuboProfileReviewPage() {
  // A hidden entry is not an authorization boundary: direct URLs fail closed.
  if (!juboReviewFeatureEnabled() || isSyntheticPreviewMode() || !hasSupabaseConfiguration()) notFound();
  const actor = await requireTenantContext("staff");
  if (!canReviewJuboProfiles(actor)) return <StaffAccessDenied />;
  const recentAal2 = actor.assuranceLevel === "aal2" && await hasRecentAal2();
  return <JuboProfileReviewWorkspace key={`${actor.organizationId}:${actor.branchId}:${actor.userId}`}
    branchName={actor.branchName} recentAal2={recentAal2} />;
}
