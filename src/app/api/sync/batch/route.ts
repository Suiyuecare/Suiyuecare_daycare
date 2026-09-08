import { ok, partial } from "@/lib/api/response";
import { lookupClientDirectoryRow } from "@/lib/clients/directory";
import type { ApiErrorDetail } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import {
  hasVersionConflict,
  parseSyncBatch,
  type OfflineSyncOperation,
} from "@/lib/integrations/sync";
import { deterministicUuid } from "@/lib/integrations/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncRow = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  payload_hash: string;
  status: "pending" | "applied" | "conflict" | "rejected";
};

async function currentVersion(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  operation: OfflineSyncOperation,
) {
  const table =
    operation.entityType === "vital-sign"
      ? "measurements"
      : operation.entityType === "care-note"
        ? "care_records"
        : "attendance_records";
  const columns = operation.entityType === "care-note" ? "id, client_id, row_version" : "id, client_id";
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("id", operation.entityId)
    .maybeSingle<Record<string, unknown>>();
  if (error) {
    throw databaseFailure(
      "SYNC_VERSION_LOOKUP_FAILED",
      "無法確認離線資料版本，該筆資料未排入同步。",
    );
  }
  if (!data) return 0;
  if (data.client_id !== operation.clientId) {
    throw new IntegrationError(
      "SYNC_ENTITY_SCOPE_MISMATCH",
      "離線資料與個案範圍不一致。",
      403,
    );
  }
  return operation.entityType === "care-note"
    ? Number(data.row_version ?? 1)
    : 1;
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    const operations = parseSyncBatch(await readJsonObject(request));

    if (actor.demo) {
      return ok(
        {
          operations: operations.map((operation) => ({
            idempotencyKey: operation.idempotencyKey,
            entityType: operation.entityType,
            entityId: operation.entityId,
            status: "validated",
            persisted: false,
            conflictCheck: "not_performed",
          })),
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式資料服務尚未設定。",
        503,
      );
    }

    const results: Array<Record<string, unknown>> = [];
    const errors: ApiErrorDetail[] = [];

    for (const [index, operation] of operations.entries()) {
      const operationId = deterministicUuid(
        "offline-sync",
        actor.organizationId,
        actor.userId,
        operation.idempotencyKey,
      );

      // Revalidate assignment before both first execution and idempotent
      // replay. A revoked assignment must not reveal an earlier entity or
      // operation status merely because the caller still knows the retry key.
      const accessibleClient = await lookupClientDirectoryRow(
        supabase,
        actor,
        "offline_sync",
        operation.clientId,
      ).catch(() => null);
      if (!accessibleClient) {
        errors.push({
          code: "CLIENT_NOT_ACCESSIBLE",
          message: "找不到可同步的授權個案。",
          field: `operations.${index}.payload.client_id`,
        });
        results.push({
          idempotencyKey: operation.idempotencyKey,
          status: "rejected",
          persisted: false,
        });
        continue;
      }

      const { data: replay, error: replayError } = await supabase
        .from("sync_operations")
        .select("id, entity_type, entity_id, payload_hash, status")
        .eq("organization_id", actor.organizationId)
        .eq("user_id", actor.userId)
        .eq("idempotency_key", operationId)
        .maybeSingle<SyncRow>();
      if (replayError) {
        errors.push({
          code: "SYNC_LOOKUP_FAILED",
          message: "無法確認此同步項目是否已處理。",
          field: `operations.${index}`,
        });
        results.push({
          idempotencyKey: operation.idempotencyKey,
          status: "rejected",
          persisted: false,
        });
        continue;
      }
      if (replay) {
        if (
          replay.entity_type !== operation.entityType ||
          replay.entity_id !== operation.entityId ||
          replay.payload_hash !== operation.payloadHash
        ) {
          errors.push({
            code: "IDEMPOTENCY_CONFLICT",
            message: "此冪等鍵已用於不同的離線資料。",
            field: `operations.${index}.idempotency_key`,
          });
          results.push({
            idempotencyKey: operation.idempotencyKey,
            status: "rejected",
            persisted: false,
          });
        } else {
          results.push({
            idempotencyKey: operation.idempotencyKey,
            entityType: operation.entityType,
            entityId: operation.entityId,
            status: replay.status,
            replayed: true,
            persisted: true,
          });
        }
        continue;
      }

      let version: number;
      try {
        version = await currentVersion(supabase, operation);
      } catch (error) {
        const code =
          error instanceof IntegrationError
            ? error.code
            : "SYNC_VERSION_LOOKUP_FAILED";
        errors.push({
          code,
          message: "無法確認離線資料版本，該筆資料未排入同步。",
          field: `operations.${index}.base_version`,
        });
        results.push({
          idempotencyKey: operation.idempotencyKey,
          status: "rejected",
          persisted: false,
        });
        continue;
      }
      if (hasVersionConflict(operation.baseVersion, version)) {
        errors.push({
          code: "SYNC_VERSION_CONFLICT",
          message: "伺服器資料已更新，請重新整理後人工處理。",
          field: `operations.${index}.base_version`,
        });
        results.push({
          idempotencyKey: operation.idempotencyKey,
          entityType: operation.entityType,
          entityId: operation.entityId,
          status: "conflict",
          baseVersion: operation.baseVersion,
          currentVersion: version,
          persisted: false,
        });
        continue;
      }

      const { data, error } = await supabase
        .from("sync_operations")
        .insert({
          organization_id: actor.organizationId,
          branch_id: actor.branchId,
          user_id: actor.userId,
          device_id: operation.deviceId,
          idempotency_key: operationId,
          entity_type: operation.entityType,
          entity_id: operation.entityId,
          base_version: operation.baseVersion === 0 ? null : operation.baseVersion,
          occurred_at: operation.occurredAt,
          payload_hash: operation.payloadHash,
          status: "pending",
          conflict_details: {
            schema_version: 1,
            client_id: operation.clientId,
            payload: operation.payload,
          },
        })
        .select("id, status")
        .single<{ id: string; status: string }>();

      if (error) {
        if (error.code === "23505") {
          const { data: raced, error: racedError } = await supabase
            .from("sync_operations")
            .select("id, entity_type, entity_id, payload_hash, status")
            .eq("organization_id", actor.organizationId)
            .eq("user_id", actor.userId)
            .eq("idempotency_key", operationId)
            .maybeSingle<SyncRow>();
          if (
            !racedError &&
            raced &&
            raced.entity_type === operation.entityType &&
            raced.entity_id === operation.entityId &&
            raced.payload_hash === operation.payloadHash
          ) {
            results.push({
              idempotencyKey: operation.idempotencyKey,
              entityType: operation.entityType,
              entityId: operation.entityId,
              queueId: raced.id,
              status: raced.status,
              replayed: true,
              persisted: true,
            });
            continue;
          }
        }
        errors.push({
          code:
            error.code === "42501"
              ? "SYNC_NOT_AUTHORIZED"
              : "SYNC_QUEUE_FAILED",
          message: "離線資料未排入同步，請保留裝置草稿後重試。",
          field: `operations.${index}`,
        });
        results.push({
          idempotencyKey: operation.idempotencyKey,
          status: "rejected",
          persisted: false,
        });
        continue;
      }

      results.push({
        idempotencyKey: operation.idempotencyKey,
        entityType: operation.entityType,
        entityId: operation.entityId,
        queueId: data.id,
        status: data.status,
        replayed: false,
        persisted: true,
      });
    }

    const responseData = {
      operations: results,
      persisted: errors.length < operations.length,
      demo: false,
    };
    return errors.length > 0
      ? partial(responseData, errors, 207, requestId)
      : ok(responseData, 202, requestId);
  });
}
