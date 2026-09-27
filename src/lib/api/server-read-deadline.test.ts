import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SERVER_WORKSPACE_READ_TIMEOUT_MS, withServerReadDeadline } from "./server-read-deadline";
afterEach(() => vi.useRealTimers());

it("returns the read unchanged and disposes its timer and signal", async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  const value = { count: 3 };
  await expect(withServerReadDeadline(async (readSignal) => { signal = readSignal; return value; })).resolves.toBe(value);
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it("rejects a stuck non-cooperative read within the single workspace budget", async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  const result = withServerReadDeadline(async (readSignal) => { signal = readSignal; return await new Promise(() => {}); });
  const assertion = expect(result).rejects.toThrow("SERVER_WORKSPACE_READ_UNAVAILABLE");
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it("cleans up an immediately rejected provider read", async () => {
  vi.useFakeTimers(); const error = new Error("original");
  await expect(withServerReadDeadline(async () => { throw error; })).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});
it("ignores a late value without starting an automatic retry", async () => {
  vi.useFakeTimers(); let resolve!: (value: string) => void;
  const operation = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
  const result = withServerReadDeadline(operation);
  const assertion = expect(result).rejects.toThrow("SERVER_WORKSPACE_READ_UNAVAILABLE");
  await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
  resolve("late"); await vi.advanceTimersByTimeAsync(0);
  expect(operation).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
