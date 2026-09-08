import type {
  HandHygieneEvent,
  HandHygieneFilters,
  HandHygieneSnapshot,
} from "./types";

const ORIGIN = new Date("2026-09-02T02:00:00.000Z");

export function buildDemoHandHygieneSnapshot({
  organizationId,
  branchId,
  filters,
  now = ORIGIN,
}: {
  organizationId: string;
  branchId: string;
  filters: HandHygieneFilters;
  now?: Date;
}): HandHygieneSnapshot {
  const staff = [
    {
      staffMembershipId: "66000000-0000-4000-8000-000000000101",
      displayName: "合成照服員甲",
      employeeCode: "SYN-HH-01",
      isCurrent: true,
    },
    {
      staffMembershipId: "66000000-0000-4000-8000-000000000102",
      displayName: "合成護理師乙",
      employeeCode: "SYN-HH-02",
      isCurrent: true,
    },
  ] as const;
  const raw: HandHygieneEvent[] = [
    {
      eventId: "66000000-0000-4000-8000-000000000201",
      sourceProvider: "synthetic-sensor",
      sourceEventId: "SYN-EVT-001",
      deviceCode: "SYN-WASH-01",
      eventKind: "hygiene_performed" as const,
      occurredAt: "2026-09-02T01:30:00.000Z",
      receivedAt: "2026-09-02T01:30:02.000Z",
      matchStatus: "matched" as const,
      staffMembershipId: staff[0].staffMembershipId,
      staffDisplayName: staff[0].displayName,
      staffEmployeeCode: staff[0].employeeCode,
      correctionSequence: 0,
      correctionReason: null,
      correctedByDisplayName: null,
      correctedAt: null,
    },
    {
      eventId: "66000000-0000-4000-8000-000000000202",
      sourceProvider: "synthetic-sensor",
      sourceEventId: "SYN-EVT-002",
      deviceCode: "SYN-WASH-02",
      eventKind: "hygiene_performed" as const,
      occurredAt: "2026-09-02T01:25:00.000Z",
      receivedAt: "2026-09-02T01:25:03.000Z",
      matchStatus: "unmatched" as const,
      staffMembershipId: null,
      staffDisplayName: null,
      staffEmployeeCode: null,
      correctionSequence: 0,
      correctionReason: null,
      correctedByDisplayName: null,
      correctedAt: null,
    },
    {
      eventId: "66000000-0000-4000-8000-000000000203",
      sourceProvider: "synthetic-sensor",
      sourceEventId: "SYN-EVT-003",
      deviceCode: "SYN-DOOR-01",
      eventKind: "opportunity" as const,
      occurredAt: "2026-09-02T01:20:00.000Z",
      receivedAt: "2026-09-02T01:20:01.000Z",
      matchStatus: "matched" as const,
      staffMembershipId: staff[1].staffMembershipId,
      staffDisplayName: staff[1].displayName,
      staffEmployeeCode: staff[1].employeeCode,
      correctionSequence: 1,
      correctionReason: "合成配對修正",
      correctedByDisplayName: "合成督導",
      correctedAt: "2026-09-02T01:40:00.000Z",
    },
  ];
  const localDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
  const events = raw.filter((event) =>
    (filters.dateFrom === null || localDate(event.occurredAt) >= filters.dateFrom) &&
    (filters.dateTo === null || localDate(event.occurredAt) <= filters.dateTo) &&
    (filters.staffMembershipId === null || event.staffMembershipId === filters.staffMembershipId) &&
    (filters.deviceCode === null || event.deviceCode === filters.deviceCode) &&
    (filters.matchStatus === "all" || event.matchStatus === filters.matchStatus) &&
    (filters.eventKind === "all" || event.eventKind === filters.eventKind)
  );
  const nonExcluded = events.filter((event) => event.matchStatus !== "excluded");
  return {
    organizationId,
    branchId,
    generatedAt: now.toISOString(),
    staleAfter: new Date(now.getTime() + 5 * 60_000).toISOString(),
    filters,
    events,
    eventTotal: events.length,
    eventsTruncated: false,
    metrics: {
      performedEventTotal: nonExcluded.filter((event) =>
        event.eventKind === "hygiene_performed").length,
      matchedPerformedTotal: events.filter((event) =>
        event.eventKind === "hygiene_performed" && event.matchStatus === "matched").length,
      observedOpportunityEventTotal: nonExcluded.filter((event) =>
        event.eventKind === "opportunity").length,
      unmatchedTotal: events.filter((event) => event.matchStatus === "unmatched").length,
      excludedTotal: events.filter((event) => event.matchStatus === "excluded").length,
      denominatorTotal: null,
      attainmentRate: null,
    },
    staffOptions: staff,
    staffTotal: staff.length,
    staffTruncated: false,
    deviceOptions: [
      { deviceCode: "SYN-DOOR-01", eventCount: 1 },
      { deviceCode: "SYN-WASH-01", eventCount: 1 },
      { deviceCode: "SYN-WASH-02", eventCount: 1 },
    ],
    deviceTotal: 3,
    devicesTruncated: false,
    numeratorDefinition: "matched_distinct_hygiene_performed_events",
    denominatorPolicyStatus: "not_configured",
    denominatorDefinition: null,
    sourceIntegrationStatus: "database_contract_only",
    exportStatus: "not_configured",
    demo: true,
  };
}
