import { describe, expect, it } from "vitest";

import { buildDemoActivitySnapshot, filterDemoActivitySnapshot } from "./demo";
import {
  correlateActivityResult, parseActivityActionSuccess, parseActivityMutation,
  parseActivityOperationResult,
} from "./parser";
import { projectActivityManagementSnapshot } from "./projection";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";

describe("activity management strict boundaries", () => {
  it("builds a linked synthetic snapshot without enabling writes", () => {
    const snapshot = buildDemoActivitySnapshot(organizationId, branchId);
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.metrics).toEqual({ upcoming: 1, scheduled: 1, inProgress: 1, completed: 1, cancelled: 1 });
    expect(snapshot.items.find((value) => value.status === "cancelled")?.cancellationReason).toBeTruthy();
    expect(snapshot.notificationDelivery).toBe("none_not_sent");
  });

  it("composes date/type/status/search filters without searching participant names", () => {
    const snapshot = buildDemoActivitySnapshot(organizationId, branchId);
    const filtered = filterDemoActivitySnapshot(snapshot, {
      dateFrom: null, dateTo: null, activityType: "健康促進", status: "scheduled",
      query: "伸展", quickClientId: null,
    });
    expect(filtered.items.map((value) => value.title)).toEqual(["晨間伸展活動"]);
    expect(filterDemoActivitySnapshot(snapshot, { dateFrom: null, dateTo: null,
      activityType: null, status: "all", query: "林阿姨", quickClientId: null }).items).toHaveLength(0);
  });

  it("sorts exact participant stable IDs and rejects duplicates or unknown fields", () => {
    const input = parseActivityMutation({
      action: "create", activityType: "健康促進", title: "團體活動",
      searchSummary: "機構活動摘要", location: "一樓",
      startsAt: "2026-09-03T09:00:00+08:00", endsAt: "2026-09-03T10:00:00+08:00",
      responsibleUserId: "44444444-4444-4444-8444-444444444444",
      participantClientIds: ["66666666-6666-4666-8666-666666666666", "55555555-5555-4555-8555-555555555555"],
      capacity: 10,
    }, key);
    expect(input.participantClientIds).toEqual([
      "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666",
    ]);
    expect(() => parseActivityMutation({ ...input, idempotencyKey: undefined,
      participantClientIds: [input.participantClientIds[0], input.participantClientIds[0]] }, key)).toThrow();
  });

  it("fails closed on malformed database rows and cross-request receipts", () => {
    expect(() => parseActivityOperationResult({ operation_id: key })).toThrow(/畫面不會視為成功/u);
    const request = parseActivityMutation({
      action: "start", activityId: "44444444-4444-4444-8444-444444444444",
      expectedScheduleVersionId: "55555555-5555-4555-8555-555555555555",
      expectedScheduleVersion: 2,
      expectedStatusEventId: "66666666-6666-4666-8666-666666666666",
      expectedStatusSequence: 3,
    }, key);
    expect(() => correlateActivityResult({
      operationId: "77777777-7777-4777-8777-777777777777", operationKind: "transition",
      activityId: request.activityId!, scheduleVersionId: request.expectedScheduleVersionId!,
      scheduleVersion: 2, previousScheduleVersionId: "88888888-8888-4888-8888-888888888888",
      statusEventId: "99999999-9999-4999-8999-999999999999", statusSequence: 4,
      previousStatusEventId: request.expectedStatusEventId, status: "completed",
      responsibleUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      participantClientIds: [], committedAt: "2026-09-01T00:00:00.000Z", replayed: false,
    }, request)).toThrow(/畫面不會視為成功/u);
  });

  it("rejects unknown or malicious success envelopes and invalid projections", () => {
    const input = parseActivityMutation({
      action: "complete", activityId: "44444444-4444-4444-8444-444444444444",
      expectedScheduleVersionId: "55555555-5555-4555-8555-555555555555", expectedScheduleVersion: 1,
      expectedStatusEventId: "66666666-6666-4666-8666-666666666666", expectedStatusSequence: 1,
    }, key);
    expect(() => parseActivityActionSuccess({ status: "ok", data: { persisted: true, injected: true } }, input)).toThrow("INVALID_ACTIVITY_SUCCESS");
    expect(() => projectActivityManagementSnapshot({ row: { organization_id: organizationId }, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false })).toThrow("INVALID_ACTIVITY_PROJECTION");
  });
});
