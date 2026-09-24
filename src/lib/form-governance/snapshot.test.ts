import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { reviewIds as ids } from "./publication-review.test-fixtures";
import { projectFormGovernanceSnapshot, type FormGovernanceSnapshotSourceRow } from "./projection";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), result: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: (...args: unknown[]) => { mocks.rpc(...args); return { maybeSingle: mocks.result }; } }) }));
import { loadFormGovernanceSnapshot } from "./snapshot";
const actor = { organizationId: ids.actor, branchId: ids.branch, scopes: ["forms.manage"], demo: false } as TenantContext;
function source(): FormGovernanceSnapshotSourceRow { return {
  organization_id: ids.actor, branch_id: ids.branch, generated_at: "2026-09-22T08:00:00Z",
  definitions: [{ id: ids.other, organization_id: ids.actor, form_key: "tenant.custom.review", name: "合成送審表單", category: "行政表單", is_official: false }],
  versions: [{ id: ids.version, form_definition_id: ids.other, version: 1, status: "draft", effective_from: "2026-09-23", effective_to: null, schema_field_count: 1, scoring_rule_count: 0, published_at: null, content_hash: null, draft_revision: 2, custom_builder_eligible: true }],
  publications: [{ id: ids.request, form_definition_id: ids.other, form_version_id: ids.version, status: "returned", requested_at: "2026-09-22T07:00:00Z", requested_by_current_user: true,
    approved_at: null, approved_by_current_user: false, branch_id: ids.branch, branch_name: "合成分支", base_revision: 1, previous_request_id: null, decision_reason: "請補充欄位說明", decided_at: "2026-09-22T07:30:00Z", decided_by_current_user: false }],
  definition_total: 1, version_total: 1, publication_total: 1, pending_total: 0, definitions_truncated: false, versions_truncated: false, publications_truncated: false,
}; }
describe("v2 publication governance snapshot", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.result.mockResolvedValue({ data: source(), error: null }); });
  it("loads only v2 scoped snapshot and projects returned reason + revision", async () => {
    const snapshot = await loadFormGovernanceSnapshot(actor);
    expect(mocks.rpc).toHaveBeenCalledWith("form_governance_snapshot_v2", { p_expected_organization_id: ids.actor, p_expected_branch_id: ids.branch });
    expect(snapshot.versions[0]).toMatchObject({ draftRevision: 2, publication: { status: "returned", decisionReason: "請補充欄位說明", baseRevision: 1 } });
    expect(snapshot.pendingTotal).toBe(0);
  });
  it.each(["branch_id", "base_revision", "previous_request_id", "decision_reason", "decided_at", "decided_by_current_user"] as const)("does not silently accept missing v2 %s", async key => {
    const data = source(); delete data.publications[0]![key]; mocks.result.mockResolvedValue({ data, error: null });
    await expect(loadFormGovernanceSnapshot(actor)).rejects.toThrow("FORM_GOVERNANCE_SNAPSHOT_UNAVAILABLE");
  });
  it("rejects missing revision, scope mismatch, or failed RPC without old version fallback", async () => {
    const data = source(); delete data.versions[0]!.draft_revision; mocks.result.mockResolvedValue({ data, error: null });
    await expect(loadFormGovernanceSnapshot(actor)).rejects.toThrow();
    mocks.result.mockResolvedValue({ data: { ...source(), organization_id: ids.other }, error: null }); await expect(loadFormGovernanceSnapshot(actor)).rejects.toThrow();
    mocks.result.mockResolvedValue({ data: null, error: { code: "missing" } }); await expect(loadFormGovernanceSnapshot(actor)).rejects.toThrow();
    expect(mocks.rpc.mock.calls.every(([name]) => name === "form_governance_snapshot_v2")).toBe(true);
  });
  it("requires explicit builder eligibility, never infers it from the namespace", async () => {
    const data = source(); delete data.versions[0]!.custom_builder_eligible; mocks.result.mockResolvedValue({ data, error: null });
    await expect(loadFormGovernanceSnapshot(actor)).rejects.toThrow();
    data.versions[0]!.custom_builder_eligible = false; mocks.result.mockResolvedValue({ data, error: null });
    expect((await loadFormGovernanceSnapshot(actor)).versions[0]!.customBuilderEligible).toBe(false);
  });
  it.each(["withdrawn", "returned"])("rejects %s without decision proof", status => {
    const data = source(); data.publications[0]!.status = status; data.publications[0]!.decision_reason = null;
    expect(() => projectFormGovernanceSnapshot({ definitionRows: data.definitions, versionRows: data.versions, publicationRows: data.publications,
      expectedOrganizationId: ids.actor, expectedBranchId: ids.branch, generatedAt: data.generated_at, today: "2026-09-22", demo: false })).toThrow();
  });
});
