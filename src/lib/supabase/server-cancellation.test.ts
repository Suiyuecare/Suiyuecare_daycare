import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(), cookies: vi.fn(), synthetic: vi.fn(), configured: vi.fn(),
  getAll: vi.fn(), set: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key" },
  isSyntheticPreviewMode: mocks.synthetic, hasSupabaseConfiguration: mocks.configured,
}));

import { createServerSupabaseClient } from "./server";

type ClientOptions = {
  global?: { fetch: typeof fetch };
  cookies: {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (values: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void;
  };
};
function clientOptions() {
  return mocks.createServerClient.mock.calls.at(-1)![2] as ClientOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.synthetic.mockReturnValue(false);
  mocks.configured.mockReturnValue(true);
  mocks.getAll.mockReturnValue([{ name: "synthetic", value: "only-test" }]);
  mocks.set.mockReset();
  mocks.cookies.mockResolvedValue({ getAll: mocks.getAll, set: mocks.set });
  mocks.createServerClient.mockReturnValue({ kind: "synthetic-client" });
});

describe("server Supabase factory cancellation fence", () => {
  it("leaves default callers and their ordinary cookie writes unchanged", async () => {
    await expect(createServerSupabaseClient()).resolves.toEqual({ kind: "synthetic-client" });
    expect(mocks.createServerClient).toHaveBeenCalledWith("https://synthetic.invalid", "synthetic-publishable-key", expect.any(Object));
    expect(clientOptions().global).toBeUndefined();
    expect(clientOptions().cookies.getAll()).toEqual([{ name: "synthetic", value: "only-test" }]);
    clientOptions().cookies.setAll([{ name: "synthetic", value: "refreshed", options: { path: "/", httpOnly: true } }]);
    expect(mocks.set).toHaveBeenCalledWith("synthetic", "refreshed", { path: "/", httpOnly: true });
  });

  it.each(["synthetic", "unconfigured"] as const)("does not initialize cookies or a client in %s mode", async (mode) => {
    if (mode === "synthetic") mocks.synthetic.mockReturnValue(true);
    else mocks.configured.mockReturnValue(false);
    await expect(createServerSupabaseClient({ signal: new AbortController().signal })).resolves.toBeNull();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("does not create a client for an already ended read owner", async () => {
    const owner = new AbortController();
    owner.abort(new Error("owner ended"));
    await expect(createServerSupabaseClient({ signal: owner.signal })).rejects.toThrow("owner ended");
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("does not create a late client after asynchronous cookies settle", async () => {
    const owner = new AbortController();
    let settle!: (value: { getAll: typeof mocks.getAll; set: typeof mocks.set }) => void;
    mocks.cookies.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    const result = createServerSupabaseClient({ signal: owner.signal });
    const assertion = expect(result).rejects.toThrow("cookies became stale");
    owner.abort(new Error("cookies became stale"));
    settle({ getAll: mocks.getAll, set: mocks.set });
    await assertion;
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("installs an owned transport and stops refreshed values and removals after cancellation", async () => {
    const owner = new AbortController();
    await createServerSupabaseClient({ signal: owner.signal });
    const options = clientOptions();
    expect(options.global?.fetch).toBeTypeOf("function");
    owner.abort();
    options.cookies.setAll([
      { name: "synthetic-access", value: "late-refresh", options: { maxAge: 100 } },
      { name: "synthetic-refresh", value: "", options: { maxAge: 0 } },
    ]);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("fences each cookie in a batch if its owner ends during the first write", async () => {
    const owner = new AbortController();
    await createServerSupabaseClient({ signal: owner.signal });
    mocks.set.mockImplementationOnce(() => owner.abort());
    clientOptions().cookies.setAll([
      { name: "synthetic-first", value: "before-abort" },
      { name: "synthetic-second", value: "must-not-write" },
    ]);
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith("synthetic-first", "before-abort", undefined);
  });

  it("preserves the Server Component cookie-write exception behavior", async () => {
    await createServerSupabaseClient({ signal: new AbortController().signal });
    mocks.set.mockImplementation(() => { throw new Error("read-only cookie store"); });
    expect(() => clientOptions().cookies.setAll([{ name: "synthetic", value: "refresh" }])).not.toThrow();
  });
});
