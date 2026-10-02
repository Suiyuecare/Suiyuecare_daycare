import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createServerReadFetch } from "./server-read-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("request-owned Supabase read transport", () => {
  it("preserves input, body, headers and options while preventing shared caching", async () => {
    const owner = new AbortController();
    const headers = new Headers({ "x-synthetic-trace": "synthetic" });
    const body = JSON.stringify({ synthetic: true });
    const response = new Response("{}", { status: 200 });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", transport);

    const input = "https://synthetic.invalid/rest/v1/rpc/synthetic_read";
    const init: RequestInit = {
      method: "POST", body, headers, cache: "force-cache", credentials: "omit",
      redirect: "error", keepalive: false,
    };
    await expect(createServerReadFetch(owner.signal)(input, init)).resolves.toBe(response);

    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0][0]).toBe(input);
    const actual = transport.mock.calls[0][1]!;
    expect(actual).toMatchObject({ ...init, cache: "no-store" });
    expect(actual.headers).toBe(headers);
    expect(actual.body).toBe(body);
    expect(actual.signal).toBeInstanceOf(AbortSignal);
    expect(actual.signal?.aborted).toBe(false);
    expect(init.cache).toBe("force-cache");
  });

  it.each(["owner", "request", "init"] as const)("honors the %s cancellation source without replacing the other sources", async (source) => {
    const owner = new AbortController();
    const request = new AbortController();
    const init = new AbortController();
    const transport = vi.fn<typeof fetch>((_input, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", transport);
    const input = new Request("https://synthetic.invalid/rest/v1/synthetic", { signal: request.signal });
    const result = createServerReadFetch(owner.signal)(input, { signal: init.signal });
    const assertion = expect(result).rejects.toThrow("synthetic cancellation");
    ({ owner, request, init })[source].abort(new Error("synthetic cancellation"));
    await assertion;
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0][0]).toBe(input);
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it("retains the method, headers and body already present on an incoming Request", async () => {
    const owner = new AbortController();
    const input = new Request("https://synthetic.invalid/rest/v1/rpc/synthetic", {
      method: "POST", headers: { "content-type": "application/json", "x-synthetic-trace": "request" },
      body: '{"synthetic":true}', cache: "force-cache",
    });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", transport);
    await createServerReadFetch(owner.signal)(input);
    const effectiveRequest = new Request(transport.mock.calls[0][0], transport.mock.calls[0][1]);
    expect(effectiveRequest.method).toBe("POST");
    expect(effectiveRequest.headers.get("x-synthetic-trace")).toBe("request");
    expect(await effectiveRequest.text()).toBe('{"synthetic":true}');
    expect(effectiveRequest.cache).toBe("no-store");
    expect(transport.mock.calls[0][0]).toBe(input);
  });

  it.each(["owner", "request", "init"] as const)("does not send a request when %s is already cancelled", async (source) => {
    const owner = new AbortController();
    const request = new AbortController();
    const init = new AbortController();
    ({ owner, request, init })[source].abort(new Error("already cancelled"));
    const transport = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", transport);
    await expect(createServerReadFetch(owner.signal)(
      new Request("https://synthetic.invalid/rest/v1/synthetic", { signal: request.signal }),
      { signal: init.signal },
    )).rejects.toThrow("already cancelled");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a non-cooperative late response and prevents follow-up SDK retries", async () => {
    const owner = new AbortController();
    let settle!: (value: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise((resolve) => { settle = resolve; }));
    vi.stubGlobal("fetch", transport);
    const boundedFetch = createServerReadFetch(owner.signal);
    const result = boundedFetch("https://synthetic.invalid/rest/v1/synthetic");
    const assertion = expect(result).rejects.toThrow("read owner ended");
    owner.abort(new Error("read owner ended"));
    settle(new Response("{\"synthetic\":true}"));
    await assertion;
    await expect(boundedFetch("https://synthetic.invalid/rest/v1/synthetic")).rejects.toThrow("read owner ended");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not cancel a distinct request owner", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", transport);
    first.abort(new Error("first ended"));
    await expect(createServerReadFetch(first.signal)("https://synthetic.invalid/first")).rejects.toThrow("first ended");
    await expect(createServerReadFetch(second.signal)("https://synthetic.invalid/second")).resolves.toBeInstanceOf(Response);
    expect(transport).toHaveBeenCalledOnce();
    expect(second.signal.aborted).toBe(false);
  });

  it("does not replace a normal provider failure with a cancellation or retry", async () => {
    const owner = new AbortController();
    const error = new Error("synthetic provider unavailable");
    const transport = vi.fn<typeof fetch>().mockRejectedValue(error);
    vi.stubGlobal("fetch", transport);
    await expect(createServerReadFetch(owner.signal)("https://synthetic.invalid/rest/v1/synthetic")).rejects.toBe(error);
    expect(transport).toHaveBeenCalledOnce();
    expect(owner.signal.aborted).toBe(false);
  });
});
