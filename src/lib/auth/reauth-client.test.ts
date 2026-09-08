import { describe, expect, it } from "vitest";

import {
  ReauthClientContractError,
  parseReauthChallengeEnvelope,
  parseReauthCompletionEnvelope,
} from "./reauth-client";

const requestId = "81000000-0000-4000-8000-000000000001";
const challengeId = "81000000-0000-4000-8000-000000000002";

describe("reauth browser receipt contracts", () => {
  it("accepts only a strict correlated challenge shape", () => {
    const raw = { requestId, status: "ok", data: { challengeId,
      nonce: "a".repeat(43), expiresAt: "2026-09-01T00:05:00.000Z", demo: false }, errors: [] };
    expect(parseReauthChallengeEnvelope(raw, 200).data.challengeId).toBe(challengeId);
    expect(() => parseReauthChallengeEnvelope({ ...raw, debug: "secret" }, 200)).toThrow(ReauthClientContractError);
    expect(() => parseReauthChallengeEnvelope({ ...raw, data: { ...raw.data, nonce: "short" } }, 200)).toThrow(ReauthClientContractError);
  });

  it("does not accept a generic 2xx as completed reauthentication", () => {
    const raw = { requestId, status: "ok", data: { recorded: true, demo: false }, errors: [] };
    expect(parseReauthCompletionEnvelope(raw, 200).data.recorded).toBe(true);
    expect(() => parseReauthCompletionEnvelope({ ...raw, data: { recorded: false, demo: false } }, 200)).toThrow(ReauthClientContractError);
    expect(() => parseReauthCompletionEnvelope(raw, 201)).toThrow(ReauthClientContractError);
  });
});
