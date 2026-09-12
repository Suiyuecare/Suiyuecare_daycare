import { afterEach, describe, expect, it, vi } from "vitest";
import { runLogoutTasks } from "./logout-tasks";
afterEach(() => vi.useRealTimers());
describe("independent logout cleanup", () => {
  it("still clears branch and revokes login when cache cleanup fails", async () => {
    const clearBranch = vi.fn().mockResolvedValue(true); const signOut = vi.fn().mockResolvedValue(true);
    expect(await runLogoutTasks({ clearCache: async () => { throw new Error("blocked"); }, clearBranch, signOut }))
      .toEqual({ cacheCleared: false, branchCleared: true, signedOut: true });
    expect(clearBranch).toHaveBeenCalledOnce(); expect(signOut).toHaveBeenCalledOnce();
  });
  it("starts sign-out without waiting for blocked IndexedDB, and bounds uncertain cleanup", async () => {
    vi.useFakeTimers(); const signOut = vi.fn().mockResolvedValue(true);
    const result = runLogoutTasks({ clearCache: () => new Promise(() => undefined), clearBranch: async () => true, signOut }, 1000);
    await Promise.resolve(); expect(signOut).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ cacheCleared: false, branchCleared: true, signedOut: true });
  });
  it("does not mistake unconfirmed or failed sign-out for completion", async () => {
    expect(await runLogoutTasks({ clearCache: async () => true, clearBranch: async () => false, signOut: async () => { throw new Error("private token details"); } }))
      .toEqual({ cacheCleared: true, branchCleared: false, signedOut: false });
  });
});
