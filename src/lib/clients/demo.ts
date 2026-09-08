import {
  projectClientLifecycleSnapshot,
  type ClientTransitionRow,
} from "./lifecycle";
import type {
  ClientLifecycleSnapshot,
  ClientRegistrySnapshot,
} from "./types";

export function buildDemoClientRegistry(): ClientRegistrySnapshot {
  return {
    generatedAt: "2026-09-01T10:24:00+08:00",
    demo: true,
    clients: [
      ["a1111111-1111-4111-8111-111111111111", "HX-021", "陳O華", "1944-02-14", "active", "2025-04-01", null, 3],
      ["a2222222-2222-4222-8222-222222222222", "HX-022", "林O英", "1941-09-03", "active", "2025-07-18", null, 2],
      ["a3333333-3333-4333-8333-333333333333", "HX-023", "黃O生", "1948-12-26", "active", "2026-01-05", null, 4],
      ["a4444444-4444-4444-8444-444444444444", "HX-024", "吳O美", "1946-06-11", "active", "2026-02-09", null, 1],
      ["a5555555-5555-4555-8555-555555555555", "HX-025", "張O德", "1942-03-30", "active", "2026-03-16", null, 5],
      ["a6666666-6666-4666-8666-666666666666", "HX-026", "李O芳", "1950-11-08", "active", "2026-05-04", null, 2],
      ["a7777777-7777-4777-8777-777777777777", "HX-027", "王O順", "1940-07-21", "suspended", "2025-08-20", null, 6],
      ["a8888888-8888-4888-8888-888888888888", "HX-028", "周O安", "1945-01-17", "closed", "2024-10-15", "2026-08-12", 8],
    ].map(([id, clientCode, displayName, dateOfBirth, status, admittedOn, endedOn, rowVersion]) => ({
      id: String(id),
      clientCode: String(clientCode),
      displayName: String(displayName),
      dateOfBirth: String(dateOfBirth),
      status: status as "active" | "suspended" | "closed",
      serviceState: status as "active" | "suspended" | "closed",
      admittedOn: String(admittedOn),
      endedOn: endedOn ? String(endedOn) : null,
      sourceSystem: "synthetic_demo",
      sourceUpdatedAt: "2026-08-31T16:00:00+08:00",
      rowVersion: Number(rowVersion),
      updatedAt: "2026-08-31T16:00:00+08:00",
    })),
  };
}

export function buildDemoClientLifecycle(): ClientLifecycleSnapshot {
  const registry = buildDemoClientRegistry();
  const actor = "33333333-3333-4333-8333-333333333333";
  const otherActor = "99999999-9999-4999-8999-999999999999";
  const transitions: ClientTransitionRow[] = [
    {
      id: "b8111111-1111-4111-8111-111111111111",
      client_id: "a8888888-8888-4888-8888-888888888888",
      event_kind: "close",
      effective_on: "2026-08-12",
      reason: "家庭照顧安排調整，依結案會議決議終止服務。",
      handoff_note: "已交付照顧摘要並確認後續社區資源聯絡窗口。",
      from_status: "active",
      to_status: "closed",
      base_row_version: 7,
      resulting_row_version: 8,
      actor_user_id: actor,
      created_at: "2026-08-12T16:20:00+08:00",
    },
    {
      id: "b7222222-2222-4222-8222-222222222222",
      client_id: "a7777777-7777-4777-8777-777777777777",
      event_kind: "suspend",
      effective_on: "2026-08-05",
      reason: "短期住院，暫停日照服務。",
      handoff_note: null,
      from_status: "active",
      to_status: "suspended",
      base_row_version: 5,
      resulting_row_version: 6,
      actor_user_id: otherActor,
      created_at: "2026-08-05T09:08:00+08:00",
    },
    {
      id: "b7333333-3333-4333-8333-333333333333",
      client_id: "a7777777-7777-4777-8777-777777777777",
      event_kind: "admit",
      effective_on: "2025-08-20",
      reason: "收案評估完成並確認服務開始日。",
      handoff_note: null,
      from_status: "active",
      to_status: "active",
      base_row_version: 4,
      resulting_row_version: 5,
      actor_user_id: actor,
      created_at: "2025-08-19T15:30:00+08:00",
    },
    {
      id: "b8444444-4444-4444-8444-444444444444",
      client_id: "a8888888-8888-4888-8888-888888888888",
      event_kind: "admit",
      effective_on: "2024-10-15",
      reason: "完成收案文件與服務同意。",
      handoff_note: null,
      from_status: "active",
      to_status: "active",
      base_row_version: 6,
      resulting_row_version: 7,
      actor_user_id: otherActor,
      created_at: "2024-10-14T14:10:00+08:00",
    },
  ];

  return projectClientLifecycleSnapshot({
    clientRows: registry.clients.map((client) => ({
      id: client.id,
      client_code: client.clientCode,
      display_name: client.displayName,
      status: client.status,
      admitted_on: client.admittedOn,
      ended_on: client.endedOn,
      row_version: client.rowVersion,
      updated_at: client.updatedAt,
    })),
    transitionRows: transitions,
    currentUserId: actor,
    currentUserDisplayName: "林督導",
    generatedAt: registry.generatedAt,
    demo: true,
  });
}
