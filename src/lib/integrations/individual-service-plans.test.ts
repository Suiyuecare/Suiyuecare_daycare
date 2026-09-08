import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import {
  INDIVIDUAL_PLAN_MAX_BYTES,
  individualPlanDatabaseItems,
  parseIndividualPlanApiEnvelope,
  parseIndividualPlanInput,
  parseIndividualPlanResponseContext,
  parseIndividualPlanResult,
} from "./individual-service-plans";

const key = "a1111111-1111-4111-8111-111111111111";
const clientId = "b1111111-1111-4111-8111-111111111111";
const responsibleId = "c1111111-1111-4111-8111-111111111111";
const planId = "d1111111-1111-4111-8111-111111111111";
function body(overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    plan_month: "2026-09",
    previous_plan_id: null,
    correction_reason: null,
    items: [{ goal: "目標", activity: "活動", frequency: "每週", responsible_user_id: responsibleId, progress_status: "not_started", progress_note: null }],
    ...overrides,
  };
}

describe("individual service plan API contract", () => {
  it("uses a strict 64KB bounded body and UUID operation key", () => {
    expect(INDIVIDUAL_PLAN_MAX_BYTES).toBe(64 * 1024);
    expect(() => parseIndividualPlanInput(body(), "not-uuid")).toThrow(IntegrationError);
  });

  it.each(["organization_id", "branch_id", "actor_user_id", "signed_at", "signed_by", "content_hash", "plan_version"])("rejects browser-owned %s", (field) => {
    expect(() => parseIndividualPlanInput(body({ [field]: "caller" }), key)).toThrow(IntegrationError);
  });

  it("enforces first-version versus correction semantics", () => {
    expect(() => parseIndividualPlanInput(body({ correction_reason: "不應存在" }), key)).toThrow(/第一版/u);
    expect(() => parseIndividualPlanInput(body({ previous_plan_id: planId }), key)).toThrow(/新版/u);
  });

  it("maps only governed fields into the database item", () => {
    const input = parseIndividualPlanInput(body(), key);
    expect(individualPlanDatabaseItems(input)[0]).toEqual({
      goal: "目標", activity: "活動", frequency: "每週",
      responsible_user_id: responsibleId, progress_status: "not_started", progress_note: null,
    });
  });

  it("accepts an exact minimal database receipt", () => {
    const input = parseIndividualPlanInput(body(), key);
    expect(parseIndividualPlanResult([{ plan_id: planId, client_id: clientId, plan_month: "2026-09-01", plan_version: 1, previous_plan_id: null, signed_at: "2026-09-01T01:00:00Z", replayed: false }], input)).toMatchObject({ planId, planVersion: 1, persisted: true, demo: false });
  });

  it("rejects a parseable receipt for another client, month or unexpected secret", () => {
    const input = parseIndividualPlanInput(body(), key);
    const base = { plan_id: planId, client_id: clientId, plan_month: "2026-09-01", plan_version: 1, previous_plan_id: null, signed_at: "2026-09-01T01:00:00Z", replayed: false };
    expect(() => parseIndividualPlanResult([{ ...base, client_id: responsibleId }], input)).toThrow(/不一致/u);
    expect(() => parseIndividualPlanResult([{ ...base, plan_month: "2026-08-01" }], input)).toThrow(/不一致/u);
    expect(() => parseIndividualPlanResult([{ ...base, signed_by: responsibleId }], input)).toThrow(/不完整/u);
  });

  it("strictly correlates the browser-facing 2xx envelope", () => {
    const input = parseIndividualPlanInput(body(), key);
    const data = { planId, clientId, planMonth: "2026-09", planVersion: 1, previousPlanId: null, signedAt: "2026-09-01T01:00:00Z", replayed: false, persisted: true, demo: false };
    expect(parseIndividualPlanApiEnvelope({ requestId: key, status: "ok", data, errors: [] }, input, 201).requestId).toBe(key);
    expect(() => parseIndividualPlanApiEnvelope({ requestId: key, status: "ok", data, errors: [] }, input, 200)).toThrow(/HTTP 狀態/u);
    expect(() => parseIndividualPlanApiEnvelope({ requestId: key, status: "ok", data: { ...data, clientId: responsibleId }, errors: [] }, input, 201)).toThrow(/不一致/u);
    expect(() => parseIndividualPlanApiEnvelope({ requestId: key, status: "ok", data: { ...data, signedBy: responsibleId }, errors: [] }, input, 201)).toThrow(/不完整/u);
  });

  it("exposes only a bounded structured error and a valid support request ID", () => {
    expect(parseIndividualPlanResponseContext({
      requestId: key,
      status: "error",
      data: null,
      errors: [{ code: "INDIVIDUAL_PLAN_NOT_AUTHORIZED", message: "目前無權限。" }],
    })).toEqual({ requestId: key, message: "目前無權限。" });
    expect(parseIndividualPlanResponseContext({
      requestId: "raw-id",
      status: "error",
      data: null,
      errors: [{ code: "RAW", message: "secret\u0000detail" }],
    })).toBeNull();
  });
});
