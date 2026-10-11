import { describe, expect, it } from "vitest";
import { familyWorkspaceSchema, familyMutationSchema } from "./workspace-schema";
const client = "d1600000-0000-4000-8000-000000000001";
const snapshot = { clientId: client, scopes: ["care.read"], publications: [{ id: "d1900000-0000-4000-8000-000000000001", category: "care", title: "今日摘要", summary: "已完成上午活動", occurredAt: "2026-10-11T08:00:00+08:00", publishedAt: "2026-10-11T08:05:00+08:00", sourceId: "d1700000-0000-4000-8000-000000000001", bill: null }], messages: [], preferences: { version: 0, pushEnabled: false, categories: ["messages"], quietStart: "21:00", quietEnd: "08:00", contactPhone: null }, unreadCount: 0, updatedAt: "2026-10-11T08:05:00+08:00" };
describe("family publication category wire boundary", () => {
  it("accepts only explicit category-scoped institution publications", () => { expect(familyWorkspaceSchema.safeParse(snapshot).success).toBe(true); });
  it("rejects health publication without health-specific consent", () => { expect(familyWorkspaceSchema.safeParse({ ...snapshot, publications: [{ ...snapshot.publications[0], category: "health" }] }).success).toBe(false); });
  it("rejects message content when messages consent absent", () => { expect(familyWorkspaceSchema.safeParse({ ...snapshot, messages: [{ id: "d1900000-0000-4000-8000-000000000002", body: "hello", direction: "institution_to_family", at: snapshot.updatedAt, read: false }] }).success).toBe(false); });
  it("rejects arbitrary sensitive fields in family projection", () => { expect(familyWorkspaceSchema.safeParse({ ...snapshot, nationalId: "never expose" }).success).toBe(false); });
  it("rejects duplicate publication identifiers", () => { expect(familyWorkspaceSchema.safeParse({ ...snapshot, publications: [snapshot.publications[0], snapshot.publications[0]] }).success).toBe(false); });
  it("message does not accept caller-specified sender, relation or another recipient", () => { expect(familyMutationSchema.safeParse({ action: "message", clientId: client, body: "test", idempotency_key: "d1800000-0000-4000-8000-000000000001", recipientUserId: "d1900000-0000-4000-8000-000000000002" }).success).toBe(false); });
});
