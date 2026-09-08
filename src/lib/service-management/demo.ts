import type { ClaimReadSnapshot, ServiceUsageSnapshot } from "./types";

export function buildDemoServiceUsageSnapshot(serviceDate: string): ServiceUsageSnapshot {
  const people = [
    ["a1111111-1111-4111-8111-111111111111", "HX-021", "陳O華"],
    ["a2222222-2222-4222-8222-222222222222", "HX-022", "林O英"],
    ["a3333333-3333-4333-8333-333333333333", "HX-023", "黃O生"],
    ["a5555555-5555-4555-8555-555555555555", "HX-025", "張O德"],
  ] as const;
  return {
    serviceDate,
    generatedAt: `${serviceDate}T10:24:00+08:00`,
    demo: true,
    clients: people.map(([id, code, name]) => ({
      id,
      code,
      name,
      status: "active" as const,
      admittedOn: "2026-01-01",
      endedOn: null,
    })),
    items: people.map(([clientId, clientCode, clientName], index) => ({
      id: `9${index + 1}111111-1111-4111-8111-111111111111`,
      clientId,
      clientCode,
      clientName,
      serviceCode: `DEMO-SERVICE-${index + 1}`,
      status: index === 1 ? "planned" : index === 3 ? "cancelled" : "completed",
      startedAt: `${serviceDate}T${String(9 + index).padStart(2, "0")}:00:00+08:00`,
      endedAt:
        index === 1 || index === 3
          ? null
          : `${serviceDate}T${String(9 + index).padStart(2, "0")}:45:00+08:00`,
      durationMinutes: index === 1 || index === 3 ? null : 45,
      hasStaff: true,
      hasEffectivePlanLink: index !== 1,
      signedAt:
        index === 0 || index === 2
          ? `${serviceDate}T${String(10 + index).padStart(2, "0")}:00:00+08:00`
          : null,
    })),
  };
}

export function buildDemoClaimReadSnapshot(): ClaimReadSnapshot {
  return {
    generatedAt: "2026-09-01T10:24:00+08:00",
    demo: true,
    batches: [
      {
        id: "81111111-1111-4111-8111-111111111111",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        formatVersion: "synthetic-demo-v1",
        status: "draft",
        itemCount: 18,
        totalAmount: "12600.00",
        respondedItemCount: 0,
        rejectedItemCount: 0,
        legacyResponseUnknown: false,
        hasImmutableSnapshot: false,
        exportedAt: null,
        submittedAt: null,
        reconciledAt: null,
        updatedAt: "2026-09-01T09:00:00+08:00",
      },
      {
        id: "82222222-2222-4222-8222-222222222222",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        formatVersion: "synthetic-demo-v1",
        status: "reconciled",
        itemCount: 21,
        totalAmount: "14700.00",
        respondedItemCount: 21,
        rejectedItemCount: 0,
        legacyResponseUnknown: false,
        hasImmutableSnapshot: true,
        exportedAt: "2026-08-02T09:00:00+08:00",
        submittedAt: "2026-08-02T10:00:00+08:00",
        reconciledAt: "2026-08-10T15:00:00+08:00",
        updatedAt: "2026-08-10T15:00:00+08:00",
      },
      {
        id: "83333333-3333-4333-8333-333333333333",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        formatVersion: "synthetic-demo-v1",
        status: "rejected",
        itemCount: 20,
        totalAmount: "14000.00",
        respondedItemCount: 20,
        rejectedItemCount: 2,
        legacyResponseUnknown: false,
        hasImmutableSnapshot: true,
        exportedAt: "2026-07-02T09:00:00+08:00",
        submittedAt: "2026-07-02T10:00:00+08:00",
        reconciledAt: null,
        updatedAt: "2026-07-08T15:00:00+08:00",
      },
    ],
  };
}
