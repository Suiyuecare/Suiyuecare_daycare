import { z } from "zod";

import { getPageBySlug } from "@/lib/catalog";
import type { PageCatalogEntry } from "@/lib/catalog";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  canonicalJson,
  deterministicUuid,
  parseIsoDateTime,
  payloadHash,
} from "./security";

/**
 * The generic JSON draft endpoint is deliberately limited to the one
 * unstructured, non-high-risk workflow it can validate safely. Measurements,
 * incidents, assessments, attendance, transport, services, medication,
 * claims and finance require dedicated schemas and endpoints.
 */
export const GENERIC_RECORD_DRAFT_PAGE_SLUGS = Object.freeze([
  "staff/daily-care/care-diary",
] as const);

const genericRecordDraftPageSlugs = new Set<string>(
  GENERIC_RECORD_DRAFT_PAGE_SLUGS,
);

export function isGenericRecordDraftPageSlug(slug: string) {
  return genericRecordDraftPageSlugs.has(slug);
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const careDiaryDataSchema = z
  .object({
    shift: z.enum(["morning", "afternoon", "full_day"]),
    care_item: z.string().trim().min(1).max(120),
    note: z.string().trim().max(2_000).default(""),
    abnormal: z.boolean(),
    follow_up: z.string().trim().max(1_000).optional(),
  })
  .strict();

const recordDraftSchema = z
  .object({
    client_id: z.uuid(),
    page_slug: z.string().trim().min(1).max(180),
    occurred_at: z.string(),
    data: z.record(z.string(), jsonValueSchema),
    idempotency_key: z.string().optional(),
  })
  .strict();

export interface RecordDraftInput {
  clientId: string;
  page: PageCatalogEntry;
  occurredAt: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
  contentHash: string;
}

export function parseRecordDraft(
  value: unknown,
  headerIdempotencyKey?: string | null,
): RecordDraftInput {
  const parsed = recordDraftSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_RECORD_DRAFT",
      "草稿欄位格式錯誤。",
      400,
      issue?.path.join(".") || undefined,
    );
  }

  const page = getPageBySlug(parsed.data.page_slug);
  if (!page || page.surface !== "staff") {
    throw new IntegrationError(
      "UNKNOWN_PAGE_SLUG",
      "找不到可建立草稿的工作頁面。",
      400,
      "page_slug",
    );
  }
  if (!isGenericRecordDraftPageSlug(page.slug)) {
    throw new IntegrationError(
      "RECORD_DRAFT_PAGE_NOT_ALLOWED",
      "此工作頁必須使用具欄位驗證的專用介面，不能建立通用草稿。",
      403,
      "page_slug",
    );
  }

  const validatedData = careDiaryDataSchema.safeParse(parsed.data.data);
  if (!validatedData.success) {
    const issue = validatedData.error.issues[0];
    throw new IntegrationError(
      "INVALID_CARE_DIARY_DATA",
      "照顧日誌欄位格式錯誤。",
      400,
      issue?.path.length ? `data.${issue.path.join(".")}` : "data",
    );
  }

  const idempotencyKey = assertIdempotencyKey(
    headerIdempotencyKey ?? parsed.data.idempotency_key,
  );
  const occurredAt = parseIsoDateTime(parsed.data.occurred_at, "occurred_at");
  const canonicalData = canonicalJson(validatedData.data);
  if (Buffer.byteLength(canonicalData, "utf8") > 256 * 1024) {
    throw new IntegrationError(
      "RECORD_DATA_TOO_LARGE",
      "單筆草稿資料不得超過 256KB。",
      413,
      "data",
    );
  }

  const hashBasis = {
    clientId: parsed.data.client_id,
    pageSlug: page.slug,
    occurredAt,
    data: validatedData.data,
  };

  return {
    clientId: parsed.data.client_id,
    page,
    occurredAt,
    data: validatedData.data,
    idempotencyKey,
    contentHash: payloadHash(hashBasis),
  };
}

export function recordKeyFor(
  organizationId: string,
  userId: string,
  idempotencyKey: string,
) {
  return deterministicUuid(
    "care-record-draft",
    organizationId,
    userId,
    idempotencyKey,
  );
}

export function recordStorageData(input: RecordDraftInput) {
  return {
    fields: input.data,
    _request: {
      schema_version: 1,
      idempotency_hash: input.contentHash,
      page_slug: input.page.slug,
    },
  };
}

export function storedRecordMatches(
  stored: {
    client_id?: unknown;
    category?: unknown;
    occurred_at?: unknown;
    data?: unknown;
  },
  input: RecordDraftInput,
) {
  if (
    stored.client_id !== input.clientId ||
    stored.category !== input.page.slug ||
    typeof stored.occurred_at !== "string" ||
    new Date(stored.occurred_at).toISOString() !== input.occurredAt
  ) {
    return false;
  }
  const data = stored.data as
    | { _request?: { idempotency_hash?: unknown } }
    | null;
  return data?._request?.idempotency_hash === input.contentHash;
}
