// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  ClientFetchTimeoutError,
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "./client-fetch";

describe("fetchWithTimeout", () => {
  it("returns a completed response without changing its contract", async () => {
    const response = new Response("ok", { status: 201 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithTimeout("/api/test", { method: "POST" }, 100)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      method: "POST",
      signal: expect.any(AbortSignal),
    }));
  });

  it("classifies an elapsed deadline separately from an ordinary network error", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      })));

    const result = await fetchWithTimeout("/api/test", {}, 1).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ClientFetchTimeoutError);
    expect(isClientFetchTimeoutError(result)).toBe(true);

    const offline = new TypeError("offline");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(offline));
    await expect(fetchWithTimeout("/api/test", {}, 100)).rejects.toBe(offline);
    expect(isClientFetchTimeoutError(offline)).toBe(false);
  });

  it("rejects invalid timeout configuration before issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithTimeout("/api/test", {}, 0)).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
