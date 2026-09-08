import { describe, expect, it } from "vitest";

import {
  parseServiceCompletionEnvelope,
  parseServiceCompletionError,
  ServiceCompletionClientContractError,
} from "./completion-client";

const expected = {
  clientId: "52000000-0000-4000-8000-000000000001",
  serviceCode: "ba01",
  startedAt: "2026-09-01T01:00:00.000Z",
  endedAt: "2026-09-01T02:00:00.000Z",
};

function wrap(data: unknown) {
  return {
    requestId: "52000000-0000-4000-8000-000000000002",
    status: "ok",
    data,
    errors: [],
  };
}

function persisted(overrides: Record<string, unknown> = {}) {
  return {
    serviceEvent: {
      id: "52000000-0000-4000-8000-000000000003",
      clientId: expected.clientId,
      authorizedCarePlanId: "52000000-0000-4000-8000-000000000004",
      clientServicePlanId: "52000000-0000-4000-8000-000000000005",
      serviceCode: "BA01",
      status: "completed",
      startedAt: expected.startedAt,
      endedAt: expected.endedAt,
      signedAt: "2026-09-01T02:01:00.000Z",
      signedBy: "52000000-0000-4000-8000-000000000006",
      signaturePurpose: "完成服務與執行證據簽署",
      signatureReauthChallengeId: "52000000-0000-4000-8000-000000000007",
    },
    operationId: "52000000-0000-4000-8000-000000000008",
    replayed: false,
    persisted: true,
    demo: false,
    ...overrides,
  };
}

describe("service completion browser contract", () => {
  it("accepts a correlated persisted receipt only with the create status", () => {
    const parsed = parseServiceCompletionEnvelope(wrap(persisted()), 201, expected);
    expect(parsed.data.demo).toBe(false);
    expect(parsed.data.serviceEvent.serviceCode).toBe("BA01");
  });

  it("requires replayed receipts to use 200", () => {
    const replayed = wrap(persisted({ replayed: true }));
    expect(() => parseServiceCompletionEnvelope(replayed, 201, expected)).toThrow(
      ServiceCompletionClientContractError,
    );
    expect(parseServiceCompletionEnvelope(replayed, 200, expected).data.replayed).toBe(true);
  });

  it("rejects forged identity, time and unknown fields", () => {
    const forged = persisted();
    forged.serviceEvent.clientId = "52000000-0000-4000-8000-000000000099";
    expect(() => parseServiceCompletionEnvelope(wrap(forged), 201, expected)).toThrow(
      ServiceCompletionClientContractError,
    );
    expect(() => parseServiceCompletionEnvelope(wrap({ ...persisted(), injected: true }), 201, expected)).toThrow(
      ServiceCompletionClientContractError,
    );
    const wrongPeriod = persisted();
    wrongPeriod.serviceEvent.endedAt = "2026-09-01T00:59:00.000Z";
    expect(() => parseServiceCompletionEnvelope(wrap(wrongPeriod), 201, expected)).toThrow(
      ServiceCompletionClientContractError,
    );
  });

  it("returns only a bounded, structurally valid error", () => {
    const error = parseServiceCompletionError({
      requestId: "52000000-0000-4000-8000-000000000009",
      status: "error",
      data: null,
      errors: [{ code: "AAL2_REQUIRED", message: "請重新驗證。" }],
    });
    expect(error).toEqual({ code: "AAL2_REQUIRED", message: "請重新驗證。" });
    expect(parseServiceCompletionError({ errors: [{ code: "x", message: "raw" }] })).toBeNull();
  });
});
