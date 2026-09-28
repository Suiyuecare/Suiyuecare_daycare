import { describe, expect, it } from "vitest";

import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";

import { buildDemoQuestionnaireSnapshot } from "./demo-snapshot";

const clients = buildDemoClientMasterSnapshot().clients;
const date = "2026-09-28T01:00:00.000Z";

describe("demo questionnaire snapshot", () => {
  it("shares the entry picker's authorized synthetic clients without including closed clients", () => {
    const snapshot = buildDemoQuestionnaireSnapshot("eat10_swallowing", clients, null, date);
    expect(snapshot.clients.map((client) => client.clientId)).toEqual(clients
      .filter((client) => client.status === "active" || client.status === "suspended")
      .map((client) => client.id));
    expect(snapshot.matchingTotal).toBe(snapshot.clients.length);
  });

  it("keeps a selected client in the original form and denies an unknown client", () => {
    const id = clients[0]!.id;
    expect(buildDemoQuestionnaireSnapshot("spmsq", clients, id, date).clients).toMatchObject([
      { clientId: id, displayName: clients[0]!.displayName },
    ]);
    expect(buildDemoQuestionnaireSnapshot("spmsq", clients, "b9999999-9999-4999-8999-999999999999", date)).toMatchObject({
      matchingTotal: 0,
      clients: [],
    });
  });
});
