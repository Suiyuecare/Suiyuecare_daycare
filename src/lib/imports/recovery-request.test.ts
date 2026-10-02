import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_ORIGIN: "https://example.invalid", NODE_ENV: "test" } }));
import { readUploadRecoveryKey, readUploadRecoveryRequest } from "./recovery-request";
const reservation = "10000000-0000-4000-8000-000000000001";
const original = "20000000-0000-4000-8000-000000000001";
const key = "30000000-0000-4000-8000-000000000001";
function request(change?: (form: FormData) => void, headers: Record<string,string> = {}) {
  const form = new FormData();
  form.set("file", new File(["<!doctype html><html><body>合成續做測試</body></html>"], "synthetic.html", { type: "text/html" }));
  form.set("reservation_id", reservation); form.set("original_operation_key", original); form.set("idempotency_key", key); change?.(form);
  return new Request("https://example.invalid/api/client-intake/imports/recovery", { method: "POST", body: form,
    headers: { origin: "https://example.invalid", "idempotency-key": key, ...headers } });
}
describe("explicit upload recovery admission", () => {
  it.each(["general", "routine-intake"] as const)("owns exact original bytes and identifiers for %s", async mode => {
    expect(await readUploadRecoveryRequest(request(), mode)).toMatchObject({ file: { fileName: "synthetic.html", mimeType: "text/html" },
      options: { reservationId: reservation, originalOperationKey: original, recoveryOperationKey: key } });
  });
  it("permits original bounded general raw key, not arbitrary routine key", async () => {
    const change = (form: FormData) => form.set("original_operation_key", "general-original-operation");
    expect((await readUploadRecoveryRequest(request(change), "general")).options.originalOperationKey).toBe("general-original-operation");
    await expect(readUploadRecoveryRequest(request(change), "routine-intake")).rejects.toMatchObject({ httpStatus: 400 });
  });
  it.each(["file", "reservation_id", "original_operation_key", "idempotency_key"])("rejects duplicate %s", async field => {
    await expect(readUploadRecoveryRequest(request(form => form.append(field, "synthetic")), "general")).rejects.toMatchObject({ httpStatus: 400 });
  });
  it.each(["mode", "parsed_payload", "archive_reference", "session_id", "actor_user_id"])("rejects caller supplied %s", async field => {
    await expect(readUploadRecoveryRequest(request(form => form.set(field, "synthetic")), "general")).rejects.toMatchObject({ httpStatus: 400 });
  });
  it.each(["reservation_id", "idempotency_key"])("rejects invalid %s", async field => {
    await expect(readUploadRecoveryRequest(request(form => form.set(field, "synthetic")), "general")).rejects.toMatchObject({ httpStatus: 400 });
  });
  it("rejects recovery header/body disagreement", async () => {
    await expect(readUploadRecoveryRequest(request(undefined, { "idempotency-key": original }), "general")).rejects.toMatchObject({ httpStatus: 400 });
  });
  it("denies cross origin before consuming source", async () => {
    const value = request(undefined, { origin: "https://other.invalid" });
    await expect(readUploadRecoveryRequest(value, "general")).rejects.toMatchObject({ httpStatus: 403 }); expect(value.bodyUsed).toBe(false);
  });
  it("does not reflect malicious declared charset", async () => {
    const value = request(form => form.set("file", new File(['<!doctype html><meta charset="SECRET_SOURCE">'], "synthetic.html", { type: "text/html" })));
    await expect(readUploadRecoveryRequest(value, "general")).rejects.toMatchObject({ code: "IMPORT_RECOVERY_INVALID_FILE", httpStatus: 422,
      message: "原檔的格式、編碼或內容未通過檢查，請保留原檔並重新核對。" });
  });
  it("keeps routine file cap even when general cap would allow it", async () => {
    const value = request(form => form.set("file", new File(["<!doctype html>", "x".repeat(4 * 1024 * 1024)], "synthetic.html", { type: "text/html" })));
    await expect(readUploadRecoveryRequest(value, "routine-intake")).rejects.toMatchObject({ httpStatus: 413 });
  });
  it("reads exact UUID key without body or unsupported filters", () => {
    expect(readUploadRecoveryKey(new Request(`https://example.invalid/api/imports/recovery?key=${key}`))).toBe(key);
    for (const query of ["", `key=${key}&key=${key}`, `key=${key}&mode=routine-intake`, "key=invalid"])
      expect(() => readUploadRecoveryKey(new Request(`https://example.invalid/api/imports/recovery?${query}`))).toThrow();
  });
});
