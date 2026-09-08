import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { IntegrationError } from "./errors";
import { sha256Hex } from "./security";

const lineEventSchema = z
  .object({
    webhookEventId: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(80),
  })
  .passthrough();

const lineWebhookSchema = z
  .object({
    destination: z.string().trim().min(1).max(200),
    events: z.array(lineEventSchema).max(100),
  })
  .passthrough();

export interface SafeLineEvent {
  eventId: string;
  eventType: string;
}

export interface ParsedLineWebhook {
  destinationHash: string;
  events: SafeLineEvent[];
  duplicateEventIds: string[];
}

export function lineSignature(rawBody: string, channelSecret: string) {
  return createHmac("sha256", channelSecret)
    .update(rawBody, "utf8")
    .digest("base64");
}

export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
) {
  if (!signature || !channelSecret) return false;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  const expected = Buffer.from(lineSignature(rawBody, channelSecret), "base64");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseLineWebhook(rawBody: string): ParsedLineWebhook {
  let unknownPayload: unknown;
  try {
    unknownPayload = JSON.parse(rawBody);
  } catch {
    throw new IntegrationError(
      "INVALID_LINE_WEBHOOK",
      "LINE webhook 內容格式錯誤。",
      400,
    );
  }
  const parsed = lineWebhookSchema.safeParse(unknownPayload);
  if (!parsed.success) {
    throw new IntegrationError(
      "INVALID_LINE_WEBHOOK",
      "LINE webhook 缺少必要欄位。",
      400,
    );
  }

  const seen = new Set<string>();
  const duplicateEventIds: string[] = [];
  const events: SafeLineEvent[] = [];
  for (const event of parsed.data.events) {
    if (seen.has(event.webhookEventId)) {
      duplicateEventIds.push(event.webhookEventId);
      continue;
    }
    seen.add(event.webhookEventId);
    events.push({
      eventId: event.webhookEventId,
      eventType: event.type,
    });
  }

  return {
    destinationHash: sha256Hex(parsed.data.destination),
    events,
    duplicateEventIds,
  };
}

