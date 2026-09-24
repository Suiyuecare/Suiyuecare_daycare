import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadAllClientDirectoryRows } from "./directory";

import { buildDemoClientLifecycle } from "./demo";
import {
  filterClientLifecycleTransitions,
  projectClientLifecycleSnapshot,
  type ClientLifecycleClientRow,
  type ClientTransitionRow,
} from "./lifecycle";
import { clientServiceState, taipeiDate } from "./lifecycle-rules";
import type {
  ClientLifecycleSnapshot,
  ClientLifecycleStatusFilter,
  ClientTransitionKind,
} from "./types";

const HISTORY_PAGE_SIZE = 50;

export type ClientLifecycleReadOptions = {
  clientId?: string | null;
  query: string;
  status: ClientLifecycleStatusFilter;
  eventKind: "all" | ClientTransitionKind;
  effectiveOn: string | null;
  page: number;
};

type ProfileRow = { id: string; display_name: string };

export class ClientLifecycleSnapshotError extends Error {
  constructor() {
    super("CLIENT_LIFECYCLE_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientLifecycleSnapshotError";
  }
}

function nextMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month!, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function matchingClientIds(
  clients: readonly ClientLifecycleClientRow[],
  options: ClientLifecycleReadOptions,
) {
  const normalized = options.query.trim().toLocaleLowerCase("zh-TW");
  return clients
    .filter((client) => {
      const matchesQuery =
        !normalized ||
        `${client.display_name} ${client.client_code}`
          .toLocaleLowerCase("zh-TW")
          .includes(normalized);
      return (
        (!options.clientId || client.id === options.clientId) &&
        matchesQuery &&
        (options.status === "all" ||
          clientServiceState({
            status: client.status,
            admittedOn: client.admitted_on,
          }) === options.status)
      );
    })
    .map((client) => client.id);
}

export async function loadClientLifecycleSnapshot(
  context: TenantContext,
  options: ClientLifecycleReadOptions,
): Promise<ClientLifecycleSnapshot> {
  if (context.demo) {
    const snapshot = buildDemoClientLifecycle();
    const filtered = filterClientLifecycleTransitions(snapshot, options);
    const offset = (options.page - 1) * HISTORY_PAGE_SIZE;
    return {
      ...snapshot,
      transitions: filtered.slice(offset, offset + HISTORY_PAGE_SIZE),
      historyPage: options.page,
      historyPageSize: HISTORY_PAGE_SIZE,
      historyTotal: filtered.length,
    };
  }
  if (!context.scopes.includes("clients.read")) {
    throw new ClientLifecycleSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ClientLifecycleSnapshotError();

  const generatedAt = new Date().toISOString();
  const monthStart = `${taipeiDate(new Date(generatedAt)).slice(0, 7)}-01`;
  const monthEnd = nextMonth(monthStart);
  const [clientRows, admissionsResult, endedResult, handoffResult] =
    await Promise.all([
      loadAllClientDirectoryRows(
        supabase,
        context,
        "client_lifecycle",
      ).catch(() => {
        throw new ClientLifecycleSnapshotError();
      }),
      supabase
        .from("client_transitions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .eq("event_kind", "admit")
        .gte("effective_on", monthStart)
        .lt("effective_on", monthEnd),
      supabase
        .from("client_transitions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .in("event_kind", ["transfer", "close", "death"])
        .gte("effective_on", monthStart)
        .lt("effective_on", monthEnd),
      supabase
        .from("client_transitions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .in("event_kind", ["transfer", "close", "death"])
        .is("handoff_note", null),
    ]);
  if (
    admissionsResult.error ||
    endedResult.error ||
    handoffResult.error
  ) {
    throw new ClientLifecycleSnapshotError();
  }

  const clientIds = matchingClientIds(clientRows, options);
  let transitionRows: ClientTransitionRow[] = [];
  let historyTotal = 0;

  const requiresClientFilter =
    Boolean(options.clientId) || Boolean(options.query.trim()) || options.status !== "all";
  if (clientIds.length || !requiresClientFilter) {
    const offset = (options.page - 1) * HISTORY_PAGE_SIZE;
    const fetchHistory = async (
      ids: readonly string[] | null,
      from: number,
      to: number,
    ) => {
      let query = supabase
        .from("client_transitions")
        .select(
          "id, client_id, event_kind, effective_on, reason, handoff_note, from_status, to_status, base_row_version, resulting_row_version, actor_user_id, created_at",
          { count: "exact" },
        )
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId);
      if (ids) query = query.in("client_id", [...ids]);
      if (options.eventKind !== "all") {
        query = query.eq("event_kind", options.eventKind);
      }
      if (options.effectiveOn) {
        query = query.eq("effective_on", options.effectiveOn);
      }
      return query
        .order("effective_on", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to)
        .returns<ClientTransitionRow[]>();
    };

    if (requiresClientFilter) {
      // Keep PostgREST URLs bounded when a broad status filter matches many
      // clients. Fetch enough ordered candidates per chunk, merge, then take
      // the requested global page; count remains the exact sum of disjoint IDs.
      const chunks = Array.from(
        { length: Math.ceil(clientIds.length / 100) },
        (_, index) => clientIds.slice(index * 100, index * 100 + 100),
      );
      const results = await Promise.all(
        chunks.map((ids) =>
          fetchHistory(ids, 0, offset + HISTORY_PAGE_SIZE - 1),
        ),
      );
      if (results.some((result) => result.error)) {
        throw new ClientLifecycleSnapshotError();
      }
      historyTotal = results.reduce(
        (total, result) => total + (result.count ?? result.data?.length ?? 0),
        0,
      );
      transitionRows = results
        .flatMap((result) => result.data ?? [])
        .sort(
          (left, right) =>
            right.effective_on.localeCompare(left.effective_on) ||
            new Date(right.created_at).getTime() -
              new Date(left.created_at).getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(offset, offset + HISTORY_PAGE_SIZE);
    } else {
      const result = await fetchHistory(
        null,
        offset,
        offset + HISTORY_PAGE_SIZE - 1,
      );
      if (result.error) throw new ClientLifecycleSnapshotError();
      transitionRows = result.data ?? [];
      historyTotal = result.count ?? transitionRows.length;
    }
  }

  const visibleActorNames = new Map<string, string>();
  visibleActorNames.set(context.userId, context.displayName);
  if (context.scopes.includes("profiles.manage")) {
    const actorIds = [...new Set(
      transitionRows
        .map((transition) => transition.actor_user_id)
        .filter((id) => id !== context.userId),
    )];
    if (actorIds.length) {
      const profiles = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", actorIds)
        .returns<ProfileRow[]>();
      if (!profiles.error) {
        for (const profile of profiles.data ?? []) {
          visibleActorNames.set(profile.id, profile.display_name);
        }
      }
    }
  }

  return projectClientLifecycleSnapshot({
    clientRows,
    transitionRows,
    currentUserId: context.userId,
    currentUserDisplayName: context.displayName,
    visibleActorNames,
    generatedAt,
    metrics: {
      admittedThisMonth: admissionsResult.count ?? 0,
      pendingAdmission: clientRows.filter(
        (client) => client.status === "active" && client.admitted_on === null,
      ).length,
      suspended: clientRows.filter((client) => client.status === "suspended").length,
      endedThisMonth: endedResult.count ?? 0,
      pendingHandoff: handoffResult.count ?? 0,
    },
    historyPage: options.page,
    historyPageSize: HISTORY_PAGE_SIZE,
    historyTotal,
    demo: false,
  });
}
