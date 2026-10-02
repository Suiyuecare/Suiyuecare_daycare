import { buildDemoCaseDirectory } from "@/lib/clients/demo-case-directory";

import { projectCaseCenterSnapshot } from "./projection";
import type { CaseCenterFilters, CaseCenterSnapshot } from "./types";

const currentUserId = "33333333-3333-4333-8333-333333333333";
const secondUserId = "99999999-9999-4999-8999-999999999999";

export function buildDemoCaseCenterSnapshot(
  filters: CaseCenterFilters,
): CaseCenterSnapshot {
  const clientRows = buildDemoCaseDirectory().map((client) => ({
    id: client.id,
    client_code: client.clientCode,
    display_name: client.displayName,
    status: client.status,
    admitted_on: client.admittedOn,
    ended_on: client.endedOn,
    updated_at: client.updatedAt,
  }));
  const assignmentRows = clientRows.flatMap((client, index) => {
    const rows = [];
    if (index % 2 === 0) {
      rows.push({
        client_id: client.id,
        assignee_user_id: currentUserId,
        assignment_kind: "daily_care",
        starts_at: "2026-01-01T00:00:00+08:00",
        ends_at: null,
      });
    }
    if (index % 3 === 0) {
      rows.push({
        client_id: client.id,
        assignee_user_id: secondUserId,
        assignment_kind: "case_management",
        starts_at: "2026-01-01T00:00:00+08:00",
        ends_at: null,
      });
    }
    return rows;
  });

  return projectCaseCenterSnapshot({
    generatedAt: `${filters.date}T10:24:00+08:00`,
    filters,
    clientRows,
    assignmentRows,
    currentUserId,
    currentUserDisplayName: "林督導",
    assignmentAccess: "full_for_visible_clients",
    profileNames: new Map([
      [currentUserId, "林督導"],
      [secondUserId, "王社工"],
    ]),
    profileLabels: "names",
    demo: true,
  });
}
