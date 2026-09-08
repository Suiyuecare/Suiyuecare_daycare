import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoClientLifecycle } from "./demo";
import {
  filterClientLifecycleTransitions,
  parseClientTransitionInput,
  projectClientLifecycleSnapshot,
  type ClientLifecycleClientRow,
  type ClientTransitionRow,
} from "./lifecycle";
import {
  allowedClientTransitionKinds,
  taipeiDate,
} from "./lifecycle-rules";

const clientRows: ClientLifecycleClientRow[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    client_code: "C-001",
    display_name: "陳O華",
    status: "active",
    admitted_on: "2026-08-01",
    ended_on: null,
    row_version: 4,
    updated_at: "2026-09-01T01:00:00Z",
  },
];

const transitionRows: ClientTransitionRow[] = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    client_id: clientRows[0]!.id,
    event_kind: "suspend",
    effective_on: "2026-09-01",
    reason: "短期住院",
    handoff_note: null,
    from_status: "active",
    to_status: "suspended",
    base_row_version: 3,
    resulting_row_version: 4,
    actor_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    created_at: "2026-09-01T02:00:00Z",
  },
];

function validInput() {
  return {
    client_id: clientRows[0]!.id,
    event_kind: "suspend",
    effective_on: "2026-09-01",
    reason: "  短期住院  ",
    handoff_note: "",
    expected_row_version: 4,
  };
}

describe("client lifecycle typed input", () => {
  it("normalizes a valid transition and uses a UUID idempotency header", () => {
    const parsed = parseClientTransitionInput(
      validInput(),
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      new Date("2026-09-01T12:00:00+08:00"),
    );
    expect(parsed).toMatchObject({
      clientId: clientRows[0]!.id,
      eventKind: "suspend",
      effectiveOn: "2026-09-01",
      reason: "短期住院",
      handoffNote: null,
      expectedRowVersion: 4,
    });
  });

  it("requires handoff details for terminal events", () => {
    expect(() =>
      parseClientTransitionInput(
        { ...validInput(), event_kind: "close" },
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        new Date("2026-09-01T12:00:00+08:00"),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "HANDOFF_REQUIRED",
        field: "handoff_note",
      }),
    );
  });

  it.each(["2026-02-30", "2026-09-02"])(
    "rejects invalid or future effective date %s",
    (effectiveOn) => {
      expect(() =>
        parseClientTransitionInput(
          { ...validInput(), effective_on: effectiveOn },
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          new Date("2026-09-01T12:00:00+08:00"),
        ),
      ).toThrow(IntegrationError);
    },
  );

  it("rejects unknown fields and non-UUID idempotency keys", () => {
    expect(() =>
      parseClientTransitionInput(
        { ...validInput(), actor_user_id: "browser-supplied" },
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "INVALID_CLIENT_TRANSITION",
      }),
    );
    expect(() => parseClientTransitionInput(validInput(), "retry-token"))
      .toThrowError(
        expect.objectContaining<Partial<IntegrationError>>({
          code: "IDEMPOTENCY_KEY_REQUIRED",
        }),
      );
  });

  it("uses Asia/Taipei rather than the host timezone for the current date", () => {
    expect(taipeiDate(new Date("2026-08-31T16:30:00Z"))).toBe("2026-09-01");
  });
});

describe("client lifecycle projection and rules", () => {
  it("offers only legal UI candidates while leaving enforcement to the RPC", () => {
    expect(allowedClientTransitionKinds({
      status: clientRows[0]!.status,
      admittedOn: clientRows[0]!.admitted_on,
      endedOn: clientRows[0]!.ended_on,
    })).toEqual([
      "suspend",
      "transfer",
      "close",
      "death",
    ]);
    expect(allowedClientTransitionKinds({
      status: "suspended",
      admittedOn: "2026-08-01",
      endedOn: null,
    })).toEqual(["resume", "transfer", "close", "death"]);
    expect(allowedClientTransitionKinds({
      status: "closed",
      admittedOn: "2026-08-01",
      endedOn: "2026-08-31",
    })).toEqual([]);
  });

  it("drops orphaned rows and never projects actor UUIDs or sensitive client fields", () => {
    const snapshot = projectClientLifecycleSnapshot({
      clientRows,
      transitionRows: [
        ...transitionRows,
        { ...transitionRows[0]!, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", client_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      ],
      currentUserId: "11111111-1111-4111-8111-111111111111",
      currentUserDisplayName: "目前使用者",
      generatedAt: "2026-09-01T12:00:00+08:00",
      demo: false,
    });
    expect(snapshot.transitions).toHaveLength(1);
    expect(snapshot.transitions[0]!.actorLabel).toBe("已授權工作人員");
    expect("actorUserId" in snapshot.transitions[0]!).toBe(false);
    expect("dateOfBirth" in snapshot.clients[0]!).toBe(false);
    expect("national_id_ciphertext" in snapshot.clients[0]!).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
  });

  it("projects unadmitted active clients and admit transitions as pending admission", () => {
    const pendingClient = {
      ...clientRows[0]!,
      id: "12121212-1212-4212-8212-121212121212",
      client_code: "PENDING-001",
      admitted_on: null,
      row_version: 1,
    };
    const snapshot = projectClientLifecycleSnapshot({
      clientRows: [pendingClient],
      transitionRows: [{
        ...transitionRows[0]!,
        id: "13131313-1313-4313-8313-131313131313",
        client_id: pendingClient.id,
        event_kind: "admit",
        from_status: "active",
        to_status: "active",
      }],
      currentUserId: "11111111-1111-4111-8111-111111111111",
      currentUserDisplayName: "目前使用者",
      generatedAt: "2026-09-01T12:00:00+08:00",
      demo: false,
    });
    expect(snapshot.clients[0]?.serviceState).toBe("pending_admission");
    expect(snapshot.metrics.pendingAdmission).toBe(1);
    expect(snapshot.transitions[0]).toMatchObject({
      fromServiceState: "pending_admission",
      toServiceState: "active",
    });
    expect(filterClientLifecycleTransitions(snapshot, {
      query: "",
      status: "pending_admission",
      eventKind: "all",
      effectiveOn: null,
    })).toHaveLength(1);
  });

  it("reveals an actor display name only when the server projection was authorized", () => {
    const actorNames = new Map([
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "王社工"],
    ]);
    const snapshot = projectClientLifecycleSnapshot({
      clientRows,
      transitionRows,
      currentUserId: "11111111-1111-4111-8111-111111111111",
      currentUserDisplayName: "目前使用者",
      visibleActorNames: actorNames,
      generatedAt: "2026-09-01T12:00:00+08:00",
      demo: false,
    });
    expect(snapshot.transitions[0]!.actorLabel).toBe("王社工");
  });

  it("provides synthetic demo history without registry-only sensitive fields", () => {
    const snapshot = buildDemoClientLifecycle();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.transitions.length).toBeGreaterThan(0);
    expect(snapshot.metrics.pendingHandoff).toBe(0);
    expect(snapshot.clients.every((client) => !("dateOfBirth" in client))).toBe(true);
    expect(snapshot.transitions.every((item) => !("actor_user_id" in item))).toBe(true);
  });

  it("applies client, current-status, event, and effective-date filters together", () => {
    const snapshot = buildDemoClientLifecycle();
    expect(filterClientLifecycleTransitions(snapshot, {
      query: "HX-028",
      status: "closed",
      eventKind: "close",
      effectiveOn: "2026-08-12",
    }).map((item) => item.id)).toEqual([
      "b8111111-1111-4111-8111-111111111111",
    ]);
  });
});
