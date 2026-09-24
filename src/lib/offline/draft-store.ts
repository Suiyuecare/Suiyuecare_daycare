"use client";

export type OfflineDraftKind = "vital-sign" | "care-note" | "attendance";

export interface OfflineDraft<T = unknown> {
  id: string;
  kind: OfflineDraftKind;
  clientRef: string;
  createdAt: string;
  expiresAt: string;
  baseVersion: number;
  payload: T;
  /** Authenticated revision of the encrypted device copy; not a server version. */
  storageToken?: string;
}

export interface OfflineDraftNamespace {
  organizationId: string;
  branchId: string;
  userId: string;
}

type EncryptedDraft = Omit<OfflineDraft, "payload" | "clientRef"> & {
  storageId: string;
  scopeKey: string;
  iv: number[];
  ciphertext: ArrayBuffer;
};

const DB_NAME = "daycare-offline-v1";
const DB_VERSION = 2;
const DRAFT_STORE = "drafts";
const META_STORE = "meta";
const KEY_ID = "device-aes-key";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let storageEpoch = 0;
const STORAGE_LOCK = "daycare-offline-storage-v2";
const GENERATION_KEY = "daycare-offline-generation-v2";
let broadcasts: BroadcastChannel | null = null;
let listenersInstalled = false;

function announceClear(generation: string) {
  storageEpoch += 1;
  window.dispatchEvent(new CustomEvent("daycare-offline-cleared", { detail: { generation } }));
}

function installClearListeners() {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key === GENERATION_KEY && event.newValue) announceClear(event.newValue);
  });
  if (typeof BroadcastChannel !== "undefined") {
    broadcasts = new BroadcastChannel("daycare-offline-control-v2");
    broadcasts.addEventListener("message", (event) => {
      const value: unknown = event.data;
      if (value && typeof value === "object" && "type" in value && "generation" in value &&
          value.type === "clear" && typeof value.generation === "string") announceClear(value.generation);
    });
  }
}

/** Only a random invalidation marker is stored here, never care/client data. */
export function getOfflineStorageGeneration() {
  if (typeof window === "undefined") throw new Error("OFFLINE_BROWSER_REQUIRED");
  installClearListeners();
  // Storage must support the cross-tab invalidation marker, not just reads.
  // This fixed probe contains no identifiers or user content.
  window.localStorage.setItem("daycare-offline-marker-probe", "1");
  window.localStorage.removeItem("daycare-offline-marker-probe");
  // Empty is a valid initial generation. Only logout rotates it, avoiding a
  // racing first-open in two tabs changing each other's initial generation.
  return window.localStorage.getItem(GENERATION_KEY) ?? "initial";
}

function assertGeneration(epoch: number, generation: string) {
  if (epoch !== storageEpoch || getOfflineStorageGeneration() !== generation) throw new Error("OFFLINE_SESSION_CLEARED");
}

async function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  // Do not silently persist health drafts in a browser where cross-tab
  // clear/write serialization cannot be guaranteed.
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("OFFLINE_PROTECTED_STORAGE_UNAVAILABLE");
  return navigator.locks.request(STORAGE_LOCK, { mode: "exclusive" }, operation);
}

async function itemToken(item: EncryptedDraft) {
  if (item.storageToken) return item.storageToken;
  const digest = await crypto.subtle.digest("SHA-256", item.ciphertext);
  return `legacy-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function committed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("OFFLINE_WRITE_ABORTED"));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      // Version 1 drafts were not bound to a tenant/user. Remove them rather
      // than attempting to migrate data whose owner cannot be proven.
      if (database.objectStoreNames.contains(DRAFT_STORE)) {
        database.deleteObjectStore(DRAFT_STORE);
      }
      database.createObjectStore(DRAFT_STORE, { keyPath: "storageId" });
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function namespaceKey(namespace: OfflineDraftNamespace) {
  const canonical = [
    namespace.organizationId,
    namespace.branchId,
    namespace.userId,
  ].join("\u001f");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function additionalData(item: {
  scopeKey: string;
  id: string;
  kind: OfflineDraftKind;
  baseVersion: number;
  createdAt: string;
  expiresAt: string;
  storageToken?: string;
}) {
  return new TextEncoder().encode(
    [
      item.scopeKey,
      item.id,
      item.kind,
      String(item.baseVersion),
      item.createdAt,
      item.expiresAt,
      ...(item.storageToken ? [item.storageToken] : []),
    ].join("\u001f"),
  );
}

async function getOrCreateKey(database: IDBDatabase) {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const request = database
      .transaction(META_STORE, "readonly")
      .objectStore(META_STORE)
      .get(KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });

  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  // Another tab may have created the key while WebCrypto was running. Pick
  // the winner inside one transaction so existing drafts remain decryptable.
  const transaction = database.transaction(META_STORE, "readwrite");
  const done = committed(transaction);
  const store = transaction.objectStore(META_STORE);
  let selected = key;
  const lookup = store.get(KEY_ID);
  lookup.onsuccess = () => {
    if (lookup.result) selected = lookup.result as CryptoKey;
    else store.put(key, KEY_ID);
  };
  await done;
  return selected;
}

export async function saveOfflineDraft<T>(
  namespace: OfflineDraftNamespace,
  draft: Omit<OfflineDraft<T>, "createdAt" | "expiresAt"> & Partial<Pick<OfflineDraft<T>, "createdAt" | "expiresAt">>,
  expectedGeneration?: string,
) {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") {
    throw new Error("SYNTHETIC_PREVIEW_STORAGE_DISABLED");
  }
  const epoch = storageEpoch;
  const generation = expectedGeneration ?? getOfflineStorageGeneration();
  return withStorageLock(async () => {
  assertGeneration(epoch, generation);
  const database = await openDatabase();
  try {
    const key = await getOrCreateKey(database);
    const scopeKey = await namespaceKey(namespace);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const now = Date.now();
    const existing = await new Promise<EncryptedDraft | undefined>((resolve, reject) => {
      const request = database.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(`${scopeKey}:${draft.id}`);
      request.onsuccess = () => resolve(request.result as EncryptedDraft | undefined);
      request.onerror = () => reject(request.error);
    });
    if (existing ? draft.storageToken !== await itemToken(existing) : Boolean(draft.storageToken)) throw new Error("OFFLINE_DRAFT_CONFLICT");
    const createdAt = existing?.createdAt ?? draft.createdAt ?? new Date(now).toISOString();
    const expiresAt = existing?.expiresAt ?? draft.expiresAt ?? new Date(Date.parse(createdAt) + MAX_AGE_MS).toISOString();
    if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(createdAt) > now || Date.parse(expiresAt) <= now ||
      Date.parse(expiresAt) - Date.parse(createdAt) > MAX_AGE_MS) {
      throw new Error("OFFLINE_DRAFT_EXPIRED");
    }
    const encryptedMetadata = {
      id: draft.id,
      kind: draft.kind,
      baseVersion: draft.baseVersion,
      createdAt,
      expiresAt,
      scopeKey,
      storageToken: crypto.randomUUID(),
    };
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(encryptedMetadata) },
      key,
      new TextEncoder().encode(
        JSON.stringify({ clientRef: draft.clientRef, payload: draft.payload }),
      ),
    );

    const encrypted: EncryptedDraft = {
      ...encryptedMetadata,
      storageId: `${scopeKey}:${draft.id}`,
      iv: Array.from(iv),
      ciphertext,
    };

    assertGeneration(epoch, generation);
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const done = committed(transaction);
    transaction.objectStore(DRAFT_STORE).put(encrypted);
    await done;
    return encryptedMetadata.storageToken;
  } finally {
    database.close();
  }
  });
}

export async function loadOfflineDrafts(
  namespace: OfflineDraftNamespace,
  expectedGeneration?: string,
): Promise<OfflineDraft[]> {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") return [];
  const epoch = storageEpoch;
  const generation = expectedGeneration ?? getOfflineStorageGeneration();
  return withStorageLock(async () => {
  assertGeneration(epoch, generation);
  const database = await openDatabase();
  try {
    const key = await getOrCreateKey(database);
    const scopeKey = await namespaceKey(namespace);
    const encrypted = await new Promise<EncryptedDraft[]>((resolve, reject) => {
      const request = database
        .transaction(DRAFT_STORE, "readonly")
        .objectStore(DRAFT_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result as EncryptedDraft[]);
      request.onerror = () => reject(request.error);
    });

    const now = Date.now();
    const current = (item: EncryptedDraft) => Number.isFinite(Date.parse(item.createdAt)) &&
      Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.createdAt) <= now &&
      Date.parse(item.createdAt) >= now - MAX_AGE_MS && Date.parse(item.expiresAt) > now &&
      Date.parse(item.expiresAt) - Date.parse(item.createdAt) <= MAX_AGE_MS;
    const owned = encrypted.filter((item) => item.scopeKey === scopeKey);
    const valid = owned.filter(current);
    // Remove expired ciphertext from all namespaces without decrypting any
    // other account's content. Expiration does not depend on its next login.
    const expiredStorageIds = encrypted
      .filter((item) => !current(item))
      .map((item) => item.storageId);

    if (expiredStorageIds.length) {
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      const done = committed(transaction);
      expiredStorageIds.forEach((storageId) =>
        transaction.objectStore(DRAFT_STORE).delete(storageId),
      );
      await done;
    }

    return await Promise.all(
      valid.map(async (item) => {
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: new Uint8Array(item.iv),
            additionalData: additionalData(item),
          },
          key,
          item.ciphertext,
        );
        const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as {
          clientRef: string;
          payload: unknown;
        };
        return {
          id: item.id,
          kind: item.kind,
          clientRef: decoded.clientRef,
          createdAt: item.createdAt,
          expiresAt: item.expiresAt,
          baseVersion: item.baseVersion,
          payload: decoded.payload,
          storageToken: await itemToken(item),
        };
      }),
    );
  } finally {
    database.close();
  }
  });
}

/** Delete exactly one owned draft, never another tenant's or user's item. */
export async function removeOfflineDraft(namespace: OfflineDraftNamespace, id: string, expectedToken?: string, expectedGeneration?: string): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") return false;
  const epoch = storageEpoch;
  const generation = expectedGeneration ?? getOfflineStorageGeneration();
  return withStorageLock(async () => {
  assertGeneration(epoch, generation);
  const database = await openDatabase();
  try {
    const scopeKey = await namespaceKey(namespace);
    const existing = await new Promise<EncryptedDraft | undefined>((resolve, reject) => {
      const request = database.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(`${scopeKey}:${id}`);
      request.onsuccess = () => resolve(request.result as EncryptedDraft | undefined);
      request.onerror = () => reject(request.error);
    });
    if (!existing) return true;
    if (expectedToken && await itemToken(existing) !== expectedToken) return false;
    assertGeneration(epoch, generation);
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const done = committed(transaction);
    transaction.objectStore(DRAFT_STORE).delete(`${scopeKey}:${id}`);
    await done;
    return true;
  } finally { database.close(); }
  });
}

export async function clearOfflineDrafts() {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") return;
  const generation = crypto.randomUUID();
  installClearListeners();
  // Invalidate all callers before waiting for the in-flight write lock.
  // Cross-tab storage events plus BroadcastChannel cover old mounted views.
  let generationFailure: unknown;
  try { window.localStorage.setItem(GENERATION_KEY, generation); }
  catch (error) { generationFailure = error; }
  announceClear(generation);
  broadcasts?.postMessage({ type: "clear", generation });
  const clear = () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline database is in use"));
  });
  if (typeof navigator !== "undefined" && navigator.locks) await withStorageLock(clear);
  else await clear(); // Such browsers cannot write new device drafts.
  if (generationFailure) throw new Error("OFFLINE_CROSS_TAB_CLEAR_UNCERTAIN");
}
