import { describe, expect, it } from "vitest";
import { dailyApplicability, projectDailyCareSnapshot, type ClientSourceRow, type AttendanceSourceRow } from "./projection";
import { parseCoreDailySnapshot } from "./snapshot-contract";

const id = "d7600000-0000-4000-8000-000000000001";
const access = { attendance: true, measurements: true, careDiaries: true, serviceEvents: true };
const client: ClientSourceRow = { id, client_code: "SYN-1", display_name: "合成個案", eligibility: "eligible", scheduleStatus: "scheduled", sourceAccess: access };
const attendance = (status: AttendanceSourceRow["status"]): AttendanceSourceRow => ({ id: "d7610000-0000-4000-8000-000000000001", client_id: id, status, checked_in_at: null, checked_out_at: null, source: "staff" });
const expected = { organizationId: "d7300000-0000-4000-8000-000000000001", branchId: "d7400000-0000-4000-8000-000000000001", serviceDate: "2026-09-15" };
const raw = () => ({ ...expected, generatedAt: "2026-09-15T02:00:00Z", clients: [client], attendance: [], measurements: [], careDiaries: [], serviceEvents: [] });
describe("daily service applicability", () => {
  it("planned service is applicable when attendance is still unrecorded", () => expect(dailyApplicability(client)).toMatchObject({ attendance: "expected", care: "expected", reason: "scheduled" }));
  it.each(["leave", "absent"] as const)("%s keeps attendance evidence and excludes care missing counts", status => expect(dailyApplicability(client, attendance(status))).toMatchObject({ attendance: "expected", care: "not_expected", reason: "leave_or_absent" }));
  it("a known unscheduled day is not missing care", () => expect(dailyApplicability({ ...client, scheduleStatus: "not_scheduled" })).toMatchObject({ attendance: "not_expected", care: "not_expected" }));
  it.each(["not_scheduled", "unknown"] as const)("actual arrival overrides %s schedule", scheduleStatus => expect(dailyApplicability({ ...client, scheduleStatus }, attendance("present"))).toMatchObject({ care: "expected", reason: "arrived" }));
  it("missing schedule without arrival remains unknown", () => expect(dailyApplicability({ ...client, scheduleStatus: "unknown" })).toMatchObject({ care: "unknown", attendance: "unknown" }));
  it("missing attendance permission never implies absence", () => expect(dailyApplicability({ ...client, sourceAccess: { ...access, attendance: false } })).toMatchObject({ care: "unknown", attendance: "unknown" }));
  it.each(["inactive", "not_admitted"] as const)("%s evidence is retained as history and never creates current work", eligibility => expect(dailyApplicability({ ...client, eligibility }, attendance("present"))).toMatchObject({ eligible: false, reason: "history_only", care: "not_expected" }));
  it("unrelated source rows cannot inflate summary totals", () => {
    const snapshot = projectDailyCareSnapshot({ serviceDate: expected.serviceDate, generatedAt: raw().generatedAt, clients: [client], attendance: [], measurements: [], careDiaries: [], serviceEvents: [{ client_id: "hidden", status: "completed", count: 100 }] });
    expect(snapshot.sourceCounts.completedServiceEvents).toBe(0);
  });
});
describe("single snapshot contract", () => {
  it("accepts authoritative scope and preserves known versus unknown", () => expect(parseCoreDailySnapshot(raw(), expected, { clients: true, ...access }).clients[0]?.applicability?.care).toBe("expected"));
  it.each(["organizationId", "branchId", "serviceDate"] as const)("rejects mismatched %s", field => expect(() => parseCoreDailySnapshot({ ...raw(), [field]: field === "serviceDate" ? "2026-09-16" : id }, expected, { clients: true, ...access })).toThrow());
  it("rejects unassigned source evidence", () => expect(() => parseCoreDailySnapshot({ ...raw(), attendance: [{ ...attendance("present"), client_id: "d7600000-0000-4000-8000-000000000002" }] }, expected, { clients: true, ...access })).toThrow());
  it("rejects duplicate source rows rather than taking the last one", () => expect(() => parseCoreDailySnapshot({ ...raw(), attendance: [attendance("present"), attendance("leave")] }, expected, { clients: true, ...access })).toThrow());
  it("rejects a source whose per-client permission is absent", () => expect(() => parseCoreDailySnapshot({ ...raw(), clients: [{ ...client, sourceAccess: { ...access, attendance: false } }], attendance: [attendance("present")] }, expected, { clients: true, ...access })).toThrow());
  it("intersects current server permissions with database permissions", () => {
    const snapshot = parseCoreDailySnapshot({ ...raw(), attendance: [attendance("present")] }, expected, { clients: true, ...access, attendance: false });
    expect(snapshot.clients[0]?.attendance).toBeNull(); expect(snapshot.clients[0]?.applicability?.care).toBe("unknown");
  });
});
