// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const namespace = { organizationId: "org", branchId: "branch", userId: "user" };
const generationKey = "daycare-offline-generation-v2";
beforeEach(() => { vi.resetModules(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("BroadcastChannel", undefined); window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("offline storage lifecycle boundaries", () => {
  it("fails closed if cross-tab locking is unavailable, without opening IndexedDB", async () => {
    const open = vi.fn(); vi.stubGlobal("indexedDB", { open }); Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
    const { loadOfflineDrafts } = await import("./draft-store");
    await expect(loadOfflineDrafts(namespace)).rejects.toThrow("OFFLINE_PROTECTED_STORAGE_UNAVAILABLE");
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects a write queued behind logout before it can reopen the database", async () => {
    const work: (() => Promise<unknown>)[] = [];
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((key, _options, fn) =>
      key === "daycare-offline-outbox-global-v1" ? fn() : new Promise((resolve, reject) => {
        work.push(async () => { try { resolve(await fn()); } catch (error) { reject(error); } });
      })) } });
    const open = vi.fn(); const deleteDatabase = vi.fn(() => { const request: { onsuccess?: () => void } = {}; queueMicrotask(() => request.onsuccess?.()); return request; });
    vi.stubGlobal("indexedDB", { open, deleteDatabase });
    const { getOfflineStorageGeneration, loadOfflineDrafts, clearOfflineDrafts } = await import("./draft-store");
    const oldGeneration = getOfflineStorageGeneration();
    const cleared = clearOfflineDrafts();
    const pending = loadOfflineDrafts(namespace, oldGeneration);
    const rejected = expect(pending).rejects.toThrow("OFFLINE_SESSION_CLEARED");
    await work[0](); await cleared; await work[1](); await rejected;
    expect(open).not.toHaveBeenCalled(); expect(deleteDatabase).toHaveBeenCalledWith("daycare-offline-v1");
    expect(window.localStorage.getItem(generationKey)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("broadcasts another tab's generation change to mounted care views", async () => {
    const { getOfflineStorageGeneration } = await import("./draft-store");
    getOfflineStorageGeneration(); const cleared = vi.fn(); window.addEventListener("daycare-offline-cleared", cleared);
    window.dispatchEvent(new StorageEvent("storage", { key: generationKey, newValue: "next-generation" }));
    expect(cleared).toHaveBeenCalled();
    window.removeEventListener("daycare-offline-cleared", cleared);
  });
  it("holds the deletion and storage lock after onblocked until a terminal IndexedDB result", async () => {
    let deleteRequest!: { error: Error | null; onblocked?: () => void; onerror?: () => void; onsuccess?: () => void };
    const lockExit = vi.fn();
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, _options: unknown, fn: () => Promise<void>) => {
      try { return await fn(); } finally { lockExit(); }
    } } });
    vi.stubGlobal("indexedDB", { deleteDatabase: () => {
      deleteRequest = { error: null };
      queueMicrotask(() => deleteRequest.onblocked?.());
      return deleteRequest;
    } });
    const { clearOfflineDrafts } = await import("./draft-store");
    let settled = false;
    const deletion = clearOfflineDrafts().finally(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    expect(lockExit).not.toHaveBeenCalled();
    deleteRequest.error = new Error("IDB_DELETE_FAILED");
    deleteRequest.onerror?.();
    await expect(deletion).rejects.toThrow("IDB_DELETE_FAILED");
    expect(lockExit).toHaveBeenCalledTimes(2);
  });
});
