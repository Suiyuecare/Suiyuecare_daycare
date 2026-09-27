import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { withCareRequestDeadline } from "./request-deadline";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
}

describe("daily-care full operation deadline", () => {
  it("runs exactly once, returns the same value and clears the timer", async () => {
    vi.useFakeTimers();
    const value = { saved: true }; let signal!: AbortSignal;
    const work = vi.fn(async (owned: AbortSignal) => { signal = owned; return value; });
    expect(await withCareRequestDeadline(work)).toBe(value);
    expect(work).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000); expect(signal.aborted).toBe(false);
  });
  it("retains the original error and clears the timer on fast rejection", async () => {
    vi.useFakeTimers(); const original = new Error("Known field rejection");
    await expect(withCareRequestDeadline(async () => { throw original; })).rejects.toBe(original);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a non-cooperative fetch without retrying or claiming rollback", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    const work = vi.fn((owned: AbortSignal) => { signal = owned; return new Promise<never>(() => {}); });
    const result = withCareRequestDeadline(work).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_001);
    const error = await result;
    expect(error).toBeInstanceOf(ClientFetchTimeoutError); expect(error.message).toContain("結果未知");
    expect(signal.aborted).toBe(true); expect(work).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("uses one budget for headers and slow JSON decoding and rejects late decoded content", async () => {
    vi.useFakeTimers(); const headers = deferred<void>(); const decoded = deferred<{ persisted: true }>();
    let signal!: AbortSignal; const decodedCommit = vi.fn();
    const result = withCareRequestDeadline(async owned => {
      signal = owned; await headers.promise; owned.throwIfAborted();
      const payload = await decoded.promise; owned.throwIfAborted(); decodedCommit(payload); return payload;
    }).catch(error => error);
    await vi.advanceTimersByTimeAsync(12_000); headers.resolve(); await vi.advanceTimersByTimeAsync(7_999);
    expect(signal.aborted).toBe(false); await vi.advanceTimersByTimeAsync(2);
    expect(await result).toBeInstanceOf(ClientFetchTimeoutError);
    decoded.resolve({ persisted: true }); await vi.advanceTimersByTimeAsync(0);
    expect(decodedCommit).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("also bounds a structured-rejection body that never decodes", async () => {
    vi.useFakeTimers(); const rejectionCloneDecode = deferred<void>();
    const result = withCareRequestDeadline(async owned => {
      await rejectionCloneDecode.promise; owned.throwIfAborted(); return "known rejection";
    }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_001); expect(await result).toBeInstanceOf(ClientFetchTimeoutError);
    rejectionCloneDecode.resolve(); await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start work for an already cancelled owner", async () => {
    vi.useFakeTimers(); const owner = new AbortController(); owner.abort(); const work = vi.fn();
    await expect(withCareRequestDeadline(work, { signal: owner.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(work).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels before the first microtask without invoking work", async () => {
    vi.useFakeTimers(); const owner = new AbortController(); const work = vi.fn();
    const result = withCareRequestDeadline(work, { signal: owner.signal }).catch(error => error);
    owner.abort(); expect(await result).toHaveProperty("name", "AbortError"); expect(work).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels pending decode and removes the owner listener without exposing owner reasons", async () => {
    vi.useFakeTimers(); const owner = new AbortController(); const pending = deferred<void>(); let signal!: AbortSignal;
    const remove = vi.spyOn(owner.signal, "removeEventListener");
    const result = withCareRequestDeadline(async owned => { signal = owned; await pending.promise; return "late"; }, { signal: owner.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); owner.abort(new Error("Never disclose owner payload"));
    const error = await result; expect(error.name).toBe("AbortError"); expect(error.message).not.toContain("payload");
    expect(signal.aborted).toBe(true); expect(remove).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    pending.resolve(); await vi.advanceTimersByTimeAsync(0);
  });
  it("supports an explicit read-only timeout without claiming an unknown write", async () => {
    vi.useFakeTimers(); const result = withCareRequestDeadline(() => new Promise<never>(() => {}), { timeoutMs: 100, readOnly: true }).catch(error => error);
    await vi.advanceTimersByTimeAsync(101); const error = await result;
    expect(error.message).toContain("讀取逾時"); expect(error.message).not.toContain("操作結果未知");
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, Infinity, NaN])("rejects invalid budget %s before work starts", async timeoutMs => {
    const work = vi.fn(); await expect(withCareRequestDeadline(work, { timeoutMs })).rejects.toBeInstanceOf(RangeError);
    expect(work).not.toHaveBeenCalled();
  });
});
