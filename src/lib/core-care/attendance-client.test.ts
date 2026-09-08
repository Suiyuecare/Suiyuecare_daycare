import { describe, expect, it } from "vitest";

import { AttendanceClientContractError, parseAttendanceSuccess } from "./attendance-client";

const expected = {
  clientId: "46000000-0000-4000-8000-000000000001",
  eventKind: "check_in" as const,
  occurredAt: "2026-09-01T00:30:00.000Z",
};
const operation = {
  id: "46000000-0000-4000-8000-000000000002",
  attendanceId: "46000000-0000-4000-8000-000000000003",
  clientId: expected.clientId,
  eventKind: expected.eventKind,
  occurredAt: expected.occurredAt,
  serviceDate: "2026-09-01",
  status: "present",
  checkedInAt: expected.occurredAt,
  checkedOutAt: null,
  source: "staff",
};
const wrap = (data: unknown) => ({
  requestId: "46000000-0000-4000-8000-000000000004",
  status: "ok",
  data,
  errors: [],
});

describe("attendance browser success contract", () => {
  it("accepts an exact new persisted receipt", () => {
    const parsed = parseAttendanceSuccess(wrap({ operation, replayed: false, persisted: true, demo: false }), 201, expected);
    expect(parsed.data.operation.clientId).toBe(expected.clientId);
  });

  it("requires replayed receipts to use 200", () => {
    const replay = wrap({ operation, replayed: true, persisted: true, demo: false });
    expect(() => parseAttendanceSuccess(replay, 201, expected)).toThrow(AttendanceClientContractError);
    expect(parseAttendanceSuccess(replay, 200, expected).data.replayed).toBe(true);
  });

  it("rejects an unrelated client, mismatched status and unknown fields", () => {
    const unrelated = { ...operation, clientId: "46000000-0000-4000-8000-000000000099" };
    expect(() => parseAttendanceSuccess(wrap({ operation: unrelated, replayed: false, persisted: true, demo: false }), 201, expected)).toThrow(AttendanceClientContractError);
    expect(() => parseAttendanceSuccess(wrap({ operation: { ...operation, status: "leave" }, replayed: false, persisted: true, demo: false }), 201, expected)).toThrow(AttendanceClientContractError);
    expect(() => parseAttendanceSuccess(wrap({ operation, replayed: false, persisted: true, demo: false, injected: true }), 201, expected)).toThrow(AttendanceClientContractError);
  });
});
