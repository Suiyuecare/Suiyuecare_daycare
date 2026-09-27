import { createServer, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ url: "", cookieSet: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: fixture.cookieSet }) }));
vi.mock("@/lib/env", () => ({
  env: {
    get NEXT_PUBLIC_SUPABASE_URL() { return fixture.url; },
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-local-publishable-key",
  },
  isSyntheticPreviewMode: () => false, hasSupabaseConfiguration: () => true,
}));

import { createServerSupabaseClient } from "./server";

const nativeFetch = globalThis.fetch.bind(globalThis);
const syntheticUser = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "synthetic@example.invalid" };
let mode: "success" | "pending-headers" | "pending-body" = "success";
let onRequest: (() => void) | undefined;
let onClose: (() => void) | undefined;
let requests: Array<{ path: string; method?: string; authorization?: string; apiKey?: string }> = [];
const responses = new Set<ServerResponse>();
const server = createServer((request, response) => {
  responses.add(response);
  response.on("close", () => { responses.delete(response); onClose?.(); });
  requests.push({ path: request.url ?? "", method: request.method, authorization: request.headers.authorization, apiKey: request.headers.apikey as string | undefined });
  if (request.url !== "/auth/v1/user") {
    response.writeHead(404).end();
    return;
  }
  if (mode === "success") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(syntheticUser));
  } else if (mode === "pending-body") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.flushHeaders();
    response.write('{"id":');
  }
  onRequest?.();
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic loopback listener unavailable");
  fixture.url = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  mode = "success";
  requests = [];
  onRequest = undefined;
  onClose = undefined;
  fixture.cookieSet.mockClear();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).origin !== fixture.url) throw new Error("Non-loopback transport forbidden in synthetic fixture");
    return nativeFetch(input, init);
  }));
});
afterEach(() => {
  for (const response of responses) response.destroy();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("installed SSR / auth SDK with owned loopback transport", () => {
  it("routes real SDK getUser through the owned fetch without changing auth headers or request shape", async () => {
    const owner = new AbortController();
    const client = await createServerSupabaseClient({ signal: owner.signal });
    if (!client) throw new Error("Synthetic client unavailable");
    const result = await client.auth.getUser("synthetic-local-token");
    expect(result.error).toBeNull();
    expect(result.data.user?.id).toBe(syntheticUser.id);
    expect(requests).toEqual([{ path: "/auth/v1/user", method: "GET", authorization: "Bearer synthetic-local-token", apiKey: "synthetic-local-publishable-key" }]);
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0][1]?.cache).toBe("no-store");
    expect(fetchCalls[0][1]?.signal?.aborted).toBe(false);
    expect(fixture.cookieSet).not.toHaveBeenCalled();
    owner.abort();
  });

  it.each(["pending-headers", "pending-body"] as const)("cancels real SDK getUser during %s, including a stalled JSON body", async (pendingMode) => {
    mode = pendingMode;
    const received = new Promise<void>((resolve) => { onRequest = resolve; });
    const closed = new Promise<void>((resolve) => { onClose = resolve; });
    const owner = new AbortController();
    const client = await createServerSupabaseClient({ signal: owner.signal });
    if (!client) throw new Error("Synthetic client unavailable");
    const result = client.auth.getUser("synthetic-local-token");
    await received;
    owner.abort(new Error("synthetic read owner ended"));
    const response = await result;
    expect(response.data.user).toBeNull();
    expect(response.error).not.toBeNull();
    await closed;
    expect(requests).toHaveLength(1);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fixture.cookieSet).not.toHaveBeenCalled();
  });
});
