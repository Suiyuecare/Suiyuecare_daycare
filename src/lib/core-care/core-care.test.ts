import { describe, expect, it } from "vitest";

import { parseServiceDate, taipeiDayBoundsUtc, taipeiToday } from "./date";
import { buildDemoDailySnapshot } from "./demo";
import {
  filterDailyCareSnapshotByClient,
  projectDailyCareSnapshot,
} from "./projection";

describe("Taipei service day", () => {
  it("uses Asia/Taipei rather than the server timezone", () => {
    expect(taipeiToday(new Date("2026-08-31T16:30:00.000Z"))).toBe(
      "2026-09-01",
    );
    expect(taipeiDayBoundsUtc("2026-09-01")).toEqual({
      start: "2026-08-31T16:00:00.000Z",
      end: "2026-09-01T16:00:00.000Z",
    });
  });

  it("falls back for impossible or untrusted dates", () => {
    const now = new Date("2026-09-01T04:00:00.000Z");
    expect(parseServiceDate("2026-02-31", now)).toBe("2026-09-01");
    expect(parseServiceDate("<script>", now)).toBe("2026-09-01");
  });
});

describe("daily care projection", () => {
  it("uses latest measurements per kind and one latest diary without exposing notes", () => {
    const snapshot = projectDailyCareSnapshot({
      serviceDate: "2026-09-01",
      generatedAt: "2026-09-01T02:00:00.000Z",
      clients: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          client_code: "HX-001",
          display_name: "測試個案",
        },
      ],
      attendance: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          client_id: "11111111-1111-4111-8111-111111111111",
          status: "present",
          checked_in_at: "2026-09-01T08:00:00+08:00",
          checked_out_at: null,
          source: "staff",
        },
      ],
      measurements: [
        {
          client_id: "11111111-1111-4111-8111-111111111111",
          measurement_kind: "temperature",
          measured_at: "2026-09-01T09:05:00+08:00",
          numeric_value: "36.8",
        },
        {
          client_id: "11111111-1111-4111-8111-111111111111",
          measurement_kind: "temperature",
          measured_at: "2026-09-01T08:05:00+08:00",
          numeric_value: 36.4,
        },
      ],
      careDiaries: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          client_id: "11111111-1111-4111-8111-111111111111",
          status: "signed",
          occurred_at: "2026-09-01T10:00:00+08:00",
          data: { note: "不得送到摘要", abnormal: true },
        },
      ],
      serviceEvents: [
        {
          client_id: "11111111-1111-4111-8111-111111111111",
          status: "completed",
        },
      ],
    });

    expect(snapshot.clients[0]).toMatchObject({
      sourceCoverage: 4,
      completedServiceCount: 1,
      vitalSigns: { temperature: 36.8 },
      careDiary: { hasAbnormalFlag: true },
    });
    expect(JSON.stringify(snapshot)).not.toContain("不得送到摘要");
    expect(snapshot.staleAfter).toBe("2026-09-01T02:01:00.000Z");
  });

  it("builds synthetic demo rows without real identifiers", () => {
    const snapshot = buildDemoDailySnapshot("2026-09-01");
    expect(snapshot.demo).toBe(true);
    expect(snapshot.clients).toHaveLength(6);
    expect(snapshot.sourceCounts.activeClients).toBe(6);
    expect(JSON.stringify(snapshot)).not.toMatch(/[A-Z][12]\d{8}/u);
    const selected = filterDailyCareSnapshotByClient(
      snapshot,
      snapshot.clients[0]!.clientId,
    );
    expect(selected.clients).toHaveLength(1);
    expect(selected.sourceCounts.activeClients).toBe(1);
    expect(selected.sourceCounts.completedServiceEvents).toBe(
      selected.clients[0]!.completedServiceCount,
    );
  });
});
