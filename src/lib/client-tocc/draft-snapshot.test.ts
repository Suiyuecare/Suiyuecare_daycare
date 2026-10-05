import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";

const stubs = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.create }));

import { loadToccDraftSnapshot, ToccDraftSnapshotError } from "./draft-snapshot";

const actor = {
  demo: false,
  organizationId: "e0500000-0000-4000-8000-000000000001",
  branchId: "e0600000-0000-4000-8000-000000000001",
} as TenantContext;

function draftRow(index: number) {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    draft_key: `e0900000-0000-4000-8000-${suffix}`,
    version_id: `e0910000-0000-4000-8000-${suffix}`,
    client_id: "e0800000-0000-4000-8000-000000000001",
    version: 1,
    content_hash: "a".repeat(64),
    assessment_date: "2026-10-03",
    result_status: "clear",
    symptom_summary: null,
    risk_summary: null,
    evidence_status: "not_required",
    action_status: "none_required",
    created_at: "2026-10-03T00:00:00Z",
    signed_assessment_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.create.mockResolvedValue({ rpc: stubs.rpc });
});

describe("TOCC draft snapshot pagination", () => {
  it("requests one lookahead row and exposes the next page without truncating it", async () => {
    stubs.rpc.mockResolvedValue({ data: Array.from({ length: 101 }, (_, index) => draftRow(index)), error: null });
    const result = await loadToccDraftSnapshot(actor, 2);
    expect(stubs.rpc).toHaveBeenCalledWith("client_tocc_draft_snapshot", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_limit: 101,
      p_offset: 200,
    });
    expect(result.drafts).toHaveLength(100);
    expect(result.hasMore).toBe(true);
  });

  it("returns an exact last page and rejects oversized backend responses", async () => {
    stubs.rpc.mockResolvedValueOnce({ data: [draftRow(0)], error: null });
    await expect(loadToccDraftSnapshot(actor)).resolves.toMatchObject({ hasMore: false,
      drafts: [{ draftKey: draftRow(0).draft_key }] });
    stubs.rpc.mockResolvedValueOnce({ data: Array.from({ length: 102 }, (_, index) => draftRow(index)), error: null });
    await expect(loadToccDraftSnapshot(actor)).rejects.toBeInstanceOf(ToccDraftSnapshotError);
  });

  it("rejects invalid page offsets before calling the database", async () => {
    await expect(loadToccDraftSnapshot(actor, -1)).rejects.toBeInstanceOf(ToccDraftSnapshotError);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
