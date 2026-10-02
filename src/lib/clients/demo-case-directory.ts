import { buildDemoClientRegistry } from "./demo";
import type { ClientLifecycleStatus } from "./types";

export type DemoCaseClient = {
  id: string;
  clientCode: string;
  displayName: string;
  status: ClientLifecycleStatus;
  admittedOn: string | null;
  endedOn: string | null;
  updatedAt: string;
};

/** One synthetic directory for the case-center and assessment demonstration.
 * It is never used to fill a failed live read or authorize a real client. */
export function buildDemoCaseDirectory(): readonly DemoCaseClient[] {
  const registry = buildDemoClientRegistry();
  const extended: DemoCaseClient[] = Array.from({ length: 24 }, (_, index) => {
    const number = index + 9;
    const hex = number.toString(16).padStart(8, "0");
    const status: ClientLifecycleStatus = number % 13 === 0 ? "closed" : number % 9 === 0 ? "suspended" : "active";
    return {
      id: `${hex}-aaaa-4aaa-8aaa-${number.toString(16).padStart(12, "0")}`,
      clientCode: `DEMO-${String(number).padStart(3, "0")}`,
      displayName: `展示個案 ${String(number).padStart(2, "0")}`,
      status,
      admittedOn: number % 11 === 0 ? "2026-12-01" : `2026-${String((number % 7) + 1).padStart(2, "0")}-01`,
      endedOn: status === "closed" ? "2026-08-15" : null,
      updatedAt: "2026-09-01T09:30:00+08:00",
    };
  });
  return [...registry.clients.map(({ id, clientCode, displayName, status, admittedOn, endedOn, updatedAt }) => ({
    id, clientCode, displayName, status, admittedOn, endedOn, updatedAt,
  })), ...extended];
}
