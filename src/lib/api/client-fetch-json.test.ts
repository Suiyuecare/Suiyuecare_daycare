import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLIENT_WRITE_TIMEOUT_MS, ClientJsonReadError, fetchJsonWithTimeout } from "./client-fetch";

const marker = "SYNTHETIC_PRIVATE_PROVIDER_CONTENT";
const now = Date.parse("2026-09-27T03:00:00.000Z");

describe("independently bounded private JSON GET", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(Response.json({ data: "synthetic" }));
  });
  afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("returns the original 200 response and unknown decoded payload exactly once", async () => {
    const response = Response.json({ data: [1, true, null], status: "ok" }); fetchMock.mockResolvedValue(response);
    const result = await fetchJsonWithTimeout("/api/read");
    expect(result.response).toBe(response); expect(result.payload).toEqual({ data: [1, true, null], status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/read", expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" }));
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false); await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS + 1); expect(signal.aborted).toBe(false);
  });
  it("forces read-only transport policy without dropping allowed caller headers", async () => {
    await fetchJsonWithTimeout(new URL("https://example.invalid/api/read"), { method: "get", cache: "force-cache",
      credentials: "include", redirect: "follow", headers: { accept: "application/json", "x-request-marker": "synthetic" } });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: { accept: "application/json", "x-request-marker": "synthetic" } });
    expect(fetchMock.mock.calls[0]![1].body).toBeUndefined();
  });
  it.each(["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS", " GET "])("rejects %s before any fetch or timer", async (method) => {
    await expect(fetchJsonWithTimeout("/api/read", { method })).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    expect(fetchMock).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["", "synthetic", new Uint8Array([1])])("rejects any GET body before sending", async (body) => {
    await expect(fetchJsonWithTimeout("/api/read", { body })).rejects.toMatchObject({ code: "UNAVAILABLE" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a POST Request even if init tries to disguise it as GET", async () => {
    const input = new Request("https://example.invalid/api/read", { method: "POST", body: "synthetic" });
    await expect(fetchJsonWithTimeout(input, { method: "GET" })).rejects.toMatchObject({ code: "UNAVAILABLE" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts a native GET Request and preserves its input object", async () => {
    const input = new Request("https://example.invalid/api/read"); await fetchJsonWithTimeout(input);
    expect(fetchMock.mock.calls[0]![0]).toBe(input); expect(fetchMock.mock.calls[0]![1].method).toBe("GET");
  });
  it("rejects nonnative Request-like objects instead of allowing a concealed write", async () => {
    await expect(fetchJsonWithTimeout({ method: "POST", body: null } as unknown as Request)).rejects.toMatchObject({ code: "UNAVAILABLE" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([201, 204, 301, 302, 400, 401, 403, 404, 409, 429, 500, 503])("preserves HTTP %s status without decoding provider error bodies", async (status) => {
    const json = vi.fn(() => { throw new Error(marker); }); fetchMock.mockResolvedValue({ status, redirected: false, json });
    const error = await fetchJsonWithTimeout("/api/read").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ClientJsonReadError); expect(error).toMatchObject({ code: "UNAVAILABLE", status });
    expect(json).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(error)).not.toContain(marker); expect(Object.keys(error as object)).not.toContain("payload");
  });
  it("rejects redirected successful responses without decoding their body", async () => {
    const json = vi.fn(); fetchMock.mockResolvedValue({ status: 200, redirected: true, json });
    await expect(fetchJsonWithTimeout("/api/read")).rejects.toMatchObject({ code: "UNAVAILABLE", status: 200 }); expect(json).not.toHaveBeenCalled();
  });
  it.each(["sync", "async"])("maps %s JSON errors to a fixed 200 invalid-response error", async (mode) => {
    const json = mode === "sync" ? () => { throw new SyntaxError(marker); } : () => Promise.reject(new SyntaxError(marker));
    fetchMock.mockResolvedValue({ status: 200, redirected: false, json });
    const error = await fetchJsonWithTimeout("/api/read").catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", status: 200 }); expect(String(error)).not.toContain(marker);
    expect((error as Error).cause).toBeUndefined(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["sync", "async"])("maps %s transport failure without echoing its message or retrying", async (mode) => {
    if (mode === "sync") fetchMock.mockImplementation(() => { throw new Error(marker); }); else fetchMock.mockRejectedValue(new Error(marker));
    const error = await fetchJsonWithTimeout("/api/read").catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "UNAVAILABLE", status: null }); expect(String(error)).not.toContain(marker);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["fetch", "body"])("independently stops uncooperative %s at exactly 20 seconds, including late success", async (phase) => {
    let release!: (value: unknown) => void;
    const stalled = new Promise((resolve) => { release = resolve; });
    if (phase === "fetch") fetchMock.mockReturnValue(stalled); else fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => stalled });
    const outputs: unknown[] = [];
    const pending = fetchJsonWithTimeout("/api/read").then((value) => outputs.push(value), (error) => { outputs.push(error); throw error; });
    const asserted = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    await vi.advanceTimersByTimeAsync(19_999); expect(outputs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await asserted;
    expect(outputs).toHaveLength(1); expect((fetchMock.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
    release(phase === "fetch" ? Response.json({ data: "late" }) : { data: "late" }); await vi.advanceTimersByTimeAsync(1);
    expect(outputs).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["fetch", "body"])("handles late rejected %s without an unhandled rejection or second output", async (phase) => {
    let rejectProvider!: (error: Error) => void;
    const stalled = new Promise((_, reject) => { rejectProvider = reject; }), unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      if (phase === "fetch") fetchMock.mockReturnValue(stalled); else fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => stalled });
      const outcomes: unknown[] = [], pending = fetchJsonWithTimeout("/api/read").catch((error: unknown) => { outcomes.push(error); return error; });
      await vi.advanceTimersByTimeAsync(20_000); await pending;
      rejectProvider(new Error(marker)); await vi.advanceTimersByTimeAsync(1);
      expect(outcomes).toHaveLength(1); expect(unhandled).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { process.removeListener("unhandledRejection", unhandled); }
  });
  it("uses one total deadline rather than restarting it after headers arrive", async () => {
    let headers!: (response: unknown) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { headers = resolve; }));
    const outputs: unknown[] = [], pending = fetchJsonWithTimeout("/api/read").catch((error: unknown) => { outputs.push(error); return error; });
    await vi.advanceTimersByTimeAsync(14_000); headers({ status: 200, redirected: false, json: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(5_999); expect(outputs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ code: "UNAVAILABLE" }); expect(outputs).toHaveLength(1);
  });
  it.each(["fetch", "body"])("honors consumer cancellation during uncooperative %s immediately", async (phase) => {
    const owner = new AbortController(), stalled = new Promise(() => {});
    if (phase === "fetch") fetchMock.mockReturnValue(stalled); else fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => stalled });
    const pending = fetchJsonWithTimeout("/api/read", { signal: owner.signal });
    const asserted = expect(pending).rejects.toMatchObject({ code: "ABORTED", status: null });
    await vi.advanceTimersByTimeAsync(0); owner.abort(); await asserted;
    expect((fetchMock.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not start a request for an already-aborted owner", async () => {
    const owner = new AbortController(); owner.abort();
    await expect(fetchJsonWithTimeout("/api/read", { signal: owner.signal })).rejects.toMatchObject({ code: "ABORTED" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("honors native Request cancellation when init does not override its signal", async () => {
    const owner = new AbortController(), input = new Request("https://example.invalid/api/read", { signal: owner.signal });
    fetchMock.mockReturnValue(new Promise(() => {}));
    const pending = fetchJsonWithTimeout(input), asserted = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    owner.abort(); await asserted; expect((fetchMock.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
  });
  it("cleans up its caller listener after success so later caller abort cannot alter the completed signal", async () => {
    const owner = new AbortController(), add = vi.spyOn(owner.signal, "addEventListener"), remove = vi.spyOn(owner.signal, "removeEventListener");
    await fetchJsonWithTimeout("/api/read", { signal: owner.signal });
    const owned = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    owner.abort(); await vi.advanceTimersByTimeAsync(20_001); expect(owned.aborted).toBe(false);
  });
  it("has no write, storage, logging, provider error text or automatic retry action", () => {
    const code = readFileSync(new URL("./client-fetch.ts", import.meta.url), "utf8").split("export type ClientJsonReadErrorCode")[1]!;
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|\.message|method:\s*["'](?:POST|PATCH|PUT|DELETE)/u);
  });
});
