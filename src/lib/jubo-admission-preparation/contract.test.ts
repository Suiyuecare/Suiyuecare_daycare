import { describe, expect, it } from "vitest";
import { admissionPreparationInputSchema, admissionPreparationReceiptSchema, admissionPreparationSnapshotSchema } from "./contract";

const clientId = "dca10000-0000-4000-8000-000000000001";
const proposal = { action: "propose", clientId, clientRowVersion: 1, admittedOn: "2026-10-11",
  eligibilityFrom: "2026-10-01", eligibilityTo: "2026-10-31", eligibilityReference: "SYNTHETIC-ELIGIBILITY",
  eligibilitySha256: "a".repeat(64), agreementReference: "SYNTHETIC-AGREEMENT", agreementSha256: "b".repeat(64), reason: "合成收案日期及資格契約均已核對" };
describe("admission preparation is not evidence activation", () => {
  it("accepts a specific admission date inside a declared eligibility period", () => {
    expect(admissionPreparationInputSchema.safeParse(proposal).success).toBe(true);
  });
  it.each([
    { admittedOn: "" }, { eligibilityReference: "short" }, { eligibilitySha256: "a".repeat(63) },
    { admittedOn: "2026-11-01" }, { reason: "不夠" }, { clientRowVersion: 0 },
    { organizationId: clientId }, { admissionEnabled: true }, { sourceVerified: true },
  ])("rejects missing or client-asserted authority %j", patch => {
    expect(admissionPreparationInputSchema.safeParse({ ...proposal, ...patch }).success).toBe(false);
  });
  it("identifies a missing field rather than a non-actionable union error", () => {
    const result = admissionPreparationInputSchema.safeParse({ ...proposal, admittedOn: "" });
    expect(result.success ? [] : result.error.issues[0].path).toEqual(["admittedOn"]);
  });
  it("cannot accept an activation receipt from the backend", () => {
    expect(admissionPreparationReceiptSchema.safeParse({ proposalId: clientId, proposalSha256: "a".repeat(64), version: 1,
      status: "awaiting_second_review", sourceVerified: true, admissionEnabled: true, replayed: false }).success).toBe(false);
  });
  it("rejects an active-admission projection even with otherwise valid client identifiers", () => {
    expect(admissionPreparationSnapshotSchema.safeParse({ clientId, clientRowVersion: 1, intakeVersion: 1,
      sourceKind: "operator_master", sourceStatus: "服務中", canSubmit: true, admissionEnabled: true,
      sourceVerified: false, proposals: [] }).success).toBe(false);
  });
});
