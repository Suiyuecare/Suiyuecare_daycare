import { createHash } from "node:crypto";

import type {
  InsulinAdministrationItem,
  InsulinAdministrationSnapshot,
  InsulinFilters,
} from "./types";

const ids = {
  organization: "05111111-1111-4111-8111-111111111111",
  branch: "05222222-2222-4222-8222-222222222222",
  clientA: "05333333-3333-4333-8333-333333333331",
  clientB: "05333333-3333-4333-8333-333333333332",
  clientC: "05333333-3333-4333-8333-333333333333",
  planA: "05444444-4444-4444-8444-444444444441",
  planB: "05444444-4444-4444-8444-444444444442",
  planC: "05444444-4444-4444-8444-444444444443",
  streamB: "05555555-5555-4555-8555-555555555552",
  streamC: "05555555-5555-4555-8555-555555555553",
  eventB: "05666666-6666-4666-8666-666666666662",
  eventC1: "05666666-6666-4666-8666-666666666663",
  eventC2: "05666666-6666-4666-8666-666666666664",
  executor: "05777777-7777-4777-8777-777777777771",
  reviewer: "05777777-7777-4777-8777-777777777772",
} as const;

function hash(label: string) {
  return createHash("sha256").update(`synthetic-page5-${label}`).digest("hex");
}

function at(serviceDate: string, time: string) {
  return new Date(`${serviceDate}T${time}:00+08:00`).toISOString();
}

export function buildDemoInsulinAdministrationSnapshot(
  filters: InsulinFilters,
): InsulinAdministrationSnapshot {
  const pendingAt = at(filters.serviceDate, "10:05");
  const completedAt = at(filters.serviceDate, "13:35");
  const reviewedAt = at(filters.serviceDate, "13:42");
  const items: InsulinAdministrationItem[] = [
    {
      medicationPlanId: ids.planA, medicationPlanVersion: 2,
      medicationPlanContentHash: hash("plan-a"), clientId: ids.clientA,
      clientCode: "DEMO-I01", clientDisplayName: "合成個案甲",
      medicationName: "合成短效胰島素 A", orderedDoseText: "6", doseUnit: "U",
      medicationRoute: "subcutaneous", scheduledFor: at(filters.serviceDate, "08:00"),
      eventId: null, administrationKey: null, eventSequence: 0,
      previousEventId: null, state: "scheduled", eventKind: null,
      actualDoseText: null, actualDoseUnit: null, siteCode: null, siteText: null,
      executedAt: null, executorUserId: null, executorDisplayName: null,
      lateEntry: false, lateReason: null, lateAuthorizedAt: null,
      lateAuthorizerUserId: null, lateAuthorizerDisplayName: null,
      reviewedAt: null, reviewerUserId: null, reviewerDisplayName: null,
      contentHash: null, isLate: false, history: [],
    },
    {
      medicationPlanId: ids.planB, medicationPlanVersion: 1,
      medicationPlanContentHash: hash("plan-b"), clientId: ids.clientB,
      clientCode: "DEMO-I02", clientDisplayName: "合成個案乙",
      medicationName: "合成長效胰島素 B", orderedDoseText: "12.5", doseUnit: "U",
      medicationRoute: "subcutaneous", scheduledFor: at(filters.serviceDate, "10:00"),
      eventId: ids.eventB, administrationKey: ids.streamB, eventSequence: 1,
      previousEventId: null, state: "pending_review", eventKind: "executed",
      actualDoseText: "12.5", actualDoseUnit: "U", siteCode: "ABDOMEN_LEFT",
      siteText: "左腹部", executedAt: pendingAt, executorUserId: ids.executor,
      executorDisplayName: "合成執行護理師", lateEntry: false, lateReason: null,
      lateAuthorizedAt: null, lateAuthorizerUserId: null,
      lateAuthorizerDisplayName: null, reviewedAt: null, reviewerUserId: null,
      reviewerDisplayName: null, contentHash: hash("event-b"), isLate: false,
      history: [{ eventId: ids.eventB, eventSequence: 1, previousEventId: null,
        eventKind: "executed", state: "pending_review", occurredAt: pendingAt,
        actorDisplayName: "合成執行護理師", contentHash: hash("event-b") }],
    },
    {
      medicationPlanId: ids.planC, medicationPlanVersion: 3,
      medicationPlanContentHash: hash("plan-c"), clientId: ids.clientC,
      clientCode: "DEMO-I03", clientDisplayName: "合成個案丙",
      medicationName: "合成混合型胰島素 C", orderedDoseText: "8", doseUnit: "U",
      medicationRoute: "subcutaneous", scheduledFor: at(filters.serviceDate, "13:30"),
      eventId: ids.eventC2, administrationKey: ids.streamC, eventSequence: 2,
      previousEventId: ids.eventC1, state: "completed", eventKind: "reviewed",
      actualDoseText: "8", actualDoseUnit: "U", siteCode: "RIGHT_ARM",
      siteText: "右上臂", executedAt: completedAt, executorUserId: ids.executor,
      executorDisplayName: "合成執行護理師", lateEntry: false, lateReason: null,
      lateAuthorizedAt: null, lateAuthorizerUserId: null,
      lateAuthorizerDisplayName: null, reviewedAt, reviewerUserId: ids.reviewer,
      reviewerDisplayName: "合成獨立覆核護理師", contentHash: hash("event-c2"),
      isLate: false,
      history: [
        { eventId: ids.eventC2, eventSequence: 2, previousEventId: ids.eventC1,
          eventKind: "reviewed", state: "completed", occurredAt: reviewedAt,
          actorDisplayName: "合成獨立覆核護理師", contentHash: hash("event-c2") },
        { eventId: ids.eventC1, eventSequence: 1, previousEventId: null,
          eventKind: "executed", state: "pending_review", occurredAt: completedAt,
          actorDisplayName: "合成執行護理師", contentHash: hash("event-c1") },
      ],
    },
  ];
  const filtered = items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.state === "all" || filters.state === item.state ||
      (filters.state === "late" && item.isLate)) &&
    (filters.shift === "all" ||
      (filters.shift === "morning" && Number(new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23",
      }).format(new Date(item.scheduledFor))) < 12) ||
      (filters.shift === "afternoon" && (() => {
        const hour = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Taipei",
          hour: "2-digit", hourCycle: "h23" }).format(new Date(item.scheduledFor)));
        return hour >= 12 && hour <= 17;
      })()) ||
      (filters.shift === "evening" && Number(new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23",
      }).format(new Date(item.scheduledFor))) >= 18)),
  );
  const generatedAt = new Date().toISOString();
  return {
    organizationId: ids.organization, organizationName: "合成日照機構",
    branchId: ids.branch, branchName: "合成示範分支", generatedAt,
    staleAfter: new Date(Date.parse(generatedAt) + 60_000).toISOString(),
    serviceDate: filters.serviceDate, snapshotToken: hash(JSON.stringify(filters)),
    items: filtered,
    metrics: {
      matching: filtered.length,
      scheduled: filtered.filter((item) => item.state === "scheduled").length,
      lateAuthorized: filtered.filter((item) => item.state === "late_authorized").length,
      pendingReview: filtered.filter((item) => item.state === "pending_review").length,
      completed: filtered.filter((item) => item.state === "completed").length,
      lateException: filtered.filter((item) => item.isLate).length,
    },
    itemsTruncated: false,
    clientOptions: [
      { clientId: ids.clientA, clientCode: "DEMO-I01", displayName: "合成個案甲" },
      { clientId: ids.clientB, clientCode: "DEMO-I02", displayName: "合成個案乙" },
      { clientId: ids.clientC, clientCode: "DEMO-I03", displayName: "合成個案丙" },
    ],
    governanceStatus: "not_configured", planDesignationStatus: "not_configured",
    qualificationStatus: "not_configured", doseRuleStatus: "not_configured",
    lateEntryRuleStatus: "not_configured", canExecute: false, canReview: false,
    canAuthorizeLate: false, offlineStatus: "not_configured",
    attachmentStatus: "not_configured", externalDeliveryStatus: "not_configured",
    deliveryClaim: "no_external_delivery_claim", demo: true,
  };
}
