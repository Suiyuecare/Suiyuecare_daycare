import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), server: vi.fn(), claims: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isSyntheticPreviewMode: mocks.preview }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.server }));
import { proxy } from "./proxy";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";

type ClientOptions = {
  global: { fetch: typeof fetch };
  cookies: {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (cookies: Array<{ name: string; value: string; options: CookieOptions }>, headers: Record<string, string>) => void;
  };
};
const cacheHeaders = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" };
const updates = [
  { name: "synthetic-access", value: "fresh-synthetic", options: { path: "/", sameSite: "lax" as const, maxAge: 100 } },
  { name: "synthetic-old-chunk", value: "", options: { path: "/", sameSite: "lax" as const, maxAge: 0 } },
];
const originalCookies = "synthetic-access=original-synthetic; synthetic-old-chunk=original-chunk; daycare_branch=synthetic-branch";
function request(path = "/app/staff/workspace/dashboard", init: RequestInit = {}) {
  const { signal, ...rest } = init;
  const headers = new Headers({ cookie: originalCookies, "x-original-request": "preserve" });
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  return new NextRequest(`https://synthetic.invalid${path}`, {
    ...rest, headers, ...(signal ? { signal } : {}),
  });
}
function options() { return mocks.server.mock.calls.at(-1)![2] as ClientOptions; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function syntheticSdkRequest(expiresIn = 3_600) {
  const user = { id: "a0000000-0000-4000-8000-000000000001", aud: "authenticated", email: "synthetic@example.invalid" };
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // An HS256 fixture makes the installed SDK verify via the mocked Auth user
  // endpoint, never via credentials, a cloud service or forged local admission.
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", iat: now, exp: now + expiresIn })}.c3ludGhldGlj`;
  const session = { access_token: token, refresh_token: "synthetic-refresh-only", expires_at: now + expiresIn, expires_in: expiresIn, token_type: "bearer", user };
  const cookie = `sb-synthetic-auth-auth-token=base64-${encode(session)}`;
  return { incoming: new NextRequest("https://synthetic.invalid/app/staff/workspace/dashboard", { headers: { cookie } }), cookie, token, user };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.preview.mockReturnValue(false); mocks.server.mockReturnValue({ auth: { getClaims: mocks.claims } });
  mocks.claims.mockResolvedValue({ data: null, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-auth.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External transport forbidden in synthetic fixture"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Proxy optional refresh deadline and cookie owner (synthetic unit proof)", () => {
  it.each([
    new Headers({ "x-synthetic-header": "preserved" }),
    [["x-synthetic-header", "preserved"]] as [string, string][],
    { "X-Synthetic-Header": "preserved" },
  ])("normalizes nullable DOM signals and every header input without dropping defaults", async (headers) => {
    const incoming = request(undefined, { signal: null, headers });
    expect(incoming.signal.aborted).toBe(false);
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(incoming.headers.get("x-original-request")).toBe("preserve");
    expect(incoming.headers.get("x-synthetic-header")).toBe("preserved");
    expect((await proxy(incoming)).headers.get("x-middleware-next")).toBe("1");
  });
  it("keeps unchanged cookies, matcher continuation and no invented identity on normal reads", async () => {
    const incoming = request(); const result = await proxy(incoming);
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(mocks.server).toHaveBeenCalledWith("https://synthetic-auth.invalid", "synthetic-publishable-key", expect.any(Object));
    expect(options().cookies.getAll()).toEqual(incoming.cookies.getAll());
    expect(options().global.fetch).toBeTypeOf("function");
    expect(mocks.claims).toHaveBeenCalledExactlyOnceWith();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stages refresh cookies until claims complete, retaining default options and required cache headers", async () => {
    const read = deferred<{ data: null; error: null }>(); mocks.claims.mockReturnValue(read.promise);
    const incoming = request(); const pending = proxy(incoming);
    options().cookies.setAll(updates, cacheHeaders);
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(options().cookies.getAll()).toEqual(expect.arrayContaining([
      { name: "synthetic-access", value: "fresh-synthetic" }, { name: "synthetic-old-chunk", value: "" },
    ]));
    read.resolve({ data: null, error: null });
    const result = await pending;
    expect(incoming.cookies.get("synthetic-access")?.value).toBe("fresh-synthetic");
    expect(result.cookies.get("synthetic-access")).toMatchObject({ value: "fresh-synthetic", path: "/", sameSite: "lax", maxAge: 100 });
    expect(result.cookies.get("synthetic-old-chunk")).toMatchObject({ value: "", maxAge: 0 });
    expect(result.headers.get("x-middleware-request-cookie")).toBe(incoming.headers.get("cookie"));
    expect(result.headers.get("x-middleware-request-x-original-request")).toBe("preserve");
    for (const [name, value] of Object.entries(cacheHeaders)) expect(result.headers.get(name)).toBe(value);
  });
  it("retains all staged cookie batches and SDK headers instead of losing an earlier batch", async () => {
    mocks.claims.mockImplementation(async () => {
      options().cookies.setAll([updates[0]], cacheHeaders);
      options().cookies.setAll([updates[1]], { "X-Synthetic-Refresh": "preserve" });
      return { data: null, error: null };
    });
    const result = await proxy(request());
    expect(result.cookies.getAll()).toHaveLength(2);
    for (const [name, value] of Object.entries(cacheHeaders)) expect(result.headers.get(name)).toBe(value);
    expect(result.headers.get("x-synthetic-refresh")).toBe("preserve");
  });
  it.each(["/app/staff/workspace/dashboard", "/api/context/branch", "/api/line/webhook", "/auth/callback"])("bounds non-cooperative refresh and safely continues %s with original cookies", async (path) => {
    vi.useFakeTimers(); mocks.claims.mockReturnValue(new Promise(() => {}));
    const incoming = request(path, path.startsWith("/api/") ? { method: "POST", body: "synthetic-body" } : {});
    const pending = proxy(incoming); options().cookies.setAll(updates, cacheHeaders);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    const result = await pending;
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(incoming.bodyUsed).toBe(false);
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(result.headers.has("location")).toBe(false);
    expect(result.headers.has("cache-control")).toBe(false);
    expect(mocks.claims).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fences both late tokens and removals after a timed-out provider reply", async () => {
    vi.useFakeTimers(); const read = deferred<{ data: null; error: null }>(); mocks.claims.mockReturnValue(read.promise);
    const incoming = request(); const pending = proxy(incoming);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    const result = await pending;
    options().cookies.setAll(updates, cacheHeaders);
    read.resolve({ data: null, error: null }); await vi.advanceTimersByTimeAsync(0);
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(result.headers.has("cache-control")).toBe(false);
    expect(mocks.server).toHaveBeenCalledTimes(1); expect(mocks.claims).toHaveBeenCalledTimes(1);
  });
  it("does not accept cookie writes after successful owner completion either", async () => {
    const incoming = request(); const result = await proxy(incoming);
    options().cookies.setAll(updates, cacheHeaders);
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(result.headers.has("set-cookie")).toBe(false);
  });
  it("preserves original cookies and continuation on thrown refresh failures", async () => {
    mocks.claims.mockImplementation(async () => {
      options().cookies.setAll(updates, cacheHeaders);
      throw new Error("private provider details");
    });
    const incoming = request(); const result = await proxy(incoming);
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(await result.text()).not.toContain("private");
  });
  it("does not initialize a client when the incoming request already ended", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await proxy(request(undefined, { signal: controller.signal }))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.claims).not.toHaveBeenCalled();
  });
  it("does not commit staged cookies after incoming request cancellation", async () => {
    const controller = new AbortController(); const read = deferred<{ data: null; error: null }>(); mocks.claims.mockReturnValue(read.promise);
    const incoming = request(undefined, { signal: controller.signal }); const pending = proxy(incoming);
    options().cookies.setAll(updates, cacheHeaders); controller.abort(); read.resolve({ data: null, error: null });
    const result = await pending;
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(result.headers.has("set-cookie")).toBe(false);
  });
  it("forwards request cancellation to the owned fetch and forbids later transport attempts", async () => {
    const controller = new AbortController(); const read = deferred<{ data: null; error: null }>(); mocks.claims.mockReturnValue(read.promise);
    const incoming = request(undefined, { signal: controller.signal }); const pending = proxy(incoming);
    const localFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic")); vi.stubGlobal("fetch", localFetch);
    await options().global.fetch("https://synthetic-auth.invalid/auth/v1/user");
    const fetchSignal = localFetch.mock.calls[0][1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    controller.abort(); expect(fetchSignal?.aborted).toBe(true);
    await expect(options().global.fetch("https://synthetic-auth.invalid/auth/v1/user")).rejects.toBeDefined();
    expect(localFetch).toHaveBeenCalledTimes(1);
    read.resolve({ data: null, error: null }); await pending;
  });
  it("wires the installed SSR/auth SDK through the owned transport without changing its auth headers", async () => {
    const installed = await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
    mocks.server.mockImplementation(installed.createServerClient);
    const fixture = syntheticSdkRequest();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture.user), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", transport);
    const result = await proxy(fixture.incoming);
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://synthetic-auth.invalid/auth/v1/user");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${fixture.token}`);
    expect(new Headers(init?.headers).get("apikey")).toBe("synthetic-publishable-key");
    expect(init?.cache).toBe("no-store"); expect(init?.signal?.aborted).toBe(true);
    expect(fixture.incoming.headers.get("cookie")).toBe(fixture.cookie);
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(mocks.claims).not.toHaveBeenCalled();
  });
  it("bounds the installed SDK's non-cooperative transport and ignores its late response", async () => {
    vi.useFakeTimers();
    const installed = await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
    mocks.server.mockImplementation(installed.createServerClient);
    const fixture = syntheticSdkRequest(); const read = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(read.promise); vi.stubGlobal("fetch", transport);
    const pending = proxy(fixture.incoming);
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    const result = await pending;
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(result.headers.get("x-middleware-next")).toBe("1");
    read.resolve(new Response(JSON.stringify(fixture.user), { headers: { "Content-Type": "application/json" } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.incoming.headers.get("cookie")).toBe(fixture.cookie);
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("lets installed SDK cleanup see every newly staged refresh chunk before committing a missing-session result", async () => {
    const installed = await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
    const batches: Array<Array<{ name: string; value: string; options: CookieOptions }>> = [];
    mocks.server.mockImplementation((url: string, key: string, read: ClientOptions) => {
      const write = read.cookies.setAll;
      read.cookies.setAll = (cookies, headers) => { batches.push(cookies); write(cookies, headers); };
      return installed.createServerClient(url, key, read);
    });
    const fixture = syntheticSdkRequest(-120); const fresh = syntheticSdkRequest();
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://synthetic-auth.invalid/auth/v1/token?grant_type=refresh_token") {
        return new Response(JSON.stringify({ access_token: fresh.token, refresh_token: "synthetic-new-refresh",
          expires_in: 3_600, token_type: "bearer", user: { ...fresh.user, user_metadata: { synthetic_padding: "x".repeat(7_000) } } }),
        { headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://synthetic-auth.invalid/auth/v1/user") {
        return new Response(JSON.stringify({ code: "session_not_found", message: "Synthetic missing session" }),
          { status: 401, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } });
      }
      throw new Error("External transport forbidden in synthetic fixture");
    });
    vi.stubGlobal("fetch", transport);
    const result = await proxy(fixture.incoming);
    const createdChunks = batches.flat().filter((cookie) => cookie.value !== "" && /\.\d+$/u.test(cookie.name)).map((cookie) => cookie.name);
    expect(createdChunks.length).toBeGreaterThanOrEqual(2);
    const removed = batches.at(-1)!.filter((cookie) => cookie.value === "" && cookie.options.maxAge === 0).map((cookie) => cookie.name);
    expect(removed).toEqual(expect.arrayContaining(createdChunks));
    const committed = result.cookies.getAll().filter((cookie) => cookie.name.startsWith("sb-synthetic-auth-auth-token"));
    expect(committed.length).toBeGreaterThanOrEqual(createdChunks.length);
    expect(committed.every((cookie) => cookie.value === "" && cookie.maxAge === 0)).toBe(true);
    expect(fixture.incoming.cookies.getAll().filter((cookie) => cookie.name.startsWith("sb-synthetic-auth-auth-token")).every((cookie) => cookie.value === "")).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [name, value] of Object.entries(cacheHeaders)) expect(result.headers.get(name)).toBe(value);
  });
  it.each(["/_next/static/synthetic.js", "/favicon.ico", "/synthetic.svg"])("preserves asset bypass for %s", async (path) => {
    expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.claims).not.toHaveBeenCalled();
  });
  it("preserves unconfigured mode without touching session cookies or transport", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ""); const incoming = request(); const result = await proxy(incoming);
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(incoming.headers.get("cookie")).toBe(originalCookies);
    expect(mocks.server).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
