// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { clearTodayWorkViewOnLogout, initialTodayWorkView, markTodayWorkReturn,
  observeTodayWorkAuthority, readTodayWorkView, saveTodayWorkView, takeTodayWorkReturn,
  todayWorkAuthoritySignature, todayWorkViewScope } from "./today-work-memory";

afterEach(() => { clearTodayWorkViewOnLogout(); vi.restoreAllMocks(); });

const context = { organizationId: "org-a", branchId: "branch-a", userId: "actor-a", demo: false,
  roles: ["care_worker" as const], scopes: ["clients.read"], assuranceLevel: "aal1" as const, recentAal2At: null };
const access = buildDemoDailySnapshot("2026-09-10").sourceAccess;

describe("same-tab today-work memory", () => {
  it("keeps only one authorized actor/branch/date/permission scope and never writes names to storage", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const authority = todayWorkAuthoritySignature(context);
    const scope = todayWorkViewScope(authority, "2026-09-10", access);
    observeTodayWorkAuthority(authority);
    saveTodayWorkView(scope, { ...initialTodayWorkView, filter: "measurements", search: "合成姓名", page: 2 });
    expect(readTodayWorkView(scope)).toMatchObject({ filter: "measurements", search: "合成姓名", page: 2 });
    expect(storageWrite).not.toHaveBeenCalled();

    const nextDate = todayWorkViewScope(authority, "2026-09-11", access);
    expect(readTodayWorkView(nextDate)).toBeNull();
    expect(readTodayWorkView(scope)).toBeNull();
    saveTodayWorkView(nextDate, { ...initialTodayWorkView, search: "合成姓名" });
    observeTodayWorkAuthority(todayWorkAuthoritySignature({ ...context, branchId: "branch-b" }));
    observeTodayWorkAuthority(authority);
    expect(readTodayWorkView(nextDate)).toBeNull();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("clears when effective source access changes, consumes focus once, and clears synchronously on logout", () => {
    const authority = todayWorkAuthoritySignature(context);
    const scope = todayWorkViewScope(authority, "2026-09-10", access);
    const view = { ...initialTodayWorkView, search: "合成姓名" };
    observeTodayWorkAuthority(authority);
    markTodayWorkReturn(scope, view, "synthetic-client-id", 81);
    expect(takeTodayWorkReturn(scope)).toEqual({ clientId: "synthetic-client-id", scrollTop: 81 });
    expect(takeTodayWorkReturn(scope)).toBeNull();
    expect(readTodayWorkView(todayWorkViewScope(authority, "2026-09-10", { ...access, clients: false }))).toBeNull();
    expect(readTodayWorkView(scope)).toBeNull();
    saveTodayWorkView(scope, view);
    clearTodayWorkViewOnLogout();
    expect(readTodayWorkView(scope)).toBeNull();
  });

  it.each([
    ["organization", { ...context, organizationId: "org-b" }],
    ["branch", { ...context, branchId: "branch-b" }],
    ["actor", { ...context, userId: "actor-b" }],
    ["role", { ...context, roles: ["nurse" as const] }],
    ["permission", { ...context, scopes: ["clients.read", "health.read"] }],
  ])("does not revive a previous search after %s changes away and back", (_label, changed) => {
    const first = todayWorkAuthoritySignature(context);
    const scope = todayWorkViewScope(first, "2026-09-10", access);
    observeTodayWorkAuthority(first);
    saveTodayWorkView(scope, { ...initialTodayWorkView, search: "合成姓名" });
    observeTodayWorkAuthority(todayWorkAuthoritySignature(changed));
    observeTodayWorkAuthority(first);
    expect(readTodayWorkView(scope)).toBeNull();
  });
});
