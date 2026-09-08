import { ok } from "@/lib/api/response";
import {
  authorizeStaffRequest,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { assertMedicationPlanManager, stopMedicationPlan } from "@/lib/medication-plans/commands";
import { parseStopMedicationPlan } from "@/lib/medication-plans/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    assertMedicationPlanManager(actor);
    await requireRecentAal2(actor);
    const input = parseStopMedicationPlan(
      await readJsonObject(request, 8 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await stopMedicationPlan(actor, input);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      200,
      requestId,
    );
  });
}
