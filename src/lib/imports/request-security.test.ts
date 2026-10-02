import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const origin = "https://daycare.example.test";
const bodyMetadata: Record<string, string>[] = [{ "content-length": "1" }, { "content-length": "00" }, { "transfer-encoding": "chunked" }];
const optionalLength: Record<string, string>[] = [{}, { "content-length": "1" }];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test" } }));

import { readBoundedImportBody, requireImportRead, requireImportWrite } from "./request-security";

function streamed(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(`${origin}/api/imports/html`, { method: "POST", body: stream, headers, signal, duplex: "half" } as RequestInit);
}

describe("private import request admission", () => {
  it("allows exact bodyless read filters and returns their original values", () => {
    const query = requireImportRead(new Request(`${origin}/api/client-intake/imports?batch=one&client=two`), ["batch", "client"]);
    expect([...query]).toEqual([["batch", "one"], ["client", "two"]]);
  });
  it.each(["unknown=x", "batch=one&batch=two", "batch=one&batch=one"])("does not discard ambiguous read input %s", query => {
    expect(() => requireImportRead(new Request(`${origin}/api/client-intake/imports?${query}`), ["batch"]))
      .toThrow(expect.objectContaining({ code: "INVALID_IMPORT_QUERY", httpStatus: 400 }));
  });
  it.each(bodyMetadata)("rejects unsupported body metadata %j", headers => {
    expect(() => requireImportRead(new Request(origin, { headers }), []))
      .toThrow(expect.objectContaining({ code: "INVALID_IMPORT_QUERY" }));
  });
  it("checks actual read method and body", () => {
    const request = new Request(origin, { method: "POST", body: "secret" });
    expect(() => requireImportRead(request, [])).toThrow(expect.objectContaining({ code: "INVALID_IMPORT_QUERY" }));
    expect(request.bodyUsed).toBe(false);
  });
  it("keeps the actual configured-origin JSON guard and rejects write query scope", () => {
    const request = new Request(`${origin}/api/imports/html?branch=forged`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
    expect(() => requireImportWrite(request, "json")).toThrow(expect.objectContaining({ code: "INVALID_IMPORT_QUERY" }));
    expect(request.bodyUsed).toBe(false);
  });
});

describe("bounded owned import body bytes", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("collects a complete streamed body with no Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close(); } });
    expect([...await readBoundedImportBody(streamed(stream), 3)]).toEqual([1, 2, 3]);
  });
  it("copies each chunk before accepting another asynchronous read", async () => {
    const bytes = new Uint8Array([1, 2]); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; value.enqueue(bytes); } });
    const pending = readBoundedImportBody(streamed(stream), 4);
    await new Promise(resolve => setTimeout(resolve, 0));
    bytes.fill(9); controller.enqueue(new Uint8Array([3, 4])); controller.close();
    expect([...await pending]).toEqual([1, 2, 3, 4]);
  });
  it("bounds owned allocation count for seventy thousand one-byte fragments", async () => {
    let sent = 0; const concat = vi.spyOn(Buffer, "concat");
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (sent === 70000) controller.close(); else { controller.enqueue(new Uint8Array([sent++ % 256])); } } }, { highWaterMark: 0 });
    const value = await readBoundedImportBody(streamed(stream), 70000);
    expect(value).toHaveLength(70000); expect(value[65536]).toBe(0); expect(value[69999]).toBe(69999 % 256);
    expect(concat).toHaveBeenCalledExactlyOnceWith(expect.any(Array), 70000);
    expect(concat.mock.calls[0][0]).toHaveLength(2);
  });
  it("checks monotonic time between reads even when microtasks defer timers", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10001);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(0)); }, cancel });
    await expect(readBoundedImportBody(streamed(stream), 4)).rejects.toMatchObject({ code: "IMPORT_BODY_UNCONFIRMED", httpStatus: 503 });
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it.each(optionalLength)("counts actual bytes even when length is absent or forged %j", async headers => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel });
    await expect(readBoundedImportBody(streamed(stream, headers), 4)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", httpStatus: 413 });
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it.each(["-1", "nope", "9999999999999", "5"])("rejects invalid/over-limit advertised size %s without consuming bytes", async length => {
    const request = new Request(origin, { method: "POST", headers: { "content-length": length }, body: "data" });
    await expect(readBoundedImportBody(request, 4)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", httpStatus: 413 });
    expect(request.bodyUsed).toBe(false);
  });
  it("rejects a bodyless operation", async () => {
    await expect(readBoundedImportBody(new Request(origin, { method: "POST" }), 4)).rejects.toMatchObject({ code: "INVALID_IMPORT_BODY", httpStatus: 400 });
  });
  it("rejects an already consumed or locked body without a native exception", async () => {
    const consumed = new Request(origin, { method: "POST", body: "{}" }); await consumed.text();
    await expect(readBoundedImportBody(consumed, 4)).rejects.toMatchObject({ code: "INVALID_IMPORT_BODY", httpStatus: 400 });
    const locked = new Request(origin, { method: "POST", body: "{}" }); const reader = locked.body!.getReader();
    await expect(readBoundedImportBody(locked, 4)).rejects.toMatchObject({ code: "INVALID_IMPORT_BODY", httpStatus: 400 });
    reader.releaseLock();
  });
  it("does not disclose underlying stream failure", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("SYNTHETIC_SECRET")); } });
    await expect(readBoundedImportBody(streamed(stream), 4)).rejects.toMatchObject({ code: "IMPORT_BODY_UNCONFIRMED", httpStatus: 503 });
    expect(stream.locked).toBe(false);
  });
  it("cancels an already aborted body and never reports completion", async () => {
    const signal = new AbortController(); signal.abort(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); }, cancel });
    await expect(readBoundedImportBody(streamed(stream, {}, signal.signal), 4)).rejects.toMatchObject({ code: "IMPORT_BODY_UNCONFIRMED", httpStatus: 503 });
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it("cancels a pending read on abort and removes the listener", async () => {
    const signal = new AbortController(); const cancel = vi.fn();
    const request = streamed(new ReadableStream<Uint8Array>({ cancel }), {}, signal.signal);
    const remove = vi.spyOn(request.signal, "removeEventListener");
    const pending = readBoundedImportBody(request, 4); const rejected = expect(pending).rejects.toMatchObject({ code: "IMPORT_BODY_UNCONFIRMED" });
    signal.abort(); await rejected;
    expect(cancel).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("bounds an unresponsive read at ten seconds with no late completion", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
    const pending = readBoundedImportBody(streamed(stream), 4);
    const rejected = expect(pending).rejects.toMatchObject({ code: "IMPORT_BODY_UNCONFIRMED", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(9999); expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await rejected;
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(() => controller.enqueue(new Uint8Array([1]))).toThrow();
  });
  it("cleans the deadline after success", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); }, cancel });
    expect(await readBoundedImportBody(streamed(stream), 4)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(cancel).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(stream.locked).toBe(false);
  });
  it("does not await an uncooperative overflow cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel });
    await expect(readBoundedImportBody(streamed(stream), 4)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", httpStatus: 413 });
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
});
