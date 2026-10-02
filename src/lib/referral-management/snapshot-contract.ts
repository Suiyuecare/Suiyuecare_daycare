import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { projectReferralManagementSnapshot } from "./projection";
import type { ReferralManagementSnapshot } from "./types";

const timestamp = z.string().max(64).refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const topFields = [
  "organizationId", "organizationName", "branchId", "branchName", "generatedAt", "staleAfter", "snapshotToken",
  "items", "metrics", "itemsTruncated", "clientOptions", "receivingUnitOptions", "canCreate", "canSubmit",
  "canRegisterReceipt", "canRespond", "canClose", "canCorrect", "receivingUnitDirectoryStatus", "attachmentStatus",
  "exportStatus", "notificationQueueStatus", "notificationProviderStatus", "externalDeliveryStatus", "deliveryClaim", "demo",
] as const;
const itemFields = [
  "eventId", "referralKey", "sequence", "previousEventId", "correctsEventId", "eventKind", "clientId", "clientDisplayName",
  "clientCode", "ownerUserId", "ownerDisplayName", "receivingUnitState", "receivingUnitCode", "receivingUnitName",
  "receivingUnitDirectoryStatus", "referralDate", "referralReason", "entryContent", "correctionReason", "status",
  "occurredAt", "actorDisplayName", "contentHash", "notification", "history",
] as const;
const historyFields = [
  "eventId", "sequence", "eventKind", "correctsEventId", "entryContent", "correctionReason", "status",
  "occurredAt", "actorDisplayName", "contentHash", "notificationRecipientCount",
] as const;
function exactFields(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new Error("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
  }
}
function boundedArray(value: unknown, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
}
/** Reject unexpected AND missing fields before re-encoding, including nested
 * contracts. The existing projection remains the sole scalar/domain validator.
 * This module is pure and usable from both server and client without React,
 * server credentials, side effects, recency authority or operation settlement. */
function assertSnapshotShape(value: unknown): asserts value is ReferralManagementSnapshot {
  exactFields(value, topFields);
  if (typeof value.demo !== "boolean") throw new Error("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
  exactFields(value.metrics, ["matching", "draft", "submitted", "received", "responded", "closed", "unitMissing", "unitNotApplicable"]);
  boundedArray(value.items, 200);
  for (const item of value.items) {
    exactFields(item, itemFields);
    exactFields(item.notification, ["queueStatus", "deliveryClaim", "providerStatus", "recipientCount"]);
    boundedArray(item.history, 10_000);
    for (const event of item.history) exactFields(event, historyFields);
  }
  boundedArray(value.clientOptions, 200);
  for (const client of value.clientOptions) exactFields(client, ["clientId", "displayName", "clientCode"]);
  boundedArray(value.receivingUnitOptions, 100);
  for (const unit of value.receivingUnitOptions) exactFields(unit, ["code", "name", "directoryStatus"]);
}

export function normalizeReferralSnapshot(raw: unknown, scope: { organizationId: string; branchId: string }): ReferralManagementSnapshot {
  assertSnapshotShape(raw);
  const value = raw as ReferralManagementSnapshot;
  const items = value.items.map((item) => ({
    event_id: item.eventId, referral_key: item.referralKey, sequence: item.sequence, previous_event_id: item.previousEventId,
    corrects_event_id: item.correctsEventId, event_kind: item.eventKind, client_id: item.clientId,
    client_display_name: item.clientDisplayName, client_code: item.clientCode, owner_user_id: item.ownerUserId,
    owner_display_name: item.ownerDisplayName, receiving_unit_state: item.receivingUnitState,
    receiving_unit_code: item.receivingUnitCode, receiving_unit_name: item.receivingUnitName,
    receiving_unit_directory_status: item.receivingUnitDirectoryStatus, referral_date: item.referralDate,
    referral_reason: item.referralReason, entry_content: item.entryContent, correction_reason: item.correctionReason,
    status: item.status, occurred_at: item.occurredAt, actor_display_name: item.actorDisplayName, content_hash: item.contentHash,
    notification: { queue_status: item.notification.queueStatus, delivery_claim: item.notification.deliveryClaim,
      provider_status: item.notification.providerStatus, recipient_count: item.notification.recipientCount },
    history: item.history.map((entry) => ({ event_id: entry.eventId, sequence: entry.sequence, event_kind: entry.eventKind,
      corrects_event_id: entry.correctsEventId, entry_content: entry.entryContent, correction_reason: entry.correctionReason,
      status: entry.status, occurred_at: entry.occurredAt, actor_display_name: entry.actorDisplayName,
      content_hash: entry.contentHash, notification_recipient_count: entry.notificationRecipientCount })),
  }));
  const normalized = projectReferralManagementSnapshot({ expectedOrganizationId: scope.organizationId, expectedBranchId: scope.branchId,
    expectedCanCreate: value.canCreate, expectedCanSubmit: value.canSubmit, expectedCanRegisterReceipt: value.canRegisterReceipt,
    expectedCanRespond: value.canRespond, expectedCanClose: value.canClose, expectedCanCorrect: value.canCorrect, demo: value.demo,
    row: { organization_id: value.organizationId, organization_name: value.organizationName, branch_id: value.branchId,
      branch_name: value.branchName, generated_at: value.generatedAt, snapshot_token: value.snapshotToken, items,
      matching_total: value.metrics.matching, draft_total: value.metrics.draft, submitted_total: value.metrics.submitted,
      received_total: value.metrics.received, responded_total: value.metrics.responded, closed_total: value.metrics.closed,
      unit_missing_total: value.metrics.unitMissing, unit_not_applicable_total: value.metrics.unitNotApplicable, items_truncated: value.itemsTruncated,
      client_options: value.clientOptions.map((item) => ({ client_id: item.clientId, display_name: item.displayName, client_code: item.clientCode })),
      receiving_unit_options: value.receivingUnitOptions.map((item) => ({ code: item.code, name: item.name, directory_status: item.directoryStatus })),
      can_create: value.canCreate, can_submit: value.canSubmit, can_register_receipt: value.canRegisterReceipt,
      can_respond: value.canRespond, can_close: value.canClose, can_correct: value.canCorrect,
      receiving_unit_directory_status: value.receivingUnitDirectoryStatus, attachment_status: value.attachmentStatus,
      export_status: value.exportStatus, notification_queue_status: value.notificationQueueStatus,
      notification_provider_status: value.notificationProviderStatus, external_delivery_status: value.externalDeliveryStatus, delivery_claim: value.deliveryClaim } });
  if (timestamp.parse(value.staleAfter) !== normalized.staleAfter) throw new Error("INVALID_REFERRAL_SNAPSHOT_FRESHNESS");
  return normalized;
}
