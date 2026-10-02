import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));

import {
  loadQuestionnaireResumeSummary,
  parseQuestionnaireResumeSummary,
  QuestionnaireResumeSummaryError,
} from "./resume-summary";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const branchId = "b1111111-1111-4111-8111-111111111111";
const clientId = "c1111111-1111-4111-8111-111111111111";
const assessmentKey = "d1111111-1111-4111-8111-111111111111";
const versionId = "e1111111-1111-4111-8111-111111111111";
const context = {
  organizationId, branchId, userId: versionId,
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員",
  roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
} as TenantContext;
const latest = {
  assessmentKey, versionId, version: 2, assessedOn: "2026-09-25",
  savedAt: "2026-10-02T01:00:00Z", recordState: "draft",
};
const payload = {
  clientId, generatedAt: "2026-10-02T01:00:01Z",
  forms: [
    { formKey: "spmsq", latest },
    { formKey: "gds_15", latest: null },
  ],
};

describe("questionnaire resume summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
    mocks.abort.mockResolvedValue({ data: payload, error: null });
  });
  afterEach(() => vi.useRealTimers());

  it("loads one selected client's metadata by an abortable authenticated RPC", async () => {
    expect(await loadQuestionnaireResumeSummary(context, clientId)).toEqual(payload);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("questionnaire_resume_summary", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
    });
    expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(JSON.stringify(payload)).not.toMatch(/answers|context|contentHash|authorUserId/u);
  });

  it("rejects demo, missing branch, malformed selected client and missing client scope before RPC", async () => {
    for (const [actor, id] of [
      [{ ...context, demo: true }, clientId],
      [{ ...context, branchId: null }, clientId],
      [context, "not-a-uuid"],
      [{ ...context, scopes: ["questionnaire_cognition.read"] }, clientId],
    ] as const) {
      await expect(loadQuestionnaireResumeSummary(actor as TenantContext, id)).rejects.toBeInstanceOf(QuestionnaireResumeSummaryError);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails closed on migration absence, forged scope, duplicate forms, empty or answer-bearing output", async () => {
    for (const result of [
      { data: null, error: { code: "PGRST202" } },
      { data: { ...payload, clientId: branchId }, error: null },
      { data: { ...payload, forms: [payload.forms[0], payload.forms[0]] }, error: null },
      { data: { ...payload, forms: [] }, error: null },
      { data: { ...payload, forms: [{ ...payload.forms[0], latest: { ...latest, answers: {} } }] }, error: null },
      { data: { ...payload, forms: [{ ...payload.forms[0], latest: { ...latest, contentHash: "a".repeat(64) } }] }, error: null },
      { data: { ...payload, forms: [{ ...payload.forms[0], latest: { ...latest, authorDisplayName: "合成護理員" } }] }, error: null },
      { data: { ...payload, forms: [{ ...payload.forms[0], latest: { ...latest, recordState: "signed" } }] }, error: null },
      { data: { ...payload, forms: [{ ...payload.forms[0], latest: { ...latest, savedAt: "2026-10-03T00:00:00Z" } }] }, error: null },
    ]) {
      mocks.abort.mockResolvedValueOnce(result);
      await expect(loadQuestionnaireResumeSummary(context, clientId)).rejects.toBeInstanceOf(QuestionnaireResumeSummaryError);
    }
  });

  it("requires only known forms and exact server response fields", () => {
    expect(() => parseQuestionnaireResumeSummary({ ...payload, extra: true }, clientId)).toThrow();
    expect(() => parseQuestionnaireResumeSummary({ ...payload, forms: [{ formKey: "unknown", latest: null }] }, clientId)).toThrow();
    expect(() => parseQuestionnaireResumeSummary(payload, branchId)).toThrow();
  });

  it("bounds a non-cooperative read without treating the timeout as no draft", async () => {
    vi.useFakeTimers();
    mocks.abort.mockReturnValue(new Promise(() => {}));
    const pending = expect(loadQuestionnaireResumeSummary(context, clientId)).rejects.toBeInstanceOf(QuestionnaireResumeSummaryError);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    await pending;
    expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an RPC after late provider creation times out", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = expect(loadQuestionnaireResumeSummary(context, clientId)).rejects.toBeInstanceOf(QuestionnaireResumeSummaryError);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    await pending;
    resolve({ rpc: mocks.rpc });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
