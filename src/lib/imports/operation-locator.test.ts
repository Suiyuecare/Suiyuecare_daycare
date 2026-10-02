import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ImportError } from "./errors";
import { readTrustedUploadOperation, readUploadOperationKey, type UploadOperationLocatorDependencies } from "./operation-locator";
import { trustedUploadOperationId } from "./trusted-staging";
import type { ImportActor } from "./types";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: ImportActor = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3), assuranceLevel: "aal2", recentAal2At: null };
const rawKey = " exact legacy upload key ", secret = "PRIVATE_CMS_PROVIDER_TOKEN";
function harness(mode: "general" | "routine-intake" = "general") {
  const current = { ...actor, assuranceLevel: mode === "general" ? "aal2" : "aal1" } as ImportActor;
  const envelope = { schema_version: 1, original_operation_id: trustedUploadOperationId(current, rawKey), reservation_id: uuid(4),
    organization_id: actor.organizationId, branch_id: actor.branchId, actor_user_id: actor.userId, mode, file_sha256: "a".repeat(64),
    file_name: "synthetic.html", mime_type: "text/html", file_size_bytes: 10, mapping_version: "central-care-plan-html@1",
    created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-01T00:15:00Z", status: "queued", receipt: null,
    staging_only: true, formally_imported: false };
  const rpc = vi.fn().mockResolvedValue({ data: envelope, error: null });
  const createUserClient = vi.fn().mockResolvedValue({ rpc });
  const reauthorize = vi.fn().mockImplementation(async () => ({ ...current }));
  const dependencies: UploadOperationLocatorDependencies = { createUserClient, reauthorize };
  return { current, envelope, rpc, createUserClient, reauthorize, dependencies, mode };
}
const read = (test: ReturnType<typeof harness>, key = rawKey) => readTrustedUploadOperation(test.dependencies, key, test.mode);
async function safeError(promise: Promise<unknown>, code: string) {
  const error = await promise.catch(error => error); expect(error).toBeInstanceOf(ImportError);
  if (!(error instanceof ImportError)) throw error;
  expect(error.code).toBe(code); expect(error.message).not.toContain(secret);
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T00:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("original upload locator read", () => {
  it.each(["general", "routine-intake"] as const)("reads exact namespace with current %s authority and user-client stub", async mode => {
    const test = harness(mode); expect(await read(test)).toEqual(test.envelope);
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith("import_upload_operation_receipt", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_original_operation: trustedUploadOperationId(actor, rawKey), p_mode: mode,
    }); expect(test.reauthorize).toHaveBeenCalledTimes(3);
    expect(test.dependencies).not.toHaveProperty("workerClient"); expect(test.dependencies).not.toHaveProperty("archive");
  });
  it("treats absent observation as uncertain history rather than replacement authority", async () => {
    const test = harness(); test.rpc.mockResolvedValue({ data: null, error: null }); expect(await read(test)).toBeNull();
    expect(test.rpc).toHaveBeenCalledTimes(1); expect(test.reauthorize).toHaveBeenCalledTimes(3);
  });
  it("general historical preview needs AAL2 but no recent authentication", async () => {
    const test = harness(); expect(await read(test)).toEqual(test.envelope);
    test.current.assuranceLevel = "aal1"; await safeError(read(test), "IMPORT_OPERATION_DENIED");
  });
  it.each(["", " ", "a".repeat(201), "key\n"])("invalid key %j dispatches nothing", async key => {
    const test = harness(); await safeError(read(test, key), "IMPORT_OPERATION_INVALID_REQUEST"); expect(test.reauthorize).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "branchId", "userId", "assuranceLevel"] as const)("revoked %s around the RPC never returns data", async field => {
    const test = harness(); test.reauthorize.mockResolvedValueOnce(test.current).mockResolvedValueOnce(test.current)
      .mockResolvedValueOnce({ ...test.current, [field]: field === "assuranceLevel" ? "aal1" : uuid(9) });
    await safeError(read(test), "IMPORT_OPERATION_DENIED"); expect(test.rpc).toHaveBeenCalledTimes(1);
  });
  it("authority changes before dispatch stop the RPC", async () => {
    const test = harness(); test.reauthorize.mockResolvedValueOnce(test.current).mockResolvedValueOnce({ ...test.current, branchId: uuid(9) });
    await safeError(read(test), "IMPORT_OPERATION_DENIED"); expect(test.rpc).not.toHaveBeenCalled();
  });
  it.each([{ organization_id: uuid(9) }, { branch_id: uuid(9) }, { actor_user_id: uuid(9) }, { original_operation_id: uuid(9) },
    { mode: "routine-intake" }, { file_sha256: "bad" }, { created_at: "invalid" }, { status: "completed", receipt: null }, { private_data: secret },
  ])("rejects untrusted result %j", async change => {
    const test = harness(); test.rpc.mockResolvedValue({ data: { ...test.envelope, ...change }, error: null });
    await safeError(read(test), "IMPORT_OPERATION_INVALID_RESPONSE");
  });
  it.each([["42501", "IMPORT_OPERATION_DENIED"], ["22023", "IMPORT_OPERATION_CONFLICT"], ["23505", "IMPORT_OPERATION_CONFLICT"],
    ["55000", "IMPORT_OPERATION_CONFLICT"], ["other", "IMPORT_OPERATION_RESULT_UNKNOWN"]])("maps RPC %s without provider detail", async (code, expected) => {
    const test = harness(); test.rpc.mockResolvedValue({ data: null, error: { code, message: secret, details: secret } }); await safeError(read(test), expected!);
  });
  it("unconfigured client cannot dispatch", async () => {
    const test = harness(); test.createUserClient.mockResolvedValue(null); await safeError(read(test), "IMPORT_AUTH_NOT_CONFIGURED"); expect(test.rpc).not.toHaveBeenCalled();
  });
  it.each(["auth", "client", "rpc"] as const)("bounds uncooperative %s and never revives late work", async phase => {
    const test = harness(); let resolve!: (value: unknown) => void; const held = new Promise(done => { resolve = done; });
    if (phase === "auth") test.reauthorize.mockImplementation(() => held);
    if (phase === "client") test.createUserClient.mockImplementation(() => held);
    if (phase === "rpc") test.rpc.mockImplementation(() => held);
    const pending = safeError(read(test), "IMPORT_OPERATION_RESULT_UNKNOWN"); await vi.advanceTimersByTimeAsync(20_000); await pending;
    const before = test.reauthorize.mock.calls.length; resolve(phase === "auth" ? test.current : phase === "client" ? { rpc: test.rpc } : { data: test.envelope, error: null });
    await vi.advanceTimersByTimeAsync(1); expect(test.reauthorize).toHaveBeenCalledTimes(before);
    expect(test.rpc).toHaveBeenCalledTimes(phase === "rpc" ? 1 : 0); expect(vi.getTimerCount()).toBe(0);
  });
  it("uses a total deadline across authentication and RPC", async () => {
    const test = harness(); test.reauthorize.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 7000)); return test.current; });
    const pending = safeError(read(test), "IMPORT_OPERATION_RESULT_UNKNOWN"); await vi.advanceTimersByTimeAsync(20_000); await pending;
    expect(test.rpc).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1000); expect(test.rpc).toHaveBeenCalledTimes(1);
  });
  it("monotonic clock prevents a starved deadline returning late result", async () => {
    const test = harness(); let elapsed = 0; vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    test.rpc.mockImplementation(async () => { elapsed = 20_001; return { data: test.envelope, error: null }; });
    await safeError(read(test), "IMPORT_OPERATION_RESULT_UNKNOWN"); expect(test.reauthorize).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it("abort stops observation and late RPC cannot reauthorize", async () => {
    const test = harness(); const controller = new AbortController(); test.dependencies.signal = controller.signal;
    let resolve!: (value: unknown) => void; test.rpc.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = safeError(read(test), "IMPORT_OPERATION_RESULT_UNKNOWN"); await vi.advanceTimersByTimeAsync(0); controller.abort(); await pending;
    resolve({ data: test.envelope, error: null }); await vi.advanceTimersByTimeAsync(0); expect(test.reauthorize).toHaveBeenCalledTimes(2);
  });
  it("already aborted read does not authorize or create a client", async () => {
    const test = harness(); const controller = new AbortController(); controller.abort(); test.dependencies.signal = controller.signal;
    await safeError(read(test), "IMPORT_OPERATION_RESULT_UNKNOWN"); expect(test.createUserClient).not.toHaveBeenCalled(); expect(test.reauthorize).not.toHaveBeenCalled();
  });
});
describe("header-only locator admission", () => {
  const request = (suffix = "", key: string | undefined = rawKey) => new Request(`https://example.invalid/api/imports/operations${suffix}`,
    { headers: key === undefined ? {} : { "idempotency-key": key } });
  it("supports legacy nonUUID header input without server trimming", () => {
    // Native Headers trims transport whitespace; the server must not trim again.
    const req = request(); expect(readUploadOperationKey(req)).toBe(req.headers.get("idempotency-key"));
    expect(readUploadOperationKey(request("", "legacy upload operation"))).toBe("legacy upload operation");
  });
  it.each(["?", "?key=operation", "?mode=general", "?key=a&key=b"])("rejects every query %s", suffix => {
    expect(() => readUploadOperationKey(request(suffix))).toThrow();
  });
  it.each(["", " ", "a".repeat(201), "key, key", "legacy,key"])("rejects invalid/ambiguous header %j", key => {
    expect(() => readUploadOperationKey(request("", key))).toThrow();
  });
  it("rejects missing and duplicate header values", () => {
    expect(() => readUploadOperationKey(new Request("https://example.invalid/api/imports/operations"))).toThrow();
    const headers = new Headers(); headers.append("idempotency-key", "key1"); headers.append("idempotency-key", "key2");
    expect(() => readUploadOperationKey(new Request("https://example.invalid/api/imports/operations", { headers }))).toThrow();
  });
  it.each([["content-length", "1"], ["transfer-encoding", "chunked"]])("rejects declared read bodies %s", (name, value) => {
    expect(() => readUploadOperationKey(new Request("https://example.invalid/api/imports/operations", { headers: { "idempotency-key": "key", [name!]: value! } }))).toThrow();
  });
});
