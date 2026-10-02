import "server-only";

import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { withServerReadDeadline } from "@/lib/api/server-read-deadline";

import { buildDemoCaseCenterSnapshot } from "./demo";
import {
  projectCaseCenterSnapshot,
  type CaseCenterAssignmentRow,
} from "./projection";
import type {
  CaseCenterAssignmentAccess,
  CaseCenterFilters,
  CaseCenterSnapshot,
} from "./types";

const DATABASE_PAGE_SIZE = 1_000;
const MAX_VISIBLE_ASSIGNMENTS = 20_000;

type ProfileRow = { id: string; display_name: string };

export class CaseCenterRegistryError extends Error {
  constructor() {
    super("CASE_CENTER_REGISTRY_UNAVAILABLE");
    this.name = "CaseCenterRegistryError";
  }
}

async function loadAllAssignmentRows(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  context: TenantContext,
  generatedAt: string,
  assignmentAccess: CaseCenterAssignmentAccess,
  signal: AbortSignal,
) {
  const assignmentQuery = (withCount: boolean, from: number, to: number) => {
    if (signal.aborted) throw new CaseCenterRegistryError();
    let query = supabase
      .from("client_assignments")
      .select(
        "client_id, assignee_user_id, assignment_kind, starts_at, ends_at",
        withCount ? { count: "exact" } : undefined,
      )
      .eq("organization_id", context.organizationId)
      .eq("branch_id", context.branchId)
      .lte("starts_at", generatedAt);
    if (assignmentAccess === "self_only") {
      query = query.eq("assignee_user_id", context.userId);
    }
    return query.order("client_id").range(from, to).abortSignal(signal).returns<
      CaseCenterAssignmentRow[]
    >();
  };

  const first = await assignmentQuery(true, 0, DATABASE_PAGE_SIZE - 1);
  if (signal.aborted || first.error) throw new CaseCenterRegistryError();
  const count = first.count ?? first.data?.length ?? 0;
  if (count > MAX_VISIBLE_ASSIGNMENTS) throw new CaseCenterRegistryError();
  const remaining = await Promise.all(
    Array.from(
      { length: Math.max(0, Math.ceil(count / DATABASE_PAGE_SIZE) - 1) },
      (_, index) => {
        const offset = (index + 1) * DATABASE_PAGE_SIZE;
        return assignmentQuery(
          false,
          offset,
          offset + DATABASE_PAGE_SIZE - 1,
        );
      },
    ),
  );
  if (signal.aborted || remaining.some((result) => result.error)) {
    throw new CaseCenterRegistryError();
  }
  return [
    ...(first.data ?? []),
    ...remaining.flatMap((result) => result.data ?? []),
  ].filter(
    (assignment) =>
      !assignment.ends_at || assignment.ends_at > generatedAt,
  );
}

async function loadProfileNames(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userIds: readonly string[],
  signal: AbortSignal,
) {
  const names = new Map<string, string>();
  const chunks = Array.from(
    { length: Math.ceil(userIds.length / 100) },
    (_, index) => userIds.slice(index * 100, index * 100 + 100),
  );
  if (signal.aborted) throw new CaseCenterRegistryError();
  const results = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [...ids])
        .abortSignal(signal)
        .returns<ProfileRow[]>(),
    ),
  );
  if (signal.aborted) throw new CaseCenterRegistryError();
  if (results.some((result) => result.error)) return null;
  for (const profile of results.flatMap((result) => result.data ?? [])) {
    names.set(profile.id, profile.display_name);
  }
  return names;
}

export async function loadCaseCenterSnapshot(
  context: TenantContext,
  filters: CaseCenterFilters,
): Promise<CaseCenterSnapshot> {
  if (context.demo) return buildDemoCaseCenterSnapshot(filters);
  if (!context.scopes.includes("clients.read")) {
    throw new CaseCenterRegistryError();
  }
  try {
    return await withServerReadDeadline((signal) => loadCaseCenterSource(context, filters, signal));
  } catch { throw new CaseCenterRegistryError(); }
}

async function loadCaseCenterSource(context: TenantContext, filters: CaseCenterFilters, signal: AbortSignal): Promise<CaseCenterSnapshot> {
  const supabase = await createServerSupabaseClient();
  if (signal.aborted || !supabase) throw new CaseCenterRegistryError();
  const generatedAt = new Date().toISOString();
  const assignmentAccess: CaseCenterAssignmentAccess = context.scopes.includes(
    "clients.assign",
  )
    ? "full_for_visible_clients"
    : "self_only";
  const [clientRows, loadedAssignmentRows] = await Promise.all([
    loadAllClientDirectoryRows(supabase, context, "case_center", undefined, signal).catch(() => {
      throw new CaseCenterRegistryError();
    }),
    loadAllAssignmentRows(
      supabase,
      context,
      generatedAt,
      assignmentAccess,
      signal,
    ),
  ]);
  if (signal.aborted) throw new CaseCenterRegistryError();
  const visibleClientIds = new Set(clientRows.map((client) => client.id));
  const assignmentRows = loadedAssignmentRows.filter((assignment) =>
    visibleClientIds.has(assignment.client_id),
  );

  const assigneeIds = [
    ...new Set(assignmentRows.map((assignment) => assignment.assignee_user_id)),
  ];
  let profileNames = new Map<string, string>();
  let profileLabels: "names" | "codes" = "codes";
  if (context.scopes.includes("profiles.manage") && assigneeIds.length) {
    const result = await loadProfileNames(supabase, assigneeIds, signal);
    if (result) {
      profileNames = result;
      profileLabels = "names";
    }
  }

  return projectCaseCenterSnapshot({
    generatedAt,
    filters,
    clientRows,
    assignmentRows,
    currentUserId: context.userId,
    currentUserDisplayName: context.displayName,
    assignmentAccess,
    profileNames,
    profileLabels,
    demo: false,
  });
}
