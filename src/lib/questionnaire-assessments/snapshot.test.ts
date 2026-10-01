import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));

import { loadQuestionnaireSnapshot, QuestionnaireSnapshotError } from "./snapshot";

const id = "a1111111-1111-4111-8111-111111111111";
const context = {
  organizationId: id, branchId: id, userId: id, organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成人員", roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
} as TenantContext;
const payload = { formKey: "spmsq", generatedAt: "2026-10-02T01:00:00Z", matchingTotal: 0, clients: [] };

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
