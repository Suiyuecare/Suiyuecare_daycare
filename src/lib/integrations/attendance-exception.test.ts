import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import {
  exceptionDatabaseFailure,
  parseExceptionDecision,
  parseExceptionQuery,
  parseExceptionReceipt,
  parseExceptionRequest,
} from "./attendance-exception";

const clientId = "51000000-0000-4000-8000-000000000001";
const requestId = "51000000-0000-4000-8000-000000000002";
const attendanceId = "51000000-0000-4000-8000-000000000003";
const key = "51000000-0000-4000-8000-000000000004";
const receipt = { id: requestId, client_id: clientId, service_date: "2026-10-11", status: "pending", replayed: false };

describe("attendance exception API boundary", () => {
  it("accepts only one permitted reason, a stable operation key and bounded note", () => {
    expect(parseExceptionRequest({ client_id: clientId, service_date: "2026-10-11", reason_code: "refused", reason_note: "  不願測量  " }, key))
      .toEqual({ client_id: clientId, service_date: "2026-10-11", reason_code: "refused", reason_note: "不願測量", idempotencyKey: key });
    expect(() => parseExceptionRequest({ client_id: clientId, service_date: "2026-10-11", reason_code: "custom" }, key)).toThrow(IntegrationError);
    expect(() => parseExceptionRequest({ client_id: clientId, service_date: "2026-10-11", reason_code: "refused", extra: "untrusted" }, key))
      .toThrow(IntegrationError);
    expect(() => parseExceptionRequest({ client_id: clientId, reason_code: "refused" }, key)).toThrow(IntegrationError);
    expect(() => parseExceptionRequest({ client_id: clientId, service_date: "2026-02-30", reason_code: "refused" }, key)).toThrow(IntegrationError);
    expect(() => parseExceptionRequest({ client_id: clientId, service_date: "2026-10-11", reason_code: "refused" }, null)).toThrow();
  });

  it("requires a rejection reason and rejects malformed date or case filter", () => {
    expect(parseExceptionDecision({ request_id: requestId, decision: "reject", decision_note: "  查核未通過 " }, key))
      .toEqual({ request_id: requestId, decision: "reject", decision_note: "查核未通過", confirmed_arrival_at: null, idempotencyKey: key });
    expect(() => parseExceptionDecision({ request_id: requestId, decision: "reject" }, key)).toThrow(IntegrationError);
    expect(parseExceptionDecision({ request_id: requestId, decision: "approve", decision_note: "門口登記已核對", confirmed_arrival_at: "2026-10-11T08:31:00+08:00" }, key))
      .toMatchObject({ decision: "approve", decision_note: "門口登記已核對", confirmed_arrival_at: "2026-10-11T08:31:00+08:00" });
    expect(() => parseExceptionDecision({ request_id: requestId, decision: "reject", decision_note: "不符", confirmed_arrival_at: "2026-10-11T08:31:00+08:00" }, key))
      .toThrow(IntegrationError);
    expect(() => parseExceptionDecision({ request_id: requestId, decision: "approve", confirmed_arrival_at: "not-a-time" }, key))
      .toThrow(IntegrationError);
    expect(parseExceptionQuery(`https://example.test/api?date=2026-10-11&client=${clientId}`))
      .toEqual({ serviceDate: "2026-10-11", clientId });
    expect(() => parseExceptionQuery("https://example.test/api?date=2026-02-30")).toThrow(IntegrationError);
    expect(() => parseExceptionQuery("https://example.test/api?date=2026-10-11&client=not-a-uuid")).toThrow();
  });

  it("does not report persistence unless the server receipt matches the exact case or request", () => {
    expect(parseExceptionReceipt(receipt, { clientId })).toMatchObject(receipt);
    expect(() => parseExceptionReceipt(receipt, { clientId: attendanceId })).toThrow(IntegrationError);
    expect(() => parseExceptionReceipt(receipt, { requestId: attendanceId })).toThrow(IntegrationError);
    expect(() => parseExceptionReceipt({ ...receipt, status: "approved" }, { requestId })).toThrow(IntegrationError);
    expect(parseExceptionReceipt({ ...receipt, status: "approved", attendance_id: attendanceId }, { requestId }))
      .toMatchObject({ status: "approved", attendance_id: attendanceId });
    expect(() => parseExceptionReceipt({ ...receipt, attendance_id: attendanceId })).toThrow(IntegrationError);
  });

  it("maps authorization and conflicts without exposing SQL messages", () => {
    expect(exceptionDatabaseFailure("DAA03").httpStatus).toBe(409);
    expect(exceptionDatabaseFailure("DAA02").httpStatus).toBe(403);
    expect(exceptionDatabaseFailure("42501").httpStatus).toBe(403);
    expect(exceptionDatabaseFailure("23514").httpStatus).toBe(409);
    expect(exceptionDatabaseFailure("23505").httpStatus).toBe(409);
    expect(exceptionDatabaseFailure("XX000").httpStatus).toBe(503);
  });
});
