// Browser-only security fixture. Never imported by a permanent application route.
import { createHash } from "node:crypto";
import { AuthorizedCarePlanViewWorkspace } from "@/components/authorized-care-plan-view/authorized-care-plan-view-workspace";
import { buildDemoAuthorizedCarePlanViewSnapshot } from "@/lib/authorized-care-plan-view/demo";
import { defaultAuthorizedCarePlanFilters } from "@/lib/authorized-care-plan-view/query";
import { getPageBySlug } from "@/lib/catalog";

const text = '<script>globalThis.__page55Executed=true</script><img src="/__security_probe__/page55-image" onerror="globalThis.__page55Executed=true"><iframe src="/__security_probe__/page55-frame"></iframe>';

export function AuthorizedCarePlanSecurityHarness() {
  const filters = defaultAuthorizedCarePlanFilters(new Date("2026-09-08T04:00:00.000Z"));
  const snapshot = buildDemoAuthorizedCarePlanViewSnapshot({
    organizationId: "55000000-0000-4000-8000-000000000001",
    branchId: "55000000-0000-4000-8000-000000000002", filters,
  });
  const canonicalValue = { synthetic_untrusted_text: text };
  const canonicalJson = JSON.stringify(canonicalValue);
  const safeEnvelope = { valueState: "unknown" as const, mappingStatus: "needs_mapping" as const,
    needsMapping: true, canonicalValue, canonicalJson,
    contentHash: createHash("sha256").update(canonicalJson).digest("hex"),
    byteSize: Buffer.byteLength(canonicalJson), nodeCount: 2, topLevelFieldCount: 1 };
  const attacked = { ...snapshot, plans: snapshot.plans.map((stream) => ({ ...stream,
    history: stream.history.map((version) => ({ ...version, planData: safeEnvelope, serviceLimits: safeEnvelope })),
  })) };
  const page = getPageBySlug("staff/service-management/approved-care-plans");
  if (!page) throw new Error("Missing Page55 catalog entry");
  return <AuthorizedCarePlanViewWorkspace page={page} filters={filters} snapshot={attacked} />;
}
