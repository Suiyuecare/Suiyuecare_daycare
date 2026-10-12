import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { admissionPreparationSnapshotSchema, type AdmissionPreparationSnapshot } from "./contract";
import { admissionPreparationWorkspaceKey } from "./workspace-key";

const context = { organizationId: "org-synthetic", branchId: "branch-synthetic", userId: "user-synthetic",
  scopes: ["admission.read", "admission.create"] };
function proposal(version: number): AdmissionPreparationSnapshot["proposals"][number] {
  return { id: `00000000-0000-4000-8000-${version.toString().padStart(12, "0")}`, version,
    sha256: version.toString(16).padStart(64, "0"), clientRowVersion: 1,
    admittedOn: "2026-10-12", eligibilityFrom: "2026-10-01", eligibilityTo: "2026-12-31",
    eligibilityReference: "SYNTHETIC-ELIGIBILITY-ONLY", eligibilitySha256: "a".repeat(64),
    agreementReference: "SYNTHETIC-AGREEMENT-ONLY", agreementSha256: "b".repeat(64),
    reason: "Synthetic review reference only", proposedAt: "2026-10-12T00:00:00Z",
    ownProposal: true, reviewDecision: null, reviewReason: null, canReview: false };
}
function snapshot(first = 1): AdmissionPreparationSnapshot {
  return admissionPreparationSnapshotSchema.parse({ clientId: "00000000-0000-4000-8000-000000000100",
    clientRowVersion: 1, intakeVersion: 1, sourceKind: "operator_master", sourceStatus: "服務中",
    canSubmit: true, admissionEnabled: false, sourceVerified: false,
    proposals: Array.from({ length: 20 }, (_, index) => proposal(first + index)) });
}

describe("admission preparation workspace revision", () => {
  it("is stable for the same snapshot and scope ordering", () => {
    expect(admissionPreparationWorkspaceKey(context, snapshot())).toBe(admissionPreparationWorkspaceKey(
      { ...context, scopes: [...context.scopes].reverse() }, structuredClone(snapshot()),
    ));
  });
  it("changes when proposal 21 replaces the oldest item at the 20-item cap", () => {
    const before = snapshot(1); const after = snapshot(2);
    expect(before.proposals).toHaveLength(20); expect(after.proposals).toHaveLength(20);
    expect(after.proposals.map(item => item.reviewDecision)).toEqual(before.proposals.map(item => item.reviewDecision));
    expect(admissionPreparationWorkspaceKey(context, after)).not.toBe(admissionPreparationWorkspaceKey(context, before));
  });
  it.each(["id", "version", "sha256", "reviewDecision", "reviewReason", "canReview"] as const)(
    "includes proposal %s rather than just length and decisions", field => {
      const before = snapshot(); const after = structuredClone(before);
      const item = after.proposals[0];
      switch (field) {
        case "id": item.id = proposal(90).id; break;
        case "version": item.version++; break;
        case "sha256": item.sha256 = "c".repeat(64); break;
        case "reviewDecision": item.reviewDecision = "held"; break;
        case "reviewReason": item.reviewReason = "Synthetic supervisor review only"; break;
        case "canReview": item.canReview = true; item.ownProposal = false; break;
      }
      expect(admissionPreparationWorkspaceKey(context, after)).not.toBe(admissionPreparationWorkspaceKey(context, before));
    },
  );
  it("changes with intake version and revoked submission eligibility", () => {
    const before = snapshot();
    expect(admissionPreparationWorkspaceKey(context, { ...before, intakeVersion: 2 })).not.toBe(admissionPreparationWorkspaceKey(context, before));
    expect(admissionPreparationWorkspaceKey(context, { ...before, canSubmit: false })).not.toBe(admissionPreparationWorkspaceKey(context, before));
  });
  it.each(["organizationId", "branchId", "userId", "scopes"] as const)("is isolated by %s", field => {
    const changed = { ...context, [field]: field === "scopes" ? ["admission.read"] : "another-synthetic-scope" };
    expect(admissionPreparationWorkspaceKey(changed, snapshot())).not.toBe(admissionPreparationWorkspaceKey(context, snapshot()));
  });
  it("never embeds document references or review text in its key", () => {
    const key = admissionPreparationWorkspaceKey(context, snapshot());
    expect(key).toMatch(/^jubo-admission:[a-f0-9]{64}$/u);
    expect(key).not.toContain("SYNTHETIC"); expect(key).not.toContain("review reference");
  });
});
