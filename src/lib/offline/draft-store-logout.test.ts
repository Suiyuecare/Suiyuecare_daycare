// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredRow = { storageId: string; storageToken: string };
const generationKey = "daycare-offline-generation-v2";

function requestWith<T>(value: () => T) {
  const request = { result: undefined as T | undefined, onsuccess: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined };
  queueMicrotask(() => { request.result = value(); request.onsuccess?.(); });
  return request;
}

function deviceStore(initialRows: StoredRow[]) {
  const rows = [...initialRows];
  const close = vi.fn();
  const database = { close, transaction: () => ({ objectStore: () => ({ getAll: () => requestWith(() => [...rows]) }) }) };
  const open = vi.fn(() => requestWith(() => database));
  const deleteDatabase = vi.fn(() => requestWith(() => { rows.splice(0); return undefined; }));
  const request = vi.fn((_name: string, _options: unknown, operation: () => Promise<unknown>) => operation());
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  vi.stubGlobal("indexedDB", { open, deleteDatabase });
  return { rows, open, close, request, deleteDatabase };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  window.localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("device-wide pre-logout inventory and checked deletion", () => {
  it("counts local, queued and review copies across namespaces without opening their plaintext", async () => {
    const store = deviceStore([
      { storageId: "scope-a:local", storageToken: "t1" },
      { storageId: "scope-a:queued", storageToken: "t2" },
      { storageId: "scope-b:review", storageToken: "t3" },
    ]);
    const { inspectOfflineDraftsForLogout } = await import("./draft-store");
    const snapshot = await inspectOfflineDraftsForLogout();
    expect(snapshot.count).toBe(3);
    expect(snapshot.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(store.request).toHaveBeenCalledWith("daycare-offline-storage-v2", { mode: "exclusive" }, expect.any(Function));
    expect(store.deleteDatabase).not.toHaveBeenCalled();
  });

  it("does not rotate or delete when another tab changed an item after preview", async () => {
    const store = deviceStore([{ storageId: "scope-a:queued", storageToken: "old" }]);
    const { inspectOfflineDraftsForLogout, clearOfflineDraftsIfUnchanged } = await import("./draft-store");
    const snapshot = await inspectOfflineDraftsForLogout();
    store.rows[0]!.storageToken = "new";
    await expect(clearOfflineDraftsIfUnchanged(snapshot)).resolves.toBe("changed");
    expect(store.deleteDatabase).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(generationKey)).toBeNull();
    expect(store.request.mock.calls.map(([key]) => key)).toEqual([
      "daycare-offline-storage-v2", "daycare-offline-outbox-global-v1", "daycare-offline-storage-v2",
    ]);
  });

  it("rotates the generation and deletes under the same exclusive lock if unchanged", async () => {
    const store = deviceStore([{ storageId: "scope-a:queued", storageToken: "same" }]);
    const { inspectOfflineDraftsForLogout, clearOfflineDraftsIfUnchanged } = await import("./draft-store");
    const snapshot = await inspectOfflineDraftsForLogout();
    await expect(clearOfflineDraftsIfUnchanged(snapshot)).resolves.toBe("cleared");
    expect(store.deleteDatabase).toHaveBeenCalledOnce();
    expect(store.rows).toHaveLength(0);
    expect(window.localStorage.getItem(generationKey)).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.request.mock.calls.map(([key]) => key)).toEqual([
      "daycare-offline-storage-v2", "daycare-offline-outbox-global-v1", "daycare-offline-storage-v2",
    ]);
  });

  it("rejects an unreadable inventory instead of reporting zero", async () => {
    const store = deviceStore([{ storageId: "scope-a:queued", storageToken: "t1" }]);
    store.rows[0]!.storageId = "";
    const { inspectOfflineDraftsForLogout } = await import("./draft-store");
    await expect(inspectOfflineDraftsForLogout()).rejects.toThrow("OFFLINE_LOGOUT_INVENTORY_UNREADABLE");
    expect(store.deleteDatabase).not.toHaveBeenCalled();
  });
  it("does not delete after a confirmed flow was canceled before taking the clear lock", async () => {
    const store = deviceStore([{ storageId: "scope-a:queued", storageToken: "t1" }]);
    const { inspectOfflineDraftsForLogout, clearOfflineDraftsIfUnchanged } = await import("./draft-store");
    const snapshot = await inspectOfflineDraftsForLogout();
    const controller = new AbortController();
    controller.abort();
    await expect(clearOfflineDraftsIfUnchanged(snapshot, controller.signal)).rejects.toThrow();
    expect(store.deleteDatabase).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(generationKey)).toBeNull();
  });
  it("keeps generation and ciphertext unchanged if a write lease appears at the last reversible point", async () => {
    const store = deviceStore([{ storageId: "scope-a:queued", storageToken: "t1" }]);
    const { inspectOfflineDraftsForLogout, clearOfflineDraftsIfUnchanged } = await import("./draft-store");
    const snapshot = await inspectOfflineDraftsForLogout();
    const canDelete = vi.fn(() => false);
    await expect(clearOfflineDraftsIfUnchanged(snapshot, undefined, canDelete)).resolves.toBe("blocked");
    expect(canDelete).toHaveBeenCalledOnce();
    expect(store.rows).toHaveLength(1);
    expect(store.deleteDatabase).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(generationKey)).toBeNull();
  });
  it("cannot clear while an offline POST still holds the global outbox lock", async () => {
    const store = deviceStore([{ storageId: "scope-a:queued", storageToken: "t1" }]);
    const { inspectOfflineDraftsForLogout, clearOfflineDraftsIfUnchanged } = await import("./draft-store");
    const snapshot = await inspectOfflineDraftsForLogout();
    let release!: () => void;
    store.request.mockImplementation((key, _options, operation) => {
      if (key !== "daycare-offline-outbox-global-v1") return operation();
      return new Promise((resolve, reject) => {
        release = () => { operation().then(resolve, reject); };
      });
    });
    const pending = clearOfflineDraftsIfUnchanged(snapshot);
    await Promise.resolve();
    expect(store.deleteDatabase).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(generationKey)).toBeNull();
    expect(store.request.mock.calls.map(([key]) => key)).toEqual([
      "daycare-offline-storage-v2", "daycare-offline-outbox-global-v1",
    ]);
    release();
    await expect(pending).resolves.toBe("cleared");
    expect(store.deleteDatabase).toHaveBeenCalledOnce();
  });
});
