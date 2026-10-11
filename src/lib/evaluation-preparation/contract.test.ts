import { describe, expect, it } from "vitest";
import { evaluationPreparationRequestSchema, evaluationPreparationSnapshotSchema } from "./contract";

const item = {
  itemCode: "WANHUA_01", expectedVersion: 0, ownerUserId: null, dueOn: null,
  evidenceReference: null, progress: "collecting", changeReason: "initial",
};

describe("Page 79 internal preparation contract", () => {
  it("accepts a bounded internal draft, but not an official score or free-text PHI", () => {
    expect(evaluationPreparationRequestSchema.safeParse(item).success).toBe(true);
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, clientName: "不應出現" }).success).toBe(false);
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, score: 100 }).success).toBe(false);
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, itemCode: "A/B" }).success).toBe(false);
  });
  it("requires all three fields before requesting internal review", () => {
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, progress: "internal_review_requested" }).success).toBe(false);
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, expectedVersion: 1,
      ownerUserId: "79000000-0000-4000-8000-000000000001", dueOn: "2026-12-31",
      evidenceReference: "79700000-0000-4000-8000-000000000001",
      progress: "internal_review_requested", changeReason: "progress_changed" }).success).toBe(true);
  });
  it("rejects bad dates, version reason mismatch and formal submission claims", () => {
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, dueOn: "2026-02-30" }).success).toBe(false);
    expect(evaluationPreparationRequestSchema.safeParse({ ...item, expectedVersion: 2 }).success).toBe(false);
    expect(evaluationPreparationSnapshotSchema.safeParse({
      organizationId: "79100000-0000-4000-8000-000000000001",
      branchId: "79200000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString(),
      staleAfter: new Date().toISOString(), page: 1, pageSize: 25, total: 0, items: [], owners: [],
      sourceStatus: "applicability_unapproved", formalSubmissionEnabled: true, demo: false,
    }).success).toBe(false);
  });
});
