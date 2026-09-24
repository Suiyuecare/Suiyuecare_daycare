import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { authorizeIntake, intakeDatabaseError, intakeRpc, readIntakeSnapshot } from "@/lib/client-intake/server";
import { profileMutationSchema, intakeReceiptSchema } from "@/lib/client-intake/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeIntake();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "合成展示不會連接正式個案。", 403);
    return ok(await readIntakeSnapshot(actor, new URL(request.url).searchParams.get("client") ?? ""), 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) throw new IntegrationError("JSON_REQUIRED", "請從收案表單送出資料。", 415);
    const body = profileMutationSchema.safeParse(await readJsonObject(request, 64 * 1024));
    if (!body.success) throw new IntegrationError("INTAKE_INVALID", "請檢查必填資料、日期與聯絡人欄位。", 400, body.error.issues[0]?.path.join("."));
    const input = body.data;
    const actor = await authorizeIntake(true, input.action === "create", input.action === "update" ? input.clientId : null);
    const receipt = await intakeRpc(input.action === "create" ? "create_intake_client" : "update_intake_profile", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_operation: input.idempotency_key, p_profile: input.profile,
      ...(input.action === "update" ? { p_client: input.clientId, p_expected_version: input.expectedVersion, p_expected_client_version: input.expectedClientVersion } : {}),
    });
    const parsed = intakeReceiptSchema.safeParse(receipt);
    if (!parsed.success || parsed.data.operationId !== input.idempotency_key || (input.action === "update" && (parsed.data.clientId !== input.clientId || parsed.data.profileVersion !== input.expectedVersion + 1 || parsed.data.clientRowVersion !== input.expectedClientVersion + 1))) intakeDatabaseError();
    return ok({ ...parsed.data, persisted: true }, 200, requestId);
  });
}
