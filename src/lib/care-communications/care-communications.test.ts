import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoCareCommunicationSnapshot } from "./demo";
import {
  parseCareCommunicationApiSuccess,
  parseCareCommunicationCorrection,
  parseCareCommunicationCreate,
  parseCareCommunicationDatabaseReceipt,
} from "./parser";
import {
  projectCareCommunicationSnapshot,
  type CareCommunicationSnapshotSource,
} from "./projection";

const organizationId = "43100000-0000-4000-8000-000000000001";
const branchId = "43200000-0000-4000-8000-000000000001";
const clientId = "43400000-0000-4000-8000-000000000001";
const authorId = "43000000-0000-4000-8000-000000000001";
const communicationKey = "43c00000-0000-4000-8000-000000000001";
const versionId = "43b00000-0000-4000-8000-000000000001";
const operationId = "43700000-0000-4000-8000-000000000001";
const requestId = "43800000-0000-4000-8000-000000000001";
const idempotencyKey = "43900000-0000-4000-8000-000000000001";

function snapshotRow(): CareCommunicationSnapshotSource {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-02T03:00:00.000Z",
    items: [{
      version_id: versionId,
      communication_key: communicationKey,
      version: 1,
      previous_version_id: null,
      record_kind: "original",
      category: "care_communication",
      direction: "staff_to_family",
      client_id: clientId,
      client_display_name: "合成個案甲",
      client_code: "CARE-43-A",
      subject: "今日照顧摘要",
      body: "請登入系統查看今日摘要。",
      occurred_at: "2026-09-02T01:00:00.000Z",
      submitted_at: "2026-09-02T01:01:00.000Z",
      author_display_name: "範例社工",
      author_profile_kind: "staff",
      correction_reason: null,
      attachment_state: "none",
      recipient_count: 1,
      delivery_status: "queued",
      read_status: "not_configured",
      family_confirmation_status: "not_configured",
      is_current: true,
      recipients: [{
        display_name: "範例家屬",
        profile_kind: "family",
        relationship: "主要聯絡人",
        consent_document_version: "CARE43-v1",
        consent_scopes: ["messages.read"],
        consented_at: "2026-08-01T01:00:00.000Z",
        consent_expires_at: "2027-08-01T01:00:00.000Z",
      }],
      delivery_events: [{
        event_kind: "queued",
        channel: "family_pwa",
        provider_worker_status: "not_configured",
        family_consumer_status: "not_configured",
        offline_consumer_status: "not_configured",
        occurred_at: "2026-09-02T01:01:00.000Z",
      }],
    }],
    matching_total: 1,
    thread_total: 1,
    correction_total: 0,
    queued_total: 1,
    today_total: 1,
    attachment_total: 0,
    items_truncated: false,
    client_options: [{
      client_id: clientId,
      display_name: "合成個案甲",
      client_code: "CARE-43-A",
      authorized_family_count: 1,
    }],
    author_options: [{ user_id: authorId, display_name: "範例社工" }],
    can_manage: true,
    can_correct: true,
    category_boundary: "care_communication_only",
    family_recipient_boundary: "active_messages_read_consent",
    attachment_pipeline_status: "not_configured",
    provider_worker_status: "not_configured",
    family_consumer_status: "not_configured",
    offline_consumer_status: "not_configured",
  };
}

const createBody = {
  action: "create",
  clientId,
  subject: "今日照顧摘要",
  body: "請登入系統查看今日摘要。",
  occurredAt: "2026-09-02T09:00:00+08:00",
  attachments: [],
};

function databaseReceipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    operation_kind: "create",
    communication_key: communicationKey,
    version_id: versionId,
    communication_version: 1,
    previous_version_id: null,
    record_kind: "original",
    client_id: clientId,
    recipient_count: 1,
    delivery_status: "queued",
    read_status: "not_configured",
    family_confirmation_status: "not_configured",
    attachment_state: "none",
    submitted_at: "2026-09-02T01:01:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("care communication projection", () => {
  it("projects only immutable queued care communication evidence", () => {
    const result = projectCareCommunicationSnapshot({
      row: snapshotRow(),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      expectedCanManage: true,
      expectedCanCorrect: true,
      demo: false,
    });
    expect(result.items[0]).toMatchObject({
      category: "care_communication",
      deliveryStatus: "queued",
      readStatus: "not_configured",
      familyConfirmationStatus: "not_configured",
      attachmentState: "none",
      recipientCount: 1,
    });
    expect(result.familyRecipientBoundary).toBe("active_messages_read_consent");
    expect(result.items[0]).not.toHaveProperty("authorUserId");
  });

  it("fails closed on consultant category, missing message consent, receipt drift, or cross-branch scope", () => {
    const mutations = [
      (row: ReturnType<typeof snapshotRow>) => {
        (row.items[0] as { category: string }).category = "consultant";
      },
      (row: ReturnType<typeof snapshotRow>) => {
        row.items[0]!.recipients[0]!.consent_scopes = ["care.read"];
      },
      (row: ReturnType<typeof snapshotRow>) => {
        (row.items[0] as { delivery_status: string }).delivery_status = "delivered";
      },
      (row: ReturnType<typeof snapshotRow>) => {
        row.branch_id = "43200000-0000-4000-8000-000000000099";
      },
      (row: ReturnType<typeof snapshotRow>) => { row.queued_total = 0; },
    ];
    for (const mutate of mutations) {
      const row = snapshotRow();
      mutate(row);
      expect(() => projectCareCommunicationSnapshot({
        row,
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        expectedCanManage: true,
        expectedCanCorrect: true,
        demo: false,
      })).toThrow("INVALID_CARE_COMMUNICATION_SNAPSHOT");
    }
  });

  it("filters synthetic demo data without widening status or category claims", () => {
    const result = buildDemoCareCommunicationSnapshot({
      organizationId,
      branchId,
      filters: {
        clientId: "43d00000-0000-4000-8000-000000000001",
        dateFrom: "2026-09-02",
        dateTo: "2026-09-02",
        authorUserId: "43a00000-0000-4000-8000-000000000001",
        deliveryStatus: "queued",
        confirmationStatus: "not_configured",
        query: "活動",
      },
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) =>
      item.category === "care_communication" &&
      item.deliveryStatus === "queued" &&
      item.readStatus === "not_configured"
    )).toBe(true);
    expect(result.demo).toBe(true);
  });
});

describe("care communication strict write contracts", () => {
  it("normalizes create input and rejects unknown routing fields", () => {
    expect(parseCareCommunicationCreate({
      ...createBody,
      subject: "  今日照顧摘要  ",
    }, idempotencyKey)).toMatchObject({
      clientId,
      subject: "今日照顧摘要",
      attachments: [],
    });
    expect(() => parseCareCommunicationCreate({
      ...createBody,
      category: "consultant",
    }, idempotencyKey)).toThrow();
    expect(() => parseCareCommunicationCreate({
      ...createBody,
      recipientUserIds: [authorId],
    }, idempotencyKey)).toThrow();
  });

  it("rejects browser paths and URLs, then reports not_configured for a trusted reference", () => {
    for (const reference of ["/Users/example/file.pdf", "https://example.invalid/file.pdf"]) {
      expect(() => parseCareCommunicationCreate({
        ...createBody,
        attachments: [{ reference, sha256: "a".repeat(64) }],
      }, idempotencyKey)).toThrow();
    }
    try {
      parseCareCommunicationCreate({
        ...createBody,
        attachments: [{
          reference: "trusted-upload:43e00000-0000-4000-8000-000000000001",
          sha256: "a".repeat(64),
        }],
      }, idempotencyKey);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationError);
      expect((error as IntegrationError).code)
        .toBe("ATTACHMENT_PIPELINE_NOT_CONFIGURED");
      expect((error as IntegrationError).httpStatus).toBe(503);
    }
  });

  it("correlates a create database receipt to client, version and boundary", () => {
    const input = parseCareCommunicationCreate(createBody, idempotencyKey);
    expect(parseCareCommunicationDatabaseReceipt(
      databaseReceipt(),
      input,
    )).toMatchObject({
      communication_key: communicationKey,
      communication_version: 1,
      client_id: clientId,
      delivery_status: "queued",
    });
    expect(() => parseCareCommunicationDatabaseReceipt(
      databaseReceipt({ client_id: "43400000-0000-4000-8000-000000000099" }),
      input,
    )).toThrow();
    expect(() => parseCareCommunicationDatabaseReceipt(
      databaseReceipt({ read_status: "read" }),
      input,
    )).toThrow();
  });

  it("correlates a correction through database and browser receipts", () => {
    const input = parseCareCommunicationCorrection({
      action: "correct",
      clientId,
      communicationKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      subject: "今日照顧摘要（更正）",
      body: "更正活動地點。",
      correctionReason: "補充活動地點",
      attachments: [],
    }, idempotencyKey);
    const correctedVersionId = "43b00000-0000-4000-8000-000000000002";
    const receipt = databaseReceipt({
      operation_kind: "correct",
      version_id: correctedVersionId,
      communication_version: 2,
      previous_version_id: versionId,
      record_kind: "correction",
    });
    expect(parseCareCommunicationDatabaseReceipt(receipt, input)
      .communication_version).toBe(2);
    const api = {
      requestId,
      status: "ok",
      data: {
        action: "correct",
        operationId,
        communicationKey,
        versionId: correctedVersionId,
        communicationVersion: 2,
        previousVersionId: versionId,
        recordKind: "correction",
        clientId,
        recipientCount: 1,
        deliveryStatus: "queued",
        readStatus: "not_configured",
        familyConfirmationStatus: "not_configured",
        attachmentState: "none",
        submittedAt: "2026-09-02T01:01:00.000Z",
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(parseCareCommunicationApiSuccess(api, input).data.versionId)
      .toBe(correctedVersionId);
    expect(() => parseCareCommunicationApiSuccess({
      ...api,
      data: { ...api.data, communicationVersion: 3 },
    }, input)).toThrow("MISMATCHED_CARE_COMMUNICATION_SUCCESS");
  });
});
