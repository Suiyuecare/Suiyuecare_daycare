import { describe, expect, it } from "vitest";

import {
  buildClaimSnapshot,
  classifyClaimExportDatabaseFailure,
  MAX_CLAIM_RECONCILIATION_BYTES,
  parseClaimReconciliationRequest,
  parseClaimValidationRequest,
  sumMoney,
  validateReconciliationCoverage,
} from "./claims";
import { IntegrationError } from "./errors";
import {
  lineSignature,
  parseLineWebhook,
  verifyLineSignature,
} from "./line";
import {
  notificationPreview,
  parseNotificationRequest,
} from "./notifications";
import {
  GENERIC_RECORD_DRAFT_PAGE_SLUGS,
  isGenericRecordDraftPageSlug,
  parseRecordDraft,
  recordKeyFor,
  recordStorageData,
  storedRecordMatches,
} from "./records";
import {
  canonicalJson,
  deterministicUuid,
  payloadHash,
} from "./security";
import { MockSmsProvider } from "./sms";
import { hasVersionConflict, parseSyncBatch } from "./sync";

const clientId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";
const batchId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

describe("integration security primitives", () => {
  it("canonicalizes object keys and derives stable UUIDs", () => {
    expect(canonicalJson({ b: 2, a: [true, null] })).toBe(
      '{"a":[true,null],"b":2}',
    );
    const first = deterministicUuid("tenant", "user", "request-1234");
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(deterministicUuid("tenant", "user", "request-1234")).toBe(first);
    expect(deterministicUuid("tenant", "user", "request-5678")).not.toBe(
      first,
    );
  });
});

describe("generic record drafts", () => {
  it("validates the catalog slug and detects idempotent replay content", () => {
    const input = parseRecordDraft(
      {
        client_id: clientId,
        page_slug: "/staff/daily-care/care-diary/",
        occurred_at: "2026-09-01T09:00:00+08:00",
        data: {
          shift: "morning",
          care_item: "團體活動觀察",
          note: "完成活動",
          abnormal: false,
        },
        idempotency_key: "record-request-0001",
      },
      null,
    );
    expect(input.page.slug).toBe("staff/daily-care/care-diary");
    const stored = {
      client_id: input.clientId,
      category: input.page.slug,
      occurred_at: input.occurredAt,
      data: recordStorageData(input),
    };
    expect(storedRecordMatches(stored, input)).toBe(true);
    expect(
      recordKeyFor("tenant", "user", input.idempotencyKey),
    ).toBe(recordKeyFor("tenant", "user", input.idempotencyKey));
  });

  it("rejects family and unknown page slugs", () => {
    expect(() =>
      parseRecordDraft({
        client_id: clientId,
        page_slug: "family/communication",
        occurred_at: "2026-09-01T09:00:00+08:00",
        data: {},
        idempotency_key: "record-request-0002",
      }),
    ).toThrowError(IntegrationError);
  });

  it("fails closed for known staff pages outside the generic draft allowlist", () => {
    expect(GENERIC_RECORD_DRAFT_PAGE_SLUGS).toEqual([
      "staff/daily-care/care-diary",
    ]);
    expect(isGenericRecordDraftPageSlug("staff/daily-care/care-diary")).toBe(
      true,
    );

    for (const pageSlug of [
      "staff/daily-care/vital-signs",
      "staff/assessments/behavior-emotion",
      "staff/service-management/attendance",
      "staff/service-management/claims",
      "staff/operations/billing",
      "staff/governance/central-html-import",
    ]) {
      try {
        parseRecordDraft({
          client_id: clientId,
          page_slug: pageSlug,
          occurred_at: "2026-09-01T09:00:00+08:00",
          data: {},
          idempotency_key: `blocked-${pageSlug}`,
        });
        throw new Error("expected parseRecordDraft to reject the page");
      } catch (error) {
        expect(error).toBeInstanceOf(IntegrationError);
        expect((error as IntegrationError).code).toBe(
          "RECORD_DRAFT_PAGE_NOT_ALLOWED",
        );
      }
    }
  });

  it("requires the dedicated care diary schema and rejects unknown fields", () => {
    for (const data of [
      { shift: "night", care_item: "觀察", note: "", abnormal: false },
      { shift: "morning", care_item: "", note: "", abnormal: false },
      {
        shift: "morning",
        care_item: "觀察",
        note: "",
        abnormal: false,
        signed_by: userId,
      },
    ]) {
      try {
        parseRecordDraft({
          client_id: clientId,
          page_slug: "staff/daily-care/care-diary",
          occurred_at: "2026-09-01T09:00:00+08:00",
          data,
          idempotency_key: "record-request-schema-test",
        });
        throw new Error("expected care diary data rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(IntegrationError);
        expect((error as IntegrationError).code).toBe(
          "INVALID_CARE_DIARY_DATA",
        );
      }
    }
  });
});

describe("offline sync whitelist", () => {
  const now = new Date("2026-09-01T04:00:00.000Z");
  const payload = {
    client_id: clientId,
    measured_at: "2026-09-01T11:30:00+08:00",
    measurement_kind: "temperature",
    numeric_value: 36.5,
    unit: "C",
    context: {},
  };
  const validOperation = {
    idempotency_key: "sync-request-0001",
    entity_type: "vital-sign",
    entity_id: entityId,
    base_version: 0,
    occurred_at: "2026-09-01T11:31:00+08:00",
    device_id: "device-000001",
    payload_hash: payloadHash(payload),
    payload,
  };

  it("accepts only the three approved offline entities and verifies hashes", () => {
    const [operation] = parseSyncBatch({ operations: [validOperation] }, now);
    expect(operation).toMatchObject({
      entityType: "vital-sign",
      baseVersion: 0,
      clientId,
    });
    expect(hasVersionConflict(1, 2)).toBe(true);
    expect(hasVersionConflict(2, 2)).toBe(false);
  });

  it("rejects medication, finance and claim entities", () => {
    for (const entityType of ["medication", "finance", "claims"]) {
      expect(() =>
        parseSyncBatch(
          {
            operations: [
              { ...validOperation, entity_type: entityType },
            ],
          },
          now,
        ),
      ).toThrowError(/不得離線同步/u);
    }
  });

  it("rejects more than 100 operations and a modified payload", () => {
    expect(() =>
      parseSyncBatch(
        { operations: Array.from({ length: 101 }, () => validOperation) },
        now,
      ),
    ).toThrowError(/最多 100 筆/u);
    expect(() =>
      parseSyncBatch(
        {
          operations: [
            {
              ...validOperation,
              payload: { ...payload, numeric_value: 39 },
            },
          ],
        },
        now,
      ),
    ).toThrowError(/雜湊/u);
  });
});

describe("LINE webhook security", () => {
  it("verifies HMAC and retains only safe event metadata", () => {
    const raw = JSON.stringify({
      destination: "channel-destination",
      events: [
        { webhookEventId: "event-1", type: "message", message: { text: "機密" } },
        { webhookEventId: "event-1", type: "message" },
        { webhookEventId: "event-2", type: "follow" },
      ],
    });
    const signature = lineSignature(raw, "channel-secret");
    expect(verifyLineSignature(raw, signature, "channel-secret")).toBe(true);
    expect(verifyLineSignature(`${raw} `, signature, "channel-secret")).toBe(
      false,
    );
    const parsed = parseLineWebhook(raw);
    expect(parsed.events).toEqual([
      { eventId: "event-1", eventType: "message" },
      { eventId: "event-2", eventType: "follow" },
    ]);
    expect(parsed.duplicateEventIds).toEqual(["event-1"]);
    expect(canonicalJson(parsed)).not.toContain("機密");
  });
});

describe("notification safety and preview", () => {
  it("deduplicates recipients and channels without echoing them in preview", () => {
    const input = parseNotificationRequest({
      idempotency_key: "notification-request-0001",
      mode: "preview",
      category: "schedule",
      priority: 2,
      title: "您有新的重要通知",
      body: "請登入系統查看最新內容。",
      recipient_user_ids: [userId, userId, clientId],
      channels: ["pwa", "pwa", "line"],
    });
    expect(notificationPreview(input)).toEqual({
      recipientCount: 2,
      channelCount: 2,
      deliveryCount: 4,
      bulk: false,
      scheduled: false,
      containsSensitiveContent: false,
    });
  });

  it("rejects direct identifiers and care details", () => {
    expect(() =>
      parseNotificationRequest({
        idempotency_key: "notification-request-0002",
        mode: "queue",
        category: "health",
        title: "血糖異常",
        body: "王小明血糖 250，請注意。",
        recipient_user_ids: [userId],
        channels: ["line"],
      }),
    ).toThrowError(/不得包含/u);
  });
});

describe("claim snapshot and reconciliation", () => {
  const batch = {
    id: batchId,
    claim_period_start: "2026-08-01",
    claim_period_end: "2026-08-31",
    format_version: "tw-test-v1",
  };
  const items = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      client_id: clientId,
      service_event_id: "66666666-6666-4666-8666-666666666666",
      service_code: "BB01",
      service_date: "2026-08-02",
      units: "1.5000",
      amount: "100.10",
      evidence_hash: "a".repeat(64),
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      client_id: clientId,
      service_event_id: "88888888-8888-4888-8888-888888888888",
      service_code: "BB02",
      service_date: "2026-08-03",
      units: "2",
      amount: "20.20",
      evidence_hash: "b".repeat(64),
    },
  ];

  it("adds money as exact decimal strings and creates a stable hash", () => {
    const first = buildClaimSnapshot(batch, items, "120.30");
    const reordered = buildClaimSnapshot(batch, [...items].reverse(), "120.30");
    expect(first.totalAmount).toBe("120.30");
    expect(first.snapshotHash).toBe(reordered.snapshotHash);
    expect(() => buildClaimSnapshot(batch, items, "120.29")).toThrowError(
      /總額/u,
    );
  });

  it("adds list totals without floating point rounding", () => {
    expect(sumMoney(["0.10", "0.20", "100000000000.99"])).toBe(
      "100000000001.29",
    );
  });

  it("strictly parses a validation request and normalizes its confirmed total", () => {
    expect(
      parseClaimValidationRequest({
        idempotency_key: "claim-validate-0001",
        claim_batch_id: batchId,
        expected_total_amount: "120.3",
        expected_item_count: 2,
      }),
    ).toMatchObject({
      claimBatchId: batchId,
      expectedTotalAmount: "120.30",
      expectedItemCount: 2,
    });
    expect(() =>
      parseClaimValidationRequest({
        idempotency_key: "claim-validate-0002",
        claim_batch_id: batchId,
        expected_total_amount: "120.30",
        expected_item_count: 2,
        status: "validated",
      }),
    ).toThrowError(IntegrationError);
  });

  it.each([undefined, null, 0, 1.5, 5001, "2"])("requires an exact bounded confirmed item count: %j", (itemCount) => {
    expect(() => parseClaimValidationRequest({ idempotency_key: "claim-validate-count",
      claim_batch_id: batchId, expected_total_amount: "120.30", expected_item_count: itemCount,
    })).toThrowError(IntegrationError);
  });

  it("distinguishes duplicate service allocation from an idempotency collision", () => {
    expect(classifyClaimExportDatabaseFailure("23514")).toMatchObject({
      code: "CLAIM_EXPORT_REJECTED",
      httpStatus: 422,
    });
    expect(classifyClaimExportDatabaseFailure("23514").message).not.toContain(
      "冪等鍵",
    );
    expect(classifyClaimExportDatabaseFailure("23505").code).toBe(
      "CLAIM_EXPORT_IDEMPOTENCY_CONFLICT",
    );
    expect(classifyClaimExportDatabaseFailure("P2001")).toMatchObject({
      code: "CLAIM_EXPORT_ALREADY_COMPLETED",
      httpStatus: 409,
    });
  });

  it("requires one reconciliation result per claim item", () => {
    const request = parseClaimReconciliationRequest({
      idempotency_key: "claim-reconcile-0001",
      claim_batch_id: batchId,
      expected_total_amount: "120.30",
      results: items.map((item) => ({
        claim_item_id: item.id,
        outcome: "accepted",
        response_code: "A000",
      })),
    });
    expect(() =>
      validateReconciliationCoverage(
        items.map((item) => item.id),
        request,
      ),
    ).not.toThrow();
    expect(() =>
      validateReconciliationCoverage([items[0]!.id], request),
    ).toThrowError(/逐筆涵蓋/u);
  });

  it("keeps the full 5,000-row JSON contract below the 2 MiB route limit", () => {
    const results = Array.from({ length: 5000 }, (_, index) => ({
      claim_item_id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      outcome: "rejected" as const,
      response_code: "X".repeat(40),
      response_message: "😀".repeat(16),
    }));
    const request = {
      idempotency_key: "claim-reconcile-capacity",
      claim_batch_id: batchId,
      expected_total_amount: "999999999999.99",
      results,
    };
    const maximallyEscapedAstralJson = JSON.stringify(request).replaceAll(
      "😀",
      "\\ud83d\\ude00",
    );
    expect(new TextEncoder().encode(maximallyEscapedAstralJson).length).toBeLessThan(
      MAX_CLAIM_RECONCILIATION_BYTES,
    );
    expect(parseClaimReconciliationRequest(request).results).toHaveLength(5000);
  });

  it("rejects response text that can break the bounded JSON contract", () => {
    expect(() =>
      parseClaimReconciliationRequest({
        idempotency_key: "claim-reconcile-too-long",
        claim_batch_id: batchId,
        expected_total_amount: "1.00",
        results: [{
          claim_item_id: items[0]!.id,
          outcome: "rejected",
          response_code: "NO",
          response_message: "中".repeat(22),
        }],
      }),
    ).toThrowError(IntegrationError);
    expect(() =>
      parseClaimReconciliationRequest({
        idempotency_key: "claim-reconcile-surrogate",
        claim_batch_id: batchId,
        expected_total_amount: "1.00",
        results: [{
          claim_item_id: items[0]!.id,
          outcome: "rejected",
          response_code: "NO",
          response_message: "\ud800",
        }],
      }),
    ).toThrowError(IntegrationError);
  });

});

describe("mock SMS provider", () => {
  it("suppresses delivery by default and rejects sensitive copy", async () => {
    const provider = new MockSmsProvider();
    await expect(
      provider.send({
        to: "0912345678",
        body: "請登入系統查看最新內容。",
        idempotencyKey: "sms-request-0001",
      }),
    ).resolves.toMatchObject({ status: "suppressed", demo: true });
    await expect(
      provider.send({
        to: "0912345678",
        body: "您的血壓異常。",
        idempotencyKey: "sms-request-0002",
      }),
    ).rejects.toThrowError(/不得包含/u);
  });
});
