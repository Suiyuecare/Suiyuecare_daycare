import { describe, expect, it } from "vitest";
import { parseRosterWriteOutcome, rosterReceiptMatches } from "./write-contract";
import type { RosterInput } from "./parser";

const id = "a1111111-1111-4111-8111-111111111111";
const input: RosterInput = { clientId: id, serviceDate: "2026-09-15", shift: "morning", staffUserId: null,
  expectedVersion: 2, state: "cancelled", sourceNote: "合成取消安排", tasks: [], approved: true, idempotency_key: id };
const receipt = { id, clientId: id, serviceDate: input.serviceDate, shift: input.shift, version: 3, replayed: false };
const success = { requestId: id, status: "ok", data: { receipt, persisted: true, demo: false }, errors: [] };
const error = (code: string) => ({ requestId: id, status: "error", data: null, errors: [{ code, message: "合成已拒絕" }] });
describe("bounded roster write contract", () => {
  it("checks a persisted exact receipt and distinguishes replay HTTP status", () => {
    expect(parseRosterWriteOutcome(success, 201, input)).toEqual({ kind: "success", replayed: false });
    expect(parseRosterWriteOutcome(success, 200, input)).toEqual({ kind: "unknown" });
    expect(parseRosterWriteOutcome({ ...success, data: { ...success.data, receipt: { ...receipt, replayed: true } } }, 200, input))
      .toEqual({ kind: "success", replayed: true });
  });
  it.each([{ clientId: "b1111111-1111-4111-8111-111111111111" }, { shift: "afternoon" }, { version: 2 },
    { serviceDate: "2026-09-16" }, { replayed: "true" }, { id: "bad" }, { unexpected: "sensitive" }])("rejects mismatched or malformed receipt %j", (change) => {
    expect(rosterReceiptMatches({ ...receipt, ...change }, input)).toBeNull();
  });
  it.each([[400, "ROSTER_REJECTED"], [401, "AUTH_REQUIRED"], [403, "ROSTER_FORBIDDEN"], [403, "AAL2_REQUIRED"], [409, "ROSTER_CONFLICT"], [413, "REQUEST_TOO_LARGE"]] as const)("recognizes a valid first definite %s %s", (status, code) => {
    expect(parseRosterWriteOutcome(error(code), status, input)).toMatchObject({ kind: "rejected", needsReload: status === 409, needsReauth: code === "AAL2_REQUIRED" });
  });
  it.each([[409, "ROSTER_RESULT_UNCERTAIN"], [409, "NEW_UNKNOWN_ERROR"], [503, "ROSTER_CONFLICT"], [500, "ROSTER_REJECTED"], [200, "AUTH_REQUIRED"]] as const)("does not infer rollback from %s %s", (status, code) => {
    expect(parseRosterWriteOutcome(error(code), status, input)).toEqual({ kind: "unknown" });
  });
  it("does not classify a malformed error or untrusted free text as a known rollback", () => {
    expect(parseRosterWriteOutcome({ status: "error", errors: [{ code: "ROSTER_CONFLICT", message: "bad" }] }, 409, input)).toEqual({ kind: "unknown" });
    expect(parseRosterWriteOutcome({ ...error("ROSTER_CONFLICT"), errors: [{ code: "ROSTER_CONFLICT", message: "stack\ntrace" }] }, 409, input)).toEqual({ kind: "unknown" });
  });
});
