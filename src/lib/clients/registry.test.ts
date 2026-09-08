import { describe, expect, it } from "vitest";

import { buildDemoClientRegistry } from "./demo";

describe("client registry projection", () => {
  it("contains only synthetic stable identifiers and explicit lifecycle states", () => {
    const snapshot = buildDemoClientRegistry();
    expect(snapshot.demo).toBe(true);
    expect(new Set(snapshot.clients.map((client) => client.id)).size).toBe(
      snapshot.clients.length,
    );
    expect(new Set(snapshot.clients.map((client) => client.clientCode)).size).toBe(
      snapshot.clients.length,
    );
    expect(snapshot.clients.every((client) => client.sourceSystem === "synthetic_demo")).toBe(true);
    expect(snapshot.clients.some((client) => client.status === "suspended")).toBe(true);
    expect(snapshot.clients.some((client) => client.status === "closed" && client.endedOn)).toBe(true);
  });

  it("does not expose a national identifier field in the registry contract", () => {
    const client = buildDemoClientRegistry().clients[0]!;
    expect("nationalId" in client).toBe(false);
    expect("national_id_ciphertext" in client).toBe(false);
  });
});

