import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { admissionPreparationInputSchema } from "@/lib/jubo-admission-preparation/contract";
import { authorizeAdmissionPreparation, loadJuboAdmissionPreparation, mutateAdmissionPreparation } from "@/lib/jubo-admission-preparation/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const actor = await authorizeAdmissionPreparation();
    const params = new URL(request.url).searchParams;
    const client = z.uuid().safeParse(params.get("client"));
    if (!client.success || params.getAll("client").length !== 1 || [...params.keys()].some(key => key !== "client"))
      throw new IntegrationError("INVALID_CLIENT", "請重新選擇個案。", 400);
    const snapshot = await loadJuboAdmissionPreparation(actor, client.data);
    if (!snapshot) throw new IntegrationError("ADMISSION_PREPARATION_DENIED", "此個案目前不可進行收案核對。", 403);
    return ok(snapshot, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const actor = await authorizeAdmissionPreparation();
    await requireRecentAal2(actor);
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    const parsed = admissionPreparationInputSchema.safeParse(await readJsonObject(request, 8192));
    if (!key.success || !parsed.success) throw new IntegrationError("ADMISSION_PREPARATION_INVALID", "請補齊收案日、資格期間、文件識別及核對理由。", 400);
    return ok(await mutateAdmissionPreparation(actor, parsed.data, key.data), 200, requestId);
  });
}
