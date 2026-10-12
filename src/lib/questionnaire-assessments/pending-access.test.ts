import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: () => createClient() }));
import { loadAuthorizedPendingQuestionnaireClientIds } from "./pending-access";
import type { TenantContext } from "@/lib/domain/types";
const clientId = "fbf10000-0000-4000-8000-000000000001";
const context = { organizationId: "fbf20000-0000-4000-8000-000000000001", branchId: "fbf30000-0000-4000-8000-000000000001", demo: false } as TenantContext;
describe("source-bound pending draft access", () => {
  beforeEach(() => { rpc.mockReset(); createClient.mockReset(); createClient.mockResolvedValue({ rpc }); });
  it("does not query a real source for demo or an empty visible list", async () => {
    expect((await loadAuthorizedPendingQuestionnaireClientIds({ ...context, demo: true }, [clientId])).size).toBe(0);
    expect((await loadAuthorizedPendingQuestionnaireClientIds(context, [])).size).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("binds requested IDs to actor tenant, returns a set and deduplicates input", async () => {
    rpc.mockResolvedValue({ data: [clientId], error: null });
    expect(await loadAuthorizedPendingQuestionnaireClientIds(context, [clientId, clientId])).toEqual(new Set([clientId]));
    expect(rpc).toHaveBeenCalledWith("authorized_pending_questionnaire_client_ids", {
      p_org: context.organizationId, p_branch: context.branchId, p_visible_ids: [clientId],
    });
  });
  it("treats a read-only empty set as normal, never infers manage from role", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await loadAuthorizedPendingQuestionnaireClientIds(context, [clientId])).size).toBe(0);
  });
  it.each([
    { data: ["fbf10000-0000-4000-8000-000000000002"], error: null },
    { data: [clientId, clientId], error: null },
    { data: { ids: [clientId] }, error: null },
    { data: [clientId], error: { code: "42501" } },
  ])("rejects malformed, duplicate or unrelated result IDs without fallback", async response => {
    rpc.mockResolvedValue(response);
    await expect(loadAuthorizedPendingQuestionnaireClientIds(context, [clientId])).rejects.toThrow("Pending questionnaire access unavailable.");
  });
});
