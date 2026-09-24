import { describe, expect, it, vi } from "vitest";
import { cmsCommitSchema, emptyIntakeProfile, intakeMissingItems, intakeProfileSchema, isCalendarDate, profileMutationSchema, MAX_INTAKE_WEB_UPLOAD_BYTES } from "./model";
vi.mock("server-only", () => ({}));
import { readIntakeMultipart } from "./multipart";

const profile = { ...emptyIntakeProfile, displayName: "合成測試個案", clientCode: "TEST-001" };
describe("intake validation and missing data", () => {
  it("keeps missing, consent pending, and admission separate", () => { expect(intakeProfileSchema.parse(profile).consent.status).toBe("pending"); expect(intakeMissingItems(profile)).toEqual(["身分識別資料", "出生日期", "居住地址", "可聯繫的關係人", "告知同意確認"]); });
  it("rejects invalid dates, blank required values, invalid CMS level, unknown fields", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false); expect(isCalendarDate("2024-02-29")).toBe(true);
    for (const changes of [{ dateOfBirth: "2026-02-30" }, { displayName: " " }, { cmsLevel: 9 }, { sourceSystem: "central_cms" }]) expect(intakeProfileSchema.safeParse({ ...profile, ...changes }).success).toBe(false);
  });
  it("requires explicit dated consent and only one primary contact", () => {
    expect(intakeProfileSchema.safeParse({ ...profile, consent: { status: "confirmed", confirmedOn: null } }).success).toBe(false);
    const contact = { name: "合成關係人", relationship: "子女", phone: "", address: "", isPrimary: true, isEmergency: false };
    expect(intakeProfileSchema.safeParse({ ...profile, contacts: [contact, contact] }).success).toBe(false);
  });
  it("normalizes legacy empty contacts/notes but never makes up identity", () => {
    const result = intakeProfileSchema.parse({ ...profile, notes: null, contacts: [{ name: "合成關係人", isPrimary: true, isEmergency: false }] });
    expect(result.notes).toBe(""); expect(result.contacts[0]?.phone).toBe(""); expect(result.identityNumber).toBeNull();
  });
  it("does not accept browser tenant, parsed data, source status or imported flags", () => {
    expect(profileMutationSchema.safeParse({ action: "create", idempotency_key: crypto.randomUUID(), profile, organizationId: crypto.randomUUID() }).success).toBe(false);
    const body = { batchId: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), payloadSha256: "a".repeat(64), clientId: null, expectedVersion: 0, expectedClientVersion: 0, clientCode: "TEST-001", sourceReviewReason: null, decisions: [] };
    expect(cmsCommitSchema.safeParse({ ...body, parsedPayload: {} }).success).toBe(false);
    expect(cmsCommitSchema.safeParse({ ...body, decisions: [{ fieldId: "f", target: "displayName", choice: "use_source", value: "forged" }] }).success).toBe(false);
  });
});
describe("bounded HTML request", () => {
  it("reads one multipart without loading or executing HTML", async () => {
    const form = new FormData(); form.set("file", new File(["<h5>合成資料</h5>"], "synthetic.html", { type: "text/html" }));
    const data = await readIntakeMultipart(new Request("https://example.invalid", { method: "POST", body: form })); expect(data.get("file")).toBeInstanceOf(File);
  });
  it("rejects oversized headers and chunked bodies without trusting content length", async () => {
    await expect(readIntakeMultipart(new Request("https://example.invalid", { method: "POST", headers: { "content-length": String(MAX_INTAKE_WEB_UPLOAD_BYTES + 100000) }, body: "" }))).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    await expect(readIntakeMultipart(new Request("https://example.invalid", { method: "POST", body: new Uint8Array(MAX_INTAKE_WEB_UPLOAD_BYTES + 100000) }))).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
  it("rejects a malformed upload with a safe message", async () => { await expect(readIntakeMultipart(new Request("https://example.invalid", { method: "POST", body: "not multipart" }))).rejects.toMatchObject({ code: "INVALID_FILE" }); });
});
