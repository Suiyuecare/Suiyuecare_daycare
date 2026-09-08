import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import {
  CLIENT_TOCC_BATCH_MAX_BYTES,
  CLIENT_TOCC_BATCH_MAX_ITEMS,
  CLIENT_TOCC_SINGLE_MAX_BYTES,
  parseClientToccBatchInput,
  parseClientToccBatchApiPayload,
  parseClientToccBatchApiEnvelope,
  parseClientToccBatchResults,
  parseClientToccErrorEnvelope,
  parseClientToccSingleApiResult,
  parseClientToccSingleApiEnvelope,
  parseClientToccSingleInput,
  parseClientToccSingleResult,
} from "./client-tocc";

const headerKey = "a1111111-1111-4111-8111-111111111111";
const clientId = "b1111111-1111-4111-8111-111111111111";
const itemKey = "c1111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-01T04:00:00.000Z");

function body(overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    assessment_date: "2026-09-01",
    result_status: "clear",
    symptom_summary: null,
    risk_summary: null,
    evidence_status: "not_required",
    action_status: "none_required",
    ...overrides,
  };
}

describe("dedicated client TOCC API contract", () => {
  it("uses a UUID header, 32KB single limit and bounded 100-item batch", () => {
    expect(CLIENT_TOCC_SINGLE_MAX_BYTES).toBe(32 * 1024);
    expect(CLIENT_TOCC_BATCH_MAX_BYTES).toBe(256 * 1024);
    expect(CLIENT_TOCC_BATCH_MAX_ITEMS).toBe(100);
    expect(() => parseClientToccSingleInput(body(), "not-a-uuid", now)).toThrow(
      /UUID 冪等鍵/u,
    );
  });

  it.each([
    "organization_id",
    "branch_id",
    "actor_user_id",
    "source",
    "valid_through",
    "validity_rule_version",
    "content_hash",
    "signed_at",
    "signed_by",
    "signature_reauth_challenge_id",
  ])("strictly rejects browser-owned %s", (field) => {
    expect(() =>
      parseClientToccSingleInput(body({ [field]: "caller-value" }), headerKey, now),
    ).toThrow(IntegrationError);
    expect(() =>
      parseClientToccBatchInput(
        { items: [{ ...body({ [field]: "caller-value" }), idempotency_key: itemKey }] },
        headerKey,
        now,
      ),
    ).toThrow(IntegrationError);
  });

  it("applies identical semantic validation to single and batch items", () => {
    const invalid = body({
      result_status: "monitor",
      symptom_summary: "",
      risk_summary: "",
      action_status: "pending",
    });
    let singleError: IntegrationError | null = null;
    let batchError: IntegrationError | null = null;
    try {
      parseClientToccSingleInput(invalid, headerKey, now);
    } catch (error) {
      singleError = error as IntegrationError;
    }
    try {
      parseClientToccBatchInput(
        { items: [{ ...invalid, idempotency_key: itemKey }] },
        headerKey,
        now,
      );
    } catch (error) {
      batchError = error as IntegrationError;
    }
    expect(singleError?.code).toBe("INVALID_CLIENT_TOCC");
    expect(batchError?.code).toBe(singleError?.code);
    expect(batchError?.message).toBe(singleError?.message);
    expect(batchError?.field).toBe(`items.0.${singleError?.field}`);
  });

  it("rejects duplicate item UUIDs before the formal adapter", () => {
    expect(() =>
      parseClientToccBatchInput(
        {
          items: [
            { ...body(), idempotency_key: itemKey },
            { ...body(), idempotency_key: itemKey },
          ],
        },
        headerKey,
        now,
      ),
    ).toThrow(/每一筆必須使用不同 UUID/u);
  });

  it("fails closed unless the single RPC exactly echoes the safe business result", () => {
    const input = parseClientToccSingleInput(body(), headerKey, now);
    const result = parseClientToccSingleResult(
      [
        {
          assessment_id: "d1111111-1111-4111-8111-111111111111",
          client_id: clientId,
          assessment_version: 4,
          assessment_date: "2026-09-01",
          valid_through: "2026-10-01",
          result_status: "clear",
          evidence_status: "not_required",
          action_status: "none_required",
          replayed: false,
        },
      ],
      input,
    );
    expect(result).toMatchObject({
      assessmentVersion: 4,
      source: "staff",
      persisted: true,
      demo: false,
    });
    expect(() =>
      parseClientToccSingleResult(
        [
          {
            assessment_id: "d1111111-1111-4111-8111-111111111111",
            client_id: clientId,
            assessment_version: 4,
            assessment_date: "2026-09-01",
            valid_through: "2026-10-01",
            result_status: "clear",
            evidence_status: "not_required",
            action_status: "none_required",
            replayed: false,
            signed_by: "caller-visible",
          },
        ],
        input,
      ),
    ).toThrow(/未完整確認/u);
  });

  it("strictly verifies the browser-facing single 2xx payload", () => {
    const input = parseClientToccSingleInput(body(), headerKey, now);
    expect(
      parseClientToccSingleApiResult(
        {
          assessmentId: "d1111111-1111-4111-8111-111111111111",
          clientId,
          assessmentVersion: 4,
          assessmentDate: "2026-09-01",
          validThrough: "2026-10-01",
          resultStatus: "clear",
          evidenceStatus: "not_required",
          actionStatus: "none_required",
          source: "staff",
          replayed: false,
          persisted: true,
          demo: false,
        },
        input,
      ).assessmentVersion,
    ).toBe(4);
    expect(() =>
      parseClientToccSingleApiResult(
        {
          assessmentId: "d1111111-1111-4111-8111-111111111111",
          clientId,
          assessmentVersion: 4,
          assessmentDate: "2026-09-01",
          validThrough: "2026-10-01",
          resultStatus: "clear",
          evidenceStatus: "not_required",
          actionStatus: "none_required",
          source: "staff",
          replayed: false,
          persisted: true,
          demo: false,
          signedBy: "unexpected",
        },
        input,
      ),
    ).toThrow(/未完整確認/u);
  });

  it("rejects a parseable data object inside a malformed or error envelope", () => {
    const input = parseClientToccSingleInput(body(), headerKey, now);
    const data = {
      assessmentId: "d1111111-1111-4111-8111-111111111111",
      clientId,
      assessmentVersion: 4,
      assessmentDate: "2026-09-01",
      validThrough: "2026-10-01",
      resultStatus: "clear",
      evidenceStatus: "not_required",
      actionStatus: "none_required",
      source: "staff",
      replayed: false,
      persisted: true,
      demo: false,
    };
    expect(() =>
      parseClientToccSingleApiEnvelope(
        {
          requestId: "e1111111-1111-4111-8111-111111111111",
          status: "error",
          data,
          errors: [],
        },
        input,
        201,
      ),
    ).toThrow(/API 回應未完整確認/u);
    expect(() =>
      parseClientToccSingleApiEnvelope(
        { requestId: "", status: "ok", data, errors: [] },
        input,
        201,
      ),
    ).toThrow(/API 回應未完整確認/u);
  });

  it("requires the single HTTP status to match create versus replay", () => {
    const input = parseClientToccSingleInput(body(), headerKey, now);
    const envelope = {
      requestId: "e1111111-1111-4111-8111-111111111111",
      status: "ok",
      data: {
        assessmentId: "d1111111-1111-4111-8111-111111111111",
        clientId,
        assessmentVersion: 4,
        assessmentDate: "2026-09-01",
        validThrough: "2026-10-01",
        resultStatus: "clear",
        evidenceStatus: "not_required",
        actionStatus: "none_required",
        source: "staff",
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(parseClientToccSingleApiEnvelope(envelope, input, 201).data.replayed).toBe(false);
    expect(() => parseClientToccSingleApiEnvelope(envelope, input, 200)).toThrow(
      /HTTP 狀態/u,
    );
  });

  it("accepts only bounded structured browser errors", () => {
    expect(parseClientToccErrorEnvelope({
      requestId: "e1111111-1111-4111-8111-111111111111",
      status: "error",
      data: null,
      errors: [{ code: "CLIENT_TOCC_NOT_AUTHORIZED", message: "目前無權限。" }],
    })).toMatchObject({
      requestId: "e1111111-1111-4111-8111-111111111111",
      error: { code: "CLIENT_TOCC_NOT_AUTHORIZED", message: "目前無權限。" },
    });
    expect(parseClientToccErrorEnvelope({
      requestId: "not-a-uuid",
      status: "error",
      data: null,
      errors: [{ code: "RAW", message: "private\u0000detail" }],
    })).toBeNull();
  });

  it("keeps successful and failed batch items explicit and ordered", () => {
    const secondKey = "c2222222-2222-4222-8222-222222222222";
    const input = parseClientToccBatchInput(
      {
        items: [
          { ...body(), idempotency_key: itemKey },
          { ...body(), idempotency_key: secondKey },
        ],
      },
      headerKey,
      now,
    );
    const results = parseClientToccBatchResults(
      [
        {
          item_index: 2,
          item_idempotency_key: secondKey,
          status: "failed",
          assessment_id: null,
          assessment_version: null,
          valid_through: null,
          item_replayed: false,
          batch_replayed: false,
          error: { code: "forbidden", sqlstate: "42501", retryable: false },
        },
        {
          item_index: 1,
          item_idempotency_key: itemKey,
          status: "success",
          assessment_id: "d1111111-1111-4111-8111-111111111111",
          assessment_version: 5,
          valid_through: "2026-10-01",
          item_replayed: false,
          batch_replayed: false,
          error: null,
        },
      ],
      input,
    );
    expect(results.map((result) => result.status)).toEqual(["success", "failed"]);
    expect(results[1]?.error).toEqual({
      code: "forbidden",
      sqlstate: "42501",
      retryable: false,
    });
  });

  it("rejects duplicate indices, malformed success shapes and inconsistent API counts", () => {
    const secondKey = "c2222222-2222-4222-8222-222222222222";
    const input = parseClientToccBatchInput(
      {
        items: [
          { ...body(), idempotency_key: itemKey },
          { ...body(), idempotency_key: secondKey },
        ],
      },
      headerKey,
      now,
    );
    const duplicate = [itemKey, secondKey].map((key) => ({
      item_index: 1,
      item_idempotency_key: key,
      status: "success",
      assessment_id: "d1111111-1111-4111-8111-111111111111",
      assessment_version: 1,
      valid_through: "2026-10-01",
      item_replayed: false,
      batch_replayed: false,
      error: null,
    }));
    expect(() => parseClientToccBatchResults(duplicate, input)).toThrow(
      /項目對應不一致/u,
    );

    expect(() =>
      parseClientToccBatchApiPayload(
        {
          items: [
            {
              itemIndex: 1,
              itemIdempotencyKey: itemKey,
              status: "success",
              assessmentId: null,
              assessmentVersion: null,
              validThrough: "2026-10-01",
              itemReplayed: false,
              batchReplayed: false,
              error: null,
            },
            {
              itemIndex: 2,
              itemIdempotencyKey: secondKey,
              status: "failed",
              assessmentId: null,
              assessmentVersion: null,
              validThrough: null,
              itemReplayed: false,
              batchReplayed: false,
              error: { code: "forbidden", sqlstate: "42501", retryable: false },
            },
          ],
          counts: { total: 2, success: 2, failed: 0 },
          persisted: true,
          demo: false,
        },
        input,
      ),
    ).toThrow(/項目結果不完整|統計/u);
  });

  it("requires batch envelope status and safe errors to match failed items", () => {
    const input = parseClientToccBatchInput(
      { items: [{ ...body(), idempotency_key: itemKey }] },
      headerKey,
      now,
    );
    const data = {
      items: [
        {
          itemIndex: 1,
          itemIdempotencyKey: itemKey,
          status: "failed",
          assessmentId: null,
          assessmentVersion: null,
          validThrough: null,
          itemReplayed: false,
          batchReplayed: false,
          error: { code: "forbidden", sqlstate: "42501", retryable: false },
        },
      ],
      counts: { total: 1, success: 0, failed: 1 },
      persisted: true,
      demo: false,
    };
    expect(() =>
      parseClientToccBatchApiEnvelope(
        {
          requestId: "e1111111-1111-4111-8111-111111111111",
          status: "ok",
          data,
          errors: [],
        },
        input,
        201,
      ),
    ).toThrow(/狀態、錯誤與逐筆結果不一致/u);
    expect(
      parseClientToccBatchApiEnvelope(
        {
          requestId: "e1111111-1111-4111-8111-111111111111",
          status: "partial",
          data,
          errors: [
            {
              code: "CLIENT_TOCC_ITEM_FORBIDDEN",
              message: "個案目前不在可寫入的有效指派範圍。",
              field: "items.0",
            },
          ],
        },
        input,
        207,
      ).requestId,
    ).toBe("e1111111-1111-4111-8111-111111111111");
    expect(() => parseClientToccBatchApiEnvelope(
      {
        requestId: "e1111111-1111-4111-8111-111111111111",
        status: "partial",
        data,
        errors: [{
          code: "CLIENT_TOCC_ITEM_FORBIDDEN",
          message: "個案目前不在可寫入的有效指派範圍。",
          field: "items.0",
        }],
      },
      input,
      200,
    )).toThrow(/HTTP 狀態/u);
  });
});
