import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  FormPublicationApprovalInput,
  FormPublicationApprovalResult,
  FormPublicationRequestInput,
  FormPublicationRequestResult,
} from "./types";

const requestSchema = z
  .object({ form_version_id: z.uuid() })
  .strict();
const approvalSchema = z
  .object({ request_id: z.uuid() })
  .strict();
const requestResultSchema = z
  .object({
    request_id: z.uuid(),
    status: z.enum(["pending", "approved"]),
    form_content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    replayed: z.boolean(),
  })
  .strict();
const approvalResultSchema = z
  .object({
    request_id: z.uuid(),
    form_version_id: z.uuid(),
    status: z.literal("approved"),
    published_at: z.string(),
    replayed: z.boolean(),
  })
  .strict();
const requestActionDataSchema = z
  .object({
    publication: z
      .object({
        requestId: z.uuid(),
        formVersionId: z.uuid(),
        status: z.enum(["pending", "approved"]),
        formContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();
const approvalActionDataSchema = z
  .object({
    publication: z
      .object({
        requestId: z.uuid(),
        formVersionId: z.uuid(),
        status: z.literal("approved"),
        publishedAt: z.string(),
      })
      .strict(),
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();
const errorEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.literal("error"),
    data: z.null(),
    errors: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(120),
            message: z.string().trim().min(1).max(500),
            field: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function idempotencyKey(value: string | null) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請在 Idempotency-Key 標頭提供有效的 UUID。",
      400,
      "idempotency_key",
    );
  }
  return parsed.data.toLowerCase();
}

function invalidInput(
  code: string,
  message: string,
  result: z.ZodSafeParseError<unknown>,
): never {
  const issue = result.error.issues[0];
  throw new IntegrationError(
    code,
    message,
    400,
    issue?.path.length ? issue.path.join(".") : undefined,
  );
}

function invalidResult(): never {
  throw new IntegrationError(
    "FORM_PUBLICATION_RESULT_INVALID",
    "表單發布結果未完整確認；請以相同冪等鍵重試。",
    409,
  );
}

export function parseFormPublicationRequest(
  value: unknown,
  headerIdempotencyKey: string | null,
): FormPublicationRequestInput {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) {
    invalidInput(
      "INVALID_FORM_PUBLICATION_REQUEST",
      "表單送審欄位格式錯誤。",
      parsed,
    );
  }
  return {
    formVersionId: parsed.data.form_version_id.toLowerCase(),
    idempotencyKey: idempotencyKey(headerIdempotencyKey),
  };
}

export function parseFormPublicationApproval(
  value: unknown,
  headerIdempotencyKey: string | null,
): FormPublicationApprovalInput {
  const parsed = approvalSchema.safeParse(value);
  if (!parsed.success) {
    invalidInput(
      "INVALID_FORM_PUBLICATION_APPROVAL",
      "表單核准欄位格式錯誤。",
      parsed,
    );
  }
  return {
    requestId: parsed.data.request_id.toLowerCase(),
    idempotencyKey: idempotencyKey(headerIdempotencyKey),
  };
}

export function parseFormPublicationRequestResult(
  value: unknown,
): FormPublicationRequestResult {
  const parsed = requestResultSchema.safeParse(value);
  if (!parsed.success || (!parsed.data.replayed && parsed.data.status !== "pending")) {
    invalidResult();
  }
  return {
    requestId: parsed.data.request_id.toLowerCase(),
    status: parsed.data.status,
    formContentHash: parsed.data.form_content_hash,
    replayed: parsed.data.replayed,
  };
}

export function parseFormPublicationApprovalResult(
  value: unknown,
  expectedRequestId: string,
): FormPublicationApprovalResult {
  const parsed = approvalResultSchema.safeParse(value);
  if (!parsed.success) invalidResult();
  const publishedAt = new Date(parsed.data.published_at);
  if (
    parsed.data.request_id.toLowerCase() !== expectedRequestId.toLowerCase() ||
    !Number.isFinite(publishedAt.getTime()) ||
    !/[zZ]|[+-]\d{2}:\d{2}$/u.test(parsed.data.published_at)
  ) {
    invalidResult();
  }
  return {
    requestId: parsed.data.request_id.toLowerCase(),
    formVersionId: parsed.data.form_version_id.toLowerCase(),
    status: parsed.data.status,
    publishedAt: publishedAt.toISOString(),
    replayed: parsed.data.replayed,
  };
}

export type FormPublicationActionExpectation =
  | {
      kind: "request";
      formVersionId: string;
      httpStatus: number;
    }
  | {
      kind: "approve";
      formVersionId: string;
      publicationRequestId: string;
      httpStatus: number;
    };

export function parseFormPublicationActionSuccess(
  value: unknown,
  expectation: FormPublicationActionExpectation,
) {
  const envelope = z
    .object({
      requestId: z.uuid(),
      status: z.literal("ok"),
      data: z.unknown(),
      errors: z.tuple([]),
    })
    .strict()
    .safeParse(value);
  if (!envelope.success) invalidResult();

  if (expectation.kind === "request") {
    const data = requestActionDataSchema.safeParse(envelope.data.data);
    if (!data.success) invalidResult();
    const publication = data.data.publication;
    if (
      publication.formVersionId.toLowerCase() !==
        expectation.formVersionId.toLowerCase() ||
      (data.data.replayed
        ? expectation.httpStatus !== 200
        : expectation.httpStatus !== 201 || publication.status !== "pending") ||
      (publication.status === "approved" && !data.data.replayed)
    ) {
      invalidResult();
    }
    return {
      requestId: envelope.data.requestId.toLowerCase(),
      data: {
        ...data.data,
        publication: {
          ...publication,
          requestId: publication.requestId.toLowerCase(),
          formVersionId: publication.formVersionId.toLowerCase(),
        },
      },
    };
  }

  const data = approvalActionDataSchema.safeParse(envelope.data.data);
  if (!data.success) invalidResult();
  const publication = data.data.publication;
  const publishedAt = new Date(publication.publishedAt);
  if (
    publication.requestId.toLowerCase() !==
      expectation.publicationRequestId.toLowerCase() ||
    publication.formVersionId.toLowerCase() !==
      expectation.formVersionId.toLowerCase() ||
    !Number.isFinite(publishedAt.getTime()) ||
    !/[zZ]|[+-]\d{2}:\d{2}$/u.test(publication.publishedAt) ||
    (data.data.replayed
      ? expectation.httpStatus !== 200
      : expectation.httpStatus !== 201)
  ) {
    invalidResult();
  }
  return {
    requestId: envelope.data.requestId.toLowerCase(),
    data: {
      ...data.data,
      publication: {
        ...publication,
        requestId: publication.requestId.toLowerCase(),
        formVersionId: publication.formVersionId.toLowerCase(),
        publishedAt: publishedAt.toISOString(),
      },
    },
  };
}

export function parseFormPublicationActionError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
