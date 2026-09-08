import type { ClientLifecycleStatus } from "@/lib/clients/types";
import { clientServiceState } from "@/lib/clients/lifecycle-rules";

import { CASE_CENTER_PAGE_SIZE, clampCaseCenterPage } from "./query";
import type {
  CaseCenterAssignmentAccess,
  CaseCenterFilters,
  CaseCenterResponsiblePerson,
  CaseCenterServiceStatus,
  CaseCenterSnapshot,
} from "./types";

export type CaseCenterClientRow = {
  id: string;
  client_code: string;
  display_name: string;
  status: ClientLifecycleStatus;
  admitted_on: string | null;
  ended_on: string | null;
  updated_at: string;
};

export type CaseCenterAssignmentRow = {
  client_id: string;
  assignee_user_id: string;
  assignment_kind: string;
  starts_at: string;
  ends_at: string | null;
};

export function caseCenterServiceStatus(
  client: Pick<
    CaseCenterClientRow,
    "status" | "admitted_on" | "ended_on"
  >,
  serviceDate: string,
): CaseCenterServiceStatus {
  if (["transferred", "closed", "deceased"].includes(client.status)) {
    return "ended";
  }
  if (client.status === "suspended") return "paused";
  if (!client.admitted_on || client.admitted_on > serviceDate) return "pending";
  if (client.ended_on && client.ended_on <= serviceDate) return "ended";
  return "serving";
}

function newestStableClients(rows: readonly CaseCenterClientRow[]) {
  const byId = new Map<string, CaseCenterClientRow>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (
      !existing ||
      row.updated_at > existing.updated_at ||
      (row.updated_at === existing.updated_at &&
        `${row.client_code}\u0000${row.display_name}` <
          `${existing.client_code}\u0000${existing.display_name}`)
    ) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.client_code.localeCompare(right.client_code, "zh-TW") ||
      left.id.localeCompare(right.id),
  );
}

function activeAssignments(
  rows: readonly CaseCenterAssignmentRow[],
  generatedAt: string,
) {
  const assignmentTime = new Date(generatedAt).getTime();
  const seen = new Set<string>();
  return rows.filter((row) => {
    const active =
      new Date(row.starts_at).getTime() <= assignmentTime &&
      (!row.ends_at || new Date(row.ends_at).getTime() > assignmentTime);
    const key = `${row.client_id}:${row.assignee_user_id}`;
    if (!active || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function personLabel(input: {
  userId: string;
  currentUserId: string;
  currentUserDisplayName: string;
  profileNames: ReadonlyMap<string, string>;
}): CaseCenterResponsiblePerson {
  const currentUser = input.userId === input.currentUserId;
  const visibleName = currentUser
    ? input.currentUserDisplayName
    : input.profileNames.get(input.userId);
  return {
    userId: input.userId,
    currentUser,
    label: currentUser
      ? `我（${visibleName}）`
      : visibleName ?? `人員代碼 ${input.userId.slice(-6).toUpperCase()}`,
  };
}

export function projectCaseCenterSnapshot(input: {
  generatedAt: string;
  filters: CaseCenterFilters;
  clientRows: readonly CaseCenterClientRow[];
  assignmentRows: readonly CaseCenterAssignmentRow[];
  currentUserId: string;
  currentUserDisplayName: string;
  assignmentAccess: CaseCenterAssignmentAccess;
  profileNames?: ReadonlyMap<string, string>;
  profileLabels?: "names" | "codes";
  demo?: boolean;
}): CaseCenterSnapshot {
  const profileNames = input.profileNames ?? new Map<string, string>();
  const clients = newestStableClients(input.clientRows);
  const visibleClientIds = new Set(clients.map((client) => client.id));
  const assignments = activeAssignments(
    input.assignmentRows.filter((row) => visibleClientIds.has(row.client_id)),
    input.generatedAt,
  );
  const assignmentsByClient = new Map<string, CaseCenterAssignmentRow[]>();
  for (const assignment of assignments) {
    const rows = assignmentsByClient.get(assignment.client_id) ?? [];
    rows.push(assignment);
    assignmentsByClient.set(assignment.client_id, rows);
  }

  const requestedResponsibleId =
    input.filters.responsible === "me"
      ? input.currentUserId
      : input.filters.responsible === "all"
        ? null
        : input.filters.responsible;
  const responsibleFilterRestricted = Boolean(
    requestedResponsibleId &&
      requestedResponsibleId !== input.currentUserId &&
      input.assignmentAccess === "self_only",
  );
  const normalizedQuery = input.filters.query.toLocaleLowerCase("zh-TW");
  const rowsWithStatus = clients.map((client) => ({
    client,
    lifecycleState: clientServiceState({
      status: client.status,
      admittedOn: client.admitted_on,
    }),
    serviceStatus: caseCenterServiceStatus(client, input.filters.date),
  }));
  const filtered = responsibleFilterRestricted
    ? []
    : rowsWithStatus.filter(({ client, lifecycleState, serviceStatus }) => {
        const matchesQuery =
          !normalizedQuery ||
          `${client.display_name} ${client.client_code}`
            .toLocaleLowerCase("zh-TW")
            .includes(normalizedQuery);
        const matchesLifecycle =
          input.filters.lifecycle === "all" ||
          lifecycleState === input.filters.lifecycle;
        const matchesService =
          input.filters.service === "all" ||
          serviceStatus === input.filters.service;
        const matchesResponsible =
          !requestedResponsibleId ||
          (assignmentsByClient.get(client.id) ?? []).some(
            (assignment) =>
              assignment.assignee_user_id === requestedResponsibleId,
          );
        return (
          matchesQuery &&
          matchesLifecycle &&
          matchesService &&
          matchesResponsible
        );
      });

  const { page, pageCount, offset } = clampCaseCenterPage(
    input.filters.page,
    filtered.length,
  );
  const pageRows = filtered.slice(offset, offset + CASE_CENTER_PAGE_SIZE);
  const toPerson = (userId: string) =>
    personLabel({
      userId,
      currentUserId: input.currentUserId,
      currentUserDisplayName: input.currentUserDisplayName,
      profileNames,
    });
  const responsibleOptions = [
    input.currentUserId,
    ...(input.assignmentAccess === "full_for_visible_clients"
      ? assignments.map((assignment) => assignment.assignee_user_id)
      : []),
  ]
    .filter((userId, index, values) => values.indexOf(userId) === index)
    .map(toPerson)
    .sort(
      (left, right) =>
        Number(right.currentUser) - Number(left.currentUser) ||
        left.label.localeCompare(right.label, "zh-TW"),
    );

  return {
    generatedAt: input.generatedAt,
    serviceDate: input.filters.date,
    clients: pageRows.map(({ client, lifecycleState, serviceStatus }) => {
      const people = (assignmentsByClient.get(client.id) ?? [])
        .map((assignment) => toPerson(assignment.assignee_user_id))
        .sort((left, right) => left.label.localeCompare(right.label, "zh-TW"));
      return {
        id: client.id,
        clientCode: client.client_code,
        displayName: client.display_name,
        lifecycleStatus: client.status,
        lifecycleState,
        serviceStatus,
        admittedOn: client.admitted_on,
        endedOn: client.ended_on,
        updatedAt: client.updated_at,
        responsibility: {
          state:
            input.assignmentAccess === "self_only" && people.length === 0
              ? "restricted"
              : "known",
          people,
        },
      };
    }),
    total: filtered.length,
    visibleTotal: clients.length,
    page,
    pageSize: CASE_CENTER_PAGE_SIZE,
    pageCount,
    summary: {
      serving: rowsWithStatus.filter((row) => row.serviceStatus === "serving")
        .length,
      paused: rowsWithStatus.filter((row) => row.serviceStatus === "paused")
        .length,
      pending: rowsWithStatus.filter((row) => row.serviceStatus === "pending")
        .length,
      ended: rowsWithStatus.filter((row) => row.serviceStatus === "ended")
        .length,
    },
    responsibleOptions,
    access: {
      assignments: input.assignmentAccess,
      profileLabels: input.profileLabels ?? "codes",
      responsibleFilterRestricted,
    },
    demo: input.demo ?? false,
  };
}
