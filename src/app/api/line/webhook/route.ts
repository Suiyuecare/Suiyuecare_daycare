import { ok } from "@/lib/api/response";
import { env, isDemoMode } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  handleIntegrationRoute,
  requireAdminConfiguration,
} from "@/lib/integrations/http";
import {
  parseLineWebhook,
  verifyLineSignature,
} from "@/lib/integrations/line";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LINE_WEBHOOK_BYTES = 1024 * 1024;
const demoProcessedEventIds = new Set<string>();

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (!env.LINE_CHANNEL_SECRET) {
      throw new IntegrationError(
        "LINE_NOT_CONFIGURED",
        "LINE webhook 尚未完成正式設定。",
        503,
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_LINE_WEBHOOK_BYTES
    ) {
      throw new IntegrationError(
        "LINE_WEBHOOK_TOO_LARGE",
        "LINE webhook 內容超過允許大小。",
        413,
      );
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_LINE_WEBHOOK_BYTES) {
      throw new IntegrationError(
        "LINE_WEBHOOK_TOO_LARGE",
        "LINE webhook 內容超過允許大小。",
        413,
      );
    }
    if (
      !verifyLineSignature(
        rawBody,
        request.headers.get("x-line-signature"),
        env.LINE_CHANNEL_SECRET,
      )
    ) {
      throw new IntegrationError(
        "INVALID_LINE_SIGNATURE",
        "LINE webhook 簽章驗證失敗。",
        401,
      );
    }

    const parsed = parseLineWebhook(rawBody);
    let duplicateCount = parsed.duplicateEventIds.length;
    let recordedCount = 0;

    if (isDemoMode()) {
      for (const event of parsed.events) {
        if (demoProcessedEventIds.has(event.eventId)) {
          duplicateCount += 1;
        } else {
          demoProcessedEventIds.add(event.eventId);
          recordedCount += 1;
        }
      }
      return ok(
        {
          accepted: parsed.events.length,
          recorded: recordedCount,
          duplicates: duplicateCount,
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    requireAdminConfiguration();
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw new IntegrationError(
        "LINE_EVENT_STORE_NOT_CONFIGURED",
        "LINE 事件儲存尚未完成安全設定。",
        503,
      );
    }

    for (const event of parsed.events) {
      const { data: existing, error: lookupError } = await admin
        .from("audit_events")
        .select("id")
        .eq("table_name", "line_webhook_events")
        .eq("row_pk", event.eventId)
        .limit(1)
        .maybeSingle<{ id: number }>();
      if (lookupError) {
        throw new IntegrationError(
          "LINE_EVENT_LOOKUP_FAILED",
          "無法確認 LINE 事件狀態；請求未被確認完成。",
          503,
        );
      }
      if (existing) {
        duplicateCount += 1;
        continue;
      }

      const { error: insertError } = await admin.from("audit_events").insert({
        organization_id: null,
        branch_id: null,
        actor_user_id: null,
        action: "integration",
        table_name: "line_webhook_events",
        row_pk: event.eventId,
        request_id: requestId,
        changed_fields: [],
        metadata: {
          schema_version: 1,
          event_type: event.eventType,
          destination_hash: parsed.destinationHash,
        },
      });
      if (insertError) {
        if (insertError.code === "23505") {
          duplicateCount += 1;
          continue;
        }
        throw new IntegrationError(
          "LINE_EVENT_RECORD_FAILED",
          "LINE 事件未能安全保存；請求未被確認完成。",
          503,
        );
      }
      recordedCount += 1;
    }

    return ok(
      {
        accepted: parsed.events.length,
        recorded: recordedCount,
        duplicates: duplicateCount,
        persisted: true,
        demo: false,
      },
      200,
      requestId,
    );
  });
}
