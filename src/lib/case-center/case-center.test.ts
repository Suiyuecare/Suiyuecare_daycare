import { describe, expect, it } from "vitest";

import {
  CASE_CENTER_PAGE_SIZE,
  caseCenterHref,
  parseCaseCenterFilters,
} from "./query";
import {
  projectCaseCenterSnapshot,
  type CaseCenterAssignmentRow,
  type CaseCenterClientRow,
} from "./projection";
import type { CaseCenterFilters } from "./types";

const currentUserId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";

function filters(overrides: Partial<CaseCenterFilters> = {}): CaseCenterFilters {
  return {
    date: "2026-09-01",
    query: "",
    lifecycle: "all",
    service: "all",
    responsible: "all",
    page: 1,
    ...overrides,
  };
}

function client(
  index: number,
  overrides: Partial<CaseCenterClientRow> = {},
): CaseCenterClientRow {
  return {
    id: `${index.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`,
    client_code: `CASE-${String(index).padStart(3, "0")}`,
    display_name: `展示個案 ${String(index).padStart(2, "0")}`,
    status: "active",
    admitted_on: "2026-01-01",
    ended_on: null,
    updated_at: "2026-09-01T01:00:00.000Z",
    ...overrides,
  };
}

function assignment(
  clientId: string,
  assigneeUserId = currentUserId,
): CaseCenterAssignmentRow {
  return {
    client_id: clientId,
    assignee_user_id: assigneeUserId,
    assignment_kind: "daily_care",
    starts_at: "2026-01-01T00:00:00.000Z",
    ends_at: null,
  };
}

function project(input: {
  filters?: CaseCenterFilters;
  clients: readonly CaseCenterClientRow[];
  assignments?: readonly CaseCenterAssignmentRow[];
  assignmentAccess?: "full_for_visible_clients" | "self_only";
}) {
  return projectCaseCenterSnapshot({
    generatedAt: "2026-09-01T04:00:00.000Z",
    filters: input.filters ?? filters(),
    clientRows: input.clients,
    assignmentRows: input.assignments ?? [],
    currentUserId,
    currentUserDisplayName: "目前人員",
    assignmentAccess: input.assignmentAccess ?? "full_for_visible_clients",
    profileNames: new Map([[otherUserId, "可見督導"]]),
    profileLabels: "names",
  });
}

describe("case-center query contract", () => {
  it("parses bounded URL filters and rejects arrays or malformed values", () => {
    expect(
      parseCaseCenterFilters(
        {
          date: "2026-09-01",
          q: "  陳   O華\u0000 ",
          lifecycle: "suspended",
          service: "paused",
          responsible: otherUserId.toUpperCase(),
          page: "7",
        },
        new Date("2026-09-01T04:00:00.000Z"),
      ),
    ).toEqual({
      date: "2026-09-01",
      query: "陳 O華",
      lifecycle: "suspended",
      service: "paused",
      responsible: otherUserId,
      page: 7,
    });

    expect(
      parseCaseCenterFilters(
        {
          q: ["不得", "採用"],
          lifecycle: "unknown",
          service: "zero",
          responsible: "../../../other",
          page: "-1",
        },
        new Date("2026-09-01T04:00:00.000Z"),
      ),
    ).toMatchObject({
      query: "",
      lifecycle: "all",
      service: "all",
      responsible: "all",
      page: 1,
    });
  });

  it("round-trips date, filters, responsible person, and page in one URL", () => {
    const value = filters({
      query: "HX 021",
      lifecycle: "active",
      service: "serving",
      responsible: otherUserId,
      page: 3,
    });
    const href = caseCenterHref(value);
    const parsed = parseCaseCenterFilters(
      Object.fromEntries(new URL(href, "https://example.invalid").searchParams),
      new Date("2026-09-01T04:00:00.000Z"),
    );
    expect(parsed).toEqual(value);
    expect(href).toContain("q=HX+021");
  });
});

describe("case-center projection", () => {
  it("deduplicates by stable client ID and keeps the newest authoritative row", () => {
    const first = client(1, { display_name: "舊名稱" });
    const snapshot = project({
      clients: [
        first,
        {
          ...first,
          display_name: "新名稱",
          updated_at: "2026-09-01T02:00:00.000Z",
        },
      ],
    });
    expect(snapshot.visibleTotal).toBe(1);
    expect(snapshot.clients).toHaveLength(1);
    expect(snapshot.clients[0]?.displayName).toBe("新名稱");
  });

  it("combines query, lifecycle, service-date, and responsible filters", () => {
    const serving = client(1, { display_name: "陳O華" });
    const paused = client(2, {
      display_name: "陳O英",
      status: "suspended",
    });
    const pending = client(3, { admitted_on: null });
    const ended = client(4, { status: "closed", ended_on: "2026-08-01" });
    const snapshot = project({
      filters: filters({
        query: "陳",
        lifecycle: "active",
        service: "serving",
        responsible: otherUserId,
      }),
      clients: [serving, paused, pending, ended],
      assignments: [assignment(serving.id, otherUserId)],
    });
    expect(snapshot.clients.map((item) => item.id)).toEqual([serving.id]);
    expect(snapshot.summary).toEqual({
      serving: 1,
      paused: 1,
      pending: 1,
      ended: 1,
    });
    const pendingOnly = project({
      filters: filters({ lifecycle: "pending_admission" }),
      clients: [serving, pending],
    });
    expect(pendingOnly.clients).toHaveLength(1);
    expect(pendingOnly.clients[0]).toMatchObject({
      id: pending.id,
      lifecycleStatus: "active",
      lifecycleState: "pending_admission",
      serviceStatus: "pending",
    });
  });

  it("paginates 24 per page, reports exact totals, and clamps overflow", () => {
    const clients = Array.from({ length: 53 }, (_, index) => client(index + 1));
    const second = project({ filters: filters({ page: 2 }), clients });
    const overflow = project({ filters: filters({ page: 999 }), clients });
    expect(CASE_CENTER_PAGE_SIZE).toBe(24);
    expect(second).toMatchObject({ total: 53, page: 2, pageCount: 3 });
    expect(second.clients).toHaveLength(24);
    expect(overflow).toMatchObject({ total: 53, page: 3, pageCount: 3 });
    expect(overflow.clients).toHaveLength(5);
  });

  it("never presents hidden responsibility rows as an empty assignment", () => {
    const visible = client(1);
    const selfOnly = project({
      clients: [visible],
      assignmentAccess: "self_only",
    });
    expect(selfOnly.clients[0]?.responsibility).toEqual({
      state: "restricted",
      people: [],
    });

    const restrictedFilter = project({
      filters: filters({ responsible: otherUserId }),
      clients: [visible],
      assignmentAccess: "self_only",
    });
    expect(restrictedFilter.access.responsibleFilterRestricted).toBe(true);
    expect(restrictedFilter.clients).toEqual([]);
    expect(restrictedFilter.visibleTotal).toBe(1);
  });

  it("uses names only when safely projected and otherwise emits a stable code", () => {
    const visible = client(1);
    const named = project({
      clients: [visible],
      assignments: [assignment(visible.id, otherUserId)],
    });
    expect(named.clients[0]?.responsibility.people[0]?.label).toBe("可見督導");

    const coded = projectCaseCenterSnapshot({
      generatedAt: "2026-09-01T04:00:00.000Z",
      filters: filters(),
      clientRows: [visible],
      assignmentRows: [assignment(visible.id, otherUserId)],
      currentUserId,
      currentUserDisplayName: "目前人員",
      assignmentAccess: "full_for_visible_clients",
      profileLabels: "codes",
    });
    expect(coded.clients[0]?.responsibility.people[0]?.label).toBe(
      "人員代碼 222222",
    );
  });

  it("does not project an assignment that belongs to no visible client", () => {
    const visible = client(1);
    const hidden = client(2);
    const snapshot = project({
      clients: [visible],
      assignments: [assignment(hidden.id, otherUserId)],
    });
    expect(snapshot.clients[0]?.responsibility.people).toEqual([]);
    expect(snapshot.responsibleOptions.map((person) => person.userId)).toEqual([
      currentUserId,
    ]);
  });
});
