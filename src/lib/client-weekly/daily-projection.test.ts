import { describe, expect, it } from "vitest";
import { projectDailyExpectedClients } from "./daily-projection";
import { emptyDay } from "./schema";

const date = "2026-09-14";
const id = "b0000000-0000-4000-8000-000000000001";
const transport = { location: "synthetic confidential location", contact: "synthetic confidential contact", wheelchair: true, windowStart: "08:00", windowEnd: "09:00" };
const day = { date, status: "scheduled", day: { ...emptyDay(1), attending: true, startsAt: "09:00", endsAt: "16:00", outbound: transport }, planVersion: 1, exceptionVersion: 0, transportStatus: "unassigned_demand" };
const payload = { serviceDate: date, generatedAt: `${date}T00:00:00Z`, evidenceKind: "planned_not_attended", transportStatus: "unassigned_demand", rows: [{ clientId: id, day }] };

describe("minimal daily expected projection", () => {
  it("counts only scheduled attendance, not cancelled, pending admission or inactive", () => {
    const input = { ...payload, rows: [...payload.rows, ...["cancelled", "not_admitted", "inactive", "plan_expired", "not_scheduled"].map((status, index) => ({ clientId: `b0000000-0000-4000-8000-00000000000${index + 2}`, day: { ...day, status } }))] };
    const result = projectDailyExpectedClients(input, date, new Map([[id, "合成甲"]]));
    expect(result.expectedCount).toBe(1); expect(result.transportClientCount).toBe(1);
    expect(result.outboundCount).toBe(1); expect(result.inboundCount).toBe(0);
    expect(result.clients[0]?.displayName).toBe("合成甲");
  });
  it("never serializes raw transport contact, address, diagnosis or medication", () => {
    const input = { ...payload, rows: [{ ...payload.rows[0], diagnosis: "synthetic private diagnosis" }] };
    const result = JSON.stringify(projectDailyExpectedClients(input, date, new Map()));
    expect(result).not.toContain("confidential"); expect(result).not.toContain("diagnosis"); expect(result).not.toContain("wheelchair");
    expect(result).toContain("編號末 0001");
  });
  it("rejects duplicate clients instead of inflating counts", () => {
    expect(() => projectDailyExpectedClients({ ...payload, rows: [...payload.rows, ...payload.rows] }, date, new Map())).toThrow("WEEKLY_PROJECTION_INVALID");
  });
  it("rejects mismatched dates, missing rows and malformed planned days", () => {
    for (const input of [{ ...payload, serviceDate: "2026-09-15" }, { ...payload, rows: undefined }, { ...payload, rows: [{ clientId: id, day: { ...day, date: "2026-09-15" } }] }, { ...payload, rows: [{ clientId: id, day: { ...day, day: null } }] }]) {
      expect(() => projectDailyExpectedClients(input, date, new Map())).toThrow("WEEKLY_PROJECTION_INVALID");
    }
  });
  it("only labels a validated successful empty response as zero", () => {
    expect(projectDailyExpectedClients({ ...payload, rows: [] }, date, new Map())).toMatchObject({ expectedCount: 0, clients: [] });
    expect(() => projectDailyExpectedClients(null, date, new Map())).toThrow();
  });
  it("does not accept an actual-attendance snapshot as expected demand", () => {
    expect(() => projectDailyExpectedClients({ ...payload, evidenceKind: "attended" }, date, new Map())).toThrow();
  });
});
