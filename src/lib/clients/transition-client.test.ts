import { describe, expect, it } from "vitest";

import {
  ClientTransitionClientContractError,
  parseClientTransitionError,
  parseClientTransitionSuccess,
} from "./transition-client";

const expected = {
  clientId: "61000000-0000-4000-8000-000000000001",
  eventKind: "suspend" as const,
  effectiveOn: "2026-09-02",
  fromStatus: "active" as const,
  baseRowVersion: 3,
};

function wrap(data: unknown) {
  return {
    requestId: "61000000-0000-4000-8000-000000000002",
    status: "ok",
    data,
    errors: [],
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    transition: {
      id: "61000000-0000-4000-8000-000000000003",
      clientId: expected.clientId,
      eventKind: expected.eventKind,
      effectiveOn: expected.effectiveOn,
      fromStatus: expected.fromStatus,
      toStatus: "suspended",
      baseRowVersion: expected.baseRowVersion,
      resultingRowVersion: expected.baseRowVersion + 1,
    },
    replayed: false,
    persisted: true,
    demo: false,
    ...overrides,
  };
}

describe("client transition browser contract", () => {
  it("accepts only a correlated persisted create receipt", () => {
    const parsed = parseClientTransitionSuccess(wrap(receipt()), 201, expected);
    expect(parsed.data.transition.toStatus).toBe("suspended");
  });

  it("requires a replay receipt to use 200", () => {
    const replay = wrap(receipt({ replayed: true }));
    expect(() => parseClientTransitionSuccess(replay, 201, expected)).toThrow(
      ClientTransitionClientContractError,
    );
    expect(parseClientTransitionSuccess(replay, 200, expected).data.replayed).toBe(true);
  });

  it("rejects mismatched identity, transition mapping, versions and unknown fields", () => {
    const wrongClient = receipt();
    wrongClient.transition.clientId = "61000000-0000-4000-8000-000000000099";
    expect(() => parseClientTransitionSuccess(wrap(wrongClient), 201, expected)).toThrow(
      ClientTransitionClientContractError,
    );

    const wrongTarget = receipt();
    wrongTarget.transition.toStatus = "closed";
    expect(() => parseClientTransitionSuccess(wrap(wrongTarget), 201, expected)).toThrow(
      ClientTransitionClientContractError,
    );

    const wrongVersion = receipt();
    wrongVersion.transition.resultingRowVersion = 5;
    expect(() => parseClientTransitionSuccess(wrap(wrongVersion), 201, expected)).toThrow(
      ClientTransitionClientContractError,
    );

    expect(() => parseClientTransitionSuccess(
      wrap({ ...receipt(), injected: true }),
      201,
      expected,
    )).toThrow(ClientTransitionClientContractError);
  });

  it("returns only a bounded, structurally valid error", () => {
    expect(parseClientTransitionError({
      requestId: "61000000-0000-4000-8000-000000000004",
      status: "error",
      data: null,
      errors: [{ code: "AAL2_REQUIRED", message: "請重新驗證。" }],
    })).toEqual({ code: "AAL2_REQUIRED", message: "請重新驗證。" });
    expect(parseClientTransitionError({
      status: "error",
      errors: [{ code: "x", message: "raw" }],
    })).toBeNull();
  });
});
