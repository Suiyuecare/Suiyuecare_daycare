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
    request.onsuccess = () => resolve(request.result);
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
}) {
  return new TextEncoder().encode(
    [
      item.scopeKey,
      item.id,
      item.kind,
      String(item.baseVersion),
      item.createdAt,
      item.expiresAt,
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

  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(META_STORE, "readwrite")
      .objectStore(META_STORE)
      .put(key, KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  return key;
}

export async function saveOfflineDraft<T>(
  namespace: OfflineDraftNamespace,
  draft: Omit<OfflineDraft<T>, "createdAt" | "expiresAt">,
) {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") {
    throw new Error("SYNTHETIC_PREVIEW_STORAGE_DISABLED");
  }
  const database = await openDatabase();
  try {
    const key = await getOrCreateKey(database);
    const scopeKey = await namespaceKey(namespace);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const now = Date.now();
    const encryptedMetadata = {
      id: draft.id,
      kind: draft.kind,
      baseVersion: draft.baseVersion,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + MAX_AGE_MS).toISOString(),
      scopeKey,
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

    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(DRAFT_STORE, "readwrite")
        .objectStore(DRAFT_STORE)
        .put(encrypted);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function loadOfflineDrafts(
  namespace: OfflineDraftNamespace,
): Promise<OfflineDraft[]> {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") return [];
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
    const owned = encrypted.filter((item) => item.scopeKey === scopeKey);
    const valid = owned.filter((item) => Date.parse(item.expiresAt) > now);
    const expiredStorageIds = owned
      .filter((item) => Date.parse(item.expiresAt) <= now)
      .map((item) => item.storageId);

    if (expiredStorageIds.length) {
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      expiredStorageIds.forEach((storageId) =>
        transaction.objectStore(DRAFT_STORE).delete(storageId),
      );
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
        };
      }),
    );
  } finally {
    database.close();
  }
}

export async function clearOfflineDrafts() {
  if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline database is in use"));
  });
}
