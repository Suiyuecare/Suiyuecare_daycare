import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { documentDeadline, readBoundedDocumentBody, readBoundedDocumentJson } from "./request";
afterEach(() => vi.useRealTimers());
const url = "https://synthetic.invalid/api/staff-certificate-documents";
describe("staff-document bounded bodies and stage deadlines", () => {
  it("accepts exact bounded UTF8 content and JSON", async () => {
    expect(new TextDecoder().decode(await readBoundedDocumentBody(new Request(url, { method: "POST", body: "原件" }), 6))).toBe("原件");
    expect(await readBoundedDocumentJson(new Request(url, { method: "PATCH", body: '{"a":1}' }))).toEqual({ a: 1 });
  });
  it.each(["-1", "10x", "NaN", "10000000000000", "7"])("rejects invalid or excessive content-length %s before body read", async length => {
    const request = new Request(url, { method: "POST", headers: { "content-length": length }, body: "x" });
    await expect(readBoundedDocumentBody(request, 6)).rejects.toMatchObject({ httpStatus: 413 }); expect(request.bodyUsed).toBe(false);
  });
  it("enforces stream bytes even without length header and cancels excess", async () => {
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(7)); }, cancel });
    await expect(readBoundedDocumentBody(new Request(url, { method: "POST", body, duplex: "half" } as RequestInit), 6)).rejects.toMatchObject({ httpStatus: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels a trickling/hung reader at10s, no indefinite formData wait", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(1)); }, cancel });
    const pending = readBoundedDocumentBody(new Request(url, { method: "POST", body, duplex: "half" } as RequestInit), 6);
    const assertion = expect(pending).rejects.toMatchObject({ httpStatus: 503, code: "STAFF_DOCUMENT_RESULT_UNCERTAIN" });
    await vi.advanceTimersByTimeAsync(10001); await assertion; expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("rejects missing body, malformed JSON and invalid UTF8 without reflecting content", async () => {
    await expect(readBoundedDocumentBody(new Request(url, { method: "POST" }), 6)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(readBoundedDocumentJson(new Request(url, { method: "POST", body: "secret-not-json" }))).rejects.toMatchObject({ httpStatus: 400 });
    await expect(readBoundedDocumentJson(new Request(url, { method: "POST", body: new Uint8Array([255]) }))).rejects.toMatchObject({ httpStatus: 400 });
  });
  it("clears a resolved/rejected stage's deadline", async () => {
    vi.useFakeTimers(); expect(await documentDeadline(Promise.resolve(1))).toBe(1); expect(vi.getTimerCount()).toBe(0);
    await expect(documentDeadline(Promise.reject(new Error("adapter")))).rejects.toThrow("adapter"); expect(vi.getTimerCount()).toBe(0);
  });
});
