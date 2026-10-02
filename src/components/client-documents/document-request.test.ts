import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientJsonReadError } from "@/lib/api/client-fetch";
import { DOCUMENT_LINK_LIFETIME_MS, DOCUMENT_REQUEST_TIMEOUT_MS, DocumentRequestError, documentRequest, safeDocumentLink } from "./document-request";

const clientId = "c1600000-0000-4000-8000-000000000001";
const documentId = "d1600000-0000-4000-8000-000000000001";
const organizationId = "a1600000-0000-4000-8000-000000000001";
const origin = "https://synthetic.supabase.co";
const receipt = () => ({ url: `${origin}/storage/v1/object/sign/client-intake-documents/${organizationId}/${clientId}/${documentId}?token=synthetic`, documentId, version: 1, expiresSeconds: 60 });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("bounded private document transport", () => {
  it("bounds a GET whose fetch ignores the passed cancellation signal", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const fetch = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetch);
    const result = documentRequest("/api/client-documents", { signal: controller.signal }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toBeInstanceOf(ClientJsonReadError); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds POST JSON decoding independently and never retries automatically", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => new Promise(() => {}) }); vi.stubGlobal("fetch", fetch);
    const result = documentRequest("/api/client-documents", { method: "POST", signal: new AbortController().signal }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(DOCUMENT_REQUEST_TIMEOUT_MS);
    expect(await result).toMatchObject({ code: "TIMEOUT" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("owner cancellation wins even when POST ignores abort; a late body is discarded", async () => {
    let resolve: (response: Response) => void = () => {};
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(), stage = vi.fn();
    const result = documentRequest("/api/client-documents", { method: "POST", signal: controller.signal }, stage).catch((error) => error);
    controller.abort(); expect(await result).toMatchObject({ code: "ABORTED" });
    resolve(Response.json({ status: "ok", data: {} })); await Promise.resolve();
    expect(stage).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { status: "ok", data: null }, { status: "ok", data: "untrusted" }])("rejects malformed success envelopes %j", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(documentRequest("/api/client-documents", { method: "POST" })).rejects.toBeInstanceOf(DocumentRequestError);
  });
  it("sanitizes invalid JSON instead of rendering its parser error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => { throw new SyntaxError("synthetic sensitive provider text"); } }));
    const error = await documentRequest("/api/client-documents", { method: "POST" }).catch((failure) => failure);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" }); expect(error instanceof Error ? error.message : "").not.toContain("sensitive");
  });
});
describe("short-lived private document links", () => {
  it("binds origin, case, file and version; counts expiry from request start", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin); const started = Date.now() - 5_000;
    expect(safeDocumentLink(receipt(), clientId, documentId, 1, started)).toEqual({ url: receipt().url, expiresAt: started + DOCUMENT_LINK_LIFETIME_MS });
  });
  it.each([
    { url: receipt().url.replace("synthetic.supabase.co", "other.supabase.co") },
    { url: receipt().url.replace(clientId, documentId) },
    { url: receipt().url.replace(`/${documentId}?`, "/untrusted?") },
    { url: receipt().url.replace("https://", "https://user:password@") },
    { url: receipt().url.replace("?token=synthetic", "") },
    { version: 2 }, { expiresSeconds: 600 },
  ])("rejects mismatched download capabilities %j", (change) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    expect(() => safeDocumentLink({ ...receipt(), ...change }, clientId, documentId, 1, Date.now())).toThrow();
  });
  it("never exposes an already expired or unconfigured link", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    expect(() => safeDocumentLink(receipt(), clientId, documentId, 1, Date.now() - DOCUMENT_LINK_LIFETIME_MS)).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ""); expect(() => safeDocumentLink(receipt(), clientId, documentId, 1, Date.now())).toThrow();
  });
});
