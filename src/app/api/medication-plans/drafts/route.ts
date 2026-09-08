import { ok } from "@/lib/api/response";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import {
  assertMedicationPlanManager,
  createMedicationPlanDraft,
} from "@/lib/medication-plans/commands";
import { parseCreateMedicationPlanDraft } from "@/lib/medication-plans/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    assertMedicationPlanManager(actor);
    const input = parseCreateMedicationPlanDraft(
      await readJsonObject(request, 16 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await createMedicationPlanDraft(actor, input);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}
