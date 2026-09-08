import { ok } from "@/lib/api/response";
import {
  authorizeStaffRequest,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { approveMedicationPlan, assertMedicationPlanManager } from "@/lib/medication-plans/commands";
import { parseMedicationPlanVersionAction } from "@/lib/medication-plans/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    assertMedicationPlanManager(actor);
    await requireRecentAal2(actor);
    const input = parseMedicationPlanVersionAction(
      await readJsonObject(request, 8 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await approveMedicationPlan(actor, input);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      200,
      requestId,
    );
  });
}
