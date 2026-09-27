import { fetchJsonWithTimeout } from "@/lib/api/client-fetch";

export const DOCUMENT_REQUEST_TIMEOUT_MS = 25_000;
export const DOCUMENT_LINK_LIFETIME_MS = 55_000;
type ApiBody = { status?: string; data?: unknown; errors?: { code?: string; message?: string }[] };
export class DocumentRequestError extends Error {
  constructor(readonly status: number | null, readonly code: string, message = "附件操作尚未確認，請保留原操作再重試。") { super(message); }
}

/** One request, bounded through body decoding even if fetch ignores abort.
 * No retry, persistence, side effects or recovery-key changes happen here. */
export async function documentRequest(url: string, options: RequestInit = {}, onResponse?: () => void): Promise<unknown> {
  if (!options.method || options.method === "GET") {
    const { payload } = await fetchJsonWithTimeout(url, options);
    const body = payload as ApiBody | null;
    if (!body || body.status !== "ok" || !body.data || typeof body.data !== "object") throw new DocumentRequestError(200, "INVALID_RESPONSE");
    return body.data;
  }
  const owner = options.signal;
  const controller = new AbortController();
  const abortError = () => new DocumentRequestError(null, owner?.aborted ? "ABORTED" : "TIMEOUT", "附件連線逾時或已中斷，結果仍待確認；請保留原操作。");
  let removeAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError());
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => controller.signal.removeEventListener("abort", onAbort);
  });
  const onOwnerAbort = () => controller.abort();
  owner?.addEventListener("abort", onOwnerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), DOCUMENT_REQUEST_TIMEOUT_MS);
  try {
    if (owner?.aborted) controller.abort();
    const operation = (async () => {
      if (controller.signal.aborted) throw abortError();
      const response = await fetch(url, { ...options, cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
      if (controller.signal.aborted) throw abortError();
      onResponse?.();
      let body: ApiBody | null;
      try { body = await response.json() as ApiBody | null; }
      catch { if (controller.signal.aborted) throw abortError(); throw new DocumentRequestError(response.status, "INVALID_RESPONSE"); }
      if (controller.signal.aborted) throw abortError();
      if (response.redirected || !body || typeof body !== "object" || body.status !== "ok" || !response.ok || !body.data || typeof body.data !== "object") {
        throw new DocumentRequestError(response.status, body?.errors?.[0]?.code ?? "INVALID_RESPONSE", body?.errors?.[0]?.message);
      }
      return body.data;
    })();
    return await Promise.race([operation, aborted]);
  } finally { clearTimeout(timer); removeAbort(); owner?.removeEventListener("abort", onOwnerAbort); }
}

/** A bearer link belongs only to the configured storage origin and exact case/file. */
export function safeDocumentLink(data: unknown, clientId: string, documentId: string, version: number, requestedAt: number) {
  const receipt = data as { url?: unknown; documentId?: unknown; version?: unknown; expiresSeconds?: unknown } | null;
  if (!receipt || typeof receipt.url !== "string" || receipt.documentId !== documentId || receipt.version !== version || receipt.expiresSeconds !== 60) throw new DocumentRequestError(200, "INVALID_DOWNLOAD");
  const url = new URL(receipt.url), configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const prefix = "/storage/v1/object/sign/client-intake-documents/";
  const parts = url.pathname.slice(prefix.length).split("/");
  if (configured.protocol !== "https:" || configured.username || configured.password || configured.pathname !== "/" || configured.search || configured.hash ||
    url.protocol !== "https:" || url.origin !== configured.origin || url.username || url.password || url.hash || !url.pathname.startsWith(prefix) ||
    parts.length !== 3 || !/^[a-f0-9-]{36}$/.test(parts[0]) || parts[1] !== clientId || parts[2] !== documentId || !url.searchParams.get("token")) throw new DocumentRequestError(200, "INVALID_DOWNLOAD");
  const expiresAt = requestedAt + DOCUMENT_LINK_LIFETIME_MS;
  if (expiresAt <= Date.now()) throw new DocumentRequestError(200, "EXPIRED_DOWNLOAD");
  return { url: url.href, expiresAt };
}
