import type { CareRosterSnapshot, RosterShift } from "@/lib/care-roster/types";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import type { WorkFilter } from "@/lib/core-care/today-work";
import type { TenantContext } from "@/lib/domain/types";

export interface TodayWorkView {
  filter: WorkFilter;
  search: string;
  page: number;
  shift: RosterShift | "all";
  unassigned: boolean;
  mobileFiltersOpen: boolean;
}

export const initialTodayWorkView: TodayWorkView = {
  filter: "pending", search: "", page: 1, shift: "all", unassigned: false, mobileFiltersOpen: false,
};

type ReturnPosition = { clientId: string; scrollTop: number };
type SavedView = { scope: string; view: TodayWorkView; returnPosition: ReturnPosition | null };

// One entry in this JavaScript realm only. Never use URL, history state,
// sessionStorage or localStorage for a search term that may contain a name.
let authority: string | null = null;
let saved: SavedView | null = null;

export function todayWorkAuthoritySignature(context: Pick<TenantContext,
  "organizationId" | "branchId" | "userId" | "demo" | "roles" | "scopes" | "assuranceLevel" | "recentAal2At">): string {
  return JSON.stringify([context.organizationId, context.branchId, context.userId, context.demo,
    [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel, context.recentAal2At]);
}

export function todayWorkViewScope(signature: string, serviceDate: string,
  access: DailyCareSnapshot["sourceAccess"], roster?: CareRosterSnapshot): string {
  return JSON.stringify([signature, serviceDate, access, roster?.status ?? null, roster?.manager ?? null]);
}

/** Called by the persistent shell, including while the dashboard is not mounted. */
export function observeTodayWorkAuthority(next: string): void {
  if (authority !== null && authority !== next) saved = null;
  authority = next;
}

export function observeTodayWorkViewScope(scope: string | undefined): void {
  if (saved && saved.scope !== scope) saved = null;
}

export function readTodayWorkView(scope: string | undefined): TodayWorkView | null {
  if (!scope) return null;
  if (saved && saved.scope !== scope) saved = null;
  return saved ? { ...saved.view } : null;
}

export function saveTodayWorkView(scope: string | undefined, view: TodayWorkView): void {
  if (!scope) return;
  // A new local interaction supersedes any earlier attempted navigation.
  saved = { scope, view: { ...view }, returnPosition: null };
}

export function markTodayWorkReturn(scope: string | undefined, view: TodayWorkView,
  clientId: string, scrollTop: number): void {
  if (!scope) return;
  saved = { scope, view: { ...view }, returnPosition: {
    clientId, scrollTop: Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0,
  } };
}

export function takeTodayWorkReturn(scope: string | undefined): ReturnPosition | null {
  if (!scope || saved?.scope !== scope) return null;
  const position = saved.returnPosition;
  saved.returnPosition = null;
  return position;
}

export function clearTodayWorkViewOnLogout(): void {
  saved = null;
  authority = null;
}
