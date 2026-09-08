import { ok } from "@/lib/api/response";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import {
  assertMedicationPlanManager,
  submitMedicationPlan,
} from "@/lib/medication-plans/commands";
import { parseMedicationPlanVersionAction } from "@/lib/medication-plans/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    assertMedicationPlanManager(actor);
    const input = parseMedicationPlanVersionAction(
      await readJsonObject(request, 8 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await submitMedicationPlan(actor, input);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      200,
      requestId,
    );
  });
}
