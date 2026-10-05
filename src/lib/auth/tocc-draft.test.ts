import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";

const stubs = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.create }));

import { canSignToccDraft, canUseToccDraft } from "./tocc-draft";

const actor = {
  organizationId: "e0500000-0000-4000-8000-000000000001",
  organizationName: "合成機構",
  branchId: "e0600000-0000-4000-8000-000000000001",
  branchName: "合成分支",
  userId: "e0100000-0000-4000-8000-000000000001",
  displayName: "合成工作人員",
  roles: ["nurse"],
  scopes: ["clients.read", "health.read", "health.write"],
  assuranceLevel: "aal1",
  recentAal2At: null,
  demo: false,
} as TenantContext;
const clientId = "e0800000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  stubs.create.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockResolvedValue({ data: true, error: null });
});

describe("TOCC draft authorization preflight", () => {
  it("asks the database for exact tenant, branch, client and write scope", async () => {
    expect(await canUseToccDraft(actor, clientId, true)).toBe(true);
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith("has_client_tocc_draft_access", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
      target_client_id: clientId,
      target_write: true,
    });
  });

  it("fails closed for absent scope, branch, demo or denied live grant", async () => {
    expect(await canUseToccDraft({ ...actor, scopes: ["clients.read"] }, clientId, true)).toBe(false);
    expect(await canUseToccDraft({ ...actor, branchId: "" }, clientId, true)).toBe(false);
    expect(await canUseToccDraft({ ...actor, demo: true }, clientId, true)).toBe(false);
    expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.rpc.mockResolvedValue({ data: false, error: null });
    expect(await canUseToccDraft(actor, clientId, true)).toBe(false);
  });

  it("does not equate a draft writer's AAL1 session with formal signing authority", async () => {
    expect(await canSignToccDraft(actor)).toBe(false);
    expect(stubs.rpc).not.toHaveBeenCalled();
    const aal2 = { ...actor, assuranceLevel: "aal2" as const };
    stubs.rpc.mockResolvedValue({ data: false, error: null });
    expect(await canSignToccDraft(aal2)).toBe(false);
    expect(stubs.rpc).toHaveBeenCalledWith("can_sign_client_tocc_draft", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
    });
    stubs.rpc.mockResolvedValue({ data: true, error: null });
    expect(await canSignToccDraft(aal2)).toBe(true);
  });
});
