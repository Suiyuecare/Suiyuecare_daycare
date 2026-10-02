import { afterEach, describe, expect, it, vi } from "vitest";
import { intakeRequest, IntakeRequestError } from "./client";
const id = "c1600000-0000-4000-8000-000000000001";
const ok = { requestId: id, status: "ok", data: { persisted: true }, errors: [] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("intake bounded response transport", () => {
  it.each(["fetch", "json"])("the independent deadline bounds hung %s ignoring abort", async kind => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, options) => { signal = options.signal; return kind === "fetch" ? new Promise(() => {})
      : Promise.resolve({ status: 200, ok: true, json: () => new Promise(() => {}) }); }));
    const result = expect(intakeRequest("/api/client-intake", { method: "POST", body: "original" })).rejects.toBeInstanceOf(IntakeRequestError);
    await vi.advanceTimersByTimeAsync(20000); await result;
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{}, { ...ok, errors: [{ code: "ERROR", message: "PRIVATE" }] }, { ...ok, status: "partial" }, { ...ok, requestId: "wrong" }])("malformed or contradictory 2xx is unknown", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(intakeRequest("/api/client-intake")).rejects.toMatchObject({ definitiveRejection: false });
  });
  it("only a complete structured first 4xx has rejection evidence, with provider text sanitized", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ requestId: id, status: "error", data: null, errors: [{ code: "INTAKE_CONFLICT", message: "PRIVATE_SOURCE" }] }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ message: "PRIVATE_SOURCE" }] }, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(intakeRequest("/api/client-intake")).rejects.toMatchObject({ status: 409, definitiveRejection: true });
    await expect(intakeRequest("/api/client-intake")).rejects.toMatchObject({ status: 409, definitiveRejection: false });
  });
  it("passes exact original content once and cleans timer after successful decoding", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn().mockResolvedValue(Response.json(ok)); vi.stubGlobal("fetch", fetcher);
    expect(await intakeRequest("/api/client-intake", { method: "POST", body: "ORIGINAL_BODY" })).toEqual(ok.data);
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1].body).toBe("ORIGINAL_BODY"); expect(vi.getTimerCount()).toBe(0);
  });
});
