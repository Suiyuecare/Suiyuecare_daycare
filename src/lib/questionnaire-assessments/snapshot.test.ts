import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));

import { loadQuestionnaireResumeDraft, loadQuestionnaireSnapshot, QuestionnaireSnapshotError } from "./snapshot";

const id = "a1111111-1111-4111-8111-111111111111";
const context = {
  organizationId: id, branchId: id, userId: id, organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成人員", roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
} as TenantContext;
const payload = { formKey: "spmsq", generatedAt: "2026-10-02T01:00:00Z", matchingTotal: 0, clients: [] };
const assessmentKey = "a1111111-1111-4111-8111-111111111112";
const versionId = "a1111111-1111-4111-8111-111111111113";
const draft = { assessmentKey, versionId, version: 2, formVersion: "spmsq-pfeiffer-10-education-adjusted-v1",
  assessedOn: "2026-09-25", answers: { q1: { state: "missing" } }, context: {}, recordState: "draft",
  authorDisplayName: "合成人員", createdAt: "2026-10-02T01:00:00Z", contentHash: "a".repeat(64) };
const history = { formKey: "spmsq", clientId: id, assessmentKey, versions: [draft], total: 2, nextBeforeVersion: null };
const summary = { clientId: id, generatedAt: "2026-10-02T01:00:01Z", forms: [{ formKey: "spmsq", latest: {
  assessmentKey, versionId, version: 2, assessedOn: "2026-09-25", savedAt: draft.createdAt, recordState: "draft",
} }] };

describe("questionnaire snapshot bounded read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
    mocks.abort.mockResolvedValue({ data: payload, error: null });
  });
  afterEach(() => vi.useRealTimers());

  it("loads a valid scoped snapshot with one abortable RPC", async () => {
    expect(await loadQuestionnaireSnapshot(context, "spmsq", id)).toEqual(payload);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("questionnaire_assessment_snapshot", {
      p_expected_organization_id: id, p_expected_branch_id: id, p_form_key: "spmsq", p_client_id: id,
    });
    expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("fails closed on a missing migration or invalid response, never as an empty form", async () => {
    mocks.abort.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    await expect(loadQuestionnaireSnapshot(context, "spmsq", id)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    mocks.abort.mockResolvedValueOnce({ data: { ...payload, formKey: "gds_15" }, error: null });
    await expect(loadQuestionnaireSnapshot(context, "spmsq", id)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });

  it("bounds a non-cooperative read and aborts the transport", async () => {
    vi.useFakeTimers();
    mocks.abort.mockReturnValue(new Promise(() => {}));
    const pending = expect(loadQuestionnaireSnapshot(context, "spmsq", id)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    await pending;
    expect(mocks.abort.mock.calls[0][0].aborted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start the RPC after late provider creation has timed out", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = expect(loadQuestionnaireSnapshot(context, "spmsq", id)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    await pending;
    resolve({ rpc: mocks.rpc });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("questionnaire exact resume read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
    mocks.abort.mockImplementation(async () => ({
      data: mocks.rpc.mock.calls.at(-1)?.[0] === "questionnaire_resume_summary" ? summary : history,
      error: null,
    }));
  });
  afterEach(() => vi.useRealTimers());

  it("returns the exact version only when it remains newest across all assessment chains", async () => {
    expect(await loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId)).toEqual(draft);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "questionnaire_assessment_history", {
      p_expected_organization_id: id, p_expected_branch_id: id, p_form_key: "spmsq", p_client_id: id,
      p_assessment_key: assessmentKey, p_before_version: null,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "questionnaire_resume_summary", {
      p_expected_organization_id: id, p_expected_branch_id: id, p_client_id: id,
    });
    expect(mocks.abort).toHaveBeenCalledTimes(2);
  });

  it("reports a stale link when the same assessment chain has a newer revision", async () => {
    expect(await loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, id)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("also rejects a same-chain revision committed between history and summary reads", async () => {
    mocks.abort.mockResolvedValueOnce({ data: history, error: null }).mockResolvedValueOnce({
      data: { ...summary, forms: [{ formKey: "spmsq", latest: {
        ...summary.forms[0]!.latest,
        versionId: "a1111111-1111-4111-8111-111111111116",
        version: 3,
        savedAt: "2026-10-02T01:00:01Z",
      } }] }, error: null,
    });
    expect(await loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("reports a stale link when another assessment chain was saved more recently", async () => {
    const newerAssessmentKey = "a1111111-1111-4111-8111-111111111114";
    const newerVersionId = "a1111111-1111-4111-8111-111111111115";
    mocks.abort.mockResolvedValueOnce({ data: history, error: null }).mockResolvedValueOnce({
      data: { ...summary, forms: [{ formKey: "spmsq", latest: {
        ...summary.forms[0]!.latest, assessmentKey: newerAssessmentKey, versionId: newerVersionId,
        savedAt: "2026-10-02T01:00:01Z",
      } }] }, error: null,
    });
    expect(await loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId)).toBeNull();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "questionnaire_assessment_history", "questionnaire_resume_summary",
    ]);
  });

  it("fails closed on a mismatched or malformed exact history, not a different draft", async () => {
    mocks.abort.mockResolvedValueOnce({ data: { ...history, assessmentKey: id }, error: null });
    await expect(loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed on revoked access, missing migration or malformed history", async () => {
    mocks.abort.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    mocks.abort.mockResolvedValueOnce({ data: { ...history, total: 3 }, error: null });
    await expect(loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    await expect(loadQuestionnaireResumeDraft({ ...context, demo: true }, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });

  it("treats missing summary, withdrawn form permission and contradictory empty metadata as read errors", async () => {
    mocks.abort.mockResolvedValueOnce({ data: history, error: null }).mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    await expect(loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    mocks.abort.mockResolvedValueOnce({ data: history, error: null }).mockResolvedValueOnce({
      data: { ...summary, forms: [{ formKey: "gds_15", latest: null }] }, error: null,
    });
    await expect(loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    mocks.abort.mockResolvedValueOnce({ data: history, error: null }).mockResolvedValueOnce({
      data: { ...summary, forms: [{ formKey: "spmsq", latest: null }] }, error: null,
    });
    await expect(loadQuestionnaireResumeDraft(context, "spmsq", id, assessmentKey, versionId))
      .rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });
});
