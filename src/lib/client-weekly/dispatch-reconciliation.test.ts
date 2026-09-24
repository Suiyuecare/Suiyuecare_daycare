import { describe, expect, it } from "vitest";
import { projectDailyTransportReconciliation } from "./dispatch-reconciliation";

const id = (n: number) => `d0600000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const scope = { organizationId: id(100), branchId: id(101), serviceDate: "2026-09-15" };
const client = (n: number, outbound = true, inbound = false) => ({ clientId: id(n), startsAt: "09:00", endsAt: "16:00", outbound, inbound });
const row = (n: number, direction = "pickup", tripVersionIds: string[] = [], status = tripVersionIds.length === 0 ? "pending" : tripVersionIds.length === 1 ? "assigned" : "conflict") => ({ clientId: id(n), direction, tripVersionIds, status });
const payload = { ...scope, generatedAt: "2026-09-15T01:00:00Z", evidenceKind: "planned_not_attended",
  clients: [client(1, true, true), client(2), client(3), client(4)],
  dispatch: { status: "ready", rows: [row(1), row(1, "dropoff", [id(20)]), row(2, "pickup", [id(21), id(22)]), row(3, "pickup", [], "restricted"), row(4)] } };
const project = (source: unknown = payload) => projectDailyTransportReconciliation(source, scope, new Map([[id(1), "合成甲"]]));

describe("one-snapshot planned transport reconciliation", () => {
  it("counts directions, clients and each state from exactly the returned rows", () => {
    const state = project();
    expect(state).toMatchObject({ expectedCount: 4, transportClientCount: 4, outboundCount: 4, inboundCount: 1,
      dispatch: { pendingCount: 2, assignedCount: 1, conflictCount: 1, restrictedCount: 1 } });
    expect(state.dispatch.status === "ready" && state.dispatch.rows).toHaveLength(5);
    expect(state.clients[0].displayName).toBe("合成甲");
    expect(state.clients[1].displayName).toBe("個案（編號末 0002）");
  });
  it("accepts zero only from an explicit complete successful snapshot", () => {
    expect(project({ ...payload, clients: [], dispatch: { status: "ready", rows: [] } })).toMatchObject({ expectedCount: 0, dispatch: { pendingCount: 0, assignedCount: 0 } });
    for (const invalid of [null, {}, { ...payload, dispatch: undefined }]) expect(() => project(invalid)).toThrow("DAILY_TRANSPORT_SNAPSHOT_INVALID");
  });
  it("no transport permission means no inferred zero or hidden row identifiers", () => {
    expect(project({ ...payload, dispatch: { status: "forbidden" } }).dispatch).toEqual({ status: "forbidden" });
    expect(() => project({ ...payload, dispatch: { status: "forbidden", rows: [], assignedCount: 0 } })).toThrow();
  });
  it.each(["organizationId", "branchId", "serviceDate"])("rejects a foreign %s snapshot", (key) => {
    expect(() => project({ ...payload, [key]: key === "serviceDate" ? "2026-09-16" : id(999) })).toThrow();
  });
  it("requires one and only one dispatch row for every expected client direction", () => {
    for (const rows of [payload.dispatch.rows.slice(1), [...payload.dispatch.rows, row(1)], [...payload.dispatch.rows, row(9)], payload.dispatch.rows.map((item, i) => i === 0 ? row(1, "dropoff") : item)]) {
      expect(() => project({ ...payload, dispatch: { status: "ready", rows } })).toThrow();
    }
  });
  it.each([
    row(1, "pickup", [], "assigned"), row(1, "pickup", [id(20)], "pending"),
    row(1, "pickup", [id(20)], "conflict"), row(1, "pickup", [id(20)], "restricted"),
    row(1, "pickup", [id(20), id(20)], "conflict"), row(1, "pickup", [id(20), id(21)], "assigned"),
  ])("rejects inconsistent assignment cardinality %#", (replacement) => {
    expect(() => project({ ...payload, dispatch: { status: "ready", rows: [replacement, ...payload.dispatch.rows.slice(1)] } })).toThrow();
  });
  it("cannot pair a single trip with both directions", () => {
    expect(() => project({ ...payload, dispatch: { status: "ready", rows: [row(1, "pickup", [id(20)]), ...payload.dispatch.rows.slice(1)] } })).toThrow();
  });
  it("counts a shared trip once per exact client-direction demand, not once per vehicle", () => {
    const state = project({ ...payload, clients: [client(1), client(2)], dispatch: { status: "ready", rows: [row(1, "pickup", [id(20)]), row(2, "pickup", [id(20)])] } });
    expect(state.dispatch).toMatchObject({ assignedCount: 2, conflictCount: 0 });
  });
  it("rejects duplicate clients, invalid times and unexpected sensitive fields", () => {
    for (const clients of [[client(1), client(1)], [{ ...client(1), endsAt: "08:00" }], [{ ...client(1), contact: "private" }]]) {
      expect(() => project({ ...payload, clients })).toThrow();
    }
    expect(() => project({ ...payload, evidenceKind: "attended" })).toThrow();
  });
  it("rejects truncated or over-limit data instead of reporting a partial workload", () => {
    expect(() => project({ ...payload, truncated: true })).toThrow();
    expect(() => project({ ...payload, clients: Array.from({ length: 501 }, (_, n) => client(n)), dispatch: { status: "forbidden" } })).toThrow();
  });
});
