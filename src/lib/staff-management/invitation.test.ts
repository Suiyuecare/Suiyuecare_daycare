import { describe, expect, it } from "vitest";
import { staffInvitationInput, staffInvitationList, staffInvitationReceipt } from "./invitation";

const id = "59000000-0000-4000-8000-000000000001";
describe("governed staff invitation contract", () => {
  it("normalizes email and name without accepting caller scope or approval", () => {
    expect(staffInvitationInput.parse({ action: "propose", email: "Director@Suiyuecare.com", displayName: " 合成主任 ", roleId: id }))
      .toEqual({ action: "propose", email: "director@suiyuecare.com", displayName: "合成主任", roleId: id });
    expect(staffInvitationInput.safeParse({ action: "propose", email: "staff@example.invalid", displayName: "合成", roleId: id, organizationId: id }).success).toBe(false);
  });
  it.each(["", "not-an-email", "a@", "a\n@example.invalid"])("rejects invalid email %s", (email) => {
    expect(staffInvitationInput.safeParse({ action: "propose", email, displayName: "合成", roleId: id }).success).toBe(false);
  });
  it("requires explicit action, identity, and human-readable name", () => {
    for (const input of [{ action: "approve" }, { action: "approve", invitationId: id, roleId: id },
      { action: "propose", email: "staff@example.invalid", displayName: "\u0000", roleId: id }])
      expect(staffInvitationInput.safeParse(input).success).toBe(false);
  });
  it("does not accept an unverified activation or malformed receipt", () => {
    expect(staffInvitationReceipt.safeParse({ id, status: "activated", expires_at: new Date().toISOString(), replayed: false }).success).toBe(false);
    expect(staffInvitationReceipt.safeParse({ id, status: "approved", expires_at: "tomorrow", replayed: false }).success).toBe(false);
    expect(staffInvitationList.safeParse([{ id, allowed_email: "staff@example.invalid" }]).success).toBe(false);
  });
});
